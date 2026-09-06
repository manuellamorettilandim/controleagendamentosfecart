import type { AccountRateLimit, AccountSnapshot, RateLimitWindow } from "./protocol.js";

export const SESSION_WINDOW_MINUTES = 5 * 60;
export const SESSION_DURATION_MS = SESSION_WINDOW_MINUTES * 60_000;
export const IMMEDIATE_SESSION_TOLERANCE_MS = 60_000;
export const MIN_IMMEDIATE_SESSION_MS = 5 * 60_000;

export interface ReservationWindow {
  startsAtMs: number;
  endsAtMs: number;
  complete: boolean;
}

export interface FixedDailySlotWindow {
  startHour: number;
  endHour: number;
  durationHours: number;
}

/**
 * Returns the product-defined slot containing an instant in Sao Paulo time.
 * This deliberately does not consult provider quota/reset metadata.
 */
export function fixedDailySlotForStart(
  startsAtMs: number,
  timeZone = "America/Sao_Paulo"
): FixedDailySlotWindow | null {
  if (!Number.isFinite(startsAtMs)) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(new Date(startsAtMs));

  let hour = -1;
  for (const part of parts) {
    if (part.type === "hour") hour = Number.parseInt(part.value, 10);
  }

  if (hour === 8) return { startHour: 8, endHour: 13, durationHours: 5 };
  if (hour >= 9 && hour < 14) return { startHour: 9, endHour: 14, durationHours: 5 };
  if (hour >= 14 && hour < 19) return { startHour: 14, endHour: 19, durationHours: 5 };
  if (hour >= 19 && hour < 24) return { startHour: 19, endHour: 24, durationHours: 5 };
  return null;
}

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

export interface QuotaWindowState {
  usedPercent?: number | null;
  hasActiveReservation?: boolean;
}

export function isWindowActive(
  resetAtSeconds: number | null | undefined,
  nowMs: number,
  state?: QuotaWindowState
): boolean {
  if (!resetAtSeconds) return false;
  const resetAtMs = resetAtSeconds * 1_000;
  if (!Number.isFinite(resetAtMs) || resetAtMs <= nowMs) return false;
  const usedPercent = Number(state?.usedPercent);
  const hasUsage = Number.isFinite(usedPercent) && usedPercent > 0;
  // If state is not passed or explicitly has usage/active reservation, consider active
  return state === undefined ? true : Boolean(state.hasActiveReservation || hasUsage);
}

export function reservationWindowForStart(
  resetAtSeconds: number | null | undefined,
  startsAtMs: number,
  nowMs: number,
  state?: QuotaWindowState
): ReservationWindow | null {
  if (![startsAtMs, nowMs].every(Number.isFinite)) return null;
  if (startsAtMs < nowMs - IMMEDIATE_SESSION_TOLERANCE_MS) return null;

  const startsImmediately = startsAtMs <= nowMs + IMMEDIATE_SESSION_TOLERANCE_MS;
  const active = isWindowActive(resetAtSeconds, nowMs, state);

  // When account is idle, immediate session gets a full 5-hour window starting now!
  if (!active && startsImmediately) {
    return { startsAtMs, endsAtMs: startsAtMs + SESSION_DURATION_MS, complete: true };
  }

  const resetAtMs = (resetAtSeconds ?? 0) * 1_000;
  if (resetAtMs > 0 && isFiveHourResetBoundary(resetAtSeconds!, startsAtMs)) {
    return { startsAtMs, endsAtMs: startsAtMs + SESSION_DURATION_MS, complete: true };
  }

  // When active, immediate start gets remainder of active window
  if (active && startsImmediately && resetAtMs > startsAtMs) {
    if (resetAtMs - startsAtMs >= MIN_IMMEDIATE_SESSION_MS) {
      return { startsAtMs, endsAtMs: resetAtMs, complete: false };
    }
  }

  return null;
}

export function isFixedDailySlot(
  startsAt: Date | number,
  durationHours?: number,
  timeZone = "America/Sao_Paulo"
): boolean {
  const date = typeof startsAt === "number" ? new Date(startsAt) : startsAt;
  if (Number.isNaN(date.getTime())) return false;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(date);

  let hour = -1;
  let minute = -1;
  for (const part of parts) {
    if (part.type === "hour") hour = Number.parseInt(part.value, 10);
    if (part.type === "minute") minute = Number.parseInt(part.value, 10);
  }

  if (minute !== 0) return false;

  if (hour === 8) return durationHours === undefined || durationHours === 5;
  if (hour === 9 || hour === 14 || hour === 19) {
    return durationHours === undefined || durationHours === 5;
  }

  return false;
}
