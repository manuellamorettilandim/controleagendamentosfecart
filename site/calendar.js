(() => {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const CALENDAR_SLOT_HEIGHT = 48;

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

  function formatSlotTime(value) {
    const [hour, minute] = String(value || "00:00:00").split(":").map(Number);
    return formatTime(new Date(2000, 0, 1, Number.isFinite(hour) ? hour : 0, Number.isFinite(minute) ? minute : 0));
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

  function defaultEventContent(info) {
    const content = document.createElement("div");
    content.className = "calendar-event-content";
    const title = document.createElement("strong");
    title.textContent = info.event.title || "Agendamento";
    const timing = document.createElement("span");
    const start = info.event.start;
    const end = info.event.end;
    const hours = start && end ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 3_600_000)) : 1;
    timing.textContent = `${start ? formatTime(start) : ""} · ${hours}h`;
    content.append(title, timing);
    return { domNodes: [content] };
  }

  function syncStickyHeader(element) {
    const stickyHeader = element.closest(".calendar-section")?.querySelector("[data-calendar-sticky-header]");
    if (!stickyHeader) return;
    const update = () => {
      element.style.setProperty("--calendar-sticky-header-height", `${Math.ceil(stickyHeader.getBoundingClientRect().height)}px`);
    };
    update();
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(update);
      observer.observe(stickyHeader);
    } else {
      window.addEventListener("resize", update, { passive: true });
    }
  }

  function enhanceTimeGridLabels(element) {
    const seenTimes = new Set();
    element.querySelectorAll("[data-time]").forEach((slot) => {
      const value = slot.getAttribute("data-time");
      if (!value || seenTimes.has(value)) return;
      seenTimes.add(value);

      const axis = slot.parentElement;
      axis?.classList.add("calendar-time-axis");
      if (axis) axis.style.width = "76px";

      const row = axis?.classList.contains("calendar-time-axis") ? axis.parentElement : axis;
      row?.classList.add("calendar-time-grid-row");

      slot.classList.add("calendar-time-label-cell");
      const labelText = formatSlotTime(value);
      let label = slot.querySelector(".calendar-time-label");
      if (!label) {
        label = document.createElement("time");
        label.className = "calendar-time-label";
        // Keep FullCalendar's first child intact: it owns the resize
        // measurement ref used to calculate slat and event positions.
        const measuredInner = slot.firstElementChild;
        const labelContainer = measuredInner?.lastElementChild || measuredInner;
        if (labelContainer) labelContainer.replaceChildren(label);
        else slot.append(label);
      }
      if (label.dateTime !== value) label.dateTime = value;
      if (label.textContent !== labelText) label.textContent = labelText;
    });

    const headerRow = element.querySelector("[role=grid] [role=row]");
    const headerWrapper = headerRow?.querySelector("[role=gridcell]")?.parentElement;
    const headerCell = headerWrapper?.querySelector("[role=gridcell]");
    if (headerWrapper && headerCell) {
      headerWrapper.classList.add("calendar-time-axis-header");
      headerCell.classList.add("calendar-time-axis-header-cell");
      headerWrapper.style.width = "76px";
      headerCell.style.width = "76px";
      headerCell.setAttribute("aria-label", "Hora");
      if (!headerCell.querySelector(".calendar-time-axis-title")) {
        const title = document.createElement("span");
        title.className = "calendar-time-axis-title";
        title.textContent = "Hora";
        headerCell.append(title);
      }
    }

    element.querySelectorAll('[role="rowheader"]').forEach((header) => {
      header.classList.add("calendar-time-axis-header");
      header.style.width = "76px";
      header.setAttribute("aria-label", "Hora");
    });
  }

  function observeTimeGridLabels(element) {
    enhanceTimeGridLabels(element);
    if (typeof MutationObserver !== "function" || element.dataset.timeLabelsObserved === "true") return;
    const observer = new MutationObserver(() => enhanceTimeGridLabels(element));
    observer.observe(element, { childList: true, subtree: true });
    element.dataset.timeLabelsObserved = "true";
  }

  function create(element, overrides = {}) {
    if (!element) return null;
    const Calendar = window.FullCalendar?.Calendar;
    if (!Calendar) {
      element.innerHTML = "<div class=\"calendar-fallback\"><strong>Agenda indisponível</strong><span>Atualize a página para carregar o calendário.</span></div>";
      return null;
    }

    const isCompact = window.matchMedia("(max-width: 720px)").matches;
    const locale = window.FullCalendar.globalLocales?.some((item) => item.code === "pt-br") ? "pt-br" : "en-gb";
    const calendar = new Calendar(element, {
      initialView: isCompact ? "timeGridDay" : "timeGridWeek",
      firstDay: 1,
      locale,
      headerToolbar: false,
      allDaySlot: false,
      height: isCompact ? 840 : 980,
      slotMinHeight: CALENDAR_SLOT_HEIGHT,
      tableHeaderSticky: true,
      tableHeaderClass: "calendar-table-header",
      dayHeaderAlign: "center",
      dayHeaderClass: "calendar-day-header",
      dayHeaderInnerClass: "calendar-day-header-inner",
      expandRows: false,
      slotMinTime: "00:00:00",
      slotMaxTime: "24:00:00",
      slotDuration: "01:00:00",
      snapDuration: "01:00:00",
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
      unselectAuto: true,
      scrollTime: "08:00:00",
      eventOrder: "start,-duration,title",
      eventContent: defaultEventContent,
      ...overrides,
    });
    calendar.render();
    // FullCalendar can render before the time-grid scroller has measured its
    // final size (especially after the dashboard data finishes loading). Set
    // the sizing options once more after the first render so the slat height
    // is recalculated with the real viewport.
    calendar.setOption("slotMinHeight", CALENDAR_SLOT_HEIGHT);
    calendar.setOption("height", isCompact ? 840 : 980);
    element.style.setProperty("--calendar-slot-height", `${CALENDAR_SLOT_HEIGHT}px`);
    element.classList.add("calendar-ready");
    observeTimeGridLabels(element);
    syncStickyHeader(element);
    return calendar;
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
