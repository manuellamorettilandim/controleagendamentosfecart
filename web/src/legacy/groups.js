(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const groups = [
    {
      id: "group-2",
      name: "Grupo 2",
      account: "Conta 1",
      token: "active",
      permission: "allowed",
      schedule: { type: "active", label: "Sessão ativa hoje", time: "10:00 – 11:30" },
      quota: 12,
      lastActivity: "Hoje 11:20",
      activeSession: true,
      history: [
        { icon: "ph-check-circle", tone: "", title: "Sessão iniciada", note: "Hoje 10:00 por Renan", time: "10:00" },
        { icon: "ph-calendar-blank", tone: "is-blue", title: "Agendamento criado", note: "Ontem 18:32 por Renan", time: "18:32" },
        { icon: "ph-prohibit", tone: "is-amber", title: "Solicitação de agendamento aprovada", note: "Ontem 16:10 por Professor", time: "16:10" },
      ],
    },
    {
      id: "group-5",
      name: "Grupo 5",
      account: "Conta 2",
      token: "inactive",
      permission: "allowed",
      schedule: { type: "tomorrow", label: "Próximo: Amanhã", time: "14:00 – 15:00" },
      quota: 8,
      lastActivity: "Hoje 10:45",
      history: [
        { icon: "ph-calendar-blank", tone: "is-blue", title: "Agendamento criado", note: "Hoje 09:15 por Admin auxiliar", time: "09:15" },
        { icon: "ph-user-circle", tone: "is-amber", title: "Token colocado em espera", note: "Ontem 17:42 por Administrador", time: "17:42" },
      ],
    },
    {
      id: "group-7",
      name: "Grupo 7",
      account: "Conta 3",
      token: "disabled",
      permission: "blocked",
      schedule: { type: "none", label: "Sem agendamento", time: "" },
      quota: 0,
      lastActivity: "Hoje 09:58",
      history: [
        { icon: "ph-lock-key", tone: "is-amber", title: "Token desabilitado", note: "Hoje 09:58 por Administrador", time: "09:58" },
        { icon: "ph-prohibit", tone: "is-amber", title: "Agendamento bloqueado", note: "Hoje 09:58 por Administrador", time: "09:58" },
      ],
    },
    {
      id: "group-3",
      name: "Grupo 3",
      account: "Conta 1",
      token: "active",
      permission: "allowed",
      schedule: { type: "upcoming", label: "Próximo: Hoje", time: "16:00 – 17:00" },
      quota: 5,
      lastActivity: "Ontem 18:32",
      history: [
        { icon: "ph-calendar-blank", tone: "is-blue", title: "Próximo agendamento criado", note: "Hoje 08:12 por Renan", time: "08:12" },
        { icon: "ph-check-circle", tone: "", title: "Token ativado", note: "Ontem 18:32 por Administrador", time: "18:32" },
      ],
    },
    {
      id: "group-8",
      name: "Grupo 8",
      account: "Conta 2",
      token: "inactive",
      permission: "allowed",
      schedule: { type: "pending", label: "Solicitação pendente", time: "" },
      quota: 10,
      lastActivity: "Ontem 16:10",
      history: [
        { icon: "ph-clock", tone: "is-amber", title: "Solicitação recebida", note: "Ontem 16:10 por Professor", time: "16:10" },
        { icon: "ph-calendar-blank", tone: "is-blue", title: "Agenda consultada", note: "Ontem 15:58 por Professor", time: "15:58" },
      ],
    },
    {
      id: "group-1",
      name: "Grupo 1",
      account: "Conta 1",
      token: "active",
      permission: "allowed",
      schedule: { type: "none", label: "Sem agendamento", time: "" },
      quota: 7,
      lastActivity: "Ontem 15:05",
      history: [
        { icon: "ph-check-circle", tone: "", title: "Token ativado", note: "Ontem 15:05 por Administrador", time: "15:05" },
      ],
    },
    {
      id: "group-4",
      name: "Grupo 4",
      account: "Conta 3",
      token: "active",
      permission: "allowed",
      schedule: { type: "upcoming", label: "Próximo: 16/05", time: "09:00 – 10:30" },
      quota: 6,
      lastActivity: "Ontem 12:20",
      activeSession: true,
      history: [
        { icon: "ph-calendar-blank", tone: "is-blue", title: "Agendamento criado", note: "Ontem 12:20 por Renan", time: "12:20" },
      ],
    },
    {
      id: "group-6",
      name: "Grupo 6",
      account: "Conta 3",
      token: "active",
      permission: "allowed",
      schedule: { type: "upcoming", label: "Próximo: Hoje", time: "12:00 – 13:00" },
      quota: 9,
      lastActivity: "Ontem 11:45",
      activeSession: true,
      history: [],
    },
    {
      id: "group-9",
      name: "Grupo 9",
      account: "Conta 1",
      token: "active",
      permission: "allowed",
      schedule: { type: "upcoming", label: "Próximo: 17/05", time: "11:00 – 12:00" },
      quota: 11,
      lastActivity: "Ontem 10:18",
      activeSession: true,
      history: [],
    },
    {
      id: "group-10",
      name: "Grupo 10",
      account: "Conta 2",
      token: "inactive",
      permission: "allowed",
      schedule: { type: "upcoming", label: "Próximo: 18/05", time: "15:00 – 16:00" },
      quota: 4,
      lastActivity: "12/05 17:20",
      history: [],
    },
    {
      id: "group-11",
      name: "Grupo 11",
      account: "Conta 3",
      token: "active",
      permission: "allowed",
      schedule: { type: "none", label: "Sem agendamento", time: "" },
      quota: 3,
      lastActivity: "12/05 15:42",
      history: [],
    },
    {
      id: "group-12",
      name: "Grupo 12",
      account: "Conta 2",
      token: "disabled",
      permission: "blocked",
      schedule: { type: "none", label: "Sem agendamento", time: "" },
      quota: 0,
      lastActivity: "12/05 11:03",
      history: [],
    },
  ];

  const pendingRequests = [
    { id: "request-8", groupId: "group-8", group: "Grupo 8", requestedBy: "Professor", slot: "15/05/2025 13:30 – 15:00", quota: 15 },
    { id: "request-5", groupId: "group-5", group: "Grupo 5", requestedBy: "Admin auxiliar", slot: "15/05/2025 16:00 – 17:30", quota: 12 },
    { id: "request-3", groupId: "group-3", group: "Grupo 3", requestedBy: "Renan", slot: "16/05/2025 10:00 – 11:30", quota: 10 },
  ];

  const state = {
    selectedId: "group-2",
    page: 1,
    pageSize: 7,
    search: "",
    status: "all",
    allowedTokens: new Set(["active", "inactive", "disabled"]),
    toastTimer: null,
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
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

  function findGroup(id) {
    return groups.find((group) => group.id === id) || groups[0];
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
    const upcoming = groups.filter((group) => group.schedule.type === "upcoming" || group.schedule.type === "tomorrow").length;
    const blocked = groups.filter((group) => group.token === "disabled").length;
    $("#groups-total-count").textContent = String(groups.length);
    $("#groups-active-count").textContent = String(activeSessions);
    $("#groups-upcoming-count").textContent = String(upcoming);
    $("#groups-blocked-count").textContent = String(blocked);
  }

  function renderSchedule(group) {
    const schedule = group.schedule;
    if (schedule.type === "none") return '<div class="schedule-cell"><span>Sem agendamento</span></div>';
    const tone = schedule.type === "active" ? "is-active" : schedule.type === "pending" || schedule.type === "tomorrow" ? "is-pending" : "is-upcoming";
    return `<div class="schedule-cell ${tone}"><span>${escapeHtml(schedule.label)}</span>${schedule.time ? `<small>${escapeHtml(schedule.time)}</small>` : ""}</div>`;
  }

  function renderGroupRow(group) {
    const selected = state.selectedId === group.id ? " is-selected" : "";
    const permission = group.permission === "allowed"
      ? '<span class="permission-pill">Pode agendar</span>'
      : '<span class="permission-pill is-blocked">Bloqueado</span>';
    return `<tr class="${selected}" data-group-id="${escapeHtml(group.id)}" tabindex="0">
      <td>${escapeHtml(group.name)}</td>
      <td>${escapeHtml(group.account)}</td>
      <td><span class="token-status"><i class="status-dot ${tokenClass(group.token)}"></i>${escapeHtml(tokenLabel(group.token))}</span></td>
      <td>${permission}</td>
      <td>${renderSchedule(group)}</td>
      <td><span class="quota-cell"><span>${group.quota}%</span><span class="quota-mini-bar"><i style="width:${Math.min(100, group.quota * 5)}%"></i></span></span></td>
      <td>${escapeHtml(group.lastActivity)}</td>
      <td><button class="row-menu-button" type="button" data-row-menu="${escapeHtml(group.id)}" aria-label="Ações de ${escapeHtml(group.name)}"><i class="ph ph-dots-three-vertical" aria-hidden="true"></i></button></td>
    </tr>`;
  }

  function renderTable() {
    const list = filteredGroups();
    const pageCount = Math.max(1, Math.ceil(list.length / state.pageSize));
    state.page = Math.min(state.page, pageCount);
    const start = (state.page - 1) * state.pageSize;
    const rows = list.slice(start, start + state.pageSize);
    const body = $("#groups-table-body");
    body.innerHTML = rows.length
      ? rows.map(renderGroupRow).join("")
      : '<tr><td colspan="8" class="groups-empty-state">Nenhum grupo encontrado com esses filtros.</td></tr>';
    const first = list.length ? start + 1 : 0;
    const last = Math.min(start + rows.length, list.length);
    $("#groups-pagination-label").textContent = `Mostrando ${first} a ${last} de ${list.length} grupos`;
    $("#groups-page-prev").disabled = state.page <= 1;
    $("#groups-page-next").disabled = state.page >= pageCount;
    $$('[data-page-number]').forEach((button) => {
      const page = Number(button.dataset.pageNumber);
      button.classList.toggle("is-active", page === state.page);
      button.disabled = page > pageCount;
    });
  }

  function renderPending() {
    $("#pending-table-body").innerHTML = pendingRequests.map((request) => `<tr>
      <td>${escapeHtml(request.group)}</td>
      <td>${escapeHtml(request.requestedBy)}</td>
      <td><span class="pending-slot"><i class="ph ph-calendar-blank" aria-hidden="true"></i>${escapeHtml(request.slot)}</span></td>
      <td>${request.quota}%</td>
      <td><span class="pending-status"><i class="status-dot"></i>Aguardando aprovação</span></td>
      <td><button class="pending-action" type="button" data-pending-group="${escapeHtml(request.groupId)}">Ver solicitação</button></td>
    </tr>`).join("");
  }

  function renderDetail() {
    const group = findGroup(state.selectedId);
    state.selectedId = group.id;
    $("#group-detail-title").textContent = group.name;
    const status = $("#group-detail-status");
    status.textContent = statusLabel(group.token);
    status.className = `group-status-pill ${statusPillClass(group.token)}`;
    $("#detail-account").textContent = group.account;
    $("#detail-token").innerHTML = `<span class="detail-status-dot ${group.token === "disabled" ? "is-disabled" : group.token === "inactive" ? "is-inactive" : "is-active"}"></span>${escapeHtml(tokenLabel(group.token))}`;
    $("#detail-permission").innerHTML = group.permission === "allowed"
      ? '<span class="permission-pill is-allowed">Pode agendar</span>'
      : '<span class="permission-pill is-blocked">Bloqueado</span>';
    if (group.schedule.type === "active") {
      $("#detail-session").innerHTML = `<span class="detail-status-dot is-active"></span><span><strong>${escapeHtml(group.schedule.label)}</strong><small>${escapeHtml(group.schedule.time)}</small></span>`;
    } else if (group.schedule.type === "none") {
      $("#detail-session").innerHTML = '<span class="detail-status-dot"></span><span><strong class="detail-muted-value">Sem sessão ativa</strong><small>Sem próximo agendamento</small></span>';
    } else {
      $("#detail-session").innerHTML = `<span class="detail-status-dot ${group.schedule.type === "pending" ? "is-inactive" : ""}"></span><span><strong class="detail-upcoming-value">${escapeHtml(group.schedule.label)}</strong><small>${escapeHtml(group.schedule.time || "Aguardando decisão")}</small></span>`;
    }
    $("#detail-quota").innerHTML = `<span>${group.quota}%</span><span class="detail-quota-bar"><i style="width:${Math.min(100, group.quota * 5)}%"></i></span>`;
    $("#detail-last-activity").textContent = group.lastActivity;
    $("#recent-history-list").innerHTML = group.history.length
      ? group.history.slice(0, 3).map((item) => `<li><span class="history-icon ${item.tone}"><i class="ph ${item.icon}" aria-hidden="true"></i></span><p><span>${escapeHtml(item.title)}</span><small>${escapeHtml(item.note)}</small></p><time>${escapeHtml(item.time)}</time></li>`).join("")
      : '<li class="history-empty">Nenhuma ação recente registrada.</li>';
    const disableButton = $("#detail-disable-button");
    disableButton.querySelector("span").textContent = group.token === "disabled" ? "Reativar token" : "Desabilitar token";
    disableButton.classList.toggle("is-reenable", group.token === "disabled");
    $("#detail-block-button span").textContent = group.permission === "blocked" ? "Desbloquear agendamento" : "Bloquear agendamento";
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
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  }

  function setNotificationPopover(open) {
    const popover = $("#groups-notification-popover");
    const toggle = $("#groups-notifications");
    popover.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  }

  function openGroupModal() {
    const dialog = $("#group-modal");
    const nextNumber = groups.length + 1;
    $("#new-group-name").value = `Grupo ${nextNumber}`;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeGroupModal() {
    const dialog = $("#group-modal");
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  async function logout() {
    try {
      const config = await window.RemoteCodexAuth?.loadConfig?.();
      if (config) await window.RemoteCodexAuth?.signOut?.(config);
    } catch {
      window.RemoteCodexAuth?.clearSession?.();
    } finally {
      window.location.replace("/login.html");
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

    $("#groups-filter-toggle")?.addEventListener("click", () => {
      setFilterPanel($("#groups-filter-panel").hidden);
    });

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

    $("#groups-notifications")?.addEventListener("click", () => setNotificationPopover($("#groups-notification-popover").hidden));
    $("[data-close-notifications]")?.addEventListener("click", () => setNotificationPopover(false));

    $("#groups-table-body")?.addEventListener("click", (event) => {
      const menu = event.target.closest("[data-row-menu]");
      const row = event.target.closest("[data-group-id]");
      if (!row) return;
      state.selectedId = row.dataset.groupId;
      if (menu) {
        renderAll();
        showToast(`Ações de ${findGroup(state.selectedId).name} selecionadas.`);
        return;
      }
      renderAll();
    });

    $("#groups-table-body")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const row = event.target.closest("[data-group-id]");
      if (!row) return;
      event.preventDefault();
      state.selectedId = row.dataset.groupId;
      renderAll();
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

    $$('[data-page-number]').forEach((button) => button.addEventListener("click", () => {
      state.page = Number(button.dataset.pageNumber);
      renderTable();
    }));

    $("#pending-table-body")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-pending-group]");
      if (!button) return;
      state.selectedId = button.dataset.pendingGroup;
      renderAll();
      showToast(`Solicitação de ${findGroup(state.selectedId).name} selecionada.`);
    });

    $("#pending-all-button")?.addEventListener("click", () => showToast("As 3 solicitações pendentes estão exibidas nesta lista."));
    $("#full-history-button")?.addEventListener("click", () => showToast(`Histórico completo de ${findGroup(state.selectedId).name} disponível para consulta.`));
    $("#export-groups-button")?.addEventListener("click", () => showToast("Exportação dos grupos preparada."));
    $("#new-group-button")?.addEventListener("click", openGroupModal);
    $$('[data-close-group-modal]').forEach((button) => button.addEventListener("click", closeGroupModal));

    $("#group-modal")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeGroupModal();
    });

    $("#group-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = $("#new-group-name").value.trim() || `Grupo ${groups.length + 1}`;
      const account = $("#new-group-account").value;
      const id = `group-${Date.now()}`;
      groups.push({
        id,
        name,
        account,
        token: "active",
        permission: "allowed",
        schedule: { type: "none", label: "Sem agendamento", time: "" },
        quota: 0,
        lastActivity: "Agora",
        history: [{ icon: "ph-plus-circle", tone: "is-blue", title: "Grupo criado", note: "Agora por Administrador", time: "agora" }],
      });
      state.selectedId = id;
      state.page = Math.ceil(groups.length / state.pageSize);
      closeGroupModal();
      renderAll();
      showToast(`${name} criado com sucesso.`);
    });

    $("#detail-disable-button")?.addEventListener("click", () => {
      const group = findGroup(state.selectedId);
      group.token = group.token === "disabled" ? "active" : "disabled";
      if (group.token === "disabled") group.permission = "blocked";
      renderAll();
      showToast(group.token === "disabled" ? `Token de ${group.name} desabilitado.` : `Token de ${group.name} reativado.`);
    });

    $("#detail-block-button")?.addEventListener("click", () => {
      const group = findGroup(state.selectedId);
      group.permission = group.permission === "blocked" ? "allowed" : "blocked";
      renderAll();
      showToast(group.permission === "blocked" ? `Agendamento bloqueado para ${group.name}.` : `Agendamento liberado para ${group.name}.`);
    });

    $("#detail-requests-button")?.addEventListener("click", () => {
      $(".pending-groups-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
      showToast(`Solicitações de ${findGroup(state.selectedId).name} exibidas abaixo.`);
    });

    $$('[data-section]').forEach((button) => button.addEventListener("click", () => {
      const section = button.dataset.section;
      if (section === "overview") {
        window.location.replace("/admin.html");
        return;
      }
      if (section === "groups") return;
      showToast("Esta área de telemetria estará disponível em breve.");
    }));

    $(".sidebar-collapse")?.addEventListener("click", () => $(".admin-shell")?.classList.toggle("is-collapsed"));
    $("[data-admin-logout]")?.addEventListener("click", logout);

    document.addEventListener("click", (event) => {
      if (!event.target.closest(".groups-notification-anchor")) setNotificationPopover(false);
      if (!event.target.closest("#groups-filter-panel, #groups-filter-toggle")) setFilterPanel(false);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    renderAll();
  });
})();

export {};
