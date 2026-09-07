import { AccountOption } from "../../components/schedule/ScheduleGrid";
import { DaySlotData } from "../../components/schedule/ScheduleDay";
import { SlotStatus } from "../../components/schedule/ScheduleSlot";

export interface FixedSlotDef {
  startHour: number;
  endHour: number;
  durationHours: number;
  timeLabel: string;
  selectLabel: string;
  timeStr: string;
}

export const FIXED_DAILY_SLOTS: FixedSlotDef[] = [
  { startHour: 4, endHour: 9, durationHours: 5, timeLabel: "04:00 - 09:00", selectLabel: "04:00 (5 horas)", timeStr: "04:00" },
  { startHour: 9, endHour: 14, durationHours: 5, timeLabel: "09:00 - 14:00", selectLabel: "09:00 (5 horas)", timeStr: "09:00" },
  { startHour: 14, endHour: 19, durationHours: 5, timeLabel: "14:00 - 19:00", selectLabel: "14:00 (5 horas)", timeStr: "14:00" },
  { startHour: 19, endHour: 24, durationHours: 5, timeLabel: "19:00 - 00:00", selectLabel: "19:00 (5 horas)", timeStr: "19:00" },
];

const MIN_IMMEDIATE_SESSION_MS = 5 * 60_000;

export function getFiveHourWindow(account?: AccountOption | null) {
  if (!account) return null;
  const limits = Object.values(account.rate_limits || account.rateLimits || {});
  for (const limit of limits as any[]) {
    if (limit?.primary?.windowDurationMins === 300) return limit.primary;
    if (limit?.secondary?.windowDurationMins === 300) return limit.secondary;
  }
  return null;
}

export function getResetAtMs(account?: AccountOption | null): number | null {
  const window = getFiveHourWindow(account);
  const value = Number(window?.resetsAt);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value < 10_000_000_000 ? value * 1000 : value;
}

export function isAccountWindowActive(account?: AccountOption | null, nowMs = Date.now(), reservations: any[] = []): boolean {
  const window = getFiveHourWindow(account);
  const resetAt = getResetAtMs(account);
  if (!resetAt || resetAt <= nowMs) return false;
  const used = Number(window?.usedPercent);
  const hasUsage = Number.isFinite(used) && used > 0;
  const hasActiveReservation = reservations.some((item) =>
    item.account_id === account?.accountId &&
    item.status === "scheduled" &&
    item.approval_status === "approved" &&
    Date.parse(item.starts_at) <= nowMs &&
    Date.parse(item.ends_at) > nowMs
  );
  return hasUsage || hasActiveReservation;
}

function hasSlotOverlap(
  startMs: number,
  endMs: number,
  accountId: string | undefined,
  reservations: any[] = [],
  busySlots: any[] = []
): { isMine: boolean; isBusy: boolean; reservationId?: string } {
  if (!accountId) return { isMine: false, isBusy: false };

  const myRes = reservations.find((r) => {
    if (r.account_id !== accountId || r.status === "cancelled" || r.approval_status === "rejected") return false;
    const s = Date.parse(r.starts_at);
    const e = Date.parse(r.ends_at);
    return s < endMs && e > startMs;
  });

  if (myRes) {
    return { isMine: true, isBusy: false, reservationId: myRes.id };
  }

  const isBusy = busySlots.some((b) => {
    if (b.account_id !== accountId) return false;
    const s = Date.parse(b.starts_at);
    const e = Date.parse(b.ends_at);
    return s < endMs && e > startMs;
  });

  return { isMine: false, isBusy, reservationId: undefined };
}

/**
 * Generates the 4 fixed daily sessions defined for the product:
 * 1. 04:00 - 09:00 (5h)
 * 2. 09:00 - 14:00 (5h)
 * 3. 14:00 - 19:00 (5h)
 * 4. 19:00 - 00:00 (5h)
 */
export function generateSlotsForDate(
  targetDate: Date,
  account?: AccountOption,
  reservations: any[] = [],
  busySlots: any[] = [],
  nowMs = Date.now()
): DaySlotData[] {
  const year = targetDate.getFullYear();
  const month = targetDate.getMonth();
  const date = targetDate.getDate();

  return FIXED_DAILY_SLOTS.map((def) => {
    const slotStart = new Date(year, month, date, def.startHour, 0, 0, 0);
    const slotEnd = new Date(year, month, date, def.endHour === 24 ? 0 : def.endHour, 0, 0, 0);
    if (def.endHour === 24) {
      slotEnd.setDate(slotEnd.getDate() + 1);
    }

    const isCurrent = slotStart.getTime() <= nowMs && slotEnd.getTime() > nowMs;
    const isPast = slotEnd.getTime() <= nowMs;
    // A current slot can be started immediately as long as the fixed site
    // schedule leaves at least five minutes before the slot boundary. The
    // provider's sliding reset is intentionally not part of this decision.
    const canStartNow = isCurrent && slotEnd.getTime() - nowMs >= MIN_IMMEDIATE_SESSION_MS;
    const overlap = hasSlotOverlap(slotStart.getTime(), slotEnd.getTime(), account?.accountId, reservations, busySlots);

    let status: SlotStatus = "available";
    if (overlap.isMine) {
      status = "mine";
    } else if (overlap.isBusy) {
      status = "busy";
    } else if (isPast || (isCurrent && !canStartNow)) {
      status = "unavailable";
    }

    return {
      timeLabel: def.timeLabel,
      start: slotStart,
      end: slotEnd,
      startHour: def.startHour,
      endHour: def.endHour,
      status,
      isPast,
      isCurrent,
      canStartNow,
      isPartial: false,
      durationHours: def.durationHours,
      reservationId: overlap.reservationId,
      approvalStatus: reservations.find((r) => r.id === overlap.reservationId)?.approval_status,
    };
  });
}
