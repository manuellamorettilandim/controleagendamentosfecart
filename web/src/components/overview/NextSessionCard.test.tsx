import { describe, expect, it } from "vitest";
import { formatCountdown } from "./NextSessionCard";

describe("NextSessionCard countdown", () => {
  it("formats the time remaining until the next session", () => {
    const now = Date.parse("2026-09-05T16:00:00Z");
    const start = Date.parse("2026-09-05T18:03:04Z");

    expect(formatCountdown(new Date(start).toISOString(), now)).toBe("02h 03min 04s");
  });

  it("shows when the session is starting now", () => {
    const now = Date.parse("2026-09-05T18:00:00Z");

    expect(formatCountdown(new Date(now - 1_000).toISOString(), now)).toBe("agora");
  });
});
