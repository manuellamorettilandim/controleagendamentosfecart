import assert from "node:assert/strict";
import test from "node:test";
import type { AccountSnapshot } from "../src/protocol.js";
import { fiveHourRateLimit, fixedDailySlotForStart, isFiveHourResetBoundary, isFixedDailySlot, nextFiveHourReset, reservationWindowForStart, SESSION_DURATION_MS, weeklyRateLimit } from "../src/quota-window.js";

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

test("validates fixed daily slots for America/Sao_Paulo", () => {
  // 04:00 UTC-3 is 07:00 UTC (duration 5h)
  assert.equal(isFixedDailySlot(new Date("2026-09-05T07:00:00Z"), 5), true);
  // 04:00 with wrong duration
  assert.equal(isFixedDailySlot(new Date("2026-09-05T07:00:00Z"), 1), false);

  // 09:00 UTC-3 is 12:00 UTC (duration 5h)
  assert.equal(isFixedDailySlot(new Date("2026-09-05T12:00:00Z"), 5), true);
  // 14:00 UTC-3 is 17:00 UTC (duration 5h)
  assert.equal(isFixedDailySlot(new Date("2026-09-05T17:00:00Z"), 5), true);
  // 19:00 UTC-3 is 22:00 UTC (duration 5h)
  assert.equal(isFixedDailySlot(new Date("2026-09-05T22:00:00Z"), 5), true);

  // Non-fixed hour (e.g. 10:00)
  assert.equal(isFixedDailySlot(new Date("2026-09-05T13:00:00Z"), 5), false);
  // Non-zero minute (e.g. 14:25)
  assert.equal(isFixedDailySlot(new Date("2026-09-05T17:25:00Z"), 5), false);
});

test("maps every instant to the product fixed slot independently of provider reset data", () => {
  assert.deepEqual(fixedDailySlotForStart(Date.parse("2026-09-05T20:30:00Z")), { startHour: 14, endHour: 19, durationHours: 5 });
  assert.deepEqual(fixedDailySlotForStart(Date.parse("2026-09-05T23:30:00Z")), { startHour: 19, endHour: 24, durationHours: 5 });
  assert.deepEqual(fixedDailySlotForStart(Date.parse("2026-09-05T11:30:00Z")), { startHour: 4, endHour: 9, durationHours: 5 });
  assert.equal(fixedDailySlotForStart(Date.parse("2026-09-05T06:30:00Z")), null);
});

 test("rejects sub-minute fixed starts and obsolete overlapping slot", () => {
  assert.equal(isFixedDailySlot(new Date("2026-09-05T07:00:01Z"), 5), false);
  assert.equal(isFixedDailySlot(new Date("2026-09-05T07:00:00.001Z"), 5), false);
  assert.equal(isFixedDailySlot(new Date("2026-09-05T11:00:00Z"), 5), false);
 });
