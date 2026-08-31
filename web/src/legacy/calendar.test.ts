import { describe, expect, it } from "vitest";

describe("FecartCalendar", () => {
  it("exposes both sameDay and isSameDay helper methods", async () => {
    await import("./calendar.js");

    const fecart = (window as any).FecartCalendar;
    expect(fecart).toBeDefined();
    expect(typeof fecart.sameDay).toBe("function");
    expect(typeof fecart.isSameDay).toBe("function");
    expect(fecart.sameDay).toBe(fecart.isSameDay);

    const d1 = new Date(2026, 7, 27, 10, 0, 0);
    const d2 = new Date(2026, 7, 27, 23, 59, 59);
    const d3 = new Date(2026, 7, 28, 1, 0, 0);

    expect(fecart.sameDay(d1, d2)).toBe(true);
    expect(fecart.isSameDay(d1, d2)).toBe(true);

    expect(fecart.sameDay(d1, d3)).toBe(false);
    expect(fecart.isSameDay(d1, d3)).toBe(false);
  });
});
