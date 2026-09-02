import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authGateway } from "./auth";

describe("auth session storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists and reads the normalized session shape", () => {
    authGateway.persistSession({
      access_token: "access-token",
      refresh_token: "refresh-token",
      user: { id: "user-1" },
      expires_at: 123,
    });

    expect(authGateway.getSession()).toEqual({
      access_token: "access-token",
      refresh_token: "refresh-token",
      user: { id: "user-1" },
      expires_at: 123,
    });
  });

  it("migrates the legacy session storage keys", () => {
    window.sessionStorage.setItem("remote_codex_admin_access", "legacy-token");
    window.sessionStorage.setItem("remote_codex_admin_user", JSON.stringify({ id: "legacy-user" }));

    expect(authGateway.getSession()).toEqual({
      access_token: "legacy-token",
      refresh_token: "",
      user: { id: "legacy-user" },
      expires_at: null,
    });
    expect(window.localStorage.getItem("remote_codex_admin_session")).toContain("legacy-token");
  });

  it("uses same-origin endpoints for local PostgreSQL authentication", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ provider: "local" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "local-access",
        refresh_token: "local-refresh",
        user: { id: "user-1" },
        expires_at: 456,
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    const config = await authGateway.loadConfig();
    await authGateway.passwordLogin(config, "owner@example.com", "strong-password");

    expect(config).toEqual({ provider: "local", supabaseUrl: undefined, publishableKey: undefined });
    expect(fetcher.mock.calls[1][0]).toBe("/api/auth/token?grant_type=password");
    expect(new Headers(fetcher.mock.calls[1][1].headers).has("apikey")).toBe(false);
  });
});
