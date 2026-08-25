import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { SupabaseServiceClient } from "../src/supabase.js";

test("Supabase secret keys use only the apikey header, while legacy keys keep compatibility", async () => {
  const seen: Array<{ apikey?: string; authorization?: string }> = [];
  const server = http.createServer((request, response) => {
    seen.push({ apikey: request.headers.apikey?.toString(), authorization: request.headers.authorization?.toString() });
    response.setHeader("Content-Type", "application/json");
    response.end(request.url?.startsWith("/auth/v1/admin/users") ? JSON.stringify({ users: [] }) : "[]");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    await new SupabaseServiceClient(`http://127.0.0.1:${address.port}`, "sb_secret_test", "secret").listAdmins();
    await new SupabaseServiceClient(`http://127.0.0.1:${address.port}`, "legacy_service_role_test", "service_role").listAdmins();
    assert.deepEqual(seen, [
      { apikey: "sb_secret_test", authorization: undefined },
      { apikey: "sb_secret_test", authorization: undefined },
      { apikey: "legacy_service_role_test", authorization: "Bearer legacy_service_role_test" },
      { apikey: "legacy_service_role_test", authorization: "Bearer legacy_service_role_test" },
    ]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Supabase service requests retry a transient future-issued JWT rejection", async () => {
  let attempts = 0;
  const server = http.createServer((_request, response) => {
    attempts += 1;
    response.setHeader("Content-Type", "application/json");
    if (attempts === 1) {
      response.statusCode = 401;
      response.end(JSON.stringify({ message: "JWT issued at future" }));
      return;
    }
    response.end("[]");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const client = new SupabaseServiceClient(`http://127.0.0.1:${address.port}`, "sb_secret_test", "secret");
    assert.deepEqual(await client.request("/rest/v1/codex_account_snapshots"), []);
    assert.equal(attempts, 2);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("listAdmins enriches privileged users with secure login and last access metadata", async () => {
  const server = http.createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url?.startsWith("/auth/v1/admin/users")) {
      response.end(JSON.stringify({ users: [{
        id: "owner-1",
        email: "owner@example.com",
        app_metadata: { remote_codex_login: "owner.login" },
        last_sign_in_at: "2026-08-15T12:00:00.000Z",
        created_at: "2026-08-01T12:00:00.000Z",
      }] }));
      return;
    }
    response.end(JSON.stringify([{ user_id: "owner-1", email: "owner@example.com", role: "owner", enabled: true }]));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const admins = await new SupabaseServiceClient(`http://127.0.0.1:${address.port}`, "sb_secret_test", "secret").listAdmins();
    assert.equal(admins[0]?.login, "owner.login");
    assert.equal(admins[0]?.last_sign_in_at, "2026-08-15T12:00:00.000Z");
    assert.equal(admins[0]?.auth_created_at, "2026-08-01T12:00:00.000Z");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("device snapshot sync isolates orphaned foreign keys without blocking valid devices", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const server = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk.toString(); });
    request.on("end", () => {
      const rows = JSON.parse(raw) as Array<Record<string, unknown>>;
      bodies.push(rows[0] ?? {});
      response.setHeader("Content-Type", "application/json");
      if (rows[0]?.user_id === "missing-user") {
        response.statusCode = 409;
        response.end(JSON.stringify({ message: "violates foreign key constraint codex_device_snapshots_user_id_fkey" }));
        return;
      }
      response.end("[]");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const base = {
      tokenHash: "a".repeat(64),
      createdAt: "2026-08-15T12:00:00.000Z",
      expiresAt: "2026-08-15T16:00:00.000Z",
      revokedAt: null,
      disabledAt: null,
      lastSeenAt: null,
    };
    await new SupabaseServiceClient(`http://127.0.0.1:${address.port}`, "sb_secret_test", "secret").upsertDeviceSnapshots([
      { ...base, deviceId: "orphan", label: "Orphan", userId: "missing-user", reservationId: "missing-reservation" },
      { ...base, deviceId: "valid", label: "Valid", userId: "valid-user", reservationId: "valid-reservation", revokedAt: "2026-08-15T13:00:00.000Z" },
    ]);
    assert.equal(bodies.length, 3);
    assert.equal(bodies[1]?.device_id, "orphan");
    assert.equal(bodies[1]?.user_id, null);
    assert.equal(bodies[2]?.device_id, "valid");
    assert.equal(bodies[2]?.status, "revoked");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
