import { describe, expect, it, vi, beforeAll } from "vitest";
import template from "../templates/admin.html?raw";

describe("Admin Legacy Controller", () => {
  beforeAll(async () => {
    document.body.innerHTML = template;

    // Polyfill showModal / close for jsdom HTMLDialogElement
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };

    (window as any).RemoteCodexAuth = {
      getSession: () => ({ access_token: "mock-token" }),
      loadConfig: async () => ({}),
      clearSession: vi.fn(),
    };

    (window as any).FecartApi = {
      admin: vi.fn(async (path: string) => {
        if (path === "/api/admin/session") {
          return { role: "admin" };
        }
        if (path === "/api/admin/accounts") {
          return {
            accounts: [
              {
                accountId: "account-1",
                label: "Conta 1",
                status: "ready",
                rateLimits: {
                  primary: { windowDurationMins: 300, usedPercent: 0, resetsAt: Date.now() + 3600000 },
                },
              },
            ],
          };
        }
        if (path === "/api/admin/users") {
          return { users: [{ user_id: "user-1", username: "Equipe Alpha" }, { user_id: "user-2", username: "Beta Devs" }] };
        }
        if (path === "/api/admin/reservations") {
          const now = new Date();
          const startsAt = new Date(now.getTime() - 30 * 60_000);
          const endsAt = new Date(startsAt.getTime() + 5 * 60 * 60_000);
          const tomorrowStart = new Date(now.getTime() + 24 * 3600_000);
          const tomorrowEnd = new Date(tomorrowStart.getTime() + 5 * 3600_000);
          return {
            reservations: [
              {
                id: "res-pending-1",
                user_id: "user-1",
                account_id: "account-1",
                starts_at: startsAt.toISOString(),
                ends_at: endsAt.toISOString(),
                approval_status: "pending",
                status: "scheduled",
                created_at: now.toISOString(),
              },
              { id: "res-rejected-1", user_id: "user-1", account_id: "account-1",
                starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
                approval_status: "rejected", status: "cancelled", created_at: now.toISOString() },
              {
                id: "res-approved-1",
                user_id: "user-2",
                account_id: "account-1",
                starts_at: tomorrowStart.toISOString(),
                ends_at: tomorrowEnd.toISOString(),
                approval_status: "approved",
                status: "scheduled",
                created_at: now.toISOString(),
              },
            ],
          };
        }
        if (path === "/api/admin/devices") {
          return { devices: [] };
        }
        if (path === "/api/admin/settings") {
          return { settings: {}, models: [] };
        }
        return {};
      }),
    };

    vi.spyOn(window, "fetch").mockImplementation(async (input: any) => {
      if (typeof input === "string" && input.includes("/api/admin/session")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ role: "admin" }),
        } as any;
      }
      return { ok: true, status: 200, json: async () => ({}) } as any;
    });

    await import("./admin.js");
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  it("opens review modal when clicking Decidir button on pending approval item", () => {
    const decideButton = document.querySelector<HTMLButtonElement>('[data-approval-action="res-pending-1"]');
    expect(decideButton).not.toBeNull();

    const reviewModal = document.getElementById("review-modal") as HTMLDialogElement;
    expect(reviewModal).not.toBeNull();

    decideButton?.click();

    expect(reviewModal.hasAttribute("open")).toBe(true);
    expect(document.getElementById("review-group")?.textContent).toBe("Equipe Alpha");
    expect(document.getElementById("review-account")?.textContent).toBe("Conta 1");
    expect((document.getElementById("review-start") as HTMLInputElement).value).toMatch(/T\d{2}:\d{2}:\d{2}(?:\.\d{3})?$/);
    expect((document.getElementById("review-end") as HTMLInputElement).value).toMatch(/T\d{2}:\d{2}:\d{2}(?:\.\d{3})?$/);
    expect((document.getElementById("review-start") as HTMLInputElement).step).toBe("1");
    expect((document.getElementById("review-end") as HTMLInputElement).step).toBe("1");
    const lockedStart = new Date((document.getElementById("review-start") as HTMLInputElement).value);
    const lockedEnd = new Date((document.getElementById("review-end") as HTMLInputElement).value);
    expect(lockedStart.getTime()).toBeLessThan(Date.now());
    expect(lockedEnd.getTime() - lockedStart.getTime()).toBe(5 * 60 * 60_000);
  });

  it("shows the requester and an inline review form without opening a modal", () => {
    const row = document.querySelector<HTMLElement>('[data-request-id="res-pending-1"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("Equipe Alpha");
    expect(row?.textContent).toContain("Pendente");
    expect(row?.querySelector('[data-quick-action="approve"]')).not.toBeNull();
    const reviewModal = document.getElementById("review-modal")!;
    reviewModal.removeAttribute("open");
    row?.querySelector("summary")?.click();
    expect(reviewModal.hasAttribute("open")).toBe(false);
    expect(row?.querySelector('form[data-inline-review]')).not.toBeNull();
    expect(row?.querySelector('button[value="reject"]')).not.toBeNull();
  });

  it("keeps rejected requests visible beside a pending request in the same time slot", () => {
    const row = document.querySelector('[data-request-id="res-rejected-1"]');
    expect(row?.textContent).toContain("Recusado");
    expect(row?.querySelector('[data-quick-action="approve"]')).toBeNull();
    expect(document.querySelector('[data-request-id="res-pending-1"]')).not.toBeNull();
  });

  it("submits rejection and the review note directly from the inline form", async () => {
    const form = document.querySelector<HTMLFormElement>('[data-inline-review="res-pending-1"]')!;
    const note = form.querySelector<HTMLTextAreaElement>('[name="note"]')!;
    note.value = "Horário solicitado indisponível.";
    const button = form.querySelector<HTMLButtonElement>('[value="reject"]')!;
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: button }));
    await vi.waitFor(() => expect((window as any).FecartApi.admin).toHaveBeenCalledWith(
      "/api/admin/reservations/res-pending-1/reject",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ note: "Horário solicitado indisponível." }) }),
    ));
    expect(document.getElementById("review-modal")?.hasAttribute("open")).toBe(false);
  });

  it("shows seven capacity selectors and focuses the selected day", () => {
    const days = document.querySelectorAll<HTMLButtonElement>(".planner-day");
    expect(days.length).toBe(7);
    expect(days[0].querySelectorAll(".planner-capacity i").length).toBe(4);
    days[0].click();
    expect(document.querySelector('.planner-day[aria-pressed="true"]')).not.toBeNull();
    expect(document.querySelector('.planner-free')?.textContent).toContain("Horários disponíveis");
  });
  it("switches task views while keeping policies out of the overview", () => {
    const policies = document.querySelector<HTMLElement>('[data-view-panel="policies"]')!;
    expect(policies.hidden).toBe(true);
    document.querySelector<HTMLButtonElement>('[data-admin-view="policies"]')!.click();
    expect(policies.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('.metrics-grid')!.hidden).toBe(true);
    expect(document.getElementById('admin-view-title')!.textContent).toBe('Políticas de acesso');
  });

  it("rejects reversed report dates without calling the export endpoint", async () => {
    document.querySelector<HTMLButtonElement>('[data-admin-view="reports"]')!.click();
    (document.getElementById('admin-report-from') as HTMLInputElement).value = '2026-09-06';
    (document.getElementById('admin-report-to') as HTMLInputElement).value = '2026-09-01';
    const before = vi.mocked(window.fetch).mock.calls.length;
    document.getElementById('admin-report-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(document.getElementById('admin-report-status')!.textContent).toContain('período válido');
    expect(vi.mocked(window.fetch).mock.calls.length).toBe(before);
  });

  it("posts the selected report period with authorization and restores the button after failure", async () => {
    (document.getElementById('admin-report-to') as HTMLInputElement).value = '2026-09-07';
    vi.mocked(window.fetch).mockImplementation(async (input: any) => {
      if (String(input).endsWith('/session')) return { ok: true, json: async () => ({ role: 'admin' }) } as any;
      return { ok: false, json: async () => ({ error: 'Relatório indisponível' }) } as any;
    });
    document.getElementById('admin-report-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(document.getElementById('admin-report-status')!.textContent).toBe('Relatório indisponível'));
    const call = vi.mocked(window.fetch).mock.calls.find(([url]) => String(url).includes('/export/pdf'))!;
    expect(call[1]!.headers).toMatchObject({ Authorization: 'Bearer mock-token' });
    expect(JSON.parse(String(call[1]!.body))).toEqual({ from: '2026-09-06T03:00:00.000Z', to: '2026-09-08T02:59:59.999Z', timeZone: 'America/Sao_Paulo' });
    expect((document.getElementById('admin-report-submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it("renders four fixed daily time slots under each of the seven days", () => {
    const columns = document.querySelectorAll(".planner-day-column");
    expect(columns.length).toBe(7);

    const allSlots = document.querySelectorAll(".planner-day-slots .schedule-slot-card");
    expect(allSlots.length).toBe(28);

    columns.forEach((column) => {
      const slots = column.querySelectorAll(".planner-day-slots .schedule-slot-card");
      expect(slots.length).toBe(4);
      const timeTexts = Array.from(slots).map((s) => s.querySelector(".slot-time")?.textContent);
      expect(timeTexts).toEqual(["04:00 – 09:00", "09:00 – 14:00", "14:00 – 19:00", "19:00 – 00:00"]);
    });
  });

  it("displays pending slot with requester name and available slots as read-only", () => {
    const pendingSlot = document.querySelector<HTMLButtonElement>('.planner-day-slots [data-manage-schedule="res-pending-1"]');
    expect(pendingSlot).not.toBeNull();
    expect(pendingSlot?.classList.contains("slot-pending")).toBe(true);
    expect(pendingSlot?.textContent).toContain("Pendente");
    expect(pendingSlot?.textContent).toContain("Equipe Alpha");

    const availableSlots = document.querySelectorAll(".planner-day-slots .slot-available");
    expect(availableSlots.length).toBeGreaterThan(0);
    availableSlots.forEach((slot) => {
      expect(slot.tagName.toLowerCase()).toBe("div");
      expect(slot.classList.contains("is-readonly")).toBe(true);
      expect(slot.textContent).toContain("Disponível");
      expect(slot.textContent).toContain("5 horas de sessão");
      expect(slot.querySelector("button")).toBeNull();
    });
  });

  it("opens review dialog when clicking a pending slot in the admin calendar", () => {
    const reviewModal = document.getElementById("review-modal") as HTMLDialogElement;
    reviewModal.removeAttribute("open");

    const pendingSlot = document.querySelector<HTMLButtonElement>('.planner-day-slots [data-manage-schedule="res-pending-1"]');
    expect(pendingSlot).not.toBeNull();
    pendingSlot?.click();

    expect(reviewModal.hasAttribute("open")).toBe(true);
    expect(document.getElementById("review-group")?.textContent).toBe("Equipe Alpha");
  });

  it("displays booked slot with group name and opens modal when clicked", () => {
    const cancelModal = document.getElementById("cancel-modal") as HTMLDialogElement;
    cancelModal.removeAttribute("open");

    const bookedSlot = document.querySelector<HTMLButtonElement>('.planner-day-slots [data-manage-schedule="res-approved-1"]');
    expect(bookedSlot).not.toBeNull();
    expect(bookedSlot?.classList.contains("slot-occupied")).toBe(true);
    expect(bookedSlot?.textContent).toContain("Reservado");
    expect(bookedSlot?.textContent).toContain("Beta Devs");

    bookedSlot?.click();
    expect(cancelModal.hasAttribute("open")).toBe(true);
    expect(document.getElementById("cancel-group")?.textContent).toBe("Beta Devs");
  });
});
