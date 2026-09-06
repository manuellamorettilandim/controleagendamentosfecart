import React from "react";

export interface SessionUsageProps {
  remainingTimeFormatted: string;
  timePercentage: number;
  quotaRemainingPercent: number | null;
  startTimeFormatted: string;
  endTimeFormatted: string;
  durationLabel: string;
  modelsCount: number;
  totalTokensFormatted: string;
  commandsCount: number;
  statusLabel: string;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function SessionUsage({
  remainingTimeFormatted,
  timePercentage,
  quotaRemainingPercent,
  startTimeFormatted,
  endTimeFormatted,
  durationLabel,
  modelsCount,
  totalTokensFormatted,
  commandsCount,
  statusLabel,
  onRefresh,
  isRefreshing,
}: SessionUsageProps) {
  const quotaAvailable = quotaRemainingPercent !== null;
  const statusIsPositive = statusLabel === "Conectada" || statusLabel === "Em andamento";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* 1. Tempo restante */}
      <div
        className="ui-card"
        style={{
          padding: "20px",
          display: "flex",
          alignItems: "center",
          gap: "16px",
        }}
      >
        <div
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "50%",
            backgroundColor: "rgba(var(--color-brand-primary-rgb), 0.1)",
            color: "var(--color-brand-primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "24px",
            flexShrink: 0,
          }}
        >
          <i className="ph ph-clock" aria-hidden="true" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: "600" }}>
            Tempo restante
          </div>
          <div style={{ fontSize: "24px", fontWeight: "800", color: "var(--text-primary)", lineHeight: "1.2" }}>
            {remainingTimeFormatted}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "8px" }}>
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
                  width: `${Math.min(100, Math.max(0, timePercentage))}%`,
                  height: "100%",
                  backgroundColor: "var(--color-brand-primary)",
                  borderRadius: "var(--radius-full)",
                  transition: "width 0.4s ease",
                }}
              />
            </div>
            <span style={{ fontSize: "12px", fontWeight: "700", color: "var(--text-muted)" }}>
              {timePercentage}%
            </span>
          </div>
        </div>
      </div>

      {/* 2. Uso restante da sessão */}
      <div
        className="ui-card"
        style={{
          padding: "20px",
          display: "flex",
          alignItems: "center",
          gap: "16px",
        }}
      >
        <div
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "50%",
            backgroundColor: "rgba(16, 185, 129, 0.1)",
            color: "var(--color-success)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "24px",
            flexShrink: 0,
          }}
        >
          <i className="ph ph-chart-pie-slice" aria-hidden="true" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: "600" }}>
            Cota restante da sessão
          </div>
          <div style={{ fontSize: "24px", fontWeight: "800", color: "var(--text-primary)", lineHeight: "1.2" }}>
            {quotaAvailable ? `${quotaRemainingPercent}% disponível` : "Aguardando dados"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "8px" }}>
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
                  width: `${quotaAvailable ? Math.min(100, Math.max(0, quotaRemainingPercent ?? 0)) : 0}%`,
                  height: "100%",
                  backgroundColor: "var(--color-success)",
                  borderRadius: "var(--radius-full)",
                  transition: "width 0.4s ease",
                }}
              />
            </div>
            <span style={{ fontSize: "12px", fontWeight: "700", color: "var(--text-muted)" }}>
              {quotaAvailable ? `${quotaRemainingPercent}%` : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* 3. Horário da sessão */}
      <div className="ui-card" style={{ padding: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
          <i className="ph ph-calendar-blank" style={{ fontSize: "18px", color: "var(--color-brand-primary)" }} aria-hidden="true" />
          <strong style={{ fontSize: "14px", color: "var(--text-primary)" }}>Horário da sessão</strong>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-muted)" }}>
              <i className="ph ph-arrow-circle-up-right" aria-hidden="true" />
              Início
            </span>
            <span style={{ fontWeight: "600", color: "var(--text-primary)" }}>{startTimeFormatted}</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-muted)" }}>
              <i className="ph ph-arrow-circle-down-right" aria-hidden="true" />
              Término
            </span>
            <span style={{ fontWeight: "600", color: "var(--text-primary)" }}>{endTimeFormatted}</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-muted)" }}>
              <i className="ph ph-clock" aria-hidden="true" />
              Duração total
            </span>
            <span style={{ fontWeight: "600", color: "var(--text-primary)" }}>{durationLabel}</span>
          </div>
        </div>
      </div>

      {/* 4. Sua utilização (with unified Refresh action) */}
      <div className="ui-card" style={{ padding: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <i className="ph ph-chart-bar" style={{ fontSize: "18px", color: "var(--color-brand-primary)" }} aria-hidden="true" />
            <strong style={{ fontSize: "14px", color: "var(--text-primary)" }}>Sua utilização</strong>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onRefresh}
            disabled={isRefreshing}
            style={{ padding: "4px 10px", fontSize: "12px", borderRadius: "var(--radius-sm)" }}
          >
            <i className={`ph ph-arrows-clockwise ${isRefreshing ? "icon-spinning" : ""}`} aria-hidden="true" />
            <span>Atualizar</span>
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-muted)" }}>
              <i className="ph ph-cpu" aria-hidden="true" />
              Modelos usados
            </span>
            <span style={{ fontWeight: "700", color: "var(--text-primary)" }}>{modelsCount}</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-muted)" }}>
              <i className="ph ph-database" aria-hidden="true" />
              Total de tokens
            </span>
            <span style={{ fontWeight: "700", color: "var(--text-primary)" }}>{totalTokensFormatted}</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-muted)" }}>
              <i className="ph ph-terminal" aria-hidden="true" />
              Comandos executados
            </span>
            <span style={{ fontWeight: "700", color: "var(--text-primary)" }}>{commandsCount}</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-muted)" }}>
              <i className="ph ph-activity" aria-hidden="true" />
              Status
            </span>
            <span className={`badge ${statusIsPositive ? "badge-success" : "badge-warning"}`} style={{ fontSize: "11px", padding: "2px 8px" }}>
              <span className="badge-dot" />
              {statusLabel}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
