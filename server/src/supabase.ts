import type { AccountSnapshot, RelayDevice } from "./protocol.js";

export interface SupabaseAdminIdentity {
  userId: string;
  email: string | null;
  role: "owner" | "admin";
}

export interface SupabaseUserIdentity {
  userId: string;
  email: string | null;
}

export type SupabaseAdminKeyType = "secret" | "service_role";

interface SupabaseUser {
  id?: unknown;
  email?: unknown;
}

interface SupabaseRequestOptions {
  method?: string;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
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

    return { userId, email: user.email, role };
  }

  public async authenticateUser(token: string): Promise<SupabaseUserIdentity | null> {
    const normalizedToken = token.trim();
    if (!normalizedToken) return null;
    const userResult = await this.request("/auth/v1/user", { token: normalizedToken });
    if (!userResult.ok) return null;
    const user = asRecord(userResult.data) as SupabaseUser | null;
    const userId = asString(user?.id);
    return userId ? { userId, email: asString(user?.email) } : null;
  }

  public async queryAdmin<T = unknown>(token: string, table: string, query: Record<string, string>): Promise<T[]> {
    const params = new URLSearchParams(query);
    const result = await this.request(`/rest/v1/${table}?${params.toString()}`, { token });
    if (!result.ok || !Array.isArray(result.data)) return [];
    return result.data as T[];
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
    accountId: string;
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
    await this.upsert("codex_user_profiles", [{
      user_id: userId,
      username: input.username,
      login_email: input.loginEmail,
      group_name: input.groupName,
      enabled: true,
      account_id: input.accountId,
      weekly_quota_percent: input.weeklyQuotaPercent,
      updated_at: new Date().toISOString(),
    }], "user_id");
    return { userId };
  }

  private async upsertAdmin(userId: string, email: string | null, role: "owner" | "admin", createdBy: string | null): Promise<void> {
    await this.upsert("codex_admins", [{ user_id: userId, email, role, enabled: true, created_by: createdBy }], "user_id");
  }

  public async listAdmins(): Promise<Array<Record<string, unknown>>> {
    const result = await this.request("/rest/v1/codex_admins?select=user_id,email,role,enabled,created_at,created_by&order=created_at.asc");
    return Array.isArray(result) ? result.filter((row): row is Record<string, unknown> => Boolean(asRecord(row))) : [];
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
    await this.upsert("codex_device_snapshots", devices.map((device) => ({
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
    })), "device_id");
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

  private async request(path: string, options: SupabaseRequestOptions = {}): Promise<unknown> {
    const response = await fetch(`${this.url}${path}`, {
      method: options.method ?? "GET",
      headers: {
        apikey: this.adminKey,
        Accept: "application/json",
        ...(this.adminKeyType === "service_role" ? { Authorization: `Bearer ${this.adminKey}` } : {}),
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const data = await parseResponse(response);
    if (!response.ok) {
      throw new Error(`Supabase request failed (${response.status}): ${errorMessage(data, "request failed")}`);
    }
    return data;
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
