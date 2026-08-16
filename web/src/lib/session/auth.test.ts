import { beforeEach, describe, expect, it } from "vitest";
import { authGateway } from "./auth";

describe("auth session storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
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
});
