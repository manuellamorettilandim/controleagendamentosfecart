import { describe, expect, it } from "vitest";
import {
  getFiveHourWindow,
  getResetAtMs,
  isAccountWindowActive,
  generateSlotsForDate,
  FIXED_DAILY_SLOTS,
} from "./scheduleSlots";
import { AccountOption } from "../../components/schedule/ScheduleGrid";

describe("scheduleSlots", () => {
  const sampleAccount: AccountOption = {
    accountId: "primary",
    label: "Conta principal",
    status: "ready",
    rate_limits: {
      codex: {
        limitId: "codex",
        primary: {
          resetsAt: 1788647131,
          usedPercent: 19,
          windowDurationMins: 300,
        },
        secondary: {
          resetsAt: 1788748281,
          usedPercent: 92,
          windowDurationMins: 10080,
        },
      },
    },
  };

  it("defines the exact 4 fixed daily slots", () => {
    expect(FIXED_DAILY_SLOTS).toHaveLength(4);
    expect(FIXED_DAILY_SLOTS[0]).toMatchObject({ startHour: 4, endHour: 9, durationHours: 5, timeLabel: "04:00 - 09:00" });
    expect(FIXED_DAILY_SLOTS[1]).toMatchObject({ startHour: 9, endHour: 14, durationHours: 5, timeLabel: "09:00 - 14:00" });
    expect(FIXED_DAILY_SLOTS[2]).toMatchObject({ startHour: 14, endHour: 19, durationHours: 5, timeLabel: "14:00 - 19:00" });
    expect(FIXED_DAILY_SLOTS[3]).toMatchObject({ startHour: 19, endHour: 24, durationHours: 5, timeLabel: "19:00 - 00:00" });
  });

  it("extracts 5-hour rate limit window and reset timestamp", () => {
    const window = getFiveHourWindow(sampleAccount);
    expect(window).not.toBeNull();
    expect(window?.windowDurationMins).toBe(300);
    expect(window?.resetsAt).toBe(1788647131);

    const resetMs = getResetAtMs(sampleAccount);
    expect(resetMs).toBe(1788647131000);
  });

  it("detects whether account window is currently active", () => {
    const resetMs = 1788647131000;
    // Before reset with usage
    expect(isAccountWindowActive(sampleAccount, resetMs - 3600000)).toBe(true);
    // After reset
    expect(isAccountWindowActive(sampleAccount, resetMs + 1000)).toBe(false);
  });

  it("generates exactly 4 fixed slots for any date", () => {
    const targetDate = new Date(2026, 8, 10);
    const slots = generateSlotsForDate(targetDate, sampleAccount, [], [], Date.parse("2026-09-05T19:00:00Z"));

    expect(slots).toHaveLength(4);
    expect(slots[0].timeLabel).toBe("04:00 - 09:00");
    expect(slots[0].durationHours).toBe(5);
    expect(slots[0].isPartial).toBe(false);

    expect(slots[1].timeLabel).toBe("09:00 - 14:00");
    expect(slots[1].durationHours).toBe(5);
    expect(slots[1].isPartial).toBe(false);

    expect(slots[2].timeLabel).toBe("14:00 - 19:00");
    expect(slots[2].durationHours).toBe(5);
    expect(slots[2].isPartial).toBe(false);

    expect(slots[3].timeLabel).toBe("19:00 - 00:00");
    expect(slots[3].durationHours).toBe(5);
    expect(slots[3].isPartial).toBe(false);
  });

  it("marks past slots as unavailable on the current day", () => {
    // Current time: 15:30 on 2026-09-10
    const now = new Date(2026, 8, 10, 15, 30);
    const currentWindowAccount: AccountOption = {
      ...sampleAccount,
      rate_limits: {
        ...sampleAccount.rate_limits,
        codex: {
          ...sampleAccount.rate_limits?.codex,
          primary: {
            ...sampleAccount.rate_limits?.codex?.primary,
            resetsAt: Date.parse("2026-09-10T22:25:31Z") / 1000,
          },
        },
      },
    };
    const slots = generateSlotsForDate(now, currentWindowAccount, [], [], now.getTime());

    expect(slots).toHaveLength(4);
    // 08:00 and 09:00 are in the past
    expect(slots[0].isPast).toBe(true);
    expect(slots[0].status).toBe("unavailable");
    expect(slots[1].isPast).toBe(true);
    expect(slots[1].status).toBe("unavailable");

    // 14:00 has already started, but its current window is still usable.
    expect(slots[2].isPast).toBe(false);
    expect(slots[2].isCurrent).toBe(true);
    expect(slots[2].canStartNow).toBe(true);
    expect(slots[2].status).toBe("available");

    // 19:00 is in the future
    expect(slots[3].isPast).toBe(false);
    expect(slots[3].status).toBe("available");
  });

  it("keeps the current fixed slot available when the next slot is reserved", () => {
    const now = new Date(2026, 8, 10, 15, 30);
    const currentWindowAccount: AccountOption = {
      ...sampleAccount,
      rate_limits: {
        ...sampleAccount.rate_limits,
        codex: {
          ...sampleAccount.rate_limits?.codex,
          primary: {
            ...sampleAccount.rate_limits?.codex?.primary,
            resetsAt: Date.parse("2026-09-10T22:25:31Z") / 1000,
          },
        },
      },
    };
    const slots = generateSlotsForDate(
      now,
      currentWindowAccount,
      [{
        id: "reservation-19",
        account_id: "primary",
        starts_at: new Date(2026, 8, 10, 19, 0).toISOString(),
        ends_at: new Date(2026, 8, 11, 0, 0).toISOString(),
        status: "scheduled",
        approval_status: "approved",
      }],
      [],
      now.getTime(),
    );

    expect(slots[2].status).toBe("available");
    expect(slots[2].canStartNow).toBe(true);
    expect(slots[3].status).toBe("mine");
  });

  it("does not offer immediate start in the final five minutes of the fixed slot", () => {
    const now = new Date(2026, 8, 10, 18, 57);
    const currentWindowAccount: AccountOption = {
      ...sampleAccount,
      rate_limits: {
        ...sampleAccount.rate_limits,
        codex: {
          ...sampleAccount.rate_limits?.codex,
          primary: {
            ...sampleAccount.rate_limits?.codex?.primary,
            resetsAt: Date.parse("2026-09-10T22:01:00Z") / 1000,
          },
        },
      },
    };
    const slots = generateSlotsForDate(now, currentWindowAccount, [], [], now.getTime());

    expect(slots[2].isCurrent).toBe(true);
    expect(slots[2].canStartNow).toBe(false);
    expect(slots[2].status).toBe("unavailable");
  });
});
