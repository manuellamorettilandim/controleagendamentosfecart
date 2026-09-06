import { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { GuidesView } from "./GuidesView";

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes(text));
  if (!button) throw new Error("Button not found: " + text);
  return button as HTMLButtonElement;
}

describe("GuidesView", () => {
  it("shows only the two supported guides and opens the full-page reader", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<GuidesView theme="light" />);
    });

    expect(container.textContent).toContain("Guia rápido");
    expect(container.textContent).toContain("Manual passo a passo");
    expect(container.textContent).toContain("A configuração inicial conecta o Codex ao FECART");
    expect(container.textContent).toContain("Faça a configuração inicial em poucos passos");
    expect(container.textContent).toContain("Faça a mesma configuração sem comandos prontos");
    expect(container.textContent).not.toContain("Solução de problemas");
    expect(container.textContent).not.toContain("Perguntas frequentes");
    expect(container.querySelector(".modal-overlay")).toBeNull();

    await act(async () => {
      buttonWithText(container, "Abrir guia rápido").click();
    });

    expect(container.querySelector(".guide-reader")).not.toBeNull();
    expect(container.querySelector(".modal-overlay")).toBeNull();
    expect(container.textContent).toContain("Ative a configuração");
    expect(container.textContent).toContain("Esta é a configuração inicial: ela prepara o Codex");
    expect(container.textContent).toContain("Este é o passo que conecta o Codex ao FECART");
    expect(container.textContent).toContain("Ambiente local");
    expect(container.querySelector('a[href="https://learn.chatgpt.com/docs/codex/cli"]')).not.toBeNull();
    expect(container.querySelector('a[href="https://learn.chatgpt.com/docs/app"]')).not.toBeNull();

    await act(async () => {
      buttonWithText(container, "Voltar para guias").click();
    });

    expect(container.querySelector(".guide-reader")).toBeNull();
    expect(container.textContent).toContain("Dois caminhos, o mesmo resultado");

    await act(async () => {
      buttonWithText(container, "Abrir manual").click();
    });

    expect(container.textContent).toContain("Localize o arquivo");
    expect(container.textContent).toContain("Edite o config.toml");
    expect(container.textContent).toContain("Este é o mesmo processo, explicado passo a passo");

    await act(async () => {
      buttonWithText(container, "macOS").click();
    });

    expect(container.textContent).toContain("Primeiro, localize o arquivo que guarda a conexão do Codex. No Terminal (zsh ou bash), use o caminho abaixo.");
    expect(container.textContent).toContain("~/.codex/config.toml");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
