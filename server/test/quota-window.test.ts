import assert from "node:assert/strict";
import test from "node:test";
import type { AccountSnapshot } from "../src/protocol.js";
import { fiveHourRateLimit, isFiveHourResetBoundary, nextFiveHourReset, reservationWindowForStart, SESSION_DURATION_MS, weeklyRateLimit } from "../src/quota-window.js";

const resetAt = Date.parse("2026-08-25T15:17:00.000Z") / 1_000;
const snapshot = {
  rateLimits: {
    codex: {
      limitId: "codex",
      limitName: "Codex",
      primary: { usedPercent: 31, windowDurationMins: 300, resetsAt: resetAt, credits: null },
      secondary: { usedPercent: 12, windowDurationMins: 10_080, resetsAt: resetAt + 86_400, credits: null },
      rateLimitReachedType: null,
    },
  },
} as Pick<AccountSnapshot, "rateLimits">;

test("selects the five-hour and weekly windows independently", () => {
  assert.equal(fiveHourRateLimit(snapshot)?.usedPercent, 31);
  assert.equal(weeklyRateLimit(snapshot)?.usedPercent, 12);
});

test("aligns sessions to the next reset-derived five-hour boundary", () => {
  const resetMs = resetAt * 1_000;
  assert.equal(nextFiveHourReset(resetAt, resetMs - 1), resetMs);
  assert.equal(nextFiveHourReset(resetAt, resetMs + 1), resetMs + SESSION_DURATION_MS);
  assert.equal(nextFiveHourReset(resetAt, resetMs + SESSION_DURATION_MS), resetMs + SESSION_DURATION_MS);
  assert.equal(isFiveHourResetBoundary(resetAt, resetMs + SESSION_DURATION_MS), true);
  assert.equal(isFiveHourResetBoundary(resetAt, resetMs + 60 * 60_000), false);
});

test("allows an immediate session to use only the remainder of the current window when active", () => {
  const resetMs = resetAt * 1_000;
  const nowMs = resetMs - 2 * 60 * 60_000;
  const immediate = reservationWindowForStart(resetAt, nowMs - 30_000, nowMs, { usedPercent: 15 });
  assert.deepEqual(immediate, { startsAtMs: nowMs - 30_000, endsAtMs: resetMs, complete: false });

  const complete = reservationWindowForStart(resetAt, resetMs, nowMs, { usedPercent: 15 });
  assert.deepEqual(complete, { startsAtMs: resetMs, endsAtMs: resetMs + SESSION_DURATION_MS, complete: true });

  assert.equal(reservationWindowForStart(resetAt, nowMs + 10 * 60_000, nowMs, { usedPercent: 15 }), null);
  assert.equal(reservationWindowForStart(resetAt, resetMs - 4 * 60_000, resetMs - 4 * 60_000, { usedPercent: 15 }), null);
});

test("grants a full 5-hour session on immediate start when account is idle", () => {
  const resetMs = resetAt * 1_000;
  const nowMs = resetMs - 2 * 60 * 60_000;
  const idleImmediate = reservationWindowForStart(resetAt, nowMs, nowMs, { usedPercent: 0, hasActiveReservation: false });
  assert.deepEqual(idleImmediate, { startsAtMs: nowMs, endsAtMs: nowMs + SESSION_DURATION_MS, complete: true });

  const expiredImmediate = reservationWindowForStart(nowMs / 1000 - 3600, nowMs, nowMs);
  assert.deepEqual(expiredImmediate, { startsAtMs: nowMs, endsAtMs: nowMs + SESSION_DURATION_MS, complete: true });
});
