import { mountCalendar } from "../components/CalendarHost";

(() => {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;

  function clone(value) {
    const date = value instanceof Date ? new Date(value) : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  function startOfDay(value = new Date()) {
    const date = clone(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function startOfHour(value = new Date()) {
    const date = clone(value);
    date.setMinutes(0, 0, 0);
    return date;
  }

  function addDays(value, amount) {
    const date = clone(value);
    date.setDate(date.getDate() + Number(amount || 0));
    return date;
  }

  function endOfMonth(value = new Date()) {
    const date = clone(value);
    return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  function sameDay(left, right) {
    const a = clone(left);
    const b = clone(right);
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function formatTime(value) {
    const date = clone(value);
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function formatRange(start, end) {
    const first = clone(start);
    const last = clone(end);
    const month = new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(last);
    const year = last.getFullYear();
    if (first.getFullYear() === last.getFullYear() && first.getMonth() === last.getMonth()) {
      return `${first.getDate()} – ${last.getDate()} de ${month}, ${year}`;
    }
    const formatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
    return `${formatter.format(first).replaceAll(".", "")} – ${formatter.format(last).replaceAll(".", "")}`;
  }

  function create(element, overrides = {}) {
    if (!element) return null;
    return mountCalendar(element, overrides);
  }

  function syncEvents(calendar, events) {
    if (!calendar) return;
    calendar.removeAllEvents();
    if (events?.length) calendar.addEventSource(events);
  }

  window.FecartCalendar = {
    DAY_MS,
    addDays,
    create,
    endOfMonth,
    formatRange,
    formatTime,
    sameDay,
    startOfDay,
    startOfHour,
    syncEvents,
  };
  window.RemoteCodexCalendar = window.FecartCalendar;
})();

export {};
