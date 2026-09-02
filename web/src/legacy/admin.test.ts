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
          return { users: [{ user_id: "user-1", username: "Equipe Alpha" }] };
        }
        if (path === "/api/admin/reservations") {
          const now = new Date();
          const startsAt = new Date(now.getTime() + 3600000);
          const endsAt = new Date(now.getTime() + 18000000);
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
  });

  it("opens review modal when clicking schedule card in agenda", () => {
    const reviewModal = document.getElementById("review-modal") as HTMLDialogElement;
    reviewModal.removeAttribute("open");

    const scheduleCard = document.querySelector<HTMLButtonElement>('[data-schedule-id="res-pending-1"]');
    expect(scheduleCard).not.toBeNull();

    scheduleCard?.click();

    expect(reviewModal.hasAttribute("open")).toBe(true);
  });
});
