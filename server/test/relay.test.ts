import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { WebSocket } from "ws";
import type { RawData } from "ws";

import { hashToken } from "../src/crypto.js";
import {
  applyModelPolicyToClientFrame,
  applyModelPolicyToServerFrame,
  normalizeModelCatalog,
  RelayServer,
  type ModelPolicyStream,
  userVisibleAccountSnapshot,
} from "../src/relay.js";
import { decodeMessage, encodeMessage, PROTOCOL_VERSION, type RelayDevice, type WireMessage } from "../src/protocol.js";

const agentToken = "agent-secret-used-only-by-central-host";
const deviceToken = "device-secret-shown-once";

test("user account snapshots expose only the five-hour quota and redact it while another session is active", () => {
  const account = {
    account_id: "primary",
    usage: { lifetimeTokens: 123_456 },
    rate_limits: {
      codex: {
        limitId: "codex",
        limitName: "Codex",
        primary: { usedPercent: 63, windowDurationMins: 300, resetsAt: 1_900_000_000, credits: { balance: 10 } },
        secondary: { usedPercent: 10, windowDurationMins: 10_080, resetsAt: 1_900_500_000, credits: null },
        rateLimitReachedType: null,
      },
    },
  };
  const visible = userVisibleAccountSnapshot(account, true);
  const visibleLimit = (visible.rate_limits as Record<string, Record<string, unknown>>).codex;
  assert.equal((visibleLimit.primary as Record<string, unknown>).usedPercent, 63);
  assert.equal(visibleLimit.secondary, null);
  assert.equal(visible.usage, null);

  const hidden = userVisibleAccountSnapshot(account, false);
  const hiddenLimit = (hidden.rate_limits as Record<string, Record<string, unknown>>).codex;
  assert.equal((hiddenLimit.primary as Record<string, unknown>).usedPercent, null);
});

test("model catalog is populated from the account API and excludes hidden entries", () => {
  assert.deepEqual(normalizeModelCatalog({ result: { data: [
    { id: "gpt-live", displayName: "GPT Live", description: "From API", isDefault: true, defaultReasoningEffort: "medium", hidden: false },
    { id: "gpt-hidden", displayName: "Hidden", hidden: true },
    { id: "gpt-live", displayName: "Duplicate", hidden: false },
  ] } }), [{
    id: "gpt-live",
    displayName: "GPT Live",
    description: "From API",
    isDefault: true,
    defaultReasoningEffort: "medium",
  }]);
});

test("model policy injects an allowed default, rejects disabled models, and filters model/list", () => {
  const stream: ModelPolicyStream = {
    allowedModels: ["gpt-5.6-terra", "gpt-5.4"],
    pendingModelListRequestIds: new Set(),
  };

  const injected = applyModelPolicyToClientFrame(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "thread/start",
    params: { cwd: "C:/workspace" },
  }), stream);
  assert.equal(injected.error, undefined);
  assert.equal(JSON.parse(injected.payload ?? "{}").params.model, "gpt-5.6-terra");

  const denied = applyModelPolicyToClientFrame(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "turn/start",
    params: { model: "gpt-5.6-sol" },
  }), stream);
  assert.match(denied.error ?? "", /desativado pelo administrador/);

  const modelListRequest = applyModelPolicyToClientFrame(JSON.stringify({
    jsonrpc: "2.0",
    id: "models",
    method: "model/list",
    params: {},
  }), stream);
  assert.ok(modelListRequest.payload);

  const filtered = JSON.parse(applyModelPolicyToServerFrame(JSON.stringify({
    jsonrpc: "2.0",
    id: "models",
    result: {
      data: [
        { id: "gpt-5.6-sol" },
        { id: "gpt-5.6-terra" },
        { model: "gpt-5.4" },
      ],
    },
  }), stream));
  assert.deepEqual(filtered.result.data, [{ id: "gpt-5.6-terra" }, { model: "gpt-5.4" }]);
  assert.equal(stream.pendingModelListRequestIds.size, 0);
});

function addressPort(relay: RelayServer): number {
  const address = relay.address() as AddressInfo;
  assert.ok(address && typeof address.port === "number");
  return address.port;
}

function open(url: string, headers: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function rejectedStatus(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("WebSocket rejection timed out"));
    }, 3_000);
    socket.once("unexpected-response", (_request, response) => {
      clearTimeout(timer);
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    socket.once("error", () => undefined);
  });
}

function waitFor<T>(read: () => T | Promise<T>, predicate: (value: T) => boolean, timeoutMs = 3_000): Promise<T> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      const value = await read();
      if (predicate(value)) {
        resolve(value);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error("Timed out while waiting for relay state"));
        return;
      }
      setTimeout(() => void tick(), 20);
    };
    void tick();
  });
}

function nextDecodedMessage(socket: WebSocket): Promise<WireMessage> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: RawData) => {
      const message = decodeMessage(raw);
      if (message) {
        socket.off("error", onError);
        resolve(message);
      } else {
        socket.once("message", onMessage);
      }
    };
    const onError = (error: Error) => reject(error);
    socket.once("error", onError);
    socket.once("message", onMessage);
  });
}

function nextClientFrame(socket: WebSocket): Promise<{ data: string; binary: boolean }> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: RawData, isBinary: boolean) => {
      socket.off("error", onError);
      const data = Buffer.isBuffer(raw)
        ? raw.toString("utf8")
        : typeof raw === "string"
          ? raw
          : Array.isArray(raw)
            ? Buffer.concat(raw).toString("utf8")
            : Buffer.from(raw as ArrayBuffer).toString("utf8");
      resolve({ data, binary: isBinary });
    };
    const onError = (error: Error) => reject(error);
    socket.once("error", onError);
    socket.once("message", onMessage);
  });
}

function closeWait(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve(1000);
      return;
    }
    socket.once("close", (code) => resolve(code));
  });
}

function syncDevice(expiresAt = new Date(Date.now() + 60_000).toISOString()): RelayDevice {
  return {
    deviceId: "device-test",
    label: "test client",
    tokenHash: hashToken(deviceToken),
    createdAt: new Date().toISOString(),
    expiresAt,
    revokedAt: null,
    disabledAt: null,
    lastSeenAt: null,
  };
}

function syncAccounts(): WireMessage {
  return {
    v: PROTOCOL_VERSION,
    type: "accounts.sync",
    defaultAccountId: "primary",
    accounts: [{
      accountId: "primary",
      label: "Primary",
      email: "test@example.com",
      planType: "plus",
      authMode: "chatgpt",
      status: "ready",
      isDefault: true,
      updatedAt: new Date().toISOString(),
      rateLimits: {},
      usage: null,
      error: null,
    }],
  };
}

test("relay forwards opaque frames, rejects invalid access, and closes a revoked device", async () => {
  const relay = new RelayServer({
    agentTokenHash: hashToken(agentToken),
    host: "127.0.0.1",
    port: 0,
    siteDir: "site",
    heartbeatTimeoutMs: 5_000,
  });
  await relay.listen();
  const port = addressPort(relay);
  const base = `ws://127.0.0.1:${port}`;
  let tunnel: WebSocket | undefined;
  let client: WebSocket | undefined;
  try {
    assert.equal(await rejectedStatus(base, { Authorization: "Bearer invalid" }), 503);
    tunnel = await open(`${base}/tunnel`, { Authorization: `Bearer ${agentToken}` });
    tunnel.send(encodeMessage({ v: PROTOCOL_VERSION, type: "register", hostId: "test-host" }));
    tunnel.send(encodeMessage(syncAccounts()));
    const testDevice = { ...syncDevice(), allowedModels: ["gpt-5.6-sol"] };
    tunnel.send(encodeMessage({ v: PROTOCOL_VERSION, type: "access.sync", devices: [testDevice] }));
    await waitFor(() => relay.status(), (status) => status.ready && status.activeDevices === 1);

    assert.equal(await rejectedStatus(`${base}/codex`, { Authorization: "Bearer invalid" }), 401);
    assert.equal(await rejectedStatus(`${base}/codex?token=${deviceToken}`, { Authorization: `Bearer ${deviceToken}` }), 400);
    client = await open(base, { Authorization: `Bearer ${deviceToken}` });
    const opened = await nextDecodedMessage(tunnel);
    assert.equal(opened.type, "stream.open");
    const streamId = opened.type === "stream.open" ? opened.streamId : "";

    client.send(Buffer.from(JSON.stringify({
      jsonrpc: "2.0",
      id: "binary-model-change",
      method: "turn/start",
      params: { model: "gpt-5.4-mini" },
    }), "utf8"));
    const deniedBinaryModel = await nextClientFrame(client);
    assert.equal(deniedBinaryModel.binary, true);
    assert.match(JSON.parse(deniedBinaryModel.data).error.message, /desativado pelo administrador/);

    client.send("opaque app-server request");
    const outbound = await nextDecodedMessage(tunnel);
    assert.equal(outbound.type, "stream.data");
    assert.equal(outbound.type === "stream.data" ? outbound.data : "", "opaque app-server request");

    tunnel.send(encodeMessage({ v: PROTOCOL_VERSION, type: "stream.data", streamId, kind: "text", data: "opaque response" }));
    const response = await nextClientFrame(client);
    assert.equal(response.data, "opaque response");
    assert.equal(response.binary, false);

    tunnel.send(encodeMessage({ v: PROTOCOL_VERSION, type: "access.revoke", deviceId: "device-test" }));
    assert.equal(await closeWait(client), 4003);
    await waitFor(() => relay.status(), (status) => status.ready && status.activeDevices === 0 && status.activeStreams === 0);
  } finally {
    client?.terminate();
    tunnel?.terminate();
    await relay.close();
  }
});

test("relay fails closed when the central tunnel disappears and enforces expiry", async () => {
  const relay = new RelayServer({
    agentTokenHash: hashToken(agentToken),
    host: "127.0.0.1",
    port: 0,
    siteDir: "site",
    heartbeatTimeoutMs: 5_000,
  });
  await relay.listen();
  const port = addressPort(relay);
  const base = `ws://127.0.0.1:${port}`;
  let tunnel: WebSocket | undefined;
  let client: WebSocket | undefined;
  try {
    tunnel = await open(`${base}/tunnel`, { Authorization: `Bearer ${agentToken}` });
    tunnel.send(encodeMessage({ v: PROTOCOL_VERSION, type: "register", hostId: "test-host" }));
    tunnel.send(encodeMessage(syncAccounts()));
    tunnel.send(encodeMessage({ v: PROTOCOL_VERSION, type: "access.sync", devices: [syncDevice(new Date(Date.now() + 250).toISOString())] }));
    await waitFor(() => relay.status(), (status) => status.ready);
    client = await open(`${base}/codex`, { Authorization: `Bearer ${deviceToken}` });
    await nextDecodedMessage(tunnel);
    assert.equal(await closeWait(client), 4003);
    await waitFor(() => relay.status(), (status) => status.hostConnected && status.activeDevices === 0 && status.activeStreams === 0);

    tunnel.close();
    await waitFor(() => relay.status(), (status) => !status.hostConnected && !status.ready);
    assert.equal(await rejectedStatus(`${base}/codex`, { Authorization: `Bearer ${deviceToken}` }), 503);
  } finally {
    client?.terminate();
    tunnel?.terminate();
    await relay.close();
  }
});

test("relay allows the host time to finish its initial synchronization", async () => {
  const relay = new RelayServer({
    agentTokenHash: hashToken(agentToken),
    host: "127.0.0.1",
    port: 0,
    siteDir: "site",
    heartbeatTimeoutMs: 1_500,
  });
  await relay.listen();
  const port = addressPort(relay);
  let tunnel: WebSocket | undefined;
  try {
    tunnel = await open(`ws://127.0.0.1:${port}/tunnel`, { Authorization: `Bearer ${agentToken}` });
    tunnel.send(encodeMessage({ v: PROTOCOL_VERSION, type: "register", hostId: "slow-sync-host" }));

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    assert.equal(relay.status().hostConnected, true);
    assert.equal(relay.status().ready, false);

    tunnel.send(encodeMessage(syncAccounts()));
    tunnel.send(encodeMessage({ v: PROTOCOL_VERSION, type: "access.sync", devices: [syncDevice()] }));
    await waitFor(() => relay.status(), (status) => status.ready);
  } finally {
    tunnel?.terminate();
    await relay.close();
  }
});

test("relay routes a device to its bound account and enforces its observed weekly ceiling", async () => {
  const relay = new RelayServer({
    agentTokenHash: hashToken(agentToken),
    host: "127.0.0.1",
    port: 0,
    siteDir: "site",
    heartbeatTimeoutMs: 5_000,
  });
  await relay.listen();
  const port = addressPort(relay);
  const base = `ws://127.0.0.1:${port}`;
  let tunnel: WebSocket | undefined;
  let client: WebSocket | undefined;
  try {
    tunnel = await open(`${base}/tunnel`, { Authorization: `Bearer ${agentToken}` });
    tunnel.send(encodeMessage({ v: PROTOCOL_VERSION, type: "register", hostId: "bound-account-test" }));
    const accounts = syncAccounts();
    if (accounts.type !== "accounts.sync") throw new Error("Expected accounts.sync test message");
    accounts.accounts.push({
      accountId: "secondary",
      label: "Secondary",
      email: "secondary@example.com",
      planType: "pro",
      authMode: "chatgpt",
      status: "ready",
      isDefault: false,
      updatedAt: new Date().toISOString(),
      rateLimits: {
        weekly: {
          limitId: "weekly",
          limitName: "Weekly",
          primary: { usedPercent: 50, windowDurationMins: 10_080, resetsAt: 1_900_000_000, credits: null },
          secondary: null,
          rateLimitReachedType: null,
        },
      },
      usage: null,
      error: null,
    });
    tunnel.send(encodeMessage(accounts));
    tunnel.send(encodeMessage({
      v: PROTOCOL_VERSION,
      type: "access.sync",
      devices: [{
        ...syncDevice(),
        accountId: "secondary",
        weeklyLimitPercent: 40,
        usage: {
          windowResetsAt: new Date(1_900_000_000_000).toISOString(),
          observedTokens: 10,
          observedInputTokens: 8,
          observedCachedInputTokens: 0,
          observedOutputTokens: 2,
          observedReasoningTokens: 0,
          lastUsageAt: new Date().toISOString(),
          accountUsedPercent: 50,
          accountWindowDurationMins: 10_080,
          accountResetsAt: 1_900_000_000,
          usageLimitReachedAt: new Date().toISOString(),
        },
      }],
    }));
    await waitFor(() => relay.status(), (status) => status.ready && status.activeDevices === 0);
    assert.equal(await rejectedStatus(base, { Authorization: `Bearer ${deviceToken}` }), 401);

    tunnel.send(encodeMessage({
      v: PROTOCOL_VERSION,
      type: "accounts.sync",
      defaultAccountId: "primary",
      accounts: accounts.accounts.map((account) => account.accountId === "secondary"
        ? {
            ...account,
            rateLimits: {
              weekly: {
                limitId: "weekly",
                limitName: "Weekly",
                primary: { usedPercent: 20, windowDurationMins: 10_080, resetsAt: 1_900_000_000, credits: null },
                secondary: null,
                rateLimitReachedType: null,
              },
            },
          }
        : account),
    }));
    tunnel.send(encodeMessage({
      v: PROTOCOL_VERSION,
      type: "access.sync",
      devices: [{
        ...syncDevice(),
        accountId: "secondary",
        weeklyLimitPercent: 40,
        usage: {
          windowResetsAt: new Date(1_900_000_000_000).toISOString(),
          observedTokens: 10,
          observedInputTokens: 8,
          observedCachedInputTokens: 0,
          observedOutputTokens: 2,
          observedReasoningTokens: 0,
          lastUsageAt: new Date().toISOString(),
          accountUsedPercent: 20,
          accountWindowDurationMins: 10_080,
          accountResetsAt: 1_900_000_000,
          usageLimitReachedAt: null,
        },
      }],
    }));
    await waitFor(() => relay.status(), (status) => status.ready && status.activeDevices === 1);
    client = await open(base, { Authorization: `Bearer ${deviceToken}` });
    const opened = await nextDecodedMessage(tunnel);
    assert.equal(opened.type, "stream.open");
    assert.equal(opened.type === "stream.open" ? opened.accountId : null, "secondary");
  } finally {
    client?.terminate();
    tunnel?.terminate();
    await relay.close();
  }
});

test("health and readiness endpoints expose no secret material", async () => {
  const relay = new RelayServer({ agentTokenHash: hashToken(agentToken), host: "127.0.0.1", port: 0, siteDir: "site" });
  await relay.listen();
  const port = addressPort(relay);
  try {
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok", service: "codex-relay" });
    const ready = await fetch(`http://127.0.0.1:${port}/readyz`);
    assert.equal(ready.status, 503);
    const body = await ready.text();
    assert.equal(body.includes(agentToken), false);
    assert.equal(body.includes(deviceToken), false);
    const admin = await fetch(`http://127.0.0.1:${port}/admin`);
    assert.equal(admin.status, 200);
    const adminHtml = await admin.text();
    assert.match(adminHtml, /Painel administrativo/);
    const adminScriptPath = adminHtml.match(/src="([^"]+\.js)"/)?.[1];
    assert.ok(adminScriptPath);
    const adminScript = await fetch(`http://127.0.0.1:${port}${adminScriptPath}`);
    assert.equal(adminScript.status, 200);
    assert.match(adminScript.headers.get("content-type") || "", /javascript/);
    const login = await fetch(`http://127.0.0.1:${port}/login`);
    assert.equal(login.status, 200);
    assert.match(await login.text(), /Entrar/);
    const missingLegacyAsset = await fetch(`http://127.0.0.1:${port}/auth.js`);
    assert.equal(missingLegacyAsset.status, 404);
    const missingGeneratedAsset = await fetch(`http://127.0.0.1:${port}/assets/missing.js`);
    assert.equal(missingGeneratedAsset.status, 404);
    const adminConfig = await fetch(`http://127.0.0.1:${port}/api/admin/config`);
    assert.equal(adminConfig.status, 503);
  } finally {
    await relay.close();
  }
});

test("admin API validates Supabase identity before exposing account snapshots", async () => {
  const supabaseMock = http.createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/auth/v1/user" && request.headers.authorization === "Bearer supabase-access") {
      response.end(JSON.stringify({ id: "owner-user", email: "owner@example.com" }));
      return;
    }
    if (request.url?.startsWith("/rest/v1/codex_admins") && request.headers.authorization === "Bearer supabase-access") {
      response.end(JSON.stringify([{ role: "owner", enabled: true }]));
      return;
    }
    response.statusCode = 401;
    response.end(JSON.stringify({ message: "unauthorized" }));
  });
  await new Promise<void>((resolve) => supabaseMock.listen(0, "127.0.0.1", () => resolve()));
  const supabaseAddress = supabaseMock.address();
  assert.ok(supabaseAddress && typeof supabaseAddress === "object");

  const relay = new RelayServer({
    agentTokenHash: hashToken(agentToken),
    host: "127.0.0.1",
    port: 0,
    siteDir: "site",
    heartbeatTimeoutMs: 5_000,
    supabaseUrl: `http://127.0.0.1:${supabaseAddress.port}`,
    supabasePublishableKey: "publishable-only",
  });
  await relay.listen();
  const port = addressPort(relay);
  let tunnel: WebSocket | undefined;
  try {
    tunnel = await open(`ws://127.0.0.1:${port}/tunnel`, { Authorization: `Bearer ${agentToken}` });
    tunnel.send(encodeMessage({ v: PROTOCOL_VERSION, type: "register", hostId: "admin-test-host" }));
    tunnel.send(encodeMessage(syncAccounts()));
    tunnel.send(encodeMessage({ v: PROTOCOL_VERSION, type: "access.sync", devices: [syncDevice()] }));
    await waitFor(() => relay.status(), (status) => status.ready);

    assert.equal((await fetch(`http://127.0.0.1:${port}/api/admin/accounts`)).status, 401);
    const config = await fetch(`http://127.0.0.1:${port}/api/admin/config`);
    assert.equal(config.status, 200);
    assert.equal((await config.json()).publishableKey, "publishable-only");
    const accounts = await fetch(`http://127.0.0.1:${port}/api/admin/accounts`, { headers: { Authorization: "Bearer supabase-access" } });
    assert.equal(accounts.status, 200);
    const payload = await accounts.json();
    assert.equal(payload.role, "owner");
    assert.equal(payload.accounts[0].accountId, "primary");
    const session = await fetch(`http://127.0.0.1:${port}/api/admin/session`, { headers: { Authorization: "Bearer supabase-access" } });
    assert.equal(session.status, 200);
    assert.deepEqual(await session.json(), { userId: "owner-user", email: "owner@example.com", login: "owner@example.com", role: "owner" });
  } finally {
    tunnel?.terminate();
    await relay.close();
    await new Promise<void>((resolve) => supabaseMock.close(() => resolve()));
  }
});

test("relay enforces HTTP rate limiting and applies unified security headers", async () => {
  const relay = new RelayServer({
    agentTokenHash: hashToken(agentToken),
    host: "127.0.0.1",
    port: 0,
    siteDir: "site",
    heartbeatTimeoutMs: 5_000,
    globalRateLimitMax: 5,
    globalRateLimitWindowMs: 10_000,
  });
  await relay.listen();
  const port = addressPort(relay);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.equal(res.headers.get("ratelimit-limit"), "5");

    // Consume remaining tokens (3 more to reach 4, then 5th is allowed, 6th is rejected)
    for (let i = 0; i < 4; i++) {
      const okRes = await fetch(`http://127.0.0.1:${port}/healthz`);
      assert.equal(okRes.status, 200);
    }

    const blockedRes = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(blockedRes.status, 429);
    assert.ok(blockedRes.headers.has("retry-after"));
    const data = await blockedRes.json();
    assert.match(data.error, /Muitas requisições/);
  } finally {
    await relay.close();
  }
});

test("relay enforces WebSocket upgrade rate limits and max concurrent streams per IP", async () => {
  const relay = new RelayServer({
    agentTokenHash: hashToken(agentToken),
    host: "127.0.0.1",
    port: 0,
    siteDir: "site",
    heartbeatTimeoutMs: 5_000,
    wsRateLimitMax: 3,
    maxConcurrentStreamsPerIp: 2,
  });
  await relay.listen();
  const port = addressPort(relay);
  const base = `ws://127.0.0.1:${port}`;
  let tunnel: WebSocket | undefined;
  const clients: WebSocket[] = [];
  try {
    tunnel = await open(`${base}/tunnel`, { Authorization: `Bearer ${agentToken}` });
    tunnel.send(encodeMessage({ v: PROTOCOL_VERSION, type: "register", hostId: "ws-rate-host" }));
    tunnel.send(encodeMessage(syncAccounts()));
    tunnel.send(encodeMessage({ v: PROTOCOL_VERSION, type: "access.sync", devices: [syncDevice()] }));
    await waitFor(() => relay.status(), (status) => status.ready);

    // First 2 concurrent clients should connect
    const c1 = await open(base, { Authorization: `Bearer ${deviceToken}` });
    clients.push(c1);
    const c2 = await open(base, { Authorization: `Bearer ${deviceToken}` });
    clients.push(c2);

    // 3rd client exceeds maxConcurrentStreamsPerIp (2) -> rejected 429
    const rejectedStatusResult = await rejectedStatus(base, { Authorization: `Bearer ${deviceToken}` });
    assert.equal(rejectedStatusResult, 429);
  } finally {
    for (const c of clients) c.terminate();
    tunnel?.terminate();
    await relay.close();
  }
});

test("protocol decodes stream.open with or without reservationId for backward compatibility", () => {
  const legacyPayload = Buffer.from(JSON.stringify({
    v: PROTOCOL_VERSION,
    type: "stream.open",
    streamId: "stream-123",
    deviceId: "device-456",
    accountId: "account-789",
  }), "utf8");
  const decodedLegacy = decodeMessage(legacyPayload);
  assert.ok(decodedLegacy);
  assert.equal(decodedLegacy.type, "stream.open");
  if (decodedLegacy.type === "stream.open") {
    assert.equal(decodedLegacy.reservationId, undefined);
  }

  const modernPayload = Buffer.from(JSON.stringify({
    v: PROTOCOL_VERSION,
    type: "stream.open",
    streamId: "stream-123",
    deviceId: "device-456",
    accountId: "account-789",
    reservationId: "res-abc",
  }), "utf8");
  const decodedModern = decodeMessage(modernPayload);
  assert.ok(decodedModern);
  assert.equal(decodedModern.type, "stream.open");
  if (decodedModern.type === "stream.open") {
    assert.equal(decodedModern.reservationId, "res-abc");
  }

  const nullPayload = Buffer.from(JSON.stringify({
    v: PROTOCOL_VERSION,
    type: "stream.open",
    streamId: "stream-123",
    deviceId: "device-456",
    accountId: "account-789",
    reservationId: null,
  }), "utf8");
  const decodedNull = decodeMessage(nullPayload);
  assert.ok(decodedNull);
  assert.equal(decodedNull.type, "stream.open");
  if (decodedNull.type === "stream.open") {
    assert.equal(decodedNull.reservationId, null);
  }
});
