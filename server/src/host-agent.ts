import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WebSocket } from "ws";
import type { RawData } from "ws";

import { AccessStore, defaultCodexHome, type DeviceAccess } from "./access-store.js";
import {
  AccountStore,
  defaultAccountRegistryPath,
  defaultAccountsDirectory,
  primaryAccountOptions,
  type AccountRecord,
} from "./account-store.js";
import { AccountWorker } from "./account-worker.js";
import {
  decodeMessage,
  decodeStreamData,
  encodeMessage,
  PROTOCOL_VERSION,
  type AccountSnapshot,
  type ControlRequestMessage,
  type RelayDevice,
  type StreamDataMessage,
  type StreamOpenMessage,
  type WireMessage,
} from "./protocol.js";
import { SupabaseServiceClient, type SupabaseAdminKeyType } from "./supabase.js";

const DEFAULT_RELAY_HEARTBEAT_INTERVAL_MS = 5_000;
const DEFAULT_ACCESS_SYNC_INTERVAL_MS = 1_000;
const DEFAULT_ACCOUNT_REFRESH_INTERVAL_MS = 60_000;
const MAX_PENDING_FRAMES = 100;

export interface HostConfig {
  relayUrl: string;
  relayAgentToken: string;
  hostId: string;
  codexBin: string;
  appServerPort: number;
  appServerTokenFile: string;
  appServerStartTimeoutMs: number;
  accessSyncIntervalMs: number;
  accountRefreshIntervalMs: number;
  heartbeatIntervalMs: number;
  reconnectInitialMs: number;
  reconnectMaxMs: number;
  codexHome: string;
  accountRegistryPath: string;
  accountsDirectory: string;
  primaryAccountId: string;
  primaryAccountLabel: string;
  supabaseUrl?: string;
  supabaseSecretKey?: string;
  supabaseServiceRoleKey?: string;
  startAppServer: boolean;
}

interface PendingFrame {
  payload: Buffer | string;
  binary: boolean;
}

interface LocalStream {
  streamId: string;
  accountId: string;
  socket: WebSocket;
  pending: PendingFrame[];
  closed: boolean;
}

interface PublicDevice {
  deviceId: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  disabledAt: string | null;
  lastSeenAt: string | null;
  status: "active" | "disabled" | "revoked" | "expired";
  fingerprint: string;
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
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw);
  if (typeof raw === "string") return Buffer.from(raw, "utf8");
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

function publicDevice(device: DeviceAccess): PublicDevice {
  const now = Date.now();
  const status = device.revokedAt !== null
    ? "revoked"
    : device.disabledAt !== null
      ? "disabled"
      : Date.parse(device.expiresAt) <= now
        ? "expired"
        : "active";
  return {
    deviceId: device.deviceId,
    label: device.label,
    createdAt: device.createdAt,
    expiresAt: device.expiresAt,
    revokedAt: device.revokedAt,
    disabledAt: device.disabledAt,
    lastSeenAt: device.lastSeenAt,
    status,
    fingerprint: device.tokenHash.slice(0, 12),
  };
}

function sanitizeLoginResult(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const allowed = ["type", "loginId", "verificationUrl", "authUrl", "userCode", "expiresAt", "intervalSec"];
  const result: Record<string, unknown> = {};
  for (const key of allowed) {
    const candidate = source[key];
    if (typeof candidate === "string" || typeof candidate === "number") result[key] = candidate;
  }
  return result;
}

function requestString(payload: Record<string, unknown>, name: string): string {
  const value = payload[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Campo obrigatório: ${name}.`);
  return value.trim();
}

function requestNumber(payload: Record<string, unknown>, name: string, fallback: number): number {
  const value = payload[name];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1_000) {
    throw new Error(`Campo inválido: ${name}.`);
  }
  return value;
}

export function hostConfigFromEnvironment(env: NodeJS.ProcessEnv = process.env): HostConfig {
  const relayUrl = env.RELAY_URL?.trim();
  const relayAgentToken = env.RELAY_AGENT_TOKEN?.trim();
  if (!relayUrl) throw new Error("Configure RELAY_URL no host central.");
  if (!relayAgentToken) throw new Error("Configure RELAY_AGENT_TOKEN somente no host central.");

  const appServerPort = Number(env.APP_SERVER_PORT || 4_500);
  if (!Number.isInteger(appServerPort) || appServerPort < 1 || appServerPort > 65_535) {
    throw new Error("APP_SERVER_PORT inválido.");
  }

  const configuredTokenFile = env.CODEX_APP_SERVER_TOKEN_FILE?.trim();
  const appServerTokenFile = configuredTokenFile || path.join(os.tmpdir(), `codex-app-server-${process.pid}.token`);
  const primary = primaryAccountOptions(env);

  return {
    relayUrl: tunnelUrl(relayUrl),
    relayAgentToken,
    hostId: env.RELAY_HOST_ID?.trim() || "central-main",
    codexBin: env.CODEX_BIN?.trim() || "codex",
    appServerPort,
    appServerTokenFile: path.resolve(appServerTokenFile),
    appServerStartTimeoutMs: positiveNumber(env.APP_SERVER_START_TIMEOUT_MS, 30_000),
    accessSyncIntervalMs: positiveNumber(env.ACCESS_SYNC_INTERVAL_MS, DEFAULT_ACCESS_SYNC_INTERVAL_MS),
    accountRefreshIntervalMs: positiveNumber(env.ACCOUNT_REFRESH_INTERVAL_MS, DEFAULT_ACCOUNT_REFRESH_INTERVAL_MS),
    heartbeatIntervalMs: positiveNumber(env.RELAY_HEARTBEAT_INTERVAL_MS, DEFAULT_RELAY_HEARTBEAT_INTERVAL_MS),
    reconnectInitialMs: positiveNumber(env.RELAY_RECONNECT_INITIAL_MS, 1_000),
    reconnectMaxMs: positiveNumber(env.RELAY_RECONNECT_MAX_MS, 30_000),
    codexHome: defaultCodexHome(env),
    accountRegistryPath: env.CODEX_ACCOUNT_REGISTRY?.trim() ? path.resolve(env.CODEX_ACCOUNT_REGISTRY) : defaultAccountRegistryPath(env),
    accountsDirectory: env.CODEX_ACCOUNTS_DIR?.trim() ? path.resolve(env.CODEX_ACCOUNTS_DIR) : defaultAccountsDirectory(env),
    primaryAccountId: primary.accountId || "primary",
    primaryAccountLabel: primary.label || "Conta principal",
    supabaseUrl: env.SUPABASE_URL?.trim() || undefined,
    supabaseSecretKey: env.SUPABASE_SECRET_KEY?.trim() || undefined,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined,
    startAppServer: env.HOST_SKIP_APP_SERVER !== "1",
  };
}

export class HostAgent {
  private readonly config: HostConfig;
  private readonly accessStore: AccessStore;
  private readonly accountStore: AccountStore;
  private readonly workers = new Map<string, AccountWorker>();
  private readonly localStreams = new Map<string, LocalStream>();
  private readonly supabase: SupabaseServiceClient | null;
  private tunnel: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private accessTimer: NodeJS.Timeout | null = null;
  private accountTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectDelayMs: number;
  private stopped = false;
  private lastSyncedDeviceIds = new Set<string>();

  public constructor(
    config: HostConfig,
    accessStore = new AccessStore(path.join(config.codexHome, "remote-access.json")),
    accountStore = new AccountStore(config.accountRegistryPath, config.accountsDirectory),
  ) {
    this.config = config;
    this.accessStore = accessStore;
    this.accountStore = accountStore;
    this.reconnectDelayMs = config.reconnectInitialMs;
    const adminKey = config.supabaseSecretKey || config.supabaseServiceRoleKey;
    const adminKeyType: SupabaseAdminKeyType = config.supabaseSecretKey ? "secret" : "service_role";
    this.supabase = config.supabaseUrl && adminKey
      ? new SupabaseServiceClient(config.supabaseUrl, adminKey, adminKeyType)
      : null;
  }

  public async start(): Promise<void> {
    await this.accountStore.ensurePrimary({
      accountId: this.config.primaryAccountId,
      label: this.config.primaryAccountLabel,
      codeHome: this.config.codexHome,
      appServerPort: this.config.appServerPort,
    });
    await this.startWorkers();

    this.accessTimer = setInterval(() => {
      void this.syncAccess().catch((error: unknown) => this.logError("access.sync", error));
    }, this.config.accessSyncIntervalMs);
    this.accessTimer.unref();

    this.accountTimer = setInterval(() => {
      void this.refreshAccounts().catch((error: unknown) => this.logError("account.refresh", error));
    }, this.config.accountRefreshIntervalMs);
    this.accountTimer.unref();

    this.heartbeatTimer = setInterval(() => {
      this.send({ v: PROTOCOL_VERSION, type: "heartbeat", timestamp: Date.now() });
    }, this.config.heartbeatIntervalMs);
    this.heartbeatTimer.unref();

    this.connect();
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.accessTimer) clearInterval(this.accessTimer);
    if (this.accountTimer) clearInterval(this.accountTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.accessTimer = null;
    this.accountTimer = null;
    this.heartbeatTimer = null;

    this.closeLocalStreams();
    this.tunnel?.close(1000, "Host agent encerrado");
    this.tunnel = null;
    for (const worker of this.workers.values()) await worker.stop();
    this.workers.clear();
  }

  private async startWorkers(): Promise<void> {
    const accounts = await this.accountStore.list();
    for (const account of accounts) {
      if (!account.enabled) continue;
      await this.ensureWorker(account);
    }
  }

  private async ensureWorker(account: AccountRecord): Promise<AccountWorker> {
    const existing = this.workers.get(account.accountId);
    if (existing) return existing;

    const isPrimary = account.accountId === this.config.primaryAccountId;
    const worker = new AccountWorker({
      account,
      codexBin: this.config.codexBin,
      appServerStartTimeoutMs: this.config.appServerStartTimeoutMs,
      appServerTokenFile: isPrimary ? this.config.appServerTokenFile : undefined,
      startAppServer: this.config.startAppServer,
      stateDirectory: path.dirname(this.config.accountRegistryPath),
    }, {
      onSnapshotChanged: () => {
        void this.syncAccounts().catch((error) => this.logError("accounts.sync", error));
      },
    });
    this.workers.set(account.accountId, worker);
    try {
      await worker.start();
    } catch (error) {
      this.logError(`account ${account.accountId}`, error);
    }
    return worker;
  }

  private connect(): void {
    if (this.stopped || this.tunnel) return;

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
      void this.syncAccounts().catch((error: unknown) => this.logError("accounts.sync", error));
    });
    socket.on("message", (raw) => this.handleRelayMessage(raw));
    socket.on("close", () => {
      if (this.tunnel !== socket) return;
      this.tunnel = null;
      this.lastSyncedDeviceIds = new Set();
      this.closeLocalStreams();
      this.log("Conexão com relay encerrada; tentando reconectar.");
      this.scheduleReconnect();
    });
    socket.on("error", () => undefined);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, this.config.reconnectMaxMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref();
  }

  private async syncAccess(): Promise<void> {
    if (!this.tunnel || this.tunnel.readyState !== WebSocket.OPEN) return;
    const devices = await this.accessStore.active();
    const deviceIds = new Set(devices.map((device) => device.deviceId));
    for (const deviceId of this.lastSyncedDeviceIds) {
      if (!deviceIds.has(deviceId)) this.send({ v: PROTOCOL_VERSION, type: "access.revoke", deviceId });
    }
    this.send({ v: PROTOCOL_VERSION, type: "access.sync", devices: devices.map(asRelayDevice) });
    this.lastSyncedDeviceIds = deviceIds;
    await this.syncDeviceSnapshots();
  }

  private async refreshAccounts(): Promise<void> {
    for (const worker of this.workers.values()) {
      if (worker.ready) await worker.refreshSnapshot().catch((error) => this.logError(`account ${worker.account.accountId}`, error));
    }
    await this.syncAccounts();
  }

  private async syncAccounts(): Promise<void> {
    const defaultAccountId = await this.accountStore.defaultId();
    const accounts = [...this.workers.values()].map((worker) => worker.snapshotForDefault(defaultAccountId));
    this.send({ v: PROTOCOL_VERSION, type: "accounts.sync", defaultAccountId, accounts });
    await this.supabase?.upsertAccountSnapshots(accounts).catch((error) => this.logError("Supabase account snapshot", error));
  }

  private async syncDeviceSnapshots(): Promise<void> {
    const devices = await this.accessStore.list();
    await this.supabase?.upsertDeviceSnapshots(devices.map(asRelayDevice)).catch((error) => this.logError("Supabase device snapshot", error));
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
      case "control.request":
        void this.handleControlRequest(message);
        return;
      case "heartbeat":
        this.send({ v: PROTOCOL_VERSION, type: "heartbeat", timestamp: Date.now() });
        return;
      case "access.seen":
        void this.accessStore.touch(message.deviceId).then(() => this.syncDeviceSnapshots()).catch((error) => this.logError("access.seen", error));
        return;
      case "register":
      case "access.sync":
      case "access.revoke":
      case "accounts.sync":
      case "control.response":
        return;
    }
  }

  private async openLocalStream(message: StreamOpenMessage): Promise<void> {
    if (this.localStreams.has(message.streamId)) return;
    const worker = this.workers.get(message.accountId);
    if (!worker || !worker.ready || worker.snapshot.status !== "ready") {
      this.send(streamClose(message.streamId, 1013, "A conta selecionada não está autenticada ou disponível."));
      return;
    }

    let socket: WebSocket;
    try {
      socket = worker.openStream();
    } catch (error) {
      this.logError(`stream.open ${message.accountId}`, error);
      this.send(streamClose(message.streamId, 1013, "App-server da conta indisponível."));
      return;
    }
    const stream: LocalStream = { streamId: message.streamId, accountId: message.accountId, socket, pending: [], closed: false };
    this.localStreams.set(message.streamId, stream);

    socket.on("open", () => {
      for (const frame of stream.pending.splice(0)) socket.send(frame.payload, { binary: frame.binary });
    });
    socket.on("message", (raw, isBinary) => {
      if (!stream.closed) this.send(streamData(message.streamId, raw, isBinary));
    });
    socket.on("close", () => {
      if (stream.closed) return;
      stream.closed = true;
      this.localStreams.delete(message.streamId);
      this.send(streamClose(message.streamId, 1011, "App-server local encerrou a sessão"));
    });
    socket.on("error", () => undefined);
  }

  private forwardDataToLocal(message: Extract<WireMessage, { type: "stream.data" }>): void {
    const stream = this.localStreams.get(message.streamId);
    if (!stream || stream.closed) return;
    const frame: PendingFrame = { payload: decodeStreamData(message), binary: message.kind === "binary" };
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
    if (!stream) return;
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

  private async handleControlRequest(message: ControlRequestMessage): Promise<void> {
    try {
      const result = await this.executeControl(message.command, message.payload, message.actorId);
      this.send({ v: PROTOCOL_VERSION, type: "control.response", requestId: message.requestId, ok: true, result });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.send({ v: PROTOCOL_VERSION, type: "control.response", requestId: message.requestId, ok: false, error: reason });
    }
  }

  private async executeControl(command: ControlRequestMessage["command"], payload: Record<string, unknown>, actorId: string | null): Promise<unknown> {
    switch (command) {
      case "access.issue": {
        const issued = await this.accessStore.issue(requestString(payload, "label"), requestNumber(payload, "ttlMs", 30 * 24 * 60 * 60_000));
        await this.syncAccess();
        await this.audit(actorId, command, "device", issued.device.deviceId, { label: issued.device.label });
        return { device: publicDevice(issued.device), token: issued.token };
      }
      case "access.list": {
        const devices = await this.accessStore.list();
        return { devices: devices.map(publicDevice) };
      }
      case "access.disable": {
        const device = await this.accessStore.disable(requestString(payload, "deviceId"));
        if (!device) throw new Error("Dispositivo não encontrado, já desabilitado, expirado ou revogado.");
        await this.syncAccess();
        await this.audit(actorId, command, "device", device.deviceId);
        return { device: publicDevice(device) };
      }
      case "access.enable": {
        const device = await this.accessStore.enable(requestString(payload, "deviceId"));
        if (!device) throw new Error("Dispositivo não encontrado, expirado ou revogado.");
        await this.syncAccess();
        await this.audit(actorId, command, "device", device.deviceId);
        return { device: publicDevice(device) };
      }
      case "access.revoke": {
        const device = await this.accessStore.revoke(requestString(payload, "deviceId"));
        if (!device) throw new Error("Dispositivo não encontrado ou já revogado.");
        await this.syncAccess();
        await this.audit(actorId, command, "device", device.deviceId);
        return { device: publicDevice(device) };
      }
      case "account.list":
        return { defaultAccountId: await this.accountStore.defaultId(), accounts: this.accountSnapshots() };
      case "account.add": {
        const account = await this.accountStore.add(requestString(payload, "label"));
        const worker = await this.ensureWorker(account);
        await this.syncAccounts();
        await this.audit(actorId, command, "account", account.accountId, { label: account.label });
        return { account: worker.snapshotForDefault(await this.accountStore.defaultId()) };
      }
      case "account.login.start": {
        const accountId = requestString(payload, "accountId");
        const worker = await this.workerFor(accountId);
        const login = sanitizeLoginResult(await worker.loginStart());
        const snapshot = await worker.refreshSnapshot();
        await this.syncAccounts();
        return { accountId, login, snapshot: worker.snapshotForDefault(await this.accountStore.defaultId()) };
      }
      case "account.refresh": {
        const accountId = requestString(payload, "accountId");
        const worker = await this.workerFor(accountId);
        await worker.refreshSnapshot();
        await this.syncAccounts();
        return { account: worker.snapshotForDefault(await this.accountStore.defaultId()) };
      }
      case "account.set-default": {
        const accountId = requestString(payload, "accountId");
        const worker = await this.workerFor(accountId);
        if (!worker.ready || worker.snapshot.status !== "ready") {
          throw new Error("A conta precisa estar online e autenticada antes de virar padrão.");
        }
        await this.accountStore.setDefault(accountId);
        await this.syncAccounts();
        await this.audit(actorId, command, "account", accountId);
        return { defaultAccountId: accountId, accounts: this.accountSnapshots() };
      }
      case "account.logout": {
        const accountId = requestString(payload, "accountId");
        const worker = await this.workerFor(accountId);
        const result = await worker.logout();
        await this.syncAccounts();
        await this.audit(actorId, command, "account", accountId);
        return { accountId, result: sanitizeLoginResult(result), account: worker.snapshotForDefault(await this.accountStore.defaultId()) };
      }
      case "admin.list":
        if (!this.supabase) throw new Error("Supabase central não está configurado.");
        return { admins: await this.supabase.listAdmins() };
      case "admin.enable":
      case "admin.disable":
        if (!this.supabase) throw new Error("Supabase central não está configurado.");
        const targetUserId = requestString(payload, "userId");
        const changed = await this.supabase.setAdminEnabled(targetUserId, command === "admin.enable");
        await this.audit(actorId, command, "admin", targetUserId);
        return { admin: changed };
      case "admin.invite":
        if (!this.supabase) throw new Error("Configure SUPABASE_URL e SUPABASE_SECRET_KEY no host central.");
        const invited = await this.supabase.inviteAdmin(requestString(payload, "email"), actorId);
        await this.audit(actorId, command, "admin", invited.userId, { email: invited.email });
        return invited;
    }
  }

  private async workerFor(accountId: string): Promise<AccountWorker> {
    const account = await this.accountStore.get(accountId);
    if (!account || !account.enabled) throw new Error("Conta não encontrada ou desabilitada.");
    return this.ensureWorker(account);
  }

  private accountSnapshots(): AccountSnapshot[] {
    return [...this.workers.values()].map((worker) => worker.snapshot);
  }

  private async audit(actorId: string | null, action: string, targetType: string, targetId: string | null, metadata: Record<string, unknown> = {}): Promise<void> {
    await this.supabase?.audit(actorId, action, targetType, targetId, metadata).catch((error) => this.logError("Supabase audit", error));
  }

  private send(message: WireMessage): void {
    if (this.tunnel?.readyState !== WebSocket.OPEN) return;
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
