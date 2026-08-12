import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WebSocket } from "ws";
import type { RawData } from "ws";

import { AccessStore, defaultCodexHome, type DeviceAccess } from "./access-store.js";
import { createOpaqueToken } from "./crypto.js";
import {
  decodeMessage,
  decodeStreamData,
  encodeMessage,
  PROTOCOL_VERSION,
  type RelayDevice,
  type StreamDataMessage,
  type StreamOpenMessage,
  type WireMessage,
} from "./protocol.js";

const DEFAULT_RELAY_HEARTBEAT_INTERVAL_MS = 5_000;
const DEFAULT_ACCESS_SYNC_INTERVAL_MS = 1_000;
const MAX_PENDING_FRAMES = 100;

interface HostConfig {
  relayUrl: string;
  relayAgentToken: string;
  hostId: string;
  codexBin: string;
  appServerPort: number;
  appServerTokenFile: string;
  appServerStartTimeoutMs: number;
  accessSyncIntervalMs: number;
  heartbeatIntervalMs: number;
  reconnectInitialMs: number;
  reconnectMaxMs: number;
  codexHome: string;
  startAppServer: boolean;
}

interface PendingFrame {
  payload: Buffer | string;
  binary: boolean;
}

interface LocalStream {
  streamId: string;
  socket: WebSocket;
  pending: PendingFrame[];
  closed: boolean;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function tunnelUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("RELAY_URL deve usar ws:// ou wss://.");
  }
  if (url.search || url.hash) {
    throw new Error("RELAY_URL não pode conter query string nem fragmento.");
  }
  if (url.pathname === "/" || url.pathname === "") {
    url.pathname = "/tunnel";
  } else if (url.pathname !== "/tunnel") {
    throw new Error("RELAY_URL deve apontar para a raiz do relay ou para /tunnel.");
  }
  return url.toString();
}

function rawToBuffer(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) {
    return raw;
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw);
  }
  if (typeof raw === "string") {
    return Buffer.from(raw, "utf8");
  }
  return Buffer.from(raw);
}

function rawToText(raw: RawData): string {
  return rawToBuffer(raw).toString("utf8");
}

function streamData(streamId: string, raw: RawData, isBinary: boolean): StreamDataMessage {
  return {
    v: PROTOCOL_VERSION,
    type: "stream.data",
    streamId,
    kind: isBinary ? "binary" : "text",
    data: isBinary ? rawToBuffer(raw).toString("base64") : rawToText(raw),
  };
}

function streamClose(streamId: string, code: number, reason: string): WireMessage {
  return { v: PROTOCOL_VERSION, type: "stream.close", streamId, code, reason: reason.slice(0, 120) };
}

function asRelayDevice(device: DeviceAccess): RelayDevice {
  return { ...device };
}

export function hostConfigFromEnvironment(env: NodeJS.ProcessEnv = process.env): HostConfig {
  const relayUrl = env.RELAY_URL?.trim();
  const relayAgentToken = env.RELAY_AGENT_TOKEN?.trim();
  if (!relayUrl) {
    throw new Error("Configure RELAY_URL no host central.");
  }
  if (!relayAgentToken) {
    throw new Error("Configure RELAY_AGENT_TOKEN somente no host central.");
  }

  const appServerPort = Number(env.APP_SERVER_PORT || 4_500);
  if (!Number.isInteger(appServerPort) || appServerPort < 1 || appServerPort > 65_535) {
    throw new Error("APP_SERVER_PORT inválido.");
  }

  const configuredTokenFile = env.CODEX_APP_SERVER_TOKEN_FILE?.trim();
  const appServerTokenFile = configuredTokenFile || path.join(os.tmpdir(), `codex-app-server-${process.pid}.token`);

  return {
    relayUrl: tunnelUrl(relayUrl),
    relayAgentToken,
    hostId: env.RELAY_HOST_ID?.trim() || "central-main",
    codexBin: env.CODEX_BIN?.trim() || "codex",
    appServerPort,
    appServerTokenFile: path.resolve(appServerTokenFile),
    appServerStartTimeoutMs: positiveNumber(env.APP_SERVER_START_TIMEOUT_MS, 30_000),
    accessSyncIntervalMs: positiveNumber(env.ACCESS_SYNC_INTERVAL_MS, DEFAULT_ACCESS_SYNC_INTERVAL_MS),
    heartbeatIntervalMs: positiveNumber(env.RELAY_HEARTBEAT_INTERVAL_MS, DEFAULT_RELAY_HEARTBEAT_INTERVAL_MS),
    reconnectInitialMs: positiveNumber(env.RELAY_RECONNECT_INITIAL_MS, 1_000),
    reconnectMaxMs: positiveNumber(env.RELAY_RECONNECT_MAX_MS, 30_000),
    codexHome: defaultCodexHome(env),
    startAppServer: env.HOST_SKIP_APP_SERVER !== "1",
  };
}

export class HostAgent {
  private readonly config: HostConfig;
  private readonly accessStore: AccessStore;
  private tunnel: WebSocket | null = null;
  private appServer: ChildProcess | null = null;
  private readonly localStreams = new Map<string, LocalStream>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectDelayMs: number;
  private stopped = false;
  private ownsAppTokenFile = false;
  private appServerToken = "";
  private lastSyncedDeviceIds = new Set<string>();

  public constructor(config: HostConfig, accessStore = new AccessStore(path.join(config.codexHome, "remote-access.json"))) {
    this.config = config;
    this.accessStore = accessStore;
    this.reconnectDelayMs = config.reconnectInitialMs;
  }

  public async start(): Promise<void> {
    await this.prepareAppServerToken();
    if (this.config.startAppServer) {
      this.startLocalAppServer();
      await this.waitForLocalAppServer();
    }

    this.syncTimer = setInterval(() => {
      void this.syncAccess().catch((error: unknown) => this.logError("access.sync", error));
    }, this.config.accessSyncIntervalMs);
    this.syncTimer.unref();

    this.heartbeatTimer = setInterval(() => {
      this.send({ v: PROTOCOL_VERSION, type: "heartbeat", timestamp: Date.now() });
    }, this.config.heartbeatIntervalMs);
    this.heartbeatTimer.unref();

    this.connect();
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const stream of this.localStreams.values()) {
      stream.closed = true;
      stream.socket.close(1001, "Host agent encerrado");
    }
    this.localStreams.clear();

    if (this.tunnel) {
      this.tunnel.close(1000, "Host agent encerrado");
      this.tunnel = null;
    }

    if (this.appServer) {
      this.appServer.kill();
      this.appServer = null;
    }

    if (this.ownsAppTokenFile) {
      await fs.rm(this.config.appServerTokenFile, { force: true }).catch(() => undefined);
    }
  }

  private async prepareAppServerToken(): Promise<void> {
    try {
      this.appServerToken = (await fs.readFile(this.config.appServerTokenFile, "utf8")).trim();
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
      if (code !== "ENOENT") {
        throw error;
      }
    }

    if (!this.appServerToken) {
      this.appServerToken = createOpaqueToken();
      await fs.mkdir(path.dirname(this.config.appServerTokenFile), { recursive: true });
      await fs.writeFile(this.config.appServerTokenFile, `${this.appServerToken}\n`, { encoding: "utf8", mode: 0o600 });
      await fs.chmod(this.config.appServerTokenFile, 0o600).catch(() => undefined);
      this.ownsAppTokenFile = true;
    }
  }

  private startLocalAppServer(): void {
    const args = [
      "app-server",
      "--listen",
      `ws://127.0.0.1:${this.config.appServerPort}`,
      "--ws-auth",
      "capability-token",
      "--ws-token-file",
      this.config.appServerTokenFile,
    ];
    const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(this.config.codexBin);
    this.appServer = spawn(this.config.codexBin, args, {
      cwd: this.config.codexHome,
      env: { ...process.env, CODEX_HOME: this.config.codexHome },
      stdio: "inherit",
      shell: useShell,
    });
    this.appServer.once("exit", (code, signal) => {
      this.log(`codex app-server encerrou (code=${code ?? "null"}, signal=${signal ?? "null"}).`);
      this.appServer = null;
    });
    this.log(`codex app-server local iniciado em ws://127.0.0.1:${this.config.appServerPort}.`);
  }

  private async waitForLocalAppServer(): Promise<void> {
    const deadline = Date.now() + this.config.appServerStartTimeoutMs;
    while (!this.stopped && Date.now() < deadline) {
      const available = await new Promise<boolean>((resolve) => {
        const socket = new WebSocket(`ws://127.0.0.1:${this.config.appServerPort}`, {
          headers: { Authorization: `Bearer ${this.appServerToken}` },
          handshakeTimeout: 1_000,
        });
        let settled = false;
        const finish = (value: boolean) => {
          if (settled) {
            return;
          }
          settled = true;
          socket.removeAllListeners();
          if (value) {
            socket.close(1000, "Probe concluído");
          } else {
            socket.terminate();
          }
          resolve(value);
        };
        socket.once("open", () => finish(true));
        socket.once("error", () => finish(false));
      });
      if (available) {
        this.log("codex app-server local está pronto.");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error("O codex app-server local não ficou pronto dentro do tempo configurado.");
  }

  private connect(): void {
    if (this.stopped || this.tunnel) {
      return;
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.config.relayUrl, {
        headers: { Authorization: `Bearer ${this.config.relayAgentToken}` },
        handshakeTimeout: 10_000,
        maxPayload: 8 * 1024 * 1024,
      });
    } catch (error) {
      this.logError("conexão com relay", error);
      this.scheduleReconnect();
      return;
    }

    this.tunnel = socket;
    socket.on("open", () => {
      this.reconnectDelayMs = this.config.reconnectInitialMs;
      this.lastSyncedDeviceIds = new Set();
      this.log("Host central conectado ao relay.");
      this.send({ v: PROTOCOL_VERSION, type: "register", hostId: this.config.hostId });
      void this.syncAccess().catch((error: unknown) => this.logError("access.sync", error));
    });
    socket.on("message", (raw) => this.handleRelayMessage(raw));
    socket.on("close", () => {
      if (this.tunnel !== socket) {
        return;
      }
      this.tunnel = null;
      this.lastSyncedDeviceIds = new Set();
      this.closeLocalStreams();
      this.log("Conexão com relay encerrada; tentando reconectar.");
      this.scheduleReconnect();
    });
    socket.on("error", () => undefined);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) {
      return;
    }
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, this.config.reconnectMaxMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref();
  }

  private async syncAccess(): Promise<void> {
    if (!this.tunnel || this.tunnel.readyState !== WebSocket.OPEN) {
      return;
    }

    const devices = await this.accessStore.active();
    const deviceIds = new Set(devices.map((device) => device.deviceId));
    for (const deviceId of this.lastSyncedDeviceIds) {
      if (!deviceIds.has(deviceId)) {
        this.send({ v: PROTOCOL_VERSION, type: "access.revoke", deviceId });
      }
    }

    this.send({
      v: PROTOCOL_VERSION,
      type: "access.sync",
      devices: devices.map(asRelayDevice),
    });
    this.lastSyncedDeviceIds = deviceIds;
  }

  private handleRelayMessage(raw: RawData): void {
    const message = decodeMessage(raw);
    if (!message) {
      this.tunnel?.close(4000, "Mensagem inválida");
      return;
    }

    switch (message.type) {
      case "stream.open":
        void this.openLocalStream(message);
        return;
      case "stream.data":
        this.forwardDataToLocal(message);
        return;
      case "stream.close":
        this.closeLocalStream(message.streamId, message.code ?? 1000, message.reason ?? "Relay encerrou a sessão");
        return;
      case "heartbeat":
        this.send({ v: PROTOCOL_VERSION, type: "heartbeat", timestamp: Date.now() });
        return;
      case "access.seen":
        void this.accessStore.touch(message.deviceId).catch((error: unknown) => this.logError("access.seen", error));
        return;
      case "register":
      case "access.sync":
      case "access.revoke":
        return;
    }
  }

  private async openLocalStream(message: StreamOpenMessage): Promise<void> {
    if (this.localStreams.has(message.streamId)) {
      return;
    }

    const socket = new WebSocket(`ws://127.0.0.1:${this.config.appServerPort}`, {
      headers: { Authorization: `Bearer ${this.appServerToken}` },
      handshakeTimeout: 10_000,
      maxPayload: 8 * 1024 * 1024,
    });
    const stream: LocalStream = { streamId: message.streamId, socket, pending: [], closed: false };
    this.localStreams.set(message.streamId, stream);

    socket.on("open", () => {
      for (const frame of stream.pending.splice(0)) {
        socket.send(frame.payload, { binary: frame.binary });
      }
    });
    socket.on("message", (raw, isBinary) => {
      if (!stream.closed) {
        this.send(streamData(message.streamId, raw, isBinary));
      }
    });
    socket.on("close", () => {
      if (stream.closed) {
        return;
      }
      stream.closed = true;
      this.localStreams.delete(message.streamId);
      this.send(streamClose(message.streamId, 1011, "App-server local encerrou a sessão"));
    });
    socket.on("error", () => undefined);
  }

  private forwardDataToLocal(message: Extract<WireMessage, { type: "stream.data" }>): void {
    const stream = this.localStreams.get(message.streamId);
    if (!stream || stream.closed) {
      return;
    }

    const payload = decodeStreamData(message);
    const frame: PendingFrame = { payload, binary: message.kind === "binary" };
    if (stream.socket.readyState === WebSocket.OPEN) {
      stream.socket.send(frame.payload, { binary: frame.binary });
      return;
    }

    if (stream.pending.length >= MAX_PENDING_FRAMES) {
      this.closeLocalStream(message.streamId, 1013, "App-server local não abriu a tempo");
      return;
    }
    stream.pending.push(frame);
  }

  private closeLocalStream(streamId: string, code: number, reason: string): void {
    const stream = this.localStreams.get(streamId);
    if (!stream) {
      return;
    }
    stream.closed = true;
    this.localStreams.delete(streamId);
    if (stream.socket.readyState === WebSocket.OPEN || stream.socket.readyState === WebSocket.CONNECTING) {
      stream.socket.close(code, reason.slice(0, 120));
    }
  }

  private closeLocalStreams(): void {
    for (const stream of this.localStreams.values()) {
      stream.closed = true;
      stream.socket.close(4001, "Relay indisponível");
    }
    this.localStreams.clear();
  }

  private send(message: WireMessage): void {
    if (this.tunnel?.readyState !== WebSocket.OPEN) {
      return;
    }
    this.tunnel.send(encodeMessage(message));
  }

  private log(message: string): void {
    console.log(`[host] ${message}`);
  }

  private logError(context: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[host] ${context}: ${message}`);
  }
}

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  const agent = new HostAgent(hostConfigFromEnvironment());
  await agent.start();
  const shutdown = async () => {
    await agent.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}
