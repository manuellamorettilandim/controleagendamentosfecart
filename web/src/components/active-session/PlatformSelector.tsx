import React from "react";

export type CodexPlatform = "cli" | "app";

export interface PlatformSelectorProps {
  selectedPlatform: CodexPlatform;
  onSelectPlatform: (platform: CodexPlatform) => void;
}

export function PlatformSelector({ selectedPlatform, onSelectPlatform }: PlatformSelectorProps) {
  const options: { id: CodexPlatform; name: string; description: string; icon: string }[] = [
    { id: "cli", name: "Codex CLI", description: "Use pelo terminal", icon: "ph-terminal-window" },
    { id: "app", name: "Codex App", description: "Abra o aplicativo desktop", icon: "ph-app-window" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div>
        <h3 style={{ fontSize: "15px", fontWeight: "700", color: "var(--text-primary)" }}>2. Escolha a plataforma</h3>
        <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>Selecione como deseja iniciar o Codex.</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
        {options.map((option) => {
          const isSelected = selectedPlatform === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onSelectPlatform(option.id)}
              className="ui-card ui-card-interactive"
              aria-pressed={isSelected}
              style={{
                padding: "16px",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                cursor: "pointer",
                backgroundColor: isSelected ? "rgba(var(--color-brand-primary-rgb), 0.05)" : "var(--bg-card)",
                borderColor: isSelected ? "var(--color-brand-primary)" : "var(--border-card)",
                textAlign: "left",
                font: "inherit",
              }}
            >
              <i className={`ph ${option.icon}`} style={{ fontSize: "26px", color: isSelected ? "var(--color-brand-primary)" : "var(--text-primary)" }} aria-hidden="true" />
              <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <strong style={{ fontSize: "13px", color: "var(--text-primary)" }}>{option.name}</strong>
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{option.description}</span>
              </span>
              {isSelected && <i className="ph ph-check-circle" style={{ marginLeft: "auto", color: "var(--color-brand-primary)", fontSize: "20px" }} aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      {selectedPlatform === "app" && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "10px",
            padding: "12px 14px",
            borderRadius: "var(--radius-md)",
            backgroundColor: "rgba(245, 158, 11, 0.1)",
            border: "1px solid rgba(245, 158, 11, 0.35)",
            color: "var(--text-secondary)",
            fontSize: "13px",
          }}
        >
          <i className="ph ph-warning" style={{ color: "#d97706", fontSize: "18px", flexShrink: 0 }} aria-hidden="true" />
          <span>
            Antes de executar, encerre pelo menu <strong>Arquivo → Encerrar ChatGPT</strong>. Fechar pelo X não basta.
          </span>
        </div>
      )}
    </div>
  );
}
