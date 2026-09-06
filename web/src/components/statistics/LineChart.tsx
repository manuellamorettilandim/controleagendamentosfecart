import React, { useState } from "react";

export interface LineChartPoint {
  dateLabel: string;
  dayLabel: string;
  value: number;
  fullDate: string;
}

export interface LineChartProps {
  data?: LineChartPoint[];
}

export function LineChart({ data: propData }: LineChartProps = {}) {
  const [activeIdx, setActiveIdx] = useState<number>(0);

  const defaultData: LineChartPoint[] = [
    { dateLabel: "01/09", dayLabel: "Seg", value: 0, fullDate: "Segunda-feira" },
    { dateLabel: "02/09", dayLabel: "Ter", value: 0, fullDate: "Terça-feira" },
    { dateLabel: "03/09", dayLabel: "Qua", value: 0, fullDate: "Quarta-feira" },
    { dateLabel: "04/09", dayLabel: "Qui", value: 0, fullDate: "Quinta-feira" },
    { dateLabel: "05/09", dayLabel: "Sex", value: 0, fullDate: "Sexta-feira" },
    { dateLabel: "06/09", dayLabel: "Sáb", value: 0, fullDate: "Sábado" },
    { dateLabel: "07/09", dayLabel: "Dom", value: 0, fullDate: "Domingo" },
  ];

  const data = propData && propData.length > 0 ? propData : defaultData;

  // SVG dimensions
  const width = 540;
  const height = 200;
  const paddingLeft = 36;
  const paddingRight = 20;
  const paddingTop = 30;
  const paddingBottom = 40;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;
  const maxVal = Math.max(...data.map((d) => d.value), 0);
  const maxY = Math.max(5, Math.ceil(maxVal * 1.25));
  const yTicks = Array.from(new Set([0, Math.round(maxY * 0.25), Math.round(maxY * 0.5), Math.round(maxY * 0.75), maxY])).sort((a, b) => a - b);

  const points = data.map((d, i) => {
    const x = paddingLeft + (i / (data.length - 1)) * chartWidth;
    const y = paddingTop + chartHeight - (d.value / maxY) * chartHeight;
    return { ...d, x, y };
  });

  const pathD = `M ${points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ")}`;

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
            <i className="ph ph-chart-line-up" aria-hidden="true" />
          </div>
          <div>
            <h3 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-primary)" }}>
              Atividade de sessões ao longo do tempo
            </h3>
            <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              Número de sessões por dia na última semana.
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
          <span>Últimos 7 dias</span>
          <i className="ph ph-caret-down" aria-hidden="true" />
        </div>
      </div>

      {/* SVG Chart */}
      <div style={{ width: "100%", overflowX: "auto" }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: "100%", height: "auto", minWidth: "460px", overflow: "visible" }}
        >
          {/* Y Axis Grid Lines & Labels */}
          {yTicks.map((val) => {
            const y = paddingTop + chartHeight - (val / maxY) * chartHeight;
            return (
              <g key={val}>
                <text
                  x={paddingLeft - 10}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="11"
                  fill="var(--text-muted)"
                  fontWeight="500"
                >
                  {val}
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

          {/* Connected Line */}
          <path
            d={pathD}
            fill="none"
            stroke="var(--color-brand-primary)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Points & Interactive Tooltip */}
          {points.map((p, idx) => {
            const isHovered = activeIdx === idx;
            return (
              <g
                key={idx}
                style={{ cursor: "pointer" }}
                onClick={() => setActiveIdx(idx)}
                onMouseEnter={() => setActiveIdx(idx)}
              >
                {/* Vertical indicator line when active */}
                {isHovered && (
                  <line
                    x1={p.x}
                    y1={paddingTop}
                    x2={p.x}
                    y2={paddingTop + chartHeight}
                    stroke="var(--color-brand-primary)"
                    strokeWidth="1.5"
                    strokeDasharray="2 2"
                    opacity="0.6"
                  />
                )}

                {/* Point circle */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isHovered ? 6 : 4.5}
                  fill="var(--bg-card)"
                  stroke="var(--color-brand-primary)"
                  strokeWidth="2.5"
                  style={{ transition: "r var(--transition-fast)" }}
                />

                {/* Tooltip */}
                {isHovered && (
                  <g transform={`translate(${p.x}, ${p.y - 42})`}>
                    <rect
                      x="-55"
                      y="-12"
                      width="110"
                      height="38"
                      rx="6"
                      fill="var(--bg-card)"
                      stroke="var(--border-card)"
                      filter="drop-shadow(0 4px 6px rgba(0,0,0,0.15))"
                    />
                    <text
                      x="0"
                      y="4"
                      textAnchor="middle"
                      fontSize="12"
                      fontWeight="700"
                      fill="var(--text-primary)"
                    >
                      {p.value} sessões
                    </text>
                    <text
                      x="0"
                      y="18"
                      textAnchor="middle"
                      fontSize="10"
                      fill="var(--text-muted)"
                    >
                      {p.fullDate}
                    </text>
                  </g>
                )}

                {/* X Axis Label */}
                <text
                  x={p.x}
                  y={height - 18}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="600"
                  fill="var(--text-primary)"
                >
                  {p.dateLabel}
                </text>
                <text
                  x={p.x}
                  y={height - 5}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--text-muted)"
                >
                  {p.dayLabel}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
