import React from "react";

export type SupportedOS = "powershell" | "cmd" | "macos" | "linux";

export interface OSSelectorProps {
  selectedOS: SupportedOS;
  onSelectOS: (os: SupportedOS) => void;
}

export function OSSelector({ selectedOS, onSelectOS }: OSSelectorProps) {
  const osOptions: { id: SupportedOS; name: string; icon: string; recommended?: boolean }[] = [
    { id: "powershell", name: "Windows PowerShell", icon: "ph-windows-logo", recommended: true },
    { id: "cmd", name: "Windows CMD", icon: "ph-windows-logo" },
    { id: "macos", name: "macOS", icon: "ph-apple-logo" },
    { id: "linux", name: "Linux", icon: "ph-linux-logo" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div>
        <h3 style={{ fontSize: "15px", fontWeight: "700", color: "var(--text-primary)" }}>
          1. Escolha o sistema
        </h3>
        <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>
          Selecione o sistema que você está usando.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "12px" }}>
        {osOptions.map((opt) => {
          const isSelected = selectedOS === opt.id;
          return (
            <div
              key={opt.id}
              onClick={() => onSelectOS(opt.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectOS(opt.id);
                }
              }}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              className="ui-card ui-card-interactive"
              style={{
                padding: "16px 12px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                cursor: "pointer",
                position: "relative",
                backgroundColor: isSelected ? "rgba(var(--color-brand-primary-rgb), 0.05)" : "var(--bg-card)",
                borderColor: isSelected ? "var(--color-brand-primary)" : "var(--border-card)",
                borderRadius: "var(--radius-lg)",
                textAlign: "center",
              }}
            >
              {/* Checkmark badge if selected */}
              {isSelected && (
                <div
                  style={{
                    position: "absolute",
                    top: "8px",
                    right: "8px",
                    width: "18px",
                    height: "18px",
                    borderRadius: "50%",
                    backgroundColor: "var(--color-brand-primary)",
                    color: "#ffffff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "11px",
                  }}
                >
                  <i className="ph ph-check" aria-hidden="true" />
                </div>
              )}

              <i
                className={`ph ${opt.icon}`}
                style={{
                  fontSize: "28px",
                  color: isSelected ? "var(--color-brand-primary)" : "var(--text-primary)",
                }}
                aria-hidden="true"
              />

              <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>
                {opt.name}
              </div>

              {opt.recommended && (
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: "600",
                    color: "var(--color-brand-primary)",
                    backgroundColor: "rgba(var(--color-brand-primary-rgb), 0.1)",
                    padding: "2px 8px",
                    borderRadius: "var(--radius-full)",
                  }}
                >
                  Recomendado
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
