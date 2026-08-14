(() => {
  "use strict";

  const state = {
    config: null,
    user: null,
    role: "",
    accounts: [],
    devices: [],
    users: [],
    reservations: [],
    issuedToken: "",
    issuedDevice: null,
    loginAccountId: "",
    editingDeviceId: null,
    pendingAction: null,
    adminWeekStart: null,
    adminCalendar: null,
  };

  const $ = (selector) => document.querySelector(selector);
  const statusBox = $("#global-status");

  function setStatus(message, kind = "") {
    statusBox.textContent = message || "";
    statusBox.className = `admin-status ${kind}`.trim();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
  }

  function formatDate(value) {
    if (!value) return "indisponível";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "indisponível" : date.toLocaleString("pt-BR");
  }

  function formatReset(value) {
    if (value === null || value === undefined) return "reset indisponível";
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "reset indisponível";
    const millis = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    return formatDate(new Date(millis).toISOString());
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString("pt-BR");
  }

  function formatDuration(minutes) {
    const value = Number(minutes);
    if (!Number.isFinite(value) || value <= 0) return "indisponível";
    if (value >= 1_440 && value % 1_440 === 0) return `${value / 1_440}d`;
    if (value >= 60 && value % 60 === 0) return `${value / 60}h`;
    return `${value}min`;
  }

  function accountById(accountId) {
    return state.accounts.find((account) => account.accountId === accountId) || null;
  }

  function weeklyWindow(account) {
    if (!account) return null;
    const windows = Object.values(account.rateLimits || {}).flatMap((limit) => [limit.primary, limit.secondary]).filter(Boolean);
    return windows.sort((left, right) => Number(right.windowDurationMins || 0) - Number(left.windowDurationMins || 0))[0] || null;
  }

  function statusLabel(status) {
    return ({ active: "ativo", disabled: "desabilitado", limited: "limite atingido", revoked: "revogado", expired: "expirado" }[status] || status || "indisponível");
  }

  function accountStatusLabel(status) {
    return ({ ready: "pronta", login_required: "login necessário", offline: "offline", disabled: "desativada", error: "erro" }[status] || status || "indisponível");
  }

  function statusClass(status) {
    return status === "active" ? "success" : status === "disabled" ? "warning" : status === "limited" ? "warning" : "error";
  }

  function toDateTimeLocal(value) {
    const date = value ? new Date(value) : new Date(Date.now() + 30 * 24 * 60 * 60_000);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function fromDateTimeLocal(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function remoteWebSocketAddress() {
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    return `${scheme}://${host || `${window.location.hostname}:443`}`;
  }

  async function copyText(value, successMessage) {
    try {
      await navigator.clipboard.writeText(value);
      $("#copy-status").textContent = successMessage;
      $("#copy-status").className = "admin-status success";
    } catch {
      $("#issued-token").focus();
      $("#issued-token").select();
      $("#copy-status").textContent = "Não foi possível copiar automaticamente; selecione o conteúdo manualmente.";
      $("#copy-status").className = "admin-status warning";
    }
  }

  function redirectToLogin(expired = false) {
    window.location.replace(expired ? "/login?expired=1" : "/login");
  }

  async function api(path, options = {}, allowRefresh = true) {
    const auth = window.RemoteCodexAuth;
    let session = auth.getSession();
    if (!session?.access_token) {
      redirectToLogin();
      throw new Error("Sessão administrativa ausente.");
    }
    const headers = { Accept: "application/json", ...(options.body === undefined ? {} : { "Content-Type": "application/json" }), ...(options.headers || {}), Authorization: `Bearer ${session.access_token}` };
    const response = await fetch(path, { ...options, headers, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && allowRefresh && session.refresh_token) {
      try {
        session = await auth.refreshSession(state.config);
        return api(path, options, false);
      } catch {
        auth.clearSession();
        redirectToLogin(true);
        throw new Error("Sua sessão expirou. Entre novamente.");
      }
    }
    if (response.status === 401) {
      auth.clearSession();
      redirectToLogin(true);
      throw new Error("Sua sessão expirou. Entre novamente.");
    }
    if (response.status === 403) throw new Error(data.error || "Usuário autenticado, mas sem permissão para esta ação.");
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }

  async function showApp() {
    state.user = window.RemoteCodexAuth.getSession()?.user || null;
    $("#session-email").textContent = state.user?.email || "usuário autorizado";
    await refreshAll();
  }

  async function refreshAll() {
    setStatus("Atualizando estado do host…");
    try {
      const [accounts, devices] = await Promise.all([
        api("/api/admin/accounts"),
        api("/api/admin/devices"),
      ]);
      state.role = accounts.role || state.role || "admin";
      $("#session-role").textContent = state.role;
      $("#admins-tab").hidden = state.role !== "owner";
      state.accounts = accounts.accounts || [];
      renderAccounts(accounts);
      state.devices = devices.devices || [];
      renderDevices(devices);
      await Promise.all([
        state.role === "owner" ? loadAdmins() : Promise.resolve(),
        loadUsers(),
      ]);
      await loadReservations();
      renderOverview(accounts, devices);
      setStatus(accounts.stale ? "Host offline ou snapshot stale; os dados exibidos não garantem estado atual." : "Host conectado e sincronizado.", accounts.stale ? "warning" : "success");
    } catch (error) {
      setStatus(error.message, "error");
      throw error;
    }
  }

  function renderAccounts(payload) {
    const grid = $("#accounts-grid");
    if (!state.accounts.length) {
      grid.innerHTML = `<div class="admin-empty">Nenhuma conta foi sincronizada. Adicione a primeira conta pelo painel.</div>`;
      return;
    }
    grid.innerHTML = state.accounts.map((account) => {
      const limits = Object.values(account.rateLimits || {});
      const limitMarkup = limits.length ? limits.flatMap((rateLimit) => [[rateLimit, "principal", rateLimit.primary], [rateLimit, "secundária", rateLimit.secondary]]).filter(([, , window]) => window).map(([rateLimit, windowLabel, window]) => {
        const percent = window.usedPercent === null || window.usedPercent === undefined ? null : Math.max(0, Math.min(100, Number(window.usedPercent)));
        const credits = window.credits && Object.keys(window.credits).length ? ` · créditos ${Object.values(window.credits).map((value) => String(value)).join("/")}` : "";
        return `<div class="limit-row"><div><strong>${escapeHtml(rateLimit.limitName || rateLimit.limitId)} · ${escapeHtml(windowLabel)}</strong><span>${percent === null ? "indisponível" : `${percent}% usado`}</span></div><div class="limit-track"><i style="width:${percent === null ? 0 : percent}%"></i></div><small>${window.windowDurationMins ? `${window.windowDurationMins} min · ` : ""}${formatReset(window.resetsAt)}${escapeHtml(credits)}</small></div>`;
      }).join("") : `<p class="admin-muted">Limites não retornados pelo app-server.</p>`;
      const usage = account.usage?.dailyUsageBuckets?.slice(-7) || [];
      const usageText = usage.length ? `${usage.length} dias observados · ${usage.reduce((total, bucket) => total + Number(bucket.tokens || 0), 0).toLocaleString("pt-BR")} tokens` : "uso diário indisponível";
      const status = account.status || "offline";
       const statusClassName = status === "ready" ? "success" : status === "login_required" ? "warning" : "error";
       return `<article class="admin-account-card ${account.isDefault ? "default" : ""}">
         <div class="admin-card-head"><div><span class="admin-badge ${statusClassName}">${escapeHtml(accountStatusLabel(status))}</span>${account.isDefault ? `<span class="admin-badge default-badge">padrão</span>` : ""}</div><button class="icon-button" type="button" data-refresh-account="${escapeHtml(account.accountId)}" title="Atualizar conta">↻</button></div>
         <h3>${escapeHtml(account.label)}</h3><p class="account-email">${escapeHtml(account.email || "email indisponível")} · ${escapeHtml(account.planType || "plano indisponível")}</p>
         <div class="limit-list">${limitMarkup}</div><p class="usage-summary">${escapeHtml(usageText)} · última atualização ${escapeHtml(formatDate(account.updatedAt))}</p>
         ${account.error ? `<p class="admin-inline-error">${escapeHtml(account.error)}</p>` : ""}
         <div class="admin-actions">${status === "ready" && !account.isDefault ? `<button class="admin-button small primary" type="button" data-default-account="${escapeHtml(account.accountId)}">Usar como padrão</button>` : ""}<button class="admin-button small ghost" type="button" data-login-account="${escapeHtml(account.accountId)}">${status === "ready" ? "Atualizar login" : "Iniciar login"}</button>${status === "ready" ? `<button class="admin-button small danger" type="button" data-logout-account="${escapeHtml(account.accountId)}">Sair</button>` : ""}${!account.isDefault ? `<button class="admin-button small danger" type="button" data-delete-account="${escapeHtml(account.accountId)}">Excluir conta</button>` : ""}</div>
       </article>`;
    }).join("");
    grid.querySelectorAll("[data-default-account]").forEach((button) => button.addEventListener("click", () => setDefault(button.dataset.defaultAccount)));
    grid.querySelectorAll("[data-login-account]").forEach((button) => button.addEventListener("click", () => startLogin(button.dataset.loginAccount, button)));
    grid.querySelectorAll("[data-refresh-account]").forEach((button) => button.addEventListener("click", () => refreshAccount(button.dataset.refreshAccount)));
    grid.querySelectorAll("[data-logout-account]").forEach((button) => button.addEventListener("click", () => requestAction("account-logout", button.dataset.logoutAccount)));
    grid.querySelectorAll("[data-delete-account]").forEach((button) => button.addEventListener("click", () => requestAction("account-remove", button.dataset.deleteAccount)));
  }

  function renderOverview(accountsPayload, devicesPayload) {
    const insights = $("#overview-insights");
    if (!insights) return;
    const now = Date.now();
    const readyAccounts = state.accounts.filter((account) => account.status === "ready").length;
    const activeDevices = state.devices.filter((device) => device.status === "active").length;
    const activeReservations = state.reservations.filter((item) => item.status === "scheduled" && Date.parse(item.starts_at) <= now && Date.parse(item.ends_at) > now).length;
    const hostReady = Boolean(accountsPayload?.ready && accountsPayload?.hostConnected);
    const upcoming = state.reservations
      .filter((item) => item.status === "scheduled" && Date.parse(item.ends_at) > now)
      .sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at))
      .slice(0, 5);
    const next = upcoming[0] || null;
    const nextStart = next ? new Date(next.starts_at) : null;
    const nextLabel = nextStart ? nextStart.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";
    const nextDateLabel = nextStart ? nextStart.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" }).replace(".", "") : "Nenhuma sessão futura";
    const hostLabel = hostReady ? "conectado e sincronizado" : accountsPayload?.stale ? "snapshot desatualizado" : "aguardando sincronização";
    const healthTitle = hostReady ? "Tudo pronto para operar" : "A operação pede revisão";

    const attention = [];
    const addAttention = (message, tab, tone = "warning") => attention.push({ message, tab, tone });
    if (accountsPayload?.stale || devicesPayload?.stale) addAttention("O snapshot está desatualizado; confirme a fonte antes de emitir acesso.", "accounts", "warning");
    state.accounts.filter((account) => account.status !== "ready").slice(0, 2).forEach((account) => addAttention(`${account.label}: ${accountStatusLabel(account.status)}.`, "accounts", "danger"));
    state.devices.filter((device) => ["limited", "disabled", "expired"].includes(device.status)).slice(0, 2).forEach((device) => addAttention(`${device.label}: acesso ${statusLabel(device.status)}.`, "devices", "danger"));
    state.devices.filter((device) => device.status === "active" && Date.parse(device.expiresAt) - now < 3 * 24 * 60 * 60_000).slice(0, 2).forEach((device) => addAttention(`${device.label}: expira em menos de três dias.`, "devices", "warning"));
    if (state.reservations.some((item) => item.status === "scheduled" && Date.parse(item.starts_at) <= now && Date.parse(item.ends_at) > now && !item.device_id)) addAttention("Existe uma sessão ativa sem credencial emitida.", "reservations", "warning");

    insights.innerHTML = `
      <section class="overview-health-panel" aria-labelledby="overview-health-title">
        <div class="overview-health-head"><div><h2 id="overview-health-title">Operação agora</h2><p>${escapeHtml(healthTitle)} · ${escapeHtml(hostLabel)}.</p></div><span class="overview-health-badge ${hostReady ? "success" : "warning"}"><i></i>${hostReady ? "Host online" : "Host offline"}</span></div>
        <div class="overview-health-stats">
          <div class="overview-health-stat overview-health-stat-primary"><span>Próxima sessão</span><strong>${nextLabel}</strong><small>${escapeHtml(nextDateLabel)}</small></div>
          <div class="overview-health-stat"><span>Contas prontas</span><strong>${readyAccounts}/${state.accounts.length}</strong><small>${state.accounts.length ? "autenticadas no host" : "nenhuma conta cadastrada"}</small></div>
          <div class="overview-health-stat"><span>Sessões ativas</span><strong>${activeReservations}</strong><small>${activeReservations ? "acompanhar agora" : "nenhuma em andamento"}</small></div>
          <div class="overview-health-stat"><span>Credenciais ativas</span><strong>${activeDevices}</strong><small>${state.devices.length ? `${state.devices.length} emitidas no histórico` : "nenhuma emitida"}</small></div>
        </div>
        <div class="overview-health-footer"><span><i></i>${accountsPayload?.stale ? "Última leitura pode estar desatualizada" : "Estado atualizado nesta sessão"}</span><div><button class="admin-button tiny ghost" type="button" data-overview-tab="reservations">Abrir agenda</button><button id="retry-overview" class="admin-button tiny ghost" type="button">Atualizar</button></div></div>
      </section>
      <section class="overview-queue-panel" aria-labelledby="overview-queue-title">
        <header><div><h2 id="overview-queue-title">Fila de ação</h2><p>Próximos bloqueios que merecem uma decisão.</p></div><span class="overview-queue-count">${attention.length}</span></header>
        <div id="overview-attention" class="overview-queue"></div>
      </section>
      <section class="overview-activity-panel" aria-labelledby="overview-activity-title">
        <header><div><h2 id="overview-activity-title">Próximas sessões</h2><p>Veja quem entra em seguida e se a credencial já foi emitida.</p></div><button class="admin-button tiny ghost" type="button" data-overview-tab="reservations">Ver agenda completa</button></header>
        <div id="overview-activity" class="overview-timeline"></div>
      </section>`;

    $("#overview-activity").innerHTML = upcoming.length ? upcoming.map((item) => {
      const profile = state.users.find((user) => user.user_id === item.user_id) || {};
      const start = new Date(item.starts_at);
      const end = new Date(item.ends_at);
      const active = Date.parse(item.starts_at) <= now;
      const date = start.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" }).replace(".", "");
      const time = `${start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}–${end.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
      return `<button class="overview-session-row" type="button" data-overview-tab="reservations"><span class="overview-session-time">${escapeHtml(time)}</span><span class="overview-session-main"><strong>${escapeHtml(profile.username || item.user_id)}</strong><small>${escapeHtml(profile.group_name || "turma indisponível")} · ${escapeHtml(date)}</small></span><span class="overview-session-state ${active ? "active" : ""}"><i></i>${active ? "em andamento" : item.device_id ? "credencial emitida" : "aguardando credencial"}</span></button>`;
    }).join("") : `<div class="overview-empty">Nenhuma sessão futura registrada.</div>`;

    $("#overview-attention").innerHTML = attention.length
      ? attention.slice(0, 5).map(({ message, tab, tone }) => `<button class="overview-queue-item" type="button" data-overview-tab="${tab}"><i class="${tone}"></i><span>${escapeHtml(message)}</span><b aria-hidden="true">→</b></button>`).join("")
      : `<div class="overview-queue-empty"><i></i><span>Nenhum bloqueio operacional aparente agora.</span></div>`;

    insights.querySelectorAll("[data-overview-tab]").forEach((button) => button.addEventListener("click", () => setActiveTab(button.dataset.overviewTab)));
  }

  const tabCopy = {
    accounts: ["Visão geral", "Saúde das contas, acessos e próximas sessões em um só lugar."],
    devices: ["Dispositivos autorizados", "Controle políticas, uso observado e revogação de cada acesso."],
    users: ["Usuários e turmas", "Veja quem pode reservar, qual conta usa e qual franquia recebeu."],
    reservations: ["Agenda e sessões", "Acompanhe janelas futuras, ativações e credenciais emitidas."],
    admins: ["Administradores", "Gerencie papéis e mantenha o acesso administrativo sob controle."],
  };

  function setActiveTab(tab) {
    document.querySelectorAll("[data-tab]").forEach((button) => {
      const active = button.dataset.tab === tab;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    document.querySelectorAll(".admin-tab-panel").forEach((panel) => { panel.hidden = panel.id !== `tab-${tab}`; });
    const copy = tabCopy[tab] || tabCopy.accounts;
    $("#admin-page-title").textContent = copy[0];
    $("#admin-page-description").textContent = copy[1];
    const search = $("#admin-search");
    if (search) { search.value = ""; filterPanel(""); }
    if (tab === "reservations") window.requestAnimationFrame(() => state.adminCalendar?.updateSize());
  }

  function filterPanel(value) {
    const term = String(value || "").trim().toLocaleLowerCase("pt-BR");
    const panel = [...document.querySelectorAll(".admin-tab-panel")].find((candidate) => !candidate.hidden);
    if (!panel) return;
    const selector = panel.id === "tab-accounts" ? ".admin-account-card" : panel.id === "tab-devices" ? "#devices-body tr" : panel.id === "tab-users" ? "#users-body tr" : panel.id === "tab-reservations" ? "#reservations-body tr" : "#admins-body tr";
    panel.querySelectorAll(selector).forEach((item) => { item.hidden = Boolean(term && !item.textContent.toLocaleLowerCase("pt-BR").includes(term)); });
  }

  function renderDevices(payload) {
    const active = state.devices.filter((device) => device.status === "active").length;
    const attention = state.devices.filter((device) => ["limited", "disabled", "expired"].includes(device.status)).length;
    $("#devices-summary").textContent = state.devices.length
      ? `${active} ativos · ${attention} pedem atenção · ${state.devices.length} registros no histórico.`
      : "Nenhum token temporário emitido ainda.";
    $("#devices-note").textContent = payload.stale ? "Snapshot desatualizado: confirme o host antes de emitir ou revogar acesso." : "Sincronizado agora com o host central.";
    const body = $("#devices-body");
    if (!state.devices.length) {
      body.innerHTML = `<tr><td colspan="5" class="admin-empty">Nenhum dispositivo registrado.</td></tr>`;
      return;
    }
    body.innerHTML = state.devices.map((device) => {
      const account = accountById(device.accountId);
      const usage = device.usage || {};
      const accountPercent = Number(usage.accountUsedPercent);
      const usageWidth = Number.isFinite(accountPercent) ? Math.max(0, Math.min(100, accountPercent)) : 0;
      const usedPercent = Number.isFinite(accountPercent) ? `${accountPercent.toFixed(1)}% da conta` : "uso da conta indisponível";
      const windowText = usage.accountWindowDurationMins ? `janela ${formatDuration(usage.accountWindowDurationMins)}` : "janela indisponível";
      const resetText = usage.accountResetsAt ? `reset ${formatReset(usage.accountResetsAt)}` : "reset indisponível";
      const policy = `${Number(device.weeklyLimitPercent ?? 100).toFixed(0)}% semanal`;
      const actionButtons = device.status === "revoked"
        ? `<span class="admin-muted">histórico</span>`
        : `<button type="button" class="admin-button tiny ghost" data-device-edit="${escapeHtml(device.deviceId)}">Editar limites</button>${device.status === "disabled" ? `<button type="button" class="admin-button tiny ghost" data-device-action="enable" data-device-id="${escapeHtml(device.deviceId)}">Reabilitar</button>` : `<button type="button" class="admin-button tiny ghost" data-device-action="disable" data-device-id="${escapeHtml(device.deviceId)}">Desabilitar</button>`}<button type="button" class="admin-button tiny danger" data-device-action="revoke" data-device-id="${escapeHtml(device.deviceId)}">Revogar</button>`;
      return `<tr>
        <td><strong>${escapeHtml(device.label)}</strong><small>${escapeHtml(device.deviceId)} · fp ${escapeHtml(device.fingerprint || "indisponível")} · último acesso ${escapeHtml(formatDate(device.lastSeenAt))}</small></td>
        <td><strong>${escapeHtml(account?.label || device.accountId || "padrão legado")}</strong><small>${escapeHtml(account?.email || "conta não disponível")} · ${escapeHtml(policy)} · até ${escapeHtml(formatDate(device.expiresAt))}</small></td>
        <td><strong>${escapeHtml(formatNumber(usage.observedTokens))} tokens</strong><div class="usage-meter" aria-hidden="true"><i style="width:${usageWidth}%"></i></div><small>${escapeHtml(usedPercent)} · ${escapeHtml(windowText)}</small><small>${escapeHtml(resetText)} · último evento ${escapeHtml(formatDate(usage.lastUsageAt))}</small></td>
        <td><span class="admin-badge ${statusClass(device.status)}">${escapeHtml(statusLabel(device.status))}</span>${usage.usageLimitReachedAt ? `<small class="admin-limit-warning">atingido em ${escapeHtml(formatDate(usage.usageLimitReachedAt))}</small>` : ""}</td>
        <td class="table-actions">${actionButtons}</td>
      </tr>`;
    }).join("");
    body.querySelectorAll("[data-device-action]").forEach((button) => button.addEventListener("click", () => requestAction(`device-${button.dataset.deviceAction}`, button.dataset.deviceId)));
    body.querySelectorAll("[data-device-edit]").forEach((button) => button.addEventListener("click", () => openDeviceDialog(button.dataset.deviceEdit)));
  }

  async function loadAdmins() {
    const body = $("#admins-body");
    try {
      const data = await api("/api/admin/admins");
      body.innerHTML = (data.admins || []).map((admin) => `<tr><td>${escapeHtml(admin.email || admin.user_id)}</td><td><span class="admin-badge ${admin.role === "owner" ? "default-badge" : ""}">${escapeHtml(admin.role)}</span></td><td>${admin.enabled ? "ativo" : "desativado"}</td><td>${escapeHtml(formatDate(admin.created_at))}</td><td>${admin.role === "admin" ? `<button class="admin-button tiny ${admin.enabled ? "danger" : "ghost"}" data-admin-action="${admin.enabled ? "disable" : "enable"}" data-admin-id="${escapeHtml(admin.user_id)}">${admin.enabled ? "Desativar" : "Ativar"}</button>` : "protegido"}</td></tr>`).join("") || `<tr><td colspan="5" class="admin-empty">Nenhum administrador encontrado.</td></tr>`;
      body.querySelectorAll("[data-admin-action]").forEach((button) => button.addEventListener("click", () => requestAction(`admin-${button.dataset.adminAction}`, button.dataset.adminId)));
    } catch (error) {
      body.innerHTML = `<tr><td colspan="5" class="admin-empty">${escapeHtml(error.message)}</td></tr>`;
    }
  }

  async function loadUsers() {
    const body = $("#users-body");
    try {
      const data = await api("/api/admin/users");
      state.users = data.users || [];
      const groups = new Set(state.users.map((user) => user.group_name));
      $("#users-summary").innerHTML = `<span><strong>${state.users.length}</strong> usuários</span><span><strong>${groups.size}</strong> turmas</span><span><strong>${state.users.filter((user) => user.enabled).length}</strong> ativos</span>`;
      body.innerHTML = state.users.map((user) => `<tr><td><strong>${escapeHtml(user.username)}</strong><small>${escapeHtml(user.user_id)}</small></td><td>${escapeHtml(user.group_name)}</td><td>${escapeHtml(accountById(user.account_id)?.label || user.account_id)}</td><td><strong>${Number(user.weekly_quota_percent).toFixed(1)}%</strong><small>da janela semanal da conta</small></td><td><span class="admin-badge ${user.enabled ? "success" : "error"}">${user.enabled ? "ativo" : "desativado"}</span></td><td>${escapeHtml(formatDate(user.created_at))}</td></tr>`).join("") || `<tr><td colspan="6" class="admin-empty">Nenhum usuário comum migrado.</td></tr>`;
    } catch (error) {
      body.innerHTML = `<tr><td colspan="6" class="admin-empty">${escapeHtml(error.message)}</td></tr>`;
    }
  }

  function startOfDay(value = new Date()) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function adminCalendarEvents() {
    const now = Date.now();
    return state.reservations.filter((item) => item.status === "scheduled").map((item) => {
      const profile = state.users.find((user) => user.user_id === item.user_id) || {};
      const active = Date.parse(item.starts_at) <= now && Date.parse(item.ends_at) > now;
      return {
        id: `reservation-${item.id}`,
        title: profile.username || item.user_id,
        start: item.starts_at,
        end: item.ends_at,
        className: active ? "admin-event-active" : "admin-event-scheduled",
        extendedProps: {
          reservationId: item.id,
          username: profile.username || item.user_id,
          groupName: profile.group_name || "turma indisponível",
          accountLabel: accountById(item.account_id)?.label || item.account_id,
          active,
        },
      };
    });
  }

  function adminCalendarEventContent(info) {
    const event = info.event;
    const props = event.extendedProps;
    const node = document.createElement("div");
    node.className = "calendar-event-content";
    node.innerHTML = `<strong>${escapeHtml(props.username)}</strong><span>${RemoteCodexCalendar.formatTime(event.start)}–${RemoteCodexCalendar.formatTime(event.end)}</span><small>${escapeHtml(props.accountLabel)}</small>`;
    return { domNodes: [node] };
  }

  function focusReservation(reservationId) {
    const row = document.querySelector(`[data-reservation-id="${CSS.escape(reservationId)}"]`);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
    row?.classList.add("calendar-row-focus");
    window.setTimeout(() => row?.classList.remove("calendar-row-focus"), 1400);
    const item = state.reservations.find((reservation) => reservation.id === reservationId);
    if (item) $("#admin-schedule-selection").textContent = `${formatDate(item.starts_at)} · ${formatDate(item.ends_at)}`;
  }

  function renderAdminCalendar() {
    const board = $("#admin-calendar-board");
    if (!board) return;
    if (!state.adminWeekStart) state.adminWeekStart = startOfDay(new Date());
    if (!state.adminCalendar) {
      state.adminCalendar = RemoteCodexCalendar.create(board, {
        initialDate: state.adminWeekStart,
        events: adminCalendarEvents(),
        height: 640,
        eventContent: adminCalendarEventContent,
        eventClick: (info) => focusReservation(info.event.extendedProps.reservationId),
        eventDidMount: (info) => {
          const props = info.event.extendedProps;
          info.el.setAttribute("aria-label", `${props.username}, ${RemoteCodexCalendar.formatTime(info.event.start)} até ${RemoteCodexCalendar.formatTime(info.event.end)}, ${props.active ? "em andamento" : "agendada"}`);
        },
        datesSet: (info) => {
          state.adminWeekStart = startOfDay(info.start);
          $("#admin-schedule-range").textContent = RemoteCodexCalendar.formatRange(info.start, new Date(info.end.getTime() - 86_400_000));
        },
      });
    } else {
      RemoteCodexCalendar.syncEvents(state.adminCalendar, adminCalendarEvents());
      state.adminCalendar.updateSize();
    }
  }

  async function loadReservations() {
    const body = $("#reservations-body");
    try {
      const data = await api("/api/admin/reservations");
      state.reservations = data.reservations || [];
      const now = Date.now();
      const active = state.reservations.filter((item) => item.status === "scheduled" && Date.parse(item.starts_at) <= now && Date.parse(item.ends_at) > now).length;
      const future = state.reservations.filter((item) => item.status === "scheduled" && Date.parse(item.starts_at) > now).length;
      $("#reservations-summary").innerHTML = `<span><strong>${active}</strong> em andamento</span><span><strong>${future}</strong> futuras</span><span><strong>${state.reservations.filter((item) => item.device_id).length}</strong> credenciais emitidas</span>`;
      renderAdminCalendar();
      body.innerHTML = state.reservations.map((item) => {
        const profile = state.users.find((user) => user.user_id === item.user_id) || {};
        const start = new Date(item.starts_at);
        const end = new Date(item.ends_at);
        const status = item.status === "cancelled" ? "cancelada" : start <= new Date() && end > new Date() ? "ativa" : start > new Date() ? "agendada" : "encerrada";
        return `<tr data-reservation-id="${escapeHtml(item.id)}"><td><strong>${escapeHtml(profile.username || item.user_id)}</strong><small>${escapeHtml(profile.group_name || "turma indisponível")}</small></td><td><strong>${escapeHtml(formatDate(item.starts_at))}</strong><small>até ${escapeHtml(formatDate(item.ends_at))}</small></td><td>${escapeHtml(accountById(item.account_id)?.label || item.account_id)}</td><td>${item.quota_budget_percent == null ? "aguardando ativação" : `${Number(item.quota_budget_percent).toFixed(1)}%`}<small>${item.quota_base_used_percent == null ? "" : `base da conta ${Number(item.quota_base_used_percent).toFixed(1)}%`}</small></td><td>${item.device_id ? `<strong>${escapeHtml(item.device_id)}</strong><small>ativada ${escapeHtml(formatDate(item.activated_at))}</small>` : "não emitida"}</td><td><span class="admin-badge ${status === "ativa" ? "success" : status === "agendada" ? "warning" : ""}">${status}</span></td></tr>`;
      }).join("") || `<tr><td colspan="6" class="admin-empty">Nenhuma reserva registrada.</td></tr>`;
    } catch (error) {
      body.innerHTML = `<tr><td colspan="6" class="admin-empty">${escapeHtml(error.message)}</td></tr>`;
    }
  }

  async function startLogin(accountId, trigger = null) {
    state.loginAccountId = accountId;
    const dialog = $("#login-dialog");
    const status = $("#login-dialog-status");
    if (trigger) {
      trigger.disabled = true;
      trigger.dataset.previousLabel = trigger.textContent;
      trigger.textContent = "Preparando…";
    }
    $("#login-dialog-title").textContent = "Preparando login…";
    $("#login-url").href = "#";
    $("#login-url").textContent = "Conectando ao host central…";
    $("#login-code").textContent = "········";
    status.textContent = "Solicitando um código seguro…";
    status.className = "admin-status";
    if (!dialog.open) dialog.showModal();
    try {
      const data = await api(`/api/admin/accounts/${encodeURIComponent(accountId)}/login/start`, { method: "POST", body: JSON.stringify({}) });
      const login = data.login || {};
      const url = login.verificationUrl || login.authUrl || "#";
      $("#login-dialog-title").textContent = `Login · ${data.snapshot?.label || accountId}`;
      const link = $("#login-url"); link.href = url; link.textContent = url === "#" ? "URL indisponível" : url;
      $("#login-code").textContent = login.userCode || "Código indisponível; confira a resposta do app-server.";
      status.textContent = login.userCode ? "Abra a URL, informe o código e depois atualize o estado." : "O host não retornou um código. Tente novamente.";
      status.className = `admin-status ${login.userCode ? "success" : "warning"}`;
    } catch (error) {
      status.textContent = `Não foi possível iniciar: ${error.message}`;
      status.className = "admin-status error";
      setStatus(error.message, "error");
    } finally {
      if (trigger) {
        trigger.disabled = false;
        trigger.textContent = trigger.dataset.previousLabel || "Iniciar login";
      }
    }
  }

  async function refreshAccount(accountId) {
    const status = $("#login-dialog-status");
    const inDialog = $("#login-dialog").open && state.loginAccountId === accountId;
    if (inDialog) { status.textContent = "Consultando o host…"; status.className = "admin-status"; }
    try {
      const data = await api(`/api/admin/accounts/${encodeURIComponent(accountId)}/refresh`, { method: "POST", body: JSON.stringify({}) });
      await refreshAll();
      const snapshot = data.account || state.accounts.find((account) => account.accountId === accountId);
      if (inDialog) {
        const ready = snapshot?.status === "ready";
        status.textContent = ready ? "Login confirmado. A conta já pode receber sessões." : "Ainda aguardando confirmação. Se você acabou de concluir, tente atualizar de novo.";
        status.className = `admin-status ${ready ? "success" : "warning"}`;
      }
    } catch (error) {
      if (inDialog) { status.textContent = `Não foi possível atualizar: ${error.message}`; status.className = "admin-status error"; }
      setStatus(error.message, "error");
    }
  }

  async function setDefault(accountId) {
    try { await api(`/api/admin/accounts/${encodeURIComponent(accountId)}/default`, { method: "POST", body: JSON.stringify({}) }); await refreshAll(); }
    catch (error) { setStatus(error.message, "error"); }
  }

  function openAccountDialog() {
    $("#account-label").value = "";
    $("#account-form-error").textContent = "";
    $("#account-dialog").showModal();
  }

  async function submitAccount(event) {
    event.preventDefault();
    try {
      const data = await api("/api/admin/accounts", { method: "POST", body: JSON.stringify({ label: $("#account-label").value.trim() }) });
      $("#account-dialog").close();
      const accountId = data.account?.accountId;
      setStatus("Conta criada. Abrindo o login seguro…", "success");
      await refreshAll().catch(() => undefined);
      if (accountId) await startLogin(accountId);
      else setStatus("Conta criada, mas o host não retornou o identificador para iniciar o login.", "warning");
    } catch (error) { $("#account-form-error").textContent = error.message; }
  }

  function availableAccounts(selectedAccountId = "") {
    return state.accounts.filter((account) => {
      if (account.accountId === selectedAccountId) return true;
      if (account.status !== "ready") return false;
      return !state.devices.some((device) => device.accountId === account.accountId && !["revoked", "expired"].includes(device.status));
    });
  }

  function openDeviceDialog(deviceId = null) {
    state.editingDeviceId = deviceId;
    const device = deviceId ? state.devices.find((candidate) => candidate.deviceId === deviceId) : null;
    const accounts = availableAccounts(device?.accountId || "");
    const select = $("#device-account");
    const legacyUnbound = Boolean(device && !device.accountId);
    select.innerHTML = `${legacyUnbound ? `<option value="">Vincular depois</option>` : ""}${accounts.map((account) => `<option value="${escapeHtml(account.accountId)}">${escapeHtml(account.label)} · ${escapeHtml(account.email || "email indisponível")}</option>`).join("")}`;
    if (!accounts.length) {
      select.innerHTML = `<option value="">Nenhuma conta pronta disponível</option>`;
      select.disabled = true;
    } else {
      select.disabled = Boolean(device && device.accountId);
      select.value = device?.accountId || (legacyUnbound ? "" : accounts[0].accountId);
    }
    $("#device-dialog-eyebrow").textContent = device ? "POLÍTICA DO DISPOSITIVO" : "NOVO DISPOSITIVO";
    $("#device-dialog-title").textContent = device ? "Editar limites" : "Emitir token";
    $("#device-submit").textContent = device ? "Salvar limites" : "Emitir token";
    $("#device-label").value = device?.label || "";
    $("#device-label").disabled = Boolean(device);
    $("#device-weekly-limit").value = String(device?.weeklyLimitPercent ?? 100);
    $("#device-percent-output").textContent = `${device?.weeklyLimitPercent ?? 100}%`;
    $("#device-expires-at").value = toDateTimeLocal(device?.expiresAt);
    $("#device-form-error").textContent = accounts.length || device ? "" : "Faça login em uma conta antes de emitir um token.";
    $("#device-dialog").showModal();
  }

  async function submitDevice(event) {
    event.preventDefault();
    const expiresAt = fromDateTimeLocal($("#device-expires-at").value);
    const weeklyLimitPercent = Number($("#device-weekly-limit").value);
    if (!expiresAt || !Number.isFinite(weeklyLimitPercent) || (!state.editingDeviceId && !$("#device-account").value)) {
      $("#device-form-error").textContent = "Informe uma data futura e um percentual válido.";
      return;
    }
    try {
      if (state.editingDeviceId) {
        const existingDevice = state.devices.find((device) => device.deviceId === state.editingDeviceId);
        const policy = { weeklyLimitPercent, expiresAt, ...(existingDevice && !existingDevice.accountId ? { accountId: $("#device-account").value || null } : {}) };
        await api(`/api/admin/devices/${encodeURIComponent(state.editingDeviceId)}/policy`, { method: "POST", body: JSON.stringify(policy) });
        $("#device-dialog").close();
        await refreshAll();
        return;
      }
      const data = await api("/api/admin/devices", { method: "POST", body: JSON.stringify({ label: $("#device-label").value.trim(), accountId: $("#device-account").value, weeklyLimitPercent, expiresAt }) });
      $("#device-dialog").close();
      await refreshAll();
      state.issuedToken = data.token || "";
      state.issuedDevice = data.device || null;
      $("#issued-token").value = state.issuedToken;
      $("#issued-token-context").textContent = `${data.device?.label || "Dispositivo"} · ${accountById(data.device?.accountId)?.label || data.device?.accountId || "conta"} · teto ${data.device?.weeklyLimitPercent ?? weeklyLimitPercent}% · expira ${formatDate(data.device?.expiresAt || expiresAt)}`;
      $("#copy-status").textContent = "Copie o token ou o comando antes de fechar.";
      $("#copy-status").className = "admin-status";
      $("#token-dialog").showModal();
    } catch (error) { $("#device-form-error").textContent = error.message; }
  }

  function requestAction(action, targetId) {
    state.pendingAction = { action, targetId };
    const device = state.devices.find((candidate) => candidate.deviceId === targetId);
    const admin = action.startsWith("admin-");
    const account = action === "account-logout" ? accountById(targetId) : null;
    const actionKind = action.startsWith("device-") ? action.slice(7) : action;
    const labels = { disable: "Desabilitar acesso", enable: "Reabilitar acesso", revoke: "Revogar permanentemente", "account-logout": "Encerrar login", "account-remove": "Excluir conta", "admin-disable": "Desativar administrador", "admin-enable": "Ativar administrador" };
    const title = labels[action] || labels[actionKind] || "Confirmar ação";
    $("#action-dialog-title").textContent = title;
    $("#action-confirm").textContent = action.includes("revoke") ? "Revogar permanentemente" : action === "account-remove" ? "Excluir conta" : "Confirmar";
    $("#action-confirm").className = `admin-button ${action.includes("revoke") || action.includes("disable") || action === "account-remove" ? "danger" : "primary"}`;
    $("#action-dialog-copy").textContent = device
      ? `${device.label} (${device.deviceId}). ${actionKind === "revoke" ? "O registro será mantido no histórico, mas este token nunca poderá ser reabilitado." : actionKind === "disable" ? "O bloqueio é temporário e pode ser reabilitado depois." : actionKind === "enable" ? "O token voltará a aceitar novas conexões se ainda não estiver expirado." : ""}`
      : admin
        ? "A alteração será registrada na auditoria administrativa."
        : account
          ? `Encerrar o login de ${account.label} no host central?`
          : action === "account-remove"
            ? `Excluir ${accountById(targetId)?.label || "esta conta"}? O CODEX_HOME isolado será removido e os dispositivos vinculados serão revogados. Esta ação não pode ser desfeita.`
          : "Confirme esta operação.";
    $("#action-dialog").showModal();
  }

  async function executeAction(event) {
    event.preventDefault();
    const pending = state.pendingAction;
    if (!pending) return;
    try {
      const { action, targetId } = pending;
      if (action.startsWith("device-")) await api(`/api/admin/devices/${encodeURIComponent(targetId)}/${action.slice(7)}`, { method: "POST", body: JSON.stringify({}) });
      else if (action === "account-logout") await api(`/api/admin/accounts/${encodeURIComponent(targetId)}/logout`, { method: "POST", body: JSON.stringify({}) });
      else if (action === "account-remove") {
        const result = await api(`/api/admin/accounts/${encodeURIComponent(targetId)}/remove`, { method: "POST", body: JSON.stringify({}) });
        setStatus(`${result.label || "Conta"} excluída; ${result.revokedDevices || 0} credencial(is) revogada(s).`, "success");
      }
      else if (action.startsWith("admin-")) await api(`/api/admin/admins/${encodeURIComponent(targetId)}/${action.slice(6)}`, { method: "POST", body: JSON.stringify({}) });
      $("#action-dialog").close();
      state.pendingAction = null;
      await refreshAll();
    } catch (error) { setStatus(error.message, "error"); }
  }

  function openInviteDialog() {
    $("#invite-email").value = "";
    $("#invite-form-error").textContent = "";
    $("#invite-dialog").showModal();
  }

  async function submitInvite(event) {
    event.preventDefault();
    try {
      await api("/api/admin/admins/invite", { method: "POST", body: JSON.stringify({ email: $("#invite-email").value.trim() }) });
      $("#invite-dialog").close();
      await loadAdmins();
      setStatus("Convite enviado.", "success");
    } catch (error) { $("#invite-form-error").textContent = error.message; }
  }

  async function logout() {
    await window.RemoteCodexAuth.signOut(state.config);
    window.location.replace("/login");
  }

  function bind() {
    $("#logout-button").addEventListener("click", () => void logout());
    $("#refresh-all").addEventListener("click", () => refreshAll().catch(() => undefined));
    $("#retry-overview")?.addEventListener("click", () => refreshAll().catch(() => undefined));
    $("#refresh-accounts").addEventListener("click", () => refreshAll().catch(() => undefined));
    $("#refresh-devices").addEventListener("click", () => refreshAll().catch(() => undefined));
    $("#refresh-users").addEventListener("click", () => loadUsers());
    $("#refresh-reservations").addEventListener("click", () => loadReservations());
    $("#add-account").addEventListener("click", openAccountDialog);
    $("#issue-device").addEventListener("click", () => openDeviceDialog());
    $("#invite-admin").addEventListener("click", openInviteDialog);
    $("#account-form").addEventListener("submit", submitAccount);
    $("#invite-form").addEventListener("submit", submitInvite);
    $("#device-form").addEventListener("submit", submitDevice);
    $("#action-form").addEventListener("submit", executeAction);
    ["#account-cancel", "#invite-cancel", "#device-cancel", "#action-cancel"].forEach((selector) => $(selector).addEventListener("click", () => $(selector.replace("-cancel", "-dialog")).close()));
    $("#login-refresh").addEventListener("click", () => refreshAccount(state.loginAccountId));
    $("#calendar-admin-today").addEventListener("click", () => { $("#admin-schedule-selection").textContent = "Selecione uma reserva para abrir os detalhes."; state.adminCalendar?.today(); });
    $("#calendar-admin-prev").addEventListener("click", () => state.adminCalendar?.prev());
    $("#calendar-admin-next").addEventListener("click", () => state.adminCalendar?.next());
    $("#device-weekly-limit").addEventListener("input", (event) => { $("#device-percent-output").textContent = `${event.target.value}%`; });
    $("#copy-token").addEventListener("click", () => copyText(state.issuedToken, "Token copiado."));
    $("#copy-env").addEventListener("click", () => copyText(`$env:CODEX_REMOTE_TOKEN = "${state.issuedToken}"`, "Variável PowerShell copiada."));
    $("#copy-command").addEventListener("click", () => copyText(`$env:CODEX_REMOTE_TOKEN = "${state.issuedToken}"\ncodex --remote "${remoteWebSocketAddress()}" --remote-auth-token-env CODEX_REMOTE_TOKEN`, "Comando Codex copiado."));
    $("#token-dialog").addEventListener("close", () => { state.issuedToken = ""; state.issuedDevice = null; $("#issued-token").value = ""; $("#copy-status").textContent = ""; });
    $("#admin-search").addEventListener("input", (event) => filterPanel(event.target.value));
    document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => setActiveTab(button.dataset.tab)));
  }

  async function init() {
    state.adminWeekStart = startOfDay();
    bind();
    try {
      state.config = await window.RemoteCodexAuth.loadConfig();
      if (!window.RemoteCodexAuth.getSession()?.access_token) {
        redirectToLogin();
        return;
      }
      await showApp();
    } catch (error) {
      setStatus(error.message, "error");
    }
  }

  void init();
})();
