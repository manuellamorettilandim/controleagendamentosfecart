import assert from "node:assert/strict";
import test from "node:test";

import { codexChildEnvironment } from "../src/codex-child-env.js";
import { relayOptionsFromEnvironment } from "../src/relay.js";

test("Codex subprocess environments exclude host credentials", () => {
  const previousSecret = process.env.SUPABASE_SECRET_KEY;
  const previousToken = process.env.RELAY_AGENT_TOKEN;
  process.env.SUPABASE_SECRET_KEY = "host-secret";
  process.env.RELAY_AGENT_TOKEN = "host-relay-token";

  try {
    const environment = codexChildEnvironment({ CODEX_HOME: "C:/isolated/account", FECART_DEVICE_ID: "device-1" });
    assert.equal(environment.SUPABASE_SECRET_KEY, undefined);
    assert.equal(environment.RELAY_AGENT_TOKEN, undefined);
    assert.equal(environment.CODEX_HOME, "C:/isolated/account");
    assert.equal(environment.FECART_DEVICE_ID, "device-1");
  } finally {
    if (previousSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previousSecret;
    if (previousToken === undefined) delete process.env.RELAY_AGENT_TOKEN;
    else process.env.RELAY_AGENT_TOKEN = previousToken;
  }
});

test("relay environment rejects privileged Supabase keys", () => {
  assert.throws(
    () => relayOptionsFromEnvironment({
      RELAY_AGENT_TOKEN_SHA256: "a".repeat(64),
      SUPABASE_SECRET_KEY: "host-secret",
    }),
    /host central, nunca no relay/i,
  );
});
