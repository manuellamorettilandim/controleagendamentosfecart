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
import { accountSnapshotFromRow, SupabaseAuthClient, type SupabaseAdminIdentity } from "./supabase.js";

const DEFAULT_PORT = 10_000;
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_PAYLOAD = 8 * 1024 * 1024;

const STATIC_ROUTES: Record<string, string> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/cli": "cli.html",
  "/cli.html": "cli.html",
  "/app": "app.html",
  "/app.html": "app.html",
  "/opencode": "opencode.html",
  "/opencode.html": "opencode.html",
  "/access": "access.html",
  "/access.html": "access.html",
  "/deploy": "deploy.html",
  "/deploy.html": "deploy.html",
  "/security": "security.html",
  "/security.html": "security.html",
  "/login": "login.html",
  "/login.html": "login.html",
  "/admin": "admin.html",
  "/admin.html": "admin.html",
  "/auth.js": "auth.js",
  "/login.js": "login.js",
  "/admin.js": "admin.js",
  "/styles.css": "styles.css",
  "/site.js": "site.js",
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
}

interface ClientStream {
  streamId: string;
  deviceId: string;
  accountId: string;
  client: WebSocket;
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
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(body);
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 64 * 1024) throw new Error("Request body too large.");
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

function urlHasQuery(rawUrl: string | undefined): boolean {
  return Boolean(rawUrl && new URL(rawUrl, "http://relay.invalid").search);
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

function weeklyRateLimitUsedPercent(account: AccountSnapshot | undefined): number | null {
  if (!account) return null;
  const windows = Object.values(account.rateLimits).flatMap((limit) => [limit.primary, limit.secondary]).filter((window): window is NonNullable<typeof window> => Boolean(window));
  return windows.sort((left, right) => (right.windowDurationMins ?? 0) - (left.windowDurationMins ?? 0))[0]?.usedPercent ?? null;
}

function deviceUsageLimitReached(device: RelayDevice, account: AccountSnapshot | undefined): boolean {
  if (device.usage?.usageLimitReachedAt) return true;
  const limit = device.weeklyLimitPercent ?? 100;
  const usedPercent = weeklyRateLimitUsedPercent(account);
  return usedPercent !== null && usedPercent >= limit;
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
  private readonly options: Required<Pick<RelayOptions, "agentTokenHash" | "host" | "port" | "siteDir" | "heartbeatTimeoutMs" | "maxPayload">> & {
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
  private tunnel: WebSocket | null = null;
  private hostId: string | null = null;
  private registered = false;
  private accessSynced = false;
  private lastHeartbeatAt = 0;
  private lastSyncAt = 0;
  private defaultAccountId: string | null = null;
  private accountsSynced = false;
  private expiryTimer: NodeJS.Timeout | null = null;

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
    };

    if (!/^[a-f0-9]{64}$/i.test(this.options.agentTokenHash)) {
      throw new Error("RELAY_AGENT_TOKEN_SHA256 deve ser um SHA-256 hexadecimal de 64 caracteres.");
    }
    this.authClient = this.options.supabaseUrl && this.options.supabasePublishableKey
      ? new SupabaseAuthClient(this.options.supabaseUrl, this.options.supabasePublishableKey)
      : null;

    this.server = http.createServer((request, response) => {
      void this.handleHttp(request, response);
    });
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
  }

  public async close(): Promise<void> {
    if (this.expiryTimer) {
      clearInterval(this.expiryTimer);
      this.expiryTimer = null;
    }

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

    if (url.pathname.startsWith("/api/admin/")) {
      await this.handleAdminApi(request, response, url.pathname);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      response.statusCode = 405;
      response.end("Method Not Allowed\n");
      return;
    }

    if (url.search) {
      response.statusCode = 400;
      response.end("Query strings are not used by this service.\n");
      return;
    }

    const relativePath = STATIC_ROUTES[url.pathname];
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
      const contentType = extension === ".html" ? "text/html; charset=utf-8" : extension === ".css" ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8";
      response.statusCode = 200;
      response.setHeader("Content-Type", contentType);
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self' https://*.supabase.co https://*.supabase.in");
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

  private async handleAdminApi(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
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
      jsonResponse(response, 401, { error: "Supabase authentication failed." });
      return;
    }

    const parts = routeParts(pathname);
    const method = request.method ?? "GET";
    try {
      if (method === "GET" && parts.length === 3 && parts[2] === "accounts") {
        jsonResponse(response, 200, await this.adminAccounts(token, identity));
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

      if (method !== "POST") {
        response.setHeader("Allow", "GET, POST");
        jsonResponse(response, 405, { error: "Method not allowed." });
        return;
      }

      const body = await readJsonBody(request);
      let command: ControlCommand;
      let payload = body;
      if (parts.length === 3 && parts[2] === "accounts") command = "account.add";
      else if (parts.length === 6 && parts[2] === "accounts" && parts[4] === "login" && parts[5] === "start" && parts[3]) command = "account.login.start";
      else if (parts.length === 5 && parts[2] === "accounts" && parts[4] === "refresh" && parts[3]) command = "account.refresh";
      else if (parts.length === 5 && parts[2] === "accounts" && parts[4] === "logout" && parts[3]) command = "account.logout";
      else if (parts.length === 5 && parts[2] === "accounts" && parts[4] === "default" && parts[3]) command = "account.set-default";
      else if (parts.length === 3 && parts[2] === "devices") command = "access.issue";
      else if (parts.length === 5 && parts[2] === "devices" && parts[4] === "policy" && parts[3]) command = "access.update-policy";
      else if (parts.length === 5 && parts[2] === "devices" && parts[4] === "disable" && parts[3]) command = "access.disable";
      else if (parts.length === 5 && parts[2] === "devices" && parts[4] === "enable" && parts[3]) command = "access.enable";
      else if (parts.length === 5 && parts[2] === "devices" && parts[4] === "revoke" && parts[3]) command = "access.revoke";
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

      if (command === "account.login.start" || command === "account.refresh" || command === "account.logout") payload = { ...body, accountId: parts[3] };
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

  private async adminAccounts(token: string, _identity: SupabaseAdminIdentity): Promise<Record<string, unknown>> {
    const status = this.status();
    let accounts = [...this.accounts.values()];
    let stale = !status.hostConnected || !this.accountsSynced;
    if (accounts.length === 0 || stale) {
      const rows = await this.authClient?.queryAdmin<Record<string, unknown>>(token, "codex_account_snapshots", {
        select: "account_id,label,email,plan_type,auth_mode,status,is_default,updated_at,rate_limits,usage,error,observed_at",
        order: "account_id.asc",
      }) ?? [];
      const stored = rows.map(accountSnapshotFromRow).filter((account): account is AccountSnapshot => account !== null);
      if (stored.length > 0) accounts = stored;
      else if (accounts.length === 0) accounts = [...this.lastAccountSnapshots.values()];
      stale = !status.hostConnected || !this.accountsSynced;
    }
    const defaultAccountId = accounts.find((account) => account.isDefault)?.accountId ?? this.defaultAccountId;
    return {
      role: _identity.role,
      hostConnected: status.hostConnected,
      ready: status.ready,
      stale,
      defaultAccountId,
      accounts,
    };
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
      select: "device_id,label,account_id,weekly_limit_percent,created_at,expires_at,revoked_at,disabled_at,last_seen_at,status,fingerprint,usage_window_resets_at,observed_tokens,observed_input_tokens,observed_cached_input_tokens,observed_output_tokens,observed_reasoning_tokens,account_used_percent,account_window_duration_mins,account_resets_at,usage_limit_reached_at,usage_last_seen_at,stale_at",
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

  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(request.url ?? "/", "http://relay.invalid");
    if (url.search) {
      rejectUpgrade(socket, 400, "Query strings are not accepted.");
      return;
    }

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
      if (!this.status().ready) {
        rejectUpgrade(socket, 503, "Central host is not connected and synchronized.");
        return;
      }

      const token = bearerToken(request);
      const device = token ? this.findDevice(token) : null;
      if (!device) {
        rejectUpgrade(socket, 401, "Device authentication failed.");
        return;
      }

      this.webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        this.handleClient(webSocket, device);
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
    this.lastHeartbeatAt = Date.now();
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
        this.sendToTunnel({ v: PROTOCOL_VERSION, type: "heartbeat", timestamp: Date.now() });
        return;
      case "access.seen":
      case "stream.open":
      case "control.request":
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
    for (const device of nextDevices) {
      const accountId = device.accountId ?? this.defaultAccountId;
      const account = accountId ? this.accounts.get(accountId) : undefined;
      if (device.revokedAt !== null || device.disabledAt !== null || Date.parse(device.expiresAt) <= now || !account || account.status !== "ready" || deviceUsageLimitReached(device, account)) {
        continue;
      }
      next.set(device.deviceId, device);
    }

    for (const deviceId of this.devices.keys()) {
      if (!next.has(deviceId)) {
        this.closeDeviceStreams(deviceId, 4003, "Acesso revogado ou expirado");
      }
    }

    this.devices.clear();
    for (const [deviceId, device] of next) {
      this.devices.set(deviceId, device);
    }
    this.accessSynced = true;
    this.lastSyncAt = Date.now();
  }

  private handleClient(webSocket: WebSocket, device: RelayDevice): void {
    const streamId = cryptoRandomId();
    const accountId = device.accountId ?? this.defaultAccountId;
    const account = accountId ? this.accounts.get(accountId) : undefined;
    if (!accountId || !account || account.status !== "ready") {
      this.closeSocket(webSocket, 1013, "A conta vinculada não está disponível");
      return;
    }
    if (deviceUsageLimitReached(device, account)) {
      this.closeSocket(webSocket, 1008, "Limite semanal deste token atingido");
      return;
    }
    const stream: ClientStream = { streamId, deviceId: device.deviceId, accountId, client: webSocket };
    this.streams.set(streamId, stream);
    this.clientToStream.set(webSocket, streamId);

    webSocket.on("message", (raw, isBinary) => {
      const current = this.streams.get(streamId);
      if (!current || current.client !== webSocket) {
        return;
      }
      const payload = isBinary ? rawToBuffer(raw).toString("base64") : rawToText(raw);
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

    this.sendToTunnel({ v: PROTOCOL_VERSION, type: "stream.open", streamId, deviceId: device.deviceId, accountId });
    this.sendToTunnel({ v: PROTOCOL_VERSION, type: "access.seen", deviceId: device.deviceId });
  }

  private forwardDataToClient(message: Extract<WireMessage, { type: "stream.data" }>): void {
    const stream = this.streams.get(message.streamId);
    if (!stream || stream.client.readyState !== WebSocket.OPEN) {
      return;
    }

    const payload = decodeStreamData(message);
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
    if (this.tunnel && (!this.isFresh(now) || !this.registered || !this.accessSynced || !this.accountsSynced)) {
      this.failClosed("Túnel central sem sincronização");
      return;
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
    this.lastHeartbeatAt = 0;
    this.lastSyncAt = 0;
    this.devices.clear();
    this.accounts.clear();
    this.defaultAccountId = null;

    for (const [requestId, pending] of this.pendingControls) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Central host disconnected."));
      this.pendingControls.delete(requestId);
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
  return {
    agentTokenHash: relayAgentHashFromEnvironment(env),
    host: env.HOST || DEFAULT_HOST,
    port: Number(env.PORT || DEFAULT_PORT),
    siteDir: env.SITE_DIR || path.resolve(process.cwd(), "site"),
    heartbeatTimeoutMs: Number(env.RELAY_HEARTBEAT_TIMEOUT_MS || DEFAULT_HEARTBEAT_TIMEOUT_MS),
    supabaseUrl: env.SUPABASE_URL?.trim() || undefined,
    supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY?.trim() || undefined,
  };
}
