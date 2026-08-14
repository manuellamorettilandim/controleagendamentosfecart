(() => {
  "use strict";

  function startOfDay(value = new Date()) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function startOfHour(value = new Date()) {
    const date = new Date(value);
    date.setMinutes(0, 0, 0);
    return date;
  }

  function sameDay(left, right) {
    return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
  }

  function formatRange(start, end) {
    const formatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
    return `${formatter.format(start).replace(".", "")} – ${formatter.format(end).replace(".", "")}`;
  }

  function formatTime(value) {
    return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  function create(element, overrides = {}) {
    if (!element) return null;
    const Calendar = window.FullCalendar?.Calendar;
    if (!Calendar) {
      element.innerHTML = `<div class="calendar-fallback"><strong>Agenda indisponível</strong><span>Atualize a página para carregar o componente de calendário.</span></div>`;
      return null;
    }

    const locale = window.FullCalendar.globalLocales?.some((item) => item.code === "pt-br") ? "pt-br" : "en-gb";
    const calendar = new Calendar(element, {
      initialView: window.matchMedia("(max-width: 720px)").matches ? "timeGridDay" : "timeGridWeek",
      themeSystem: "classic",
      firstDay: 1,
      locale,
      headerToolbar: false,
      allDaySlot: false,
      height: 640,
      expandRows: false,
      slotMinTime: "00:00:00",
      slotMaxTime: "24:00:00",
      slotDuration: "01:00:00",
      snapDuration: "01:00:00",
      slotLabelInterval: "01:00:00",
      slotLabelFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
      eventTimeFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
      dayHeaderFormat: { weekday: "short", day: "numeric", month: "short" },
      nowIndicator: true,
      navLinks: false,
      eventDisplay: "block",
      eventOverlap: false,
      slotEventOverlap: false,
      editable: false,
      selectable: false,
      selectMirror: true,
      unselectAuto: false,
      scrollTime: "08:00:00",
      eventOrder: "start,-duration,title",
      ...overrides,
    });
    calendar.render();
    element.classList.add("calendar-ready");
    return calendar;
  }

  function syncEvents(calendar, events) {
    if (!calendar) return;
    calendar.removeAllEvents();
    calendar.addEventSource(events || []);
  }

  window.RemoteCodexCalendar = { create, formatRange, formatTime, sameDay, startOfDay, startOfHour, syncEvents };
})();
