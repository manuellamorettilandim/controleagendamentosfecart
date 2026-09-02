(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const ADMIN_AGENDA_SLOT_HEIGHT = 48;

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

  function dateTimeInputValue(value) {
    const date = cloneDate(value);
    return `${dateKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
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

  const state = {
    accounts: [],
    schedules: [],
    approvals: [],
    activeAccountId: "",
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
    modelCatalog: [],
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
      revoked: "Token revogado",
      expired: "Sessão expirada",
    }[status] || "Pendente");
  }

  function statusClass(status) {
    if (["revoked", "expired"].includes(status)) return "disabled";
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
    const total = state.accounts.length;
    const pending = state.approvals.filter((approval) => approval.status === "pending").length;
    const measuredQuotas = state.accounts.map((account) => Number(account.quota)).filter(Number.isFinite);
    const remaining = measuredQuotas.length
      ? Math.round(measuredQuotas.reduce((sum, quota) => sum + quota, 0) / measuredQuotas.length)
      : null;
    const today = dateKey(new Date());
    const todaySchedules = state.schedules.filter((schedule) => schedule.dateKey === today && schedule.status !== "cancelled");
    const todayAccounts = new Set(todaySchedules.map((schedule) => schedule.accountId).filter(Boolean)).size;
    setText("#metric-active-accounts", state.live ? active : "—");
    setText("#metric-total-accounts", state.live ? total : "—");
    setText("#metric-quota", state.live && remaining !== null ? `${remaining}%` : "—");
    setText("#metric-today", state.live ? todaySchedules.length : "—");
    setText("#metric-today-accounts", state.live ? todayAccounts : "—");
    setText("#metric-pending", state.live ? pending : "—");
    setText("#metric-quota-detail", state.live && remaining !== null ? `${remaining}% de 100%` : "carregando dados reais");
    setText("#metric-pending-detail", state.live ? "requerem decisão" : "carregando dados reais");
    const activeProgress = $("#metric-active-progress");
    const quotaProgress = $("#metric-quota-progress");
    const todayProgress = $("#metric-today-progress");
    const pendingProgress = $("#metric-pending-progress");
    if (activeProgress) activeProgress.style.width = `${total ? Math.min(100, (active / total) * 100) : 0}%`;
    if (quotaProgress) quotaProgress.style.width = `${remaining === null ? 0 : Math.min(100, remaining)}%`;
    if (todayProgress) todayProgress.style.width = `${Math.min(100, (todaySchedules.length / 24) * 100)}%`;
    if (pendingProgress) pendingProgress.style.width = `${Math.min(100, (pending / 12) * 100)}%`;
    setText("#approval-count", state.live ? pending : "—");
  }

  function renderManagedAccounts() {
    const target = $("#managed-accounts");
    if (!target) return;
    target.innerHTML = state.accounts.map((account) => `
      <div class="managed-account-card" data-account-card="${escapeHtml(account.id)}" role="button" tabindex="0" aria-label="Abrir agenda da ${escapeHtml(account.label)}">
        <span class="account-card-header"><span class="account-card-name"><i class="status-dot" aria-hidden="true"></i>${escapeHtml(account.label)}</span>
          <span class="account-menu-wrap">
            <button class="account-menu-trigger" type="button" data-account-menu="${escapeHtml(account.id)}" aria-label="Ações de ${escapeHtml(account.label)}" aria-haspopup="menu" aria-expanded="false"><i class="ph ph-dots-three-vertical" aria-hidden="true"></i></button>
            <div class="account-menu" role="menu" data-account-menu-panel="${escapeHtml(account.id)}" hidden>
              <button class="account-menu-item" type="button" role="menuitem" data-account-remove="${escapeHtml(account.id)}"><i class="ph ph-trash" aria-hidden="true"></i>Remover conta</button>
            </div>
          </span>
        </span>
        <span class="account-card-body"><span class="quota-ring" style="--quota: ${Math.max(0, Math.min(100, Number(account.quota || 0)))}%"><span>${formatQuota(account.quota)}</span></span><span class="account-quota-copy"><strong>${formatQuota(account.quota)} disponível em 5h</strong><span>Reset ${escapeHtml(account.reset || "indisponível")}</span><small>Semanal: ${formatQuota(account.weeklyQuota)} · reset ${escapeHtml(account.weeklyReset || "indisponível")}</small></span></span>
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
          <div class="approval-item-facts"><span><i class="ph ph-clock" aria-hidden="true"></i>${escapeHtml(approval.duration)}</span><span><i class="ph ph-gauge" aria-hidden="true"></i>100% da janela de 5h</span></div>
        </div>
        <button class="action-link" type="button" data-approval-action="${escapeHtml(approval.id)}">Decidir</button>
      </article>
    `).join("") : `<div class="approval-empty"><i class="ph ph-check-circle" aria-hidden="true"></i><span>Nenhuma solicitação encontrada.</span></div>`;
    setText("#view-all-approvals", state.showAllApprovals ? "Mostrar menos" : `Ver todas (${state.approvals.length})`);
  }

  function renderAccountTabs() {
    const target = $("#account-tabs");
    if (!target) return;
    target.innerHTML = state.accounts.map((account) => `
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
    const period = formatPeriod(schedule);
    const accountLabel = account?.label || "Conta 1";
    setText("#review-group", schedule.group);
    setText("#review-account", accountLabel);
    setText("#review-period", period);
    const isOngoingPending = (schedule.status === "pending" || schedule.approvalStatus === "pending") && startDate < new Date() && time.endDate > new Date();
    const effectiveStartDate = isOngoingPending ? new Date() : startDate;
    const startInput = $("#review-start");
    const endInput = $("#review-end");
    if (startInput) startInput.value = dateTimeInputValue(effectiveStartDate);
    if (endInput) endInput.value = dateTimeInputValue(time.endDate);
    const reviewNote = $("#review-note");
    if (reviewNote) reviewNote.value = schedule.note || "";
    updateCounter(reviewNote, $("#review-note-count"), 200);

    setText("#disable-group", schedule.group);
    setText("#disable-account", accountLabel);
    setText("#disable-start", `${formatDate(startDate)} ${formatTime(time.start)}`);
    setText("#cancel-group", schedule.group);
    setText("#cancel-account", accountLabel);
    setText("#cancel-scheduled", `${formatDate(startDate)} ${formatTime(time.start)}`);
    setText("#history-admin", "Administrador");
    setText("#history-date", schedule.requestedAt || formatDateTime(startDate));
    setText("#history-period", period);
    setText("#history-note", schedule.note || "Ação registrada no histórico administrativo.");
    const historyAction = $("#history-action");
    if (historyAction) {
      historyAction.textContent = statusText(schedule.status);
      historyAction.className = `status-badge ${statusClass(schedule.status)}`;
    }
    const reactivateButton = $("#history-reactivate");
    if (reactivateButton) reactivateButton.hidden = !(schedule.status === "revoked" && schedule.deviceId && time.endDate.getTime() > Date.now());
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
    let token = getAuthToken();
    if (!token) return null;

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
        if (!token) return null;
        response = await check();
      }
      if (!response.ok) return null;
      const identity = await response.json().catch(() => ({}));
      return identity.role === "owner" || identity.role === "admin" ? identity : null;
    } catch {
      return null;
    }
  }

  async function adminRequest(path, options = {}) {
    return window.FecartApi.admin(path, options);
  }

  function fillPercentSelect(select, maximum, selected) {
    if (!select) return;
    const max = Math.max(1, Math.min(100, Number(maximum) || 100));
    const value = Math.max(1, Math.min(max, Number(selected) || 1));
    select.innerHTML = Array.from({ length: max }, (_, index) => {
      const percent = index + 1;
      return `<option value="${percent}"${percent === value ? " selected" : ""}>${percent}%</option>`;
    }).join("");
  }

  function syncAutoApproveControls() {
    const enabled = Boolean($("#settings-auto-approve-enabled")?.checked);
    const autoSelect = $("#settings-auto-approve");
    if (autoSelect) autoSelect.disabled = !enabled;
    setText("#settings-auto-label", enabled ? "Ativada" : "Desativada");
  }

  function modelPresentation(modelId) {
    if (modelId.includes("sol")) return ["sol", "ph-sun"];
    if (modelId.includes("terra")) return ["terra", "ph-globe-hemisphere-west"];
    if (modelId.includes("luna") || modelId.includes("mini")) return ["luna", "ph-moon-stars"];
    return ["legacy", "ph-stack"];
  }

  function renderModelCatalog(settings) {
    const target = $("#settings-models");
    if (!target) return;
    const enabledModels = new Set(Array.isArray(settings?.enabled_models) ? settings.enabled_models : []);
    target.innerHTML = state.modelCatalog.length ? state.modelCatalog.map((model) => {
      const [tone, icon] = modelPresentation(model.id);
      const checked = enabledModels.has(model.id);
      return `<label class="model-policy-card${checked ? " is-enabled" : ""}" data-model-card="${escapeHtml(model.id)}">
        <span class="model-policy-icon ${tone}"><i class="ph ${icon}" aria-hidden="true"></i></span>
        <span><strong>${escapeHtml(model.displayName || model.id)}</strong><small>${escapeHtml(model.description || model.id)}</small></span>
        <input type="checkbox" value="${escapeHtml(model.id)}" data-model-toggle${checked ? " checked" : ""}>
      </label>`;
    }).join("") : '<p class="settings-models-loading is-error">Nenhum modelo retornado pela API da conta. Verifique a conexão do host.</p>';
    const save = $("#settings-save");
    if (save) save.disabled = state.modelCatalog.length === 0;
  }

  function syncWeeklyQuotaBadge() {
    const slider = $("#settings-session-weekly-quota");
    const badge = $("#settings-session-weekly-quota-badge");
    if (slider && badge) {
      badge.textContent = `${slider.value}%`;
    }
  }

  function renderSettings(settings) {
    const autoQuota = Math.max(0, Number(settings?.auto_approve_quota_percent) || 0);
    const autoToggle = $("#settings-auto-approve-enabled");
    if (autoToggle) autoToggle.checked = autoQuota > 0;
    const weeklySlider = $("#settings-session-weekly-quota");
    if (weeklySlider) {
      weeklySlider.value = String(Math.max(1, Math.min(100, Number(settings?.session_weekly_quota_percent) || 10)));
      syncWeeklyQuotaBadge();
    }
    renderModelCatalog(settings);
    syncAutoApproveControls();
    setText("#settings-status", settings?.updated_at ? `Atualizado em ${formatDateTime(settings.updated_at)}` : "Políticas carregadas.");
  }

  async function loadSettings() {
    try {
      const result = await adminRequest("/api/admin/settings");
      state.modelCatalog = Array.isArray(result?.models) ? result.models : [];
      renderSettings(result?.settings || {});
    } catch (error) {
      setText("#settings-status", error instanceof Error ? error.message : "Não foi possível carregar as políticas.");
      throw error;
    }
  }

  async function saveSettings() {
    const autoApproveEnabled = Boolean($("#settings-auto-approve-enabled")?.checked);
    const sessionWeeklyQuotaPercent = Number($("#settings-session-weekly-quota")?.value || 10);
    const enabledModels = $$('[data-model-toggle]:checked').map((input) => input.value);
    if (enabledModels.length === 0) throw new Error("Mantenha ao menos um modelo disponível.");
    const result = await adminRequest("/api/admin/settings", {
      method: "POST",
      body: JSON.stringify({ autoApproveEnabled, sessionWeeklyQuotaPercent, enabledModels }),
    });
    renderSettings(result?.settings || {});
  }

  async function sendReservationDecision(action, schedule, note, adjustments = {}) {
    if (!state.live || !schedule?.id) return;
    return adminRequest(`/api/admin/reservations/${encodeURIComponent(schedule.id)}/${action}`, {
      method: "POST",
      body: JSON.stringify({ note: note || null, ...adjustments }),
    });
  }

  async function loadLiveData() {
    if (!getAuthToken()) return;
    try {
      const [accountsResult, usersResult, reservationsResult, devicesResult] = await Promise.all([
        adminRequest("/api/admin/accounts"),
        adminRequest("/api/admin/users"),
        adminRequest("/api/admin/reservations"),
        adminRequest("/api/admin/devices"),
      ]);
      const accounts = Array.isArray(accountsResult?.accounts) ? accountsResult.accounts : [];
      const users = Array.isArray(usersResult?.users) ? usersResult.users : [];
      const reservations = Array.isArray(reservationsResult?.reservations) ? reservationsResult.reservations : [];
      const devices = Array.isArray(devicesResult?.devices) ? devicesResult.devices : [];
      state.accounts = accounts.map((account, index) => ({
          id: account.accountId || account.account_id || `account-live-${index}`,
          label: account.label || `Conta ${index + 1}`,
          quota: accountQuota(account, 300),
          reset: resetLabel(account, 300),
          weeklyQuota: accountQuota(account, 10_080),
          weeklyReset: resetLabel(account, 10_080),
          status: account.status || "ready",
        }));
      if (!state.accounts.some((account) => account.id === state.activeAccountId)) {
        state.activeAccountId = state.accounts[0]?.id || "";
      }
      const userMap = new Map(users.map((user) => [user.user_id, user.username || user.group_name || "Grupo"]));
      const deviceMap = new Map(devices.map((device) => [device.deviceId || device.device_id, device]));
      state.schedules = reservations.map((reservation, index) => normalizeReservation(reservation, userMap, deviceMap, index));
      state.approvals = state.schedules.filter((schedule) => schedule.status === "pending").map((schedule) => ({
          id: schedule.id,
          group: schedule.group,
          account: accountById(schedule.accountId)?.label || "Conta",
          requestedAt: schedule.requestedAt,
          duration: formatDuration(schedule.start, schedule.end),
          quota: schedule.quota,
          status: "pending",
        }));
      state.live = true;
      renderAll();
    } catch (error) {
      state.accounts = [];
      state.schedules = [];
      state.approvals = [];
      state.activeAccountId = "";
      state.live = false;
      renderAll();
      showToast(error instanceof Error ? error.message : "Não foi possível carregar os dados reais.", "error");
    }
  }

  function quotaWindow(account, durationMinutes) {
    const limits = Object.values(account.rateLimits || {});
    const windows = limits.flatMap((limit) => [limit?.primary, limit?.secondary]).filter(Boolean);
    return windows.find((window) => Number(window.windowDurationMins) === durationMinutes)
      || (durationMinutes > 300 ? windows.sort((left, right) => Number(right.windowDurationMins || 0) - Number(left.windowDurationMins || 0))[0] : null);
  }

  function accountQuota(account, durationMinutes) {
    const used = quotaWindow(account, durationMinutes)?.usedPercent;
    if (!Number.isFinite(Number(used))) return null;
    return Math.max(0, Math.min(100, Math.round(100 - Number(used || 0))));
  }

  function resetLabel(account, durationMinutes) {
    const reset = Number(quotaWindow(account, durationMinutes)?.resetsAt);
    if (!Number.isFinite(reset) || reset <= 0) return "indisponível";
    const date = new Date(reset < 10_000_000_000 ? reset * 1_000 : reset);
    return Number.isNaN(date.getTime()) ? "indisponível" : date.toLocaleDateString("pt-BR", { weekday: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "");
  }

  function normalizeReservation(reservation, userMap, deviceMap, index) {
    const startDate = new Date(reservation.starts_at);
    const endDate = new Date(reservation.ends_at);
    const day = Number.isNaN(startDate.getTime()) ? (index % 7) : Math.max(0, Math.min(6, (startDate.getDay() + 6) % 7));
    const start = Number.isNaN(startDate.getTime()) ? 9 : startDate.getHours() + (startDate.getMinutes() / 60);
    const durationHours = Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())
      ? 1
      : Math.max(0, (endDate.getTime() - startDate.getTime()) / 3_600_000);
    const end = start + (durationHours || 1);
    const linkedDevice = reservation.device_id ? deviceMap.get(reservation.device_id) : null;
    const deviceStatus = linkedDevice?.status || "";
    const isOverduePending = reservation.approval_status === "pending" && !Number.isNaN(endDate.getTime()) && endDate.getTime() <= Date.now();
    const status = reservation.status === "cancelled" || reservation.approval_status === "expired" || isOverduePending
      ? "expired"
      : reservation.approval_status === "pending"
        ? "pending"
          : reservation.device_id && ["active", "limited"].includes(deviceStatus)
          ? "active"
          : reservation.device_id && deviceStatus === "revoked"
            ? "revoked"
          : reservation.device_id && deviceStatus === "expired"
            ? "expired"
          : reservation.device_id && deviceStatus === "disabled"
            ? "disabled"
            : "approved";
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
      quota: 100,
      adjustedQuota: 100,
      deviceId: reservation.device_id || null,
      deviceStatus,
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
    $("#settings-max-quota")?.addEventListener("change", (event) => {
      const previous = Number($("#settings-auto-approve")?.value || 1);
      fillPercentSelect($("#settings-auto-approve"), Number(event.currentTarget.value), previous);
    });
    $("#settings-auto-approve-enabled")?.addEventListener("change", syncAutoApproveControls);
    $("#settings-session-weekly-quota")?.addEventListener("input", syncWeeklyQuotaBadge);
    $("#settings-models")?.addEventListener("change", (event) => {
      const input = event.target.closest("[data-model-toggle]");
      if (input) input.closest("[data-model-card]")?.classList.toggle("is-enabled", input.checked);
    });
    $("#general-settings-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = $("#settings-save");
      if (button) button.disabled = true;
      setText("#settings-status", "Salvando políticas...");
      try {
        await saveSettings();
        showToast("Políticas de acesso salvas.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Não foi possível salvar as políticas.";
        setText("#settings-status", message);
        showToast(message, "error");
      } finally {
        if (button) button.disabled = false;
      }
    });

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

    $("#review-note")?.addEventListener("input", (event) => updateCounter(event.currentTarget, $("#review-note-count"), 200));
    $("#disable-note")?.addEventListener("input", (event) => updateCounter(event.currentTarget, $("#disable-note-count"), 180));
    $("#cancel-note")?.addEventListener("input", (event) => updateCounter(event.currentTarget, $("#cancel-note-count"), 180));

    $("#review-approve")?.addEventListener("click", async () => {
      const schedule = selectedSchedule();
      if (!schedule) return;
      const note = $("#review-note")?.value.trim() || "";
      const startsAt = new Date($("#review-start")?.value || "");
      const endsAt = new Date($("#review-end")?.value || "");
      const button = $("#review-approve");
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
        showToast("Confira o início e o fim aprovados.", "error");
        return;
      }
      if (button) button.disabled = true;
      try {
        await sendReservationDecision("approve", schedule, note, {
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          quotaBudgetPercent: 100,
        });
        closeAllDialogs();
        await loadLiveData();
        showToast("Solicitação aprovada para a janela completa de 5 horas.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Não foi possível aprovar a solicitação.", "error");
      } finally {
        if (button) button.disabled = false;
      }
    });

    $("#review-reject")?.addEventListener("click", async () => {
      const schedule = selectedSchedule();
      if (!schedule) return;
      const note = $("#review-note")?.value.trim() || "Solicitação recusada pelo administrador.";
      const button = $("#review-reject");
      if (button) button.disabled = true;
      try {
        await sendReservationDecision("reject", schedule, note);
        closeAllDialogs();
        await loadLiveData();
        showToast("Solicitação recusada.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Não foi possível recusar a solicitação.", "error");
      } finally {
        if (button) button.disabled = false;
      }
    });

    $("#disable-confirm")?.addEventListener("click", async () => {
      const schedule = selectedSchedule();
      const note = $("#disable-note")?.value.trim() || "Token desabilitado pelo administrador.";
      const button = $("#disable-confirm");
      if (!schedule?.deviceId) {
        showToast("O dispositivo ativo não foi encontrado. Atualize o painel e tente novamente.", "error");
        return;
      }
      if (button) button.disabled = true;
      try {
        await adminRequest(`/api/admin/devices/${encodeURIComponent(schedule.deviceId)}/revoke`, {
          method: "POST",
          body: JSON.stringify({ note }),
        });
        closeAllDialogs();
        await loadLiveData();
        showToast("Token revogado e conexões encerradas.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Não foi possível revogar o token.", "error");
      } finally {
        if (button) button.disabled = false;
      }
    });

    $("#history-reactivate")?.addEventListener("click", async () => {
      const schedule = selectedSchedule();
      const button = $("#history-reactivate");
      if (!schedule?.deviceId) {
        showToast("O token revogado não foi encontrado.", "error");
        return;
      }
      if (button) button.disabled = true;
      try {
        await adminRequest(`/api/admin/devices/${encodeURIComponent(schedule.deviceId)}/reactivate`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        closeAllDialogs();
        await loadLiveData();
        showToast("Token reativado para o restante da sessão.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Não foi possível reativar o token.", "error");
      } finally {
        if (button) button.disabled = false;
      }
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
        window.location.replace("/groups");
        return;
      }
      if (button.dataset.section === "telemetry") {
        window.location.replace("/telemetry");
      }
    }));


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
    const identity = await ensureAdminAccess();
    if (!identity) {
      window.RemoteCodexAuth?.clearSession?.();
      window.location.replace("/login");
      return;
    }
    window.FecartAdminShell?.setIdentity?.(identity);
    document.body.classList.remove("admin-auth-pending");
    document.body.classList.add("admin-auth-ready");
    bindEvents();
    renderAll();
    await Promise.allSettled([loadLiveData(), loadSettings()]);
  });
})();

export {};
