import React from "react";
import { ScheduleDay, DaySlotData } from "./ScheduleDay";

export interface AccountOption {
  accountId: string;
  label: string;
  status?: string;
  isDefault?: boolean;
  rate_limits?: Record<string, any>;
  rateLimits?: Record<string, any>;
  usage?: Record<string, any>;
}

export interface DayScheduleData {
  date: Date;
  dayName: string;
  dayNumber: string;
  isToday: boolean;
  slots: DaySlotData[];
}

export interface ScheduleGridProps {
  accounts: AccountOption[];
  selectedAccountId: string;
  onSelectAccount: (accountId: string) => void;
  weekLabel: string;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  days: DayScheduleData[];
  onSelectSlot: (day: DayScheduleData, slot: DaySlotData) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  isHighlighted?: boolean;
}

export function ScheduleGrid({
  accounts,
  selectedAccountId,
  onSelectAccount,
  weekLabel,
  onPrevWeek,
  onNextWeek,
  days,
  onSelectSlot,
  onRefresh,
  isRefreshing,
  isHighlighted,
}: ScheduleGridProps) {
  return (
    <section
      id="schedule-section"
      className={`ui-card schedule-highlight ${isHighlighted ? "schedule-highlight-active" : ""}`}
      style={{
        padding: "24px",
        display: "flex",
        flexDirection: "column",
        gap: "20px",
      }}
      aria-labelledby="schedule-title"
    >
      {/* Header Bar */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
          borderBottom: "1px solid var(--border-subtle)",
          paddingBottom: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "rgba(var(--color-brand-primary-rgb), 0.1)",
              color: "var(--color-brand-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "20px",
            }}
          >
            <i className="ph ph-calendar" aria-hidden="true" />
          </div>
          <div>
            <h2 id="schedule-title" style={{ fontSize: "18px", fontWeight: "700", color: "var(--text-primary)" }}>
              Agenda da Semana
            </h2>
            <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>
              Escolha um horário disponível e reserve sua sessão.
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          {/* Account Switcher */}
          {accounts.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "13px", color: "var(--text-muted)", fontWeight: "500" }}>Conta:</span>
              <div
                style={{
                  display: "flex",
                  gap: "4px",
                  backgroundColor: "var(--bg-card-secondary)",
                  padding: "3px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                {accounts.map((account) => {
                  const isSelected = account.accountId === selectedAccountId;
                  return (
                    <button
                      key={account.accountId}
                      type="button"
                      onClick={() => onSelectAccount(account.accountId)}
                      style={{
                        padding: "4px 12px",
                        fontSize: "12px",
                        fontWeight: isSelected ? "700" : "500",
                        borderRadius: "var(--radius-sm)",
                        border: isSelected ? "1px solid var(--color-brand-primary)" : "1px solid transparent",
                        backgroundColor: isSelected ? "var(--bg-card)" : "transparent",
                        color: isSelected ? "var(--color-brand-primary)" : "var(--text-secondary)",
                        cursor: "pointer",
                        transition: "all var(--transition-fast)",
                      }}
                    >
                      {account.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Week Navigation */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              backgroundColor: "var(--bg-card-secondary)",
              padding: "4px 8px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <button
              type="button"
              onClick={onPrevWeek}
              aria-label="Semana anterior"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--text-muted)",
                display: "flex",
                alignItems: "center",
                padding: "4px",
                borderRadius: "var(--radius-xs)",
              }}
            >
              <i className="ph ph-caret-left" style={{ fontSize: "16px" }} aria-hidden="true" />
            </button>
            <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-primary)", minWidth: "160px", textAlign: "center" }}>
              {weekLabel}
            </span>
            <button
              type="button"
              onClick={onNextWeek}
              aria-label="Próxima semana"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--text-muted)",
                display: "flex",
                alignItems: "center",
                padding: "4px",
                borderRadius: "var(--radius-xs)",
              }}
            >
              <i className="ph ph-caret-right" style={{ fontSize: "16px" }} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* 7 Days Grid */}
      <div
        className="schedule-week-row"
        style={{
          display: "flex",
          gap: "10px",
          overflowX: "auto",
          paddingBottom: "8px",
        }}
      >
        {days.map((day, idx) => (
          <ScheduleDay
            key={idx}
            dayName={day.dayName}
            dayNumber={day.dayNumber}
            isToday={day.isToday}
            slots={day.slots}
            onSelectSlot={(slot) => onSelectSlot(day, slot)}
          />
        ))}
      </div>

      {/* Bottom Tip Bar & Refresh Action */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "12px",
          paddingTop: "12px",
          borderTop: "1px solid var(--border-subtle)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", color: "var(--text-muted)" }}>
          <div
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "50%",
              backgroundColor: "rgba(var(--color-brand-primary-rgb), 0.1)",
              color: "var(--color-brand-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "16px",
              flexShrink: 0,
            }}
          >
            <i className="ph ph-lightbulb" aria-hidden="true" />
          </div>
          <span>
            <strong style={{ color: "var(--text-primary)" }}>Dica:</strong> não encontrou um horário ideal? Novos horários são liberados regularmente. Fique atento!
          </span>
        </div>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={onRefresh}
          disabled={isRefreshing}
          style={{ padding: "8px 14px", fontSize: "12px", borderRadius: "var(--radius-md)" }}
        >
          <i className={`ph ph-arrows-clockwise ${isRefreshing ? "icon-spinning" : ""}`} aria-hidden="true" />
          <span>Atualizar agenda</span>
        </button>
      </div>
    </section>
  );
}
