import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  SlidingWindowRateLimiter,
  extractClientIp,
  applyRateLimitHeaders,
  applySecurityHeaders,
} from "../src/rate-limiter.js";

test("SlidingWindowRateLimiter limits requests within a sliding window", () => {
  const limiter = new SlidingWindowRateLimiter({
    maxRequests: 3,
    windowMs: 10_000,
    cleanupIntervalMs: 0,
  });

  const key = "192.168.1.100";
  const now = 1_000_000;

  const res1 = limiter.check(key, 1, now);
  assert.equal(res1.allowed, true);
  assert.equal(res1.remaining, 2);

  const res2 = limiter.check(key, 1, now + 1_000);
  assert.equal(res2.allowed, true);
  assert.equal(res2.remaining, 1);

  const res3 = limiter.check(key, 1, now + 2_000);
  assert.equal(res3.allowed, true);
  assert.equal(res3.remaining, 0);

  // 4th request must be rejected
  const res4 = limiter.check(key, 1, now + 3_000);
  assert.equal(res4.allowed, false);
  assert.equal(res4.remaining, 0);
  assert.ok((res4.retryAfterSec ?? 0) > 0);

  // After window expires for the first request, request should be allowed again
  const res5 = limiter.check(key, 1, now + 10_500);
  assert.equal(res5.allowed, true);

  limiter.close();
});

test("SlidingWindowRateLimiter quarantines IPs after repeated authentication failures", () => {
  const limiter = new SlidingWindowRateLimiter({
    maxRequests: 10,
    windowMs: 60_000,
    cleanupIntervalMs: 0,
  });

  const ip = "10.0.0.50";
  const now = 2_000_000;

  for (let i = 1; i <= 4; i++) {
    const res = limiter.recordFailure(ip, 5, 300_000, now + i * 1_000);
    assert.equal(res.quarantined, false);
  }

  // 5th failure must trigger quarantine
  const res5 = limiter.recordFailure(ip, 5, 300_000, now + 5_000);
  assert.equal(res5.quarantined, true);
  assert.equal(res5.retryAfterSec, 300);

  // Subsequent checks are blocked during quarantine
  const check = limiter.check(ip, 1, now + 10_000);
  assert.equal(check.allowed, false);
  assert.ok(check.retryAfterSec && check.retryAfterSec > 0);

  // Reset clears quarantine
  limiter.reset(ip);
  const checkAfterReset = limiter.check(ip, 1, now + 10_000);
  assert.equal(checkAfterReset.allowed, true);

  limiter.close();
});

test("extractClientIp extracts IP safely and handles spoofing attempts", () => {
  const reqWithCf = {
    headers: {
      "cf-connecting-ip": "203.0.113.195",
      "x-forwarded-for": "198.51.100.1, 10.0.0.1",
    },
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as IncomingMessage;
  assert.equal(extractClientIp(reqWithCf, true), "203.0.113.195");

  const reqWithForwarded = {
    headers: {
      "x-forwarded-for": "198.51.100.22, 10.0.0.1",
    },
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as IncomingMessage;
  assert.equal(extractClientIp(reqWithForwarded, true), "198.51.100.22");

  const reqWithInvalidHeader = {
    headers: {
      "x-forwarded-for": "malicious<script>alert(1)</script>",
    },
    socket: { remoteAddress: "192.168.1.5" },
  } as unknown as IncomingMessage;
  assert.equal(extractClientIp(reqWithInvalidHeader, true), "192.168.1.5");

  const reqWithoutTrustProxy = {
    headers: {
      "x-forwarded-for": "198.51.100.99",
    },
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as IncomingMessage;
  assert.equal(extractClientIp(reqWithoutTrustProxy, false), "127.0.0.1");

  const reqWithIpv6Mapped = {
    headers: {},
    socket: { remoteAddress: "::ffff:192.168.1.10" },
  } as unknown as IncomingMessage;
  assert.equal(extractClientIp(reqWithIpv6Mapped, false), "192.168.1.10");
});

test("applySecurityHeaders and applyRateLimitHeaders set expected headers", () => {
  const headers = new Map<string, string>();
  const fakeResponse = {
    setHeader: (name: string, value: string) => {
      headers.set(name.toLowerCase(), value);
    },
  } as unknown as ServerResponse;

  applySecurityHeaders(fakeResponse, true);
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.ok(headers.get("strict-transport-security")?.includes("max-age=31536000"));

  applyRateLimitHeaders(fakeResponse, {
    allowed: false,
    limit: 60,
    remaining: 0,
    resetMs: 1_700_000_000_000,
    retryAfterSec: 45,
  });
  assert.equal(headers.get("ratelimit-limit"), "60");
  assert.equal(headers.get("ratelimit-remaining"), "0");
  assert.equal(headers.get("retry-after"), "45");
});
