import React, { useEffect, useState } from "react";

export interface ReservationInfo {
  id: string;
  accountId: string;
  accountLabel?: string;
  startsAt: string;
  endsAt: string;
  status: string;
  approvalStatus: string;
}

export interface NextSessionCardProps {
  session: ReservationInfo | null;
  onViewDetails: () => void;
  onScheduleClick: () => void;
}

export function formatCountdown(targetIso: string, nowMs = Date.now()): string {
  const remainingSeconds = Math.max(0, Math.ceil((Date.parse(targetIso) - nowMs) / 1000));
  if (remainingSeconds === 0) return "agora";

  const days = Math.floor(remainingSeconds / 86_400);
  const hours = Math.floor((remainingSeconds % 86_400) / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);
  const seconds = remainingSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}min`;
  return `${pad(hours)}h ${pad(minutes)}min ${pad(seconds)}s`;
}

export function NextSessionCard({ session, onViewDetails, onScheduleClick }: NextSessionCardProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!session) return;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [session?.id, session?.startsAt]);

  function formatDateHeader(isoDate: string) {
    const d = new Date(isoDate);
    const today = new Date();
    const isToday =
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear();
    const dateFormatted = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
    return isToday ? `Hoje, ${dateFormatted}` : dateFormatted;
  }

  function formatTimeRange(startIso: string, endIso: string) {
    const s = new Date(startIso);
    const e = new Date(endIso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(s.getHours())}:${pad(s.getMinutes())} - ${pad(e.getHours())}:${pad(e.getMinutes())}`;
  }

  return (
    <div
      className="next-session-card ui-card"
      style={{
        padding: "20px 24px",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
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
          }}
        >
          <i className="ph ph-calendar-blank" aria-hidden="true" />
        </div>
        <h2 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-primary)" }}>
          Próxima sessão
        </h2>
      </div>

      {session ? (
        <>
          <div
            onClick={onViewDetails}
            style={{
              padding: "14px 16px",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--bg-card-secondary)",
              border: "1px solid var(--border-card)",
              borderLeft: "4px solid var(--color-success)",
              cursor: "pointer",
              transition: "transform var(--transition-fast), border-color var(--transition-fast)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
              <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-success-text)" }}>
                {formatDateHeader(session.startsAt)}
              </span>
              <span className="badge badge-success" style={{ fontSize: "11px", padding: "2px 8px" }}>
                <i className="ph ph-check" aria-hidden="true" />
                Confirmada
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <strong style={{ fontSize: "18px", fontWeight: "800", color: "var(--text-primary)" }}>
                {formatTimeRange(session.startsAt, session.endsAt)}
              </strong>
              <i className="ph ph-caret-right" style={{ color: "var(--text-muted)", fontSize: "16px" }} aria-hidden="true" />
            </div>

            <div
              data-testid="next-session-countdown"
              aria-live="polite"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "7px",
                padding: "8px 10px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "rgba(var(--color-brand-primary-rgb), 0.08)",
                color: "var(--text-brand)",
                fontSize: "12px",
                marginBottom: "10px",
              }}
            >
              <i className="ph ph-clock-countdown" aria-hidden="true" />
              <span>Começa em</span>
              <strong>{formatCountdown(session.startsAt, nowMs)}</strong>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "14px", fontSize: "12px", color: "var(--text-muted)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <i className="ph ph-cpu" aria-hidden="true" />
                {session.accountLabel || "ChatGPT 01"}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <i className="ph ph-clock" aria-hidden="true" />
                5 horas
              </span>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-outline-brand"
            onClick={onViewDetails}
            style={{ width: "100%", padding: "10px" }}
          >
            Ver detalhes da sessão
          </button>
        </>
      ) : (
        <div style={{ padding: "16px 0", textAlign: "center" }}>
          <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "14px" }}>
            Nenhuma sessão agendada no momento.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onScheduleClick}
            style={{ width: "100%", padding: "10px" }}
          >
            <i className="ph ph-calendar-plus" aria-hidden="true" />
            <span>Agendar horário</span>
          </button>
        </div>
      )}
    </div>
  );
}
