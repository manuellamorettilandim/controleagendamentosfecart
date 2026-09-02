export interface AuthSession {
  access_token: string;
  refresh_token: string;
  user: unknown;
  expires_at: number | null;
}

export interface AuthConfig {
  provider: "local" | "supabase";
  supabaseUrl?: string;
  publishableKey?: string;
}

export interface AuthGateway {
  clearSession: () => void;
  getSession: () => AuthSession | null;
  loadConfig: () => Promise<AuthConfig>;
  passwordLogin: (config: AuthConfig, email: string, password: string) => Promise<AuthSession>;
  persistSession: (data: Partial<AuthSession>, previous?: AuthSession | null) => AuthSession;
  refreshSession: (config: AuthConfig) => Promise<AuthSession>;
  signOut: (config: AuthConfig) => Promise<void>;
}

const STORAGE_KEY = "remote_codex_admin_session";
const LEGACY_ACCESS_KEY = "remote_codex_admin_access";
const LEGACY_USER_KEY = "remote_codex_admin_user";

type JsonRecord = Record<string, unknown>;

function readJson<T>(storage: Storage, key: string): T | null {
  try {
    const value = storage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getSession(): AuthSession | null {
  const stored = readJson<Partial<AuthSession>>(window.localStorage, STORAGE_KEY);
  if (stored && stringValue(stored.access_token)) {
    return {
      access_token: stringValue(stored.access_token),
      refresh_token: stringValue(stored.refresh_token),
      user: stored.user ?? null,
      expires_at: typeof stored.expires_at === "number" ? stored.expires_at : null,
    };
  }

  const legacyAccessToken = window.sessionStorage.getItem(LEGACY_ACCESS_KEY) || "";
  if (!legacyAccessToken) return null;
  const migrated: AuthSession = {
    access_token: legacyAccessToken,
    refresh_token: "",
    user: readJson(window.sessionStorage, LEGACY_USER_KEY),
    expires_at: null,
  };
  persistSession(migrated, null);
  return migrated;
}

function persistSession(data: Partial<AuthSession>, previous: AuthSession | null = null): AuthSession {
  const session: AuthSession = {
    access_token: stringValue(data.access_token) || previous?.access_token || "",
    refresh_token: stringValue(data.refresh_token) || previous?.refresh_token || "",
    user: data.user ?? previous?.user ?? null,
    expires_at: typeof data.expires_at === "number" ? data.expires_at : previous?.expires_at ?? null,
  };
  if (!session.access_token) throw new Error("O serviço de autenticação não retornou uma sessão válida.");
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  return session;
}

function clearSession(): void {
  window.localStorage.removeItem(STORAGE_KEY);
  window.sessionStorage.removeItem(LEGACY_ACCESS_KEY);
  window.sessionStorage.removeItem(LEGACY_USER_KEY);
}

async function loadConfig(): Promise<AuthConfig> {
  const response = await fetch("/api/admin/config", { cache: "no-store" });
  const data = (await response.json().catch(() => ({}))) as JsonRecord;
  const provider = data.provider === "local" ? "local" : "supabase";
  const supabaseUrl = stringValue(data.supabaseUrl);
  const publishableKey = stringValue(data.publishableKey);
  if (!response.ok || (provider === "supabase" && (!supabaseUrl || !publishableKey))) {
    throw new Error(stringValue(data.error) || "O serviço de autenticação não está configurado no relay.");
  }
  return { provider, supabaseUrl: supabaseUrl || undefined, publishableKey: publishableKey || undefined };
}

async function passwordLogin(config: AuthConfig, email: string, password: string): Promise<AuthSession> {
  const endpoint = config.provider === "local" ? "/api/auth/token?grant_type=password" : `${config.supabaseUrl}/auth/v1/token?grant_type=password`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { ...(config.provider === "supabase" ? { apikey: config.publishableKey ?? "" } : {}), "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = (await response.json().catch(() => ({}))) as JsonRecord;
  if (!response.ok || !stringValue(data.access_token)) {
    throw new Error(stringValue(data.error_description) || stringValue(data.msg) || "Não foi possível entrar.");
  }
  return persistSession({
    access_token: stringValue(data.access_token),
    refresh_token: stringValue(data.refresh_token),
    user: data.user ?? null,
    expires_at: typeof data.expires_at === "number" ? data.expires_at : null,
  });
}

async function refreshSession(config: AuthConfig): Promise<AuthSession> {
  const current = getSession();
  if (!current?.refresh_token) throw new Error("A sessão não possui refresh token.");
  const endpoint = config.provider === "local" ? "/api/auth/token?grant_type=refresh_token" : `${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { ...(config.provider === "supabase" ? { apikey: config.publishableKey ?? "" } : {}), "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: current.refresh_token }),
  });
  const data = (await response.json().catch(() => ({}))) as JsonRecord;
  if (!response.ok || !stringValue(data.access_token)) {
    clearSession();
    throw new Error(stringValue(data.error_description) || stringValue(data.msg) || "A sessão expirou.");
  }
  return persistSession(
    {
      access_token: stringValue(data.access_token),
      refresh_token: stringValue(data.refresh_token),
      user: data.user ?? null,
      expires_at: typeof data.expires_at === "number" ? data.expires_at : null,
    },
    current,
  );
}

async function signOut(config: AuthConfig): Promise<void> {
  const current = getSession();
  try {
    if (current?.access_token) {
      const endpoint = config.provider === "local" ? "/api/auth/logout" : `${config.supabaseUrl}/auth/v1/logout`;
      await fetch(endpoint, {
        method: "POST",
        headers: { ...(config.provider === "supabase" ? { apikey: config.publishableKey ?? "" } : {}), Authorization: `Bearer ${current.access_token}` },
      });
    }
  } catch {
    // A sessão local inválida ainda precisa ser removida.
  } finally {
    clearSession();
  }
}

export const authGateway: AuthGateway = {
  clearSession,
  getSession,
  loadConfig,
  passwordLogin,
  persistSession,
  refreshSession,
  signOut,
};

declare global {
  interface Window {
    RemoteCodexAuth?: AuthGateway;
  }
}

