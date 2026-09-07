import React, { useState } from "react";
import { DaySlotData } from "./ScheduleDay";
import { ScheduleSlot } from "./ScheduleSlot";
import "../../styles/schedule.css";

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

export function ScheduleGrid({ accounts, selectedAccountId, onSelectAccount, weekLabel, onPrevWeek, onNextWeek, days, onSelectSlot, onRefresh, isRefreshing, isHighlighted }: ScheduleGridProps) {
  const [selectedDay, setSelectedDay] = useState(() => Math.max(0, days.findIndex(day => day.isToday)));
  const activeDay = days[selectedDay] || days[0];
  return <section id="schedule-section" className={`ui-card schedule-panel schedule-highlight ${isHighlighted ? "schedule-highlight-active" : ""}`} aria-labelledby="schedule-title">
    <header className="schedule-heading">
      <div><span className="schedule-eyebrow">RESERVAS</span><h2 id="schedule-title">Agenda da Semana</h2><p>Consulte os horários e escolha uma sessão disponível.</p></div>
      <label className="schedule-account">Conta<select value={selectedAccountId} onChange={e => onSelectAccount(e.target.value)} disabled={!accounts.length}>{!accounts.length && <option value="">Nenhuma conta disponível</option>}{accounts.map(account => <option key={account.accountId} value={account.accountId}>{account.label}</option>)}</select></label>
    </header>
    <div className="schedule-toolbar"><div className="schedule-navigation"><button type="button" onClick={onPrevWeek} aria-label="Semana anterior"><i className="ph ph-caret-left" /></button><strong aria-live="polite">{weekLabel}</strong><button type="button" onClick={onNextWeek} aria-label="Próxima semana"><i className="ph ph-caret-right" /></button></div><div className="schedule-legend"><span className="legend-free">Disponível</span><span className="legend-mine">Sua reserva</span><span className="legend-pending">Pendente</span><span className="legend-busy">Reservado</span></div></div>
    <div className="schedule-mobile-days" aria-label="Selecionar dia">{days.map((day, index) => <button type="button" key={day.date.toISOString()} aria-pressed={index === selectedDay} onClick={() => setSelectedDay(index)}><span>{day.dayName}</span><strong>{day.dayNumber}</strong>{day.isToday && <small>Hoje</small>}</button>)}</div>
    <div className="schedule-week-grid">{days.map((day, index) => <div key={day.date.toISOString()} className={`schedule-column ${day.isToday ? "is-today" : ""} ${index === selectedDay ? "is-selected" : ""}`}>
      <div className="schedule-column-heading"><span>{day.dayName} {day.isToday && <small>HOJE</small>}</span><strong>{day.dayNumber}</strong><small>{day.slots.filter(slot => slot.status === "available").length} horários disponíveis</small></div>
      {day.slots.map(slot => <ScheduleSlot key={slot.start.toISOString()} {...slot} onClick={() => onSelectSlot(day, slot)} />)}
    </div>)}</div>
    {!activeDay && <p className="schedule-empty">Nenhum horário disponível para esta semana.</p>}
    <footer className="schedule-footer"><span><i className="ph ph-info" aria-hidden="true" /> Os horários das 08h e 09h se sobrepõem. A disponibilidade é atualizada após cada reserva.</span><button type="button" className="btn btn-secondary" onClick={onRefresh} disabled={isRefreshing}><i className={`ph ph-arrows-clockwise ${isRefreshing ? "icon-spinning" : ""}`} />{isRefreshing ? "Atualizando…" : "Atualizar agenda"}</button></footer>
  </section>;
}
