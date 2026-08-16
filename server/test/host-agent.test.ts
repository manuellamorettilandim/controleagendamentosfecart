import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WebSocket, WebSocketServer } from "ws";
import type { RawData } from "ws";

import { AccessStore } from "../src/access-store.js";
import { AccountStore } from "../src/account-store.js";
import { hashToken } from "../src/crypto.js";
import { HostAgent, hostConfigFromEnvironment } from "../src/host-agent.js";
import { RelayServer } from "../src/relay.js";

const agentToken = "agent-secret-for-host-test";

function open(url: string, headers: Record<string, string> = {}): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextFrame(socket: WebSocket): Promise<{ text: string; binary: boolean }> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    socket.once("error", onError);
    socket.once("message", (raw: RawData, binary: boolean) => {
      socket.off("error", onError);
      const buffer = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw as ArrayBuffer);
      resolve({ text: buffer.toString("utf8"), binary });
    });
  });
}

function listeningPort(server: WebSocketServer): number {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port;
}

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

test("host agent connects the relay to a local app-server without exposing the local token", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "remote-codex-host-"));
  const codexHome = path.join(directory, "codex-home");
  const accountStore = new AccountStore(path.join(directory, "accounts.json"), path.join(directory, "accounts"));
  const store = new AccessStore(path.join(codexHome, "remote-access.json"));
  const issued = await store.issue("host-test-client", 60 * 60_000, new Date(), { accountId: "primary" });
  const fakeAppServer = new WebSocketServer({ port: 0 });
  fakeAppServer.on("connection", (socket) => {
    socket.on("message", (raw, binary) => {
      const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
      let message: { id?: number; method?: string } = {};
      try { message = JSON.parse(text) as { id?: number; method?: string }; } catch { /* opaque stream frame */ }
      if (message.method === "initialize" && typeof message.id === "number") {
        socket.send(JSON.stringify({ id: message.id, result: {} }));
        return;
      }
      if (message.method === "account/read" && typeof message.id === "number") {
        socket.send(JSON.stringify({ id: message.id, result: { account: { type: "chatgpt", email: "test@example.com", planType: "plus" } } }));
        return;
      }
      if (message.method === "account/rateLimits/read" && typeof message.id === "number") {
        socket.send(JSON.stringify({ id: message.id, result: { rateLimitsByLimitId: {} } }));
        return;
      }
      if (message.method === "account/usage/read" && typeof message.id === "number") {
        socket.send(JSON.stringify({ id: message.id, result: { summary: {}, dailyUsageBuckets: [] } }));
        return;
      }
      socket.send(raw, { binary });
    });
  });
  await new Promise<void>((resolve) => fakeAppServer.once("listening", () => resolve()));

  const relay = new RelayServer({
    agentTokenHash: hashToken(agentToken),
    host: "127.0.0.1",
    port: 0,
    siteDir: "site",
    heartbeatTimeoutMs: 5_000,
  });
  await relay.listen();
  const relayAddress = relay.address();
  assert.ok(relayAddress && typeof relayAddress === "object");

  let agent: HostAgent | undefined;
  let client: WebSocket | undefined;
  try {
    const config = hostConfigFromEnvironment({
      ...process.env,
      CODEX_HOME: codexHome,
      RELAY_URL: `ws://127.0.0.1:${relayAddress.port}`,
      RELAY_AGENT_TOKEN: agentToken,
      RELAY_HOST_ID: "host-test",
      APP_SERVER_PORT: String(listeningPort(fakeAppServer)),
      CODEX_APP_SERVER_TOKEN_FILE: path.join(codexHome, "app-server.token"),
      CODEX_ACCOUNT_REGISTRY: path.join(directory, "accounts.json"),
      CODEX_ACCOUNTS_DIR: path.join(directory, "accounts"),
      CODEX_SSH_AUTHORIZED_KEYS_FILE: path.join(directory, "authorized_keys"),
      CODEX_SSH_SESSION_COMMAND: "/usr/bin/node /opt/fecart/current/dist/src/ssh-session.js",
      CODEX_SSH_PUBLIC_HOST: "codex.example.test",
      HOST_SKIP_APP_SERVER: "1",
      ACCESS_SYNC_INTERVAL_MS: "50",
      RELAY_HEARTBEAT_INTERVAL_MS: "50",
    });
    agent = new HostAgent(config, store, accountStore);
    await agent.start();
    await waitForReady(relay);

    client = await open(`ws://127.0.0.1:${relayAddress.port}/codex`, {
      Authorization: `Bearer ${issued.token}`,
    });
    client.send("host roundtrip");
    const response = await nextFrame(client);
    assert.equal(response.text, "host roundtrip");
    assert.equal(response.binary, false);

    await fs.access(path.join(codexHome, "app-server.token"));
    const authorized = await fs.readFile(path.join(directory, "authorized_keys"), "utf8");
    assert.match(authorized, new RegExp(issued.device.deviceId));
    assert.match(authorized, /restrict,command=/);
    assert.equal(authorized.includes(issued.sshPrivateKey), false);
    await store.disable(issued.device.deviceId);
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(await fs.readFile(path.join(directory, "authorized_keys"), "utf8"), "");
  } finally {
    client?.terminate();
    await agent?.stop();
    await relay.close();
    await new Promise<void>((resolve) => fakeAppServer.close(() => resolve()));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
