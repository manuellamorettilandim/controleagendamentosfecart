import type { AccountSnapshot, RelayDevice } from "./protocol.js";
import { loginEmailForUsername } from "./user-identity.js";

export interface SupabaseAdminIdentity {
  userId: string;
  email: string | null;
  login: string;
  role: "owner" | "admin";
}

export interface SupabaseUserIdentity {
  userId: string;
  email: string | null;
  login: string;
}

export type OperationalUsageEventType =
  | "turn_started"
  | "turn_completed"
  | "token_usage"
  | "model_rerouted"
  | "session_opened"
  | "session_closed"
  | "heartbeat"
  | "connection_dropped";

export interface OperationalUsageEvent {
  eventKey: string;
  eventType: OperationalUsageEventType;
  deviceId: string;
  userId: string | null;
  reservationId: string | null;
  accountId: string;
  threadId: string | null;
  turnId: string | null;
  modelId: string | null;
  status: string | null;
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  accountUsedPercent: number | null;
  accountWindowDurationMins: number | null;
  accountResetsAt: number | null;
  observedAt: string;
}

export type SupabaseAdminKeyType = "secret" | "service_role";

interface SupabaseUser {
  id?: unknown;
  email?: unknown;
  app_metadata?: unknown;
}

interface SupabaseRequestOptions {
  method?: string;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const SUPABASE_REQUEST_TIMEOUT_MS = 15_000;
const FUTURE_JWT_RETRY_DELAY_MS = 2_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestSignal(options: SupabaseRequestOptions): AbortSignal {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? SUPABASE_REQUEST_TIMEOUT_MS);
  return options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
}

function baseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function errorMessage(value: unknown, fallback: string): string {
  const record = asRecord(value);
  return asString(record?.msg) || asString(record?.message) || fallback;
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export class SupabaseAuthClient {
  private readonly url: string;
  private readonly publishableKey: string;

  public constructor(url: string, publishableKey: string) {
    this.url = baseUrl(url);
    this.publishableKey = publishableKey.trim();
  }

  public async authenticate(token: string): Promise<SupabaseAdminIdentity | null> {
    const user = await this.authenticateUser(token);
    if (!user) return null;
    const normalizedToken = token.trim();
    const userId = user.userId;

    const query = new URLSearchParams({
      select: "role,enabled",
      user_id: `eq.${userId}`,
      limit: "1",
    });
    const adminResult = await this.request(`/rest/v1/codex_admins?${query.toString()}`, { token: normalizedToken });
    if (!adminResult.ok || !Array.isArray(adminResult.data) || adminResult.data.length !== 1) return null;
    const row = asRecord(adminResult.data[0]);
    const role = row?.role === "owner" || row?.role === "admin" ? row.role : null;
    if (!role || row?.enabled !== true) return null;

    return { userId, email: user.email, login: user.login, role };
  }

  public async authenticateUser(token: string): Promise<SupabaseUserIdentity | null> {
    const normalizedToken = token.trim();
    if (!normalizedToken) return null;
    const userResult = await this.request("/auth/v1/user", { token: normalizedToken });
    if (!userResult.ok) return null;
    const user = asRecord(userResult.data) as SupabaseUser | null;
    const userId = asString(user?.id);
    const email = asString(user?.email);
    const appMetadata = asRecord(user?.app_metadata);
    const login = asString(appMetadata?.remote_codex_login) || email || "Administrador";
    return userId ? { userId, email, login } : null;
  }

  public async queryAdmin<T = unknown>(token: string, table: string, query: Record<string, string>): Promise<T[]> {
    const params = new URLSearchParams(query);
    const result = await this.request(`/rest/v1/${table}?${params.toString()}`, { token });
    if (!result.ok || !Array.isArray(result.data)) return [];
    return result.data as T[];
  }

  public async queryAdminAll<T = unknown>(token: string, table: string, query: Record<string, string>, pageSize = 1_000, maxRows = 500_000): Promise<T[]> {
    const rows: T[] = [];
    let offset = 0;
    while (offset < maxRows) {
      const page = await this.queryAdmin<T>(token, table, {
        ...query,
        limit: String(pageSize),
        offset: String(offset),
      });
      rows.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    return rows;
  }

  public async rest(token: string, table: string, query: Record<string, string> = {}, options: SupabaseRequestOptions = {}): Promise<{ ok: boolean; status: number; data: unknown }> {
    const params = new URLSearchParams(query);
    return this.request(`/rest/v1/${table}${params.size ? `?${params.toString()}` : ""}`, { ...options, token });
  }

  private async request(path: string, options: SupabaseRequestOptions = {}): Promise<{ ok: boolean; status: number; data: unknown }> {
    const headers: Record<string, string> = {
      apikey: this.publishableKey,
      Accept: "application/json",
      ...options.headers,
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    const response = await fetch(`${this.url}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: requestSignal(options),
    });
    return { ok: response.ok, status: response.status, data: await parseResponse(response) };
  }
}

export interface DeviceSnapshotRow {
  device_id: string;
  label: string;
  account_id: string | null;
  weekly_limit_percent: number;
  user_id: string | null;
  reservation_id: string | null;
  quota_base_used_percent: number | null;
  quota_budget_percent: number | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  disabled_at: string | null;
  last_seen_at: string | null;
  status: string;
  fingerprint: string;
  usage_window_resets_at: string | null;
  observed_tokens: number;
  observed_input_tokens: number;
  observed_cached_input_tokens: number;
  observed_output_tokens: number;
  observed_reasoning_tokens: number;
  account_used_percent: number | null;
  account_window_duration_mins: number | null;
  account_resets_at: string | null;
  usage_limit_reached_at: string | null;
  usage_last_seen_at: string | null;
  stale_at: string;
}

export class SupabaseServiceClient {
  private readonly url: string;
  private readonly adminKey: string;
  private readonly adminKeyType: SupabaseAdminKeyType;

  public constructor(url: string, adminKey: string, adminKeyType: SupabaseAdminKeyType = "secret") {
    this.url = baseUrl(url);
    this.adminKey = adminKey.trim();
    this.adminKeyType = adminKeyType;
    if (!this.url || !this.adminKey) {
      throw new Error("Supabase admin client requires SUPABASE_URL and SUPABASE_SECRET_KEY.");
    }
  }

  public async inviteAdmin(email: string, createdBy: string | null): Promise<{ userId: string; email: string | null }> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error("Informe um email de administrador válido.");
    }
    const result = await this.request("/auth/v1/admin/invite", { method: "POST", body: { email: normalizedEmail } });
    const user = asRecord(result) ?? {};
    const userId = asString(user.id);
    if (!userId) throw new Error("Supabase não retornou o usuário convidado.");
    const userEmail = asString(user.email) ?? normalizedEmail;
    await this.upsertAdmin(userId, userEmail, "admin", createdBy);
    return { userId, email: userEmail };
  }

  public async createAdmin(email: string, password: string, role: "owner" | "admin", createdBy: string | null, login?: string): Promise<{ userId: string; email: string | null }> {
    const normalizedLogin = login?.normalize("NFKC").trim().toLowerCase() || "";
    const normalizedEmail = normalizedLogin ? loginEmailForUsername(normalizedLogin) : email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error("Informe um email administrativo válido.");
    if (password.length < 6) throw new Error("A senha deve ter pelo menos 6 caracteres.");
    const listed = asRecord(await this.request("/auth/v1/admin/users?per_page=1000"));
    const users = Array.isArray(listed?.users) ? listed.users : [];
    const existing = users.find((candidate) => asString(asRecord(candidate)?.email)?.toLowerCase() === normalizedEmail);
    let userId = asString(asRecord(existing)?.id);
    const body = {
      email: normalizedEmail,
      password,
      email_confirm: true,
      app_metadata: { remote_codex_role: role, ...(normalizedLogin ? { remote_codex_login: normalizedLogin } : {}) },
    };
    if (userId) await this.request(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "PUT", body });
    else userId = asString(asRecord(await this.request("/auth/v1/admin/users", { method: "POST", body }))?.id);
    if (!userId) throw new Error("Supabase não retornou o usuário administrativo.");
    await this.upsertAdmin(userId, normalizedEmail, role, createdBy);
    return { userId, email: normalizedEmail };
  }

  public async bootstrapOwner(email: string): Promise<{ userId: string; email: string | null }> {
    const normalizedEmail = email.trim().toLowerCase();
    const result = await this.request("/auth/v1/admin/users?per_page=1000");
    const users = asRecord(result)?.users;
    const user = Array.isArray(users)
      ? users.find((candidate) => asString(asRecord(candidate)?.email)?.toLowerCase() === normalizedEmail)
      : null;
    const record = asRecord(user);
    const userId = asString(record?.id);
    if (!userId) {
      throw new Error("Usuário não encontrado no Supabase Auth. Crie-o primeiro e rode o bootstrap novamente.");
    }
    const userEmail = asString(record?.email) ?? normalizedEmail;
    await this.upsertAdmin(userId, userEmail, "owner", null);
    return { userId, email: userEmail };
  }

  public async upsertEndUser(input: {
    username: string;
    loginEmail: string;
    password: string;
    groupName: string;
    weeklyQuotaPercent: number;
  }): Promise<{ userId: string }> {
    const listed = asRecord(await this.request("/auth/v1/admin/users?per_page=1000"));
    const users = Array.isArray(listed?.users) ? listed.users : [];
    const existing = users.find((candidate) => asString(asRecord(candidate)?.email)?.toLowerCase() === input.loginEmail.toLowerCase());
    let userId = asString(asRecord(existing)?.id);
    const authBody = {
      email: input.loginEmail,
      password: input.password,
      email_confirm: true,
      app_metadata: { remote_codex_role: "user" },
    };
    if (userId) {
      await this.request(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "PUT", body: authBody });
    } else {
      const created = asRecord(await this.request("/auth/v1/admin/users", { method: "POST", body: authBody }));
      userId = asString(created?.id);
    }
    if (!userId) throw new Error(`Supabase não retornou o usuário ${input.username}.`);
    await this.upsert("profiles", [{
      user_id: userId,
      username: input.username,
      group_name: input.groupName,
      weekly_quota_percent: input.weeklyQuotaPercent,
      enabled: true,
      scheduling_enabled: true,
      updated_at: new Date().toISOString(),
    }], "user_id");
    // Keep the legacy scheduling table in sync with the canonical profile row if it exists
    await this.upsert("codex_user_profiles", [{
      user_id: userId,
      username: input.username,
      login_email: input.loginEmail,
      group_name: input.groupName,
      enabled: true,
      scheduling_enabled: true,
      weekly_quota_percent: input.weeklyQuotaPercent,
      updated_at: new Date().toISOString(),
    }], "user_id").catch(() => {});
    return { userId };
  }

  private async upsertAdmin(userId: string, email: string | null, role: "owner" | "admin", createdBy: string | null): Promise<void> {
    await this.upsert("codex_admins", [{ user_id: userId, email, role, enabled: true, created_by: createdBy }], "user_id");
  }

  public async listAdmins(): Promise<Array<Record<string, unknown>>> {
    const [adminResult, authResult] = await Promise.all([
      this.request("/rest/v1/codex_admins?select=user_id,email,role,enabled,created_at,created_by&order=created_at.asc"),
      this.request("/auth/v1/admin/users?per_page=1000"),
    ]);
    const authUsers = Array.isArray(asRecord(authResult)?.users) ? asRecord(authResult)?.users as unknown[] : [];
    const authById = new Map(authUsers.map((candidate) => {
      const record = asRecord(candidate);
      return [asString(record?.id), record] as const;
    }).filter(([id]) => Boolean(id)));
    return Array.isArray(adminResult) ? adminResult.flatMap((candidate) => {
      const row = asRecord(candidate);
      const userId = asString(row?.user_id);
      if (!row || !userId) return [];
      const authUser = authById.get(userId);
      const metadata = asRecord(authUser?.app_metadata);
      return [{
        ...row,
        login: asString(metadata?.remote_codex_login) || asString(authUser?.email) || asString(row.email),
        last_sign_in_at: asString(authUser?.last_sign_in_at),
        auth_created_at: asString(authUser?.created_at),
      }];
    }) : [];
  }

  public async setAdminEnabled(userId: string, enabled: boolean): Promise<Record<string, unknown>> {
    const admins = await this.listAdmins();
    const target = admins.find((admin) => asString(admin.user_id) === userId);
    if (!target) throw new Error("Administrador não encontrado.");
    if (target.role === "owner") throw new Error("O owner não pode ser desabilitado por este painel.");
    await this.request(`/rest/v1/codex_admins?user_id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: { enabled },
      headers: { Prefer: "return=minimal" },
    });
    return { ...target, enabled };
  }

  public async upsertAccountSnapshots(accounts: AccountSnapshot[]): Promise<void> {
    if (accounts.length === 0) return;
    await this.upsert("codex_account_snapshots", accounts.map((account) => ({
      account_id: account.accountId,
      label: account.label,
      email: account.email,
      plan_type: account.planType,
      auth_mode: account.authMode,
      status: account.status,
      is_default: account.isDefault,
      updated_at: account.updatedAt,
      rate_limits: account.rateLimits,
      usage: account.usage,
      error: account.error,
      observed_at: new Date().toISOString(),
    })), "account_id");
  }

  public async upsertDeviceSnapshots(devices: RelayDevice[]): Promise<void> {
    if (devices.length === 0) return;
    const now = new Date().toISOString();
    const rows = devices.map((device) => ({
      device_id: device.deviceId,
      label: device.label,
      account_id: device.accountId ?? null,
      weekly_limit_percent: device.weeklyLimitPercent ?? 100,
      user_id: device.userId ?? null,
      reservation_id: device.reservationId ?? null,
      quota_base_used_percent: device.quotaBaseUsedPercent ?? null,
      quota_budget_percent: device.quotaBudgetPercent ?? null,
      created_at: device.createdAt,
      expires_at: device.expiresAt,
      revoked_at: device.revokedAt,
      disabled_at: device.disabledAt,
      last_seen_at: device.lastSeenAt,
      status: device.revokedAt
        ? "revoked"
        : device.disabledAt
          ? "disabled"
          : Date.parse(device.expiresAt) <= Date.now()
            ? "expired"
            : device.usage?.usageLimitReachedAt
              ? "limited"
              : "active",
      fingerprint: device.tokenHash.slice(0, 12),
      usage_window_resets_at: device.usage?.windowResetsAt ?? null,
      observed_tokens: device.usage?.observedTokens ?? 0,
      observed_input_tokens: device.usage?.observedInputTokens ?? 0,
      observed_cached_input_tokens: device.usage?.observedCachedInputTokens ?? 0,
      observed_output_tokens: device.usage?.observedOutputTokens ?? 0,
      observed_reasoning_tokens: device.usage?.observedReasoningTokens ?? 0,
      account_used_percent: device.usage?.accountUsedPercent ?? null,
      account_window_duration_mins: device.usage?.accountWindowDurationMins ?? null,
      account_resets_at: device.usage?.accountResetsAt ? new Date(device.usage.accountResetsAt * 1_000).toISOString() : null,
      usage_limit_reached_at: device.usage?.usageLimitReachedAt ?? null,
      usage_last_seen_at: device.usage?.lastUsageAt ?? null,
      stale_at: now,
    }));
    const failures: Error[] = [];
    for (const row of rows) {
      try {
        await this.upsert("codex_device_snapshots", [row], "device_id");
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        if (failure.message.includes("codex_device_snapshots_user_id_fkey") || failure.message.includes("codex_device_snapshots_reservation_id_fkey")) {
          try {
            // Historical local registries can outlive deleted Auth users or
            // reservations. Keep their operational state without an invalid
            // foreign-key link, so they cannot block valid token updates.
            await this.upsert("codex_device_snapshots", [{ ...row, user_id: null, reservation_id: null }], "device_id");
            continue;
          } catch (retryError) {
            failures.push(retryError instanceof Error ? retryError : new Error(String(retryError)));
            continue;
          }
        }
        failures.push(failure);
      }
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} snapshot(s) de dispositivo não foram sincronizados: ${failures[0]?.message}`);
    }
  }

  public async expireOverdueReservations(now = new Date()): Promise<string[]> {
    const overdueResult = await this.request(
      `/rest/v1/codex_reservations?select=id,ends_at&approval_status=eq.pending&ends_at=lte.${encodeURIComponent(now.toISOString())}&order=ends_at.asc`
    );
    const rows = Array.isArray(overdueResult) ? overdueResult as Array<Record<string, unknown>> : [];
    const expiredIds: string[] = [];
    for (const row of rows) {
      const id = typeof row.id === "string" ? row.id : null;
      const endsAt = typeof row.ends_at === "string" ? row.ends_at : now.toISOString();
      if (!id) continue;
      try {
        await this.request(`/rest/v1/codex_reservations?id=eq.${encodeURIComponent(id)}&approval_status=eq.pending`, {
          method: "PATCH",
          body: {
            approval_status: "expired",
            status: "cancelled",
            cancelled_at: endsAt,
          },
          headers: { Prefer: "return=minimal" },
        });
        expiredIds.push(id);
        await this.audit(null, "reservation.expire", "reservation", id, { reason: "schedule_ended", ends_at: endsAt });
      } catch (error) {
        console.error(`[supabase] Falha ao expirar reserva ${id}:`, error);
      }
    }
    return expiredIds;
  }

  public async insertAccountUsageSamples(accounts: AccountSnapshot[], now = new Date()): Promise<void> {
    if (accounts.length === 0) return;
    const nowIso = now.toISOString();
    const rows = accounts.map((account) => {
      const windows = Object.values(account.rateLimits || {}).flatMap((limit) => [limit.primary, limit.secondary]).filter((w): w is NonNullable<typeof w> => Boolean(w));
      const primaryWindow = windows.sort((a, b) => (b.windowDurationMins ?? 0) - (a.windowDurationMins ?? 0))[0];
      return {
        account_id: account.accountId,
        status: account.status,
        rate_limits: account.rateLimits ?? {},
        usage: account.usage ?? null,
        used_percent: primaryWindow?.usedPercent ?? null,
        window_duration_mins: primaryWindow?.windowDurationMins ?? null,
        resets_at: primaryWindow?.resetsAt ? new Date(primaryWindow.resetsAt * 1_000).toISOString() : null,
        observed_at: nowIso,
      };
    });
    await this.upsert("codex_account_usage_samples", rows);
  }

  public async upsertOperationalUsageEvent(event: OperationalUsageEvent): Promise<void> {
    await this.upsert("codex_usage_events", [{
      event_key: event.eventKey,
      event_type: event.eventType,
      device_id: event.deviceId,
      user_id: event.userId,
      reservation_id: event.reservationId,
      account_id: event.accountId,
      thread_id: event.threadId,
      turn_id: event.turnId,
      model_id: event.modelId,
      status: event.status,
      thread_total_tokens: event.totalTokens,
      thread_input_tokens: event.inputTokens,
      thread_cached_input_tokens: event.cachedInputTokens,
      thread_output_tokens: event.outputTokens,
      thread_reasoning_tokens: event.reasoningTokens,
      account_used_percent: event.accountUsedPercent,
      account_window_duration_mins: event.accountWindowDurationMins,
      account_resets_at: event.accountResetsAt ? new Date(event.accountResetsAt * 1_000).toISOString() : null,
      observed_at: event.observedAt,
    }], "event_key");
  }

  public async audit(actorUserId: string | null, action: string, targetType: string, targetId: string | null, metadata: Record<string, unknown> = {}): Promise<void> {
    await this.upsert("codex_admin_audit", [{
      actor_user_id: actorUserId,
      action,
      target_type: targetType,
      target_id: targetId,
      metadata,
    }], undefined);
  }

  public async upsert(table: string, rows: unknown[], conflictColumn?: string): Promise<void> {
    if (rows.length === 0) return;
    const query = conflictColumn ? `?on_conflict=${encodeURIComponent(conflictColumn)}` : "";
    await this.request(`/rest/v1/${table}${query}`, {
      method: "POST",
      body: rows,
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    });
  }

  public async rest(table: string, query: Record<string, string> = {}, options: SupabaseRequestOptions = {}): Promise<{ ok: boolean; status: number; data: unknown }> {
    const params = new URLSearchParams(query);
    const path = `/rest/v1/${table}${params.size ? `?${params.toString()}` : ""}`;
    const response = await fetch(`${this.url}${path}`, {
      method: options.method ?? "GET",
      headers: {
        apikey: this.adminKey,
        Accept: "application/json",
        ...(this.adminKeyType === "service_role" || this.adminKey.startsWith("eyJ") ? { Authorization: `Bearer ${this.adminKey}` } : {}),
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: requestSignal(options),
    });
    return { ok: response.ok, status: response.status, data: await parseResponse(response) };
  }

  public async request(path: string, options: SupabaseRequestOptions = {}): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${this.url}${path}`, {
        method: options.method ?? "GET",
        headers: {
          apikey: this.adminKey,
          Accept: "application/json",
          ...(this.adminKeyType === "service_role" || this.adminKey.startsWith("eyJ") ? { Authorization: `Bearer ${this.adminKey}` } : {}),
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...options.headers,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: requestSignal(options),
      });
      const data = await parseResponse(response);
      if (response.ok) return data;

      const message = errorMessage(data, "request failed");
      if (attempt === 0 && response.status === 401 && /jwt issued at future/i.test(message)) {
        await delay(FUTURE_JWT_RETRY_DELAY_MS);
        continue;
      }
      throw new Error(`Supabase request failed (${response.status}): ${message}`);
    }
    throw new Error("Supabase request failed after retry.");
  }
}

export function accountSnapshotFromRow(row: Record<string, unknown>): AccountSnapshot | null {
  const accountId = asString(row.account_id);
  const label = asString(row.label);
  if (!accountId || !label) return null;
  return {
    accountId,
    label,
    email: asString(row.email),
    planType: asString(row.plan_type),
    authMode: asString(row.auth_mode),
    status: row.status === "ready" || row.status === "login_required" || row.status === "offline" || row.status === "disabled" || row.status === "error" ? row.status : "offline",
    isDefault: row.is_default === true,
    updatedAt: asString(row.updated_at),
    rateLimits: asRecord(row.rate_limits) as AccountSnapshot["rateLimits"] ?? {},
    usage: asRecord(row.usage) as AccountSnapshot["usage"] ?? null,
    error: asString(row.error),
  };
}
