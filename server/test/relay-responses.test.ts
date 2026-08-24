import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocketServer } from "ws";

import { AccessStore } from "../src/access-store.js";
import { AccountStore } from "../src/account-store.js";
import { hashToken } from "../src/crypto.js";
import { HostAgent, hostConfigFromEnvironment } from "../src/host-agent.js";
import { RelayServer } from "../src/relay.js";

const agentToken = "agent-secret-for-responses-test";

function waitForReady(relay: RelayServer): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (relay.status().ready) {
        resolve();
        return;
      }
      if (Date.now() - started > 5_000) {
        reject(new Error("Host agent did not synchronize with relay"));
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

test("Relay routes POST /api/codex/v1/responses to HostAgent and streams SSE back", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "remote-codex-responses-"));
  const codexHome = path.join(directory, "codex-home");
  await fs.mkdir(codexHome, { recursive: true });

  // Write valid auth.json in primary account
  await fs.writeFile(
    path.join(codexHome, "auth.json"),
    JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        access_token: "mock_chatgpt_token",
        account_id: "acct_test_primary",
      },
    }),
    "utf8"
  );

  const accountStore = new AccountStore(path.join(directory, "accounts.json"), path.join(directory, "accounts"));
  const accessStore = new AccessStore(path.join(codexHome, "remote-access.json"));
  const issued = await accessStore.issue("test-device", 60 * 60_000, new Date(), {
    accountId: "primary",
    allowedModels: ["gpt-5.6-sol", "gpt-5.4-mini"],
  });

  // Mock fake app-server for control connection
  const fakeAppServer = new WebSocketServer({ port: 0 });
  fakeAppServer.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
      let message: { id?: number; method?: string } = {};
      try { message = JSON.parse(text) as { id?: number; method?: string }; } catch { /* ignore */ }
      if (message.method === "initialize" && typeof message.id === "number") {
        socket.send(JSON.stringify({ id: message.id, result: {} }));
        return;
      }
      if (message.method === "account/read" && typeof message.id === "number") {
        socket.send(JSON.stringify({ id: message.id, result: { account: { type: "chatgpt", email: "test@example.com", planType: "plus" } } }));
        return;
      }
      if (message.method === "account/rateLimits/read" && typeof message.id === "number") {
        socket.send(JSON.stringify({ id: message.id, result: { rateLimitsByLimitId: {
          primary: {
            limitId: "primary",
            limitName: "Codex",
            primary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: 1800000000 },
          }
        } } }));
        return;
      }
      if (message.method === "account/usage/read" && typeof message.id === "number") {
        socket.send(JSON.stringify({ id: message.id, result: { summary: {}, dailyUsageBuckets: [] } }));
        return;
      }
    });
  });
  await new Promise<void>((resolve) => fakeAppServer.once("listening", () => resolve()));
  const appPort = (fakeAppServer.address() as { port: number }).port;

  // Mock upstream ChatGPT responses endpoint
  let upstreamHeaders: http.IncomingHttpHeaders | null = null;
  const mockUpstream = http.createServer((req, res) => {
    upstreamHeaders = req.headers;
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
    res.write("event: response.created\ndata: {\"response\": {\"id\": \"resp_e2e_1\"}}\n\n");
    res.write("event: response.completed\ndata: {\"response\": {\"id\": \"resp_e2e_1\", \"model\": \"gpt-5.6-sol\", \"usage\": {\"total_tokens\": 75, \"input_tokens\": 50, \"output_tokens\": 25}}}\n\n");
    res.write("data: [DONE]\n\n");
    res.end();
  });
  await new Promise<void>((resolve) => mockUpstream.listen(0, "127.0.0.1", () => resolve()));
  const upstreamPort = (mockUpstream.address() as { port: number }).port;
  const upstreamUrl = `http://127.0.0.1:${upstreamPort}/backend-api/codex/responses`;

  const relay = new RelayServer({
    agentTokenHash: hashToken(agentToken),
    host: "127.0.0.1",
    port: 0,
    siteDir: "site",
    heartbeatTimeoutMs: 5_000,
  });
  await relay.listen();
  const relayAddress = relay.address() as { port: number };

  let agent: HostAgent | undefined;
  try {
    const config = hostConfigFromEnvironment({
      ...process.env,
      CODEX_HOME: codexHome,
      RELAY_URL: `ws://127.0.0.1:${relayAddress.port}`,
      RELAY_AGENT_TOKEN: agentToken,
      RELAY_HOST_ID: "host-test-responses",
      HOST_SKIP_APP_SERVER: "1",
      APP_SERVER_PORT: String(appPort),
      CODEX_APP_SERVER_TOKEN_FILE: path.join(codexHome, "app-server.token"),
      CODEX_ACCOUNT_REGISTRY: path.join(directory, "accounts.json"),
      CODEX_ACCOUNTS_DIR: path.join(directory, "accounts"),
      CODEX_OAUTH_RESPONSES_URL: upstreamUrl,
    });

    agent = new HostAgent(config, accessStore, accountStore);
    await agent.start();
    await waitForReady(relay);

    // 1. Send valid request to POST /api/codex/v1/responses
    const response = await fetch(`http://127.0.0.1:${relayAddress.port}/api/codex/v1/responses`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${issued.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.6-sol",
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");

    const bodyText = await response.text();
    assert.equal(bodyText.includes("resp_e2e_1"), true);
    assert.equal(bodyText.includes("[DONE]"), true);
    assert.equal(upstreamHeaders?.["authorization"], "Bearer mock_chatgpt_token");
    assert.equal(upstreamHeaders?.["originator"], "codex_cli_rs");

    // Wait a brief tick for usage to persist in AccessStore
    await new Promise((r) => setTimeout(r, 100));

    const updatedDevices = await accessStore.list();
    const updatedDevice = updatedDevices.find((d) => d.deviceId === issued.device.deviceId);
    assert.notEqual(updatedDevice, undefined);
    assert.equal(updatedDevice?.usage?.observedTokens, 75);
    assert.equal(updatedDevice?.usage?.observedInputTokens, 50);
    assert.equal(updatedDevice?.usage?.observedOutputTokens, 25);

    // 2. Send request with forbidden model
    const forbiddenResponse = await fetch(`http://127.0.0.1:${relayAddress.port}/api/codex/v1/responses`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${issued.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-unallowed-model",
      }),
    });

    assert.equal(forbiddenResponse.status, 403);
    const forbiddenJson = (await forbiddenResponse.json()) as { error: { message: string } };
    assert.match(forbiddenJson.error.message, /desativado pelo administrador/);

  } finally {
    if (agent) await agent.stop();
    await relay.close();
    await new Promise<void>((resolve) => fakeAppServer.close(() => resolve()));
    await new Promise<void>((resolve) => mockUpstream.close(() => resolve()));
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
});
