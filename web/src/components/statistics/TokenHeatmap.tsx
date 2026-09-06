import React from "react";

export interface TokenHeatmapProps {
  matrix?: number[][];
}

export function TokenHeatmap({ matrix: propMatrix }: TokenHeatmapProps = {}) {
  const days = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const hours = ["0h", "2h", "4h", "6h", "8h", "10h", "12h", "14h", "16h", "18h", "20h", "22h"];

  const defaultMatrix: number[][] = Array.from({ length: 7 }, () => Array(12).fill(0));
  const matrix = propMatrix && propMatrix.length === 7 ? propMatrix : defaultMatrix;

  function getCellColor(level: number) {
    switch (level) {
      case 5:
        return "#1d4ed8"; // Strong royal blue
      case 4:
        return "#2563eb"; // Brand primary
      case 3:
        return "#3b82f6"; // Medium blue
      case 2:
        return "#60a5fa"; // Soft blue
      case 1:
        return "rgba(var(--color-brand-primary-rgb), 0.2)"; // Pale blue tint
      default:
        return "var(--bg-card-secondary)"; // Idle / none
    }
  }

  return (
    <div className="ui-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
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
            <i className="ph ph-calendar-blank" aria-hidden="true" />
          </div>
          <div>
            <h3 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-primary)" }}>
              Atividade de tokens por dia e horário
            </h3>
            <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              Intensidade de uso de tokens ao longo da semana.
            </p>
          </div>
        </div>

        {/* Legend */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", color: "var(--text-muted)" }}>
          <span>Menor uso</span>
          <div style={{ display: "flex", gap: "3px" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "2px", backgroundColor: "var(--bg-card-secondary)", border: "1px solid var(--border-subtle)" }} />
            <span style={{ width: "10px", height: "10px", borderRadius: "2px", backgroundColor: "rgba(var(--color-brand-primary-rgb), 0.2)" }} />
            <span style={{ width: "10px", height: "10px", borderRadius: "2px", backgroundColor: "#60a5fa" }} />
            <span style={{ width: "10px", height: "10px", borderRadius: "2px", backgroundColor: "#2563eb" }} />
            <span style={{ width: "10px", height: "10px", borderRadius: "2px", backgroundColor: "#1d4ed8" }} />
          </div>
          <span>Maior uso</span>
        </div>
      </div>

      {/* Heatmap Grid */}
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: "460px", display: "flex", flexDirection: "column", gap: "6px" }}>
          {matrix.map((row, dayIdx) => (
            <div key={dayIdx} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span
                style={{
                  width: "32px",
                  fontSize: "11px",
                  fontWeight: "600",
                  color: "var(--text-muted)",
                  textAlign: "right",
                  paddingRight: "4px",
                }}
              >
                {days[dayIdx]}
              </span>
              <div style={{ display: "flex", flex: 1, gap: "5px" }}>
                {row.map((level, hIdx) => (
                  <div
                    key={hIdx}
                    title={`${days[dayIdx]} às ${hours[hIdx]} - Nível de uso: ${level}`}
                    style={{
                      flex: 1,
                      height: "18px",
                      borderRadius: "3px",
                      backgroundColor: getCellColor(level),
                      border: level === 0 ? "1px solid var(--border-subtle)" : "none",
                      transition: "transform var(--transition-fast)",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.15)")}
                    onMouseLeave={(e) => (e.currentTarget.style.transform = "none")}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Hour labels row */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
            <span style={{ width: "32px" }} />
            <div style={{ display: "flex", flex: 1, gap: "5px" }}>
              {hours.map((h, hIdx) => (
                <span
                  key={hIdx}
                  style={{
                    flex: 1,
                    fontSize: "10px",
                    fontWeight: "500",
                    color: "var(--text-muted)",
                    textAlign: "center",
                  }}
                >
                  {h}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
