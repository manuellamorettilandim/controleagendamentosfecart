import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { WebSocket } from "ws";

import { defaultAccountTokenFile, type AccountRecord } from "./account-store.js";
import {
  type AccountRateLimit,
  type AccountRuntimeStatus,
  type AccountSnapshot,
  type AccountUsageSnapshot,
  type RateLimitWindow,
} from "./protocol.js";
import { createOpaqueToken } from "./crypto.js";

const CONTROL_TIMEOUT_MS = 20_000;

interface JsonRecord {
  [key: string]: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface AccountWorkerConfig {
  account: AccountRecord;
  codexBin: string;
  appServerStartTimeoutMs: number;
  appServerTokenFile?: string;
  startAppServer: boolean;
  stateDirectory?: string;
}

export interface AccountWorkerEvents {
  onLoginCompleted?: (payload: JsonRecord) => void;
  onSnapshotChanged?: (snapshot: AccountSnapshot) => void;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object";
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asCredits(value: unknown): Record<string, string | number | null> | null {
  if (!isRecord(value)) return null;
  const result: Record<string, string | number | null> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate === "string" || (typeof candidate === "number" && Number.isFinite(candidate)) || candidate === null) {
      result[key] = candidate;
    }
  }
  return result;
}

function asWindow(value: unknown): RateLimitWindow | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    usedPercent: asNumber(value.usedPercent),
    windowDurationMins: asNumber(value.windowDurationMins),
    resetsAt: asNumber(value.resetsAt),
    credits: asCredits(value.credits),
  };
}

function asRateLimit(value: unknown, fallbackLimitId: string): AccountRateLimit | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    limitId: asString(value.limitId) || fallbackLimitId,
    limitName: asString(value.limitName),
    primary: asWindow(value.primary),
    secondary: asWindow(value.secondary),
    rateLimitReachedType: asString(value.rateLimitReachedType),
  };
}

function asUsage(value: unknown): AccountUsageSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }
  const summary = isRecord(value.summary) ? value.summary : null;
  const buckets = Array.isArray(value.dailyUsageBuckets)
    ? value.dailyUsageBuckets
        .filter((bucket): bucket is JsonRecord => isRecord(bucket) && typeof bucket.startDate === "string")
        .map((bucket) => ({ startDate: String(bucket.startDate), tokens: asNumber(bucket.tokens) ?? 0 }))
    : null;
  return {
    lifetimeTokens: asNumber(summary?.lifetimeTokens),
    peakDailyTokens: asNumber(summary?.peakDailyTokens),
    longestRunningTurnSec: asNumber(summary?.longestRunningTurnSec),
    currentStreakDays: asNumber(summary?.currentStreakDays),
    longestStreakDays: asNumber(summary?.longestStreakDays),
    dailyUsageBuckets: buckets,
  };
}

function accountAuthMode(account: JsonRecord | null): string | null {
  return asString(account?.type);
}

function accountStatus(account: JsonRecord | null, localReady: boolean, enabled: boolean, requestError: boolean): AccountRuntimeStatus {
  if (!enabled) {
    return "disabled";
  }
  if (!localReady) {
    return "offline";
  }
  if (account === null) {
    return "login_required";
  }
  return "ready";
}

export class AccountWorker {
  public readonly account: AccountRecord;
  private readonly config: AccountWorkerConfig;
  private readonly events: AccountWorkerEvents;
  private process: ChildProcess | null = null;
  private localReady = false;
  private appServerToken = "";
  private ownsTokenFile = false;
  private controlSocket: WebSocket | null = null;
  private controlOpening: Promise<void> | null = null;
  private controlInitialized = false;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private lastSnapshot: AccountSnapshot;

  public constructor(config: AccountWorkerConfig, events: AccountWorkerEvents = {}) {
    this.config = config;
    this.account = config.account;
    this.events = events;
    this.lastSnapshot = this.emptySnapshot("offline");
  }

  public get snapshot(): AccountSnapshot {
    return this.lastSnapshot;
  }

  public get ready(): boolean {
    return this.localReady;
  }

  public async start(): Promise<void> {
    await this.prepareToken();
    if (this.config.startAppServer) {
      this.startAppServer();
    }
    await this.waitForLocalAppServer();
    this.localReady = true;
    await this.refreshSnapshot();
  }

  public async stop(): Promise<void> {
    this.localReady = false;
    this.controlSocket?.close(1000, "Account worker stopped");
    this.controlSocket = null;
    this.controlInitialized = false;
    this.controlOpening = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Account worker stopped."));
    }
    this.pending.clear();
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    if (this.ownsTokenFile) {
      await fs.rm(this.tokenFilePath(), { force: true }).catch(() => undefined);
    }
    this.lastSnapshot = this.emptySnapshot("offline");
    this.events.onSnapshotChanged?.(this.lastSnapshot);
  }

  public async refreshSnapshot(): Promise<AccountSnapshot> {
    if (!this.localReady) {
      this.lastSnapshot = this.emptySnapshot("offline");
      this.events.onSnapshotChanged?.(this.lastSnapshot);
      return this.lastSnapshot;
    }

    let account: JsonRecord | null = null;
    let requestError = false;
    try {
      const result = await this.request("account/read", { refreshToken: false });
      if (isRecord(result) && isRecord(result.account)) {
        account = result.account;
      }
    } catch {
      requestError = true;
    }

    let rateLimits: Record<string, AccountRateLimit> = {};
    try {
      const result = await this.request("account/rateLimits/read", {}) as JsonRecord;
      if (isRecord(result.rateLimitsByLimitId)) {
        for (const [key, value] of Object.entries(result.rateLimitsByLimitId)) {
          const normalized = asRateLimit(value, key);
          if (normalized) {
            rateLimits[key] = normalized;
          }
        }
      } else {
        const normalized = asRateLimit(result.rateLimits, "codex");
        if (normalized) {
          rateLimits[normalized.limitId] = normalized;
        }
      }
    } catch {
      requestError = true;
    }

    let usage: AccountUsageSnapshot | null = null;
    try {
      usage = asUsage(await this.request("account/usage/read", {}));
    } catch {
      requestError = true;
    }

    this.lastSnapshot = {
      accountId: this.account.accountId,
      label: this.account.label,
      email: asString(account?.email),
      planType: asString(account?.planType),
      authMode: accountAuthMode(account),
      status: accountStatus(account, this.localReady, this.account.enabled, requestError),
      isDefault: false,
      updatedAt: new Date().toISOString(),
      rateLimits,
      usage,
      error: requestError ? "Some account metadata is unavailable." : null,
    };
    this.events.onSnapshotChanged?.(this.lastSnapshot);
    this.events.onLoginCompleted?.({ account: account ?? null, snapshot: this.lastSnapshot });
    return this.lastSnapshot;
  }

  public async loginStart(): Promise<unknown> {
    await this.ensureStarted();
    return this.request("account/login/start", { type: "chatgptDeviceCode" });
  }

  public async logout(): Promise<unknown> {
    await this.ensureStarted();
    const result = await this.request("account/logout", {});
    await this.refreshSnapshot();
    return result;
  }

  public async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    await this.ensureControl();
    const socket = this.controlSocket;
    if (!socket || socket.readyState !== WebSocket.OPEN || !this.controlInitialized) {
      throw new Error("Account app-server control connection is unavailable.");
    }

    const id = this.nextRequestId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Account app-server request timed out: ${method}`));
      }, CONTROL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  public openStream(): WebSocket {
    if (!this.localReady) {
      throw new Error("Account app-server is not ready.");
    }
    return new WebSocket(`ws://127.0.0.1:${this.account.appServerPort}`, {
      headers: { Authorization: `Bearer ${this.appServerToken}` },
      handshakeTimeout: 10_000,
      maxPayload: 8 * 1024 * 1024,
    });
  }

  public snapshotForDefault(defaultAccountId: string | null): AccountSnapshot {
    return { ...this.lastSnapshot, isDefault: this.account.accountId === defaultAccountId };
  }

  private async ensureStarted(): Promise<void> {
    if (!this.localReady) {
      await this.start();
    }
  }

  private tokenFilePath(): string {
    return path.resolve(this.config.appServerTokenFile || defaultAccountTokenFile(this.account.accountId, {
      REMOTE_CODEX_STATE_DIR: this.config.stateDirectory,
    }));
  }

  private async prepareToken(): Promise<void> {
    try {
      this.appServerToken = (await fs.readFile(this.tokenFilePath(), "utf8")).trim();
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
      if (code !== "ENOENT") {
        throw error;
      }
    }
    if (!this.appServerToken) {
      this.appServerToken = createOpaqueToken();
      await fs.mkdir(path.dirname(this.tokenFilePath()), { recursive: true });
      await fs.writeFile(this.tokenFilePath(), `${this.appServerToken}\n`, { encoding: "utf8", mode: 0o600 });
      await fs.chmod(this.tokenFilePath(), 0o600).catch(() => undefined);
      this.ownsTokenFile = true;
    }
  }

  private startAppServer(): void {
    const args = [
      "app-server",
      "--listen",
      `ws://127.0.0.1:${this.account.appServerPort}`,
      "--ws-auth",
      "capability-token",
      "--ws-token-file",
      this.tokenFilePath(),
    ];
    const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(this.config.codexBin);
    this.process = spawn(this.config.codexBin, args, {
      cwd: this.account.codeHome,
      env: { ...process.env, CODEX_HOME: this.account.codeHome },
      stdio: "inherit",
      shell: useShell,
    });
    this.process.once("exit", (code, signal) => {
      this.localReady = false;
      this.process = null;
      this.lastSnapshot = this.emptySnapshot("offline", `codex app-server exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
      this.events.onSnapshotChanged?.(this.lastSnapshot);
    });
    console.log(`[host] account ${this.account.accountId} app-server started on ws://127.0.0.1:${this.account.appServerPort}.`);
  }

  private async waitForLocalAppServer(): Promise<void> {
    const deadline = Date.now() + this.config.appServerStartTimeoutMs;
    while (Date.now() < deadline) {
      const available = await new Promise<boolean>((resolve) => {
        const socket = new WebSocket(`ws://127.0.0.1:${this.account.appServerPort}`, {
          headers: { Authorization: `Bearer ${this.appServerToken}` },
          handshakeTimeout: 1_000,
        });
        let settled = false;
        const finish = (value: boolean) => {
          if (settled) return;
          settled = true;
          socket.removeAllListeners();
          if (value) socket.close(1000, "Probe complete");
          else socket.terminate();
          resolve(value);
        };
        socket.once("open", () => finish(true));
        socket.once("error", () => finish(false));
      });
      if (available) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Account app-server did not become ready: ${this.account.accountId}`);
  }

  private async ensureControl(): Promise<void> {
    if (this.controlSocket?.readyState === WebSocket.OPEN && this.controlInitialized) return;
    if (this.controlOpening) return this.controlOpening;

    this.controlOpening = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${this.account.appServerPort}`, {
        headers: { Authorization: `Bearer ${this.appServerToken}` },
        handshakeTimeout: 5_000,
        maxPayload: 8 * 1024 * 1024,
      });
      let opened = false;
      socket.once("open", () => {
        opened = true;
        this.controlSocket = socket;
        this.controlInitialized = false;
        const id = this.nextRequestId++;
        const timer = setTimeout(() => reject(new Error("app-server initialize timed out")), CONTROL_TIMEOUT_MS);
        this.pending.set(id, {
          resolve: () => {
            clearTimeout(timer);
            this.controlInitialized = true;
            socket.send(JSON.stringify({ method: "initialized", params: {} }));
            resolve();
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
          timer,
        });
        socket.send(JSON.stringify({
          id,
          method: "initialize",
          params: {
            clientInfo: { name: "remote-codex-admin", title: "Remote Codex Admin", version: "0.1.0" },
            capabilities: {},
          },
        }));
      });
      socket.on("message", (raw) => this.handleControlMessage(raw.toString()));
      socket.once("error", (error) => {
        if (!opened) reject(error);
      });
      socket.on("close", () => {
        if (this.controlSocket === socket) {
          this.controlSocket = null;
          this.controlInitialized = false;
        }
        if (this.localReady) {
          this.localReady = false;
          this.lastSnapshot = this.emptySnapshot("offline", "app-server control connection closed");
          this.events.onSnapshotChanged?.(this.lastSnapshot);
        }
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error("app-server control connection closed"));
        }
        this.pending.clear();
      });
    }).finally(() => {
      this.controlOpening = null;
    });

    return this.controlOpening;
  }

  private handleControlMessage(raw: string): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRecord(message)) return;
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (isRecord(message.error)) {
        pending.reject(new Error(asString(message.error.message) || "app-server request failed"));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method === "account/login/completed" && isRecord(message.params)) {
      this.events.onLoginCompleted?.(message.params);
      void this.refreshSnapshot().catch(() => undefined);
    }
  }

  private emptySnapshot(status: AccountRuntimeStatus, error: string | null = null): AccountSnapshot {
    return {
      accountId: this.account.accountId,
      label: this.account.label,
      email: null,
      planType: null,
      authMode: null,
      status,
      isDefault: false,
      updatedAt: null,
      rateLimits: {},
      usage: null,
      error,
    };
  }
}
