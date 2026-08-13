(() => {
  "use strict";

  const state = {
    config: null,
    accessToken: sessionStorage.getItem("remote_codex_admin_access") || "",
    user: JSON.parse(sessionStorage.getItem("remote_codex_admin_user") || "null"),
    role: "",
    accounts: [],
    devices: [],
    issuedToken: "",
    loginAccountId: "",
  };

  const $ = (selector) => document.querySelector(selector);
  const loginView = $("#login-view");
  const appView = $("#app-view");
  const statusBox = $("#global-status");

  function setStatus(message, kind = "") {
    statusBox.textContent = message || "";
    statusBox.className = `admin-status ${kind}`.trim();
  }

  function setLoginError(message) {
    $("#login-error").textContent = message || "";
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

  async function loadConfig() {
    const response = await fetch("/api/admin/config", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.supabaseUrl || !data.publishableKey) throw new Error(data.error || "Supabase Auth não está configurado no relay.");
    state.config = data;
  }

  async function supabasePasswordLogin(email, password) {
    const response = await fetch(`${state.config.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: state.config.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw new Error(data.error_description || data.msg || "Não foi possível entrar.");
    state.accessToken = data.access_token;
    state.user = data.user || { email };
    sessionStorage.setItem("remote_codex_admin_access", state.accessToken);
    sessionStorage.setItem("remote_codex_admin_user", JSON.stringify(state.user));
  }

  async function api(path, options = {}) {
    const headers = { Accept: "application/json", ...(options.body === undefined ? {} : { "Content-Type": "application/json" }), ...(options.headers || {}) };
    if (state.accessToken) headers.Authorization = `Bearer ${state.accessToken}`;
    const response = await fetch(path, { ...options, headers, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      logout();
      throw new Error("Sua sessão expirou. Entre novamente.");
    }
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }

  async function showApp() {
    loginView.hidden = true;
    appView.hidden = false;
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
      const limitMarkup = limits.length ? limits.map((limit) => [
        ["principal", limit.primary],
        ["secundária", limit.secondary],
      ].filter(([, window]) => window).map(([windowLabel, window]) => {
        const current = window || {};
        const percent = current.usedPercent === null || current.usedPercent === undefined ? null : Math.max(0, Math.min(100, Number(current.usedPercent)));
        const credits = current.credits && Object.keys(current.credits).length ? ` · créditos ${Object.values(current.credits).map((value) => String(value)).join("/")}` : "";
        return `<div class="limit-row"><div><strong>${escapeHtml(limit.limitName || limit.limitId)} · ${escapeHtml(windowLabel)}</strong><span>${percent === null ? "indisponível" : `${percent}% usado`}</span></div><div class="limit-track"><i style="width:${percent === null ? 0 : percent}%"></i></div><small>${current.windowDurationMins ? `${current.windowDurationMins} min · ` : ""}${formatReset(current.resetsAt)}${escapeHtml(credits)}</small></div>`;
      }).join("")).join("") : `<p class="admin-muted">Limites não retornados pelo app-server.</p>`;
      const usage = account.usage?.dailyUsageBuckets?.slice(-7) || [];
      const usageText = usage.length ? `${usage.length} dias observados · ${usage.reduce((total, bucket) => total + Number(bucket.tokens || 0), 0).toLocaleString("pt-BR")} tokens` : "uso diário indisponível";
      const statusClass = account.status === "ready" ? "success" : account.status === "login_required" ? "warning" : "error";
      return `<article class="admin-account-card ${account.isDefault ? "default" : ""}">
        <div class="admin-card-head"><div><span class="admin-badge ${statusClass}">${escapeHtml(account.status)}</span>${account.isDefault ? `<span class="admin-badge default-badge">padrão</span>` : ""}</div><button class="icon-button" data-refresh-account="${escapeHtml(account.accountId)}" title="Atualizar">↻</button></div>
        <h3>${escapeHtml(account.label)}</h3><p class="account-email">${escapeHtml(account.email || "email indisponível")} · ${escapeHtml(account.planType || "plano indisponível")}</p>
        <div class="limit-list">${limitMarkup}</div><p class="usage-summary">${escapeHtml(usageText)} · última atualização ${escapeHtml(formatDate(account.updatedAt))}</p>
        ${account.error ? `<p class="admin-inline-error">${escapeHtml(account.error)}</p>` : ""}
        <div class="admin-actions">${account.status === "ready" && !account.isDefault ? `<button class="admin-button small primary" data-default-account="${escapeHtml(account.accountId)}">Usar como padrão</button>` : ""}<button class="admin-button small ghost" data-login-account="${escapeHtml(account.accountId)}">${account.status === "ready" ? "Refrescar login" : "Iniciar login"}</button>${account.status === "ready" ? `<button class="admin-button small danger" data-logout-account="${escapeHtml(account.accountId)}">Sair</button>` : ""}</div>
      </article>`;
    }).join("");
    grid.querySelectorAll("[data-default-account]").forEach((button) => button.addEventListener("click", () => setDefault(button.dataset.defaultAccount)));
    grid.querySelectorAll("[data-login-account]").forEach((button) => button.addEventListener("click", () => startLogin(button.dataset.loginAccount)));
    grid.querySelectorAll("[data-refresh-account]").forEach((button) => button.addEventListener("click", () => refreshAccount(button.dataset.refreshAccount)));
    grid.querySelectorAll("[data-logout-account]").forEach((button) => button.addEventListener("click", () => logoutAccount(button.dataset.logoutAccount)));
  }

  function renderDevices(payload) {
    $("#devices-note").textContent = payload.stale ? "Exibindo snapshot stale: o host central não está respondendo agora." : "Estado sincronizado com o host central.";
    const body = $("#devices-body");
    if (!state.devices.length) {
      body.innerHTML = `<tr><td colspan="5" class="admin-empty">Nenhum dispositivo registrado.</td></tr>`;
      return;
    }
    body.innerHTML = state.devices.map((device) => `<tr>
      <td><strong>${escapeHtml(device.label)}</strong><small>${escapeHtml(device.deviceId)} · fp ${escapeHtml(device.fingerprint || "indisponível")}</small></td>
      <td><span class="admin-badge ${device.status === "active" ? "success" : device.status === "disabled" ? "warning" : "error"}">${escapeHtml(device.status)}</span></td>
      <td>${escapeHtml(formatDate(device.expiresAt))}</td><td>${escapeHtml(formatDate(device.lastSeenAt))}</td>
      <td class="table-actions">${device.status === "active" ? `<button class="admin-button tiny ghost" data-device-action="disable" data-device-id="${escapeHtml(device.deviceId)}">Desabilitar</button>` : device.status === "disabled" ? `<button class="admin-button tiny ghost" data-device-action="enable" data-device-id="${escapeHtml(device.deviceId)}">Reabilitar</button>` : ""}${device.status !== "revoked" && device.status !== "expired" ? `<button class="admin-button tiny danger" data-device-action="revoke" data-device-id="${escapeHtml(device.deviceId)}">Revogar</button>` : ""}</td>
    </tr>`).join("");
    body.querySelectorAll("[data-device-action]").forEach((button) => button.addEventListener("click", () => deviceAction(button.dataset.deviceAction, button.dataset.deviceId)));
  }

  async function loadAdmins() {
    const body = $("#admins-body");
    try {
      const data = await api("/api/admin/admins");
      body.innerHTML = (data.admins || []).map((admin) => `<tr><td>${escapeHtml(admin.email || admin.user_id)}</td><td><span class="admin-badge ${admin.role === "owner" ? "default-badge" : ""}">${escapeHtml(admin.role)}</span></td><td>${admin.enabled ? "ativo" : "desativado"}</td><td>${escapeHtml(formatDate(admin.created_at))}</td><td>${admin.role === "admin" ? `<button class="admin-button tiny ${admin.enabled ? "danger" : "ghost"}" data-admin-action="${admin.enabled ? "disable" : "enable"}" data-admin-id="${escapeHtml(admin.user_id)}">${admin.enabled ? "Desativar" : "Ativar"}</button>` : "protegido"}</td></tr>`).join("") || `<tr><td colspan="5" class="admin-empty">Nenhum administrador encontrado.</td></tr>`;
      body.querySelectorAll("[data-admin-action]").forEach((button) => button.addEventListener("click", () => adminAction(button.dataset.adminAction, button.dataset.adminId)));
    } catch (error) {
      body.innerHTML = `<tr><td colspan="4" class="admin-empty">${escapeHtml(error.message)}</td></tr>`;
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
    if (!confirm("Usar esta conta para novas sessões? Sessões já abertas continuarão na conta anterior.")) return;
    try { await api(`/api/admin/accounts/${encodeURIComponent(accountId)}/default`, { method: "POST", body: JSON.stringify({}) }); await refreshAll(); }
    catch (error) { setStatus(error.message, "error"); }
  }

  async function logoutAccount(accountId) {
    if (!confirm("Encerrar o login desta conta no host central?")) return;
    try { await api(`/api/admin/accounts/${encodeURIComponent(accountId)}/logout`, { method: "POST", body: JSON.stringify({}) }); await refreshAll(); }
    catch (error) { setStatus(error.message, "error"); }
  }

  async function deviceAction(action, deviceId) {
    const labels = { disable: "desabilitar", enable: "reabilitar", revoke: "revogar permanentemente" };
    if (action === "revoke" && !confirm(`Confirmar ${labels[action]} este dispositivo?`)) return;
    try { await api(`/api/admin/devices/${encodeURIComponent(deviceId)}/${action}`, { method: "POST", body: JSON.stringify({}) }); const data = await api("/api/admin/devices"); state.devices = data.devices || []; renderDevices(data); }
    catch (error) { setStatus(error.message, "error"); }
  }

  async function issueDevice() {
    const label = prompt("Nome do dispositivo:", "pc-notebook");
    if (!label) return;
    const ttlDays = Number(prompt("Validade em dias:", "30"));
    if (!Number.isFinite(ttlDays) || ttlDays <= 0) return;
    try {
      const data = await api("/api/admin/devices", { method: "POST", body: JSON.stringify({ label, ttlMs: Math.round(ttlDays * 24 * 60 * 60_000) }) });
      state.issuedToken = data.token || "";
      $("#issued-token").textContent = state.issuedToken;
      $("#copy-status").textContent = "Copie antes de fechar.";
      $("#token-dialog").showModal();
      const devices = await api("/api/admin/devices"); state.devices = devices.devices || []; renderDevices(devices);
    } catch (error) { setStatus(error.message, "error"); }
  }

  async function addAccount() {
    const label = prompt("Nome da nova conta ChatGPT:", "Conta secundária");
    if (!label) return;
    try { const data = await api("/api/admin/accounts", { method: "POST", body: JSON.stringify({ label }) }); await refreshAll(); await startLogin(data.account?.accountId); }
    catch (error) { setStatus(error.message, "error"); }
  }

  async function inviteAdmin() {
    const email = prompt("Email do novo administrador:");
    if (!email) return;
    try { await api("/api/admin/admins/invite", { method: "POST", body: JSON.stringify({ email }) }); await loadAdmins(); setStatus("Convite enviado.", "success"); }
    catch (error) { setStatus(error.message, "error"); }
  }

  async function adminAction(action, userId) {
    try { await api(`/api/admin/admins/${encodeURIComponent(userId)}/${action}`, { method: "POST", body: JSON.stringify({}) }); await loadAdmins(); }
    catch (error) { setStatus(error.message, "error"); }
  }

  function logout() {
    state.accessToken = ""; state.user = null; state.role = "";
    sessionStorage.removeItem("remote_codex_admin_access"); sessionStorage.removeItem("remote_codex_admin_user");
    appView.hidden = true; loginView.hidden = false; setLoginError("");
  }

  function bind() {
    $("#login-form").addEventListener("submit", async (event) => { event.preventDefault(); setLoginError(""); try { await supabasePasswordLogin($("#login-email").value, $("#login-password").value); await showApp(); } catch (error) { setLoginError(error.message); } });
    $("#logout-button").addEventListener("click", logout);
    $("#refresh-accounts").addEventListener("click", () => refreshAll().catch(() => undefined));
    $("#refresh-devices").addEventListener("click", () => refreshAll().catch(() => undefined));
    $("#add-account").addEventListener("click", addAccount); $("#issue-device").addEventListener("click", issueDevice); $("#invite-admin").addEventListener("click", inviteAdmin);
    $("#login-refresh").addEventListener("click", () => refreshAccount(state.loginAccountId));
    $("#copy-token").addEventListener("click", async () => { try { await navigator.clipboard.writeText(state.issuedToken); $("#copy-status").textContent = "Copiado. Feche a janela quando terminar."; } catch { $("#copy-status").textContent = "Não foi possível copiar automaticamente; selecione o token."; } });
    $("#token-dialog").addEventListener("close", () => { state.issuedToken = ""; $("#issued-token").textContent = ""; $("#copy-status").textContent = ""; });
    document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("active", item === button)); document.querySelectorAll(".admin-tab-panel").forEach((panel) => { panel.hidden = panel.id !== `tab-${button.dataset.tab}`; }); }));
  }

  async function init() {
    bind();
    try { await loadConfig(); } catch (error) { setLoginError(error.message); return; }
    if (state.accessToken) { try { await showApp(); return; } catch { logout(); } }
  }

  void init();
})();
