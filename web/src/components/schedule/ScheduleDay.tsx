import React from "react";
import { ScheduleSlot, SlotStatus } from "./ScheduleSlot";

export interface DaySlotData {
  timeLabel: string;
  start: Date;
  end: Date;
  startHour?: number;
  endHour?: number;
  status: SlotStatus;
  isPast?: boolean;
  isCurrent?: boolean;
  canStartNow?: boolean;
  isPartial?: boolean;
  durationHours?: number;
  reservationId?: string;
  approvalStatus?: string;
}

export interface ScheduleDayProps {
  dayName: string;
  dayNumber: string;
  isToday: boolean;
  slots: DaySlotData[];
  onSelectSlot: (slot: DaySlotData) => void;
}

export function ScheduleDay({ dayName, dayNumber, isToday, slots, onSelectSlot }: ScheduleDayProps) {
  const availableCount = slots.filter((s) => s.status === "available").length;

  return (
    <div
      className={`schedule-day-column ${isToday ? "is-today" : ""}`}
      style={{
        flex: "1 1 0",
        minWidth: "140px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        padding: "12px 10px",
        borderRadius: "var(--radius-lg)",
        backgroundColor: isToday ? "rgba(var(--color-brand-primary-rgb), 0.04)" : "transparent",
        border: isToday ? "1px solid rgba(var(--color-brand-primary-rgb), 0.3)" : "1px solid transparent",
        transition: "all var(--transition-fast)",
      }}
    >
      {/* Day Header */}
      <div style={{ textAlign: "center", paddingBottom: "8px" }}>
        {isToday ? (
          <span
            style={{
              display: "inline-block",
              fontSize: "10px",
              fontWeight: "800",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              padding: "2px 8px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--color-brand-primary)",
              color: "#ffffff",
              marginBottom: "4px",
            }}
          >
            HOJE
          </span>
        ) : (
          <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-muted)", textTransform: "capitalize" }}>
            {dayName}
          </div>
        )}

        <div
          style={{
            fontSize: "20px",
            fontWeight: "800",
            color: "var(--text-primary)",
            lineHeight: "1.2",
          }}
        >
          {isToday ? `${dayName} ${dayNumber}` : dayNumber}
        </div>

        <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
          {availableCount === 1 ? "1 vaga disponível" : `${availableCount} vagas disponíveis`}
        </div>

        <div
          style={{
            width: "24px",
            height: "2px",
            backgroundColor: isToday ? "var(--color-brand-primary)" : "var(--border-subtle)",
            margin: "8px auto 0",
            borderRadius: "1px",
          }}
        />
      </div>

      {/* Slots */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {slots.map((slot, index) => (
          <ScheduleSlot
            key={index}
            timeLabel={slot.timeLabel}
            status={slot.status}
            isPast={slot.isPast}
            isCurrent={slot.isCurrent}
            onClick={() => onSelectSlot(slot)}
          />
        ))}
      </div>
    </div>
  );
}
