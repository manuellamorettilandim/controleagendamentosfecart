import type { IncomingMessage, ServerResponse } from "node:http";
import net from "node:net";

export interface RateLimiterOptions {
  maxRequests: number;
  windowMs: number;
  blockDurationMs?: number;
  cleanupIntervalMs?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
  retryAfterSec?: number;
}

interface KeyRecord {
  timestamps: number[];
  blockedUntil?: number;
  failureCount?: number;
  lastFailureAt?: number;
}

export class SlidingWindowRateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly blockDurationMs: number;
  private readonly entries = new Map<string, KeyRecord>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  public constructor(options: RateLimiterOptions) {
    this.maxRequests = Math.max(1, options.maxRequests);
    this.windowMs = Math.max(1_000, options.windowMs);
    this.blockDurationMs = options.blockDurationMs ?? 0;

    const cleanupInterval = options.cleanupIntervalMs ?? 30_000;
    if (cleanupInterval > 0) {
      this.cleanupTimer = setInterval(() => this.prune(), cleanupInterval);
      this.cleanupTimer.unref();
    }
  }

  public check(key: string, cost = 1, now = Date.now()): RateLimitResult {
    const record = this.entries.get(key) ?? { timestamps: [] };

    // Verifica se a chave está em quarentena / bloqueio temporário
    if (record.blockedUntil && now < record.blockedUntil) {
      const retryAfterSec = Math.max(1, Math.ceil((record.blockedUntil - now) / 1_000));
      return {
        allowed: false,
        limit: this.maxRequests,
        remaining: 0,
        resetMs: record.blockedUntil,
        retryAfterSec,
      };
    }

    // Remove timestamps fora da janela deslizante
    const cutoff = now - this.windowMs;
    record.timestamps = record.timestamps.filter((ts) => ts > cutoff);

    if (record.timestamps.length + cost > this.maxRequests) {
      if (this.blockDurationMs > 0 && !record.blockedUntil) {
        record.blockedUntil = now + this.blockDurationMs;
      }
      const oldest = record.timestamps[0] ?? now;
      const resetMs = record.blockedUntil ?? (oldest + this.windowMs);
      const retryAfterSec = Math.max(1, Math.ceil((resetMs - now) / 1_000));
      this.entries.set(key, record);
      return {
        allowed: false,
        limit: this.maxRequests,
        remaining: 0,
        resetMs,
        retryAfterSec,
      };
    }

    for (let i = 0; i < cost; i++) {
      record.timestamps.push(now);
    }
    record.blockedUntil = undefined;
    this.entries.set(key, record);

    const oldest = record.timestamps[0] ?? now;
    const resetMs = oldest + this.windowMs;

    return {
      allowed: true,
      limit: this.maxRequests,
      remaining: Math.max(0, this.maxRequests - record.timestamps.length),
      resetMs,
    };
  }

  public recordFailure(key: string, maxFailures = 5, quarantineMs = 5 * 60_000, now = Date.now()): { quarantined: boolean; retryAfterSec?: number } {
    const record = this.entries.get(key) ?? { timestamps: [] };
    const cutoff = now - quarantineMs;

    if (!record.lastFailureAt || record.lastFailureAt < cutoff) {
      record.failureCount = 1;
    } else {
      record.failureCount = (record.failureCount ?? 0) + 1;
    }
    record.lastFailureAt = now;

    if (record.failureCount >= maxFailures) {
      record.blockedUntil = now + quarantineMs;
      this.entries.set(key, record);
      const retryAfterSec = Math.max(1, Math.ceil(quarantineMs / 1_000));
      return { quarantined: true, retryAfterSec };
    }

    this.entries.set(key, record);
    return { quarantined: false };
  }

  public reset(key: string): void {
    this.entries.delete(key);
  }

  public prune(now = Date.now()): void {
    const cutoff = now - this.windowMs;
    for (const [key, record] of this.entries.entries()) {
      if (record.blockedUntil && now < record.blockedUntil) {
        continue;
      }
      record.timestamps = record.timestamps.filter((ts) => ts > cutoff);
      const hasRecentFailures = record.lastFailureAt && record.lastFailureAt > cutoff;
      if (record.timestamps.length === 0 && !hasRecentFailures) {
        this.entries.delete(key);
      }
    }
  }

  public close(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.entries.clear();
  }

  public size(): number {
    return this.entries.size;
  }
}

export function extractClientIp(request: IncomingMessage, trustProxy = false): string {
  if (trustProxy) {
    // Cloudflare IP header
    const cfIp = request.headers["cf-connecting-ip"];
    if (typeof cfIp === "string" && isValidIp(cfIp.trim())) {
      return normalizeIp(cfIp.trim());
    }

    // Standard X-Forwarded-For (leftmost client IP)
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
      const candidate = forwarded.split(",")[0]?.trim();
      if (candidate && isValidIp(candidate)) {
        return normalizeIp(candidate);
      }
    }

    // Nginx / Caddy X-Real-IP
    const realIp = request.headers["x-real-ip"];
    if (typeof realIp === "string" && isValidIp(realIp.trim())) {
      return normalizeIp(realIp.trim());
    }
  }

  const socketIp = request.socket?.remoteAddress;
  if (typeof socketIp === "string" && isValidIp(socketIp.trim())) {
    return normalizeIp(socketIp.trim());
  }

  return "127.0.0.1";
}

function isValidIp(ip: string): boolean {
  if (!ip || ip.length > 45) return false;
  if (net.isIP(ip) !== 0) return true;
  if (ip.startsWith("::ffff:") && net.isIPv4(ip.slice(7))) {
    return true;
  }
  return false;
}

function normalizeIp(ip: string): string {
  if (ip === "::1" || ip === "::ffff:127.0.0.1") {
    return "127.0.0.1";
  }
  if (ip.startsWith("::ffff:")) {
    const v4 = ip.slice(7);
    if (net.isIPv4(v4)) return v4;
  }
  return ip.toLowerCase();
}

export function applySecurityHeaders(response: ServerResponse, isHttps = false): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  response.setHeader("X-XSS-Protection", "1; mode=block");
  if (isHttps) {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

export function applyRateLimitHeaders(response: ServerResponse, result: RateLimitResult): void {
  response.setHeader("RateLimit-Limit", String(result.limit));
  response.setHeader("RateLimit-Remaining", String(result.remaining));
  response.setHeader("RateLimit-Reset", String(Math.ceil(result.resetMs / 1_000)));
  if (!result.allowed && result.retryAfterSec) {
    response.setHeader("Retry-After", String(result.retryAfterSec));
  }
}
