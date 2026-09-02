import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type { OperationalUsageEvent, SupabaseAdminIdentity, SupabaseUserIdentity } from "./supabase.js";
import type { AccountSnapshot, RelayDevice } from "./protocol.js";
import { loginEmailForUsername } from "./user-identity.js";

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

interface SessionTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  user: { id: string; email: string | null; app_metadata: Record<string, unknown> };
}

const TABLES = new Set([
  "profiles",
  "codex_admins",
  "codex_account_snapshots",
  "codex_reservations",
  "codex_busy_slots",
  "codex_device_snapshots",
  "codex_admin_audit",
  "codex_account_usage_samples",
  "codex_usage_events",
  "codex_user_profiles",
  "codex_app_settings",
]);

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function opaqueToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function identifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Identificador SQL inválido: ${value}`);
  return `"${value}"`;
}

function selectedColumns(value: string | undefined): string {
  if (!value || value === "*") return "*";
  return value.split(",").map((entry) => identifier(entry.trim())).join(", ");
}

function prefersRepresentation(options: RequestOptions): boolean {
  return /return=representation/i.test(options.headers?.Prefer ?? "");
}

function databaseValue(value: unknown): unknown {
  // The application schema uses JSONB for list values (for example,
  // enabled_models) and has no native SQL array columns. node-postgres would
  // otherwise encode JS arrays as PostgreSQL array literals, which JSONB
  // correctly rejects.
  return Array.isArray(value) ? JSON.stringify(value) : value;
}

export class PostgresAuthClient {
  public readonly isLocalAuth = true;
  public readonly pool: Pool;

  public constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 12, idleTimeoutMillis: 30_000 });
    this.pool.on("error", (error) => console.error("[postgres] conexão ociosa falhou:", error));
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  public async healthcheck(): Promise<void> {
    await this.pool.query("select 1");
  }

  public async passwordLogin(email: string, password: string): Promise<SessionTokens | null> {
    const result = await this.pool.query<{
      id: string;
      email: string | null;
      password_hash: string | null;
      app_metadata: Record<string, unknown>;
    }>(
      `select u.id, u.email, u.password_hash, u.app_metadata
       from public.app_users u
       left join public.profiles p on p.user_id = u.id
       where (lower(u.email) = lower($1) or lower(p.username) = lower($1)) and u.disabled_at is null
       limit 1`,
      [email.trim()],
    );
    const user = result.rows[0];
    if (!user?.password_hash || !(await bcrypt.compare(password, user.password_hash))) return null;
    return this.createSession(user);
  }

  public async refreshSession(refreshToken: string): Promise<SessionTokens | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<{
        session_id: string;
        id: string;
        email: string | null;
        app_metadata: Record<string, unknown>;
      }>(
        `select session.id as session_id, app_user.id, app_user.email, app_user.app_metadata
         from public.app_sessions session
         join public.app_users app_user on app_user.id = session.user_id
         where session.refresh_token_hash = $1
           and session.revoked_at is null
           and session.refresh_expires_at > now()
           and app_user.disabled_at is null
         for update of session`,
        [tokenHash(refreshToken)],
      );
      const user = result.rows[0];
      if (!user) {
        await client.query("rollback");
        return null;
      }
      await client.query("update public.app_sessions set revoked_at = now() where id = $1", [user.session_id]);
      const tokens = await this.createSession(user, client);
      await client.query("commit");
      return tokens;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async logout(accessToken: string): Promise<void> {
    await this.pool.query(
      "update public.app_sessions set revoked_at = coalesce(revoked_at, now()) where access_token_hash = $1",
      [tokenHash(accessToken)],
    );
  }

  public async authenticate(token: string): Promise<SupabaseAdminIdentity | null> {
    const user = await this.sessionUser(token);
    if (!user) return null;
    const result = await this.pool.query<{ role: "owner" | "admin"; enabled: boolean }>(
      "select role, enabled from public.codex_admins where user_id = $1 limit 1",
      [user.userId],
    );
    const admin = result.rows[0];
    if (!admin?.enabled || (admin.role !== "owner" && admin.role !== "admin")) return null;
    return { ...user, role: admin.role };
  }

  public async authenticateUser(token: string): Promise<SupabaseUserIdentity | null> {
    return this.sessionUser(token);
  }

  public async queryAdmin<T = unknown>(token: string, table: string, query: Record<string, string>): Promise<T[]> {
    if (!(await this.authenticate(token))) return [];
    const result = await this.rest(token, table, query);
    return result.ok && Array.isArray(result.data) ? result.data as T[] : [];
  }

  public async queryAdminAll<T = unknown>(token: string, table: string, query: Record<string, string>, pageSize = 1_000, maxRows = 500_000): Promise<T[]> {
    const rows: T[] = [];
    for (let offset = 0; offset < maxRows; offset += pageSize) {
      const page = await this.queryAdmin<T>(token, table, { ...query, limit: String(pageSize), offset: String(offset) });
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return rows;
  }

  public async rest(token: string, table: string, query: Record<string, string> = {}, options: RequestOptions = {}): Promise<{ ok: boolean; status: number; data: unknown }> {
    const identity = await this.authenticateUser(token);
    if (!identity) return { ok: false, status: 401, data: { message: "invalid session" } };
    const admin = await this.authenticate(token);
    if (table.startsWith("rpc/")) return this.rpc(identity, admin, table.slice(4), options.body);
    if (!TABLES.has(table)) return { ok: false, status: 404, data: { message: "unknown relation" } };

    const scopedQuery = { ...query };
    if (!admin) {
      if (["profiles", "codex_user_profiles", "codex_reservations", "codex_device_snapshots"].includes(table)) {
        scopedQuery.user_id = `eq.${identity.userId}`;
      } else if (!["codex_account_snapshots", "codex_busy_slots", "codex_app_settings"].includes(table)) {
        return { ok: false, status: 403, data: { message: "forbidden relation" } };
      }
    }

    try {
      const method = (options.method ?? "GET").toUpperCase();
      if (method === "GET") return { ok: true, status: 200, data: await this.select(table, scopedQuery) };
      if (method === "PATCH") {
        const rows = await this.update(table, scopedQuery, asRecord(options.body));
        return { ok: true, status: 200, data: prefersRepresentation(options) ? rows : null };
      }
      return { ok: false, status: 405, data: { message: "method not allowed" } };
    } catch (error) {
      return { ok: false, status: 400, data: { message: error instanceof Error ? error.message : "database request failed" } };
    }
  }

  private async sessionUser(token: string): Promise<SupabaseUserIdentity | null> {
    if (!token.trim()) return null;
    const result = await this.pool.query<{
      user_id: string;
      email: string | null;
      app_metadata: Record<string, unknown>;
    }>(
      `update public.app_sessions session
       set last_seen_at = now()
       from public.app_users app_user
       where session.access_token_hash = $1
         and session.user_id = app_user.id
         and session.revoked_at is null
         and session.access_expires_at > now()
         and app_user.disabled_at is null
       returning app_user.id as user_id, app_user.email, app_user.app_metadata`,
      [tokenHash(token)],
    );
    const row = result.rows[0];
    if (!row) return null;
    const login = typeof row.app_metadata?.remote_codex_login === "string"
      ? row.app_metadata.remote_codex_login
      : row.email ?? "Usuário";
    return { userId: row.user_id, email: row.email, login };
  }

  private async createSession(user: { id: string; email: string | null; app_metadata: Record<string, unknown> }, client: Pool | PoolClient = this.pool): Promise<SessionTokens> {
    const accessToken = opaqueToken();
    const refreshToken = opaqueToken();
    await client.query(
      `insert into public.app_sessions
       (user_id, access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at)
       values ($1, $2, $3, now() + make_interval(secs => $4), now() + make_interval(secs => $5))`,
      [user.id, tokenHash(accessToken), tokenHash(refreshToken), ACCESS_TTL_SECONDS, REFRESH_TTL_SECONDS],
    );
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: Math.floor(Date.now() / 1_000) + ACCESS_TTL_SECONDS,
      expires_in: ACCESS_TTL_SECONDS,
      user: { id: user.id, email: user.email, app_metadata: user.app_metadata ?? {} },
    };
  }

  private whereClause(query: Record<string, string>, startIndex = 1): { sql: string; values: unknown[] } {
    const ignored = new Set(["select", "order", "limit", "offset"]);
    const clauses: string[] = [];
    const values: unknown[] = [];
    for (const [column, expression] of Object.entries(query)) {
      if (ignored.has(column)) continue;
      const separator = expression.indexOf(".");
      if (separator < 0) throw new Error(`Filtro inválido para ${column}.`);
      const operator = expression.slice(0, separator);
      const raw = expression.slice(separator + 1);
      const sqlColumn = identifier(column);
      if (operator === "is" && raw === "null") {
        clauses.push(`${sqlColumn} is null`);
        continue;
      }
      const sqlOperator = ({ eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" } as Record<string, string>)[operator];
      if (!sqlOperator) throw new Error(`Operador de filtro não suportado: ${operator}`);
      values.push(raw);
      clauses.push(`${sqlColumn} ${sqlOperator} $${startIndex + values.length - 1}`);
    }
    return { sql: clauses.length ? ` where ${clauses.join(" and ")}` : "", values };
  }

  private async select(table: string, query: Record<string, string>): Promise<QueryResultRow[]> {
    const where = this.whereClause(query);
    const orders = query.order?.split(",").filter(Boolean).map((entry) => {
      const [column, direction = "asc"] = entry.split(".");
      if (direction !== "asc" && direction !== "desc") throw new Error("Ordenação inválida.");
      return `${identifier(column)} ${direction}`;
    }) ?? [];
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "1000", 10) || 1_000, 1), 10_000);
    const offset = Math.max(Number.parseInt(query.offset ?? "0", 10) || 0, 0);
    const sql = `select ${selectedColumns(query.select)} from public.${identifier(table)}${where.sql}${orders.length ? ` order by ${orders.join(", ")}` : ""} limit $${where.values.length + 1} offset $${where.values.length + 2}`;
    return (await this.pool.query(sql, [...where.values, limit, offset])).rows;
  }

  private async update(table: string, query: Record<string, string>, body: Record<string, unknown>): Promise<QueryResultRow[]> {
    const entries = Object.entries(body);
    if (entries.length === 0) throw new Error("Atualização vazia.");
    const assignments = entries.map(([column], index) => `${identifier(column)} = $${index + 1}`);
    const where = this.whereClause(query, entries.length + 1);
    if (!where.sql) throw new Error("Atualização sem filtro recusada.");
    const sql = `update public.${identifier(table)} set ${assignments.join(", ")}${where.sql} returning *`;
    return (await this.pool.query(sql, [...entries.map(([, value]) => databaseValue(value)), ...where.values])).rows;
  }

  private async rpc(identity: SupabaseUserIdentity, admin: SupabaseAdminIdentity | null, name: string, body: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
    if (!["codex_request_reservation", "codex_approve_reservation"].includes(name)) {
      return { ok: false, status: 404, data: { message: "unknown function" } };
    }
    if (name === "codex_approve_reservation" && !admin) {
      return { ok: false, status: 403, data: { message: "admin required" } };
    }
    const args = asRecord(body);
    const entries = Object.entries(args);
    for (const [key] of entries) identifier(key);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)", [identity.userId, admin ? "authenticated" : "authenticated"]);
      const call = `select * from public.${identifier(name)}(${entries.map(([key], index) => `${identifier(key)} => $${index + 1}`).join(", ")})`;
      const result = await client.query(call, entries.map(([, value]) => value));
      await client.query("commit");
      return { ok: true, status: 200, data: result.rows };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      return { ok: false, status: 400, data: { message: error instanceof Error ? error.message : "function failed" } };
    } finally {
      client.release();
    }
  }
}

export class PostgresServiceClient {
  public readonly auth: PostgresAuthClient;

  public constructor(databaseUrl: string) {
    this.auth = new PostgresAuthClient(databaseUrl);
  }

  public async close(): Promise<void> {
    await this.auth.close();
  }

  public async createAdmin(email: string, password: string, role: "owner" | "admin", createdBy: string | null, login?: string): Promise<{ userId: string; email: string | null }> {
    const normalizedLogin = login?.normalize("NFKC").trim().toLowerCase() || "";
    const normalizedEmail = normalizedLogin ? loginEmailForUsername(normalizedLogin) : email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error("Informe um email administrativo válido.");
    if (password.length < 6) throw new Error("A senha deve ter pelo menos 6 caracteres.");
    const passwordHash = await bcrypt.hash(password, 12);
    const existing = await this.auth.pool.query<{ id: string }>("select id from public.app_users where lower(email) = lower($1) limit 1", [normalizedEmail]);
    const userId = existing.rows[0]?.id ?? crypto.randomUUID();
    await this.auth.pool.query(
      `insert into public.app_users (id, email, password_hash, app_metadata, email_confirmed_at)
       values ($1, $2, $3, $4, now())
       on conflict (id) do update set email = excluded.email, password_hash = excluded.password_hash,
         app_metadata = excluded.app_metadata, email_confirmed_at = excluded.email_confirmed_at,
         updated_at = now(), disabled_at = null`,
      [userId, normalizedEmail, passwordHash, { remote_codex_role: role, ...(normalizedLogin ? { remote_codex_login: normalizedLogin } : {}) }],
    );
    await this.upsert("codex_admins", [{ user_id: userId, email: normalizedEmail, role, enabled: true, created_by: createdBy }], "user_id");
    return { userId, email: normalizedEmail };
  }

  public async inviteAdmin(email: string, createdBy: string | null): Promise<{ userId: string; email: string | null }> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error("Informe um email de administrador válido.");
    const existing = await this.auth.pool.query<{ id: string }>("select id from public.app_users where lower(email) = lower($1) limit 1", [normalizedEmail]);
    const userId = existing.rows[0]?.id ?? crypto.randomUUID();
    await this.auth.pool.query(
      `insert into public.app_users (id, email, app_metadata)
       values ($1, $2, '{"remote_codex_role":"admin","invited":true}'::jsonb)
       on conflict (id) do update set email = excluded.email, app_metadata = public.app_users.app_metadata || excluded.app_metadata, updated_at = now()`,
      [userId, normalizedEmail],
    );
    await this.upsert("codex_admins", [{ user_id: userId, email: normalizedEmail, role: "admin", enabled: true, created_by: createdBy }], "user_id");
    return { userId, email: normalizedEmail };
  }

  public async bootstrapOwner(email: string): Promise<{ userId: string; email: string | null }> {
    const normalizedEmail = email.trim().toLowerCase();
    const result = await this.auth.pool.query<{ id: string; email: string | null }>("select id, email from public.app_users where lower(email) = lower($1) limit 1", [normalizedEmail]);
    const user = result.rows[0];
    if (!user) throw new Error("Usuário não encontrado no banco local. Crie-o primeiro e rode o bootstrap novamente.");
    await this.upsert("codex_admins", [{ user_id: user.id, email: user.email, role: "owner", enabled: true, created_by: null }], "user_id");
    return { userId: user.id, email: user.email };
  }

  public async upsertEndUser(input: { username: string; loginEmail: string; password: string; groupName: string; weeklyQuotaPercent: number }): Promise<{ userId: string }> {
    const existing = await this.auth.pool.query<{ id: string }>("select id from public.app_users where lower(email) = lower($1) limit 1", [input.loginEmail]);
    const userId = existing.rows[0]?.id ?? crypto.randomUUID();
    const passwordHash = await bcrypt.hash(input.password, 12);
    await this.auth.pool.query(
      `insert into public.app_users (id, email, password_hash, app_metadata, email_confirmed_at)
       values ($1, $2, $3, '{"remote_codex_role":"user"}'::jsonb, now())
       on conflict (id) do update set email = excluded.email, password_hash = excluded.password_hash,
         app_metadata = excluded.app_metadata, email_confirmed_at = excluded.email_confirmed_at,
         updated_at = now(), disabled_at = null`,
      [userId, input.loginEmail, passwordHash],
    );
    await this.upsert("profiles", [{
      user_id: userId, username: input.username, group_name: input.groupName,
      weekly_quota_percent: input.weeklyQuotaPercent, enabled: true,
      scheduling_enabled: true, updated_at: new Date().toISOString(),
    }], "user_id");
    await this.upsert("codex_user_profiles", [{
      user_id: userId, username: input.username, login_email: input.loginEmail,
      group_name: input.groupName, enabled: true, scheduling_enabled: true,
      weekly_quota_percent: input.weeklyQuotaPercent, updated_at: new Date().toISOString(),
    }], "user_id").catch(() => undefined);
    return { userId };
  }

  public async listAdmins(): Promise<Array<Record<string, unknown>>> {
    const result = await this.auth.pool.query(
      `select admin.user_id, admin.email, admin.role, admin.enabled, admin.created_at, admin.created_by,
              coalesce(app_user.app_metadata ->> 'remote_codex_login', app_user.email, admin.email) as login,
              app_user.created_at as auth_created_at,
              (select max(session.last_seen_at) from public.app_sessions session where session.user_id = admin.user_id) as last_sign_in_at
       from public.codex_admins admin
       left join public.app_users app_user on app_user.id = admin.user_id
       order by admin.created_at asc`,
    );
    return result.rows;
  }

  public async setAdminEnabled(userId: string, enabled: boolean): Promise<Record<string, unknown>> {
    const admins = await this.listAdmins();
    const target = admins.find((admin) => admin.user_id === userId);
    if (!target) throw new Error("Administrador não encontrado.");
    if (target.role === "owner") throw new Error("O owner não pode ser desabilitado por este painel.");
    await this.auth.pool.query("update public.codex_admins set enabled = $2 where user_id = $1", [userId, enabled]);
    if (!enabled) await this.auth.pool.query("update public.app_sessions set revoked_at = coalesce(revoked_at, now()) where user_id = $1", [userId]);
    return { ...target, enabled };
  }

  public async upsertAccountSnapshots(accounts: AccountSnapshot[]): Promise<void> {
    await this.upsert("codex_account_snapshots", accounts.map((account) => ({
      account_id: account.accountId, label: account.label, email: account.email,
      plan_type: account.planType, auth_mode: account.authMode, status: account.status,
      is_default: account.isDefault, updated_at: account.updatedAt, rate_limits: account.rateLimits,
      usage: account.usage, error: account.error, observed_at: new Date().toISOString(),
    })), "account_id");
  }

  public async upsertDeviceSnapshots(devices: RelayDevice[]): Promise<void> {
    const now = new Date().toISOString();
    for (const device of devices) {
      const row = {
        device_id: device.deviceId, label: device.label, account_id: device.accountId ?? null,
        weekly_limit_percent: device.weeklyLimitPercent ?? 100, user_id: device.userId ?? null,
        reservation_id: device.reservationId ?? null, quota_base_used_percent: device.quotaBaseUsedPercent ?? null,
        quota_budget_percent: device.quotaBudgetPercent ?? null, created_at: device.createdAt,
        expires_at: device.expiresAt, revoked_at: device.revokedAt, disabled_at: device.disabledAt,
        last_seen_at: device.lastSeenAt,
        status: device.revokedAt ? "revoked" : device.disabledAt ? "disabled" : Date.parse(device.expiresAt) <= Date.now() ? "expired" : device.usage?.usageLimitReachedAt ? "limited" : "active",
        fingerprint: device.tokenHash.slice(0, 12), usage_window_resets_at: device.usage?.windowResetsAt ?? null,
        observed_tokens: device.usage?.observedTokens ?? 0, observed_input_tokens: device.usage?.observedInputTokens ?? 0,
        observed_cached_input_tokens: device.usage?.observedCachedInputTokens ?? 0, observed_output_tokens: device.usage?.observedOutputTokens ?? 0,
        observed_reasoning_tokens: device.usage?.observedReasoningTokens ?? 0, account_used_percent: device.usage?.accountUsedPercent ?? null,
        account_window_duration_mins: device.usage?.accountWindowDurationMins ?? null,
        account_resets_at: device.usage?.accountResetsAt ? new Date(device.usage.accountResetsAt * 1_000).toISOString() : null,
        usage_limit_reached_at: device.usage?.usageLimitReachedAt ?? null, usage_last_seen_at: device.usage?.lastUsageAt ?? null,
        stale_at: now,
      };
      try {
        await this.upsert("codex_device_snapshots", [row], "device_id");
      } catch {
        await this.upsert("codex_device_snapshots", [{ ...row, user_id: null, reservation_id: null }], "device_id");
      }
    }
  }

  public async expireOverdueReservations(now = new Date()): Promise<string[]> {
    const result = await this.auth.pool.query<{ id: string; ends_at: string }>(
      `update public.codex_reservations set approval_status = 'expired', status = 'cancelled', cancelled_at = ends_at
       where approval_status = 'pending' and ends_at <= $1 returning id, ends_at`, [now],
    );
    for (const row of result.rows) await this.audit(null, "reservation.expire", "reservation", row.id, { reason: "schedule_ended", ends_at: row.ends_at });
    return result.rows.map((row) => row.id);
  }

  public async insertAccountUsageSamples(accounts: AccountSnapshot[], now = new Date()): Promise<void> {
    const rows = accounts.map((account) => {
      const windows = Object.values(account.rateLimits || {}).flatMap((limit) => [limit.primary, limit.secondary]).filter((window) => Boolean(window));
      const primary = windows.sort((a, b) => (b?.windowDurationMins ?? 0) - (a?.windowDurationMins ?? 0))[0];
      return { account_id: account.accountId, status: account.status, rate_limits: account.rateLimits ?? {}, usage: account.usage ?? null,
        used_percent: primary?.usedPercent ?? null, window_duration_mins: primary?.windowDurationMins ?? null,
        resets_at: primary?.resetsAt ? new Date(primary.resetsAt * 1_000).toISOString() : null, observed_at: now.toISOString() };
    });
    await this.upsert("codex_account_usage_samples", rows);
  }

  public async upsertOperationalUsageEvent(event: OperationalUsageEvent): Promise<void> {
    await this.upsert("codex_usage_events", [{
      event_key: event.eventKey, event_type: event.eventType, device_id: event.deviceId, user_id: event.userId,
      reservation_id: event.reservationId, account_id: event.accountId, thread_id: event.threadId, turn_id: event.turnId,
      model_id: event.modelId, status: event.status, thread_total_tokens: event.totalTokens, thread_input_tokens: event.inputTokens,
      thread_cached_input_tokens: event.cachedInputTokens, thread_output_tokens: event.outputTokens, thread_reasoning_tokens: event.reasoningTokens,
      account_used_percent: event.accountUsedPercent, account_window_duration_mins: event.accountWindowDurationMins,
      account_resets_at: event.accountResetsAt ? new Date(event.accountResetsAt * 1_000).toISOString() : null, observed_at: event.observedAt,
    }], "event_key");
  }

  public async audit(actorUserId: string | null, action: string, targetType: string, targetId: string | null, metadata: Record<string, unknown> = {}): Promise<void> {
    await this.upsert("codex_admin_audit", [{ actor_user_id: actorUserId, action, target_type: targetType, target_id: targetId, metadata }]);
  }

  public async upsert(table: string, rows: unknown[], conflictColumn?: string): Promise<void> {
    if (rows.length === 0) return;
    if (!TABLES.has(table)) throw new Error(`Tabela não permitida: ${table}`);
    for (const rawRow of rows) {
      const row = asRecord(rawRow);
      const entries = Object.entries(row);
      if (entries.length === 0) continue;
      const columns = entries.map(([column]) => identifier(column));
      const values = entries.map(([, value]) => databaseValue(value));
      const placeholders = entries.map((_, index) => `$${index + 1}`);
      const conflict = conflictColumn
        ? ` on conflict (${identifier(conflictColumn)}) do update set ${entries.filter(([column]) => column !== conflictColumn).map(([column]) => `${identifier(column)} = excluded.${identifier(column)}`).join(", ")}`
        : "";
      await this.auth.pool.query(`insert into public.${identifier(table)} (${columns.join(", ")}) values (${placeholders.join(", ")})${conflict}`, values);
    }
  }
}
