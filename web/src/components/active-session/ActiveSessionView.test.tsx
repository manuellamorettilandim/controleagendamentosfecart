import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ActiveSessionView } from "./ActiveSessionView";

function renderView(isActiveSession: boolean) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <ActiveSessionView
        onBackToOverview={() => undefined}
        onOpenGuides={() => undefined}
        onRefresh={() => undefined}
        isActiveSession={isActiveSession}
        token={isActiveSession ? "real-session-token" : null}
        accountLabel="Conta real"
        startTimeFormatted="Hoje às 14:00"
        endTimeFormatted="Hoje às 19:00"
        durationLabel="5 horas"
        remainingTimeFormatted="2h 18min"
        timePercentage={46}
        quotaRemainingPercent={80}
        modelsCount={1}
        totalTokensFormatted="500"
        commandsCount={2}
        statusLabel="Conectada"
        modelsUsed={[
          {
            modelName: "gpt-5.6-sol",
            inputTokens: 300,
            outputTokens: 100,
            totalTokens: 400,
            lastUsedAt: "15:10",
          },
        ]}
      />,
    );
  });

  return { container, root };
}

describe("ActiveSessionView", () => {
  it("shows the captured session values without demo rows", () => {
    const { container, root } = renderView(true);

    expect(container.textContent).toContain("Conta real");
    expect(container.textContent).toContain("gpt-5.6-sol");
    expect(container.textContent).toContain("500");
    expect(container.textContent).not.toContain("ChatGPT 01");
    expect(container.textContent).not.toContain("Codex (GPT-5)");

    act(() => root.unmount());
    container.remove();
  });

  it("does not render session commands when there is no active reservation", () => {
    const { container, root } = renderView(false);

    expect(container.textContent).toContain("Nenhuma sessão ativa agora");
    expect(container.textContent).not.toContain("Copie o comando de acesso");
    expect(container.textContent).not.toContain("ChatGPT 01");

    act(() => root.unmount());
    container.remove();
  });

  it("shows the full-close warning only when Codex App is selected", () => {
    const { container, root } = renderView(true);
    const appButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Codex App"));

    expect(appButton).toBeDefined();
    expect(container.textContent).not.toContain("Fechar pelo X não basta");

    act(() => {
      appButton?.click();
    });

    expect(container.textContent).toContain("Arquivo → Encerrar ChatGPT");
    expect(container.textContent).toContain("Fechar pelo X não basta");
    expect(container.textContent).toContain("Cole no Windows PowerShell selecionado e pressione Enter.");

    act(() => root.unmount());
    container.remove();
  });
});
