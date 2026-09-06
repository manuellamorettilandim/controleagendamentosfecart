import React, { useState } from "react";

export interface BarChartItem {
  modelId: string;
  label: string;
  tokensMillion: number;
  color: string;
}

export interface BarChartProps {
  items?: BarChartItem[];
}

export function BarChart({ items: propItems }: BarChartProps = {}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const defaultItems: BarChartItem[] = [
    { modelId: "gpt-5.6-sol", label: "gpt-5.6 sol", tokensMillion: 0, color: "#2563eb" },
    { modelId: "gpt-5.6-terra", label: "gpt-5.6 terra", tokensMillion: 0, color: "#3b82f6" },
    { modelId: "gpt-5.6-luna", label: "gpt-5.6 luna", tokensMillion: 0, color: "#60a5fa" },
    { modelId: "gpt-4o", label: "gpt-4o", tokensMillion: 0, color: "#93c5fd" },
    { modelId: "o4-mini", label: "o4-mini", tokensMillion: 0, color: "#bfdbfe" },
  ];

  const items = propItems && propItems.length > 0 ? propItems : defaultItems;

  const width = 540;
  const height = 200;
  const paddingLeft = 36;
  const paddingRight = 20;
  const paddingTop = 30;
  const paddingBottom = 40;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;
  const maxVal = Math.max(...items.map((i) => i.tokensMillion), 0);
  const maxY = Math.max(1.0, Number((maxVal * 1.25).toFixed(1)));
  const stepVal = maxY / 4;
  const yTicks = [0, 1, 2, 3, 4].map((idx) => Number((stepVal * idx).toFixed(1)));

  const barWidth = Math.min(44, Math.max(20, Math.floor((chartWidth / items.length) * 0.6)));
  const step = chartWidth / items.length;

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
            <i className="ph ph-database" aria-hidden="true" />
          </div>
          <div>
            <h3 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-primary)" }}>
              Uso por modelo
            </h3>
            <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              Total de tokens (input + output) por modelo.
            </p>
          </div>
        </div>

        <div
          style={{
            padding: "4px 10px",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "var(--bg-card-secondary)",
            border: "1px solid var(--border-subtle)",
            fontSize: "12px",
            color: "var(--text-secondary)",
            fontWeight: "500",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span>Tokens totais</span>
          <i className="ph ph-caret-down" aria-hidden="true" />
        </div>
      </div>

      <div style={{ width: "100%", overflowX: "auto" }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: "100%", height: "auto", minWidth: "460px", overflow: "visible" }}
        >
          {/* Y Axis Grid Lines & Labels */}
          {yTicks.map((val) => {
            const y = paddingTop + chartHeight - (val / maxY) * chartHeight;
            const label = val === 0 ? "0" : val >= 1 ? `${val.toString().replace(".", ",")}M` : `${Math.round(val * 1000)}k`;
            return (
              <g key={val}>
                <text
                  x={paddingLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="11"
                  fill="var(--text-muted)"
                  fontWeight="500"
                >
                  {label}
                </text>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={width - paddingRight}
                  y2={y}
                  stroke="var(--border-subtle)"
                  strokeDasharray="4 4"
                />
              </g>
            );
          })}

          {/* Bars */}
          {items.map((item, idx) => {
            const rawBarHeight = (item.tokensMillion / maxY) * chartHeight;
            const barHeight = item.tokensMillion > 0 ? Math.max(rawBarHeight, 4) : 0;
            const x = paddingLeft + idx * step + (step - barWidth) / 2;
            const y = paddingTop + chartHeight - barHeight;
            const isHovered = hoveredIdx === idx;
            const displayVal = item.tokensMillion <= 0
              ? "0"
              : item.tokensMillion >= 1
                ? `${item.tokensMillion.toFixed(1).replace(".", ",")}M`
                : `${Math.round(item.tokensMillion * 1000)}k`;

            return (
              <g
                key={item.modelId}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                {/* Bar Value on Top */}
                <text
                  x={x + barWidth / 2}
                  y={y - 8}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight="700"
                  fill="var(--text-primary)"
                >
                  {displayVal}
                </text>

                {/* Rect Bar */}
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  rx="6"
                  fill={item.color}
                  opacity={isHovered ? 1 : 0.88}
                  style={{ transition: "opacity var(--transition-fast), transform var(--transition-fast)" }}
                />

                {/* X Axis Model Label */}
                <text
                  x={x + barWidth / 2}
                  y={height - 10}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="600"
                  fill="var(--text-secondary)"
                >
                  {item.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
