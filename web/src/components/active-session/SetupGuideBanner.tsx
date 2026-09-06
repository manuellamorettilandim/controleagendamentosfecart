import React from "react";

export interface SetupGuideBannerProps {
  onOpenGuide: () => void;
}

export function SetupGuideBanner({ onOpenGuide }: SetupGuideBannerProps) {
  return (
    <div
      className="setup-guide-banner ui-card"
      style={{
        padding: "16px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
        borderRadius: "var(--radius-lg)",
        backgroundColor: "var(--bg-card)",
        border: "1px solid var(--border-card)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
        <div
          style={{
            width: "38px",
            height: "38px",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "rgba(var(--color-brand-primary-rgb), 0.1)",
            color: "var(--color-brand-primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "20px",
            flexShrink: 0,
          }}
        >
          <i className="ph ph-book-open" aria-hidden="true" />
        </div>
        <div>
          <strong style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-primary)" }}>
            Configuração obrigatória
          </strong>
          <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>
            Faça isso antes do primeiro acesso.
          </p>
        </div>
      </div>

      <button
        type="button"
        className="btn btn-primary"
        onClick={onOpenGuide}
        style={{ padding: "8px 18px", fontSize: "13px", borderRadius: "var(--radius-md)" }}
      >
        <span>Abrir guia</span>
        <i className="ph ph-arrow-right" aria-hidden="true" />
      </button>
    </div>
  );
}
