import React, { useState, useEffect, useMemo } from "react";
import { AccountOption } from "./ScheduleGrid";
import { DaySlotData } from "./ScheduleDay";
import { FIXED_DAILY_SLOTS, generateSlotsForDate } from "../../features/dashboard/scheduleSlots";

export interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: AccountOption[];
  selectedAccountId: string;
  initialDate: Date | null;
  initialSlot?: DaySlotData | null;
  initialSlotTime?: string;
  onConfirmBooking: (accountId: string, startsAt: Date, durationHours?: number) => Promise<void>;
  reservations?: any[];
  busySlots?: any[];
}

export function BookingModal({
  isOpen,
  onClose,
  accounts,
  selectedAccountId: defaultAccountId,
  initialDate,
  initialSlot,
  initialSlotTime,
  onConfirmBooking,
  reservations = [],
  busySlots = [],
}: BookingModalProps) {
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [selectedDateStr, setSelectedDateStr] = useState("");
  const [selectedTimeStr, setSelectedTimeStr] = useState("14:00");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!isOpen) return;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [isOpen]);

  useEffect(() => {
    setAccountId(defaultAccountId);
  }, [defaultAccountId]);

  useEffect(() => {
    if (initialDate) {
      const pad = (n: number) => String(n).padStart(2, "0");
      setSelectedDateStr(`${initialDate.getFullYear()}-${pad(initialDate.getMonth() + 1)}-${pad(initialDate.getDate())}`);
    } else {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      setSelectedDateStr(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
    }

    if (initialSlot?.isCurrent && initialSlot.canStartNow && initialSlot.status === "available") {
      setSelectedTimeStr("now");
    } else if (initialSlot) {
      const pad = (n: number) => String(n).padStart(2, "0");
      setSelectedTimeStr(`${pad(initialSlot.start.getHours())}:00`);
    } else if (initialSlotTime) {
      const startTime = initialSlotTime.split("-")[0]?.trim();
      if (startTime) setSelectedTimeStr(startTime);
    }
  }, [initialDate, initialSlot, initialSlotTime, isOpen]);

  const slotsForDate = useMemo(() => {
    const acc = accounts.find((a) => a.accountId === accountId) || accounts[0];
    if (!selectedDateStr) return [];
    const [year, month, day] = selectedDateStr.split("-").map(Number);
    const targetDate = new Date(year, month - 1, day);
    return generateSlotsForDate(targetDate, acc, reservations, busySlots, nowMs);
  }, [accountId, selectedDateStr, accounts, reservations, busySlots, nowMs]);

  const immediateSlot = slotsForDate.find((slot) =>
    slot.isCurrent && slot.canStartNow && slot.status === "available"
  );

  // Adjust selectedTimeStr if the currently selected slot is past or disabled
  useEffect(() => {
    if (slotsForDate.length === 0) return;
    if (selectedTimeStr === "now" && immediateSlot) return;

    const current = slotsForDate.find((s) => {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${pad(s.start.getHours())}:00` === selectedTimeStr;
    });

    if (!current || current.isPast || current.status !== "available" || current.isCurrent) {
      const firstAvailable = immediateSlot || slotsForDate.find((s) => !s.isPast && s.status === "available");
      if (firstAvailable) {
        if (firstAvailable.isCurrent && firstAvailable.canStartNow) {
          setSelectedTimeStr("now");
          return;
        }
        const pad = (n: number) => String(n).padStart(2, "0");
        setSelectedTimeStr(`${pad(firstAvailable.start.getHours())}:00`);
      }
    }
  }, [immediateSlot, slotsForDate, selectedTimeStr]);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      let bookingDate: Date;
      let durationHours: number;
      if (selectedTimeStr === "now") {
        if (!immediateSlot) throw new Error("A janela atual não está mais disponível. Atualize a agenda.");
        bookingDate = new Date();
        durationHours = immediateSlot.durationHours ?? 5;
      } else {
        const [hours, minutes] = selectedTimeStr.split(":").map(Number);
        const [year, month, day] = selectedDateStr.split("-").map(Number);
        bookingDate = new Date(year, month - 1, day, hours, minutes, 0, 0);

        if (bookingDate.getTime() < Date.now() - 60_000) {
          throw new Error("Não é possível agendar um horário que já passou.");
        }

        durationHours = 5;
      }

      await onConfirmBooking(accountId, bookingDate, durationHours);
      onClose();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Erro ao realizar agendamento.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const selectedSlotData = selectedTimeStr === "now"
    ? immediateSlot
    : slotsForDate.find((s) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(s.start.getHours())}:00` === selectedTimeStr;
  });

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-booking-title">
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "480px" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span className="kicker-tag" style={{ marginBottom: "2px" }}>SOLICITAÇÃO DE ACESSO</span>
            <h3 id="modal-booking-title" style={{ fontSize: "18px", fontWeight: "700", color: "var(--text-primary)" }}>
              Novo agendamento
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

        <form onSubmit={handleSubmit} style={{ padding: "20px 24px" }}>
          {errorMessage && (
            <div style={{ padding: "10px 14px", backgroundColor: "var(--color-danger-bg)", color: "var(--color-danger-text)", borderRadius: "var(--radius-sm)", marginBottom: "16px", fontSize: "13px" }}>
              {errorMessage}
            </div>
          )}

          {/* Account Selection */}
          <div style={{ marginBottom: "18px" }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "6px" }}>
              Conta do provedor
            </label>
            <div style={{ display: "flex", gap: "8px" }}>
              {accounts.map((acc) => (
                <button
                  key={acc.accountId}
                  type="button"
                  onClick={() => setAccountId(acc.accountId)}
                  style={{
                    flex: 1,
                    padding: "8px",
                    borderRadius: "var(--radius-md)",
                    border: accountId === acc.accountId ? "2px solid var(--color-brand-primary)" : "1px solid var(--border-card)",
                    backgroundColor: accountId === acc.accountId ? "var(--bg-card)" : "var(--bg-card-secondary)",
                    color: accountId === acc.accountId ? "var(--color-brand-primary)" : "var(--text-primary)",
                    fontWeight: "600",
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  {acc.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date & Time */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "18px" }}>
            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "6px" }}>
                Data
              </label>
              <input
                type="date"
                value={selectedDateStr}
                onChange={(e) => setSelectedDateStr(e.target.value)}
                required
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-card)",
                  backgroundColor: "var(--bg-input)",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "6px" }}>
                Horário de Início
              </label>
              <select
                value={selectedTimeStr}
                onChange={(e) => setSelectedTimeStr(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-card)",
                  backgroundColor: "var(--bg-input)",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                }}
              >
                {immediateSlot && (
                  <option value="now">Agora (restante da janela)</option>
                )}
                {FIXED_DAILY_SLOTS.map((slotDef) => {
                  const matchingSlot = slotsForDate.find((s) => s.startHour === slotDef.startHour);
                  const isPast = matchingSlot?.isPast ?? false;
                  const isBusy = matchingSlot?.status === "busy";
                  const isMine = matchingSlot?.status === "mine";
                  const isCurrent = matchingSlot?.isCurrent ?? false;
                  const suffix = isMine
                    ? " [Sua reserva]"
                    : isBusy
                      ? " [Ocupado]"
                      : isCurrent && matchingSlot?.canStartNow
                        ? " [Começar agora]"
                        : isPast || matchingSlot?.status === "unavailable"
                          ? " [Encerrado]"
                          : "";

                  return (
                    <option
                      key={slotDef.timeStr}
                      value={slotDef.timeStr}
                      disabled={isPast || isBusy || isCurrent || matchingSlot?.status === "unavailable"}
                    >
                      {slotDef.selectLabel}{suffix}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* Duration Note */}
          <div
            style={{
              padding: "12px",
              borderRadius: "var(--radius-md)",
              backgroundColor: "rgba(var(--color-brand-primary-rgb), 0.06)",
              border: "1px solid rgba(var(--color-brand-primary-rgb), 0.2)",
              fontSize: "12px",
              color: "var(--text-secondary)",
              marginBottom: "24px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <i className="ph ph-info" style={{ color: "var(--color-brand-primary)", fontSize: "18px", flexShrink: 0 }} aria-hidden="true" />
            <span>
              {selectedTimeStr === "now"
                ? "A sessão começa agora e termina no fim do horário fixo atual."
                : "As sessões possuem duração de 5 horas consecutivas com acesso liberado a todos os modelos Codex permitidos."}
            </span>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isSubmitting}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSubmitting || !selectedSlotData || selectedSlotData.isPast || selectedSlotData.status !== "available" || (selectedTimeStr === "now" && !immediateSlot)}
            >
              {isSubmitting ? (
                <>
                  <i className="ph ph-spinner icon-spinning" aria-hidden="true" />
                  <span>Confirmando...</span>
                </>
              ) : (
                <>
                  <span>Confirmar agendamento</span>
                  <i className="ph ph-arrow-right" aria-hidden="true" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
