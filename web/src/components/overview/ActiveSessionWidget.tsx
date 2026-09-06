import React from "react";

export interface ActiveSessionWidgetProps {
  isActive: boolean;
  remainingTimeFormatted?: string;
  onOpenActiveSession: () => void;
}

export function ActiveSessionWidget({
  isActive,
  remainingTimeFormatted,
  onOpenActiveSession,
}: ActiveSessionWidgetProps) {
  return (
    <div
      className={`active-session-widget ui-card ${
        isActive ? "active-session-widget-live" : "active-session-widget-idle"
      }`}
    >
      <div className="active-session-widget-header">
        <div className={`active-session-widget-icon ${isActive ? "is-live" : ""}`} aria-hidden="true">
          <i className={`ph ${isActive ? "ph-broadcast" : "ph-clock"}`} />
        </div>
        <div className="active-session-widget-heading">
          {isActive && (
            <span className="active-session-widget-eyebrow">
              <span className="active-session-live-dot" aria-hidden="true" />
              Acesso liberado agora
            </span>
          )}
          <strong>Sessão ativa</strong>
        </div>
        {isActive && (
          <span className="badge badge-success active-session-status-badge">
            <span className="badge-dot" />
            Em andamento
          </span>
        )}
      </div>

      {isActive ? (
        <div className="active-session-widget-details">
          <div className="active-session-widget-time" aria-live="polite">
            <i className="ph ph-timer" aria-hidden="true" />
            <strong>{remainingTimeFormatted || "—"}</strong>
            <span>restantes</span>
          </div>
          <button
            type="button"
            className="btn btn-primary active-session-widget-action"
            onClick={onOpenActiveSession}
            aria-label="Acessar sessão ativa"
          >
            <span>Acessar</span>
            <i className="ph ph-arrow-right" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <p className="active-session-widget-description">
          Nenhuma sessão ativa agora. Reserve um horário para começar.
        </p>
      )}
    </div>
  );
}
