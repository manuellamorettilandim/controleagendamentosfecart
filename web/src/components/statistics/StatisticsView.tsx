import React from "react";
import { StatisticsCard } from "./StatisticsCard";
import { LineChart, LineChartPoint } from "./LineChart";
import { BarChart, BarChartItem } from "./BarChart";
import { TokenHeatmap } from "./TokenHeatmap";
import { ObservedModelsTable, ObservedModelRow } from "./ObservedModelsTable";

export interface StatisticsViewProps {
  dateRangeLabel?: string;
  sessionsCount?: string;
  sessionsDeltaText?: string;
  hoursCount?: string;
  hoursDeltaText?: string;
  tokensCount?: string;
  tokensDeltaText?: string;
  occupancyRate?: string;
  occupancyDeltaText?: string;
  lineChartData?: LineChartPoint[];
  barChartItems?: BarChartItem[];
  heatmapMatrix?: number[][];
  observedModels?: ObservedModelRow[];
}

export function StatisticsView({
  dateRangeLabel = "Semana atual",
  sessionsCount = "0",
  sessionsDeltaText = "Sessões agendadas",
  hoursCount = "0 h",
  hoursDeltaText = "Horas reservadas",
  tokensCount = "0",
  tokensDeltaText = "Tokens consumidos",
  occupancyRate = "100%",
  occupancyDeltaText = "Taxa de aprovação",
  lineChartData,
  barChartItems,
  heatmapMatrix,
  observedModels,
}: StatisticsViewProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Page Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <span className="kicker-tag">DADOS REAIS. MAIS DECISÕES.</span>
          <h1 style={{ fontSize: "28px", fontWeight: "800", color: "var(--text-primary)", letterSpacing: "-0.02em", marginBottom: "6px" }}>
            Estatísticas & Modelos
          </h1>
          <p style={{ fontSize: "14px", color: "var(--text-secondary)", maxWidth: "680px", lineHeight: "1.4" }}>
            Acompanhe o uso da sua conta, entenda os padrões de consumo e veja os modelos disponíveis para aproveitar melhor o ChatGPT e o Codex.
          </p>
        </div>

        {/* Date Range Indicator */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            backgroundColor: "var(--bg-card)",
            padding: "8px 14px",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-card)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <i className="ph ph-calendar" style={{ fontSize: "18px", color: "var(--color-brand-primary)" }} aria-hidden="true" />
          <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-primary)" }}>{dateRangeLabel}</span>
        </div>
      </div>

      {/* 4 Metric Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: "16px",
        }}
      >
        <StatisticsCard
          icon="ph-users-three"
          iconBgColor="rgba(var(--color-brand-primary-rgb), 0.1)"
          iconColor="var(--color-brand-primary)"
          title="Sessões esta semana"
          value={sessionsCount}
          deltaText={sessionsDeltaText}
          sparklineColor="#10b981"
          sparklineData={[0, 1, 1, 2, 2, 3, Number(sessionsCount) || 1]}
        />

        <StatisticsCard
          icon="ph-clock"
          iconBgColor="rgba(59, 130, 246, 0.1)"
          iconColor="#3b82f6"
          title="Horas utilizadas"
          value={hoursCount}
          deltaText={hoursDeltaText}
          sparklineColor="#3b82f6"
          sparklineData={[0, 2, 4, 5, 8, 10, parseFloat(hoursCount) || 1]}
        />

        <StatisticsCard
          icon="ph-database"
          iconBgColor="rgba(168, 85, 247, 0.1)"
          iconColor="#a855f7"
          title="Tokens totais"
          value={tokensCount}
          deltaText={tokensDeltaText}
          sparklineColor="#a855f7"
          sparklineData={[0, 0, 1, 1, 2, 3, 5]}
        />

        <StatisticsCard
          icon="ph-chart-pie-slice"
          iconBgColor="rgba(245, 158, 11, 0.1)"
          iconColor="#f59e0b"
          title="Taxa de aprovação"
          value={occupancyRate}
          deltaText={occupancyDeltaText}
          sparklineColor="#f59e0b"
          sparklineData={[50, 75, 80, 90, 95, 100, parseInt(occupancyRate) || 100]}
        />
      </div>

      {/* Charts Row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(440px, 1fr))",
          gap: "20px",
        }}
      >
        <LineChart data={lineChartData} />
        <BarChart items={barChartItems} />
      </div>

      {/* Heatmap & Models Row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(440px, 1fr))",
          gap: "20px",
        }}
      >
        <TokenHeatmap matrix={heatmapMatrix} />
        <ObservedModelsTable rows={observedModels} />
      </div>
    </div>
  );
}
