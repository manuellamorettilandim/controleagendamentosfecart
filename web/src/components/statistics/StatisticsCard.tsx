import React from "react";

export interface MetricCardProps {
  icon: string;
  iconBgColor?: string;
  iconColor?: string;
  title: string;
  value: string;
  deltaText: string;
  sparklineColor: string;
  sparklineData: number[];
}

export function StatisticsCard({
  icon,
  iconBgColor = "rgba(var(--color-brand-primary-rgb), 0.1)",
  iconColor = "var(--color-brand-primary)",
  title,
  value,
  deltaText,
  sparklineColor,
  sparklineData,
}: MetricCardProps) {
  // Generate SVG path for sparkline
  const width = 120;
  const height = 36;
  const min = Math.min(...sparklineData);
  const max = Math.max(...sparklineData);
  const range = max - min || 1;

  const points = sparklineData.map((d, i) => {
    const x = (i / (sparklineData.length - 1)) * width;
    const y = height - ((d - min) / range) * (height - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const pathD = `M ${points.join(" L ")}`;

  return (
    <div
      className="ui-card"
      style={{
        padding: "20px 24px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "var(--radius-sm)",
            backgroundColor: iconBgColor,
            color: iconColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "20px",
            flexShrink: 0,
          }}
        >
          <i className={`ph ${icon}`} aria-hidden="true" />
        </div>
        <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-muted)" }}>
          {title}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "12px" }}>
        <div>
          <div style={{ fontSize: "28px", fontWeight: "800", color: "var(--text-primary)", lineHeight: "1.1" }}>
            {value}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "12px",
              fontWeight: "600",
              color: "var(--color-success-text)",
              marginTop: "6px",
            }}
          >
            <i className="ph ph-trend-up" aria-hidden="true" />
            <span>{deltaText}</span>
          </div>
        </div>

        {/* Sparkline curve */}
        <div style={{ width: `${width}px`, height: `${height}px` }}>
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: "visible" }}>
            <path
              d={pathD}
              fill="none"
              stroke={sparklineColor}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
