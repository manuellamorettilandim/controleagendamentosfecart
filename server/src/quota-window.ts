import type { AccountRateLimit, AccountSnapshot, RateLimitWindow } from "./protocol.js";

export const SESSION_WINDOW_MINUTES = 5 * 60;
export const SESSION_DURATION_MS = SESSION_WINDOW_MINUTES * 60_000;

function windows(snapshot: Pick<AccountSnapshot, "rateLimits"> | null | undefined): RateLimitWindow[] {
  if (!snapshot) return [];
  return Object.values(snapshot.rateLimits)
    .flatMap((limit: AccountRateLimit) => [limit.primary, limit.secondary])
    .filter((window): window is RateLimitWindow => Boolean(window));
}

export function fiveHourRateLimit(snapshot: Pick<AccountSnapshot, "rateLimits"> | null | undefined): RateLimitWindow | null {
  return windows(snapshot).find((window) => window.windowDurationMins === SESSION_WINDOW_MINUTES) ?? null;
}

export function weeklyRateLimit(snapshot: Pick<AccountSnapshot, "rateLimits"> | null | undefined): RateLimitWindow | null {
  return windows(snapshot)
    .filter((window) => (window.windowDurationMins ?? 0) > SESSION_WINDOW_MINUTES)
    .sort((left, right) => (right.windowDurationMins ?? 0) - (left.windowDurationMins ?? 0))[0] ?? null;
}

export function nextFiveHourReset(resetAtSeconds: number, requestedAtMs: number): number | null {
  const resetAtMs = resetAtSeconds * 1_000;
  if (!Number.isFinite(resetAtMs) || resetAtMs <= 0 || !Number.isFinite(requestedAtMs)) return null;
  if (requestedAtMs <= resetAtMs) return resetAtMs;
  return resetAtMs + Math.ceil((requestedAtMs - resetAtMs) / SESSION_DURATION_MS) * SESSION_DURATION_MS;
}

export function isFiveHourResetBoundary(resetAtSeconds: number, startsAtMs: number, toleranceMs = 60_000): boolean {
  if (!Number.isFinite(startsAtMs)) return false;
  const nearest = nextFiveHourReset(resetAtSeconds, startsAtMs - toleranceMs);
  return nearest !== null && Math.abs(nearest - startsAtMs) <= toleranceMs;
}
