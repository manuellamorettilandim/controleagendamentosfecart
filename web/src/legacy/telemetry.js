(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { admins: [], accounts: [], audits: [], report: null, search: "", filter: "all", activePanel: "audit", generatedAt: null, hostConnected: false, toastTimer: null, identity: null };

  const actionLabels = {
    "reservation.approve": ["Aprovou solicitação", "approved", "ph-check-circle"],
    "reservation.approve.unchanged": ["Aprovou solicitação", "approved", "ph-check-circle"],
    "reservation.approve.upgrade": ["Aprovou com upgrade", "approved", "ph-arrow-up"],
    "reservation.approve.downgrade": ["Aprovou com downgrade", "warning", "ph-arrow-down"],
    "reservation.reject": ["Recusou solicitação", "rejected", "ph-x-circle"],
    "reservation.expire": ["Expirou automaticamente", "warning", "ph-clock-countdown"],
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
    "session.quota.exhausted": ["Bloqueou sessão por cota", "warning", "ph-gauge"],
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
    if (Number.isFinite(Number(metadata.quotaBudgetPercent))) safe.push(`Cota aprovada: ${Number(metadata.quotaBudgetPercent)}%`);
    if (Number.isFinite(Number(metadata.quotaConsumedPercent))) safe.push(`Consumo detectado: ${Number(metadata.quotaConsumedPercent)}%`);
    if (text(metadata.reason) === "quota_budget_reached") safe.push("Bloqueio automático do sistema");
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
    if (state.identity?.role !== "owner") {
      const peopleCard = $("#telemetry-people-card");
      if (peopleCard) peopleCard.hidden = true;
      return;
    }
    const query = state.search.toLocaleLowerCase("pt-BR");
    const admins = state.admins.filter((admin) => !query || `${adminLogin(admin)} ${admin.role}`.toLocaleLowerCase("pt-BR").includes(query));
    $("#telemetry-people-total").textContent = String(admins.length);
    $("#telemetry-admins-body").innerHTML = admins.length ? admins.map((admin) => {
      const login = adminLogin(admin);
      const lastAccess = admin.last_sign_in_at;
      const createdAt = admin.created_at || admin.auth_created_at;
      return `<tr>
        <td><div class="telemetry-person"><span>${escapeHtml(initials(login))}</span><div><strong>${escapeHtml(login)}</strong><small>${escapeHtml(admin.email || "Autenticação local")}</small></div></div></td>
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
    if (state.identity?.role !== "owner") {
      const auditCard = $("#telemetry-audit-card");
      if (auditCard) auditCard.hidden = true;
      const auditTab = $("#telemetry-tab-audit");
      if (auditTab) auditTab.hidden = true;
      selectActivityTab("ranking");
      return;
    }
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

  function renderReport() {
    const report = state.report;
    if (!report) return;

    $("#rep-summary-groups").textContent = `${report.summary.activeGroups} / ${report.summary.totalGroups}`;
    $("#rep-summary-quota").textContent = `${Number(report.summary.totalWeeklyQuotaUsedPercent || 0).toLocaleString("pt-BR")}%`;
    $("#rep-summary-capacity").textContent = `${Number(report.summary.quotaCapacityUtilizationPercent || 0).toLocaleString("pt-BR")}% de ${Number(report.summary.totalQuotaCapacityPercent || 0).toLocaleString("pt-BR")}% disponíveis`;
    $("#rep-summary-waste").textContent = `${Number(report.summary.totalWeeklyQuotaWastedPercent || 0).toLocaleString("pt-BR")}%`;
    $("#rep-summary-balance").textContent = `${Number(report.summary.totalWeeklyQuotaRemainingPercent || 0).toLocaleString("pt-BR")}% ainda disponível`;
    $("#rep-summary-hours").textContent = `${Number(report.summary.totalReservedHours || 0).toLocaleString("pt-BR")}h / ${Number(report.summary.totalObservedUsageHours || 0).toLocaleString("pt-BR")}h`;
    $("#rep-summary-sessions").textContent = `${Number(report.summary.reservationUtilizationPercent || 0).toLocaleString("pt-BR")}% de utilização · ${report.summary.totalSessionsActivated} sessões`;
    $("#rep-summary-attributed-tokens").textContent = report.summary.totalAttributedTokens.toLocaleString("pt-BR");
    $("#rep-summary-models").textContent = `${(report.models || []).length} modelos · ${Number(report.summary.totalReasoningTokens || 0).toLocaleString("pt-BR")} thinking`;
    $("#rep-summary-total-tokens").textContent = report.summary.grandTotalTokens.toLocaleString("pt-BR");
    $("#rep-summary-unattributed").textContent = `${report.summary.totalUnattributedTokens.toLocaleString("pt-BR")} não atribuídos`;

    const query = state.search.toLocaleLowerCase("pt-BR");
    const groups = (report.groups || []).filter((g) => !query || g.groupName.toLocaleLowerCase("pt-BR").includes(query) || g.username.toLocaleLowerCase("pt-BR").includes(query));

    const tbody = $("#report-groups-body");
    if (!tbody) return;

    tbody.innerHTML = groups.length ? groups.map((g) => `
      <tr>
        <td><span class="report-rank${g.rank <= 3 ? ` is-top-${g.rank}` : ""}"><b>${g.rank}º</b></span></td>
        <td><strong>${escapeHtml(g.groupName)}</strong><br><small style="color: var(--text-muted);">${escapeHtml(g.username)}</small></td>
        <td><span class="badge ${g.sessionsActivated > 0 ? "badge-success" : "badge-neutral"}">${g.sessionsActivated} ativadas</span><br><small>${g.sessionsApproved} aprovadas / ${g.sessionsRequested} pedidas</small></td>
        <td><strong>${g.approvedHours}h / ${Number(g.observedUsageHours || 0).toLocaleString("pt-BR")}h</strong><br><small>${Number(g.reservationUtilizationPercent || 0).toLocaleString("pt-BR")}% utilizada</small></td>
        <td><strong>${g.totalTokens.toLocaleString("pt-BR")}</strong><br><small style="color: var(--text-muted);">${g.shareOfTotalPercent}% do total atribuído</small></td>
        <td>${g.inputTokens.toLocaleString("pt-BR")}</td>
        <td><em style="color: var(--text-muted);">${g.cachedInputTokens.toLocaleString("pt-BR")}</em></td>
        <td>${g.outputTokens.toLocaleString("pt-BR")}</td>
        <td><em style="color: var(--text-muted);">${g.reasoningTokens.toLocaleString("pt-BR")}</em></td>
        <td><span class="badge ${g.cacheEfficiencyPercent >= 20 ? 'badge-success' : 'badge-neutral'}">${g.cacheEfficiencyPercent}%</span></td>
        <td><strong>${Number(g.weeklyQuotaUsedPercent || 0).toLocaleString("pt-BR")}%</strong><br><small>${Number(g.totalQuotaConsumedPercent || 0).toLocaleString("pt-BR")}% aprovada</small></td>
        <td><strong>${escapeHtml((g.modelsUsed || []).map((model) => model.modelId).join(", ") || "—")}</strong><br><small>${escapeHtml((g.accountLabelsUsed || g.accountsUsed || []).join(", ") || "—")}</small></td>
        <td>${g.lastUsageAt ? escapeHtml(formatRelative(g.lastUsageAt)) : "—"}</td>
      </tr>
    `).join("") : '<tr><td colspan="13" class="telemetry-empty">Nenhum grupo com atividade no período.</td></tr>';
  }

  function renderAll() {
    renderSummary();
    renderAdmins();
    renderAccounts();
    renderAudits();
    renderReport();
    $("#telemetry-updated-at").textContent = state.generatedAt ? `Atualizado em ${formatDateTime(state.generatedAt)}` : "—";
  }

  function selectActivityTab(tab, focus = false) {
    const selected = tab === "ranking" ? "ranking" : "audit";
    state.activePanel = selected;
    $$('[data-telemetry-tab]').forEach((button) => {
      const active = button.dataset.telemetryTab === selected;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus();
    });
    $$('[data-telemetry-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.telemetryPanel !== selected;
    });
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

  function getReportRange() {
    const fromInput = $("#report-date-from");
    const toInput = $("#report-date-to");
    const fromVal = fromInput?.value || "2026-08-20";
    const toVal = toInput?.value || "2026-08-24";
    const fromIso = new Date(`${fromVal}T00:00:00`).toISOString();
    const toIso = new Date(`${toVal}T23:59:59.999`).toISOString();
    return { from: fromIso, to: toIso, timeZone: "America/Sao_Paulo" };
  }

  async function loadReportPreview() {
    const previewBtn = $("#report-preview-btn");
    previewBtn?.classList.add("is-loading");
    if (previewBtn) previewBtn.disabled = true;
    try {
      const access = await ensureAdminAccess();
      if (!access) throw new Error("Sessão administrativa expirada. Faça login novamente.");
      const token = getAuthToken();
      const payload = getReportRange();
      const response = await fetch("/api/admin/reports/usage/preview", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Falha ao carregar prévia do relatório.");
      }
      state.report = await response.json();
      renderReport();
      showToast("Prévia do relatório consolidada.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Erro ao carregar prévia do relatório.", "error");
    } finally {
      previewBtn?.classList.remove("is-loading");
      if (previewBtn) previewBtn.disabled = false;
    }
  }

  async function exportReportDownload(format) {
    const btn = $(`#report-export-${format}`);
    btn?.classList.add("is-loading");
    if (btn) btn.disabled = true;
    try {
      const access = await ensureAdminAccess();
      if (!access) throw new Error("Sessão administrativa expirada. Faça login novamente.");
      const token = getAuthToken();
      const payload = getReportRange();
      const response = await fetch(`/api/admin/reports/usage/export/${format}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Falha ao exportar ${format.toUpperCase()}.`);
      }

      // Extrair nome do arquivo do cabeçalho Content-Disposition
      let filename = `relatorio-fecart.${format}`;
      const disposition = response.headers.get("Content-Disposition");
      if (disposition && disposition.includes("filename=")) {
        const match = /filename="?([^"]+)"?/.exec(disposition);
        if (match?.[1]) filename = match[1];
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast(`Download de ${filename} concluído.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : `Erro ao exportar ${format.toUpperCase()}.`, "error");
    } finally {
      btn?.classList.remove("is-loading");
      if (btn) btn.disabled = false;
    }
  }

  async function ensureAdminAccess() {
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
      if (identity.role !== "owner" && identity.role !== "admin") {
        window.location.replace("/dashboard");
        return null;
      }
      return identity;
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
    $$('[data-telemetry-tab]').forEach((button) => {
      button.addEventListener("click", () => selectActivityTab(button.dataset.telemetryTab));
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        selectActivityTab(state.activePanel === "audit" ? "ranking" : "audit", true);
      });
    });
    $("#telemetry-search")?.addEventListener("input", (event) => {
      state.search = event.currentTarget.value || "";
      renderAdmins();
      renderAccounts();
      renderAudits();
      renderReport();
    });
    $("#telemetry-action-filter")?.addEventListener("change", (event) => { state.filter = event.currentTarget.value; renderAudits(); });
    $("#telemetry-refresh")?.addEventListener("click", () => {
      loadTelemetry(true);
      loadReportPreview();
    });

    $("#report-preset-30d")?.addEventListener("click", () => {
      const now = new Date();
      const past = new Date(now.getTime() - 30 * 86400000);
      const fromInput = $("#report-date-from");
      const toInput = $("#report-date-to");
      if (fromInput) fromInput.value = past.toISOString().slice(0, 10);
      if (toInput) toInput.value = now.toISOString().slice(0, 10);
      loadReportPreview();
    });

    $("#report-preset-7d")?.addEventListener("click", () => {
      const now = new Date();
      const past = new Date(now.getTime() - 7 * 86400000);
      const fromInput = $("#report-date-from");
      const toInput = $("#report-date-to");
      if (fromInput) fromInput.value = past.toISOString().slice(0, 10);
      if (toInput) toInput.value = now.toISOString().slice(0, 10);
      loadReportPreview();
    });

    $("#report-preset-all")?.addEventListener("click", () => {
      const fromInput = $("#report-date-from");
      const toInput = $("#report-date-to");
      if (fromInput) fromInput.value = "2026-08-01";
      if (toInput) toInput.value = new Date().toISOString().slice(0, 10);
      loadReportPreview();
    });

    $("#report-preview-btn")?.addEventListener("click", () => loadReportPreview());
    $("#report-export-pdf")?.addEventListener("click", () => exportReportDownload("pdf"));
    $("#report-export-xlsx")?.addEventListener("click", () => exportReportDownload("xlsx"));
    $("#report-export-csv")?.addEventListener("click", () => exportReportDownload("csv"));

    $$('[data-section]').forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.section === "overview") window.location.replace("/admin");
      if (button.dataset.section === "groups") window.location.replace("/groups");
    }));
    $("[data-admin-logout]")?.addEventListener("click", logout);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const identity = await ensureAdminAccess();
    if (!identity) {
      if (!getAuthToken()) window.location.replace("/login");
      return;
    }
    state.identity = identity;
    window.FecartAdminShell?.setIdentity?.(identity);
    document.body.classList.remove("admin-auth-pending");
    document.body.classList.add("admin-auth-ready");

    // Preencher datas padrão (últimos 30 dias até hoje)
    const fromInput = $("#report-date-from");
    const toInput = $("#report-date-to");
    const nowIso = new Date().toISOString().slice(0, 10);
    const thirtyDaysAgoIso = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    if (fromInput && !fromInput.value) fromInput.value = thirtyDaysAgoIso;
    if (toInput && !toInput.value) toInput.value = nowIso;

    bindEvents();
    await loadTelemetry();
    await loadReportPreview();
  });
})();

export {};
