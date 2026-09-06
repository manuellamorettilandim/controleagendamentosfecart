import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { BookingModal } from "./BookingModal";
import { AccountOption } from "./ScheduleGrid";

describe("BookingModal", () => {
  const accounts: AccountOption[] = [
    {
      accountId: "primary",
      label: "Conta principal",
      rate_limits: {
        codex: {
          limitId: "codex",
          primary: {
            resetsAt: 1788647131, // 2026-09-05 22:25:31 UTC
            usedPercent: 20,
            windowDurationMins: 300,
          },
        },
      },
    },
  ];

  it("renders the 4 fixed daily sessions and submits selection", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onConfirmBooking = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    // Pick a date in the future so all slots are available
    const initialDate = new Date(2028, 5, 15);

    await act(async () => {
      root.render(
        <BookingModal
          isOpen={true}
          onClose={onClose}
          accounts={accounts}
          selectedAccountId="primary"
          initialDate={initialDate}
          onConfirmBooking={onConfirmBooking}
        />
      );
    });

    expect(container.textContent).toContain("Novo agendamento");
    expect(container.textContent).toContain("Conta do provedor");
    expect(container.textContent).toContain("Conta principal");

    // Check that the select element contains the 4 fixed daily options
    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.options.length).toBe(4);

    expect(select.options[0].textContent).toContain("08:00 (5 horas)");
    expect(select.options[1].textContent).toContain("09:00 (5 horas)");
    expect(select.options[2].textContent).toContain("14:00 (5 horas)");
    expect(select.options[3].textContent).toContain("19:00 (5 horas)");

    // Select 14:00 slot
    await act(async () => {
      select.value = "14:00";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Submit form
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    });

    expect(onConfirmBooking).toHaveBeenCalledWith(
      "primary",
      expect.any(Date),
      5
    );
    expect(onClose).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
