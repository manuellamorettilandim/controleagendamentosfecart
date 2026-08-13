(() => {
  "use strict";

  const STORAGE_KEY = "remote_codex_admin_session";
  const LEGACY_ACCESS_KEY = "remote_codex_admin_access";
  const LEGACY_USER_KEY = "remote_codex_admin_user";

  function readJson(storage, key) {
    try {
      const value = storage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  function getSession() {
    const stored = readJson(window.localStorage, STORAGE_KEY);
    if (stored && typeof stored.access_token === "string" && stored.access_token) return stored;

    const legacyAccessToken = window.sessionStorage.getItem(LEGACY_ACCESS_KEY) || "";
    if (!legacyAccessToken) return null;
    const migrated = {
      access_token: legacyAccessToken,
      refresh_token: "",
      user: readJson(window.sessionStorage, LEGACY_USER_KEY),
    };
    persistSession(migrated);
    return migrated;
  }

  function persistSession(data, previous = getSession()) {
    const session = {
      access_token: data.access_token || previous?.access_token || "",
      refresh_token: data.refresh_token || previous?.refresh_token || "",
      user: data.user || previous?.user || null,
      expires_at: data.expires_at || previous?.expires_at || null,
    };
    if (!session.access_token) throw new Error("Supabase não retornou uma sessão válida.");
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    return session;
  }

  function clearSession() {
    window.localStorage.removeItem(STORAGE_KEY);
    window.sessionStorage.removeItem(LEGACY_ACCESS_KEY);
    window.sessionStorage.removeItem(LEGACY_USER_KEY);
  }

  async function loadConfig() {
    const response = await fetch("/api/admin/config", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.supabaseUrl || !data.publishableKey) {
      throw new Error(data.error || "Supabase Auth não está configurado no relay.");
    }
    return data;
  }

  async function passwordLogin(config, email, password) {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: config.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      throw new Error(data.error_description || data.msg || "Não foi possível entrar.");
    }
    return persistSession(data, null);
  }

  async function refreshSession(config) {
    const current = getSession();
    if (!current?.refresh_token) throw new Error("A sessão não possui refresh token.");
    const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: config.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: current.refresh_token }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      clearSession();
      throw new Error(data.error_description || data.msg || "A sessão expirou.");
    }
    return persistSession(data, current);
  }

  async function signOut(config) {
    const current = getSession();
    try {
      if (current?.access_token) {
        await fetch(`${config.supabaseUrl}/auth/v1/logout`, {
          method: "POST",
          headers: { apikey: config.publishableKey, Authorization: `Bearer ${current.access_token}` },
        });
      }
    } catch {
      // The local session must still be cleared if Supabase is temporarily unavailable.
    } finally {
      clearSession();
    }
  }

  window.RemoteCodexAuth = { clearSession, getSession, loadConfig, passwordLogin, persistSession, refreshSession, signOut };
})();
