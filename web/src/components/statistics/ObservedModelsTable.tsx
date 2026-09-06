import React from "react";

export interface ObservedModelRow {
  name: string;
  icon: string;
  iconColor?: string;
  sessions: number;
  inputTokens: string;
  outputTokens: string;
  totalTokens: string;
  participationPercent: number;
}

export interface ObservedModelsTableProps {
  rows?: ObservedModelRow[];
}

export function ObservedModelsTable({ rows: propRows }: ObservedModelsTableProps = {}) {
  const defaultRows: ObservedModelRow[] = [
    {
      name: "gpt-5.6 sol",
      icon: "ph-sun",
      iconColor: "#eab308",
      sessions: 0,
      inputTokens: "0",
      outputTokens: "0",
      totalTokens: "0",
      participationPercent: 0,
    },
    {
      name: "gpt-5.6 terra",
      icon: "ph-plant",
      iconColor: "#10b981",
      sessions: 0,
      inputTokens: "0",
      outputTokens: "0",
      totalTokens: "0",
      participationPercent: 0,
    },
    {
      name: "gpt-5.6 luna",
      icon: "ph-moon",
      iconColor: "#8b5cf6",
      sessions: 0,
      inputTokens: "0",
      outputTokens: "0",
      totalTokens: "0",
      participationPercent: 0,
    },
  ];

  const rows = propRows !== undefined ? propRows : defaultRows;

  return (
    <div className="ui-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
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
            marginTop: "2px",
          }}
        >
          <i className="ph ph-cube" aria-hidden="true" />
        </div>
        <div>
          <h3 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-primary)" }}>
            Modelos observados
          </h3>
          <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            Desempenho e participação de cada modelo no período.
          </p>
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-subtle)", color: "var(--text-muted)", fontSize: "12px" }}>
              <th style={{ padding: "10px 8px", fontWeight: "600" }}>Modelo</th>
              <th style={{ padding: "10px 8px", fontWeight: "600" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  Sessões <i className="ph ph-arrows-down-up" style={{ fontSize: "11px" }} aria-hidden="true" />
                </span>
              </th>
              <th style={{ padding: "10px 8px", fontWeight: "600" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  Input tokens <i className="ph ph-arrows-down-up" style={{ fontSize: "11px" }} aria-hidden="true" />
                </span>
              </th>
              <th style={{ padding: "10px 8px", fontWeight: "600" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  Output tokens <i className="ph ph-arrows-down-up" style={{ fontSize: "11px" }} aria-hidden="true" />
                </span>
              </th>
              <th style={{ padding: "10px 8px", fontWeight: "600" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  Total tokens <i className="ph ph-arrows-down-up" style={{ fontSize: "11px" }} aria-hidden="true" />
                </span>
              </th>
              <th style={{ padding: "10px 8px", fontWeight: "600", minWidth: "120px" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  Participação <i className="ph ph-arrows-down-up" style={{ fontSize: "11px" }} aria-hidden="true" />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: "32px 8px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                  <i className="ph ph-info" style={{ fontSize: "16px", verticalAlign: "middle", marginRight: "6px" }} aria-hidden="true" />
                  Nenhum modelo utilizado registrado no período.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
              <tr
                key={index}
                style={{
                  borderBottom: "1px solid var(--border-subtle)",
                  transition: "background-color var(--transition-fast)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-card-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <td style={{ padding: "12px 8px", fontWeight: "600", color: "var(--text-primary)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <i className={`ph ${row.icon}`} style={{ fontSize: "18px", color: row.iconColor || "var(--color-brand-primary)" }} aria-hidden="true" />
                    <span>{row.name}</span>
                  </div>
                </td>
                <td style={{ padding: "12px 8px", color: "var(--text-secondary)" }}>{row.sessions}</td>
                <td style={{ padding: "12px 8px", color: "var(--text-secondary)" }}>{row.inputTokens}</td>
                <td style={{ padding: "12px 8px", color: "var(--text-secondary)" }}>{row.outputTokens}</td>
                <td style={{ padding: "12px 8px", fontWeight: "700", color: "var(--text-primary)" }}>{row.totalTokens}</td>
                <td style={{ padding: "12px 8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "12px", fontWeight: "600", minWidth: "28px", color: "var(--text-primary)" }}>
                      {row.participationPercent}%
                    </span>
                    <div
                      style={{
                        flex: 1,
                        height: "6px",
                        borderRadius: "var(--radius-full)",
                        backgroundColor: "var(--bg-card-secondary)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${row.participationPercent}%`,
                          height: "100%",
                          backgroundColor: "var(--color-brand-primary)",
                          borderRadius: "var(--radius-full)",
                        }}
                      />
                    </div>
                  </div>
                </td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
