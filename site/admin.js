(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const ADMIN_AGENDA_SLOT_HEIGHT = 48;
  const preview = ["localhost", "127.0.0.1"].includes(window.location.hostname)
    && (new URLSearchParams(window.location.search).has("preview") || window.location.hash.includes("preview"));

  const WEEKDAY_NAMES = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"];
  const MONTH_FORMATTER = new Intl.DateTimeFormat("pt-BR", { month: "long" });
  const initialNow = new Date();

  function cloneDate(value) {
    const date = value instanceof Date ? new Date(value) : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  function startOfDay(value = new Date()) {
    const date = cloneDate(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function startOfWeek(value = new Date()) {
    const date = startOfDay(value);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return date;
  }

  function addDays(value, amount) {
    const date = cloneDate(value);
    date.setDate(date.getDate() + Number(amount || 0));
    return date;
  }

  function weekdayIndex(value) {
    return (cloneDate(value).getDay() + 6) % 7;
  }

  function dateKey(value) {
    const date = cloneDate(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function formatDate(value) {
    const date = cloneDate(value);
    return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function formatClock(value) {
    const date = cloneDate(value);
    return formatTime(date.getHours() + date.getMinutes() / 60);
  }

  function formatDateTime(value) {
    const date = cloneDate(value);
    return `${formatDate(date)} ${formatClock(date)}`;
  }

  function agendaDays(weekStart = state.weekStart) {
    const today = dateKey(new Date());
    return WEEKDAY_NAMES.map((short, index) => {
      const date = addDays(weekStart, index);
      return {
        short,
        date: `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`,
        number: String(date.getDate()),
        isoDate: dateKey(date),
        today: dateKey(date) === today,
      };
    });
  }

  function scheduleDateFromSlot(weekStart, dayIndex, hourValue) {
    const date = addDays(weekStart, dayIndex);
    const totalMinutes = Math.max(0, Math.round(Number(hourValue || 0) * 60));
    date.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);
    return date;
  }

  function decoratePreviewSchedule(schedule, weekStart) {
    const startsAt = scheduleDateFromSlot(weekStart, schedule.day, schedule.start);
    const durationHours = Math.max(0, Number(schedule.end) - Number(schedule.start)) || 1;
    const endsAt = new Date(startsAt.getTime() + durationHours * 60 * 60_000);
    return {
      ...schedule,
      dateKey: dateKey(startsAt),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      requestedAt: formatDateTime(startsAt),
    };
  }

  function decoratePreviewApproval(approval, weekStart) {
    const schedule = sampleSchedules.find((item) => item.id === approval.scheduleId);
    const startsAt = schedule ? scheduleDateFromSlot(weekStart, schedule.day, schedule.start) : null;
    return {
      ...approval,
      requestedAt: startsAt ? formatDateTime(startsAt) : approval.requestedAt,
    };
  }

  function scheduleStartDate(schedule) {
    const stored = schedule?.startsAt ? new Date(schedule.startsAt) : null;
    if (stored && !Number.isNaN(stored.getTime())) return stored;
    return scheduleDateFromSlot(state.weekStart, schedule?.day || 0, schedule?.start || 0);
  }

  function scheduleEndDate(schedule) {
    const stored = schedule?.endsAt ? new Date(schedule.endsAt) : null;
    if (stored && !Number.isNaN(stored.getTime())) return stored;
    const start = scheduleStartDate(schedule);
    const durationHours = Math.max(0, Number(schedule?.end) - Number(schedule?.start)) || 1;
    return new Date(start.getTime() + durationHours * 60 * 60_000);
  }

  function scheduleTimeRange(schedule) {
    const startDate = scheduleStartDate(schedule);
    const endDate = scheduleEndDate(schedule);
    const start = startDate.getHours() + startDate.getMinutes() / 60;
    const duration = Math.max(0, (endDate.getTime() - startDate.getTime()) / 3_600_000) || 1;
    return { start, end: start + duration, duration, startDate, endDate };
  }

  function scheduleDayIndex(schedule, weekStart = state.weekStart) {
    const start = startOfDay(scheduleStartDate(schedule));
    const base = startOfDay(weekStart);
    return Math.round((start.getTime() - base.getTime()) / (24 * 60 * 60_000));
  }

  function schedulesInWeek(schedules, weekStart = state.weekStart) {
    return schedules.filter((schedule) => {
      const dayIndex = scheduleDayIndex(schedule, weekStart);
      return dayIndex >= 0 && dayIndex < 7;
    });
  }

  const sampleAccounts = [
    { id: "account-1", label: "Conta 1", quota: 72, reset: "seg 00:00", status: "ready" },
    { id: "account-2", label: "Conta 2", quota: 58, reset: "seg 00:00", status: "ready" },
    { id: "account-3", label: "Conta 3", quota: 80, reset: "seg 00:00", status: "ready" },
  ];

  const sampleSchedules = [
    { id: "schedule-1", group: "Grupo 1", accountId: "account-1", day: 1, start: 9, end: 10.5, status: "approved", statusLabel: "Aprovado", quota: 10, requestedAt: "14/05/2025 09:15", note: "" },
    { id: "schedule-2", group: "Grupo 2", accountId: "account-1", day: 2, start: 8.5, end: 10, status: "active", statusLabel: "Sessão ativa", quota: 15, requestedAt: "14/05/2025 10:02", note: "" },
    { id: "schedule-3", group: "Grupo 5", accountId: "account-1", day: 2, start: 10.25, end: 11.75, status: "pending", statusLabel: "Pendente", quota: 20, requestedAt: "14/05/2025 10:02", note: "" },
    { id: "schedule-4", group: "Grupo 3", accountId: "account-1", day: 3, start: 9, end: 10, status: "pending", statusLabel: "Aguardando aprovação", quota: 8, requestedAt: "14/05/2025 11:45", note: "" },
    { id: "schedule-5", group: "Grupo 6", accountId: "account-1", day: 3, start: 11, end: 12.5, status: "approved", statusLabel: "Aprovado", quota: 12, requestedAt: "14/05/2025 11:45", note: "" },
    { id: "schedule-6", group: "Grupo 4", accountId: "account-1", day: 1, start: 13, end: 14.5, status: "approved", statusLabel: "Aprovado", quota: 5, requestedAt: "14/05/2025 12:30", note: "" },
    { id: "schedule-7", group: "Grupo 7", accountId: "account-1", day: 5, start: 10, end: 11.5, status: "approved", statusLabel: "Aprovado", quota: 9, requestedAt: "14/05/2025 12:30", note: "" },
    { id: "schedule-8", group: "Grupo 8", accountId: "account-1", day: 4, start: 14, end: 15.5, status: "cancelled", statusLabel: "Cancelado", quota: 12, requestedAt: "14/05/2025 13:20", note: "Sessão cancelada pelo administrador." },
    { id: "schedule-9", group: "Grupo 9", accountId: "account-2", day: 2, start: 9, end: 10.5, status: "approved", statusLabel: "Aprovado", quota: 10, requestedAt: "14/05/2025 09:15", note: "" },
    { id: "schedule-10", group: "Grupo 10", accountId: "account-3", day: 4, start: 11, end: 12, status: "pending", statusLabel: "Pendente", quota: 15, requestedAt: "14/05/2025 11:20", note: "" },
  ];

  const sampleApprovals = [
    { id: "approval-1", scheduleId: "schedule-2", group: "Grupo 2", account: "Conta 1", requestedAt: "14/05/2025 09:15", duration: "1h 30m", quota: 10, status: "pending" },
    { id: "approval-2", scheduleId: "schedule-3", group: "Grupo 5", account: "Conta 2", requestedAt: "14/05/2025 10:02", duration: "2h 00m", quota: 15, status: "pending" },
    { id: "approval-3", scheduleId: "schedule-4", group: "Grupo 8", account: "Conta 3", requestedAt: "14/05/2025 11:45", duration: "1h 08m", quota: 8, status: "pending" },
    { id: "approval-4", scheduleId: "schedule-5", group: "Grupo 3", account: "Conta 1", requestedAt: "14/05/2025 12:30", duration: "45m", quota: 5, status: "pending" },
    { id: "approval-5", scheduleId: "schedule-10", group: "Grupo 9", account: "Conta 2", requestedAt: "14/05/2025 13:10", duration: "1h 00m", quota: 12, status: "pending" },
    { id: "approval-6", scheduleId: "schedule-11", group: "Grupo 6", account: "Conta 3", requestedAt: "14/05/2025 14:05", duration: "1h 30m", quota: 10, status: "pending" },
    { id: "approval-7", scheduleId: "schedule-12", group: "Grupo 4", account: "Conta 1", requestedAt: "14/05/2025 15:20", duration: "45m", quota: 5, status: "pending" },
  ];

  const state = {
    accounts: sampleAccounts.map((account) => ({ ...account })),
    schedules: sampleSchedules.map((schedule) => decoratePreviewSchedule(schedule, startOfWeek(initialNow))),
    approvals: sampleApprovals.map((approval) => decoratePreviewApproval(approval, startOfWeek(initialNow))),
    activeAccountId: "account-1",
    view: "week",
    weekStart: startOfWeek(initialNow),
    focusedDayIndex: weekdayIndex(initialNow),
    selectedScheduleId: null,
    search: "",
    showAllApprovals: false,
    live: false,
    toastTimer: null,
    accountLogin: null,
    accountLoginPoll: null,
    removeAccountId: null,
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[character]));
  }

  function formatQuota(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${Math.round(number)}%` : "—";
  }

  function formatTime(value) {
    const totalMinutes = Math.max(0, Math.round(Number(value) * 60));
    const hour = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  function formatPeriod(schedule) {
    return `${formatDate(scheduleStartDate(schedule))} – ${formatDate(scheduleEndDate(schedule))}`;
  }

  function statusText(status) {
    return ({
      pending: "Pendente",
      approved: "Aprovado",
      adjusted: "Aprovado com ajuste",
      active: "Sessão ativa",
      cancelled: "Cancelado",
      disabled: "Token desabilitado",
    }[status] || "Pendente");
  }

  function statusClass(status) {
    return ["pending", "approved", "adjusted", "active", "cancelled", "disabled"].includes(status) ? status : "pending";
  }

  function selectedSchedule() {
    return state.schedules.find((schedule) => schedule.id === state.selectedScheduleId) || null;
  }

  function accountById(accountId) {
    return state.accounts.find((account) => account.id === accountId) || null;
  }

  function schedulesForAccount(accountId = state.activeAccountId) {
    return state.schedules.filter((schedule) => schedule.accountId === accountId);
  }

  function setText(selector, value) {
    const element = $(selector);
    if (element) element.textContent = value ?? "";
  }

  function showToast(message, kind = "success") {
    const toast = $("#admin-toast");
    if (!toast) return;
    window.clearTimeout(state.toastTimer);
    toast.textContent = message;
    toast.classList.toggle("is-error", kind === "error");
    toast.classList.add("is-visible");
    state.toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3200);
  }

  function renderMetrics() {
    const active = state.accounts.filter((account) => account.status === "ready").length;
    const total = Math.max(10, state.accounts.length);
    const pending = state.approvals.filter((approval) => approval.status === "pending").length || 7;
    const remaining = state.live && state.accounts.length
      ? Math.round(state.accounts.reduce((sum, account) => sum + Number(account.quota || 0), 0) / state.accounts.length)
      : 64;
    setText("#metric-active-accounts", active);
    setText("#metric-total-accounts", total);
    setText("#metric-quota", `${remaining}%`);
    setText("#metric-today", 18);
    setText("#metric-today-accounts", Math.max(3, state.accounts.length));
    setText("#metric-pending", pending);
    const activeProgress = $("#metric-active-progress");
    const quotaProgress = $("#metric-quota-progress");
    const pendingProgress = $("#metric-pending-progress");
    if (activeProgress) activeProgress.style.width = `${Math.min(100, (active / total) * 100)}%`;
    if (quotaProgress) quotaProgress.style.width = `${Math.min(100, remaining)}%`;
    if (pendingProgress) pendingProgress.style.width = `${Math.min(100, (pending / 12) * 100)}%`;
    setText("#approval-count", pending);
  }

  function renderManagedAccounts() {
    const target = $("#managed-accounts");
    if (!target) return;
    target.innerHTML = state.accounts.slice(0, 3).map((account) => `
      <div class="managed-account-card" data-account-card="${escapeHtml(account.id)}" role="button" tabindex="0" aria-label="Abrir agenda da ${escapeHtml(account.label)}">
        <span class="account-card-header"><span class="account-card-name"><i class="status-dot" aria-hidden="true"></i>${escapeHtml(account.label)}</span>
          <span class="account-menu-wrap">
            <button class="account-menu-trigger" type="button" data-account-menu="${escapeHtml(account.id)}" aria-label="Ações de ${escapeHtml(account.label)}" aria-haspopup="menu" aria-expanded="false"><i class="ph ph-dots-three-vertical" aria-hidden="true"></i></button>
            <div class="account-menu" role="menu" data-account-menu-panel="${escapeHtml(account.id)}" hidden>
              <button class="account-menu-item" type="button" role="menuitem" data-account-remove="${escapeHtml(account.id)}"><i class="ph ph-trash" aria-hidden="true"></i>Remover conta</button>
            </div>
          </span>
        </span>
        <span class="account-card-body"><span class="quota-ring" style="--quota: ${Math.max(0, Math.min(100, Number(account.quota || 0)))}%"><span>${formatQuota(account.quota)}</span></span><span class="account-quota-copy"><strong>${formatQuota(account.quota)} disponível</strong><span>Reset semanal</span><small>${escapeHtml(account.reset || "seg 00:00")}</small></span></span>
      </div>
    `).join("") + `
      <button class="add-account-card" type="button" data-add-account aria-label="Adicionar conta"><i class="ph ph-plus" aria-hidden="true"></i><span>+ Adicionar conta</span></button>
    `;
  }

  function closeAccountMenus() {
    $$("[data-account-menu-panel]").forEach((panel) => {
      panel.hidden = true;
      panel.parentElement?.querySelector("[data-account-menu]")?.setAttribute("aria-expanded", "false");
    });
  }

  function toggleAccountMenu(accountId) {
    closeAccountMenus();
    const panel = $(`[data-account-menu-panel="${CSS.escape(accountId)}"]`);
    const trigger = panel?.parentElement?.querySelector("[data-account-menu]");
    if (!panel) return;
    panel.hidden = !panel.hidden;
    if (trigger) trigger.setAttribute("aria-expanded", String(!panel.hidden));
  }

  function renderApprovals() {
    const target = $("#approval-body");
    if (!target) return;
    const query = state.search.trim().toLocaleLowerCase("pt-BR");
    const filtered = state.approvals.filter((approval) => {
      if (!query) return true;
      return [approval.group, approval.account, approval.requestedAt].some((value) => String(value).toLocaleLowerCase("pt-BR").includes(query));
    });
    const rows = state.showAllApprovals ? filtered : filtered.slice(0, 4);
    target.innerHTML = rows.length ? rows.map((approval) => `
      <article class="approval-item" role="listitem" tabindex="0" data-approval-id="${escapeHtml(approval.id)}">
        <div class="approval-item-copy">
          <div class="approval-item-heading">
            <strong>${escapeHtml(approval.group)}</strong>
            <span class="status-badge ${approval.status === "pending" ? "pending" : "approved"}">${approval.status === "pending" ? "Pendente" : "Revisado"}</span>
          </div>
          <div class="approval-item-meta"><span><i class="ph ph-wallet" aria-hidden="true"></i>${escapeHtml(approval.account)}</span><span><i class="ph ph-calendar-blank" aria-hidden="true"></i>${escapeHtml(approval.requestedAt)}</span></div>
          <div class="approval-item-facts"><span><i class="ph ph-clock" aria-hidden="true"></i>${escapeHtml(approval.duration)}</span><span><i class="ph ph-chart-pie-slice" aria-hidden="true"></i>${formatQuota(approval.quota)} de quota</span></div>
        </div>
        <button class="action-link" type="button" data-approval-action="${escapeHtml(approval.id)}">Decidir</button>
      </article>
    `).join("") : `<div class="approval-empty"><i class="ph ph-check-circle" aria-hidden="true"></i><span>Nenhuma solicitação encontrada.</span></div>`;
    setText("#view-all-approvals", state.showAllApprovals ? "Mostrar menos" : `Ver todas (${state.approvals.length})`);
  }

  function renderAccountTabs() {
    const target = $("#account-tabs");
    if (!target) return;
    target.innerHTML = state.accounts.slice(0, 3).map((account) => `
      <button class="account-tab${account.id === state.activeAccountId ? " is-active" : ""}" type="button" role="tab" aria-selected="${account.id === state.activeAccountId}" data-account-tab="${escapeHtml(account.id)}">${escapeHtml(account.label)}</button>
    `).join("");
  }

  function agendaRangeLabel() {
    const start = state.weekStart;
    const end = addDays(start, 6);
    const startMonth = MONTH_FORMATTER.format(start);
    const endMonth = MONTH_FORMATTER.format(end);
    const monthLabel = (value) => value.charAt(0).toUpperCase() + value.slice(1);
    if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
      return `${start.getDate()} – ${end.getDate()} de ${monthLabel(startMonth)}, ${start.getFullYear()}`;
    }
    return `${start.getDate()} de ${monthLabel(startMonth)} – ${end.getDate()} de ${monthLabel(endMonth)}, ${end.getFullYear()}`;
  }

  function agendaHourRange(schedules) {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    schedules.forEach((schedule) => {
      const { start, end } = scheduleTimeRange(schedule);
      if (Number.isFinite(start)) min = Math.min(min, start);
      if (Number.isFinite(end)) max = Math.max(max, end);
    });
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { start: 8, end: 18 };
    return {
      start: Math.max(0, Math.min(8, Math.floor(min))),
      end: Math.max(18, Math.min(24, Math.ceil(max))),
    };
  }

  function renderWeekAgenda(schedules) {
    const range = agendaHourRange(schedules);
    const rowCount = range.end - range.start;
    const rowsStyle = `grid-template-rows:repeat(${rowCount}, ${ADMIN_AGENDA_SLOT_HEIGHT}px)`;
    const days = agendaDays();
    const visibleDayIndexes = state.view === "day" ? [state.focusedDayIndex] : days.map((_day, index) => index);
    const visibleDays = visibleDayIndexes.map((index) => days[index]);
    const headerClass = state.view === "day" ? "calendar-week-head is-day" : "calendar-week-head";
    const columnsClass = state.view === "day" ? "day-columns is-day" : "day-columns";
    const header = `<div class="${headerClass}"><div></div>${visibleDays.map((day) => `<div class="${day.today ? "today-day" : ""}"><strong>${day.short}</strong><span class="day-number">${day.number}</span></div>`).join("")}</div>`;
    const timeColumn = `<div class="time-column" style="${rowsStyle}">${Array.from({ length: rowCount }, (_, index) => `<div class="time-label">${formatTime(range.start + index)}</div>`).join("")}</div>`;
    const columns = visibleDayIndexes.map((dayIndex) => {
      const daySchedules = schedules.filter((schedule) => scheduleDayIndex(schedule) === dayIndex);
      return `<div class="day-track${days[dayIndex]?.today ? " today-track" : ""}" style="min-height:${rowCount * ADMIN_AGENDA_SLOT_HEIGHT}px">${Array.from({ length: rowCount }, () => `<div class="hour-line"></div>`).join("")}${daySchedules.map((schedule) => renderScheduleCard(schedule, range)).join("")}</div>`;
    }).join("");
    return `${header}<div class="calendar-body">${timeColumn}<div class="${columnsClass}">${columns}</div></div>`;
  }

  function renderScheduleCard(schedule, range) {
    const { start, end, duration } = scheduleTimeRange(schedule);
    const top = Math.max(3, (start - range.start) * ADMIN_AGENDA_SLOT_HEIGHT + 4);
    const height = Math.max(42, duration * ADMIN_AGENDA_SLOT_HEIGHT - 6);
    const compactClass = duration < 1.5 ? " is-compact" : "";
    return `<button class="schedule-card ${statusClass(schedule.status)}${compactClass}" type="button" data-schedule-id="${escapeHtml(schedule.id)}" style="top:${top}px;height:${height}px" aria-label="${escapeHtml(schedule.group)}, ${formatTime(start)} até ${formatTime(end)}, ${escapeHtml(statusText(schedule.status))}"><span class="schedule-time">${formatTime(start)} – ${formatTime(end)}</span><strong>${escapeHtml(schedule.group)}</strong><span class="schedule-status">${escapeHtml(statusText(schedule.status))}</span></button>`;
  }

  function renderListAgenda(schedules) {
    const rows = schedules.slice().sort((left, right) => scheduleStartDate(left).getTime() - scheduleStartDate(right).getTime());
    if (!rows.length) return `<div class="agenda-list-view"><p class="agenda-empty">Nenhum agendamento nesta conta.</p></div>`;
    const days = agendaDays();
    return `<div class="agenda-list-view">${rows.map((schedule) => {
      const day = days[scheduleDayIndex(schedule)] || {};
      const time = scheduleTimeRange(schedule);
      return `<button class="agenda-list-row" type="button" data-schedule-id="${escapeHtml(schedule.id)}"><span class="agenda-list-time">${day.short || "DIA"} ${day.date || ""}<br>${formatTime(time.start)} – ${formatTime(time.end)}</span><span class="agenda-list-copy"><strong>${escapeHtml(schedule.group)}</strong><span>${escapeHtml(accountById(schedule.accountId)?.label || "Conta")} · ${escapeHtml(statusText(schedule.status))}</span></span><span class="status-badge ${statusClass(schedule.status)}">${escapeHtml(statusText(schedule.status))}</span></button>`;
    }).join("")}</div>`;
  }

  function renderAgenda() {
    const target = $("#admin-agenda-board");
    if (!target) return;
    const schedules = schedulesInWeek(schedulesForAccount());
    setText("#agenda-range", agendaRangeLabel());
    target.innerHTML = state.view === "list"
      ? renderListAgenda(schedules)
      : renderWeekAgenda(schedules);
    target.scrollLeft = 0;
    $$("[data-agenda-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.agendaView === state.view));
  }

  function renderAll() {
    renderMetrics();
    renderManagedAccounts();
    renderApprovals();
    renderAccountTabs();
    renderAgenda();
  }

  function openDialog(id) {
    const dialog = document.getElementById(id);
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
  }

  function closeAllDialogs() {
    $$('dialog[open]').forEach(closeDialog);
  }

  function openRemoveAccountModal(accountId) {
    const account = accountById(accountId);
    if (!account) return;
    state.removeAccountId = account.id;
    setText("#remove-account-label", account.label);
    const count = state.schedules.filter((schedule) => schedule.accountId === account.id).length;
    setText("#remove-account-count", `${count} agendamento${count === 1 ? "" : "s"}`);
    const confirmButton = $("#remove-account-confirm");
    if (confirmButton) confirmButton.disabled = false;
    openDialog("remove-account-modal");
  }

  function resetAccountModal() {
    state.accountLogin = null;
    if (state.accountLoginPoll) {
      window.clearTimeout(state.accountLoginPoll);
      state.accountLoginPoll = null;
    }
    const fields = $("#account-create-fields");
    const oauthPanel = $("#account-oauth-panel");
    const oauthLink = $("#account-oauth-link");
    const oauthCheck = $("#account-oauth-check");
    const submit = $("#account-form-submit");
    if (fields) fields.hidden = false;
    if (oauthPanel) oauthPanel.hidden = true;
    if (oauthLink) {
      oauthLink.hidden = true;
      oauthLink.removeAttribute("href");
    }
    if (oauthCheck) oauthCheck.hidden = true;
    if (submit) {
      submit.hidden = false;
      submit.disabled = false;
      submit.innerHTML = '<i class="ph ph-plus" aria-hidden="true"></i>Criar e abrir OAuth';
    }
    setText("#account-oauth-code", "—");
    setText("#account-oauth-title", "Login OAuth iniciado");
    setText("#account-oauth-message", "Conclua a autenticação para liberar esta conta.");
    setText("#account-oauth-progress", "Aguardando a confirmação do login no Codex…");
  }

  function safeExternalUrl(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const url = new URL(value, window.location.href);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch {
      return null;
    }
  }

  function accountSnapshotIsReady(snapshot) {
    return snapshot && snapshot.status === "ready";
  }

  async function refreshAccountUntilReady(accountId) {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      if (!state.accountLogin || state.accountLogin.accountId !== accountId) return;
      await new Promise((resolve) => {
        state.accountLoginPoll = window.setTimeout(resolve, 2_000);
      });
      state.accountLoginPoll = null;
      if (!state.accountLogin || state.accountLogin.accountId !== accountId) return;
      try {
        const result = await adminRequest(`/api/admin/accounts/${encodeURIComponent(accountId)}/refresh`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        if (accountSnapshotIsReady(result?.account)) {
          setText("#account-oauth-title", "Conta autenticada");
          setText("#account-oauth-message", "A conta já está pronta para receber sessões.");
          setText("#account-oauth-progress", "Login concluído. Você pode fechar esta janela.");
          state.accountLogin.completed = true;
          await loadLiveData();
          showToast("Conta autenticada e disponível para uso.");
          return;
        }
      } catch {
        // O app-server pode continuar indisponível durante a autenticação.
      }
    }
    if (state.accountLogin?.accountId === accountId && !state.accountLogin.completed) {
      setText("#account-oauth-progress", "Ainda não recebemos a confirmação. Use Verificar quando terminar o login.");
    }
  }

  async function startAccountOAuth(label) {
    if (!getAuthToken()) {
      showToast("Faça login como administrador antes de adicionar uma conta.", "error");
      return;
    }

    const oauthWindow = window.open("about:blank", "codex-account-oauth");
    const submit = $("#account-form-submit");
    if (submit) {
      submit.disabled = true;
      submit.innerHTML = '<i class="ph ph-spinner-gap" aria-hidden="true"></i>Criando conta…';
    }

    try {
      const created = await adminRequest("/api/admin/accounts", {
        method: "POST",
        body: JSON.stringify({ label }),
      });
      const accountId = created?.account?.accountId || created?.account?.account_id;
      if (!accountId) throw new Error("O host não retornou o identificador da conta.");

      const started = await adminRequest(`/api/admin/accounts/${encodeURIComponent(accountId)}/login/start`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const login = started?.login || {};
      const loginUrl = safeExternalUrl(login.authUrl || login.verificationUrl);
      if (!loginUrl) throw new Error("O app-server não retornou uma URL OAuth válida.");

      state.accountLogin = { accountId, completed: false };
      $("#account-create-fields").hidden = true;
      $("#account-oauth-panel").hidden = false;
      $("#account-oauth-check").hidden = false;
      if (submit) submit.hidden = true;
      setText("#account-oauth-code", login.userCode || "Use o link de autenticação");
      setText("#account-oauth-message", `Finalize o login da ${label} na página do Codex.`);
      const link = $("#account-oauth-link");
      link.href = loginUrl;
      link.hidden = false;
      if (oauthWindow && !oauthWindow.closed) oauthWindow.location.href = loginUrl;
      else window.location.assign(loginUrl);

      await loadLiveData();
      void refreshAccountUntilReady(accountId);
    } catch (error) {
      if (oauthWindow && !oauthWindow.closed) oauthWindow.close();
      const message = error instanceof Error ? error.message : "Não foi possível iniciar o OAuth.";
      showToast(message, "error");
      resetAccountModal();
    }
  }

  function populateScheduleDetails(schedule) {
    if (!schedule) return;
    const account = accountById(schedule.accountId);
    const time = scheduleTimeRange(schedule);
    const startDate = time.startDate;
    const dateValue = dateKey(startDate);
    const period = formatPeriod(schedule);
    const accountLabel = account?.label || "Conta 1";
    setText("#review-group", schedule.group);
    setText("#review-account", accountLabel);
    setText("#review-period", period);
    setText("#review-requested-quota", formatQuota(schedule.quota));
    setText("#review-remaining-quota", formatQuota(Math.max(0, 42 - Number(schedule.quota || 0))));
    const startInput = $("#review-start");
    const endInput = $("#review-end");
    if (startInput) startInput.value = dateValue;
    if (endInput) endInput.value = dateValue;
    const quotaInput = $("#review-quota");
    if (quotaInput) quotaInput.value = String(schedule.quota || 20);
    setText("#review-quota-value", formatQuota(schedule.quota));
    const reviewNote = $("#review-note");
    if (reviewNote) reviewNote.value = schedule.note || "";
    updateCounter(reviewNote, $("#review-note-count"), 200);

    setText("#disable-group", schedule.group);
    setText("#disable-account", accountLabel);
    setText("#disable-start", `${formatDate(startDate)} ${formatTime(time.start)}`);
    setText("#disable-quota", formatQuota(schedule.quota));
    setText("#cancel-group", schedule.group);
    setText("#cancel-account", accountLabel);
    setText("#cancel-scheduled", `${formatDate(startDate)} ${formatTime(time.start)}`);
    setText("#cancel-quota", formatQuota(schedule.quota));
    setText("#history-admin", "Administrador");
    setText("#history-date", schedule.requestedAt || formatDateTime(startDate));
    setText("#history-period", period);
    setText("#history-requested", formatQuota(schedule.quota));
    setText("#history-adjusted", formatQuota(schedule.adjustedQuota || Math.max(5, Number(schedule.quota || 0) - 5)));
    setText("#history-note", schedule.note || "Ação registrada no histórico administrativo.");
    const historyAction = $("#history-action");
    if (historyAction) {
      historyAction.textContent = statusText(schedule.status);
      historyAction.className = `status-badge ${statusClass(schedule.status)}`;
    }
  }

  function openSchedule(scheduleId) {
    const schedule = state.schedules.find((item) => item.id === scheduleId);
    if (!schedule) return;
    state.selectedScheduleId = schedule.id;
    populateScheduleDetails(schedule);
    if (schedule.status === "pending" || schedule.status === "adjusted") openDialog("review-modal");
    else if (schedule.status === "active") openDialog("disable-modal");
    else if (schedule.status === "approved") openDialog("cancel-modal");
    else openDialog("history-modal");
  }

  function openApproval(approvalId) {
    const approval = state.approvals.find((item) => item.id === approvalId);
    if (!approval) return;
    const schedule = state.schedules.find((item) => item.id === (approval.scheduleId || approval.id));
    if (!schedule) return;
    state.selectedScheduleId = schedule.id;
    populateScheduleDetails(schedule);
    openDialog("review-modal");
  }

  function updateCounter(input, output, max) {
    if (output) output.textContent = String(Math.min(max, input?.value?.length || 0));
  }

  function updateSchedule(status, message, extra = {}) {
    const schedule = selectedSchedule();
    if (!schedule) return;
    Object.assign(schedule, { ...extra, status, statusLabel: statusText(status), note: extra.note ?? schedule.note });
    state.approvals = state.approvals.map((approval) => (approval.scheduleId || approval.id) === schedule.id ? { ...approval, status: status === "pending" ? "pending" : "approved" } : approval);
    closeAllDialogs();
    renderAll();
    showToast(message);
  }

  function getAuthToken() {
    try {
      return window.RemoteCodexAuth?.getSession?.()?.access_token || "";
    } catch {
      return "";
    }
  }

  async function ensureAdminAccess() {
    if (preview) return true;
    let token = getAuthToken();
    if (!token) return false;

    const check = async () => fetch("/api/admin/session", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    try {
      let response = await check();
      if (response.status === 401 && window.RemoteCodexAuth?.refreshSession) {
        const config = await window.RemoteCodexAuth.loadConfig();
        await window.RemoteCodexAuth.refreshSession(config);
        token = getAuthToken();
        if (!token) return false;
        response = await check();
      }
      if (!response.ok) return false;
      const identity = await response.json().catch(() => ({}));
      return identity.role === "owner" || identity.role === "admin";
    } catch {
      return false;
    }
  }

  async function adminRequest(path, options = {}) {
    const token = getAuthToken();
    if (!token) return null;
    const response = await fetch(path, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Não foi possível concluir a ação.");
    return data;
  }

  async function sendReservationDecision(action, schedule, note) {
    if (!state.live || !schedule?.id) return;
    try {
      await adminRequest(`/api/admin/reservations/${encodeURIComponent(schedule.id)}/${action}`, {
        method: "POST",
        body: JSON.stringify({ note: note || null }),
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Ação salva apenas nesta visualização.", "error");
    }
  }

  async function loadLiveData() {
    if (!getAuthToken()) return;
    try {
      const [accountsResult, usersResult, reservationsResult] = await Promise.all([
        adminRequest("/api/admin/accounts"),
        adminRequest("/api/admin/users"),
        adminRequest("/api/admin/reservations"),
      ]);
      const accounts = Array.isArray(accountsResult?.accounts) ? accountsResult.accounts : [];
      const users = Array.isArray(usersResult?.users) ? usersResult.users : [];
      const reservations = Array.isArray(reservationsResult?.reservations) ? reservationsResult.reservations : [];
      if (!accounts.length && !reservations.length) return;
      if (accounts.length) {
        state.accounts = accounts.map((account, index) => ({
          id: account.accountId || account.account_id || `account-live-${index}`,
          label: account.label || `Conta ${index + 1}`,
          quota: accountQuota(account),
          reset: resetLabel(account),
          status: account.status || "ready",
        }));
        state.activeAccountId = state.accounts[0]?.id || state.activeAccountId;
      }
      if (reservations.length) {
        const userMap = new Map(users.map((user) => [user.user_id, user.group_name || user.username || "Grupo"]));
        state.schedules = reservations.map((reservation, index) => normalizeReservation(reservation, userMap, index));
        state.approvals = state.schedules.filter((schedule) => schedule.status === "pending").map((schedule) => ({
          id: schedule.id,
          group: schedule.group,
          account: accountById(schedule.accountId)?.label || "Conta",
          requestedAt: schedule.requestedAt,
          duration: formatDuration(schedule.start, schedule.end),
          quota: schedule.quota,
          status: "pending",
        }));
      }
      state.live = true;
      renderAll();
    } catch {
      // A local visual preview is still useful when the relay is not running.
    }
  }

  function accountQuota(account) {
    const limits = Object.values(account.rateLimits || {});
    const windows = limits.flatMap((limit) => [limit?.primary, limit?.secondary]).filter(Boolean);
    const used = windows.sort((left, right) => Number(right.windowDurationMins || 0) - Number(left.windowDurationMins || 0))[0]?.usedPercent;
    return Math.max(0, Math.min(100, Math.round(100 - Number(used || 0))));
  }

  function resetLabel(account) {
    const limits = Object.values(account.rateLimits || {});
    const windows = limits.flatMap((limit) => [limit?.primary, limit?.secondary]).filter(Boolean);
    const reset = windows[0]?.resetsAt;
    if (!reset) return "seg 00:00";
    const date = new Date(reset);
    return Number.isNaN(date.getTime()) ? "seg 00:00" : date.toLocaleDateString("pt-BR", { weekday: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "");
  }

  function normalizeReservation(reservation, userMap, index) {
    const startDate = new Date(reservation.starts_at);
    const endDate = new Date(reservation.ends_at);
    const day = Number.isNaN(startDate.getTime()) ? (index % 7) : Math.max(0, Math.min(6, (startDate.getDay() + 6) % 7));
    const start = Number.isNaN(startDate.getTime()) ? 9 : startDate.getHours() + (startDate.getMinutes() / 60);
    const durationHours = Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())
      ? 1
      : Math.max(0, (endDate.getTime() - startDate.getTime()) / 3_600_000);
    const end = start + (durationHours || 1);
    const status = reservation.status === "cancelled" ? "cancelled" : reservation.approval_status === "pending" ? "pending" : reservation.device_id ? "active" : "approved";
    const requestedDate = new Date(reservation.created_at || reservation.starts_at);
    return {
      id: reservation.id,
      group: userMap.get(reservation.user_id) || "Grupo",
      accountId: reservation.account_id,
      day,
      dateKey: Number.isNaN(startDate.getTime()) ? "" : dateKey(startDate),
      start,
      end,
      startsAt: Number.isNaN(startDate.getTime()) ? "" : startDate.toISOString(),
      endsAt: Number.isNaN(endDate.getTime()) ? "" : endDate.toISOString(),
      status,
      statusLabel: statusText(status),
      quota: Number(reservation.requested_quota_percent || 5),
      adjustedQuota: Number(reservation.quota_budget_percent || reservation.requested_quota_percent || 5),
      deviceId: reservation.device_id || null,
      requestedAt: Number.isNaN(requestedDate.getTime()) ? "" : formatDateTime(requestedDate),
      note: reservation.review_note || "",
    };
  }

  function formatDuration(start, end) {
    const minutes = Math.max(0, Math.round((Number(end) - Number(start)) * 60));
    if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
    return `${minutes}m`;
  }

  function bindEvents() {
    $("#admin-search")?.addEventListener("input", (event) => {
      state.search = event.currentTarget.value || "";
      renderApprovals();
    });

    $("#view-all-approvals")?.addEventListener("click", () => {
      state.showAllApprovals = !state.showAllApprovals;
      renderApprovals();
    });

    $("#agenda-prev")?.addEventListener("click", () => {
      state.weekStart = addDays(state.weekStart, -7);
      renderAgenda();
    });

    $("#agenda-next")?.addEventListener("click", () => {
      state.weekStart = addDays(state.weekStart, 7);
      renderAgenda();
    });

    $("#agenda-today")?.addEventListener("click", () => {
      const today = new Date();
      state.weekStart = startOfWeek(today);
      state.focusedDayIndex = weekdayIndex(today);
      renderAgenda();
    });

    $("#agenda-view-switch")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-agenda-view]");
      if (!button) return;
      state.view = button.dataset.agendaView;
      renderAgenda();
    });

    $("#account-tabs")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-account-tab]");
      if (!button) return;
      state.activeAccountId = button.dataset.accountTab;
      state.view = "week";
      renderAccountTabs();
      renderAgenda();
    });

    $("#managed-accounts")?.addEventListener("click", (event) => {
      const addButton = event.target.closest("[data-add-account]");
      if (addButton) {
        resetAccountModal();
        $("#new-account-label").value = `Conta ${state.accounts.length + 1}`;
        openDialog("account-modal");
        return;
      }
      const menuTrigger = event.target.closest("[data-account-menu]");
      if (menuTrigger) {
        event.stopPropagation();
        toggleAccountMenu(menuTrigger.dataset.accountMenu);
        return;
      }
      const removeItem = event.target.closest("[data-account-remove]");
      if (removeItem) {
        event.stopPropagation();
        closeAccountMenus();
        openRemoveAccountModal(removeItem.dataset.accountRemove);
        return;
      }
      const card = event.target.closest("[data-account-card]");
      if (!card) return;
      state.activeAccountId = card.dataset.accountCard;
      renderAccountTabs();
      renderAgenda();
      showToast(`Agenda da ${accountById(state.activeAccountId)?.label || "conta"} selecionada.`);
    });

    $("#managed-accounts")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const trigger = event.target.closest("[data-account-menu]");
      if (trigger) {
        event.preventDefault();
        toggleAccountMenu(trigger.dataset.accountMenu);
        return;
      }
      const card = event.target.closest("[data-account-card]");
      if (!card) return;
      event.preventDefault();
      state.activeAccountId = card.dataset.accountCard;
      renderAccountTabs();
      renderAgenda();
      showToast(`Agenda da ${accountById(state.activeAccountId)?.label || "conta"} selecionada.`);
    });

    document.addEventListener("click", (event) => {
      if (!event.target.closest("[data-account-menu-panel], [data-account-menu]")) closeAccountMenus();
    });

    $("#remove-account-confirm")?.addEventListener("click", async () => {
      const account = accountById(state.removeAccountId);
      if (!account) return;
      const confirmButton = $("#remove-account-confirm");
      if (confirmButton) confirmButton.disabled = true;
      try {
        if (state.live) {
          await adminRequest(`/api/admin/accounts/${encodeURIComponent(account.id)}/remove`, {
            method: "POST",
            body: JSON.stringify({}),
          });
        }
        state.accounts = state.accounts.filter((item) => item.id !== account.id);
        state.schedules = state.schedules.filter((item) => item.accountId !== account.id);
        state.approvals = state.approvals.filter((item) => {
          const linked = state.schedules.find((schedule) => schedule.id === (item.scheduleId || item.id));
          return !linked || linked.accountId !== account.id;
        });
        if (state.activeAccountId === account.id) state.activeAccountId = state.accounts[0]?.id || "";
        state.removeAccountId = null;
        closeAllDialogs();
        renderAll();
        showToast(`${account.label} removida.`);
      } catch (error) {
        if (confirmButton) confirmButton.disabled = false;
        showToast(error instanceof Error ? error.message : "Não foi possível remover a conta.", "error");
      }
    });

    function openFromTarget(event) {
      const scheduleTarget = event.target.closest("[data-schedule-id]");
      const approvalTarget = event.target.closest("[data-approval-id], [data-approval-action]");
      if (approvalTarget && !scheduleTarget) {
        openApproval(approvalTarget.dataset.approvalId || approvalTarget.dataset.approvalAction);
        return;
      }
      if (scheduleTarget?.dataset.scheduleId) openSchedule(scheduleTarget.dataset.scheduleId);
    }

    $("#admin-agenda-board")?.addEventListener("click", openFromTarget);
    $("#approval-body")?.addEventListener("click", openFromTarget);
    $("#approval-body")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") openFromTarget(event);
    });

    $$('[data-close-modal]').forEach((button) => button.addEventListener("click", () => closeDialog(button.closest("dialog"))));
    $$('dialog').forEach((dialog) => dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog(dialog);
    }));

    $("#review-quota")?.addEventListener("input", (event) => setText("#review-quota-value", formatQuota(event.currentTarget.value)));
    $("#review-note")?.addEventListener("input", (event) => updateCounter(event.currentTarget, $("#review-note-count"), 200));
    $("#disable-note")?.addEventListener("input", (event) => updateCounter(event.currentTarget, $("#disable-note-count"), 180));
    $("#cancel-note")?.addEventListener("input", (event) => updateCounter(event.currentTarget, $("#cancel-note-count"), 180));

    $("#review-approve")?.addEventListener("click", async () => {
      const schedule = selectedSchedule();
      const note = $("#review-note")?.value.trim() || "";
      updateSchedule("approved", "Solicitação aprovada.", { note });
      await sendReservationDecision("approve", schedule, note);
    });

    $("#review-adjust")?.addEventListener("click", async () => {
      const schedule = selectedSchedule();
      const note = $("#review-note")?.value.trim() || "Ajuste realizado para otimizar o uso da capacidade disponível.";
      const adjustedQuota = Number($("#review-quota")?.value || schedule?.quota || 15);
      updateSchedule("adjusted", "Solicitação aprovada com ajuste.", { note, adjustedQuota });
      await sendReservationDecision("approve", schedule, note);
    });

    $("#review-reject")?.addEventListener("click", async () => {
      const schedule = selectedSchedule();
      const note = $("#review-note")?.value.trim() || "Solicitação recusada pelo administrador.";
      updateSchedule("cancelled", "Solicitação recusada.", { note });
      await sendReservationDecision("reject", schedule, note);
    });

    $("#disable-confirm")?.addEventListener("click", () => {
      const note = $("#disable-note")?.value.trim() || "Token desabilitado pelo administrador.";
      updateSchedule("disabled", "Token desabilitado.", { note });
    });

    $("#cancel-confirm")?.addEventListener("click", () => {
      const note = $("#cancel-note")?.value.trim() || "Sessão cancelada pelo administrador.";
      updateSchedule("cancelled", "Sessão cancelada.", { note });
    });

    $("#account-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const label = $("#new-account-label")?.value.trim() || `Conta ${state.accounts.length + 1}`;
      await startAccountOAuth(label);
    });

    $("#account-oauth-check")?.addEventListener("click", async () => {
      const accountId = state.accountLogin?.accountId;
      if (!accountId) return;
      try {
        const result = await adminRequest(`/api/admin/accounts/${encodeURIComponent(accountId)}/refresh`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        if (accountSnapshotIsReady(result?.account)) {
          state.accountLogin.completed = true;
          setText("#account-oauth-title", "Conta autenticada");
          setText("#account-oauth-message", "A conta já está pronta para receber sessões.");
          setText("#account-oauth-progress", "Login concluído. Você pode fechar esta janela.");
          await loadLiveData();
          showToast("Conta autenticada e disponível para uso.");
        } else {
          setText("#account-oauth-progress", "O login ainda não foi confirmado pelo app-server.");
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Não foi possível verificar a conta.", "error");
      }
    });

    $$('[data-section]').forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.section === "overview") return;
      if (button.dataset.section === "groups") {
        window.location.replace("/groups.html");
        return;
      }
      showToast("Esta visão operacional está concentrada no painel Geral.");
    }));

    $(".sidebar-collapse")?.addEventListener("click", () => {
      $(".admin-shell")?.classList.toggle("is-collapsed");
    });

    $("[data-admin-logout]")?.addEventListener("click", async () => {
      try {
        const config = await window.RemoteCodexAuth?.loadConfig?.();
        if (config) await window.RemoteCodexAuth?.signOut?.(config);
      } catch {
        window.RemoteCodexAuth?.clearSession?.();
      } finally {
        window.location.replace("/login");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    if (!(await ensureAdminAccess())) {
      window.RemoteCodexAuth?.clearSession?.();
      window.location.replace("/login");
      return;
    }
    document.body.classList.remove("admin-auth-pending");
    document.body.classList.add("admin-auth-ready");
    bindEvents();
    renderAll();
    if (!preview) await loadLiveData();
  });
})();
