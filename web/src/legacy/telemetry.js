(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { admins: [], accounts: [], audits: [], search: "", filter: "all", generatedAt: null, hostConnected: false, toastTimer: null };

  const actionLabels = {
    "reservation.approve": ["Aprovou solicitação", "approved", "ph-check-circle"],
    "reservation.approve.unchanged": ["Aprovou solicitação", "approved", "ph-check-circle"],
    "reservation.approve.upgrade": ["Aprovou com upgrade", "approved", "ph-arrow-up"],
    "reservation.approve.downgrade": ["Aprovou com downgrade", "warning", "ph-arrow-down"],
    "reservation.reject": ["Recusou solicitação", "rejected", "ph-x-circle"],
    "group.scheduling.enable": ["Liberou agendamentos", "approved", "ph-calendar-check"],
    "group.scheduling.disable": ["Bloqueou agendamentos", "warning", "ph-calendar-x"],
    "group.token.revoke": ["Revogou token do grupo", "rejected", "ph-key"],
    "account.login.start": ["Iniciou login da conta", "account", "ph-sign-in"],
    "account.logout": ["Desconectou conta", "warning", "ph-sign-out"],
    "account.add": ["Adicionou conta", "account", "ph-user-plus"],
    "account.remove": ["Removeu conta", "rejected", "ph-trash"],
    "account.set-default": ["Definiu conta padrão", "account", "ph-star"],
    "account.refresh": ["Atualizou conta", "neutral", "ph-arrows-clockwise"],
    "admin.enable": ["Ativou administrador", "approved", "ph-user-check"],
    "admin.disable": ["Desativou administrador", "warning", "ph-user-minus"],
    "admin.invite": ["Convidou administrador", "account", "ph-envelope-simple"],
    "admin.role.downgrade": ["Rebaixou administrador", "warning", "ph-arrow-down"],
    "access.issue": ["Emitiu acesso", "account", "ph-key"],
    "access.update-policy": ["Alterou política de acesso", "warning", "ph-sliders"],
    "access.disable": ["Desabilitou acesso", "warning", "ph-lock"],
    "access.enable": ["Habilitou acesso", "approved", "ph-lock-open"],
    "access.revoke": ["Revogou acesso", "rejected", "ph-prohibit"],
    "session.issue": ["Iniciou sessão", "account", "ph-play-circle"],
  };

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function text(value, fallback = "") {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }

  function parseDate(value) {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }

  function formatDateTime(value) {
    const date = parseDate(value);
    return date ? date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Nunca acessou";
  }

  function formatRelative(value) {
    const date = parseDate(value);
    if (!date) return "Nunca acessou";
    const seconds = Math.round((date.getTime() - Date.now()) / 1000);
    const formatter = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
    const units = [[31_536_000, "year"], [2_592_000, "month"], [86_400, "day"], [3_600, "hour"], [60, "minute"]];
    for (const [size, unit] of units) {
      if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
    }
    return "agora";
  }

  function initials(value) {
    const parts = text(value, "AD").split(/[@.\s_-]+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "AD";
  }

  function adminId(admin) {
    return text(admin?.user_id || admin?.userId);
  }

  function adminLogin(admin) {
    return text(admin?.login || admin?.email, "Login não informado");
  }

  function accountId(account) {
    return text(account?.accountId || account?.account_id);
  }

  function accountLabel(account) {
    return text(account?.label, accountId(account) || "Conta");
  }

  function actionInfo(action) {
    return actionLabels[action] || [action.replaceAll(".", " · ") || "Ação administrativa", "neutral", "ph-activity"];
  }

  function targetLabel(audit) {
    const targetId = text(audit?.target_id || audit?.targetId);
    if (text(audit?.target_type) === "account") {
      const account = state.accounts.find((candidate) => accountId(candidate) === targetId);
      return account ? accountLabel(account) : targetId || "Conta";
    }
    if (text(audit?.target_type) === "admin") {
      const admin = state.admins.find((candidate) => adminId(candidate) === targetId);
      return admin ? adminLogin(admin) : targetId || "Administrador";
    }
    return targetId || ({ reservation: "Solicitação", group: "Grupo", access: "Acesso", session: "Sessão" }[text(audit?.target_type)] || "—");
  }

  function detailLabel(metadata) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "—";
    const safe = [];
    if (text(metadata.note)) safe.push(text(metadata.note));
    if (text(metadata.label)) safe.push(text(metadata.label));
    if (text(metadata.status)) safe.push(`Status: ${text(metadata.status)}`);
    if (Number.isFinite(Number(metadata.revokedDevices))) safe.push(`${Number(metadata.revokedDevices)} token(s) revogado(s)`);
    else if (Number.isFinite(Number(metadata.revoked))) safe.push(`${Number(metadata.revoked)} token(s) revogado(s)`);
    if (typeof metadata.enabled === "boolean") safe.push(metadata.enabled ? "Permissão liberada" : "Permissão bloqueada");
    if (Number.isFinite(Number(metadata.requestedQuota)) && Number.isFinite(Number(metadata.approvedQuota))) safe.push(`Uso: ${Number(metadata.requestedQuota)}% → ${Number(metadata.approvedQuota)}%`);
    return safe.join(" · ") || "—";
  }

  function renderSummary() {
    const enabled = state.admins.filter((admin) => admin.enabled !== false);
    const dayAgo = Date.now() - 86_400_000;
    $("#telemetry-admin-count").textContent = String(enabled.length);
    $("#telemetry-owner-count").textContent = String(enabled.filter((admin) => admin.role === "owner").length);
    $("#telemetry-action-count").textContent = String(state.audits.filter((audit) => (parseDate(audit.created_at)?.getTime() || 0) >= dayAgo).length);
    $("#telemetry-account-count").textContent = String(state.accounts.filter((account) => account.status === "ready").length);
    $("#telemetry-host-status").textContent = state.hostConnected ? "host central conectado" : "último estado salvo · host offline";
  }

  function renderAdmins() {
    const query = state.search.toLocaleLowerCase("pt-BR");
    const admins = state.admins.filter((admin) => !query || `${adminLogin(admin)} ${admin.role}`.toLocaleLowerCase("pt-BR").includes(query));
    $("#telemetry-people-total").textContent = String(admins.length);
    $("#telemetry-admins-body").innerHTML = admins.length ? admins.map((admin) => {
      const login = adminLogin(admin);
      const lastAccess = admin.last_sign_in_at;
      const createdAt = admin.created_at || admin.auth_created_at;
      return `<tr>
        <td><div class="telemetry-person"><span>${escapeHtml(initials(login))}</span><div><strong>${escapeHtml(login)}</strong><small>${escapeHtml(admin.email || "Autenticação Supabase")}</small></div></div></td>
        <td><span class="telemetry-role is-${admin.role === "owner" ? "owner" : "admin"}"><i class="ph ${admin.role === "owner" ? "ph-crown" : "ph-shield"}" aria-hidden="true"></i>${admin.role === "owner" ? "Owner" : "Admin"}</span></td>
        <td><span class="telemetry-status ${admin.enabled === false ? "is-disabled" : "is-active"}"><i></i>${admin.enabled === false ? "Desativado" : "Ativo"}</span></td>
        <td><strong class="telemetry-date">${escapeHtml(formatRelative(lastAccess))}</strong><small class="telemetry-date-detail">${escapeHtml(lastAccess ? formatDateTime(lastAccess) : "Nenhum login registrado")}</small></td>
        <td>${escapeHtml(formatDateTime(createdAt))}</td>
      </tr>`;
    }).join("") : '<tr><td colspan="5" class="telemetry-empty">Nenhum acesso encontrado.</td></tr>';
  }

  function accountStatus(account) {
    return {
      ready: ["Conectada", "is-ready"], login_required: ["Login necessário", "is-warning"],
      offline: ["Offline", "is-offline"], disabled: ["Desabilitada", "is-offline"], error: ["Erro", "is-error"],
    }[account.status] || [text(account.status, "Desconhecido"), "is-offline"];
  }

  function renderAccounts() {
    const query = state.search.toLocaleLowerCase("pt-BR");
    const accounts = state.accounts.filter((account) => !query || `${accountLabel(account)} ${account.email || ""} ${account.authMode || ""}`.toLocaleLowerCase("pt-BR").includes(query));
    $("#telemetry-accounts-total").textContent = String(accounts.length);
    $("#telemetry-accounts-list").innerHTML = accounts.length ? accounts.map((account) => {
      const [status, statusClass] = accountStatus(account);
      const login = text(account.email, "Login ainda não identificado");
      return `<article class="telemetry-account">
        <span class="telemetry-account-icon"><i class="ph ph-user-circle" aria-hidden="true"></i></span>
        <div class="telemetry-account-copy"><div><strong>${escapeHtml(accountLabel(account))}</strong>${account.isDefault ? '<em>Padrão</em>' : ""}</div><span>${escapeHtml(login)}</span><small>${escapeHtml(text(account.authMode, "Modo de autenticação não informado"))} · atualizado ${escapeHtml(formatRelative(account.updatedAt || account.updated_at))}</small></div>
        <span class="telemetry-account-status ${statusClass}"><i></i>${escapeHtml(status)}</span>
      </article>`;
    }).join("") : '<p class="telemetry-empty">Nenhuma conta encontrada.</p>';
  }

  function filteredAudits() {
    const query = state.search.toLocaleLowerCase("pt-BR");
    return state.audits.filter((audit) => {
      const action = text(audit.action);
      const actor = adminLogin(state.admins.find((admin) => adminId(admin) === text(audit.actor_user_id)));
      const target = targetLabel(audit);
      const details = detailLabel(audit.metadata);
      const matchesFilter = state.filter === "all" || action.startsWith(`${state.filter}.`) || (state.filter === "admin" && action.startsWith("access."));
      return matchesFilter && (!query || `${actor} ${actionInfo(action)[0]} ${target} ${details}`.toLocaleLowerCase("pt-BR").includes(query));
    });
  }

  function renderAudits() {
    const audits = filteredAudits();
    $("#telemetry-audit-total").textContent = `${audits.length} ${audits.length === 1 ? "ação exibida" : "ações exibidas"}`;
    $("#telemetry-audit-body").innerHTML = audits.length ? audits.map((audit) => {
      const actor = state.admins.find((admin) => adminId(admin) === text(audit.actor_user_id));
      const login = actor ? adminLogin(actor) : "Sistema / usuário removido";
      const [label, tone, icon] = actionInfo(text(audit.action));
      return `<tr>
        <td><strong class="telemetry-date">${escapeHtml(formatDateTime(audit.created_at))}</strong><small class="telemetry-date-detail">${escapeHtml(formatRelative(audit.created_at))}</small></td>
        <td><div class="telemetry-actor"><span>${escapeHtml(initials(login))}</span><strong>${escapeHtml(login)}</strong></div></td>
        <td><span class="telemetry-action is-${tone}"><i class="ph ${icon}" aria-hidden="true"></i>${escapeHtml(label)}</span></td>
        <td><span class="telemetry-target">${escapeHtml(targetLabel(audit))}</span></td>
        <td class="telemetry-details">${escapeHtml(detailLabel(audit.metadata))}</td>
      </tr>`;
    }).join("") : '<tr><td colspan="5" class="telemetry-empty">Nenhuma ação encontrada para estes filtros.</td></tr>';
  }

  function renderAll() {
    renderSummary();
    renderAdmins();
    renderAccounts();
    renderAudits();
    $("#telemetry-updated-at").textContent = state.generatedAt ? `Atualizado em ${formatDateTime(state.generatedAt)}` : "—";
  }

  function showToast(message, kind = "") {
    const toast = $("#telemetry-toast");
    if (!toast) return;
    if (state.toastTimer) clearTimeout(state.toastTimer);
    toast.textContent = message;
    toast.className = `admin-toast is-visible${kind ? ` is-${kind}` : ""}`;
    state.toastTimer = setTimeout(() => { toast.className = "admin-toast"; }, 3800);
  }

  function getAuthToken() {
    try { return window.RemoteCodexAuth?.getSession?.()?.access_token || ""; } catch { return ""; }
  }

  async function ensureOwnerAccess() {
    let token = getAuthToken();
    if (!token) return null;
    const check = () => fetch("/api/admin/session", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
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
      if (identity.role === "admin") {
        window.location.replace("/admin");
        return null;
      }
      return identity.role === "owner" ? identity : null;
    } catch { return null; }
  }

  async function loadTelemetry(showSuccess = false) {
    const button = $("#telemetry-refresh");
    button?.classList.add("is-loading");
    if (button) button.disabled = true;
    try {
      const result = await window.FecartApi?.admin?.("/api/admin/telemetry");
      if (!result) throw new Error("Sessão administrativa ausente.");
      state.admins = Array.isArray(result.admins) ? result.admins : [];
      state.accounts = Array.isArray(result.accounts) ? result.accounts : [];
      state.audits = Array.isArray(result.audits) ? result.audits : [];
      state.generatedAt = result.generatedAt || new Date().toISOString();
      state.hostConnected = Boolean(result.hostConnected);
      renderAll();
      if (showSuccess) showToast("Telemetria atualizada.");
    } catch (error) {
      const status = error instanceof Error ? error.status : undefined;
      if (status === 403) {
        window.location.replace("/admin");
        return;
      }
      showToast(error instanceof Error ? error.message : "Não foi possível carregar a telemetria.", "error");
    } finally {
      button?.classList.remove("is-loading");
      if (button) button.disabled = false;
    }
  }

  async function logout() {
    try {
      const config = await window.RemoteCodexAuth?.loadConfig?.();
      if (config) await window.RemoteCodexAuth?.signOut?.(config);
    } catch { window.RemoteCodexAuth?.clearSession?.(); }
    finally { window.location.replace("/login"); }
  }

  function bindEvents() {
    $("#telemetry-search")?.addEventListener("input", (event) => { state.search = event.currentTarget.value || ""; renderAdmins(); renderAccounts(); renderAudits(); });
    $("#telemetry-action-filter")?.addEventListener("change", (event) => { state.filter = event.currentTarget.value; renderAudits(); });
    $("#telemetry-refresh")?.addEventListener("click", () => loadTelemetry(true));
    $$('[data-section]').forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.section === "overview") window.location.replace("/admin");
      if (button.dataset.section === "groups") window.location.replace("/groups");
    }));
    $("[data-admin-logout]")?.addEventListener("click", logout);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const identity = await ensureOwnerAccess();
    if (!identity) {
      if (!getAuthToken()) window.location.replace("/login");
      return;
    }
    window.FecartAdminShell?.setIdentity?.(identity);
    document.body.classList.remove("admin-auth-pending");
    document.body.classList.add("admin-auth-ready");
    bindEvents();
    await loadTelemetry();
  });
})();

export {};
