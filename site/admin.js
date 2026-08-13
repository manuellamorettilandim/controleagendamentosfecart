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
      const accounts = await api("/api/admin/accounts");
      state.role = accounts.role || state.role || "admin";
      $("#session-role").textContent = state.role;
      $("#admins-tab").hidden = state.role !== "owner";
      state.accounts = accounts.accounts || [];
      renderAccounts(accounts);
      const devices = await api("/api/admin/devices");
      state.devices = devices.devices || [];
      renderDevices(devices);
      if (state.role === "owner") await loadAdmins();
      await Promise.all([loadUsers(), loadReservations()]);
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
        <div class="admin-card-head"><div><span class="admin-badge ${statusClassName}">${escapeHtml(status)}</span>${account.isDefault ? `<span class="admin-badge default-badge">padrão</span>` : ""}</div><button class="icon-button" data-refresh-account="${escapeHtml(account.accountId)}" title="Atualizar">↻</button></div>
        <h3>${escapeHtml(account.label)}</h3><p class="account-email">${escapeHtml(account.email || "email indisponível")} · ${escapeHtml(account.planType || "plano indisponível")}</p>
        <div class="limit-list">${limitMarkup}</div><p class="usage-summary">${escapeHtml(usageText)} · última atualização ${escapeHtml(formatDate(account.updatedAt))}</p>
        ${account.error ? `<p class="admin-inline-error">${escapeHtml(account.error)}</p>` : ""}
        <div class="admin-actions">${status === "ready" && !account.isDefault ? `<button class="admin-button small primary" data-default-account="${escapeHtml(account.accountId)}">Usar como padrão</button>` : ""}<button class="admin-button small ghost" data-login-account="${escapeHtml(account.accountId)}">${status === "ready" ? "Atualizar login" : "Iniciar login"}</button>${status === "ready" ? `<button class="admin-button small danger" data-logout-account="${escapeHtml(account.accountId)}">Sair</button>` : ""}</div>
      </article>`;
    }).join("");
    grid.querySelectorAll("[data-default-account]").forEach((button) => button.addEventListener("click", () => setDefault(button.dataset.defaultAccount)));
    grid.querySelectorAll("[data-login-account]").forEach((button) => button.addEventListener("click", () => startLogin(button.dataset.loginAccount)));
    grid.querySelectorAll("[data-refresh-account]").forEach((button) => button.addEventListener("click", () => refreshAccount(button.dataset.refreshAccount)));
    grid.querySelectorAll("[data-logout-account]").forEach((button) => button.addEventListener("click", () => requestAction("account-logout", button.dataset.logoutAccount)));
  }

  function renderDevices(payload) {
    $("#devices-note").textContent = payload.stale ? "Exibindo snapshot stale: o host central não está respondendo agora." : "Estado sincronizado com o host central.";
    const body = $("#devices-body");
    if (!state.devices.length) {
      body.innerHTML = `<tr><td colspan="6" class="admin-empty">Nenhum dispositivo registrado.</td></tr>`;
      return;
    }
    body.innerHTML = state.devices.map((device) => {
      const account = accountById(device.accountId);
      const usage = device.usage || {};
      const usedPercent = usage.accountUsedPercent === null || usage.accountUsedPercent === undefined ? "indisponível" : `${Number(usage.accountUsedPercent).toFixed(1)}% da conta`;
      const windowText = usage.accountWindowDurationMins ? `janela ${formatDuration(usage.accountWindowDurationMins)}` : "janela indisponível";
      const resetText = usage.accountResetsAt ? `reset ${formatReset(usage.accountResetsAt)}` : "reset indisponível";
      const breakdown = `entrada ${formatNumber(usage.observedInputTokens)} · cache ${formatNumber(usage.observedCachedInputTokens)} · saída ${formatNumber(usage.observedOutputTokens)} · raciocínio ${formatNumber(usage.observedReasoningTokens)}`;
      const policy = `${Number(device.weeklyLimitPercent ?? 100).toFixed(0)}% semanal`;
      const actionButtons = device.status === "revoked"
        ? `<span class="admin-muted">histórico</span>`
        : `<button class="admin-button tiny ghost" data-device-edit="${escapeHtml(device.deviceId)}">Editar limites</button>${device.status === "disabled" ? `<button class="admin-button tiny ghost" data-device-action="enable" data-device-id="${escapeHtml(device.deviceId)}">Reabilitar</button>` : `<button class="admin-button tiny ghost" data-device-action="disable" data-device-id="${escapeHtml(device.deviceId)}">Desabilitar</button>`}<button class="admin-button tiny danger" data-device-action="revoke" data-device-id="${escapeHtml(device.deviceId)}">Revogar</button>`;
      return `<tr>
        <td><strong>${escapeHtml(device.label)}</strong><small>${escapeHtml(device.deviceId)} · fp ${escapeHtml(device.fingerprint || "indisponível")} · último acesso ${escapeHtml(formatDate(device.lastSeenAt))}</small></td>
        <td><strong>${escapeHtml(account?.label || device.accountId || "padrão legado")}</strong><small>${escapeHtml(account?.email || "conta não disponível")}</small></td>
        <td><strong>${escapeHtml(policy)}</strong><small>até ${escapeHtml(formatDate(device.expiresAt))}</small></td>
        <td><strong>${escapeHtml(formatNumber(usage.observedTokens))} tokens observados</strong><small>${escapeHtml(breakdown)}</small><small>${escapeHtml(usedPercent)} · ${escapeHtml(windowText)} · ${escapeHtml(resetText)}</small><small>evento ${escapeHtml(formatDate(usage.lastUsageAt))}</small></td>
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

  async function loadReservations() {
    const body = $("#reservations-body");
    try {
      const data = await api("/api/admin/reservations");
      state.reservations = data.reservations || [];
      const now = Date.now();
      const active = state.reservations.filter((item) => item.status === "scheduled" && Date.parse(item.starts_at) <= now && Date.parse(item.ends_at) > now).length;
      const future = state.reservations.filter((item) => item.status === "scheduled" && Date.parse(item.starts_at) > now).length;
      $("#reservations-summary").innerHTML = `<span><strong>${active}</strong> em andamento</span><span><strong>${future}</strong> futuras</span><span><strong>${state.reservations.filter((item) => item.device_id).length}</strong> credenciais emitidas</span>`;
      body.innerHTML = state.reservations.map((item) => {
        const profile = state.users.find((user) => user.user_id === item.user_id) || {};
        const start = new Date(item.starts_at);
        const end = new Date(item.ends_at);
        const status = item.status === "cancelled" ? "cancelada" : start <= new Date() && end > new Date() ? "ativa" : start > new Date() ? "agendada" : "encerrada";
        return `<tr><td><strong>${escapeHtml(profile.username || item.user_id)}</strong><small>${escapeHtml(profile.group_name || "turma indisponível")}</small></td><td><strong>${escapeHtml(formatDate(item.starts_at))}</strong><small>até ${escapeHtml(formatDate(item.ends_at))}</small></td><td>${escapeHtml(accountById(item.account_id)?.label || item.account_id)}</td><td>${item.quota_budget_percent == null ? "aguardando ativação" : `${Number(item.quota_budget_percent).toFixed(1)}%`}<small>${item.quota_base_used_percent == null ? "" : `base da conta ${Number(item.quota_base_used_percent).toFixed(1)}%`}</small></td><td>${item.device_id ? `<strong>${escapeHtml(item.device_id)}</strong><small>ativada ${escapeHtml(formatDate(item.activated_at))}</small>` : "não emitida"}</td><td><span class="admin-badge ${status === "ativa" ? "success" : status === "agendada" ? "warning" : ""}">${status}</span></td></tr>`;
      }).join("") || `<tr><td colspan="6" class="admin-empty">Nenhuma reserva registrada.</td></tr>`;
    } catch (error) {
      body.innerHTML = `<tr><td colspan="6" class="admin-empty">${escapeHtml(error.message)}</td></tr>`;
    }
  }

  async function startLogin(accountId) {
    try {
      const data = await api(`/api/admin/accounts/${encodeURIComponent(accountId)}/login/start`, { method: "POST", body: JSON.stringify({}) });
      state.loginAccountId = accountId;
      const login = data.login || {};
      const url = login.verificationUrl || login.authUrl || "#";
      $("#login-dialog-title").textContent = `Login · ${data.snapshot?.label || accountId}`;
      const link = $("#login-url"); link.href = url; link.textContent = url === "#" ? "URL indisponível" : url;
      $("#login-code").textContent = login.userCode || "Código indisponível; confira a resposta do app-server.";
      $("#login-dialog-status").textContent = "Conclua a confirmação e atualize o estado.";
      $("#login-dialog").showModal();
    } catch (error) { setStatus(error.message, "error"); }
  }

  async function refreshAccount(accountId) {
    try { await api(`/api/admin/accounts/${encodeURIComponent(accountId)}/refresh`, { method: "POST", body: JSON.stringify({}) }); await refreshAll(); }
    catch (error) { setStatus(error.message, "error"); }
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
      await refreshAll();
      await startLogin(data.account?.accountId);
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
    $("#device-percent-output").value = `${device?.weeklyLimitPercent ?? 100}%`;
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
    const labels = { disable: "Desabilitar acesso", enable: "Reabilitar acesso", revoke: "Revogar permanentemente", "account-logout": "Encerrar login", "admin-disable": "Desativar administrador", "admin-enable": "Ativar administrador" };
    const title = labels[action] || labels[actionKind] || "Confirmar ação";
    $("#action-dialog-title").textContent = title;
    $("#action-confirm").textContent = action.includes("revoke") ? "Revogar permanentemente" : "Confirmar";
    $("#action-confirm").className = `admin-button ${action.includes("revoke") || action.includes("disable") ? "danger" : "primary"}`;
    $("#action-dialog-copy").textContent = device
      ? `${device.label} (${device.deviceId}). ${actionKind === "revoke" ? "O registro será mantido no histórico, mas este token nunca poderá ser reabilitado." : actionKind === "disable" ? "O bloqueio é temporário e pode ser reabilitado depois." : actionKind === "enable" ? "O token voltará a aceitar novas conexões se ainda não estiver expirado." : ""}`
      : admin
        ? "A alteração será registrada na auditoria administrativa."
        : account
          ? `Encerrar o login de ${account.label} no host central?`
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
    $("#device-weekly-limit").addEventListener("input", (event) => { $("#device-percent-output").textContent = `${event.target.value}%`; });
    $("#copy-token").addEventListener("click", () => copyText(state.issuedToken, "Token copiado."));
    $("#copy-env").addEventListener("click", () => copyText(`$env:CODEX_REMOTE_TOKEN = "${state.issuedToken}"`, "Variável PowerShell copiada."));
    $("#copy-command").addEventListener("click", () => copyText(`$env:CODEX_REMOTE_TOKEN = "${state.issuedToken}"\ncodex --remote "${remoteWebSocketAddress()}" --remote-auth-token-env CODEX_REMOTE_TOKEN`, "Comando Codex copiado."));
    $("#token-dialog").addEventListener("close", () => { state.issuedToken = ""; state.issuedDevice = null; $("#issued-token").value = ""; $("#copy-status").textContent = ""; });
    document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("active", item === button)); document.querySelectorAll(".admin-tab-panel").forEach((panel) => { panel.hidden = panel.id !== `tab-${button.dataset.tab}`; }); }));
  }

  async function init() {
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
