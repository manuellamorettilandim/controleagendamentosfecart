import React from "react";

export interface SessionModelUsage {
  modelName: string;
  icon?: string;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens?: number | null;
  totalTokens: number;
  lastUsedAt?: string;
}

export interface ModelUsageTableProps {
  models: SessionModelUsage[];
}

export function ModelUsageTable({ models }: ModelUsageTableProps) {
  function formatNumber(num: number) {
    return num.toLocaleString("pt-BR");
  }

  const displayModels = models;

  return (
    <div className="ui-card" style={{ padding: "20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "18px" }}>
        <div
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "rgba(var(--color-brand-primary-rgb), 0.1)",
            color: "var(--color-brand-primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "18px",
          }}
        >
          <i className="ph ph-database" aria-hidden="true" />
        </div>
        <h3 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-primary)" }}>
          Modelos usados nesta sessão
        </h3>
      </div>

      {displayModels.length > 0 ? (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-subtle)", color: "var(--text-muted)", fontSize: "12px" }}>
              <th style={{ padding: "10px 12px", fontWeight: "600" }}>Modelo</th>
              <th style={{ padding: "10px 12px", fontWeight: "600" }}>Input tokens</th>
              <th style={{ padding: "10px 12px", fontWeight: "600" }}>Output tokens</th>
              <th style={{ padding: "10px 12px", fontWeight: "600" }}>Thinking</th>
              <th style={{ padding: "10px 12px", fontWeight: "600" }}>Total</th>
              <th style={{ padding: "10px 12px", fontWeight: "600" }}>Último uso</th>
            </tr>
          </thead>
          <tbody>
            {displayModels.map((row) => (
              <tr
                key={row.modelName}
                style={{
                  borderBottom: "1px solid var(--border-subtle)",
                  transition: "background-color var(--transition-fast)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-card-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <td style={{ padding: "14px 12px", fontWeight: "600", color: "var(--text-primary)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <i className={`ph ${row.icon || "ph-cpu"}`} style={{ fontSize: "18px", color: "var(--color-brand-primary)" }} aria-hidden="true" />
                    <span>{row.modelName}</span>
                  </div>
                </td>
                <td style={{ padding: "14px 12px", color: "var(--text-secondary)" }}>{formatNumber(row.inputTokens)}</td>
                <td style={{ padding: "14px 12px", color: "var(--text-secondary)" }}>{formatNumber(row.outputTokens)}</td>
                <td style={{ padding: "14px 12px", color: "var(--text-secondary)" }}>
                  {row.thinkingTokens ? formatNumber(row.thinkingTokens) : "—"}
                </td>
                <td style={{ padding: "14px 12px", fontWeight: "700", color: "var(--text-primary)" }}>
                  {formatNumber(row.totalTokens)}
                </td>
                <td style={{ padding: "14px 12px", color: "var(--text-muted)" }}>{row.lastUsedAt || "—"}</td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      ) : (
        <div style={{ padding: "24px 12px 8px", textAlign: "center" }}>
          <i className="ph ph-chart-line-up" style={{ fontSize: "28px", color: "var(--text-muted)" }} aria-hidden="true" />
          <p style={{ marginTop: "10px", color: "var(--text-secondary)", fontSize: "14px", fontWeight: "600" }}>
            Nenhum uso capturado ainda
          </p>
          <p style={{ marginTop: "4px", color: "var(--text-muted)", fontSize: "12px" }}>
            Os modelos aparecerão aqui depois do primeiro comando concluído.
          </p>
        </div>
      )}
    </div>
  );
}
