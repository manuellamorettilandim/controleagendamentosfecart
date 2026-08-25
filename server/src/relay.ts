import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Duplex } from "node:stream";

import { WebSocket, WebSocketServer } from "ws";
import type { RawData } from "ws";
import type { IncomingMessage, ServerResponse } from "node:http";

import { hashToken, hashesEqual } from "./crypto.js";
import {
  decodeMessage,
  decodeStreamData,
  encodeMessage,
  PROTOCOL_VERSION,
  type AccountSnapshot,
  type ControlCommand,
  type RelayDevice,
  type StreamCloseMessage,
  type WireMessage,
} from "./protocol.js";
import { SupabaseAuthClient, type SupabaseAdminIdentity } from "./supabase.js";
import {
  SlidingWindowRateLimiter,
  extractClientIp,
  applySecurityHeaders,
  applyRateLimitHeaders,
} from "./rate-limiter.js";
import { aggregateUsageReport, type RawDatabaseData } from "./report-aggregator.js";
import { exportReportToPdf, exportReportToXlsx, exportReportToCsv, buildReportFilename } from "./report-exporter.js";
import { fiveHourRateLimit, isFiveHourResetBoundary, nextFiveHourReset, SESSION_DURATION_MS, weeklyRateLimit } from "./quota-window.js";

const DEFAULT_PORT = 10_000;
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_PAYLOAD = 8 * 1024 * 1024;
const DEFAULT_RATE_LIMIT_GLOBAL_MAX = 600;
const DEFAULT_RATE_LIMIT_API_MAX = 60;
const DEFAULT_RATE_LIMIT_RESERVATION_MAX = 10;
const DEFAULT_RATE_LIMIT_SESSION_MAX = 15;
const DEFAULT_RATE_LIMIT_WS_MAX = 30;
const DEFAULT_MAX_CONCURRENT_STREAMS_PER_DEVICE = 10;

const STATIC_ROUTES: Record<string, string> = {
  "/": "login.html",
  "/index.html": "login.html",
  "/login": "login.html",
  "/login.html": "login.html",
  "/admin": "admin.html",
  "/admin.html": "admin.html",
  "/groups": "groups.html",
  "/groups.html": "groups.html",
  "/telemetry": "telemetry.html",
  "/telemetry.html": "telemetry.html",
  "/dashboard": "dashboard.html",
  "/dashboard.html": "dashboard.html",
};

export interface RelayOptions {
  agentTokenHash: string;
  host?: string;
  port?: number;
  siteDir?: string;
  heartbeatTimeoutMs?: number;
  maxPayload?: number;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  globalRateLimitMax?: number;
  globalRateLimitWindowMs?: number;
  apiRateLimitMax?: number;
  reservationRateLimitMax?: number;
  sessionRateLimitMax?: number;
  wsRateLimitMax?: number;
  maxConcurrentStreamsPerDevice?: number;
  maxConcurrentStreamsPerIp?: number;
  trustProxy?: boolean;
}

export interface ModelPolicyStream {
  allowedModels: string[] | null;
  pendingModelListRequestIds: Set<string>;
}

interface ClientStream extends ModelPolicyStream {
  streamId: string;
  deviceId: string;
  accountId: string;
  client: WebSocket;
}

interface PendingProviderRequest {
  requestId: string;
  deviceId: string;
  response: ServerResponse;
  request: IncomingMessage;
  headersSent: boolean;
  timer: NodeJS.Timeout;
}

export interface RelayStatus {
  ready: boolean;
  hostConnected: boolean;
  registered: boolean;
  accessSynced: boolean;
  activeDevices: number;
  activeStreams: number;
  activeAccounts: number;
  defaultAccountId: string | null;
}

function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (typeof header !== "string") {
    return null;
  }

  const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

function extractApiOrBearerToken(request: IncomingMessage): string | null {
  const token = bearerToken(request);
  if (token) return token;
  const apiKey = request.headers["api-key"] || request.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.trim()) return apiKey.trim();
  return null;
}

async function readRawBody(request: IncomingMessage, maxBytes = DEFAULT_MAX_PAYLOAD): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      request.destroy(new Error("Request body too large."));
      throw new Error("Request body too large.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  const body = `${message}\n`;
  socket.write(
    `HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : status === 503 ? "Service Unavailable" : "Bad Request"}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
      body,
  );
  socket.destroy();
}

function jsonResponse(response: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(value)}\n`;
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  applySecurityHeaders(response);
  response.end(body);
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 64 * 1024) {
      request.destroy(new Error("Request body too large."));
      throw new Error("Request body too large.");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON body must be an object.");
  return parsed as Record<string, unknown>;
}

function routeParts(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

function dataError(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  for (const key of ["message", "msg", "error_description", "details"]) {
    if (typeof record[key] === "string" && record[key]) return record[key] as string;
  }
  return fallback;
}

export interface AvailableModel {
  id: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  defaultReasoningEffort: string | null;
}

export function normalizeModelCatalog(value: unknown): AvailableModel[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const outer = value as Record<string, unknown>;
  const result = outer.result && typeof outer.result === "object" && !Array.isArray(outer.result)
    ? outer.result as Record<string, unknown>
    : outer;
  if (!Array.isArray(result.data)) return [];
  const models: AvailableModel[] = [];
  const seen = new Set<string>();
  for (const item of result.data) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const model = item as Record<string, unknown>;
    const id = typeof model.id === "string" ? model.id.trim() : typeof model.model === "string" ? model.model.trim() : "";
    if (!id || seen.has(id) || model.hidden === true) continue;
    seen.add(id);
    models.push({
      id,
      displayName: typeof model.displayName === "string" && model.displayName.trim() ? model.displayName.trim() : id,
      description: typeof model.description === "string" ? model.description.trim() : "",
      isDefault: model.isDefault === true,
      defaultReasoningEffort: typeof model.defaultReasoningEffort === "string" ? model.defaultReasoningEffort : null,
    });
  }
  return models;
}

function jsonRpcIdKey(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? `${typeof value}:${String(value)}` : null;
}

function requestedModels(value: unknown, result = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value)) {
    for (const item of value) requestedModels(item, result);
    return result;
  }
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (key === "model" && typeof candidate === "string" && candidate.trim()) result.add(candidate.trim());
    else requestedModels(candidate, result);
  }
  return result;
}

export function applyModelPolicyToClientFrame(payload: string, stream: ModelPolicyStream): { payload?: string; error?: string } {
  if (!stream.allowedModels?.length) return { payload };
  let request: Record<string, unknown>;
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { payload };
    request = parsed as Record<string, unknown>;
  } catch {
    return { payload };
  }
  const method = typeof request.method === "string" ? request.method : "";
  if (method === "model/list") {
    const key = jsonRpcIdKey(request.id);
    if (key) stream.pendingModelListRequestIds.add(key);
  }
  const selectedModels = requestedModels(request.params);
  const denied = [...selectedModels].find((model) => !stream.allowedModels?.includes(model));
  if (denied) return { error: `O modelo ${denied} foi desativado pelo administrador.` };
  if (["thread/start", "thread/resume", "thread/fork", "turn/start"].includes(method)) {
    const params = request.params && typeof request.params === "object" && !Array.isArray(request.params)
      ? request.params as Record<string, unknown>
      : {};
    if (typeof params.model !== "string" || !params.model.trim()) {
      request.params = { ...params, model: stream.allowedModels[0] };
      return { payload: JSON.stringify(request) };
    }
  }
  return { payload };
}

export function applyModelPolicyToServerFrame(payload: string, stream: ModelPolicyStream): string {
  if (!stream.allowedModels?.length) return payload;
  try {
    const response = JSON.parse(payload) as Record<string, unknown>;
    const key = jsonRpcIdKey(response.id);
    if (!key || !stream.pendingModelListRequestIds.delete(key)) return payload;
    const result = response.result && typeof response.result === "object" && !Array.isArray(response.result)
      ? response.result as Record<string, unknown>
      : null;
    if (!result || !Array.isArray(result.data)) return payload;
    result.data = result.data.filter((item) => {
      if (!item || typeof item !== "object") return false;
      const model = item as Record<string, unknown>;
      const id = typeof model.model === "string" ? model.model : typeof model.id === "string" ? model.id : "";
      return stream.allowedModels?.includes(id);
    });
    return JSON.stringify(response);
  } catch {
    return payload;
  }
}

function urlHasQuery(rawUrl: string | undefined): boolean {
  return Boolean(rawUrl && new URL(rawUrl, "http://relay.invalid").search);
}

function isAllowedLoginQuery(url: URL): boolean {
  if (!["/", "/login", "/login.html"].includes(url.pathname)) return false;
  const entries = [...url.searchParams.entries()];
  return entries.length === 1 && entries[0]?.[0] === "expired" && entries[0]?.[1] === "1";
}

function staticRelativePath(pathname: string): string | null {
  const directPath = STATIC_ROUTES[pathname];
  if (directPath) return directPath;
  if (pathname.startsWith("/assets/") && pathname.length > "/assets/".length) return pathname.slice(1);
  return null;
}

function closeCode(code: number | undefined, fallback: number): number {
  if (!code || !Number.isInteger(code) || code < 1000 || code > 4999 || [1004, 1005, 1006, 1015].includes(code)) {
    return fallback;
  }
  return code;
}

function closeReason(reason: string | undefined, fallback: string): string {
  const value = reason?.trim() || fallback;
  return value.slice(0, 120);
}

function isLiveSocket(socket: WebSocket): boolean {
  return socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING;
}

function deviceUsageLimitReached(device: RelayDevice, account: AccountSnapshot | undefined): boolean {
  if (device.usage?.usageLimitReachedAt) return true;
  const effectiveBudget = device.reservationId ? 100 : device.quotaBudgetPercent;
  if (effectiveBudget != null && (device.usage?.quotaConsumedPercent ?? 0) >= effectiveBudget) return true;
  const usedPercent = (device.reservationId ? fiveHourRateLimit(account) : weeklyRateLimit(account))?.usedPercent ?? null;
  if (usedPercent === null) return false;
  const quotaBase = device.quotaBaseUsedPercent;
  const quotaBudget = effectiveBudget;
  if (quotaBase != null && quotaBudget != null) {
    const consumed = usedPercent >= quotaBase
      ? usedPercent - quotaBase
      : usedPercent;
    return consumed >= quotaBudget;
  }
  if ((device.weeklyLimitPercent ?? 100) >= 100) return false;
  return usedPercent >= (device.weeklyLimitPercent ?? 100);
}

function deviceSnapshotFromRow(row: Record<string, unknown>): Record<string, unknown> | null {
  const deviceId = typeof row.device_id === "string" ? row.device_id : null;
  const label = typeof row.label === "string" ? row.label : null;
  if (!deviceId || !label) return null;
  const numberOr = (value: unknown, fallback: number | null): number | null => typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return {
    deviceId,
    label,
    accountId: typeof row.account_id === "string" ? row.account_id : null,
    weeklyLimitPercent: numberOr(row.weekly_limit_percent, 100),
    userId: typeof row.user_id === "string" ? row.user_id : null,
    reservationId: typeof row.reservation_id === "string" ? row.reservation_id : null,
    quotaBaseUsedPercent: numberOr(row.quota_base_used_percent, null),
    quotaBudgetPercent: numberOr(row.quota_budget_percent, null),
    createdAt: row.created_at ?? null,
    expiresAt: row.expires_at ?? null,
    revokedAt: row.revoked_at ?? null,
    disabledAt: row.disabled_at ?? null,
    lastSeenAt: row.last_seen_at ?? null,
    status: typeof row.status === "string" ? row.status : "active",
    fingerprint: typeof row.fingerprint === "string" ? row.fingerprint : "indisponível",
    usage: {
      windowResetsAt: row.usage_window_resets_at ?? null,
      observedTokens: numberOr(row.observed_tokens, 0),
      observedInputTokens: numberOr(row.observed_input_tokens, 0),
      observedCachedInputTokens: numberOr(row.observed_cached_input_tokens, 0),
      observedOutputTokens: numberOr(row.observed_output_tokens, 0),
      observedReasoningTokens: numberOr(row.observed_reasoning_tokens, 0),
      lastUsageAt: row.usage_last_seen_at ?? null,
      accountUsedPercent: numberOr(row.account_used_percent, null),
      accountWindowDurationMins: numberOr(row.account_window_duration_mins, null),
      accountResetsAt: typeof row.account_resets_at === "string" && Number.isFinite(Date.parse(row.account_resets_at)) ? Math.floor(Date.parse(row.account_resets_at) / 1_000) : null,
      usageLimitReachedAt: row.usage_limit_reached_at ?? null,
    },
  };
}

export class RelayServer {
  private readonly server: http.Server;
  private readonly webSocketServer: WebSocketServer;
  private readonly options: Required<Pick<RelayOptions, "agentTokenHash" | "host" | "port" | "siteDir" | "heartbeatTimeoutMs" | "maxPayload" | "globalRateLimitMax" | "globalRateLimitWindowMs" | "apiRateLimitMax" | "reservationRateLimitMax" | "sessionRateLimitMax" | "wsRateLimitMax" | "maxConcurrentStreamsPerDevice" | "trustProxy">> & {
    supabaseUrl?: string;
    supabasePublishableKey?: string;
  };
  private readonly devices = new Map<string, RelayDevice>();
  private readonly streams = new Map<string, ClientStream>();
  private readonly clientToStream = new Map<WebSocket, string>();
  private readonly accounts = new Map<string, AccountSnapshot>();
  private readonly lastAccountSnapshots = new Map<string, AccountSnapshot>();
  private readonly pendingControls = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private readonly authClient: SupabaseAuthClient | null;
  private readonly globalLimiter: SlidingWindowRateLimiter;
  private readonly apiLimiter: SlidingWindowRateLimiter;
  private readonly reservationLimiter: SlidingWindowRateLimiter;
  private readonly sessionLimiter: SlidingWindowRateLimiter;
  private readonly authLimiter: SlidingWindowRateLimiter;
  private readonly wsLimiter: SlidingWindowRateLimiter;
  private readonly clientStreamsByDevice = new Map<string, Set<string>>();
  private readonly streamToDevice = new Map<string, string>();
  private readonly clientStreamsByIp = new Map<string, Set<string>>();
  private readonly streamToIp = new Map<string, string>();
  private readonly clientHeartbeats = new Map<WebSocket, number>();
  private wsHeartbeatTimer: NodeJS.Timeout | null = null;
  private tunnel: WebSocket | null = null;
  private hostId: string | null = null;
  private registered = false;
  private accessSynced = false;
  private tunnelConnectedAt = 0;
  private lastHeartbeatAt = 0;
  private lastSyncAt = 0;
  private defaultAccountId: string | null = null;
  private accountsSynced = false;
  private expiryTimer: NodeJS.Timeout | null = null;
  private readonly pendingProviderRequests = new Map<string, PendingProviderRequest>();

  public constructor(options: RelayOptions) {
    this.options = {
      agentTokenHash: options.agentTokenHash,
      host: options.host ?? DEFAULT_HOST,
      port: options.port ?? DEFAULT_PORT,
      siteDir: path.resolve(options.siteDir ?? path.resolve(process.cwd(), "site")),
      heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS,
      maxPayload: options.maxPayload ?? DEFAULT_MAX_PAYLOAD,
      supabaseUrl: options.supabaseUrl?.trim() || undefined,
      supabasePublishableKey: options.supabasePublishableKey?.trim() || undefined,
      globalRateLimitMax: options.globalRateLimitMax ?? DEFAULT_RATE_LIMIT_GLOBAL_MAX,
      globalRateLimitWindowMs: options.globalRateLimitWindowMs ?? 60_000,
      apiRateLimitMax: options.apiRateLimitMax ?? DEFAULT_RATE_LIMIT_API_MAX,
      reservationRateLimitMax: options.reservationRateLimitMax ?? DEFAULT_RATE_LIMIT_RESERVATION_MAX,
      sessionRateLimitMax: options.sessionRateLimitMax ?? DEFAULT_RATE_LIMIT_SESSION_MAX,
      wsRateLimitMax: options.wsRateLimitMax ?? DEFAULT_RATE_LIMIT_WS_MAX,
      maxConcurrentStreamsPerDevice: options.maxConcurrentStreamsPerDevice ?? options.maxConcurrentStreamsPerIp ?? DEFAULT_MAX_CONCURRENT_STREAMS_PER_DEVICE,
      trustProxy: options.trustProxy ?? false,
    };

    if (!/^[a-f0-9]{64}$/i.test(this.options.agentTokenHash)) {
      throw new Error("RELAY_AGENT_TOKEN_SHA256 deve ser um SHA-256 hexadecimal de 64 caracteres.");
    }
    this.authClient = this.options.supabaseUrl && this.options.supabasePublishableKey
      ? new SupabaseAuthClient(this.options.supabaseUrl, this.options.supabasePublishableKey)
      : null;

    this.globalLimiter = new SlidingWindowRateLimiter({
      maxRequests: this.options.globalRateLimitMax,
      windowMs: this.options.globalRateLimitWindowMs,
    });
    this.apiLimiter = new SlidingWindowRateLimiter({
      maxRequests: this.options.apiRateLimitMax,
      windowMs: 60_000,
    });
    this.reservationLimiter = new SlidingWindowRateLimiter({
      maxRequests: this.options.reservationRateLimitMax,
      windowMs: 60_000,
    });
    this.sessionLimiter = new SlidingWindowRateLimiter({
      maxRequests: this.options.sessionRateLimitMax,
      windowMs: 60_000,
    });
    this.authLimiter = new SlidingWindowRateLimiter({
      maxRequests: 120,
      windowMs: 60_000,
      blockDurationMs: 60_000,
    });
    this.wsLimiter = new SlidingWindowRateLimiter({
      maxRequests: this.options.wsRateLimitMax,
      windowMs: 60_000,
    });

    this.server = http.createServer((request, response) => {
      void this.handleHttp(request, response).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[relay] HTTP request failed: ${message}`);
        if (response.headersSent) {
          response.destroy();
          return;
        }
        jsonResponse(response, 500, { error: "Erro interno do relay." });
      });
    });

    // Slowloris and hanging socket mitigations
    this.server.requestTimeout = 30_000;
    this.server.headersTimeout = 35_000;
    this.server.keepAliveTimeout = 65_000;

    this.webSocketServer = new WebSocketServer({ noServer: true, maxPayload: this.options.maxPayload });
    this.server.on("upgrade", (request, socket, head) => this.handleUpgrade(request, socket, head));
  }

  public async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off("error", onError);
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(this.options.port, this.options.host);
    });

    this.expiryTimer = setInterval(() => this.pruneState(), 1_000);
    this.expiryTimer.unref();

    this.wsHeartbeatTimer = setInterval(() => this.pingClients(), 15_000);
    this.wsHeartbeatTimer.unref();
  }

  public async close(): Promise<void> {
    if (this.expiryTimer) {
      clearInterval(this.expiryTimer);
      this.expiryTimer = null;
    }
    if (this.wsHeartbeatTimer) {
      clearInterval(this.wsHeartbeatTimer);
      this.wsHeartbeatTimer = null;
    }

    this.globalLimiter.close();
    this.apiLimiter.close();
    this.reservationLimiter.close();
    this.sessionLimiter.close();
    this.authLimiter.close();
    this.wsLimiter.close();

    this.failClosed("Relay encerrado");
    for (const socket of this.clientToStream.keys()) {
      this.closeSocket(socket, 1001, "Relay encerrado");
    }

    await new Promise<void>((resolve) => {
      this.webSocketServer.close(() => resolve());
    }).catch(() => undefined);

    if (!this.server.listening) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private pingClients(): void {
    const now = Date.now();
    for (const [socket, lastSeen] of [...this.clientHeartbeats.entries()]) {
      if (socket.readyState !== WebSocket.OPEN) {
        this.clientHeartbeats.delete(socket);
        continue;
      }
      if (now - lastSeen > 45_000) {
        // Client did not respond to pings for 45s; close dead socket
        socket.terminate();
        this.clientHeartbeats.delete(socket);
        continue;
      }
      try {
        socket.ping();
      } catch {
        socket.terminate();
        this.clientHeartbeats.delete(socket);
      }
    }
  }

  public address(): ReturnType<http.Server["address"]> {
    return this.server.address();
  }

  public status(): RelayStatus {
    const hostConnected = this.tunnel?.readyState === WebSocket.OPEN;
    const defaultAccount = this.defaultAccountId ? this.accounts.get(this.defaultAccountId) : null;
    const hasReadyAccount = [...this.accounts.values()].some((account) => account.status === "ready");
    const ready = Boolean(
      hostConnected &&
      this.registered &&
      this.accessSynced &&
      this.accountsSynced &&
      (defaultAccount?.status === "ready" || hasReadyAccount) &&
      this.isFresh(),
    );
    return {
      ready,
      hostConnected,
      registered: this.registered,
      accessSynced: this.accessSynced,
      activeDevices: this.devices.size,
      activeStreams: this.streams.size,
      activeAccounts: [...this.accounts.values()].filter((account) => account.status === "ready").length,
      defaultAccountId: this.defaultAccountId,
    };
  }

  private isFresh(now = Date.now()): boolean {
    const syncTimeout = this.options.heartbeatTimeoutMs * 2;
    return (
      this.lastHeartbeatAt > 0 &&
      now - this.lastHeartbeatAt <= this.options.heartbeatTimeoutMs &&
      this.lastSyncAt > 0 &&
      now - this.lastSyncAt <= syncTimeout
    );
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const isHttps = request.headers["x-forwarded-proto"] === "https";
    applySecurityHeaders(response, isHttps);

    const clientIp = extractClientIp(request, this.options.trustProxy);
    const globalCheck = this.globalLimiter.check(clientIp);
    applyRateLimitHeaders(response, globalCheck);
    if (!globalCheck.allowed) {
      jsonResponse(response, 429, { error: "Muitas requisições. Tente novamente mais tarde.", retryAfter: globalCheck.retryAfterSec });
      return;
    }

    const url = new URL(request.url ?? "/", "http://relay.invalid");

    if (url.pathname === "/healthz") {
      jsonResponse(response, 200, { status: "ok", service: "codex-relay" });
      return;
    }

    if (url.pathname === "/readyz") {
      const status = this.status();
      jsonResponse(response, status.ready ? 200 : 503, status);
      return;
    }

    if (url.pathname === "/api/admin/config") {
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        response.statusCode = 405;
        response.end("Method Not Allowed\n");
        return;
      }
      jsonResponse(response, this.authClient ? 200 : 503, {
        supabaseUrl: this.options.supabaseUrl ?? null,
        publishableKey: this.options.supabasePublishableKey ?? null,
      });
      return;
    }

    if (
      url.pathname === "/api/codex/v1/responses" ||
      url.pathname === "/api/codex/v1/responses/compact" ||
      url.pathname === "/responses" ||
      url.pathname === "/responses/compact"
    ) {
      await this.handleProviderResponsesApi(request, response, url.pathname, clientIp);
      return;
    }

    if (url.pathname.startsWith("/api/admin/") || url.pathname.startsWith("/api/user/")) {
      const authCheck = this.authLimiter.check(clientIp);
      if (!authCheck.allowed) {
        applyRateLimitHeaders(response, authCheck);
        jsonResponse(response, 429, { error: "IP temporariamente bloqueado por excesso de tentativas de autenticação.", retryAfter: authCheck.retryAfterSec });
        return;
      }

      if (url.pathname.startsWith("/api/admin/")) {
        await this.handleAdminApi(request, response, url.pathname, clientIp);
        return;
      }

      await this.handleUserApi(request, response, url.pathname, clientIp);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      response.statusCode = 405;
      response.end("Method Not Allowed\n");
      return;
    }

    if (url.search && !isAllowedLoginQuery(url)) {
      response.statusCode = 400;
      response.end("Query strings are not used by this service.\n");
      return;
    }

    const relativePath = staticRelativePath(url.pathname);
    if (!relativePath) {
      response.statusCode = 404;
      response.end("Not Found\n");
      return;
    }

    const filePath = path.resolve(this.options.siteDir, relativePath);
    const siteRoot = path.resolve(this.options.siteDir);
    if (!filePath.startsWith(`${siteRoot}${path.sep}`) && filePath !== siteRoot) {
      response.statusCode = 400;
      response.end("Invalid path\n");
      return;
    }

    try {
      const contents = await fs.readFile(filePath);
      const extension = path.extname(filePath).toLowerCase();
      const contentType = extension === ".html"
        ? "text/html; charset=utf-8"
        : extension === ".css"
          ? "text/css; charset=utf-8"
          : extension === ".png"
            ? "image/png"
            : extension === ".woff2"
              ? "font/woff2"
              : extension === ".woff"
                ? "font/woff"
                : extension === ".svg"
                  ? "image/svg+xml"
                  : extension === ".json" || extension === ".map"
                    ? "application/json; charset=utf-8"
                    : "application/javascript; charset=utf-8";
      response.statusCode = 200;
      response.setHeader("Content-Type", contentType);
      response.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self' https://*.supabase.co https://*.supabase.in");
      if (request.method === "HEAD") {
        response.end();
      } else {
        response.end(contents);
      }
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
      response.statusCode = code === "ENOENT" ? 404 : 500;
      response.end(code === "ENOENT" ? "Not Found\n" : "Internal Server Error\n");
    }
  }

  private async handleAdminApi(request: IncomingMessage, response: ServerResponse, pathname: string, clientIp: string): Promise<void> {
    if (urlHasQuery(request.url)) {
      jsonResponse(response, 400, { error: "Query strings are not used by admin APIs." });
      return;
    }
    if (!this.authClient) {
      jsonResponse(response, 503, { error: "Supabase Auth is not configured on the relay." });
      return;
    }
    const token = bearerToken(request);
    if (!token) {
      this.authLimiter.recordFailure(clientIp);
      jsonResponse(response, 401, { error: "Supabase bearer token required." });
      return;
    }
    let identity: SupabaseAdminIdentity | null = null;
    try {
      identity = await this.authClient.authenticate(token);
    } catch {
      identity = null;
    }
    if (!identity) {
      this.authLimiter.recordFailure(clientIp);
      jsonResponse(response, 401, { error: "Supabase authentication failed." });
      return;
    }
    this.authLimiter.reset(clientIp);

    const adminCheck = this.apiLimiter.check(`admin:${identity.userId}`);
    applyRateLimitHeaders(response, adminCheck);
    if (!adminCheck.allowed) {
      jsonResponse(response, 429, { error: "Muitas requisições para a API de administração.", retryAfter: adminCheck.retryAfterSec });
      return;
    }

    const parts = routeParts(pathname);
    const method = request.method ?? "GET";
    try {
      if (method === "GET" && parts.length === 3 && parts[2] === "session") {
        jsonResponse(response, 200, {
          userId: identity.userId,
          email: identity.email,
          login: identity.login,
          role: identity.role,
        });
        return;
      }
      if (method === "GET" && parts.length === 3 && parts[2] === "accounts") {
        jsonResponse(response, 200, await this.adminAccounts(token, identity));
        return;
      }
      if (method === "GET" && parts.length === 3 && parts[2] === "settings") {
        const [result, models] = await Promise.all([
          this.authClient.rest(token, "codex_app_settings", {
            select: "max_request_quota_percent,auto_approve_quota_percent,enabled_models,updated_at,updated_by",
            singleton: "eq.true",
            limit: "1",
          }),
          this.liveModelCatalog(identity.userId).catch(() => []),
        ]);
        const settings = result.ok && Array.isArray(result.data) ? result.data[0] ?? null : null;
        if (!settings) {
          jsonResponse(response, 503, { error: "As configurações gerais ainda não estão disponíveis." });
          return;
        }
        jsonResponse(response, 200, { settings, models, modelSource: models.length > 0 ? "account-api" : "unavailable" });
        return;
      }
      if (method === "GET" && parts.length === 3 && parts[2] === "telemetry") {
        const accountResult = await this.adminAccounts(token, identity);
        let adminResult: Record<string, unknown> = { admins: [] };
        let audits: Array<Record<string, unknown>> = [];
        if (identity.role === "owner") {
          const [adminRes, auditRes] = await Promise.all([
            this.sendControlRequest("admin.list", {}, identity.userId).catch(() => ({ admins: [] })),
            this.authClient.queryAdmin<Record<string, unknown>>(token, "codex_admin_audit", {
              select: "id,actor_user_id,action,target_type,target_id,metadata,created_at",
              order: "created_at.desc",
              limit: "500",
            }),
          ]);
          adminResult = adminRes as Record<string, unknown>;
          audits = auditRes;
        }
        jsonResponse(response, 200, {
          generatedAt: new Date().toISOString(),
          ...adminResult,
          accounts: accountResult.accounts,
          hostConnected: accountResult.hostConnected,
          audits,
        });
        return;
      }
      if (method === "GET" && parts.length === 3 && parts[2] === "devices") {
        jsonResponse(response, 200, await this.adminDevices(token, identity));
        return;
      }
      if (method === "GET" && parts.length === 3 && parts[2] === "admins") {
        if (identity.role !== "owner") {
          jsonResponse(response, 403, { error: "Only the owner can manage administrators." });
          return;
        }
        const result = await this.sendControlRequest("admin.list", {}, identity.userId);
        jsonResponse(response, 200, result);
        return;
      }
      if (method === "GET" && parts.length === 3 && parts[2] === "users") {
        const profilesResultPromise = this.authClient.rest(token, "profiles", {
          select: "user_id,username,group_name,weekly_quota_percent,enabled,scheduling_enabled,created_at,updated_at",
          order: "group_name.asc,username.asc",
        });
        let usersResult = await this.authClient.rest(token, "codex_user_profiles", {
          select: "user_id,username,group_name,enabled,scheduling_enabled,created_at,updated_at",
          order: "group_name.asc,username.asc",
        });
        if (!usersResult.ok) {
          usersResult = await this.authClient.rest(token, "codex_user_profiles", {
            select: "user_id,username,group_name,enabled,created_at,updated_at",
            order: "group_name.asc,username.asc",
          });
        }
        const profilesResult = await profilesResultPromise;
        const mergedUsers = new Map<string, Record<string, unknown>>();
        if (profilesResult.ok && Array.isArray(profilesResult.data)) {
          for (const row of profilesResult.data) {
            const profile = row as Record<string, unknown>;
            const userId = typeof profile.user_id === "string" ? profile.user_id : "";
            if (userId) mergedUsers.set(userId, {
              ...profile,
              scheduling_enabled: profile.scheduling_enabled !== false,
            });
          }
        }
        if (usersResult.ok && Array.isArray(usersResult.data)) {
          for (const row of usersResult.data) {
            const profile = row as Record<string, unknown>;
            const userId = typeof profile.user_id === "string" ? profile.user_id : "";
            if (!userId) continue;
            mergedUsers.set(userId, {
              ...mergedUsers.get(userId),
              ...profile,
              scheduling_enabled: profile.scheduling_enabled !== false,
            });
          }
        }
        const users = [...mergedUsers.values()].sort((left, right) =>
          String(left.group_name || "").localeCompare(String(right.group_name || ""), "pt-BR")
          || String(left.username || "").localeCompare(String(right.username || ""), "pt-BR"));
        jsonResponse(response, 200, { users });
        return;
      }
      if (method === "GET" && parts.length === 3 && parts[2] === "reservations") {
        const reservations = await this.authClient.queryAdmin<Record<string, unknown>>(token, "codex_reservations", {
          select: "id,user_id,account_id,starts_at,ends_at,status,approval_status,requested_quota_percent,reviewed_by,reviewed_at,review_note,device_id,quota_base_used_percent,quota_budget_percent,activated_at,cancelled_at,created_at",
          order: "starts_at.desc",
          limit: "250",
        });
        jsonResponse(response, 200, { reservations });
        return;
      }

      if (method !== "POST") {
        response.setHeader("Allow", "GET, POST");
        jsonResponse(response, 405, { error: "Method not allowed." });
        return;
      }

      const body = await readJsonBody(request);

      if (parts.length === 3 && parts[2] === "settings") {
        const autoApproveEnabled = body.autoApproveEnabled === true;
        const autoApproveQuotaPercent = autoApproveEnabled ? 100 : 0;
        const enabledModels = Array.isArray(body.enabledModels)
          ? [...new Set(body.enabledModels.filter((model): model is string => typeof model === "string").map((model) => model.trim()).filter(Boolean))]
          : [];
        const availableModels = await this.liveModelCatalog(identity.userId).catch(() => []);
        const availableModelIds = new Set(availableModels.map((model) => model.id));
        if (availableModelIds.size === 0) {
          jsonResponse(response, 503, { error: "A API da conta não retornou modelos disponíveis. Tente novamente quando o host estiver conectado." });
          return;
        }
        if (enabledModels.length === 0 || enabledModels.some((model) => !availableModelIds.has(model))) {
          jsonResponse(response, 400, { error: "Mantenha ao menos um dos modelos disponíveis ativo." });
          return;
        }
        const updated = await this.authClient.rest(token, "codex_app_settings", { singleton: "eq.true" }, {
          method: "PATCH",
          body: {
            max_request_quota_percent: 100,
            auto_approve_quota_percent: autoApproveQuotaPercent,
            enabled_models: enabledModels,
            updated_at: new Date().toISOString(),
            updated_by: identity.userId,
          },
          headers: { Prefer: "return=representation" },
        });
        if (!updated.ok || !Array.isArray(updated.data) || updated.data.length !== 1) {
          jsonResponse(response, 400, { error: dataError(updated.data, "Não foi possível salvar as configurações gerais.") });
          return;
        }
        if (this.status().hostConnected) {
          const listed = await this.sendControlRequest("access.list", {}, identity.userId).catch(() => ({ devices: [] })) as Record<string, unknown>;
          const devices = Array.isArray(listed.devices) ? listed.devices as Array<Record<string, unknown>> : [];
          await Promise.allSettled(devices
            .filter((device) => typeof device.deviceId === "string" && !["revoked", "expired"].includes(String(device.status)))
            .map((device) => this.sendControlRequest("access.update-policy", { deviceId: device.deviceId, allowedModels: enabledModels }, identity.userId)));
        }
        this.recordAdminAudit(identity.userId, "settings.access.update", "settings", "general", { fixedSessionHours: 5, sessionQuotaPercent: 100, autoApproveEnabled, enabledModels });
        jsonResponse(response, 200, { settings: updated.data[0] });
        return;
      }

      // Endpoints de Relatórios de Uso (abertos para owner e admin)
      if (parts.length >= 4 && parts[2] === "reports" && parts[3] === "usage") {
        const from = typeof body.from === "string" ? body.from : "";
        const to = typeof body.to === "string" ? body.to : "";
        const timeZone = typeof body.timeZone === "string" ? body.timeZone : "America/Sao_Paulo";
        if (!from || !to) {
          jsonResponse(response, 400, { error: "Os parâmetros 'from' e 'to' são obrigatórios." });
          return;
        }

        const [profilesRes, reservationsRes, devicesRes, accountsRes, usageSamplesRes, usageEventsRes, adminAuditRes] = await Promise.all([
          this.authClient.queryAdmin<Record<string, unknown>>(token, "profiles", { select: "user_id,username,group_name,enabled" }),
          this.authClient.queryAdminAll<Record<string, unknown>>(token, "codex_reservations", {
            select: "id,user_id,account_id,starts_at,ends_at,status,approval_status,requested_quota_percent,quota_budget_percent,device_id,activated_at",
            order: "starts_at.asc",
            starts_at: `lte.${to}`,
          }),
          this.authClient.queryAdminAll<Record<string, unknown>>(token, "codex_device_snapshots", {
            select: "device_id,user_id,reservation_id,created_at,observed_tokens,observed_input_tokens,observed_cached_input_tokens,observed_output_tokens,observed_reasoning_tokens,quota_base_used_percent,account_used_percent,usage_last_seen_at,stale_at",
            order: "created_at.asc",
            created_at: `lte.${to}`,
          }),
          this.authClient.queryAdmin<Record<string, unknown>>(token, "codex_account_snapshots", {
            select: "account_id,label,status,rate_limits,usage,observed_at",
            order: "label.asc",
          }),
          this.authClient.queryAdminAll<Record<string, unknown>>(token, "codex_account_usage_samples", {
            select: "id,account_id,status,rate_limits,usage,used_percent,window_duration_mins,resets_at,observed_at",
            order: "observed_at.asc",
            observed_at: `gte.${from}`,
          }),
          this.authClient.queryAdminAll<Record<string, unknown>>(token, "codex_usage_events", {
            select: "id,event_type,device_id,user_id,reservation_id,account_id,thread_id,turn_id,model_id,status,thread_total_tokens,thread_input_tokens,thread_cached_input_tokens,thread_output_tokens,thread_reasoning_tokens,account_used_percent,account_window_duration_mins,account_resets_at,observed_at",
            order: "observed_at.asc",
            observed_at: `gte.${from}`,
          }),
          this.authClient.queryAdminAll<Record<string, unknown>>(token, "codex_admin_audit", {
            select: "id,actor_user_id,action,target_type,target_id,metadata,created_at",
            order: "created_at.asc",
            created_at: `gte.${from}`,
          }).catch(() => []),
        ]);

        const rawData: RawDatabaseData = {
          profiles: Array.isArray(profilesRes) ? profilesRes : [],
          reservations: reservationsRes,
          deviceSnapshots: devicesRes,
          accountSnapshots: accountsRes,
          accountUsageSamples: usageSamplesRes,
          usageEvents: usageEventsRes,
          adminAudit: adminAuditRes,
          hostConnected: this.status().hostConnected,
          lastHostSyncAt: this.lastSyncAt ? new Date(this.lastSyncAt).toISOString() : null,
        };

        const report = aggregateUsageReport(rawData, { from, to, timeZone });

        if (parts.length === 5 && parts[4] === "preview") {
          jsonResponse(response, 200, report);
          return;
        }

        if (parts.length === 6 && parts[4] === "export" && parts[5] === "pdf") {
          const pdfBuffer = await exportReportToPdf(report);
          const filename = buildReportFilename(report.period.from, report.period.to, "pdf");
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/pdf");
          response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
          response.setHeader("Content-Length", String(pdfBuffer.length));
          applySecurityHeaders(response);
          response.end(pdfBuffer);
          return;
        }

        if (parts.length === 6 && parts[4] === "export" && parts[5] === "xlsx") {
          const xlsxBuffer = await exportReportToXlsx(report);
          const filename = buildReportFilename(report.period.from, report.period.to, "xlsx");
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
          response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
          response.setHeader("Content-Length", String(xlsxBuffer.length));
          applySecurityHeaders(response);
          response.end(xlsxBuffer);
          return;
        }

        if (parts.length === 6 && parts[4] === "export" && parts[5] === "csv") {
          const csvContent = exportReportToCsv(report);
          const csvBuffer = Buffer.from(csvContent, "utf8");
          const filename = buildReportFilename(report.period.from, report.period.to, "csv");
          response.statusCode = 200;
          response.setHeader("Content-Type", "text/csv; charset=utf-8");
          response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
          response.setHeader("Content-Length", String(csvBuffer.length));
          applySecurityHeaders(response);
          response.end(csvBuffer);
          return;
        }

        jsonResponse(response, 404, { error: "Report endpoint not found." });
        return;
      }

      if (parts.length === 5 && parts[2] === "groups" && parts[3] && parts[4] === "scheduling") {
        if (typeof body.enabled !== "boolean") {
          jsonResponse(response, 400, { error: "Informe se o grupo pode agendar." });
          return;
        }
        const [profileUpdated, legacyUpdated] = await Promise.all([
          this.authClient.rest(token, "profiles", {
            user_id: `eq.${parts[3]}`,
          }, {
            method: "PATCH",
            body: { scheduling_enabled: body.enabled },
            headers: { Prefer: "return=representation" },
          }),
          this.authClient.rest(token, "codex_user_profiles", {
            user_id: `eq.${parts[3]}`,
          }, {
            method: "PATCH",
            body: { scheduling_enabled: body.enabled },
            headers: { Prefer: "return=representation" },
          }),
        ]);
        const updated = profileUpdated.ok && Array.isArray(profileUpdated.data) && profileUpdated.data.length === 1
          ? profileUpdated
          : legacyUpdated;
        if (!updated.ok || !Array.isArray(updated.data) || updated.data.length !== 1) {
          jsonResponse(response, 404, { error: "Grupo não encontrado." });
          return;
        }
        this.recordAdminAudit(identity.userId, body.enabled ? "group.scheduling.enable" : "group.scheduling.disable", "group", parts[3], {});
        jsonResponse(response, 200, { group: updated.data[0] });
        return;
      }
      if (parts.length === 5 && parts[2] === "groups" && parts[3] && parts[4] === "revoke-token") {
        const listed = await this.sendControlRequest("access.list", {}, identity.userId) as Record<string, unknown>;
        const devices = Array.isArray(listed.devices) ? listed.devices as Array<Record<string, unknown>> : [];
        const active = devices.filter((device) => device.userId === parts[3] && device.status !== "revoked" && device.status !== "expired");
        for (const device of active) {
          if (typeof device.deviceId === "string") {
            await this.sendControlRequest("access.revoke", { deviceId: device.deviceId }, identity.userId);
          }
        }
        this.recordAdminAudit(identity.userId, "group.token.revoke", "group", parts[3], { revoked: active.length });
        jsonResponse(response, 200, { revoked: active.length });
        return;
      }
      if (parts.length === 5 && parts[2] === "reservations" && parts[3] && ["approve", "reject"].includes(parts[4])) {
        const approvalStatus = parts[4] === "approve" ? "approved" : "rejected";
        const reviewNote = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;
        const adjustedStart = typeof body.startsAt === "string" ? new Date(body.startsAt) : null;
        const adjustedEnd = typeof body.endsAt === "string" ? new Date(body.endsAt) : null;
        const approvedQuota = 100;
        if (approvalStatus === "approved") {
          const durationMs = adjustedStart && adjustedEnd ? adjustedEnd.getTime() - adjustedStart.getTime() : Number.NaN;
          if (!adjustedStart || !adjustedEnd || Number.isNaN(durationMs) || durationMs !== SESSION_DURATION_MS) {
            jsonResponse(response, 400, { error: "Toda sessão aprovada deve ter exatamente cinco horas." });
            return;
          }
          if (adjustedEnd.getTime() <= Date.now()) {
            jsonResponse(response, 400, { error: "Não é possível aprovar uma solicitação cujo horário já terminou." });
            return;
          }
        }
        if (approvalStatus === "approved") {
          const approved = await this.authClient.rest(token, "rpc/codex_approve_reservation", {}, {
            method: "POST",
            body: {
              p_reservation_id: parts[3],
              p_starts_at: adjustedStart?.toISOString(),
              p_ends_at: adjustedEnd?.toISOString(),
              p_quota_budget_percent: approvedQuota,
              p_note: reviewNote || null,
            },
          });
          if (!approved.ok || !Array.isArray(approved.data) || approved.data.length !== 1) {
            jsonResponse(response, 409, { error: dataError(approved.data, "Não foi possível aprovar: verifique a cota disponível e o horário.") });
            return;
          }
          const reviewedReservation = approved.data[0] as Record<string, unknown>;
          this.recordAdminAudit(identity.userId, "reservation.approve", "reservation", parts[3], {
            note: reviewNote || null,
            sessionHours: 5,
            quotaPercent: 100,
          });
          jsonResponse(response, 200, { reservation: reviewedReservation });
          return;
        }
        const reviewed = await this.authClient.rest(token, "codex_reservations", {
          id: `eq.${parts[3]}`,
          status: "eq.scheduled",
          approval_status: "eq.pending",
        }, {
          method: "PATCH",
          body: {
            approval_status: "rejected",
            reviewed_by: identity.userId,
            reviewed_at: new Date().toISOString(),
            review_note: reviewNote || null,
            status: "cancelled",
            cancelled_at: new Date().toISOString(),
          },
          headers: { Prefer: "return=representation" },
        });
        if (!reviewed.ok) {
          jsonResponse(response, 409, { error: dataError(reviewed.data, "O horário ajustado conflita com outra reserva.") });
          return;
        }
        if (!Array.isArray(reviewed.data) || reviewed.data.length !== 1) {
          jsonResponse(response, 409, { error: "A solicitação já foi revisada ou não está mais disponível." });
          return;
        }
        this.recordAdminAudit(identity.userId, "reservation.reject", "reservation", parts[3], {
          note: reviewNote || null,
        });
        jsonResponse(response, 200, { reservation: reviewed.data[0] });
        return;
      }
      let command: ControlCommand;
      let payload = body;
      if (parts.length === 3 && parts[2] === "accounts") command = "account.add";
      else if (parts.length === 6 && parts[2] === "accounts" && parts[4] === "login" && parts[5] === "start" && parts[3]) command = "account.login.start";
      else if (parts.length === 5 && parts[2] === "accounts" && parts[4] === "refresh" && parts[3]) command = "account.refresh";
      else if (parts.length === 5 && parts[2] === "accounts" && parts[4] === "logout" && parts[3]) command = "account.logout";
      else if (parts.length === 5 && parts[2] === "accounts" && parts[4] === "default" && parts[3]) command = "account.set-default";
      else if (parts.length === 5 && parts[2] === "accounts" && parts[4] === "remove" && parts[3]) command = "account.remove";
      else if (parts.length === 3 && parts[2] === "devices") command = "access.issue";
      else if (parts.length === 5 && parts[2] === "devices" && parts[4] === "policy" && parts[3]) command = "access.update-policy";
      else if (parts.length === 5 && parts[2] === "devices" && parts[4] === "disable" && parts[3]) command = "access.disable";
      else if (parts.length === 5 && parts[2] === "devices" && parts[4] === "enable" && parts[3]) command = "access.enable";
      else if (parts.length === 5 && parts[2] === "devices" && parts[4] === "revoke" && parts[3]) command = "access.revoke";
      else if (parts.length === 5 && parts[2] === "devices" && parts[4] === "reactivate" && parts[3]) command = "access.reactivate";
      else if (parts.length === 4 && parts[2] === "admins" && parts[3] === "invite") {
        if (identity.role !== "owner") {
          jsonResponse(response, 403, { error: "Only the owner can invite administrators." });
          return;
        }
        command = "admin.invite";
      } else if (parts.length === 5 && parts[2] === "admins" && parts[4] === "enable" && parts[3]) {
        if (identity.role !== "owner") {
          jsonResponse(response, 403, { error: "Only the owner can manage administrators." });
          return;
        }
        command = "admin.enable";
      } else if (parts.length === 5 && parts[2] === "admins" && parts[4] === "disable" && parts[3]) {
        if (identity.role !== "owner") {
          jsonResponse(response, 403, { error: "Only the owner can manage administrators." });
          return;
        }
        command = "admin.disable";
      } else {
        jsonResponse(response, 404, { error: "Admin endpoint not found." });
        return;
      }
      if (command === "account.login.start" || command === "account.refresh" || command === "account.logout" || command === "account.remove") payload = { ...body, accountId: parts[3] };
      if (command === "account.set-default") payload = { ...body, accountId: typeof body.accountId === "string" ? body.accountId : parts[3] };
      if (command.startsWith("access.")) payload = { ...body, deviceId: parts.length >= 4 ? parts[3] : body.deviceId };
      if (command === "admin.enable" || command === "admin.disable") payload = { ...body, userId: parts[3] };
      const result = await this.sendControlRequest(command, payload, identity.userId);
      jsonResponse(response, 200, result);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes("not configured") ? 503 : message.includes("not found") ? 404 : 400;
      jsonResponse(response, status, { error: message });
    }
  }

  private async handleUserApi(request: IncomingMessage, response: ServerResponse, pathname: string, clientIp: string): Promise<void> {
    if (urlHasQuery(request.url)) {
      jsonResponse(response, 400, { error: "Query strings are not used by user APIs." });
      return;
    }
    if (!this.authClient) {
      jsonResponse(response, 503, { error: "Supabase Auth is not configured on the relay." });
      return;
    }
    const token = bearerToken(request);
    if (!token) {
      this.authLimiter.recordFailure(clientIp);
      jsonResponse(response, 401, { error: "Supabase bearer token required." });
      return;
    }
    const identity = await this.authClient.authenticateUser(token).catch(() => null);
    if (!identity) {
      this.authLimiter.recordFailure(clientIp);
      jsonResponse(response, 401, { error: "Supabase authentication failed." });
      return;
    }
    let profileResult = await this.authClient.rest(token, "profiles", {
      select: "user_id,username,group_name,enabled,scheduling_enabled,weekly_quota_percent,created_at,updated_at",
      user_id: `eq.${identity.userId}`,
      limit: "1",
    });
    if (!profileResult.ok || !Array.isArray(profileResult.data) || profileResult.data.length !== 1) {
      profileResult = await this.authClient.rest(token, "codex_user_profiles", {
        select: "user_id,username,group_name,enabled,scheduling_enabled,created_at",
        user_id: `eq.${identity.userId}`,
        limit: "1",
      });
      if (!profileResult.ok) {
        profileResult = await this.authClient.rest(token, "codex_user_profiles", {
          select: "user_id,username,group_name,enabled,created_at",
          user_id: `eq.${identity.userId}`,
          limit: "1",
        });
      }
    }
    const profileRow = profileResult.ok && Array.isArray(profileResult.data) && profileResult.data.length === 1
      ? profileResult.data[0] as Record<string, unknown>
      : null;
    const profile: Record<string, unknown> | null = profileRow
      ? { ...profileRow, scheduling_enabled: profileRow.scheduling_enabled !== false }
      : null;
    if (!profile || profile.enabled !== true) {
      this.authLimiter.recordFailure(clientIp);
      jsonResponse(response, 403, { error: "Este usuário não está habilitado para o Remote Codex." });
      return;
    }
    this.authLimiter.reset(clientIp);

    const userCheck = this.apiLimiter.check(`user:${identity.userId}`);
    applyRateLimitHeaders(response, userCheck);
    if (!userCheck.allowed) {
      jsonResponse(response, 429, { error: "Muitas requisições para a API. Tente novamente mais tarde.", retryAfter: userCheck.retryAfterSec });
      return;
    }

    const parts = routeParts(pathname);
    const method = request.method ?? "GET";
    try {
      if (method === "GET" && parts.length === 3 && parts[2] === "dashboard") {
        const rangeStart = new Date();
        rangeStart.setHours(0, 0, 0, 0);
        // Include the current week's past sessions so the user calendar matches admin history.
        rangeStart.setDate(rangeStart.getDate() - 7);
        const rangeEnd = new Date(rangeStart.getTime() + 21 * 24 * 60 * 60_000);
        const [reservationsResult, accountResult, devicesResult, busyResult, settingsResult] = await Promise.all([
          this.authClient.rest(token, "codex_reservations", {
            select: "id,account_id,starts_at,ends_at,status,approval_status,requested_quota_percent,reviewed_at,review_note,device_id,quota_base_used_percent,quota_budget_percent,activated_at,cancelled_at,created_at",
            order: "starts_at.asc",
            limit: "120",
          }),
          this.authClient.rest(token, "codex_account_snapshots", {
            select: "account_id,label,status,is_default,rate_limits,usage,observed_at",
            status: "eq.ready",
            order: "label.asc",
          }),
          this.authClient.rest(token, "codex_device_snapshots", {
            select: "device_id,reservation_id,status,expires_at,last_seen_at,observed_tokens,observed_input_tokens,observed_cached_input_tokens,observed_output_tokens,observed_reasoning_tokens,usage_last_seen_at,account_used_percent,account_window_duration_mins,account_resets_at,quota_base_used_percent,quota_budget_percent,usage_limit_reached_at",
            user_id: `eq.${identity.userId}`,
            order: "created_at.desc",
            limit: "30",
          }),
          this.authClient.rest(token, "codex_busy_slots", {
            select: "account_id,starts_at,ends_at",
            starts_at: `lt.${rangeEnd.toISOString()}`,
            ends_at: `gt.${rangeStart.toISOString()}`,
            order: "starts_at.asc",
          }),
          this.authClient.rest(token, "codex_app_settings", {
            select: "max_request_quota_percent,auto_approve_quota_percent,enabled_models",
            singleton: "eq.true",
            limit: "1",
          }),
        ]);

        let accountsList = accountResult.ok && Array.isArray(accountResult.data) ? accountResult.data as Record<string, unknown>[] : [];
        if (accountsList.length === 0) {
          accountsList = [...this.accounts.values()]
            .filter((account) => account.status === "ready")
            .map((account) => ({
              account_id: account.accountId,
              label: account.label,
              status: account.status,
              is_default: account.accountId === this.defaultAccountId,
              rate_limits: account.rateLimits,
              usage: account.usage,
              observed_at: new Date().toISOString(),
            }));
        }

        jsonResponse(response, 200, {
          serverTime: new Date().toISOString(),
          relay: this.status(),
          profile,
          reservations: reservationsResult.ok && Array.isArray(reservationsResult.data) ? reservationsResult.data : [],
          accounts: accountsList,
          account: accountsList[0] ?? null,
          devices: devicesResult.ok && Array.isArray(devicesResult.data) ? devicesResult.data : [],
          busySlots: busyResult.ok && Array.isArray(busyResult.data) ? busyResult.data : [],
          settings: settingsResult.ok && Array.isArray(settingsResult.data) ? settingsResult.data[0] ?? null : null,
        });
        return;
      }

      if (method !== "POST") {
        jsonResponse(response, 405, { error: "Method not allowed." });
        return;
      }
      const body = await readJsonBody(request);
      if (parts.length === 3 && parts[2] === "reservations") {
        const resCheck = this.reservationLimiter.check(`user:${identity.userId}`);
        applyRateLimitHeaders(response, resCheck);
        if (!resCheck.allowed) {
          jsonResponse(response, 429, { error: "Muitas tentativas de reserva. Aguarde um momento antes de tentar novamente.", retryAfter: resCheck.retryAfterSec });
          return;
        }

        const startsAt = typeof body.startsAt === "string" ? new Date(body.startsAt) : new Date(Number.NaN);
        const durationHours = 5;
        const requestedQuotaPercent = 100;
        const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
        if (Number.isNaN(startsAt.getTime())) {
          jsonResponse(response, 400, { error: "Escolha um horário válido." });
          return;
        }
        if (profile.scheduling_enabled !== true) {
          jsonResponse(response, 403, { error: "Os agendamentos deste grupo estão bloqueados pelo administrador." });
          return;
        }
        if (!accountId) {
          jsonResponse(response, 400, { error: "Escolha uma das contas disponíveis." });
          return;
        }
        const account = this.accounts.get(accountId);
        const fiveHourWindow = fiveHourRateLimit(account);
        if (!account || account.status !== "ready" || !fiveHourWindow?.resetsAt) {
          jsonResponse(response, 409, { error: "A conta ainda não informou o próximo reset da janela de 5 horas." });
          return;
        }
        const alignedStart = nextFiveHourReset(fiveHourWindow.resetsAt, startsAt.getTime());
        if (startsAt.getTime() < Date.now() - 60_000 || alignedStart === null || !isFiveHourResetBoundary(fiveHourWindow.resetsAt, startsAt.getTime())) {
          jsonResponse(response, 400, { error: alignedStart ? `A sessão deve começar em um reset da quota de 5 horas. Próximo horário: ${new Date(alignedStart).toISOString()}.` : "Não foi possível sincronizar esta conta com o reset de 5 horas." });
          return;
        }
        const inserted = await this.authClient.rest(token, "rpc/codex_request_reservation", {}, {
          method: "POST",
          body: {
            p_account_id: accountId,
            p_starts_at: startsAt.toISOString(),
            p_duration_hours: durationHours,
            p_requested_quota_percent: requestedQuotaPercent,
          },
        });
        if (!inserted.ok) {
          const message = dataError(inserted.data, "Não foi possível criar a reserva.");
          const conflict = inserted.status === 409 || /conflit|reservad|exclusion/i.test(message);
          jsonResponse(response, conflict ? 409 : 400, { error: conflict ? "Esse horário já está reservado." : message });
          return;
        }
        const reservation = Array.isArray(inserted.data) ? inserted.data[0] as Record<string, unknown> : inserted.data as Record<string, unknown>;
        const autoApproved = reservation?.approval_status === "approved";
        jsonResponse(response, 201, { reservation, autoApproved, message: autoApproved ? "Solicitação aprovada automaticamente." : "Pedido enviado para aprovação." });
        return;
      }

      const reservationId = parts[3];
      if (parts.length !== 5 || parts[2] !== "reservations" || !reservationId) {
        jsonResponse(response, 404, { error: "User endpoint not found." });
        return;
      }
      const reservationResult = await this.authClient.rest(token, "codex_reservations", {
        select: "id,user_id,account_id,starts_at,ends_at,status,approval_status,requested_quota_percent,quota_budget_percent,device_id",
        id: `eq.${reservationId}`,
        user_id: `eq.${identity.userId}`,
        limit: "1",
      });
      const reservation = reservationResult.ok && Array.isArray(reservationResult.data) && reservationResult.data.length === 1
        ? reservationResult.data[0] as Record<string, unknown>
        : null;
      if (!reservation) {
        jsonResponse(response, 404, { error: "Reserva não encontrada." });
        return;
      }

      if (parts[4] === "cancel") {
        if (reservation.status !== "scheduled" || Date.parse(String(reservation.starts_at)) <= Date.now()) {
          jsonResponse(response, 409, { error: "Somente reservas futuras podem ser canceladas." });
          return;
        }
        const cancelled = await this.authClient.rest(token, "codex_reservations", { id: `eq.${reservationId}`, user_id: `eq.${identity.userId}` }, {
          method: "PATCH",
          body: { status: "cancelled", cancelled_at: new Date().toISOString() },
          headers: { Prefer: "return=representation" },
        });
        jsonResponse(response, cancelled.ok ? 200 : 400, cancelled.ok ? { reservation: Array.isArray(cancelled.data) ? cancelled.data[0] : cancelled.data } : { error: dataError(cancelled.data, "Não foi possível cancelar.") });
        return;
      }

      if (parts[4] === "end" || parts[4] === "session") {
        const sessCheck = this.sessionLimiter.check(`user:${identity.userId}`);
        applyRateLimitHeaders(response, sessCheck);
        if (!sessCheck.allowed) {
          jsonResponse(response, 429, { error: "Muitas operações de sessão. Aguarde um momento antes de tentar novamente.", retryAfter: sessCheck.retryAfterSec });
          return;
        }
      }

      if (parts[4] === "end") {
        const now = Date.now();
        const startsAt = Date.parse(String(reservation.starts_at));
        const endsAt = Date.parse(String(reservation.ends_at));
        if (reservation.status !== "scheduled" || reservation.approval_status !== "approved" || now < startsAt || now >= endsAt || !reservation.device_id) {
          jsonResponse(response, 409, { error: "Somente sessões ativas podem ser encerradas." });
          return;
        }
        await this.sendControlRequest("access.revoke", { deviceId: String(reservation.device_id) }, identity.userId);
        jsonResponse(response, 200, { message: "Sessão encerrada.", reservationId });
        return;
      }

      if (parts[4] === "session") {
        const now = Date.now();
        const startsAt = Date.parse(String(reservation.starts_at));
        const endsAt = Date.parse(String(reservation.ends_at));
        if (reservation.status !== "scheduled" || reservation.approval_status !== "approved" || now < startsAt || now >= endsAt) {
          jsonResponse(response, 409, { error: "A credencial só fica disponível durante o horário reservado." });
          return;
        }
        const modelSettingsResult = await this.authClient.rest(token, "codex_app_settings", {
          select: "enabled_models",
          singleton: "eq.true",
          limit: "1",
        });
        const modelSettings = modelSettingsResult.ok && Array.isArray(modelSettingsResult.data)
          ? modelSettingsResult.data[0] as Record<string, unknown> | undefined
          : undefined;
        const availableModelIds = new Set((await this.liveModelCatalog(identity.userId)).map((model) => model.id));
        const allowedModels = Array.isArray(modelSettings?.enabled_models)
          ? modelSettings.enabled_models.filter((model): model is string => typeof model === "string" && availableModelIds.has(model))
          : [];
        if (allowedModels.length === 0) {
          jsonResponse(response, 503, { error: "Nenhum modelo permitido está disponível na API da conta." });
          return;
        }
        const result = await this.sendControlRequest("session.issue", {
          accountId: String(reservation.account_id),
          userId: identity.userId,
          reservationId,
          expiresAt: new Date(endsAt).toISOString(),
          quotaBudgetPercent: 100,
          allowedModels,
        }, identity.userId) as Record<string, unknown>;
        const device = result.device as Record<string, unknown> | undefined;
        let activeReservation = reservation;
        if (!reservation.device_id) {
          const updated = await this.authClient.rest(token, "codex_reservations", {
            id: `eq.${reservationId}`,
            user_id: `eq.${identity.userId}`,
            device_id: "is.null",
          }, {
            method: "PATCH",
            body: {
              device_id: device?.deviceId ?? null,
              quota_base_used_percent: device?.quotaBaseUsedPercent ?? null,
              quota_budget_percent: device?.quotaBudgetPercent ?? reservation.quota_budget_percent ?? reservation.requested_quota_percent,
              activated_at: new Date().toISOString(),
            },
            headers: { Prefer: "return=representation" },
          });
          if (!updated.ok) {
            if (device?.deviceId) await this.sendControlRequest("access.revoke", { deviceId: device.deviceId }, identity.userId).catch(() => undefined);
            const errorData = updated.data && typeof updated.data === "object" ? updated.data as Record<string, unknown> : null;
            const errorMessage = typeof errorData?.message === "string" ? errorData.message.trim() : "";
            const detail = errorMessage ? `: ${errorMessage}` : ` (HTTP ${updated.status})`;
            jsonResponse(response, 500, { error: `Não foi possível vincular a credencial à reserva${detail}` });
            return;
          }
          if (Array.isArray(updated.data) && updated.data.length === 1) {
            activeReservation = updated.data[0] as Record<string, unknown>;
          }
        }
        jsonResponse(response, 200, { ...result, reservation: activeReservation });
        return;
      }
      jsonResponse(response, 404, { error: "User endpoint not found." });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      jsonResponse(response, message.toLowerCase().includes("offline") ? 503 : 400, { error: message });
    }
  }

  private async adminAccounts(token: string, _identity: SupabaseAdminIdentity): Promise<Record<string, unknown>> {
    const status = this.status();
    // Account management and telemetry must show the release/live host state,
    // never a database snapshot that can contain removed preview accounts.
    const live = status.hostConnected && this.accountsSynced;
    const accounts = live ? [...this.accounts.values()] : [];
    const defaultAccountId = accounts.find((account) => account.isDefault)?.accountId ?? this.defaultAccountId;
    const visibleAccounts = accounts;
    return {
      role: _identity.role,
      hostConnected: status.hostConnected,
      ready: status.ready,
      stale: !live,
      source: live ? "live" : "unavailable",
      defaultAccountId,
      accounts: visibleAccounts,
    };
  }

  private async liveModelCatalog(actorId: string | null): Promise<AvailableModel[]> {
    const result = await this.sendControlRequest("account.models.list", {}, actorId);
    return normalizeModelCatalog(result);
  }

  private async adminDevices(token: string, _identity: SupabaseAdminIdentity): Promise<Record<string, unknown>> {
    const status = this.status();
    if (status.hostConnected && this.registered) {
      try {
        const result = await this.sendControlRequest("access.list", {}, null);
        const devices = result && typeof result === "object" && Array.isArray((result as Record<string, unknown>).devices)
          ? (result as Record<string, unknown>).devices
          : [];
        return { hostConnected: true, stale: false, devices };
      } catch {
        // The central host may be restarting; use the last sanitized snapshot below.
      }
    }

    const rows = await this.authClient?.queryAdmin<Record<string, unknown>>(token, "codex_device_snapshots", {
      select: "device_id,label,account_id,weekly_limit_percent,user_id,reservation_id,quota_base_used_percent,quota_budget_percent,created_at,expires_at,revoked_at,disabled_at,last_seen_at,status,fingerprint,usage_window_resets_at,observed_tokens,observed_input_tokens,observed_cached_input_tokens,observed_output_tokens,observed_reasoning_tokens,account_used_percent,account_window_duration_mins,account_resets_at,usage_limit_reached_at,usage_last_seen_at,stale_at",
      order: "created_at.desc",
    }) ?? [];
    return {
      hostConnected: status.hostConnected,
      stale: true,
      devices: rows.map(deviceSnapshotFromRow).filter((device): device is Record<string, unknown> => device !== null),
    };
  }

  private sendControlRequest(command: ControlCommand, payload: Record<string, unknown>, actorId: string | null): Promise<unknown> {
    if (!this.tunnel || this.tunnel.readyState !== WebSocket.OPEN || !this.registered) {
      return Promise.reject(new Error("Central host is offline."));
    }
    const requestId = `control-${crypto.randomUUID()}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingControls.delete(requestId);
        reject(new Error("Central host control request timed out."));
      }, 20_000);
      this.pendingControls.set(requestId, { resolve, reject, timer });
      this.sendToTunnel({ v: PROTOCOL_VERSION, type: "control.request", requestId, command, payload, actorId });
    });
  }

  private recordAdminAudit(actorId: string, action: string, targetType: string, targetId: string | null, metadata: Record<string, unknown>): void {
    void this.sendControlRequest("audit.write", { action, targetType, targetId, metadata }, actorId).catch(() => undefined);
  }

  private async handleProviderResponsesApi(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
    clientIp: string,
  ): Promise<void> {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      jsonResponse(response, 405, { error: { message: "Method Not Allowed" } });
      return;
    }

    const token = extractApiOrBearerToken(request);
    if (!token) {
      jsonResponse(response, 401, {
        error: {
          message: "Token de autenticação não fornecido no cabeçalho Authorization: Bearer <token>.",
          type: "authentication_error",
        },
      });
      return;
    }

    const device = this.findDevice(token);
    if (!device) {
      this.authLimiter.recordFailure(clientIp);
      jsonResponse(response, 401, {
        error: {
          message: "Token inválido, expirado, revogado ou com cota de sessão esgotada.",
          type: "authentication_error",
        },
      });
      return;
    }
    this.authLimiter.reset(clientIp);

    if (this.tunnel?.readyState !== WebSocket.OPEN || !this.registered) {
      jsonResponse(response, 503, {
        error: {
          message: "Host central offline. O relay está aguardando a reconexão do host.",
          type: "service_unavailable",
        },
      });
      return;
    }

    const accountId = device.accountId ?? this.defaultAccountId;
    if (!accountId) {
      jsonResponse(response, 503, {
        error: {
          message: "Nenhuma conta vinculada disponível.",
          type: "service_unavailable",
        },
      });
      return;
    }

    let bodyString = "";
    try {
      bodyString = await readRawBody(request, this.options.maxPayload ?? DEFAULT_MAX_PAYLOAD);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Falha ao ler corpo da requisição.";
      jsonResponse(response, 400, { error: { message: msg } });
      return;
    }

    let parsedBody: Record<string, unknown> | null = null;
    try {
      parsedBody = JSON.parse(bodyString);
    } catch {
      parsedBody = null;
    }

    const requestedModel = typeof parsedBody?.model === "string" ? parsedBody.model.trim() : null;
    if (device.allowedModels?.length && requestedModel && !device.allowedModels.includes(requestedModel)) {
      jsonResponse(response, 403, {
        error: {
          message: `O modelo ${requestedModel} foi desativado pelo administrador.`,
          type: "permission_error",
        },
      });
      return;
    }

    const requestId = `prov_${crypto.randomUUID()}`;

    // Mark access seen
    this.sendToTunnel({
      v: PROTOCOL_VERSION,
      type: "access.seen",
      deviceId: device.deviceId,
    });

    const forwardedHeaders: Record<string, string> = {
      "content-type": "application/json",
      "accept": "text/event-stream",
    };
    if (typeof request.headers["x-request-id"] === "string") {
      forwardedHeaders["x-request-id"] = request.headers["x-request-id"];
    }

    const timer = setTimeout(() => {
      const pending = this.pendingProviderRequests.get(requestId);
      if (pending) {
        this.pendingProviderRequests.delete(requestId);
        if (!pending.headersSent) {
          jsonResponse(pending.response, 504, {
            error: {
              message: "Tempo limite de resposta do host central esgotado.",
              type: "timeout_error",
            },
          });
        } else {
          pending.response.end();
        }
        this.sendToTunnel({
          v: PROTOCOL_VERSION,
          type: "provider.abort",
          requestId,
          reason: "timeout",
        });
      }
    }, 10 * 60 * 1000);
    timer.unref();

    const pendingReq: PendingProviderRequest = {
      requestId,
      deviceId: device.deviceId,
      response,
      request,
      headersSent: false,
      timer,
    };
    this.pendingProviderRequests.set(requestId, pendingReq);

    request.on("close", () => {
      const active = this.pendingProviderRequests.get(requestId);
      if (active && !response.writableEnded) {
        clearTimeout(active.timer);
        this.pendingProviderRequests.delete(requestId);
        this.sendToTunnel({
          v: PROTOCOL_VERSION,
          type: "provider.abort",
          requestId,
          reason: "client_closed",
        });
      }
    });

    this.sendToTunnel({
      v: PROTOCOL_VERSION,
      type: "provider.request",
      requestId,
      deviceId: device.deviceId,
      accountId,
      method: "POST",
      path: pathname,
      headers: forwardedHeaders,
      body: bodyString,
    });
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(request.url ?? "/", "http://relay.invalid");
    if (url.search) {
      rejectUpgrade(socket, 400, "Query strings are not accepted.");
      return;
    }

    const clientIp = extractClientIp(request, this.options.trustProxy);

    if (url.pathname === "/tunnel") {
      const token = bearerToken(request);
      if (!token || !hashesEqual(hashToken(token), this.options.agentTokenHash)) {
        rejectUpgrade(socket, 401, "Tunnel authentication failed.");
        return;
      }

      this.webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        this.handleTunnel(webSocket);
      });
      return;
    }

    // O Codex CLI aceita apenas o endereco WSS sem caminho. Mantemos
    // /codex como alias para clientes que conseguem configurar o caminho.
    if (url.pathname === "/" || url.pathname === "/codex") {
      const authCheck = this.authLimiter.check(clientIp);
      if (!authCheck.allowed) {
        rejectUpgrade(socket, 429, "IP temporarily blocked due to repeated auth failures.");
        return;
      }

      if (!this.status().ready) {
        rejectUpgrade(socket, 503, "Central host is not connected and synchronized.");
        return;
      }

      const token = bearerToken(request);
      const device = token ? this.findDevice(token) : null;
      if (!device) {
        this.authLimiter.recordFailure(clientIp);
        rejectUpgrade(socket, 401, "Device authentication failed.");
        return;
      }
      this.authLimiter.reset(clientIp);

      const wsCheck = this.wsLimiter.check(`device:${device.deviceId}`);
      if (!wsCheck.allowed) {
        rejectUpgrade(socket, 429, "Too Many Requests");
        return;
      }

      const activeStreamsForDevice = this.clientStreamsByDevice.get(device.deviceId)?.size ?? 0;
      if (activeStreamsForDevice >= this.options.maxConcurrentStreamsPerDevice) {
        rejectUpgrade(socket, 429, "Too many concurrent connections for this device.");
        return;
      }

      this.webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        this.handleClient(webSocket, device, clientIp);
      });
      return;
    }

    rejectUpgrade(socket, 400, "Unknown WebSocket endpoint.");
  }

  private findDevice(token: string): RelayDevice | null {
    const now = Date.now();
    const presentedHash = hashToken(token);
    for (const device of this.devices.values()) {
      if (device.revokedAt !== null || device.disabledAt !== null || Date.parse(device.expiresAt) <= now) {
        continue;
      }
      if (hashesEqual(presentedHash, device.tokenHash)) {
        const accountId = device.accountId ?? this.defaultAccountId;
        const account = accountId ? this.accounts.get(accountId) : undefined;
        if (!account || account.status !== "ready" || deviceUsageLimitReached(device, account)) return null;
        return device;
      }
    }
    return null;
  }

  private handleTunnel(webSocket: WebSocket): void {
    if (this.tunnel && this.tunnel !== webSocket) {
      this.failClosed("Túnel central substituído");
    }

    this.tunnel = webSocket;
    this.hostId = null;
    this.registered = false;
    this.accessSynced = false;
    this.accountsSynced = false;
    this.tunnelConnectedAt = Date.now();
    this.lastHeartbeatAt = this.tunnelConnectedAt;
    this.lastSyncAt = 0;
    this.devices.clear();
    this.accounts.clear();
    this.defaultAccountId = null;

    webSocket.on("message", (raw) => this.handleTunnelMessage(webSocket, raw));
    webSocket.on("close", () => {
      if (this.tunnel === webSocket) {
        this.failClosed("Túnel central desconectado");
      }
    });
    webSocket.on("error", () => {
      if (this.tunnel === webSocket) {
        this.failClosed("Erro no túnel central");
      }
    });
  }

  private handleTunnelMessage(webSocket: WebSocket, raw: import("ws").RawData): void {
    if (this.tunnel !== webSocket) {
      return;
    }

    this.lastHeartbeatAt = Date.now();
    const message = decodeMessage(raw);
    if (!message) {
      this.failClosed("Mensagem interna inválida");
      return;
    }

    switch (message.type) {
      case "register":
        this.hostId = message.hostId;
        this.registered = true;
        return;
      case "access.sync":
        if (!this.registered) {
          this.failClosed("Sincronização antes do registro");
          return;
        }
        this.applyAccessSync(message.devices);
        return;
      case "access.revoke":
        if (!this.registered) {
          return;
        }
        this.devices.delete(message.deviceId);
        this.closeDeviceStreams(message.deviceId, 4003, "Acesso revogado");
        return;
      case "accounts.sync":
        if (!this.registered) {
          this.failClosed("Sincronização de contas antes do registro");
          return;
        }
        this.applyAccountsSync(message.defaultAccountId, message.accounts);
        return;
      case "control.response": {
        const pending = this.pendingControls.get(message.requestId);
        if (!pending) return;
        this.pendingControls.delete(message.requestId);
        clearTimeout(pending.timer);
        if (message.ok) pending.resolve(message.result);
        else pending.reject(new Error(message.error || "Central host control request failed."));
        return;
      }
      case "stream.data":
        this.forwardDataToClient(message);
        return;
      case "stream.close":
        this.closeStream(message.streamId, closeCode(message.code, 1000), closeReason(message.reason, "Host encerrou a sessão"), false);
        return;
      case "heartbeat":
        // The host emits heartbeats periodically. Receiving one is enough to
        // refresh liveness; replying would create an endless heartbeat loop.
        return;
      case "provider.response.start": {
        const pending = this.pendingProviderRequests.get(message.requestId);
        if (!pending) return;
        pending.headersSent = true;
        const responseHeaders: Record<string, string> = {
          "Content-Type": message.headers["content-type"] || "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
        };
        if (message.headers["x-request-id"]) {
          responseHeaders["x-request-id"] = message.headers["x-request-id"];
        }
        pending.response.writeHead(message.status, responseHeaders);
        return;
      }
      case "provider.response.chunk": {
        const pending = this.pendingProviderRequests.get(message.requestId);
        if (!pending) return;
        pending.response.write(message.data);
        return;
      }
      case "provider.response.end": {
        const pending = this.pendingProviderRequests.get(message.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pendingProviderRequests.delete(message.requestId);
        pending.response.end();
        return;
      }
      case "provider.response.error": {
        const pending = this.pendingProviderRequests.get(message.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pendingProviderRequests.delete(message.requestId);
        if (!pending.headersSent) {
          jsonResponse(pending.response, message.status || 500, {
            error: {
              message: message.error,
              type: "invalid_request_error",
              code: message.status === 403 ? "quota_exceeded" : "upstream_error",
            },
          });
        } else {
          pending.response.write(`event: error\ndata: ${JSON.stringify({ error: message.error })}\n\n`);
          pending.response.end();
        }
        return;
      }
      case "access.seen":
      case "stream.open":
      case "control.request":
      case "provider.request":
      case "provider.abort":
        return;
    }
  }

  private applyAccountsSync(defaultAccountId: string | null, snapshots: AccountSnapshot[]): void {
    const next = new Map<string, AccountSnapshot>();
    for (const snapshot of snapshots) {
      next.set(snapshot.accountId, snapshot);
      this.lastAccountSnapshots.set(snapshot.accountId, snapshot);
    }
    this.accounts.clear();
    for (const [accountId, snapshot] of next) this.accounts.set(accountId, snapshot);
    this.defaultAccountId = defaultAccountId;
    this.accountsSynced = true;
    this.lastSyncAt = Date.now();
  }

  private applyAccessSync(nextDevices: RelayDevice[]): void {
    const now = Date.now();
    const next = new Map<string, RelayDevice>();
    const quotaBlocked = new Set<string>();
    for (const device of nextDevices) {
      const accountId = device.accountId ?? this.defaultAccountId;
      const account = accountId ? this.accounts.get(accountId) : undefined;
      const limited = deviceUsageLimitReached(device, account);
      if (limited) quotaBlocked.add(device.deviceId);
      if (device.revokedAt !== null || device.disabledAt !== null || Date.parse(device.expiresAt) <= now || !account || account.status !== "ready" || limited) {
        continue;
      }
      next.set(device.deviceId, device);
    }

    for (const deviceId of this.devices.keys()) {
      if (!next.has(deviceId)) {
        this.closeDeviceStreams(deviceId, 4003, quotaBlocked.has(deviceId) ? "Cota aprovada da sessão esgotada" : "Acesso revogado ou expirado");
      }
    }

    this.devices.clear();
    for (const [deviceId, device] of next) {
      this.devices.set(deviceId, device);
    }
    this.accessSynced = true;
    this.lastSyncAt = Date.now();
  }

  private handleClient(webSocket: WebSocket, device: RelayDevice, clientIp: string): void {
    const streamId = cryptoRandomId();
    const accountId = device.accountId ?? this.defaultAccountId;
    const account = accountId ? this.accounts.get(accountId) : undefined;
    if (!accountId || !account || account.status !== "ready") {
      this.closeSocket(webSocket, 1013, "A conta escolhida não está disponível");
      return;
    }
    if (deviceUsageLimitReached(device, account)) {
      this.closeSocket(webSocket, 1008, "Cota aprovada da sessão esgotada");
      return;
    }
    const stream: ClientStream = {
      streamId,
      deviceId: device.deviceId,
      accountId,
      client: webSocket,
      allowedModels: device.allowedModels ?? null,
      pendingModelListRequestIds: new Set(),
    };
    this.streams.set(streamId, stream);
    this.clientToStream.set(webSocket, streamId);
    this.streamToIp.set(streamId, clientIp);
    this.streamToDevice.set(streamId, device.deviceId);

    let devStreams = this.clientStreamsByDevice.get(device.deviceId);
    if (!devStreams) {
      devStreams = new Set();
      this.clientStreamsByDevice.set(device.deviceId, devStreams);
    }
    devStreams.add(streamId);

    let ipStreams = this.clientStreamsByIp.get(clientIp);
    if (!ipStreams) {
      ipStreams = new Set();
      this.clientStreamsByIp.set(clientIp, ipStreams);
    }
    ipStreams.add(streamId);

    this.clientHeartbeats.set(webSocket, Date.now());
    webSocket.on("pong", () => {
      this.clientHeartbeats.set(webSocket, Date.now());
    });

    webSocket.on("message", (raw, isBinary) => {
      this.clientHeartbeats.set(webSocket, Date.now());
      const current = this.streams.get(streamId);
      if (!current || current.client !== webSocket) {
        return;
      }
      const sourceBuffer = rawToBuffer(raw);
      const sourceText = sourceBuffer.toString("utf8");
      const policyResult = applyModelPolicyToClientFrame(sourceText, current);
      if (policyResult.error) {
        let id: unknown = null;
        try { id = (JSON.parse(sourceText) as Record<string, unknown>).id ?? null; } catch { id = null; }
        const errorPayload = JSON.stringify({ id, error: { code: -32602, message: policyResult.error } });
        webSocket.send(isBinary ? Buffer.from(errorPayload, "utf8") : errorPayload);
        return;
      }
      const filteredText = policyResult.payload ?? sourceText;
      const payload = isBinary
        ? (filteredText === sourceText ? sourceBuffer : Buffer.from(filteredText, "utf8")).toString("base64")
        : filteredText;
      this.sendToTunnel({
        v: PROTOCOL_VERSION,
        type: "stream.data",
        streamId,
        kind: isBinary ? "binary" : "text",
        data: payload,
      });
    });
    webSocket.on("close", () => {
      this.closeStream(streamId, 1000, "Cliente desconectado", true);
    });
    webSocket.on("error", () => undefined);

    this.sendToTunnel({ v: PROTOCOL_VERSION, type: "stream.open", streamId, deviceId: device.deviceId, accountId, reservationId: device.reservationId ?? null });
    this.sendToTunnel({ v: PROTOCOL_VERSION, type: "access.seen", deviceId: device.deviceId });
  }

  private forwardDataToClient(message: Extract<WireMessage, { type: "stream.data" }>): void {
    const stream = this.streams.get(message.streamId);
    if (!stream || stream.client.readyState !== WebSocket.OPEN) {
      return;
    }

    let payload = decodeStreamData(message);
    if (typeof payload === "string") {
      payload = applyModelPolicyToServerFrame(payload, stream);
    } else {
      const sourceText = payload.toString("utf8");
      const filteredText = applyModelPolicyToServerFrame(sourceText, stream);
      if (filteredText !== sourceText) payload = Buffer.from(filteredText, "utf8");
    }
    stream.client.send(payload, { binary: message.kind === "binary" });
  }

  private sendToTunnel(message: WireMessage): void {
    if (!this.tunnel || this.tunnel.readyState !== WebSocket.OPEN) {
      return;
    }
    this.tunnel.send(encodeMessage(message));
  }

  private closeDeviceStreams(deviceId: string, code: number, reason: string): void {
    for (const stream of [...this.streams.values()]) {
      if (stream.deviceId === deviceId) {
        this.closeStream(stream.streamId, code, reason, true);
      }
    }
    this.devices.delete(deviceId);
  }

  private closeStream(streamId: string, code: number, reason: string, notifyTunnel: boolean): void {
    const stream = this.streams.get(streamId);
    if (!stream) {
      return;
    }

    this.streams.delete(streamId);
    this.clientToStream.delete(stream.client);
    this.clientHeartbeats.delete(stream.client);

    const deviceId = this.streamToDevice.get(streamId);
    if (deviceId) {
      this.streamToDevice.delete(streamId);
      const devStreams = this.clientStreamsByDevice.get(deviceId);
      if (devStreams) {
        devStreams.delete(streamId);
        if (devStreams.size === 0) {
          this.clientStreamsByDevice.delete(deviceId);
        }
      }
    }

    const clientIp = this.streamToIp.get(streamId);
    if (clientIp) {
      this.streamToIp.delete(streamId);
      const ipStreams = this.clientStreamsByIp.get(clientIp);
      if (ipStreams) {
        ipStreams.delete(streamId);
        if (ipStreams.size === 0) {
          this.clientStreamsByIp.delete(clientIp);
        }
      }
    }

    if (notifyTunnel) {
      const message: StreamCloseMessage = {
        v: PROTOCOL_VERSION,
        type: "stream.close",
        streamId,
        code,
        reason,
      };
      this.sendToTunnel(message);
    }
    this.closeSocket(stream.client, code, reason);
  }

  private closeSocket(socket: WebSocket, code: number, reason: string): void {
    if (isLiveSocket(socket)) {
      try {
        socket.close(code, closeReason(reason, "Sessão encerrada"));
      } catch {
        socket.terminate();
      }
    }
  }

  private pruneState(): void {
    const now = Date.now();
    if (this.tunnel) {
      const initialSyncComplete = this.registered && this.accessSynced && this.accountsSynced;
      const initialSyncExpired = this.tunnelConnectedAt <= 0 || now - this.tunnelConnectedAt > this.options.heartbeatTimeoutMs;
      if ((!initialSyncComplete && initialSyncExpired) || (initialSyncComplete && !this.isFresh(now))) {
        this.failClosed("Túnel central sem sincronização");
        return;
      }
    }

    for (const device of [...this.devices.values()]) {
      if (device.revokedAt !== null || Date.parse(device.expiresAt) <= now) {
        this.closeDeviceStreams(device.deviceId, 4003, "Acesso expirado");
      }
    }
  }

  private failClosed(reason: string): void {
    const oldTunnel = this.tunnel;
    this.tunnel = null;
    this.hostId = null;
    this.registered = false;
    this.accessSynced = false;
    this.accountsSynced = false;
    this.tunnelConnectedAt = 0;
    this.lastHeartbeatAt = 0;
    this.lastSyncAt = 0;
    this.devices.clear();
    this.accounts.clear();
    this.defaultAccountId = null;
    this.clientHeartbeats.clear();
    this.clientStreamsByDevice.clear();
    this.streamToDevice.clear();
    this.clientStreamsByIp.clear();
    this.streamToIp.clear();

    for (const [requestId, pending] of this.pendingControls) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Central host disconnected."));
      this.pendingControls.delete(requestId);
    }

    for (const [requestId, pending] of this.pendingProviderRequests) {
      clearTimeout(pending.timer);
      if (!pending.headersSent) {
        jsonResponse(pending.response, 503, {
          error: {
            message: "Host central desconectado.",
            type: "service_unavailable",
          },
        });
      } else {
        pending.response.end();
      }
      this.pendingProviderRequests.delete(requestId);
    }

    for (const stream of [...this.streams.values()]) {
      this.closeStream(stream.streamId, 4001, "Host central indisponível", false);
    }

    if (oldTunnel && isLiveSocket(oldTunnel)) {
      this.closeSocket(oldTunnel, 4001, reason);
    }
  }
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

function cryptoRandomId(): string {
  return `stream-${crypto.randomUUID()}`;
}

export function relayAgentHashFromEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  const configuredHash = env.RELAY_AGENT_TOKEN_SHA256?.trim();
  if (configuredHash) {
    return configuredHash;
  }

  const localOnlyRawToken = env.RELAY_AGENT_TOKEN?.trim();
  if (localOnlyRawToken) {
    return hashToken(localOnlyRawToken);
  }

  throw new Error("Configure RELAY_AGENT_TOKEN_SHA256 no relay.");
}

export function relayOptionsFromEnvironment(env: NodeJS.ProcessEnv = process.env): RelayOptions {
  if (env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    throw new Error("SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY só podem existir no host central, nunca no relay.");
  }
  return {
    agentTokenHash: relayAgentHashFromEnvironment(env),
    host: env.HOST || DEFAULT_HOST,
    port: Number(env.PORT || DEFAULT_PORT),
    siteDir: env.SITE_DIR || path.resolve(process.cwd(), "site"),
    heartbeatTimeoutMs: Number(env.RELAY_HEARTBEAT_TIMEOUT_MS || DEFAULT_HEARTBEAT_TIMEOUT_MS),
    supabaseUrl: env.SUPABASE_URL?.trim() || undefined,
    supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY?.trim() || undefined,
    globalRateLimitMax: env.RATE_LIMIT_GLOBAL_MAX ? Number(env.RATE_LIMIT_GLOBAL_MAX) : undefined,
    globalRateLimitWindowMs: env.RATE_LIMIT_GLOBAL_WINDOW_MS ? Number(env.RATE_LIMIT_GLOBAL_WINDOW_MS) : undefined,
    apiRateLimitMax: env.RATE_LIMIT_API_MAX ? Number(env.RATE_LIMIT_API_MAX) : undefined,
    reservationRateLimitMax: env.RATE_LIMIT_RESERVATION_MAX ? Number(env.RATE_LIMIT_RESERVATION_MAX) : undefined,
    sessionRateLimitMax: env.RATE_LIMIT_SESSION_MAX ? Number(env.RATE_LIMIT_SESSION_MAX) : undefined,
    wsRateLimitMax: env.RATE_LIMIT_WS_MAX ? Number(env.RATE_LIMIT_WS_MAX) : undefined,
    maxConcurrentStreamsPerDevice: env.MAX_CONCURRENT_STREAMS_PER_DEVICE ? Number(env.MAX_CONCURRENT_STREAMS_PER_DEVICE) : (env.MAX_CONCURRENT_STREAMS_PER_IP ? Number(env.MAX_CONCURRENT_STREAMS_PER_IP) : undefined),
    maxConcurrentStreamsPerIp: env.MAX_CONCURRENT_STREAMS_PER_IP ? Number(env.MAX_CONCURRENT_STREAMS_PER_IP) : undefined,
    trustProxy: env.TRUST_PROXY === "true" || env.TRUST_PROXY === "1",
  };
}
