(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const components = () => window.FecartComponents;
  const calendarTools = () => window.FecartCalendar;
  const preview = ["localhost", "127.0.0.1"].includes(window.location.hostname) && window.location.hash === "#preview";
  const state = {
    config: null,
    data: null,
    calendar: null,
    selectedAccountId: null,
    calendarView: window.matchMedia("(max-width: 720px)").matches ? "timeGridDay" : "timeGridWeek",
    visibleEnd: null,
    bookingMax: null,
    nowOffset: 0,
    tokenVisible: false,
    tokenReservationId: null,
    copyMode: "token",
    activationInFlight: null,
    activationError: null,
    notificationOpen: false,
    hoverStart: null,
    hoverButton: null,
    calendarHoverBound: false,
    actionReservationId: null,
    actionKind: null,
    endedReservationIds: new Set(),
    loading: false,
  };

  function now() {
    return new Date(Date.now() + state.nowOffset);
  }

  function localDateAt(base, hour, minute = 0) {
    const date = calendarTools().startOfDay(base);
    date.setHours(hour, minute, 0, 0);
    return date;
  }

  function dateAtOffset(offset, hour, minute = 0, base = new Date()) {
    const date = calendarTools().addDays(calendarTools().startOfDay(base), offset);
    date.setHours(hour, minute, 0, 0);
    return date;
  }

  function dateInputValue(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function timeInputValue(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function inputDateTime(dateValue, timeValue) {
    if (!dateValue || !timeValue) return null;
    const date = new Date(`${dateValue}T${timeValue}:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDuration(hours) {
    const totalMinutes = Math.max(0, Math.round(Number(hours || 0) * 60));
    const wholeHours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (!wholeHours) return `${minutes}min`;
    return minutes ? `${wholeHours}h ${String(minutes).padStart(2, "0")}m` : `${wholeHours}h`;
  }

  function formatRelative(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const minutes = Math.max(0, Math.floor((now().getTime() - date.getTime()) / 60_000));
    if (minutes < 1) return "agora";
    if (minutes < 60) return `há ${minutes} min`;
    if (minutes < 1_440) return `há ${Math.floor(minutes / 60)}h`;
    return components().formatDateTime(date);
  }

  function localTokenKey(reservationId) {
    return `remote_codex_reservation_${reservationId}`;
  }

  function tokenFor(reservation) {
    if (preview && state.data?.previewToken) return state.data.previewToken;
    if (!reservation) return null;
    try {
      const stored = JSON.parse(window.localStorage.getItem(localTokenKey(reservation.id)) || "null");
      if (!stored?.token || (stored.expiresAt && Date.parse(stored.expiresAt) <= now().getTime())) {
        window.localStorage.removeItem(localTokenKey(reservation.id));
        return null;
      }
      return stored.token;
    } catch {
      return null;
    }
  }

  function sessionLimitReached(reservation) {
    const device = deviceFor(reservation);
    return device?.status === "limited" || Boolean(device?.usage_limit_reached_at);
  }

  function sessionTokenAvailable(reservation) {
    return Boolean(tokenFor(reservation) && !sessionLimitReached(reservation));
  }

  function remoteCliUrl() {
    const isSecure = window.location.protocol === "https:";
    const protocol = isSecure ? "wss:" : "ws:";
    const defaultPort = isSecure ? "443" : (window.location.port || "80");
    const hostWithPort = window.location.port ? window.location.host : `${window.location.hostname}:${defaultPort}`;
    return `${protocol}//${hostWithPort}`;
  }

  function cliCommandFor(token) {
    return `$env:CODEX_REMOTE_TOKEN = "${token}"; codex --remote ${remoteCliUrl()} --remote-auth-token-env CODEX_REMOTE_TOKEN`;
  }

  function formatTokenCount(value) {
    const count = Number(value);
    return Number.isFinite(count) && count >= 0 ? Math.floor(count).toLocaleString("pt-BR") : "0";
  }

  function issuedDeviceSnapshot(device) {
    if (!device || typeof device !== "object") return null;
    const usage = device.usage && typeof device.usage === "object" ? device.usage : {};
    const resetSeconds = Number(usage.accountResetsAt);
    return {
      device_id: device.deviceId || null,
      reservation_id: device.reservationId || null,
      status: device.status || "active",
      expires_at: device.expiresAt || null,
      last_seen_at: device.lastSeenAt || null,
      observed_tokens: Number(usage.observedTokens || 0),
      observed_input_tokens: Number(usage.observedInputTokens || 0),
      observed_cached_input_tokens: Number(usage.observedCachedInputTokens || 0),
      observed_output_tokens: Number(usage.observedOutputTokens || 0),
      observed_reasoning_tokens: Number(usage.observedReasoningTokens || 0),
      usage_last_seen_at: usage.lastUsageAt || null,
      account_used_percent: usage.accountUsedPercent ?? null,
      account_window_duration_mins: usage.accountWindowDurationMins ?? null,
      account_resets_at: Number.isFinite(resetSeconds) && resetSeconds > 0 ? new Date(resetSeconds * 1_000).toISOString() : null,
      quota_base_used_percent: device.quotaBaseUsedPercent ?? null,
      quota_budget_percent: device.quotaBudgetPercent ?? null,
      usage_limit_reached_at: usage.usageLimitReachedAt || null,
    };
  }

  function rememberIssuedSession(reservation, result) {
    const token = typeof result?.token === "string" && result.token ? result.token : null;
    if (!token) throw new Error("O host não retornou o token real da sessão.");
    const device = result?.device && typeof result.device === "object" ? result.device : null;
    const expiresAt = device?.expiresAt || reservation.ends_at;
    window.localStorage.setItem(localTokenKey(reservation.id), JSON.stringify({
      token,
      deviceId: device?.deviceId || null,
      expiresAt,
    }));
    reservation.device_id = device?.deviceId || reservation.device_id || null;
    reservation.activated_at = reservation.activated_at || new Date().toISOString();
    if (device?.quotaBaseUsedPercent !== undefined) reservation.quota_base_used_percent = device.quotaBaseUsedPercent;
    if (device?.quotaBudgetPercent !== undefined) reservation.quota_budget_percent = device.quotaBudgetPercent;
    const snapshot = issuedDeviceSnapshot(device);
    if (snapshot?.device_id) {
      state.data.devices = [snapshot, ...(state.data.devices || []).filter((item) => item.reservation_id !== reservation.id)];
    }
    state.activationError = null;
  }

  function activeReservation() {
    const timestamp = now().getTime();
    return (state.data?.reservations || []).find((item) => {
      return item.status === "scheduled" && item.approval_status === "approved" && !reservationIsEnded(item) && Date.parse(item.starts_at) <= timestamp && Date.parse(item.ends_at) > timestamp;
    }) || null;
  }

  function deviceFor(reservation) {
    if (!reservation) return null;
    if (reservation.device_id) {
      return (state.data?.devices || []).find((item) => item.device_id === reservation.device_id)
        || (state.data?.devices || []).find((item) => item.reservation_id === reservation.id)
        || null;
    }
    return (state.data?.devices || []).find((item) => item.reservation_id === reservation.id && item.status !== "revoked") || null;
  }

  function reservationById(reservationId) {
    return (state.data?.reservations || []).find((item) => item.id === reservationId) || null;
  }

  function reservationIsEnded(reservation) {
    if (!reservation) return true;
    if (reservation.status === "cancelled") return true;
    if (state.endedReservationIds.has(reservation.id)) return true;
    if (reservation.device_id && deviceFor(reservation)?.status === "revoked") return true;
    if (Date.parse(reservation.ends_at) <= now().getTime()) return true;
    return false;
  }

  function readyAccounts() {
    return (state.data?.accounts || []).filter((account) => account.status === "ready");
  }

  function selectedAccount() {
    const accounts = readyAccounts();
    return accounts.find((account) => account.account_id === state.selectedAccountId) || accounts[0] || null;
  }

  function mockData() {
    const base = new Date();
    const today = calendarTools().startOfDay(base);
    const activeStart = new Date(base);
    activeStart.setMinutes(0, 0, 0);
    activeStart.setHours(Math.max(0, activeStart.getHours() - 1));
    const activeEnd = new Date(activeStart);
    activeEnd.setHours(activeEnd.getHours() + 3);
    const pastStart = dateAtOffset(-4, 9, 0, base);
    const pastEnd = new Date(pastStart);
    pastEnd.setHours(pastEnd.getHours() + 2);
    const tomorrow = dateAtOffset(1, 22, 0, base);
    const tomorrowEnd = new Date(tomorrow);
    tomorrowEnd.setHours(tomorrowEnd.getHours() + 1);
    const secondDay = dateAtOffset(2, 14, 0, base);
    const secondDayEnd = new Date(secondDay);
    secondDayEnd.setHours(secondDayEnd.getHours() + 2);

    return {
      serverTime: new Date().toISOString(),
      previewToken: "fecart_ai_9f3e7b2a1c4d8e9f6a2b3c4d5e6f7a8b",
      relay: { ready: true, hostConnected: true, registered: true, activeDevices: 1 },
      profile: { user_id: "preview-user", username: "renan", group_name: "Equipe de desenvolvimento", enabled: true, weekly_quota_percent: 20 },
      accounts: [
        { account_id: "account-1", label: "Account 1", status: "ready", is_default: true, usage: { used_percent: 12 }, observed_at: new Date().toISOString() },
        { account_id: "account-2", label: "Account 2", status: "ready", is_default: false, usage: { used_percent: 7 }, observed_at: new Date().toISOString() },
      ],
      reservations: [
        { id: "preview-active", account_id: "account-1", starts_at: activeStart.toISOString(), ends_at: activeEnd.toISOString(), status: "scheduled", approval_status: "approved", requested_quota_percent: 20, activated_at: activeStart.toISOString(), created_at: pastStart.toISOString(), quota_base_used_percent: 0, quota_budget_percent: 20 },
        { id: "preview-past", account_id: "account-1", starts_at: pastStart.toISOString(), ends_at: pastEnd.toISOString(), status: "scheduled", approval_status: "approved", requested_quota_percent: 10, created_at: pastStart.toISOString(), quota_base_used_percent: 0, quota_budget_percent: 10 },
        { id: "preview-upcoming", account_id: "account-1", starts_at: tomorrow.toISOString(), ends_at: tomorrowEnd.toISOString(), status: "scheduled", approval_status: "approved", requested_quota_percent: 15, created_at: new Date().toISOString(), quota_base_used_percent: 0, quota_budget_percent: 15 },
        { id: "preview-approved", account_id: "account-2", starts_at: secondDay.toISOString(), ends_at: secondDayEnd.toISOString(), status: "scheduled", approval_status: "approved", requested_quota_percent: 15, created_at: new Date().toISOString(), quota_base_used_percent: 0, quota_budget_percent: 15 },
      ],
      devices: [
        { device_id: "preview-device", reservation_id: "preview-active", status: "active", expires_at: activeEnd.toISOString(), last_seen_at: new Date(Date.now() - 12 * 60_000).toISOString(), observed_tokens: 12400, observed_input_tokens: 9200, observed_output_tokens: 3200, account_used_percent: 12, account_resets_at: calendarTools().addDays(today, 4).toISOString(), quota_base_used_percent: 0, quota_budget_percent: 20 },
      ],
      busySlots: [
        { account_id: "account-1", starts_at: dateAtOffset(1, 18, 0, base).toISOString(), ends_at: dateAtOffset(1, 20, 0, base).toISOString() },
        { account_id: "account-2", starts_at: dateAtOffset(2, 10, 0, base).toISOString(), ends_at: dateAtOffset(2, 12, 0, base).toISOString() },
      ],
    };
  }

  async function api(path, options = {}, retry = true) {
    const session = window.RemoteCodexAuth.getSession();
    if (!session?.access_token) {
      window.location.replace("/login");
      throw new Error("Sessão ausente.");
    }
    const response = await fetch(path, {
      ...options,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      cache: "no-store",
    });
    if (response.status === 401 && retry && session.refresh_token && state.config) {
      await window.RemoteCodexAuth.refreshSession(state.config);
      return api(path, options, false);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Não foi possível concluir a operação.");
    return data;
  }

  function buildCalendarBounds() {
    const today = calendarTools().startOfDay(now());
    let visibleEnd = new Date(today.getFullYear(), 8, 30, 23, 59, 59, 999);
    if (today.getTime() > visibleEnd.getTime()) visibleEnd = new Date(today.getFullYear() + 1, 8, 30, 23, 59, 59, 999);
    state.visibleEnd = visibleEnd;
    const bookingMax = calendarTools().addDays(today, 3);
    bookingMax.setHours(23, 0, 0, 0);
    state.bookingMax = new Date(Math.min(visibleEnd.getTime(), bookingMax.getTime()));
  }

  function calendarRangeEnd() {
    const end = calendarTools().startOfDay(state.visibleEnd);
    end.setDate(end.getDate() + 1);
    return end;
  }

  function loadDashboardData(data) {
    state.data = data;
    state.nowOffset = data.serverTime ? Date.parse(data.serverTime) - Date.now() : 0;
    buildCalendarBounds();
    if (!state.selectedAccountId || !readyAccounts().some((account) => account.account_id === state.selectedAccountId)) {
      state.selectedAccountId = readyAccounts().find((account) => account.is_default)?.account_id || readyAccounts()[0]?.account_id || null;
    }
    renderAll();
  }

  async function ensureActiveSession() {
    if (preview) return;
    const reservation = activeReservation();
    if (!reservation) {
      state.activationError = null;
      return;
    }
    if (sessionTokenAvailable(reservation)) return;
    if (reservation.device_id) {
      state.activationError = "O token desta sessão já foi emitido. Use a cópia guardada neste navegador.";
      return;
    }
    if (state.activationInFlight === reservation.id) return;

    state.activationInFlight = reservation.id;
    state.activationError = null;
    renderToken();
    renderSession();
    try {
      const result = await api(`/api/user/reservations/${encodeURIComponent(reservation.id)}/session`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      rememberIssuedSession(reservation, result);
    } finally {
      state.activationInFlight = null;
      renderAll();
    }
  }

  async function loadDashboard(silent = false) {
    if (!silent) {
      state.loading = true;
      $("#session-refresh").textContent = "sincronizando";
    }
    try {
      const data = preview ? mockData() : await api("/api/user/dashboard");
      loadDashboardData(data);
      if (!preview) {
        try {
          await ensureActiveSession();
        } catch (error) {
          state.activationError = error instanceof Error ? error.message : "Não foi possível ativar a sessão.";
          renderAll();
          if (!silent) components().showToast(state.activationError, "warning");
        }
      }
      $("#session-refresh").textContent = `atualizado ${formatRelative(new Date())}`;
    } finally {
      state.loading = false;
    }
  }

  function activateTab(name) {
    const overview = name === "overview";
    document.querySelectorAll(".main-tab").forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    $("#overview-view").hidden = !overview;
    $("#guides-view").hidden = overview;
    if (overview && state.calendar) window.setTimeout(() => state.calendar.updateSize?.(), 40);
  }

  function renderAccounts() {
    const switcher = $("#account-switcher");
    const bookingAccount = $("#booking-account");
    const accounts = readyAccounts();
    switcher.innerHTML = accounts.length
      ? accounts.map((account) => `<button class="account-button ${account.account_id === state.selectedAccountId ? "is-active" : ""}" type="button" role="tab" aria-selected="${account.account_id === state.selectedAccountId}" data-account-id="${components().escapeHTML(account.account_id)}">${components().escapeHTML(account.label || account.account_id)}</button>`).join("")
      : `<span class="notification-empty">Nenhuma conta pronta no momento.</span>`;
    switcher.querySelectorAll("[data-account-id]").forEach((button) => button.addEventListener("click", () => {
      state.selectedAccountId = button.dataset.accountId;
      renderAccounts();
      renderCalendar();
      renderBookingOptions();
    }));

    bookingAccount.innerHTML = accounts.map((account) => `<option value="${components().escapeHTML(account.account_id)}">${components().escapeHTML(account.label || account.account_id)}</option>`).join("");
    if (selectedAccount()) bookingAccount.value = selectedAccount().account_id;
  }

  function renderToken() {
    const reservation = activeReservation();
    const reservationId = reservation?.id || null;
    if (state.tokenReservationId !== reservationId) {
      state.tokenReservationId = reservationId;
      state.tokenVisible = false;
    }
    const usable = sessionTokenAvailable(reservation);
    const token = usable ? tokenFor(reservation) : null;
    const tokenNode = $("#session-token");
    const toggle = $("#toggle-token");
    const tokenLine = $("#token-copy-line");
    const cliLine = $("#cli-copy-line");
    const visible = Boolean(token && state.tokenVisible);
    const showingToken = state.copyMode === "token";
    tokenNode.dataset.token = token || "";
    tokenNode.textContent = visible ? token : "••••••••••••••••••••••••";
    toggle.disabled = !token;
    toggle.setAttribute("aria-pressed", String(visible));
    toggle.setAttribute("aria-label", visible ? "Ocultar token" : "Mostrar token");
    toggle.innerHTML = `<i class="ph ${visible ? "ph-eye-slash" : "ph-eye"}" aria-hidden="true"></i><span>${visible ? "Ocultar" : "Mostrar"}</span>`;
    tokenLine.hidden = !showingToken;
    cliLine.hidden = showingToken;
    $("#access-copy-status").textContent = state.activationInFlight
      ? "Gerando o token real no host central…"
      : state.activationError
        ? state.activationError
        : sessionLimitReached(reservation)
          ? "A cota desta sessão foi atingida; o token foi bloqueado."
          : token
            ? showingToken
              ? (visible ? "Token revelado neste navegador. Oculte-o quando terminar." : "Token disponível para a sessão ativa.")
              : (visible ? "Comando pronto com o token revelado." : "Comando pronto com o token protegido.")
            : "O acesso temporário aparece quando houver uma sessão ativa neste navegador.";

    const commandNode = $("#cli-command");
    const maskedToken = "••••••••••••••••";
    const displayToken = visible && token ? token : maskedToken;
    commandNode.textContent = cliCommandFor(displayToken);
    const copyCommand = $("#copy-cli-command");
    copyCommand.disabled = !token;
  }

  function renderStats() {
    const cutoff = now().getTime() - 30 * 24 * 60 * 60_000;
    const reservations = (state.data?.reservations || []).filter((item) => item.approval_status === "approved" && Date.parse(item.starts_at) >= cutoff);
    const hours = reservations.reduce((sum, item) => sum + Math.max(0, (Date.parse(item.ends_at) - Date.parse(item.starts_at)) / 3_600_000), 0);
    const days = new Set(reservations.map((item) => new Date(item.starts_at).toLocaleDateString("pt-BR"))).size;
    const accesses = (state.data?.devices || [])
      .flatMap((device) => [device.last_seen_at, device.activated_at])
      .filter(Boolean)
      .sort((a, b) => Date.parse(b) - Date.parse(a));
    const lastAccess = accesses[0] ? new Date(accesses[0]) : null;
    const today = calendarTools().sameDay(lastAccess || new Date(0), now());
    $("#stat-approved").textContent = String(reservations.length);
    $("#stat-hours").textContent = formatDuration(hours);
    $("#stat-days").textContent = String(days);
    $("#stat-last-access").textContent = lastAccess ? (today ? `Hoje, ${components().formatTime(lastAccess)}` : components().formatDateTime(lastAccess)) : "—";
    $("#stat-last-access-note").textContent = lastAccess ? formatRelative(lastAccess) : "aguardando dados";
  }

  function renderSession() {
    const reservation = activeReservation();
    const device = deviceFor(reservation);
    const status = $("#session-status");
    const dot = $("#session-dot");
    const observedTokens = Number(device?.observed_tokens || 0);
    const lastActivity = device?.usage_last_seen_at || null;
    const lastSeen = device?.last_seen_at || null;
    $("#session-usage-tokens").textContent = `${formatTokenCount(observedTokens)} tokens observados`;

    if (reservation) {
      const start = new Date(reservation.starts_at);
      const end = new Date(reservation.ends_at);
      const total = Math.max(1, end.getTime() - start.getTime());
      const elapsed = Math.max(0, Math.min(total, now().getTime() - start.getTime()));
      const percentage = Math.round((elapsed / total) * 100);
      const limited = sessionLimitReached(reservation);
      components().setProgress($("#session-progress"), percentage, `${percentage}% do tempo da sessão`);
      $("#session-percent").textContent = `${percentage}%`;
      $("#session-time").textContent = formatDuration(elapsed / 3_600_000);
      $("#session-time-total").textContent = `/ ${formatDuration(total / 3_600_000)}`;
      status.textContent = limited ? "Cota da sessão atingida" : state.activationInFlight ? "Inicializando sessão" : "Sessão ativa";
      dot.classList.toggle("is-active", !limited);
      dot.classList.toggle("is-limited", limited);
      $("#session-started").textContent = state.activationInFlight
        ? "Gerando a credencial real no host central…"
        : limited
          ? "O relay bloqueou o token ao atingir a cota solicitada."
          : `Ativa desde ${components().formatDateTime(start)}`;

      const budget = Number(device?.quota_budget_percent ?? reservation.requested_quota_percent ?? state.data?.profile?.weekly_quota_percent ?? 20);
      const used = Number(device?.account_used_percent ?? 0);
      const quotaPercentage = budget > 0 ? Math.min(100, Math.max(0, Math.round((used / budget) * 100))) : 0;
      components().setProgress($("#quota-progress"), quotaPercentage, `${quotaPercentage}% da cota semanal`);
      $("#quota-percent").textContent = `${quotaPercentage}%`;
      $("#quota-used").textContent = `${used}%`;
      $("#quota-total").textContent = `/ ${budget}%`;
      $("#session-activity").textContent = limited
        ? "Monitoramento encerrado por limite de cota."
        : state.activationInFlight
          ? "Aguardando o host central emitir o token."
          : lastActivity
            ? `Última atividade ${formatRelative(lastActivity)}.`
            : lastSeen
              ? `CLI conectado ${formatRelative(lastSeen)}; aguardando uso.`
              : device
                ? "Token pronto; abra o Codex CLI para começar."
                : "Token sendo preparado para esta sessão.";
    } else {
      const upcoming = (state.data?.reservations || [])
        .filter((item) => item.status === "scheduled" && Date.parse(item.starts_at) > now().getTime())
        .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0];
      components().setProgress($("#session-progress"), 0, "0% do tempo da sessão");
      components().setProgress($("#quota-progress"), 0, "0% da cota semanal");
      $("#session-percent").textContent = "0%";
      $("#session-time").textContent = "—";
      $("#session-time-total").textContent = "/ —";
      $("#quota-percent").textContent = "0%";
      $("#quota-used").textContent = "0%";
      $("#quota-total").textContent = `/ ${Number(state.data?.profile?.weekly_quota_percent || 20)}%`;
      status.textContent = "Sessão desligada";
      dot.classList.remove("is-active", "is-limited");
      $("#session-started").textContent = upcoming ? `Próxima janela ${components().formatDateTime(upcoming.starts_at)}` : "Ative um horário aprovado para começar.";
      $("#session-activity").textContent = "Aguardando a próxima janela ativa.";
    }
  }

  function reservationsForAccount() {
    return (state.data?.reservations || []).filter((item) => item.account_id === selectedAccount()?.account_id && item.status !== "cancelled");
  }

  function slotConflict(start, durationHours, accountId = selectedAccount()?.account_id) {
    if (!accountId) return true;
    const end = start.getTime() + durationHours * 3_600_000;
    const reservations = (state.data?.reservations || []).filter((item) => item.account_id === accountId && item.status !== "cancelled");
    const busy = (state.data?.busySlots || []).filter((item) => item.account_id === accountId);
    return [...reservations, ...busy].some((item) => Date.parse(item.starts_at) < end && Date.parse(item.ends_at) > start.getTime());
  }

  function isBookable(start, durationHours = 1) {
    const candidate = new Date(start);
    const value = calendarTools().startOfHour(candidate);
    const current = now();
    const currentHour = calendarTools().startOfHour(current);
    if (!selectedAccount() || candidate.getMinutes() !== 0 || candidate.getSeconds() !== 0 || value.getTime() < currentHour.getTime()) return false;
    if (value.getTime() > state.bookingMax.getTime() || value.getHours() + Number(durationHours) > 24) return false;
    return !slotConflict(value, Number(durationHours));
  }

  function calendarEvents() {
    const ownReservations = reservationsForAccount();
    const ownKeys = new Set(ownReservations.map((item) => `${item.starts_at}|${item.ends_at}`));
    const reservations = ownReservations.map((item) => {
      const pending = item.approval_status !== "approved";
      const ended = reservationIsEnded(item);
      const active = !ended && !pending && Date.parse(item.starts_at) <= now().getTime() && Date.parse(item.ends_at) > now().getTime();
      return {
        id: `reservation-${item.id}`,
        title: ended ? "Encerrado" : active ? "Sessão ativa" : pending ? "Pendente" : "Aprovado",
        start: item.starts_at,
        end: item.ends_at,
        className: ["calendar-event-own", pending ? "calendar-event-pending" : "", ended ? "calendar-event-ended" : "", active ? "calendar-event-active" : ""].filter(Boolean).join(" "),
        extendedProps: { kind: "mine", pending, active, ended, reservationId: item.id },
      };
    });
    const busy = (state.data?.busySlots || [])
      .filter((item) => item.account_id === selectedAccount()?.account_id && !ownKeys.has(`${item.starts_at}|${item.ends_at}`))
      .map((item, index) => ({
        id: `busy-${index}-${item.starts_at}`,
        title: "Ocupado",
        start: item.starts_at,
        end: item.ends_at,
        className: "calendar-event-busy",
        extendedProps: { kind: "busy" },
      }));
    return [...reservations, ...busy];
  }

  function updateCalendarNavigation(info) {
    hideCalendarHover();
    const rangeStart = calendarTools().startOfDay(info.start);
    const rangeEnd = new Date(info.end.getTime() - 1);
    $("#calendar-range").textContent = calendarTools().formatRange(rangeStart, calendarTools().startOfDay(rangeEnd));
    $("#calendar-prev").disabled = rangeStart.getTime() <= calendarTools().startOfDay(now()).getTime();
    $("#calendar-next").disabled = rangeEnd.getTime() >= state.visibleEnd.getTime();
    document.querySelectorAll("[data-calendar-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.calendarView === state.calendarView));
  }

  function hideCalendarHover() {
    state.hoverStart = null;
    if (!state.hoverButton) return;
    state.hoverButton.hidden = true;
    state.hoverButton.classList.remove("is-visible");
  }

  function calendarCellRectMatches(rect, x, y) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function updateCalendarHover(event) {
    const board = $("#calendar-board");
    if (!board || !state.calendar || state.calendarView === "listWeek" || !state.hoverButton) {
      hideCalendarHover();
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".calendar-event-own, .calendar-event-busy")) {
      hideCalendarHover();
      return;
    }
    if (target?.closest(".calendar-hover-add")) return;

    const x = event.clientX;
    const y = event.clientY;
    const dayCell = [...board.querySelectorAll('[role="gridcell"][data-date]')].find((cell) => calendarCellRectMatches(cell.getBoundingClientRect(), x, y));
    const slot = [...board.querySelectorAll("[data-time]")].find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.width > 40 && calendarCellRectMatches(rect, x, y);
    });
    if (!dayCell || !slot) {
      hideCalendarHover();
      return;
    }

    const start = calendarTools().startOfHour(new Date(`${dayCell.dataset.date}T${slot.dataset.time}`));
    if (Number.isNaN(start.getTime()) || !isBookable(start, 1)) {
      hideCalendarHover();
      return;
    }

    const boardRect = board.getBoundingClientRect();
    const columnRect = dayCell.getBoundingClientRect();
    const slotRect = slot.getBoundingClientRect();
    const left = Math.max(0, columnRect.left - boardRect.left);
    const top = Math.max(0, slotRect.top - boardRect.top);
    state.hoverStart = start;
    state.hoverButton.style.left = `${Math.round(left)}px`;
    state.hoverButton.style.top = `${Math.round(top)}px`;
    state.hoverButton.style.width = `${Math.round(columnRect.width)}px`;
    state.hoverButton.style.height = `${Math.round(slotRect.height)}px`;
    state.hoverButton.setAttribute("aria-label", `Adicionar agendamento em ${components().formatDateTime(start)}`);
    state.hoverButton.hidden = false;
    state.hoverButton.classList.add("is-visible");
  }

  function bindCalendarHover(board) {
    if (!state.hoverButton || !state.hoverButton.isConnected) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "calendar-hover-add";
      button.hidden = true;
      button.innerHTML = '<i class="ph ph-plus" aria-hidden="true"></i>';
      button.addEventListener("click", () => {
        const start = state.hoverStart ? new Date(state.hoverStart) : null;
        hideCalendarHover();
        if (!start || !isBookable(start, 1)) {
          components().showToast("Esse horário não está mais livre para solicitação.", "warning");
          return;
        }
        openBooking(start, 1);
      });
      board.append(button);
      state.hoverButton = button;
    }
    if (state.calendarHoverBound) return;
    board.addEventListener("pointermove", updateCalendarHover);
    board.addEventListener("pointerleave", hideCalendarHover);
    window.addEventListener("resize", hideCalendarHover);
    state.calendarHoverBound = true;
  }

  function renderCalendar() {
    const board = $("#calendar-board");
    if (!board || !state.data || !state.visibleEnd) return;
    if (!state.calendar) {
      state.calendar = calendarTools().create(board, {
        initialView: state.calendarView,
        initialDate: calendarTools().startOfDay(now()),
        events: calendarEvents(),
        selectable: true,
        selectOverlap: false,
        validRange: { start: calendarTools().startOfDay(now()), end: calendarRangeEnd() },
        selectAllow: (info) => {
          const duration = (info.end.getTime() - info.start.getTime()) / 3_600_000;
          return duration >= 1 && duration <= 3 && isBookable(info.start, duration);
        },
        dateClick: (info) => {
          const start = calendarTools().startOfHour(info.date);
          if (!isBookable(start, 1)) {
            const limit = components().formatDate(state.bookingMax);
            components().showToast(start.getTime() > state.bookingMax.getTime() ? `Solicitações disponíveis até ${limit}.` : "Esse horário não está livre para solicitação.", "warning");
            return;
          }
          openBooking(start, 1);
        },
        select: (info) => {
          const duration = (info.end.getTime() - info.start.getTime()) / 3_600_000;
          state.calendar.unselect();
          if (!isBookable(info.start, duration)) {
            components().showToast("Selecione um horário livre, futuro e de até 3 horas.", "warning");
            return;
          }
          openBooking(info.start, duration);
        },
        eventClick: (info) => {
          if (info.event.extendedProps.kind === "busy") {
            components().showToast("Esse período já está ocupado.", "warning");
            return;
          }
          const reservation = reservationById(info.event.extendedProps.reservationId);
          const kind = reservationActionKind(reservation);
          if (kind) {
            openReservationAction(reservation, kind);
            return;
          }
          if (info.event.extendedProps.ended) components().showToast("Essa sessão já foi encerrada.");
        else if (info.event.extendedProps.pending) components().showToast("Essa solicitação ainda está aguardando aprovação.");
          else components().showToast("Este horário já foi encerrado ou não pode mais ser alterado.");
        },
        eventDidMount: (info) => {
          const reservation = reservationById(info.event.extendedProps.reservationId);
          const action = reservationActionKind(reservation);
          const actionHint = action === "end" ? ". Clique para encerrar a sessão" : action === "cancel" ? ". Clique para cancelar a solicitação" : "";
          info.el.setAttribute("aria-label", `${info.event.title}, ${components().formatDateTime(info.event.start)} até ${components().formatTime(info.event.end)}${actionHint}`);
        },
        datesSet: updateCalendarNavigation,
      });
    } else {
      hideCalendarHover();
      calendarTools().syncEvents(state.calendar, calendarEvents());
      state.calendar.setOption("validRange", { start: calendarTools().startOfDay(now()), end: calendarRangeEnd() });
      state.calendar.updateSize?.();
    }
    bindCalendarHover(board);
    if (state.calendar) updateCalendarNavigation({ start: state.calendar.view.currentStart, end: state.calendar.view.currentEnd });
  }

  function renderBookingOptions() {
    const accounts = readyAccounts();
    const select = $("#booking-account");
    if (!select.options.length || [...select.options].some((option) => option.value !== accounts.find((account) => account.account_id === option.value)?.account_id)) {
      select.innerHTML = accounts.map((account) => `<option value="${components().escapeHTML(account.account_id)}">${components().escapeHTML(account.label || account.account_id)}</option>`).join("");
    }
    if (selectedAccount()) select.value = selectedAccount().account_id;
    const today = calendarTools().startOfDay(now());
    $("#booking-date").min = dateInputValue(today);
    $("#booking-date").max = dateInputValue(state.bookingMax);
  }

  function renderNotifications() {
    const items = [];
    const reservations = (state.data?.reservations || []).slice().sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
    reservations.filter((item) => item.approval_status === "pending" && item.status === "scheduled").slice(0, 3).forEach((item) => {
      items.push({ type: "warning", icon: "ph-clock", title: "Solicitação em análise", message: `${components().formatDateTime(item.starts_at)} · ${formatDuration((Date.parse(item.ends_at) - Date.parse(item.starts_at)) / 3_600_000)} para ${item.account_id}.` });
    });
    reservations.filter((item) => item.approval_status === "approved" && Date.parse(item.ends_at) > now().getTime()).slice(0, 2).forEach((item) => {
      items.push({ type: "success", icon: "ph-check-circle", title: "Horário confirmado", message: `${components().formatDateTime(item.starts_at)} · ${item.account_id}.` });
    });
    if (state.data?.relay && !state.data.relay.ready) items.unshift({ type: "warning", icon: "ph-warning", title: "Host temporariamente offline", message: "As solicitações continuam salvas, mas a ativação será retomada quando o host voltar." });
    if (!items.length) items.push({ type: "info", icon: "ph-check-circle", title: "Tudo em dia", message: "Nenhuma notificação nova por enquanto." });
    $("#notification-badge").hidden = items.length === 1 && items[0].title === "Tudo em dia";
    $("#notification-badge").textContent = String(items.length);
    $("#notification-count").textContent = items.length === 1 && items[0].title === "Tudo em dia" ? "sem novidades" : `${items.length} ${items.length === 1 ? "nova" : "novas"}`;
    $("#notification-list").innerHTML = items.map((item) => `<article class="notification-item is-${item.type}"><i class="ph ${item.icon}" aria-hidden="true"></i><div><strong>${components().escapeHTML(item.title)}</strong><p>${components().escapeHTML(item.message)}</p><time>${item.type === "success" ? "agenda" : "agora"}</time></div></article>`).join("");
  }

  function toggleNotifications(force) {
    state.notificationOpen = typeof force === "boolean" ? force : !state.notificationOpen;
    $("#notifications-popover").hidden = !state.notificationOpen;
    $("#notifications-toggle").setAttribute("aria-expanded", String(state.notificationOpen));
  }

  function nextBookableStart() {
    const current = calendarTools().startOfHour(now());
    if (isBookable(current, 1)) return current;
    const candidate = calendarTools().startOfHour(now());
    candidate.setHours(candidate.getHours() + 1);
    if (candidate.getTime() > state.bookingMax.getTime()) {
      const tomorrow = calendarTools().addDays(calendarTools().startOfDay(now()), 1);
      tomorrow.setHours(9, 0, 0, 0);
      return tomorrow.getTime() <= state.bookingMax.getTime() ? tomorrow : state.bookingMax;
    }
    return candidate;
  }

  function setBookingMessage(message = "") {
    const output = $("#booking-message");
    output.textContent = message;
    output.hidden = !message;
  }

  function updateBookingEnd() {
    const start = inputDateTime($("#booking-date").value, $("#booking-time").value);
    const duration = Number($("#booking-duration").value || 1);
    const end = start ? new Date(start.getTime() + duration * 3_600_000) : null;
    $("#booking-end").value = end ? `${components().formatDate(end)} · ${components().formatTime(end)}` : "";
  }

  function openBooking(start = null, duration = 1) {
    hideCalendarHover();
    if (!readyAccounts().length) {
      components().showToast("Nenhuma conta está pronta para receber agendamentos.", "warning");
      return;
    }
    let value = start ? calendarTools().startOfHour(start) : nextBookableStart();
    const currentHour = calendarTools().startOfHour(now());
    if (value.getTime() < currentHour.getTime() || value.getTime() > state.bookingMax.getTime()) value = nextBookableStart();
    $("#booking-account").value = selectedAccount().account_id;
    $("#booking-date").value = dateInputValue(value);
    $("#booking-time").value = timeInputValue(value);
    $("#booking-duration").value = String(Math.min(3, Math.max(1, Math.round(duration))));
    $("#booking-quota").value = "15";
    $("#booking-note").value = "";
    setBookingMessage();
    updateBookingEnd();
    const modal = $("#booking-modal");
    if (typeof modal.showModal === "function") modal.showModal();
    else modal.setAttribute("open", "");
    window.setTimeout(() => $("#booking-date").focus(), 60);
  }

  function closeBooking() {
    const modal = $("#booking-modal");
    if (typeof modal.close === "function") modal.close();
    else modal.removeAttribute("open");
  }

  function reservationActionKind(reservation) {
    if (!reservation || reservation.status !== "scheduled" || reservationIsEnded(reservation)) return null;
    const start = Date.parse(reservation.starts_at);
    const end = Date.parse(reservation.ends_at);
    const current = now().getTime();
    if (reservation.approval_status === "approved" && start <= current && end > current) return "end";
    if (start > current) return "cancel";
    return null;
  }

  function setActionMessage(message = "") {
    const output = $("#reservation-action-message");
    output.textContent = message;
    output.hidden = !message;
  }

  function openReservationAction(reservation, kind) {
    if (!reservation || !["cancel", "end"].includes(kind)) return;
    hideCalendarHover();
    closeBooking();
    state.actionReservationId = reservation.id;
    state.actionKind = kind;
    const ending = kind === "end";
    const account = (state.data?.accounts || []).find((item) => item.account_id === reservation.account_id);
    const status = $("#reservation-action-status");
    const statusIcon = $("#reservation-action-status-icon");
    const callout = $("#reservation-action-callout");
    const calloutIcon = $("#reservation-action-callout-icon");
    const submit = $("#reservation-action-submit");
    const start = new Date(reservation.starts_at);
    const end = new Date(reservation.ends_at);

    $("#reservation-action-kicker").textContent = ending ? "Sessão ativa" : "Solicitação de acesso";
    $("#reservation-action-title").textContent = ending ? "Encerrar sessão" : "Cancelar solicitação";
    $("#reservation-action-subtitle").textContent = ending ? "O acesso será revogado imediatamente neste ambiente." : "Essa solicitação será removida da agenda e liberará o horário.";
    status.className = `reservation-action-status${ending ? " is-active" : ""}`;
    statusIcon.className = `ph ${ending ? "ph-play-circle" : reservation.approval_status === "pending" ? "ph-clock" : "ph-check-circle"}`;
    status.querySelector("span").textContent = ending ? "Sessão ativa" : reservation.approval_status === "pending" ? "Aguardando aprovação" : "Aprovado";
    $("#reservation-action-window").textContent = `${components().formatDateTime(start)} até ${components().formatTime(end)}`;
    $("#reservation-action-account").textContent = account?.label || reservation.account_id;
    callout.classList.toggle("action-callout--danger", ending);
    calloutIcon.className = `ph ${ending ? "ph-warning" : "ph-info"}`;
    $("#reservation-action-callout-copy").textContent = ending
      ? "Os streams conectados serão encerrados e o token deixará de funcionar imediatamente."
      : "A solicitação será cancelada sem alterar outras reservas da conta.";
    submit.classList.toggle("danger-button", ending);
    submit.querySelector("span").textContent = ending ? "Encerrar sessão" : "Cancelar solicitação";
    $("#reservation-action-submit-icon").className = `ph ${ending ? "ph-stop-circle" : "ph-trash"}`;
    setActionMessage();
    const modal = $("#reservation-action-modal");
    if (typeof modal.showModal === "function") modal.showModal();
    else modal.setAttribute("open", "");
  }

  function closeReservationAction() {
    const modal = $("#reservation-action-modal");
    if (typeof modal.close === "function") modal.close();
    else modal.removeAttribute("open");
    state.actionReservationId = null;
    state.actionKind = null;
    setActionMessage();
  }

  function markPreviewReservationCancelled(reservation) {
    reservation.status = "cancelled";
    reservation.cancelled_at = new Date().toISOString();
  }

  function markPreviewReservationEnded(reservation) {
    state.endedReservationIds.add(reservation.id);
    const device = deviceFor(reservation);
    if (device) {
      device.status = "revoked";
      device.revoked_at = new Date().toISOString();
    }
  }

  async function submitReservationAction(event) {
    event.preventDefault();
    const reservation = reservationById(state.actionReservationId);
    const kind = state.actionKind;
    if (!reservation || !kind) {
      closeReservationAction();
      return;
    }
    const submit = $("#reservation-action-submit");
    submit.disabled = true;
    setActionMessage(kind === "end" ? "Encerrando a sessão…" : "Cancelando a solicitação…");
    try {
      if (preview) {
        if (kind === "end") markPreviewReservationEnded(reservation);
        else markPreviewReservationCancelled(reservation);
        closeReservationAction();
        loadDashboardData({ ...state.data, serverTime: new Date().toISOString(), reservations: state.data.reservations });
        components().showToast(kind === "end" ? "Sessão encerrada." : "Solicitação cancelada.", "success");
      } else {
        const action = kind === "end" ? "end" : "cancel";
        await api(`/api/user/reservations/${encodeURIComponent(reservation.id)}/${action}`, { method: "POST", body: JSON.stringify({}) });
        if (kind === "end") state.endedReservationIds.add(reservation.id);
        closeReservationAction();
        await loadDashboard(true);
        components().showToast(kind === "end" ? "Sessão encerrada." : "Solicitação cancelada.", "success");
      }
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Não foi possível concluir essa ação.");
    } finally {
      submit.disabled = false;
    }
  }

  function addPreviewReservation(start, duration, accountId, quota) {
    const end = new Date(start.getTime() + duration * 3_600_000);
    state.data.reservations.push({
      id: `preview-${Date.now()}`,
      account_id: accountId,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      status: "scheduled",
      approval_status: "approved",
      requested_quota_percent: quota,
      created_at: new Date().toISOString(),
    });
  }

  async function submitBooking(event) {
    event.preventDefault();
    const start = inputDateTime($("#booking-date").value, $("#booking-time").value);
    const duration = Number($("#booking-duration").value);
    const accountId = $("#booking-account").value;
    const quota = Number($("#booking-quota").value);
    if (!start || ![1, 2, 3].includes(duration) || !accountId || ![5, 10, 15, 20].includes(quota)) {
      setBookingMessage("Confira os dados do agendamento.");
      return;
    }
    if (!isBookable(start, duration)) {
      setBookingMessage(start.getTime() > state.bookingMax.getTime() ? `Solicitações disponíveis até ${components().formatDate(state.bookingMax)}.` : "Esse horário não está livre, é passado ou não começa em uma hora cheia.");
      return;
    }
    const button = $("#booking-submit");
    button.disabled = true;
    setBookingMessage("Enviando solicitação…");
    try {
      if (preview) {
        addPreviewReservation(start, duration, accountId, quota);
        closeBooking();
        loadDashboardData({ ...state.data, serverTime: new Date().toISOString(), reservations: state.data.reservations });
        components().showToast("Agendamento aprovado; o token será gerado quando o horário começar.", "success");
      } else {
        await api("/api/user/reservations", { method: "POST", body: JSON.stringify({ startsAt: start.toISOString(), durationHours: duration, accountId, requestedQuotaPercent: quota }) });
        closeBooking();
        await loadDashboard(true);
        components().showToast("Agendamento aprovado; o token será gerado quando o horário começar.", "success");
      }
    } catch (error) {
      setBookingMessage(error instanceof Error ? error.message : "Não foi possível enviar a solicitação.");
    } finally {
      button.disabled = false;
      button.querySelector("span").textContent = "Enviar solicitação";
    }
  }

  async function logout() {
    if (!preview && state.config) await window.RemoteCodexAuth.signOut(state.config);
    window.location.replace("/login");
  }

  function bindInteractions() {
    document.querySelectorAll(".main-tab").forEach((tab) => tab.addEventListener("click", () => activateTab(tab.dataset.tab)));
    $("#guides-back").addEventListener("click", () => activateTab("overview"));
    $("#help-button").addEventListener("click", () => activateTab("guides"));
    $("#user-logout").addEventListener("click", logout);

    $("#notifications-toggle").addEventListener("click", () => toggleNotifications());
    $("#notifications-close").addEventListener("click", () => toggleNotifications(false));
    $(".notification-anchor").addEventListener("click", (event) => event.stopPropagation());
    document.addEventListener("click", () => toggleNotifications(false));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") toggleNotifications(false);
    });

    $("#toggle-token").addEventListener("click", () => {
      if (!sessionTokenAvailable(activeReservation())) {
        components().showToast("O token só está disponível durante uma sessão ativa.", "warning");
        return;
      }
      state.tokenVisible = !state.tokenVisible;
      renderToken();
    });
    $("#access-copy-mode").addEventListener("change", (event) => {
      state.copyMode = event.target.value === "codex-cli" ? "codex-cli" : "token";
      renderToken();
    });
    $("#copy-token").addEventListener("click", async () => {
      const reservation = activeReservation();
      const token = sessionTokenAvailable(reservation) ? tokenFor(reservation) : null;
      if (!token) {
        components().showToast("O token só está disponível durante uma sessão ativa.", "warning");
        return;
      }
      try {
        await navigator.clipboard.writeText(token);
        $("#access-copy-status").textContent = "Token copiado. Ele continua oculto nesta tela.";
        components().showToast("Token copiado.", "success");
      } catch {
        components().showToast("Não foi possível copiar o token neste navegador.", "error");
      }
    });

    $("#copy-cli-command").addEventListener("click", async () => {
      const reservation = activeReservation();
      const token = sessionTokenAvailable(reservation) ? tokenFor(reservation) : null;
      if (!token) {
        components().showToast("O comando só fica disponível durante uma sessão ativa.", "warning");
        return;
      }
      try {
        await navigator.clipboard.writeText(cliCommandFor(token));
        $("#access-copy-status").textContent = "Comando copiado para a área de transferência.";
        components().showToast("Comando do Codex CLI copiado.", "success");
      } catch {
        components().showToast("Não foi possível copiar o comando neste navegador.", "error");
      }
    });

    $("#open-booking").addEventListener("click", () => openBooking());
    $("#open-booking-top").addEventListener("click", () => openBooking());
    $("#booking-close").addEventListener("click", closeBooking);
    $("#booking-cancel").addEventListener("click", closeBooking);
    $("#booking-form").addEventListener("submit", submitBooking);
    ["#booking-date", "#booking-time", "#booking-duration"].forEach((selector) => $(selector).addEventListener("input", updateBookingEnd));
    $("#booking-modal").addEventListener("click", (event) => {
      if (event.target === $("#booking-modal")) closeBooking();
    });
    $("#reservation-action-close").addEventListener("click", closeReservationAction);
    $("#reservation-action-cancel").addEventListener("click", closeReservationAction);
    $("#reservation-action-form").addEventListener("submit", submitReservationAction);
    $("#reservation-action-modal").addEventListener("click", (event) => {
      if (event.target === $("#reservation-action-modal")) closeReservationAction();
    });

    $("#calendar-prev").addEventListener("click", () => state.calendar?.prev());
    $("#calendar-next").addEventListener("click", () => state.calendar?.next());
    $("#calendar-today").addEventListener("click", () => state.calendar?.today());
    document.querySelectorAll("[data-calendar-view]").forEach((button) => button.addEventListener("click", () => {
      state.calendarView = button.dataset.calendarView;
      state.calendar?.changeView(state.calendarView);
      document.querySelectorAll("[data-calendar-view]").forEach((item) => item.classList.toggle("is-active", item === button));
    }));
  }

  function renderAll() {
    renderAccounts();
    renderBookingOptions();
    renderToken();
    renderStats();
    renderSession();
    renderCalendar();
    renderNotifications();
    $("#calendar-limit-label").textContent = `Visualização até 30/09`;
    $("#calendar-constraint").innerHTML = `<i class="ph ph-info" aria-hidden="true"></i> Solicitações disponíveis até ${components().formatDate(state.bookingMax)}.`;
  }

  async function init() {
    components().initTheme();
    bindInteractions();
    if (!preview) {
      state.config = await window.RemoteCodexAuth.loadConfig();
      if (!window.RemoteCodexAuth.getSession()?.access_token) {
        window.location.replace("/login");
        return;
      }
    }
    await loadDashboard();
    window.setInterval(() => {
      renderSession();
      renderToken();
    }, 1_000);
    if (!preview) window.setInterval(() => loadDashboard(true).catch((error) => components().showToast(error.message, "error")), 10_000);
  }

  init().catch((error) => {
    $("#session-refresh").textContent = "indisponível";
    components().showToast(error instanceof Error ? error.message : "Não foi possível carregar o painel.", "error");
  });
})();
