import React, { useState } from "react";
import { ReservationInfo } from "../overview/NextSessionCard";

export interface ReservationActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  reservation: ReservationInfo | null;
  onCancelReservation: (reservationId: string) => Promise<void>;
}

export function ReservationActionModal({
  isOpen,
  onClose,
  reservation,
  onCancelReservation,
}: ReservationActionModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen || !reservation) return null;

  const start = new Date(reservation.startsAt);
  const end = new Date(reservation.endsAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const timeFormatted = `${start.toLocaleDateString("pt-BR")} das ${pad(start.getHours())}:${pad(start.getMinutes())} às ${pad(end.getHours())}:${pad(end.getMinutes())}`;

  async function handleCancel() {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      await onCancelReservation(reservation!.id);
      onClose();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Não foi possível cancelar o agendamento.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-action-title">
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "460px" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span className="kicker-tag" style={{ marginBottom: "2px" }}>GERENCIAR HORÁRIO</span>
            <h3 id="modal-action-title" style={{ fontSize: "18px", fontWeight: "700", color: "var(--text-primary)" }}>
              Detalhes da reserva
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              padding: "6px",
              borderRadius: "50%",
            }}
          >
            <i className="ph ph-x" style={{ fontSize: "18px" }} aria-hidden="true" />
          </button>
        </div>

        <div style={{ padding: "20px 24px" }}>
          {errorMessage && (
            <div style={{ padding: "10px 14px", backgroundColor: "var(--color-danger-bg)", color: "var(--color-danger-text)", borderRadius: "var(--radius-sm)", marginBottom: "16px", fontSize: "13px" }}>
              {errorMessage}
            </div>
          )}

          <div
            style={{
              padding: "16px",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--bg-card-secondary)",
              border: "1px solid var(--border-card)",
              marginBottom: "20px",
            }}
          >
            <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "4px" }}>
              Horário reservado
            </div>
            <div style={{ fontSize: "15px", fontWeight: "700", color: "var(--text-primary)", marginBottom: "10px" }}>
              {timeFormatted}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "12px" }}>
              <span className="badge badge-success" style={{ fontSize: "11px" }}>
                <i className="ph ph-check" aria-hidden="true" />
                {reservation.approvalStatus === "approved" ? "Aprovado" : "Pendente"}
              </span>
              <span style={{ color: "var(--text-muted)" }}>
                Conta: <strong>{reservation.accountLabel || "ChatGPT 01"}</strong>
              </span>
            </div>
          </div>

          <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "20px" }}>
            Se você não puder comparecer, cancele o agendamento com antecedência para liberar a vaga para outros colegas da turma.
          </p>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isSubmitting}>
              Voltar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCancel}
              disabled={isSubmitting}
              style={{ backgroundColor: "var(--color-danger)", borderColor: "var(--color-danger)" }}
            >
              {isSubmitting ? (
                <>
                  <i className="ph ph-spinner icon-spinning" aria-hidden="true" />
                  <span>Cancelando...</span>
                </>
              ) : (
                <>
                  <i className="ph ph-trash" aria-hidden="true" />
                  <span>Cancelar agendamento</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
