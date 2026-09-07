import React from "react";
export type SlotStatus = "available" | "busy" | "mine" | "unavailable";
export interface ScheduleSlotProps {
  timeLabel: string;
  status: SlotStatus;
  isPast?: boolean;
  isCurrent?: boolean;
  approvalStatus?: string;
  onClick: () => void;
}
export function ScheduleSlot({ timeLabel, status, isPast, isCurrent, approvalStatus, onClick }: ScheduleSlotProps) {
  const clickable = status === "available" || status === "mine";
  const pending = status === "mine" && approvalStatus === "pending";
  const label = pending ? "Aguardando aprovação" : status === "available" ? (isCurrent ? "Reservar agora" : "Disponível") : status === "mine" ? "Sua reserva" : status === "busy" ? "Reservado" : isPast ? "Encerrado" : "Indisponível";
  const icon = pending ? "ph-clock-countdown" : status === "available" ? "ph-plus" : status === "mine" ? "ph-check-circle" : "ph-lock-simple";
  return <button type="button" className={`schedule-slot-card slot-${pending ? "pending" : status}`} disabled={!clickable} onClick={onClick} aria-label={`${timeLabel}, ${label}`}>
    <span className="slot-time">{timeLabel}</span>
    <span className="slot-label"><i className={`ph ${icon}`} aria-hidden="true" />{label}</span>
    <span className="slot-duration">{status === "available" ? "5 horas de sessão" : status === "mine" ? "Ver solicitação" : ""}</span>
  </button>;
}
