import React from "react";

export type SlotStatus = "available" | "busy" | "mine" | "unavailable";

export interface ScheduleSlotProps {
  timeLabel: string;
  status: SlotStatus;
  isPast?: boolean;
  isCurrent?: boolean;
  onClick: () => void;
}

export function ScheduleSlot({ timeLabel, status, isPast, isCurrent, onClick }: ScheduleSlotProps) {
  const isClickable = status === "available" || status === "mine";

  return (
    <div
      onClick={isClickable ? onClick : undefined}
      className={`schedule-slot-card ${isClickable ? "is-clickable" : "is-disabled"}`}
      style={{
        padding: "10px 12px",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--schedule-slot-border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        cursor: isClickable ? "pointer" : "default",
        opacity: isPast ? 0.6 : 1,
        borderColor: isCurrent && status === "available" ? "var(--color-brand-primary)" : "var(--schedule-slot-border)",
        backgroundColor: isCurrent && status === "available" ? "rgba(var(--color-brand-primary-rgb), 0.08)" : "var(--schedule-slot-bg)",
        transition: "all var(--transition-fast)",
      }}
      onMouseEnter={(e) => {
        if (isClickable) {
          e.currentTarget.style.backgroundColor = "var(--schedule-slot-hover)";
          e.currentTarget.style.borderColor = "var(--border-strong)";
          e.currentTarget.style.transform = "translateY(-1px)";
        }
      }}
      onMouseLeave={(e) => {
        if (isClickable) {
          e.currentTarget.style.backgroundColor = "var(--schedule-slot-bg)";
          e.currentTarget.style.borderColor = "var(--schedule-slot-border)";
          e.currentTarget.style.transform = "none";
        }
      }}
    >
      <div>
        <div
          style={{
            fontSize: "13px",
            fontWeight: "700",
            color: "var(--text-primary)",
            lineHeight: "1.2",
            marginBottom: "4px",
          }}
        >
          {timeLabel}
        </div>

        {status === "available" && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "var(--color-success-text)", fontWeight: "600" }}>
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                backgroundColor: "var(--color-success)",
                display: "inline-block",
              }}
            />
            <span>{isCurrent ? "Disponível agora" : "Disponível"}</span>
          </div>
        )}

        {status === "mine" && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "var(--color-brand-primary)", fontWeight: "600" }}>
            <i className="ph ph-check-circle" aria-hidden="true" />
            <span>Sua reserva</span>
          </div>
        )}

        {status === "busy" && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "var(--text-muted)" }}>
            <i className="ph ph-clock" aria-hidden="true" />
            <span>Reservado</span>
          </div>
        )}

        {status === "unavailable" && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "var(--text-muted)" }}>
            <i className="ph ph-prohibit" aria-hidden="true" />
            <span>Indisponível</span>
          </div>
        )}
      </div>

      <i
        className="ph ph-caret-right"
        style={{
          fontSize: "14px",
          color: "var(--text-muted)",
          opacity: isClickable ? 0.9 : 0.4,
        }}
        aria-hidden="true"
      />
    </div>
  );
}
