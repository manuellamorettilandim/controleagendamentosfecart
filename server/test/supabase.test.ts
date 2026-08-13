import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { SupabaseServiceClient } from "../src/supabase.js";

test("Supabase secret keys use only the apikey header, while legacy keys keep compatibility", async () => {
  const seen: Array<{ apikey?: string; authorization?: string }> = [];
  const server = http.createServer((request, response) => {
    seen.push({ apikey: request.headers.apikey?.toString(), authorization: request.headers.authorization?.toString() });
    response.setHeader("Content-Type", "application/json");
    response.end("[]");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    await new SupabaseServiceClient(`http://127.0.0.1:${address.port}`, "sb_secret_test", "secret").listAdmins();
    await new SupabaseServiceClient(`http://127.0.0.1:${address.port}`, "legacy_service_role_test", "service_role").listAdmins();
    assert.deepEqual(seen, [
      { apikey: "sb_secret_test", authorization: undefined },
      { apikey: "legacy_service_role_test", authorization: "Bearer legacy_service_role_test" },
    ]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
