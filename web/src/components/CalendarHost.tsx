import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { useLayoutEffect, useRef } from "react";
import { Calendar } from "fullcalendar/all";
import type { CalendarOptions } from "fullcalendar";

const CALENDAR_SLOT_HEIGHT = 48;
type CalendarInstance = InstanceType<typeof Calendar>;

function formatTime(value: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(value);
}

function formatSlotTime(value: string | null): string {
  const [hour, minute] = String(value || "00:00:00").split(":").map(Number);
  return formatTime(new Date(2000, 0, 1, Number.isFinite(hour) ? hour : 0, Number.isFinite(minute) ? minute : 0));
}

function defaultEventContent(info: any) {
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

function syncStickyHeader(element: HTMLElement): () => void {
  const stickyHeader = element.closest(".calendar-section")?.querySelector<HTMLElement>("[data-calendar-sticky-header]");
  if (!stickyHeader) return () => undefined;

  const update = () => {
    element.style.setProperty("--calendar-sticky-header-height", `${Math.ceil(stickyHeader.getBoundingClientRect().height)}px`);
  };
  update();

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(update);
    observer.observe(stickyHeader);
    return () => observer.disconnect();
  }

  window.addEventListener("resize", update, { passive: true });
  return () => window.removeEventListener("resize", update);
}

function enhanceTimeGridLabels(element: HTMLElement): void {
  const seenTimes = new Set<string>();
  element.querySelectorAll<HTMLElement>("[data-time]").forEach((slot) => {
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
    let label = slot.querySelector<HTMLElement>(".calendar-time-label");
    if (!label) {
      label = document.createElement("time");
      label.className = "calendar-time-label";
      const measuredInner = slot.firstElementChild;
      const labelContainer = measuredInner?.lastElementChild || measuredInner;
      if (labelContainer) labelContainer.replaceChildren(label);
      else slot.append(label);
    }
    if (label.getAttribute("datetime") !== value) label.setAttribute("datetime", value);
    if (label.textContent !== labelText) label.textContent = labelText;
  });

  const headerRow = element.querySelector("[role=grid] [role=row]");
  const headerWrapper = headerRow?.querySelector<HTMLElement>("[role=gridcell]")?.parentElement;
  const headerCell = headerWrapper?.querySelector<HTMLElement>("[role=gridcell]");
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

  element.querySelectorAll<HTMLElement>('[role="rowheader"]').forEach((header) => {
    header.classList.add("calendar-time-axis-header");
    header.style.width = "76px";
    header.setAttribute("aria-label", "Hora");
  });
}

function observeTimeGridLabels(element: HTMLElement): () => void {
  enhanceTimeGridLabels(element);
  if (typeof MutationObserver !== "function") return () => undefined;
  const observer = new MutationObserver(() => enhanceTimeGridLabels(element));
  observer.observe(element, { childList: true, subtree: true });
  return () => observer.disconnect();
}

export interface CalendarHostProps {
  options?: CalendarOptions;
  onReady?: (calendar: CalendarInstance) => void;
  onDestroy?: () => void;
}

export function CalendarHost({ options = {}, onReady, onDestroy }: CalendarHostProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;

    const isCompact = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 720px)").matches;
    const calendar = new Calendar(element, {
      initialView: isCompact ? "timeGridDay" : "timeGridWeek",
      firstDay: 1,
      locale: "pt-br",
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
      ...options,
    });

    calendar.render();
    calendar.setOption("slotMinHeight", CALENDAR_SLOT_HEIGHT);
    calendar.setOption("height", isCompact ? 840 : 980);
    element.style.setProperty("--calendar-slot-height", `${CALENDAR_SLOT_HEIGHT}px`);
    element.classList.add("calendar-ready");

    const cleanups = [observeTimeGridLabels(element), syncStickyHeader(element)];
    onReady?.(calendar);

    return () => {
      cleanups.forEach((cleanup) => cleanup());
      calendar.destroy();
      onDestroy?.();
    };
  }, [onDestroy, onReady, options]);

  return <div ref={containerRef} className="calendar-react-host" />;
}

export function mountCalendar(element: HTMLElement, options: CalendarOptions = {}): CalendarInstance | null {
  let calendar: CalendarInstance | null = null;
  const root = createRoot(element);
  flushSync(() => {
    root.render(<CalendarHost options={options} onReady={(instance) => { calendar = instance; }} />);
  });
  if (!calendar) {
    root.unmount();
    return null;
  }
  return calendar;
}
