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
  type RelayDevice,
  type StreamCloseMessage,
  type WireMessage,
} from "./protocol.js";

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
}

interface ClientStream {
  streamId: string;
  deviceId: string;
  client: WebSocket;
}

export interface RelayStatus {
  ready: boolean;
  hostConnected: boolean;
  registered: boolean;
  accessSynced: boolean;
  activeDevices: number;
  activeStreams: number;
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

export class RelayServer {
  private readonly server: http.Server;
  private readonly webSocketServer: WebSocketServer;
  private readonly options: Required<Pick<RelayOptions, "agentTokenHash" | "host" | "port" | "siteDir" | "heartbeatTimeoutMs" | "maxPayload">>;
  private readonly devices = new Map<string, RelayDevice>();
  private readonly streams = new Map<string, ClientStream>();
  private readonly clientToStream = new Map<WebSocket, string>();
  private tunnel: WebSocket | null = null;
  private hostId: string | null = null;
  private registered = false;
  private accessSynced = false;
  private lastHeartbeatAt = 0;
  private lastSyncAt = 0;
  private expiryTimer: NodeJS.Timeout | null = null;

  public constructor(options: RelayOptions) {
    this.options = {
      agentTokenHash: options.agentTokenHash,
      host: options.host ?? DEFAULT_HOST,
      port: options.port ?? DEFAULT_PORT,
      siteDir: path.resolve(options.siteDir ?? path.resolve(process.cwd(), "site")),
      heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS,
      maxPayload: options.maxPayload ?? DEFAULT_MAX_PAYLOAD,
    };

    if (!/^[a-f0-9]{64}$/i.test(this.options.agentTokenHash)) {
      throw new Error("RELAY_AGENT_TOKEN_SHA256 deve ser um SHA-256 hexadecimal de 64 caracteres.");
    }

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
    const ready = Boolean(hostConnected && this.registered && this.accessSynced && this.isFresh());
    return {
      ready,
      hostConnected,
      registered: this.registered,
      accessSynced: this.accessSynced,
      activeDevices: this.devices.size,
      activeStreams: this.streams.size,
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
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      response.statusCode = 405;
      response.end("Method Not Allowed\n");
      return;
    }

    if (url.pathname === "/healthz") {
      jsonResponse(response, 200, { status: "ok", service: "codex-relay" });
      return;
    }

    if (url.pathname === "/readyz") {
      const status = this.status();
      jsonResponse(response, status.ready ? 200 : 503, status);
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
      response.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:");
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

    if (url.pathname === "/codex") {
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
      if (device.revokedAt !== null || Date.parse(device.expiresAt) <= now) {
        continue;
      }
      if (hashesEqual(presentedHash, device.tokenHash)) {
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
    this.lastHeartbeatAt = Date.now();
    this.lastSyncAt = 0;
    this.devices.clear();

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
        return;
    }
  }

  private applyAccessSync(nextDevices: RelayDevice[]): void {
    const now = Date.now();
    const next = new Map<string, RelayDevice>();
    for (const device of nextDevices) {
      if (device.revokedAt !== null || Date.parse(device.expiresAt) <= now) {
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
    const stream: ClientStream = { streamId, deviceId: device.deviceId, client: webSocket };
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

    this.sendToTunnel({ v: PROTOCOL_VERSION, type: "stream.open", streamId, deviceId: device.deviceId });
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
    if (this.tunnel && (!this.isFresh(now) || !this.registered || !this.accessSynced)) {
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
    this.lastHeartbeatAt = 0;
    this.lastSyncAt = 0;
    this.devices.clear();

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
  };
}
