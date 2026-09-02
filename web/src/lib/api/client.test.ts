import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ApiClient", () => {
  it("redirects to login when there is no user session", async () => {
    const redirect = vi.fn();
    const fetcher = vi.fn();
    const api = createApiClient({
      auth: { getSession: () => null },
      fetcher,
      redirect,
    });

    await expect(api.user("/api/user")).rejects.toThrow("Sessão ausente.");
    expect(redirect).toHaveBeenCalledWith("/login");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refreshes a session once and retries a rejected user request", async () => {
    let accessToken = "expired-token";
    const refreshSession = vi.fn(async () => {
      accessToken = "fresh-token";
      return { access_token: accessToken, refresh_token: "refresh-token", user: null, expires_at: null };
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({ reservations: [] }));
    const api = createApiClient({
      auth: {
        getSession: () => ({ access_token: accessToken, refresh_token: "refresh-token", user: null, expires_at: null }),
        refreshSession,
      },
      fetcher,
    });

    await expect(api.user("/api/user/reservations", {}, true, {
      provider: "supabase",
      supabaseUrl: "https://example.supabase.co",
      publishableKey: "public-key",
    })).resolves.toEqual({ reservations: [] });

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new Headers((fetcher.mock.calls[0][1] as RequestInit).headers).get("Authorization")).toBe("Bearer expired-token");
    expect(new Headers((fetcher.mock.calls[1][1] as RequestInit).headers).get("Authorization")).toBe("Bearer fresh-token");
  });

  it("uses the current access token for admin requests", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const api = createApiClient({
      auth: { getSession: () => ({ access_token: "admin-token", refresh_token: "", user: null, expires_at: null }) },
      fetcher,
    });

    await expect(api.admin("/api/admin/accounts")).resolves.toEqual({ ok: true });
    expect(new Headers((fetcher.mock.calls[0][1] as RequestInit).headers).get("Authorization")).toBe("Bearer admin-token");
  });
});
