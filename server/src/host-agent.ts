import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WebSocket } from "ws";
import type { RawData } from "ws";

import {
  AccessStore,
  defaultCodexHome,
  type DeviceAccess,
  type DeviceUsageCounters,
  type UsageObservation,
} from "./access-store.js";
import {
  AccountStore,
  defaultAccountRegistryPath,
  defaultAccountTokenFile,
  defaultAccountsDirectory,
  primaryAccountOptions,
  type AccountRecord,
} from "./account-store.js";
import { AccountWorker } from "./account-worker.js";
import { OAuthResponsesBroker } from "./oauth-responses-broker.js";
import {
  decodeMessage,
  decodeStreamData,
  encodeMessage,
  PROTOCOL_VERSION,
  type AccountSnapshot,
  type AccountRateLimit,
  type RateLimitWindow,
  type ControlRequestMessage,
  type DeviceUsageSnapshot,
  type RelayDevice,
  type StreamDataMessage,
  type StreamOpenMessage,
  type ProviderRequestMessage,
  type ProviderAbortMessage,
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
  skipPrimaryAccount: boolean;
  supabaseUrl?: string;
  supabaseSecretKey?: string;
  supabaseServiceRoleKey?: string;
  startAppServer: boolean;
  codexOAuthResponsesUrl?: string;
  sshAuthorizedKeysFile?: string;
  sshSessionCommand?: string;
  sshPublicHost?: string;
  sshPublicPort: number;
  sshPublicUser: string;
  sshWorkspaceRoot: string;
}

interface PendingFrame {
  payload: Buffer | string;
  binary: boolean;
}

interface LocalStream {
  streamId: string;
  deviceId: string;
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
  status: "active" | "disabled" | "revoked" | "expired" | "limited";
  fingerprint: string;
  accountId: string | null;
  weeklyLimitPercent: number;
  userId: string | null;
  reservationId: string | null;
  quotaBaseUsedPercent: number | null;
  quotaBudgetPercent: number | null;
  usage: DeviceUsageSnapshot;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function usageCounters(value: unknown): DeviceUsageCounters | null {
  if (!isRecord(value)) return null;
  const totalTokens = nonNegativeNumber(value.totalTokens);
  const inputTokens = nonNegativeNumber(value.inputTokens);
  const cachedInputTokens = nonNegativeNumber(value.cachedInputTokens);
  const outputTokens = nonNegativeNumber(value.outputTokens);
  const reasoningOutputTokens = nonNegativeNumber(value.reasoningOutputTokens);
  if ([totalTokens, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens].some((field) => field === null)) return null;
  return {
    totalTokens: Math.floor(totalTokens as number),
    inputTokens: Math.floor(inputTokens as number),
    cachedInputTokens: Math.floor(cachedInputTokens as number),
    outputTokens: Math.floor(outputTokens as number),
    reasoningOutputTokens: Math.floor(reasoningOutputTokens as number),
  };
}

function usageObservationFromFrame(raw: RawData, isBinary: boolean): Omit<UsageObservation, "accountUsedPercent" | "accountWindowDurationMins" | "accountResetsAt"> & { threadId: string } | null {
  if (isBinary) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawToText(raw)) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.method !== "thread/tokenUsage/updated" || !isRecord(parsed.params)) return null;
  const params = parsed.params;
  const threadId = typeof params.threadId === "string" ? params.threadId : null;
  const tokenUsage = isRecord(params.tokenUsage) ? params.tokenUsage : null;
  const total = usageCounters(tokenUsage?.total);
  if (!threadId || !total) return null;
  return {
    threadId,
    total,
    last: usageCounters(tokenUsage?.last),
  };
}

function weeklyRateLimit(snapshot: AccountSnapshot | null | undefined): RateLimitWindow | null {
  if (!snapshot) return null;
  const windows: RateLimitWindow[] = [];
  for (const limit of Object.values(snapshot.rateLimits) as AccountRateLimit[]) {
    if (limit.primary) windows.push(limit.primary);
    if (limit.secondary) windows.push(limit.secondary);
  }
  return windows.sort((left, right) => (right.windowDurationMins ?? 0) - (left.windowDurationMins ?? 0))[0] ?? null;
}

function asRelayDevice(device: DeviceAccess): RelayDevice {
  const { threadTotals: _threadTotals, ...usage } = device.usage;
  return {
    deviceId: device.deviceId,
    label: device.label,
    tokenHash: device.tokenHash,
    createdAt: device.createdAt,
    expiresAt: device.expiresAt,
    revokedAt: device.revokedAt,
    disabledAt: device.disabledAt,
    lastSeenAt: device.lastSeenAt,
    accountId: device.accountId,
    weeklyLimitPercent: device.weeklyLimitPercent,
    userId: device.userId,
    reservationId: device.reservationId,
    quotaBaseUsedPercent: device.quotaBaseUsedPercent,
    quotaBudgetPercent: device.quotaBudgetPercent,
    usage,
  };
}

function publicDevice(device: DeviceAccess): PublicDevice {
  const now = Date.now();
  const status = device.revokedAt !== null
    ? "revoked"
    : device.disabledAt !== null
      ? "disabled"
      : Date.parse(device.expiresAt) <= now
        ? "expired"
        : device.usage.usageLimitReachedAt !== null
          ? "limited"
        : "active";
  const { threadTotals: _threadTotals, ...usage } = device.usage;
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
    accountId: device.accountId,
    weeklyLimitPercent: device.weeklyLimitPercent,
    userId: device.userId,
    reservationId: device.reservationId,
    quotaBaseUsedPercent: device.quotaBaseUsedPercent,
    quotaBudgetPercent: device.quotaBudgetPercent,
    usage,
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

function requestOptionalString(payload: Record<string, unknown>, name: string): string | null {
  const value = payload[name];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim()) throw new Error(`Campo inválido: ${name}.`);
  return value.trim();
}

function requestOptionalStringArray(payload: Record<string, unknown>, name: string): string[] | undefined {
  const value = payload[name];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`Campo inválido: ${name}.`);
  const result = [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
  if (result.length === 0) throw new Error(`Campo inválido: ${name}. Informe ao menos um valor.`);
  return result;
}

function requestPercent(payload: Record<string, unknown>, name: string, fallback: number): number {
  const value = payload[name];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`Campo inválido: ${name}. Deve estar entre 0 e 100.`);
  }
  return Math.round(value * 100) / 100;
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
    skipPrimaryAccount: env.HOST_SKIP_PRIMARY_ACCOUNT === "1",
    supabaseUrl: env.SUPABASE_URL?.trim() || undefined,
    supabaseSecretKey: env.SUPABASE_SECRET_KEY?.trim() || undefined,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined,
    startAppServer: env.HOST_SKIP_APP_SERVER !== "1",
    codexOAuthResponsesUrl: env.CODEX_OAUTH_RESPONSES_URL?.trim() || undefined,
    sshAuthorizedKeysFile: env.CODEX_SSH_AUTHORIZED_KEYS_FILE?.trim()
      ? path.resolve(env.CODEX_SSH_AUTHORIZED_KEYS_FILE)
      : undefined,
    sshSessionCommand: env.CODEX_SSH_SESSION_COMMAND?.trim() || undefined,
    sshPublicHost: env.CODEX_SSH_PUBLIC_HOST?.trim() || undefined,
    sshPublicPort: Math.min(65_535, Math.max(1, Math.floor(positiveNumber(env.CODEX_SSH_PUBLIC_PORT, 22)))),
    sshPublicUser: env.CODEX_SSH_PUBLIC_USER?.trim() || "fecart-host",
    sshWorkspaceRoot: path.resolve(env.CODEX_SSH_WORKSPACE_ROOT?.trim() || path.join(path.dirname(primary.codeHome), "workspaces")),
  };
}

export class HostAgent {
  private readonly config: HostConfig;
  private readonly accessStore: AccessStore;
  private readonly accountStore: AccountStore;
  private readonly oauthBroker: OAuthResponsesBroker;
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
  private readonly auditedQuotaLimitedDeviceIds = new Set<string>();

  public constructor(
    config: HostConfig,
    accessStore = new AccessStore(path.join(config.codexHome, "remote-access.json")),
    accountStore = new AccountStore(config.accountRegistryPath, config.accountsDirectory),
  ) {
    this.config = config;
    this.accessStore = accessStore;
    this.accountStore = accountStore;
    this.oauthBroker = new OAuthResponsesBroker(config.codexOAuthResponsesUrl);
    this.reconnectDelayMs = config.reconnectInitialMs;
    const adminKey = config.supabaseSecretKey || config.supabaseServiceRoleKey;
    const adminKeyType: SupabaseAdminKeyType = config.supabaseSecretKey ? "secret" : "service_role";
    this.supabase = config.supabaseUrl && adminKey
      ? new SupabaseServiceClient(config.supabaseUrl, adminKey, adminKeyType)
      : null;
  }

  public async start(): Promise<void> {
    if (this.config.skipPrimaryAccount) {
      await this.accountStore.removePlaceholder(this.config.primaryAccountId);
    } else {
      await this.accountStore.ensurePrimary({
        accountId: this.config.primaryAccountId,
        label: this.config.primaryAccountLabel,
        codeHome: this.config.codexHome,
        appServerPort: this.config.appServerPort,
      });
    }
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
    for (const worker of this.workers.values()) {
      const window = weeklyRateLimit(worker.snapshot);
      await this.accessStore.updateAccountLimit(
        worker.account.accountId,
        window?.usedPercent ?? null,
        window?.windowDurationMins ?? null,
        window?.resetsAt ?? null,
      );
    }
    const devices = await this.accessStore.active();
    await this.syncQuotaLimitAudits(devices);
    await this.syncSshAuthorizedKeys(devices);
    const deviceIds = new Set(devices.map((device) => device.deviceId));
    for (const deviceId of this.lastSyncedDeviceIds) {
      if (!deviceIds.has(deviceId)) this.send({ v: PROTOCOL_VERSION, type: "access.revoke", deviceId });
    }
    this.send({ v: PROTOCOL_VERSION, type: "access.sync", devices: devices.map(asRelayDevice) });
    this.lastSyncedDeviceIds = deviceIds;
    await this.syncDeviceSnapshots();
  }

  private async syncQuotaLimitAudits(devices: DeviceAccess[]): Promise<void> {
    const currentlyLimited = new Set<string>();
    for (const device of devices) {
      if (!device.usage?.usageLimitReachedAt) continue;
      currentlyLimited.add(device.deviceId);
      if (this.auditedQuotaLimitedDeviceIds.has(device.deviceId)) continue;
      this.auditedQuotaLimitedDeviceIds.add(device.deviceId);
      await this.audit(null, "session.quota.exhausted", "reservation", device.reservationId, {
        deviceId: device.deviceId,
        accountId: device.accountId,
        quotaBudgetPercent: device.quotaBudgetPercent,
        quotaConsumedPercent: device.usage.quotaConsumedPercent,
        limitedAt: device.usage.usageLimitReachedAt,
        reason: "quota_budget_reached",
      });
    }
    for (const deviceId of this.auditedQuotaLimitedDeviceIds) {
      if (!currentlyLimited.has(deviceId)) this.auditedQuotaLimitedDeviceIds.delete(deviceId);
    }
  }

  private async syncSshAuthorizedKeys(devices: DeviceAccess[]): Promise<void> {
    const target = this.config.sshAuthorizedKeysFile;
    const command = this.config.sshSessionCommand;
    if (!target || !command) return;
    if (/[\r\n"]/.test(command)) throw new Error("CODEX_SSH_SESSION_COMMAND contém caracteres inválidos.");
    const eligible = devices.filter((device) => (
      device.sshPublicKey
      && device.accountId
      && !device.usage?.usageLimitReachedAt
      && /^[a-zA-Z0-9._-]+$/.test(device.deviceId)
      && /^[a-zA-Z0-9._-]+$/.test(device.accountId)
    ));
    const contents = eligible.map((device) => (
      `restrict,command="${command} ${device.deviceId} ${device.accountId}" ${device.sshPublicKey} ${device.deviceId}`
    )).join("\n");
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, contents ? `${contents}\n` : "", { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, target);
    await fs.chmod(target, 0o600).catch(() => undefined);
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
        // Heartbeats are unidirectional from the host. The relay records the
        // received frame to refresh liveness, so do not echo it back.
        return;
      case "access.seen":
        void this.accessStore.touch(message.deviceId).then(() => this.syncDeviceSnapshots()).catch((error) => this.logError("access.seen", error));
        return;
      case "provider.request":
        void this.handleProviderRequest(message);
        return;
      case "provider.abort":
        this.oauthBroker.abort(message.requestId, message.reason);
        return;
      case "register":
      case "access.sync":
      case "access.revoke":
      case "accounts.sync":
      case "control.response":
      case "provider.response.start":
      case "provider.response.chunk":
      case "provider.response.end":
      case "provider.response.error":
        return;
    }
  }

  private async handleProviderRequest(message: ProviderRequestMessage): Promise<void> {
    const worker = this.workers.get(message.accountId);
    if (!worker || !worker.ready || worker.snapshot.status !== "ready") {
      this.send({
        v: PROTOCOL_VERSION,
        type: "provider.response.error",
        requestId: message.requestId,
        status: 503,
        error: "A conta selecionada não está pronta ou conectada no host central.",
      });
      return;
    }

    const devices = await this.accessStore.list();
    const device = devices.find((d) => d.deviceId === message.deviceId);
    if (!device || device.revokedAt !== null || device.disabledAt !== null || Date.parse(device.expiresAt) <= Date.now()) {
      this.send({
        v: PROTOCOL_VERSION,
        type: "provider.response.error",
        requestId: message.requestId,
        status: 401,
        error: "Acesso inválido, expirado ou revogado.",
      });
      return;
    }

    if (device.usage?.usageLimitReachedAt) {
      this.send({
        v: PROTOCOL_VERSION,
        type: "provider.response.error",
        requestId: message.requestId,
        status: 403,
        error: "Cota aprovada da sessão esgotada.",
      });
      return;
    }

    let parsedBody: Record<string, unknown> | null = null;
    try {
      parsedBody = JSON.parse(message.body);
    } catch {
      parsedBody = null;
    }

    const requestedModel = typeof parsedBody?.model === "string" ? parsedBody.model.trim() : null;
    if (device.allowedModels?.length && requestedModel && !device.allowedModels.includes(requestedModel)) {
      await this.audit(device.userId, "provider.model.denied", "device", device.deviceId, {
        accountId: message.accountId,
        model: requestedModel,
        allowedModels: device.allowedModels,
      });
      this.send({
        v: PROTOCOL_VERSION,
        type: "provider.response.error",
        requestId: message.requestId,
        status: 403,
        error: `O modelo ${requestedModel} foi desativado pelo administrador.`,
      });
      return;
    }

    await this.audit(device.userId, "provider.request.started", "device", device.deviceId, {
      requestId: message.requestId,
      accountId: message.accountId,
      model: requestedModel,
    });

    const startTime = Date.now();
    try {
      await this.oauthBroker.executeRequest({
        requestId: message.requestId,
        deviceId: message.deviceId,
        accountId: message.accountId,
        method: message.method,
        path: message.path,
        headers: message.headers,
        body: message.body,
        account: worker.account,
        worker,
        onStart: (status, headers) => {
          this.send({
            v: PROTOCOL_VERSION,
            type: "provider.response.start",
            requestId: message.requestId,
            status,
            headers,
          });
          void this.supabase?.upsertOperationalUsageEvent({
            eventKey: crypto.randomUUID(),
            eventType: "turn_started",
            deviceId: device.deviceId,
            userId: device.userId,
            reservationId: device.reservationId,
            accountId: message.accountId,
            threadId: message.requestId,
            turnId: message.requestId,
            modelId: requestedModel || "gpt-5.6-sol",
            status: "inProgress",
            totalTokens: 0,
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            accountUsedPercent: null,
            accountWindowDurationMins: null,
            accountResetsAt: null,
            observedAt: new Date().toISOString(),
          }).catch(() => undefined);
        },
        onChunk: (chunk) => {
          this.send({
            v: PROTOCOL_VERSION,
            type: "provider.response.chunk",
            requestId: message.requestId,
            data: chunk,
          });
        },
        onEnd: async (usage) => {
          const durationMs = Date.now() - startTime;
          const window = weeklyRateLimit(worker.snapshot);
          const modelUsed = usage?.model ?? requestedModel ?? "gpt-5.6-sol";
          if (usage) {
            const observation: UsageObservation = {
              threadId: usage.responseId || message.requestId,
              total: {
                totalTokens: usage.totalTokens,
                inputTokens: usage.inputTokens,
                cachedInputTokens: usage.cachedInputTokens,
                outputTokens: usage.outputTokens,
                reasoningOutputTokens: usage.reasoningOutputTokens,
              },
              last: null,
              accountUsedPercent: window?.usedPercent ?? null,
              accountWindowDurationMins: window?.windowDurationMins ?? null,
              accountResetsAt: window?.resetsAt ?? null,
            };
            await this.accessStore.recordUsage(message.deviceId, observation).catch((err) => this.logError("usage.record", err));
            void worker.refreshSnapshot().catch(() => undefined);
            void this.syncAccess().catch(() => undefined);

            void this.supabase?.upsertOperationalUsageEvent({
              eventKey: crypto.randomUUID(),
              eventType: "token_usage",
              deviceId: device.deviceId,
              userId: device.userId,
              reservationId: device.reservationId,
              accountId: message.accountId,
              threadId: usage.responseId || message.requestId,
              turnId: message.requestId,
              modelId: modelUsed,
              status: "completed",
              totalTokens: usage.totalTokens,
              inputTokens: usage.inputTokens,
              cachedInputTokens: usage.cachedInputTokens,
              outputTokens: usage.outputTokens,
              reasoningTokens: usage.reasoningOutputTokens,
              accountUsedPercent: window?.usedPercent ?? null,
              accountWindowDurationMins: window?.windowDurationMins ?? null,
              accountResetsAt: window?.resetsAt ?? null,
              observedAt: new Date().toISOString(),
            }).catch(() => undefined);
          }
          void this.supabase?.upsertOperationalUsageEvent({
            eventKey: crypto.randomUUID(),
            eventType: "turn_completed",
            deviceId: device.deviceId,
            userId: device.userId,
            reservationId: device.reservationId,
            accountId: message.accountId,
            threadId: usage?.responseId || message.requestId,
            turnId: message.requestId,
            modelId: modelUsed,
            status: "completed",
            totalTokens: usage?.totalTokens ?? 0,
            inputTokens: usage?.inputTokens ?? 0,
            cachedInputTokens: usage?.cachedInputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
            reasoningTokens: usage?.reasoningOutputTokens ?? 0,
            accountUsedPercent: window?.usedPercent ?? null,
            accountWindowDurationMins: window?.windowDurationMins ?? null,
            accountResetsAt: window?.resetsAt ?? null,
            observedAt: new Date().toISOString(),
          }).catch(() => undefined);
          await this.audit(device.userId, "provider.request.completed", "device", device.deviceId, {
            requestId: message.requestId,
            accountId: message.accountId,
            model: modelUsed,
            durationMs,
            totalTokens: usage?.totalTokens ?? 0,
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
          });
          this.send({
            v: PROTOCOL_VERSION,
            type: "provider.response.end",
            requestId: message.requestId,
          });
        },
        onError: async (status, error) => {
          await this.audit(device.userId, "provider.request.failed", "device", device.deviceId, {
            requestId: message.requestId,
            accountId: message.accountId,
            model: requestedModel,
            status,
            error,
          });
          this.send({
            v: PROTOCOL_VERSION,
            type: "provider.response.error",
            requestId: message.requestId,
            status,
            error,
          });
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.send({
        v: PROTOCOL_VERSION,
        type: "provider.response.error",
        requestId: message.requestId,
        status: 500,
        error: msg,
      });
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
    const stream: LocalStream = { streamId: message.streamId, deviceId: message.deviceId, accountId: message.accountId, socket, pending: [], closed: false };
    this.localStreams.set(message.streamId, stream);

    socket.on("open", () => {
      for (const frame of stream.pending.splice(0)) socket.send(frame.payload, { binary: frame.binary });
    });
    socket.on("message", (raw, isBinary) => {
      if (!stream.closed) {
        this.recordUsage(stream, raw, isBinary);
        this.send(streamData(message.streamId, raw, isBinary));
      }
    });
    socket.on("close", () => {
      if (stream.closed) return;
      stream.closed = true;
      this.localStreams.delete(message.streamId);
      this.send(streamClose(message.streamId, 1011, "App-server local encerrou a sessão"));
    });
    socket.on("error", () => undefined);
  }

  private recordUsage(stream: LocalStream, raw: RawData, isBinary: boolean): void {
    const observed = usageObservationFromFrame(raw, isBinary);
    if (!observed) return;
    const window = weeklyRateLimit(this.workers.get(stream.accountId)?.snapshot);
    const observation: UsageObservation = {
      ...observed,
      accountUsedPercent: window?.usedPercent ?? null,
      accountWindowDurationMins: window?.windowDurationMins ?? null,
      accountResetsAt: window?.resetsAt ?? null,
    };
    void this.accessStore.recordUsage(stream.deviceId, observation)
      .then((device) => {
        if (!device) return;
        return this.syncAccess();
      })
      .catch((error) => this.logError("usage.record", error));
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
        const issued = await this.accessStore.issue(
          requestString(payload, "label"),
          requestNumber(payload, "ttlMs", 30 * 24 * 60 * 60_000),
          new Date(),
          {
            accountId: requestOptionalString(payload, "accountId"),
            weeklyLimitPercent: requestPercent(payload, "weeklyLimitPercent", 100),
            expiresAt: requestOptionalString(payload, "expiresAt"),
          },
        );
        await this.syncAccess();
        await this.audit(actorId, command, "device", issued.device.deviceId, { label: issued.device.label });
        return { device: publicDevice(issued.device), token: issued.token, app: this.appAccess(issued.device, issued.sshPrivateKey) };
      }
      case "session.issue": {
        const accountId = requestString(payload, "accountId");
        const userId = requestString(payload, "userId");
        const reservationId = requestString(payload, "reservationId");
        const expiresAt = requestString(payload, "expiresAt");
        const quotaBudgetPercent = requestPercent(payload, "quotaBudgetPercent", 1);
        if (quotaBudgetPercent < 1 || quotaBudgetPercent > 100) {
          throw new Error("O uso aprovado da sessão deve ser de 1% a 100%.");
        }
        const worker = await this.workerFor(accountId);
        if (!worker.ready || worker.snapshot.status !== "ready") {
          throw new Error("A conta escolhida para a reserva não está disponível.");
        }
        const accountWindow = weeklyRateLimit(worker.snapshot);
        const issued = await this.accessStore.issue(
          `Sessão ${reservationId.slice(0, 8)}`,
          Math.max(1_000, Date.parse(expiresAt) - Date.now()),
          new Date(),
          {
            accountId,
            expiresAt,
            weeklyLimitPercent: 100,
            userId,
            reservationId,
            quotaBaseUsedPercent: accountWindow?.usedPercent ?? 0,
            quotaBudgetPercent,
            allowedModels: requestOptionalStringArray(payload, "allowedModels"),
          },
        );
        await this.syncAccess();
        void this.supabase?.upsertOperationalUsageEvent({
          eventKey: crypto.randomUUID(),
          eventType: "session_opened",
          deviceId: issued.device.deviceId,
          userId,
          reservationId,
          accountId,
          threadId: null,
          turnId: null,
          modelId: null,
          status: "connected",
          totalTokens: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          accountUsedPercent: accountWindow?.usedPercent ?? null,
          accountWindowDurationMins: accountWindow?.windowDurationMins ?? null,
          accountResetsAt: accountWindow?.resetsAt ?? null,
          observedAt: new Date().toISOString(),
        }).catch(() => undefined);
        await this.audit(userId, command, "reservation", reservationId, {
          accountId,
          quotaBudgetPercent,
        });
        return { device: publicDevice(issued.device), token: issued.token, app: this.appAccess(issued.device, issued.sshPrivateKey) };
      }
      case "access.list": {
        const devices = await this.accessStore.list();
        return { devices: devices.map(publicDevice) };
      }
      case "access.update-policy": {
        const device = await this.accessStore.updatePolicy(requestString(payload, "deviceId"), {
          accountId: payload.accountId === undefined ? undefined : requestOptionalString(payload, "accountId"),
          weeklyLimitPercent: payload.weeklyLimitPercent === undefined ? undefined : requestPercent(payload, "weeklyLimitPercent", 100),
          expiresAt: requestOptionalString(payload, "expiresAt") ?? undefined,
          allowedModels: requestOptionalStringArray(payload, "allowedModels"),
        });
        if (!device) throw new Error("Dispositivo não encontrado ou já revogado.");
        await this.syncAccess();
        await this.audit(actorId, command, "device", device.deviceId, {
          weeklyLimitPercent: device.weeklyLimitPercent,
          expiresAt: device.expiresAt,
          allowedModels: device.allowedModels,
        });
        return { device: publicDevice(device) };
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
        void this.supabase?.upsertOperationalUsageEvent({
          eventKey: crypto.randomUUID(),
          eventType: "session_closed",
          deviceId: device.deviceId,
          userId: device.userId,
          reservationId: device.reservationId,
          accountId: device.accountId ?? "unknown",
          threadId: null,
          turnId: null,
          modelId: null,
          status: "closed",
          totalTokens: device.usage.observedTokens,
          inputTokens: device.usage.observedInputTokens,
          cachedInputTokens: device.usage.observedCachedInputTokens,
          outputTokens: device.usage.observedOutputTokens,
          reasoningTokens: device.usage.observedReasoningTokens,
          accountUsedPercent: device.usage.lastAccountUsedPercent ?? null,
          accountWindowDurationMins: null,
          accountResetsAt: null,
          observedAt: new Date().toISOString(),
        }).catch(() => undefined);
        await this.audit(actorId, command, "device", device.deviceId);
        return { device: publicDevice(device) };
      }
      case "access.reactivate": {
        const device = await this.accessStore.reactivate(requestString(payload, "deviceId"));
        if (!device) throw new Error("Dispositivo não encontrado, não está revogado ou a sessão expirou.");
        await this.syncAccess();
        await this.audit(actorId, command, "device", device.deviceId);
        return { device: publicDevice(device) };
      }
      case "account.list":
        return { defaultAccountId: await this.accountStore.defaultId(), accounts: this.accountSnapshots() };
      case "account.models.list": {
        const accountId = requestOptionalString(payload, "accountId") ?? await this.accountStore.defaultId();
        const worker = accountId ? await this.workerFor(accountId) : [...this.workers.values()].find((candidate) => candidate.snapshot.status === "ready");
        if (!worker || worker.snapshot.status !== "ready") throw new Error("Nenhuma conta autenticada está disponível para consultar os modelos.");
        const result = await worker.listModels();
        return { accountId: worker.account.accountId, result };
      }
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
        await this.audit(actorId, command, "account", accountId, { status: snapshot.status });
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
      case "account.remove": {
        const accountId = requestString(payload, "accountId");
        if (!this.config.skipPrimaryAccount && accountId === this.config.primaryAccountId) {
          throw new Error("A conta principal é gerenciada pela configuração do host e não pode ser excluída.");
        }
        const account = await this.accountStore.get(accountId);
        if (!account) throw new Error("Conta não encontrada.");
        if (await this.accountStore.defaultId() === accountId) {
          throw new Error("Defina outra conta padrão antes de excluir esta conta.");
        }
        const worker = this.workers.get(accountId);
        if (worker) {
          await worker.stop();
          this.workers.delete(accountId);
        }
        const revokedDevices = await this.accessStore.revokeForAccount(accountId);
        const removed = await this.accountStore.remove(accountId);
        const tokenFile = defaultAccountTokenFile(accountId, { REMOTE_CODEX_STATE_DIR: path.dirname(this.config.accountRegistryPath) });
        await fs.rm(tokenFile, { force: true });
        await this.syncAccess();
        await this.syncAccounts();
        await this.audit(actorId, command, "account", accountId, { label: removed.label, revokedDevices });
        return { accountId, label: removed.label, revokedDevices };
      }
      case "admin.list":
        if (!this.supabase) throw new Error("Supabase central não está configurado.");
        return { admins: await this.supabase.listAdmins() };
      case "audit.write": {
        if (!this.supabase) throw new Error("Supabase central não está configurado.");
        const action = requestString(payload, "action");
        const targetType = requestString(payload, "targetType");
        const targetId = requestOptionalString(payload, "targetId");
        const metadata = payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
          ? payload.metadata as Record<string, unknown>
          : {};
        await this.audit(actorId, action, targetType, targetId, metadata);
        return { recorded: true };
      }
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

  private appAccess(device: DeviceAccess, privateKey: string): Record<string, unknown> {
    if (!this.config.sshPublicHost || !this.config.sshAuthorizedKeysFile || !this.config.sshSessionCommand || !device.sshKeyFingerprint) {
      return { available: false };
    }
    const workspaceOwner = (device.userId || device.deviceId).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
    return {
      available: true,
      host: this.config.sshPublicHost,
      port: this.config.sshPublicPort,
      user: this.config.sshPublicUser,
      alias: `fecart-${device.deviceId.slice(-8)}`,
      workspacePath: path.join(this.config.sshWorkspaceRoot, workspaceOwner),
      privateKey,
      fingerprint: device.sshKeyFingerprint,
      expiresAt: device.expiresAt,
    };
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

let isEntryPoint = false;
if (process.argv[1]) {
  try {
    const { realpathSync } = await import("node:fs");
    const scriptPath = fileURLToPath(import.meta.url);
    isEntryPoint = path.resolve(process.argv[1]) === scriptPath || realpathSync(process.argv[1]) === realpathSync(scriptPath);
  } catch {
    isEntryPoint = false;
  }
}

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
