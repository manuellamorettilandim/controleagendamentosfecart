import assert from "node:assert/strict";
import test from "node:test";
import type { AccountSnapshot } from "../src/protocol.js";
import { fiveHourRateLimit, isFiveHourResetBoundary, nextFiveHourReset, SESSION_DURATION_MS, weeklyRateLimit } from "../src/quota-window.js";

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
