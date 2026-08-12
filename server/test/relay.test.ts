import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { WebSocket } from "ws";
import type { RawData } from "ws";

import { hashToken } from "../src/crypto.js";
import { RelayServer } from "../src/relay.js";
import { decodeMessage, encodeMessage, PROTOCOL_VERSION, type RelayDevice, type WireMessage } from "../src/protocol.js";

const agentToken = "agent-secret-used-only-by-central-host";
const deviceToken = "device-secret-shown-once";

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
    lastSeenAt: null,
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
    assert.equal(await rejectedStatus(`${base}/codex`, { Authorization: "Bearer invalid" }), 503);
    tunnel = await open(`${base}/tunnel`, { Authorization: `Bearer ${agentToken}` });
    tunnel.send(encodeMessage({ v: PROTOCOL_VERSION, type: "register", hostId: "test-host" }));
    const testDevice = syncDevice();
    tunnel.send(encodeMessage({ v: PROTOCOL_VERSION, type: "access.sync", devices: [testDevice] }));
    await waitFor(() => relay.status(), (status) => status.ready && status.activeDevices === 1);

    assert.equal(await rejectedStatus(`${base}/codex`, { Authorization: "Bearer invalid" }), 401);
    assert.equal(await rejectedStatus(`${base}/codex?token=${deviceToken}`, { Authorization: `Bearer ${deviceToken}` }), 400);
    client = await open(`${base}/codex`, { Authorization: `Bearer ${deviceToken}` });
    const opened = await nextDecodedMessage(tunnel);
    assert.equal(opened.type, "stream.open");
    const streamId = opened.type === "stream.open" ? opened.streamId : "";

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
  } finally {
    await relay.close();
  }
});
