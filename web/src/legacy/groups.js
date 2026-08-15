(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  let groups = [];
  let pendingRequests = [];

  const state = {
    selectedId: null,
    page: 1,
    pageSize: 7,
    search: "",
    status: "all",
    allowedTokens: new Set(["active", "inactive", "disabled"]),
    toastTimer: null,
    loading: true,
    error: "",
    live: false,
    detailHistoryExpanded: false,
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function textValue(value, fallback = "") {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }

  function numberValue(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function parseDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function startOfDay(value) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function formatDate(value) {
    const date = parseDate(value);
    return date ? date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
  }

  function formatTime(value) {
    const date = parseDate(value);
    return date ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";
  }

  function formatDateTime(value) {
    const date = parseDate(value);
    return date ? `${formatDate(date)} ${formatTime(date)}` : "—";
  }

  function formatActivity(value) {
    const date = parseDate(value);
    if (!date) return "—";
    const today = startOfDay(new Date()).getTime();
    const day = startOfDay(date).getTime();
    const dayDifference = Math.round((today - day) / 86_400_000);
    if (dayDifference === 0) return `Hoje ${formatTime(date)}`;
    if (dayDifference === 1) return `Ontem ${formatTime(date)}`;
    return `${date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${formatTime(date)}`;
  }

  function formatSlot(startsAt, endsAt) {
    const start = parseDate(startsAt);
    const end = parseDate(endsAt);
    if (!start || !end) return "Horário indisponível";
    return `${formatDate(start)} ${formatTime(start)} – ${formatTime(end)}`;
  }

  function accountIdOf(account) {
    return textValue(account?.accountId || account?.account_id);
  }

  function accountLabelOf(account, accountId = "") {
    return textValue(account?.label || account?.name, accountId || "Conta não identificada");
  }

  function userIdOf(user) {
    return textValue(user?.user_id || user?.userId);
  }

  function userLabelOf(user) {
    return textValue(user?.username || user?.login_email, "Usuário");
  }

  function tokenLabel(token) {
    return { active: "Token ativo", inactive: "Token inativo", disabled: "Token desabilitado" }[token] || "Token inativo";
  }

  function tokenClass(token) {
    return token === "disabled" ? "is-disabled" : token === "inactive" ? "is-inactive" : "";
  }

  function statusLabel(token) {
    return token === "disabled" ? "Bloqueado" : token === "inactive" ? "Inativo" : "Ativo";
  }

  function statusPillClass(token) {
    return token === "disabled" ? "is-blocked" : token === "inactive" ? "is-inactive" : "is-active";
  }

  function reservationIsScheduled(reservation) {
    return textValue(reservation?.status, "scheduled") === "scheduled";
  }

  function reservationIsPending(reservation) {
    return reservationIsScheduled(reservation) && textValue(reservation?.approval_status) === "pending";
  }

  function reservationStart(reservation) {
    return parseDate(reservation?.starts_at || reservation?.startsAt);
  }

  function reservationEnd(reservation) {
    return parseDate(reservation?.ends_at || reservation?.endsAt);
  }

  function groupIdFor(name, accountId) {
    return `group-${encodeURIComponent(`${name}\u0000${accountId}`)}`;
  }

  function deviceIsActive(device) {
    return ["active", "limited"].includes(textValue(device?.status).toLowerCase());
  }

  function makeSchedule(reservation, type) {
    if (!reservation) return { type: "none", label: "Sem agendamento", time: "" };
    const start = reservationStart(reservation);
    const end = reservationEnd(reservation);
    if (type === "active") {
      return { type, label: "Sessão ativa", time: start && end ? `${formatTime(start)} – ${formatTime(end)}` : "" };
    }
    if (type === "pending") {
      return { type, label: "Solicitação pendente", time: start && end ? `${formatTime(start)} – ${formatTime(end)}` : "" };
    }
    const dayDifference = start
      ? Math.round((startOfDay(start).getTime() - startOfDay(new Date()).getTime()) / 86_400_000)
      : 0;
    const label = dayDifference === 0
      ? "Próximo: Hoje"
      : dayDifference === 1
        ? "Próximo: Amanhã"
        : `Próximo: ${start ? start.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "—"}`;
    return { type: dayDifference === 1 ? "tomorrow" : "upcoming", label, time: start && end ? `${formatTime(start)} – ${formatTime(end)}` : "" };
  }

  function buildHistory(reservations, usersById) {
    return reservations
      .map((reservation) => {
        const date = parseDate(reservation.reviewed_at || reservation.activated_at || reservation.created_at || reservation.starts_at);
        const user = usersById.get(userIdOf(reservation));
        const cancelled = textValue(reservation.status) === "cancelled";
        const pending = reservationIsPending(reservation);
        const active = Boolean(reservation.device_id);
        return {
          date,
          icon: cancelled ? "ph-prohibit" : pending ? "ph-clock" : active ? "ph-play-circle" : "ph-calendar-blank",
          tone: cancelled || pending ? "is-amber" : active ? "" : "is-blue",
          title: cancelled ? "Agendamento cancelado" : pending ? "Solicitação recebida" : active ? "Sessão iniciada" : "Agendamento criado",
          note: `${userLabelOf(user)} · ${formatDateTime(date)}`,
          time: formatActivity(date),
        };
      })
      .sort((left, right) => (right.date?.getTime() || 0) - (left.date?.getTime() || 0))
      .map(({ date, ...item }) => item);
  }

  function buildLiveGroups(accountRows, userRows, reservationRows, deviceRows) {
    const accounts = new Map(accountRows.map((account) => [accountIdOf(account), account]));
    const usersById = new Map(userRows.map((user) => [userIdOf(user), user]));
    const groupsByKey = new Map();

    function ensureGroup(user, accountIdOverride = "") {
      const name = textValue(user?.group_name || user?.groupName, "Sem grupo");
      const accountId = textValue(user?.account_id || user?.accountId, accountIdOverride || "");
      const key = `${name}\u0000${accountId}`;
      let group = groupsByKey.get(key);
      if (!group) {
        group = {
          id: groupIdFor(name, accountId),
          name,
          accountId,
          users: [],
          reservations: [],
          devices: [],
          userIds: new Set(),
        };
        groupsByKey.set(key, group);
      }
      const userId = userIdOf(user);
      if (userId && !group.userIds.has(userId)) {
        group.userIds.add(userId);
        group.users.push(user);
      }
      return group;
    }

    userRows.forEach((user) => ensureGroup(user));
    reservationRows.forEach((reservation) => {
      const userId = userIdOf(reservation);
      const user = usersById.get(userId) || {
        user_id: userId,
        group_name: "Sem grupo",
        account_id: textValue(reservation.account_id),
        username: "Usuário não identificado",
        enabled: true,
      };
      ensureGroup(user, reservation.account_id).reservations.push(reservation);
    });
    deviceRows.forEach((device) => {
      const user = usersById.get(textValue(device?.userId || device?.user_id));
      if (user) ensureGroup(user, device.accountId).devices.push(device);
    });

    return [...groupsByKey.values()].map((group) => {
      const account = accounts.get(group.accountId);
      const accountStatus = textValue(account?.status, "offline");
      const enabledUsers = group.users.filter((user) => user?.enabled !== false);
      const token = !enabledUsers.length || accountStatus === "disabled"
        ? "disabled"
        : accountStatus === "ready"
          ? "active"
          : "inactive";
      const permission = enabledUsers.length && accountStatus === "ready" ? "allowed" : "blocked";
      const activeDeviceReservationIds = new Set(group.devices.filter(deviceIsActive).map((device) => textValue(device.reservationId || device.reservation_id)));
      const now = Date.now();
      const scheduled = group.reservations
        .filter(reservationIsScheduled)
        .sort((left, right) => (reservationStart(left)?.getTime() || 0) - (reservationStart(right)?.getTime() || 0));
      const activeReservation = scheduled.find((reservation) => {
        const start = reservationStart(reservation)?.getTime() || 0;
        const end = reservationEnd(reservation)?.getTime() || 0;
        return !reservationIsPending(reservation) && (activeDeviceReservationIds.has(textValue(reservation.id)) || (start <= now && end > now));
      });
      const pendingReservation = scheduled.find(reservationIsPending);
      const upcomingReservation = scheduled.find((reservation) => (reservationStart(reservation)?.getTime() || 0) > now && !reservationIsPending(reservation));
      const selectedReservation = activeReservation || pendingReservation || upcomingReservation;
      const scheduleType = activeReservation ? "active" : pendingReservation ? "pending" : upcomingReservation ? "upcoming" : "none";
      const activityDates = [
        ...group.users.flatMap((user) => [user.created_at, user.updated_at]),
        ...group.reservations.flatMap((reservation) => [reservation.created_at, reservation.reviewed_at, reservation.activated_at, reservation.cancelled_at]),
        ...group.devices.map((device) => device.lastSeenAt || device.last_seen_at),
      ].map(parseDate).filter(Boolean);
      const lastActivityDate = activityDates.sort((left, right) => right.getTime() - left.getTime())[0] || null;
      const quotas = [
        ...group.users.map((user) => numberValue(user.weekly_quota_percent, 0)),
        ...group.reservations.map((reservation) => numberValue(reservation.quota_budget_percent || reservation.requested_quota_percent, 0)),
      ];
      const quota = Math.min(100, Math.round(Math.max(0, ...quotas)));
      return {
        id: group.id,
        name: group.name,
        accountId: group.accountId,
        account: accountLabelOf(account, group.accountId),
        accountStatus,
        token,
        permission,
        schedule: selectedReservation ? makeSchedule(selectedReservation, scheduleType) : makeSchedule(null, "none"),
        quota,
        lastActivity: formatActivity(lastActivityDate),
        activeSession: Boolean(activeReservation),
        users: group.users,
        reservations: group.reservations,
        devices: group.devices,
        history: buildHistory(group.reservations, usersById),
        pendingRequests: group.reservations
          .filter(reservationIsPending)
          .map((reservation) => ({
            id: textValue(reservation.id),
            groupId: group.id,
            group: group.name,
            requestedBy: userLabelOf(usersById.get(userIdOf(reservation))),
            slot: formatSlot(reservation.starts_at, reservation.ends_at),
            quota: numberValue(reservation.requested_quota_percent || reservation.quota_budget_percent, 0),
          })),
      };
    }).sort((left, right) => left.name.localeCompare(right.name, "pt-BR") || left.account.localeCompare(right.account, "pt-BR"));
  }

  function findGroup(id) {
    return groups.find((group) => group.id === id) || null;
  }

  function filteredGroups() {
    const query = state.search.trim().toLocaleLowerCase("pt-BR");
    return groups.filter((group) => {
      const matchesStatus = state.status === "all" ? state.allowedTokens.has(group.token) : group.token === state.status;
      if (!matchesStatus) return false;
      if (!query) return true;
      return `${group.name} ${group.account} ${tokenLabel(group.token)}`.toLocaleLowerCase("pt-BR").includes(query);
    });
  }

  function renderStats() {
    const activeSessions = groups.filter((group) => group.activeSession).length;
    const upcoming = groups.filter((group) => ["upcoming", "tomorrow"].includes(group.schedule.type)).length;
    const blocked = groups.filter((group) => group.token === "disabled").length;
    $("#groups-total-count").textContent = String(groups.length);
    $("#groups-active-count").textContent = String(activeSessions);
    $("#groups-upcoming-count").textContent = String(upcoming);
    $("#groups-blocked-count").textContent = String(blocked);
  }

  function renderSchedule(group) {
    const schedule = group.schedule;
    if (schedule.type === "none") return '<div class="schedule-cell"><span>Sem agendamento</span></div>';
    const tone = schedule.type === "active" ? "is-active" : ["pending", "tomorrow"].includes(schedule.type) ? "is-pending" : "is-upcoming";
    return `<div class="schedule-cell ${tone}"><span>${escapeHtml(schedule.label)}</span>${schedule.time ? `<small>${escapeHtml(schedule.time)}</small>` : ""}</div>`;
  }

  function renderGroupRow(group) {
    const selected = state.selectedId === group.id ? " is-selected" : "";
    const permission = group.permission === "allowed"
      ? '<span class="permission-pill">Pode agendar</span>'
      : '<span class="permission-pill is-blocked">Bloqueado</span>';
    const quota = Math.max(0, Math.min(100, numberValue(group.quota, 0)));
    return `<tr class="${selected}" data-group-id="${escapeHtml(group.id)}" tabindex="0">
      <td>${escapeHtml(group.name)}</td>
      <td>${escapeHtml(group.account)}</td>
      <td><span class="token-status"><i class="status-dot ${tokenClass(group.token)}"></i>${escapeHtml(tokenLabel(group.token))}</span></td>
      <td>${permission}</td>
      <td>${renderSchedule(group)}</td>
      <td><span class="quota-cell"><span>${quota}%</span><span class="quota-mini-bar"><i style="width:${Math.min(100, quota * 5)}%"></i></span></span></td>
      <td>${escapeHtml(group.lastActivity)}</td>
      <td><button class="row-menu-button" type="button" data-row-menu="${escapeHtml(group.id)}" aria-label="Abrir detalhes de ${escapeHtml(group.name)}"><i class="ph ph-dots-three-vertical" aria-hidden="true"></i></button></td>
    </tr>`;
  }

  function renderPagination(pageCount) {
    const pages = $("#groups-pagination-pages");
    if (!pages) return;
    pages.innerHTML = Array.from({ length: pageCount }, (_, index) => {
      const page = index + 1;
      return `<button class="page-button${page === state.page ? " is-active" : ""}" type="button" data-page-number="${page}">${page}</button>`;
    }).join("");
  }

  function renderTable() {
    const body = $("#groups-table-body");
    if (state.loading) {
      body.innerHTML = '<tr><td colspan="8" class="groups-empty-state">Carregando grupos reais…</td></tr>';
      $("#groups-pagination-label").textContent = "Carregando…";
      renderPagination(1);
      return;
    }
    if (state.error) {
      body.innerHTML = `<tr><td colspan="8" class="groups-empty-state">${escapeHtml(state.error)}</td></tr>`;
      $("#groups-pagination-label").textContent = "Não foi possível carregar os grupos";
      renderPagination(1);
      return;
    }
    const list = filteredGroups();
    const pageCount = Math.max(1, Math.ceil(list.length / state.pageSize));
    state.page = Math.min(state.page, pageCount);
    const start = (state.page - 1) * state.pageSize;
    const rows = list.slice(start, start + state.pageSize);
    body.innerHTML = rows.length
      ? rows.map(renderGroupRow).join("")
      : '<tr><td colspan="8" class="groups-empty-state">Nenhum grupo encontrado com esses filtros.</td></tr>';
    const first = list.length ? start + 1 : 0;
    const last = Math.min(start + rows.length, list.length);
    $("#groups-pagination-label").textContent = `Mostrando ${first} a ${last} de ${list.length} grupos`;
    $("#groups-page-prev").disabled = state.page <= 1;
    $("#groups-page-next").disabled = state.page >= pageCount;
    renderPagination(pageCount);
  }

  function renderPending() {
    const body = $("#pending-table-body");
    body.innerHTML = pendingRequests.length
      ? pendingRequests.map((request) => `<tr>
        <td>${escapeHtml(request.group)}</td>
        <td>${escapeHtml(request.requestedBy)}</td>
        <td><span class="pending-slot"><i class="ph ph-calendar-blank" aria-hidden="true"></i>${escapeHtml(request.slot)}</span></td>
        <td>${request.quota}%</td>
        <td><span class="pending-status"><i class="status-dot"></i>Aguardando aprovação</span></td>
        <td><button class="pending-action" type="button" data-pending-group="${escapeHtml(request.groupId)}">Ver solicitação</button></td>
      </tr>`).join("")
      : `<tr><td colspan="6" class="groups-empty-state">${state.loading ? "Carregando solicitações…" : "Nenhuma solicitação pendente."}</td></tr>`;
    const count = $("#pending-all-count");
    if (count) count.textContent = `(${pendingRequests.length})`;
  }

  function renderDetail() {
    const group = findGroup(state.selectedId);
    if (!group) return;
    state.selectedId = group.id;
    $("#group-detail-title").textContent = group.name;
    const status = $("#group-detail-status");
    status.textContent = statusLabel(group.token);
    status.className = `group-status-pill ${statusPillClass(group.token)}`;
    $("#detail-account").textContent = group.account;
    $("#detail-members").textContent = `${group.users.length} usuário${group.users.length === 1 ? "" : "s"}`;
    $("#detail-token").innerHTML = `<span class="detail-status-dot ${group.token === "disabled" ? "is-disabled" : group.token === "inactive" ? "is-inactive" : "is-active"}"></span>${escapeHtml(tokenLabel(group.token))}`;
    $("#detail-permission").innerHTML = group.permission === "allowed"
      ? '<span class="permission-pill is-allowed">Pode agendar</span>'
      : '<span class="permission-pill is-blocked">Bloqueado</span>';
    if (group.schedule.type === "active") {
      $("#detail-session").innerHTML = `<span class="detail-status-dot is-active"></span><span><strong>${escapeHtml(group.schedule.label)}</strong><small>${escapeHtml(group.schedule.time || "")}</small></span>`;
    } else if (group.schedule.type === "none") {
      $("#detail-session").innerHTML = '<span class="detail-status-dot"></span><span><strong class="detail-muted-value">Sem sessão ativa</strong><small>Sem próximo agendamento</small></span>';
    } else {
      $("#detail-session").innerHTML = `<span class="detail-status-dot ${group.schedule.type === "pending" ? "is-inactive" : ""}"></span><span><strong class="detail-upcoming-value">${escapeHtml(group.schedule.label)}</strong><small>${escapeHtml(group.schedule.time || "Aguardando decisão")}</small></span>`;
    }
    const quota = Math.max(0, Math.min(100, numberValue(group.quota, 0)));
    $("#detail-quota").innerHTML = `<span>${quota}%</span><span class="detail-quota-bar"><i style="width:${Math.min(100, quota * 5)}%"></i></span>`;
    $("#detail-last-activity").textContent = group.lastActivity;
    const history = state.detailHistoryExpanded ? group.history : group.history.slice(0, 3);
    $("#recent-history-list").innerHTML = history.length
      ? history.map((item) => `<li><span class="history-icon ${item.tone}"><i class="ph ${item.icon}" aria-hidden="true"></i></span><p><span>${escapeHtml(item.title)}</span><small>${escapeHtml(item.note)}</small></p><time>${escapeHtml(item.time)}</time></li>`).join("")
      : '<li class="history-empty">Nenhuma atividade registrada para este grupo.</li>';
    const historyButton = $("#full-history-button");
    if (historyButton) historyButton.textContent = state.detailHistoryExpanded ? "Mostrar resumo" : "Ver histórico completo";
  }

  function renderAll() {
    renderStats();
    renderTable();
    renderPending();
    renderDetail();
  }

  function showToast(message, kind = "") {
    const toast = $("#groups-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.className = `admin-toast is-visible${kind ? ` is-${kind}` : ""}`;
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2800);
  }

  function setFilterPanel(open) {
    const panel = $("#groups-filter-panel");
    const toggle = $("#groups-filter-toggle");
    if (!panel || !toggle) return;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  }

  function openGroupDetailModal() {
    const group = findGroup(state.selectedId);
    const dialog = $("#group-detail-modal");
    if (!group || !dialog) return;
    state.detailHistoryExpanded = false;
    renderDetail();
    if (dialog.open) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeGroupDetailModal() {
    const dialog = $("#group-detail-modal");
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
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
    if (!token) return false;
    const check = () => fetch("/api/admin/session", {
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

  async function adminRequest(path) {
    if (!window.FecartApi?.admin) throw new Error("Cliente da API administrativa indisponível.");
    const result = await window.FecartApi.admin(path);
    if (!result) throw new Error("Sessão administrativa ausente.");
    return result;
  }

  async function loadLiveData() {
    state.loading = true;
    state.error = "";
    renderAll();
    try {
      const [accountsResult, usersResult, reservationsResult, devicesResult] = await Promise.all([
        adminRequest("/api/admin/accounts"),
        adminRequest("/api/admin/users"),
        adminRequest("/api/admin/reservations"),
        adminRequest("/api/admin/devices"),
      ]);
      const accountRows = Array.isArray(accountsResult?.accounts) ? accountsResult.accounts : [];
      const userRows = Array.isArray(usersResult?.users) ? usersResult.users : [];
      const reservationRows = Array.isArray(reservationsResult?.reservations) ? reservationsResult.reservations : [];
      const deviceRows = Array.isArray(devicesResult?.devices) ? devicesResult.devices : [];
      const previousId = state.selectedId;
      groups = buildLiveGroups(accountRows, userRows, reservationRows, deviceRows);
      pendingRequests = groups.flatMap((group) => group.pendingRequests);
      state.selectedId = groups.some((group) => group.id === previousId) ? previousId : groups[0]?.id || null;
      state.page = 1;
      state.live = true;
    } catch (error) {
      groups = [];
      pendingRequests = [];
      state.selectedId = null;
      state.live = false;
      state.error = error instanceof Error ? error.message : "Não foi possível carregar os grupos reais.";
    } finally {
      state.loading = false;
      renderAll();
    }
  }

  function exportGroups() {
    if (!groups.length) {
      showToast("Não há grupos reais para exportar.", "error");
      return;
    }
    const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [
      ["Grupo", "Conta", "Usuários", "Status do token", "Permissão", "Agendamento", "Quota", "Última atividade"],
      ...groups.map((group) => [
        group.name,
        group.account,
        group.users.length,
        tokenLabel(group.token),
        group.permission === "allowed" ? "Pode agendar" : "Bloqueado",
        `${group.schedule.label} ${group.schedule.time}`.trim(),
        `${group.quota}%`,
        group.lastActivity,
      ]),
    ];
    const blob = new Blob([`\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `grupos-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("Exportação dos grupos reais preparada.");
  }

  async function logout() {
    try {
      const config = await window.RemoteCodexAuth?.loadConfig?.();
      if (config) await window.RemoteCodexAuth?.signOut?.(config);
    } catch {
      window.RemoteCodexAuth?.clearSession?.();
    } finally {
      window.location.replace("/login");
    }
  }

  function bindEvents() {
    $("#groups-search")?.addEventListener("input", (event) => {
      state.search = event.currentTarget.value || "";
      state.page = 1;
      renderTable();
    });

    $("#groups-status")?.addEventListener("change", (event) => {
      state.status = event.currentTarget.value;
      state.page = 1;
      renderTable();
    });

    $("#groups-filter-toggle")?.addEventListener("click", () => setFilterPanel($("#groups-filter-panel").hidden));

    $$('input[type="checkbox"][value]', $("#groups-filter-panel")).forEach((checkbox) => checkbox.addEventListener("change", () => {
      state.allowedTokens = new Set($$('input[type="checkbox"][value]:checked', $("#groups-filter-panel")).map((input) => input.value));
      state.status = "all";
      $("#groups-status").value = "all";
      state.page = 1;
      renderTable();
    }));

    $("#groups-filter-clear")?.addEventListener("click", () => {
      state.allowedTokens = new Set(["active", "inactive", "disabled"]);
      state.status = "all";
      $("#groups-status").value = "all";
      $$('input[type="checkbox"][value]', $("#groups-filter-panel")).forEach((checkbox) => { checkbox.checked = true; });
      state.page = 1;
      renderTable();
      showToast("Filtros limpos.");
    });

    $("#groups-table-body")?.addEventListener("click", (event) => {
      const row = event.target.closest("[data-group-id]");
      if (!row) return;
      state.selectedId = row.dataset.groupId;
      openGroupDetailModal();
      renderTable();
    });

    $("#groups-table-body")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const row = event.target.closest("[data-group-id]");
      if (!row) return;
      event.preventDefault();
      state.selectedId = row.dataset.groupId;
      openGroupDetailModal();
      renderTable();
    });

    $("#groups-page-prev")?.addEventListener("click", () => {
      state.page = Math.max(1, state.page - 1);
      renderTable();
    });

    $("#groups-page-next")?.addEventListener("click", () => {
      const pageCount = Math.max(1, Math.ceil(filteredGroups().length / state.pageSize));
      state.page = Math.min(pageCount, state.page + 1);
      renderTable();
    });

    $("#groups-pagination-pages")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-page-number]");
      if (!button) return;
      state.page = Number(button.dataset.pageNumber);
      renderTable();
    });

    $("#pending-table-body")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-pending-group]");
      if (!button) return;
      state.selectedId = button.dataset.pendingGroup;
      openGroupDetailModal();
    });

    $("#pending-all-button")?.addEventListener("click", () => {
      $(".pending-groups-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    $("#full-history-button")?.addEventListener("click", () => {
      state.detailHistoryExpanded = !state.detailHistoryExpanded;
      renderDetail();
    });

    $("#export-groups-button")?.addEventListener("click", exportGroups);
    $("#detail-refresh-button")?.addEventListener("click", async () => {
      await loadLiveData();
      if (findGroup(state.selectedId)) openGroupDetailModal();
    });
    $("#detail-requests-button")?.addEventListener("click", () => {
      const group = findGroup(state.selectedId);
      closeGroupDetailModal();
      $(".pending-groups-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
      showToast(group ? `Solicitações de ${group.name} exibidas abaixo.` : "Solicitações exibidas abaixo.");
    });
    $$('[data-close-group-detail-modal]').forEach((button) => button.addEventListener("click", closeGroupDetailModal));

    $("#group-detail-modal")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeGroupDetailModal();
    });

    $$('[data-section]').forEach((button) => button.addEventListener("click", () => {
      const section = button.dataset.section;
      if (section === "overview") {
        window.location.replace("/admin");
        return;
      }
      if (section === "groups") return;
      showToast("Esta área de telemetria estará disponível em breve.");
    }));

    $(".sidebar-collapse")?.addEventListener("click", () => $(".admin-shell")?.classList.toggle("is-collapsed"));
    $("[data-admin-logout]")?.addEventListener("click", logout);

    document.addEventListener("click", (event) => {
      if (!event.target.closest("#groups-filter-panel, #groups-filter-toggle")) setFilterPanel(false);
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
    await loadLiveData();
  });
})();

export {};
