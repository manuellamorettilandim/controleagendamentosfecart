import { act } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { DashboardApp } from "./DashboardApp";

// Mock API client
vi.mock("../lib/api/client", () => ({
  apiClient: {
    user: vi.fn().mockResolvedValue({
      profile: {
        user_id: "user-123",
        username: "João Silva",
        group_name: "Turma ADS - Noite",
        role: "student",
      },
      accounts: [
        { account_id: "acc-1", label: "ChatGPT 01", is_default: true },
        { account_id: "acc-2", label: "ChatGPT 02" },
      ],
      reservations: [
        {
          id: "res-upcoming",
          account_id: "acc-1",
          starts_at: new Date(Date.now() + 3600000).toISOString(),
          ends_at: new Date(Date.now() + 3600000 + 18000000).toISOString(),
          status: "scheduled",
          approval_status: "approved",
        },
      ],
      busySlots: [],
      devices: [],
    }),
  },
}));

describe("DashboardApp", () => {
  beforeEach(() => {
    window.location.hash = "";
  });

  it("mounts, renders header navigation, and displays overview content", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<DashboardApp />);
    });

    expect(container.textContent).toContain("Fecart");
    expect(container.textContent).toContain("AI Share");
    expect(container.textContent).toContain("Visão geral");
    expect(container.textContent).toContain("Estatísticas & Modelos");
    expect(container.textContent).toContain("Guias de Acesso");
    expect(container.textContent).toContain("Reserve sua sessão");
    expect(container.textContent).toContain("Agenda da Semana");

    const activeWidget = container.querySelector(".active-session-widget");
    expect(activeWidget).not.toBeNull();
    const overviewAside = container.querySelector(".overview-top-grid-aside");
    expect(overviewAside).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("toggles theme and switches between navigation tabs", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<DashboardApp />);
    });

    // Theme toggle test
    const themeBtn = container.querySelector("#theme-toggle") as HTMLButtonElement;
    expect(themeBtn).not.toBeNull();
    const initialTheme = document.documentElement.dataset.theme;

    await act(async () => {
      themeBtn.click();
    });
    expect(document.documentElement.dataset.theme).not.toBe(initialTheme);

    // Tab navigation: switch to Statistics
    const navButtons = Array.from(container.querySelectorAll(".nav-tab-btn")) as HTMLButtonElement[];
    const statsBtn = navButtons.find((b) => b.textContent?.includes("Estatísticas & Modelos"));
    expect(statsBtn).toBeDefined();

    await act(async () => {
      statsBtn!.click();
    });
    expect(container.textContent).toContain("DADOS REAIS. MAIS DECISÕES.");
    expect(container.textContent).toContain("Atividade de sessões ao longo do tempo");
    // Verifies real user data is displayed instead of old mock preview numbers
    expect(container.textContent).toContain("5 h");
    expect(container.textContent).not.toContain("32,5 h");
    expect(container.textContent).not.toContain("9,8M");

    // Tab navigation: switch to Guides
    const guidesBtn = navButtons.find((b) => b.textContent?.includes("Guias de Acesso"));
    expect(guidesBtn).toBeDefined();

    await act(async () => {
      guidesBtn!.click();
    });
    expect(container.textContent).toContain("APRENDA EM POUCOS MINUTOS");
    expect(container.textContent).toContain("Guia rápido");
    expect(container.textContent).not.toContain("Solução de problemas");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
