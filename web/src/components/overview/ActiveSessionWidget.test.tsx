import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { ActiveSessionWidget } from "./ActiveSessionWidget";

describe("ActiveSessionWidget", () => {
  it("highlights an active session and keeps the status badge together", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onOpenActiveSession = vi.fn();

    await act(async () => {
      root.render(
        <ActiveSessionWidget
          isActive={true}
          remainingTimeFormatted="3h 49min"
          onOpenActiveSession={onOpenActiveSession}
        />,
      );
    });

    expect(container.querySelector(".active-session-widget-live")).not.toBeNull();
    expect(container.querySelector(".active-session-widget-eyebrow")?.textContent).toContain("Acesso liberado agora");
    expect(container.querySelector(".active-session-status-badge")?.textContent).toContain("Em andamento");
    expect(container.querySelector(".active-session-status-badge")?.classList.contains("badge-success")).toBe(true);
    expect(container.textContent).toContain("3h 49min");

    await act(async () => {
      (container.querySelector(".active-session-widget-action") as HTMLButtonElement).click();
    });
    expect(onOpenActiveSession).toHaveBeenCalledOnce();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("keeps the inactive state quiet", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ActiveSessionWidget
          isActive={false}
          onOpenActiveSession={vi.fn()}
        />,
      );
    });

    expect(container.querySelector(".active-session-widget-idle")).not.toBeNull();
    expect(container.querySelector(".active-session-status-badge")).toBeNull();
    expect(container.querySelector(".active-session-widget-action")).toBeNull();
    expect(container.textContent).toContain("Nenhuma sessão ativa agora");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
