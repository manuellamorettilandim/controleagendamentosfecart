import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { CalendarHost } from "./CalendarHost";

const calendarMocks = vi.hoisted(() => ({
  render: vi.fn(),
  destroy: vi.fn(),
  setOption: vi.fn(),
}));

vi.mock("fullcalendar/all", () => ({
  Calendar: vi.fn(function MockCalendar() {
    return calendarMocks;
  }),
}));

describe("CalendarHost", () => {
  it("mounts, updates its container, and destroys FullCalendar", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<CalendarHost />);
    });

    const { Calendar } = await import("fullcalendar/all");
    expect(Calendar).toHaveBeenCalledTimes(1);
    expect(calendarMocks.render).toHaveBeenCalledTimes(1);
    expect(calendarMocks.setOption).toHaveBeenCalledWith("slotMinHeight", 48);
    expect(container.querySelector(".calendar-react-host")).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
    expect(calendarMocks.destroy).toHaveBeenCalledTimes(1);
    container.remove();
  });
});
