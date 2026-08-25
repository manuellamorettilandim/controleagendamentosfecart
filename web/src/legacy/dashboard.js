(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const components = () => window.FecartComponents;
  const calendarTools = () => window.FecartCalendar;
  // There is no test-login or preview authentication bypass.
  const preview = false;
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
    accessProduct: "cli",
    platform: /Mac/i.test(navigator.platform) ? "macos" : /Linux/i.test(navigator.platform) ? "linux" : "powershell",
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

  function storedSessionFor(reservation) {
    if (!reservation) return null;
    try {
      const stored = JSON.parse(window.localStorage.getItem(localTokenKey(reservation.id)) || "null");
      if (!stored || (stored.expiresAt && Date.parse(stored.expiresAt) <= now().getTime())) {
        window.localStorage.removeItem(localTokenKey(reservation.id));
        return null;
      }
      return stored;
    } catch {
      return null;
    }
  }

  function appAccessFor(reservation) {
    const app = storedSessionFor(reservation)?.app;
    return app?.available && app.privateKey && app.host && app.user ? app : null;
  }

  function appKeyFilename(app) {
    return `${String(app?.alias || "fecart-codex").replace(/[^a-zA-Z0-9._-]/g, "-")}_ed25519`;
  }

  function appSshConfig(app) {
    const keyName = appKeyFilename(app);
    return [
      `Host ${app.alias}`,
      `  HostName ${app.host}`,
      `  Port ${Number(app.port || 22)}`,
      `  User ${app.user}`,
      `  IdentityFile ~/.ssh/${keyName}`,
      "  IdentitiesOnly yes",
    ].join("\n");
  }

  function sessionLimitReached(reservation) {
    const device = deviceFor(reservation);
    if (!reservation || !device) return false;
    if (device.status === "limited" || device.usage_limit_reached_at) return true;
    const budget = Number(device.quota_budget_percent ?? reservation.quota_budget_percent ?? reservation.requested_quota_percent);
    const accumulated = Number(device.quota_consumed_percent);
    if (Number.isFinite(budget) && Number.isFinite(accumulated)) return accumulated >= budget;
    const base = Number(device.quota_base_used_percent ?? reservation.quota_base_used_percent ?? 0);
    const current = Number(device.account_used_percent);
    if (!Number.isFinite(budget) || !Number.isFinite(current)) return false;
    const consumed = current >= base ? current - base : current;
    return consumed >= budget;
  }

  function sessionUsage(reservation, device = deviceFor(reservation)) {
    const budget = Number(device?.quota_budget_percent ?? reservation?.quota_budget_percent ?? reservation?.requested_quota_percent ?? 0);
    const accumulated = Number(device?.quota_consumed_percent);
    const base = Number(device?.quota_base_used_percent ?? reservation?.quota_base_used_percent ?? 0);
    const current = Number(device?.account_used_percent);
    const consumed = Number.isFinite(accumulated)
      ? Math.max(0, accumulated)
      : Number.isFinite(current) ? Math.max(0, current >= base ? current - base : current) : 0;
    const exhausted = device?.status === "limited" || Boolean(device?.usage_limit_reached_at);
    if (exhausted) {
      return { budget, consumed: Math.max(consumed, budget), remaining: 0, remainingPercent: 0 };
    }
    const remaining = Math.max(0, budget - consumed);
    const remainingPercent = budget > 0 ? Math.max(0, Math.min(100, Math.round((remaining / budget) * 100))) : 0;
    return { budget, consumed, remaining, remainingPercent };
  }

  function formatCountdown(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
    const hours = Math.floor(totalSeconds / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;
    return hours > 0
      ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function sessionTokenAvailable(reservation) {
    const device = deviceFor(reservation);
    const remotelyActive = device && !["revoked", "disabled", "expired"].includes(device.status);
    return Boolean(remotelyActive && tokenFor(reservation) && !sessionLimitReached(reservation));
  }

  function remoteCliUrl() {
    const isSecure = window.location.protocol === "https:";
    const protocol = isSecure ? "wss:" : "ws:";
    const defaultPort = isSecure ? "443" : (window.location.port || "80");
    const hostWithPort = window.location.port ? window.location.host : `${window.location.hostname}:${defaultPort}`;
    return `${protocol}//${hostWithPort}`;
  }

  function providerBaseUrl() {
    return `${window.location.origin}/api/codex/v1`;
  }

  function configTomlSnippet(model = "gpt-5.6-sol") {
    const baseUrl = providerBaseUrl();
    return `model = "${model}"\nmodel_provider = "fecart"\n\n[model_providers.fecart]\nname = "FECART Codex"\nbase_url = "${baseUrl}"\nenv_key = "FECART_CODEX_TOKEN"\nwire_api = "responses"\nsupports_websockets = false`;
  }

  function cliCommandFor(token, platform = state.platform) {
    if (platform === "cmd") {
      return `set "FECART_CODEX_TOKEN=${token}" && codex`;
    }
    if (platform === "macos" || platform === "linux") {
      return `export FECART_CODEX_TOKEN='${token}' && codex`;
    }
    return `$env:FECART_CODEX_TOKEN = "${token}"; codex`;
  }

  function appCommandFor(token, platform = state.platform) {
    if (platform === "cmd") {
      return `setx FECART_CODEX_TOKEN "${token}" && start explorer.exe "shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App"`;
    }
    if (platform === "macos") {
      return `FECART_CODEX_TOKEN='${token}' open -a "ChatGPT"`;
    }
    if (platform === "linux") {
      return `FECART_CODEX_TOKEN='${token}' chatgpt`;
    }
    return `setx FECART_CODEX_TOKEN "${token}"; Start-Process "explorer.exe" "shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App"`;
  }

  function legacyCliCommandFor(token, platform = state.platform) {
    const remoteUrl = remoteCliUrl();
    if (platform === "cmd") {
      return `set "CODEX_REMOTE_TOKEN=${token}" && codex --remote "${remoteUrl}" --remote-auth-token-env CODEX_REMOTE_TOKEN`;
    }
    if (platform === "macos" || platform === "linux") {
      return `export CODEX_REMOTE_TOKEN='${token}'; codex --remote '${remoteUrl}' --remote-auth-token-env CODEX_REMOTE_TOKEN`;
    }
    return `$env:CODEX_REMOTE_TOKEN = "${token}"; codex --remote "${remoteUrl}" --remote-auth-token-env CODEX_REMOTE_TOKEN`;
  }

  function autoConfigCommand(platform = "windows") {
    const toml = configTomlSnippet();
    if (platform === "macos" || platform === "linux") {
      return `mkdir -p ~/.codex && if [ -f ~/.codex/config.toml ]; then cp ~/.codex/config.toml ~/.codex/config.toml.bak && echo -e "\n\\x1b[1;33m========================================================\n [ATENÇÃO] BACKUP DO SEU CONFIG.TOML FOI CRIADO!\n Caminho do backup: ~/.codex/config.toml.bak\n Anote este caminho caso queira restaurar manualmente.\n========================================================\\x1b[0m\n"; fi; cat << 'EOF' > ~/.codex/config.toml\n${toml}\nEOF\necho "Configuração do FECART Codex aplicada com sucesso!"`;
    }
    return `$dir="$HOME\\.codex"; $cfg="$dir\\config.toml"; $bak="$dir\\config.toml.bak"; New-Item -ItemType Directory -Force $dir | Out-Null; if (Test-Path $cfg) { Copy-Item $cfg $bak -Force; Write-Host "\`n========================================================" -ForegroundColor Yellow; Write-Host " [ATENCAO] BACKUP DO SEU CONFIG.TOML FOI CRIADO!" -ForegroundColor Yellow; Write-Host " Caminho do backup: $bak" -ForegroundColor Cyan; Write-Host " Anote este caminho caso queira restaurar manualmente." -ForegroundColor Gray; Write-Host "========================================================\`n" -ForegroundColor Yellow }; @'\n${toml}\n'@ | Set-Content -Path $cfg -Encoding UTF8; Write-Host "Configuração do FECART Codex aplicada com sucesso!" -ForegroundColor Green`;
  }

  function restoreConfigCommand(platform = "windows") {
    if (platform === "macos" || platform === "linux") {
      return `if [ -f ~/.codex/config.toml.bak ]; then mv ~/.codex/config.toml.bak ~/.codex/config.toml && echo -e "\n\\x1b[1;32m[SUCESSO] Backup restaurado de: ~/.codex/config.toml.bak\nCodex voltou à configuração anterior.\\x1b[0m\n"; else rm -f ~/.codex/config.toml && echo -e "\n\\x1b[1;33m[REMOVIDO] Configuração da FECART removida! Codex restaurado para o padrão.\\x1b[0m\n"; fi`;
    }
    return `$dir="$HOME\\.codex"; $cfg="$dir\\config.toml"; $bak="$dir\\config.toml.bak"; if (Test-Path $bak) { Move-Item $bak $cfg -Force; Write-Host "\`n[SUCESSO] Backup restaurado de: $bak" -ForegroundColor Green; Write-Host "Codex voltou à sua configuração pessoal anterior.\`n" -ForegroundColor Gray } elseif (Test-Path $cfg) { Remove-Item $cfg -Force; Write-Host "\`n[REMOVIDO] Configuração da FECART removida! Codex restaurado para o padrão.\`n" -ForegroundColor Yellow } else { Write-Host "\`nNenhuma configuração personalizada encontrada.\`n" }`;
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
      quota_consumed_percent: Number(usage.quotaConsumedPercent || 0),
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
      app: result?.app && typeof result.app === "object" ? result.app : null,
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
    const localDeviceId = storedSessionFor(reservation)?.deviceId || null;
    if (localDeviceId) {
      const localDevice = (state.data?.devices || []).find((item) => item.device_id === localDeviceId);
      if (localDevice) return localDevice;
    }
    if (reservation.device_id) {
      return (state.data?.devices || []).find((item) => item.device_id === reservation.device_id)
        || (state.data?.devices || []).find((item) => item.reservation_id === reservation.id && !["revoked", "disabled", "expired"].includes(item.status))
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
    if (reservation.device_id && ["revoked", "disabled", "expired"].includes(deviceFor(reservation)?.status)) return true;
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
    return window.FecartApi.user(path, options, retry, state.config);
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

  function calendarRangeStart() {
    // Keep the current week's history visible; isBookable still rejects past slots.
    const start = calendarTools().startOfDay(now());
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
    return start;
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
    if (!overview) {
      updateGuideDynamicSnippets();
      const guide = $("#guide-cli");
      if (guide) {
        const plat = state.platform === "macos" ? "macos" : state.platform === "linux" ? "linux" : "windows";
        setGuidePlatform(guide, plat);
      }
    }
    if (overview && state.calendar) window.setTimeout(() => state.calendar.updateSize?.(), 40);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateGuideDynamicSnippets() {
    const toml = configTomlSnippet();
    document.querySelectorAll("[data-config-toml-snippet]").forEach((el) => {
      el.textContent = toml;
    });
    ["windows", "macos", "linux"].forEach((plat) => {
      document.querySelectorAll(`[data-auto-config-cmd="${plat}"]`).forEach((el) => {
        el.textContent = autoConfigCommand(plat);
      });
      document.querySelectorAll(`[data-restore-config-cmd="${plat}"]`).forEach((el) => {
        el.textContent = restoreConfigCommand(plat);
      });
    });
  }

  function showGuidePage(_name = "unified", updateHistory = true) {
    updateGuideDynamicSnippets();
    const guide = $("#guide-cli");
    if (guide) {
      const plat = state.platform === "macos" ? "macos" : state.platform === "linux" ? "linux" : "windows";
      setGuidePlatform(guide, plat);
    }
    if (updateHistory) {
      window.history.pushState({ guide: "unified" }, "", "#guides");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setGuidePlatform(guide, platform) {
    if (!guide) return;
    const selected = platform === "macos" ? "macos" : platform === "linux" ? "linux" : "windows";
    guide.querySelectorAll("[data-guide-platform]").forEach((button) => {
      const active = button.dataset.guidePlatform === selected;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    guide.querySelectorAll("[data-platform-copy]").forEach((copy) => {
      copy.hidden = copy.dataset.platformCopy !== selected;
    });
    updateGuideDynamicSnippets();
  }

  function restoreGuideFromLocation() {
    if (window.location.hash.startsWith("#guide")) {
      activateTab("guides");
      return;
    }
    activateTab("overview");
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
    const toggle = $("#toggle-token");
    const visible = Boolean(token && state.tokenVisible);

    if (toggle) {
      toggle.disabled = !token;
      toggle.setAttribute("aria-pressed", String(visible));
      toggle.setAttribute("aria-label", visible ? "Ocultar token" : "Mostrar token");
      toggle.innerHTML = `<i class="ph ${visible ? "ph-eye-slash" : "ph-eye"}" aria-hidden="true"></i>`;
    }

    const isApp = state.accessProduct === "app";
    const commandNode = $("#cli-command");
    const maskedToken = "••••••••••••••••";
    const displayToken = visible && token ? token : maskedToken;
    if (commandNode) {
      commandNode.textContent = isApp ? appCommandFor(displayToken, state.platform) : cliCommandFor(displayToken, state.platform);
    }
    const copyCommand = $("#copy-cli-command");
    if (copyCommand) {
      copyCommand.disabled = !token;
    }

    document.querySelectorAll("[data-mode-select]").forEach((button) => {
      const active = button.dataset.modeSelect === state.accessProduct;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });

    document.querySelectorAll("[data-platform-select]").forEach((button) => {
      const active = button.dataset.platformSelect === state.platform;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });

    const linuxNote = $("#linux-app-note");
    if (linuxNote) {
      linuxNote.hidden = !(isApp && state.platform === "linux");
    }

    const appWarning = $("#app-close-warning");
    if (appWarning) {
      appWarning.hidden = !isApp;
    }

    const kicker = $("#access-kicker-text");
    if (kicker) {
      kicker.textContent = isApp ? "ChatGPT Desktop (Codex)" : "Codex CLI";
    }

    const statusEl = $("#access-copy-status");
    if (statusEl) {
      statusEl.textContent = state.activationInFlight
        ? "Gerando as credenciais temporárias no host central…"
        : state.activationError
          ? state.activationError
          : sessionLimitReached(reservation)
            ? "A cota desta sessão foi atingida; o token foi bloqueado."
            : token
              ? (visible ? "Comando pronto com token visível. Oculte-o quando terminar." : (isApp ? "Comando de inicialização do ChatGPT pronto para o sistema selecionado." : "Comando pronto para o terminal selecionado."))
              : (isApp ? "Inicie o aplicativo ChatGPT Desktop com o token injetado para esta sessão ativa." : "Copie o comando e execute no terminal do seu projeto durante a sessão ativa.");
    }
  }

  function renderUserProfile() {
    const profile = state.data?.profile || null;
    const groupName = profile?.group_name || "Grupo";
    const username = profile?.username ? `@${profile.username}` : "";
    const groupEl = $("#user-group-name");
    const userEl = $("#user-username");
    if (groupEl) groupEl.textContent = groupName;
    if (userEl) userEl.textContent = username;

    const statsGroupLabel = $("#stats-group-label");
    if (statsGroupLabel) statsGroupLabel.textContent = groupName;
  }

  function renderStats() {
    const cutoff = now().getTime() - 30 * 24 * 60 * 60_000;
    const allReservations = (state.data?.reservations || []).filter((item) => Date.parse(item.starts_at) >= cutoff);
    const reservations = allReservations.filter((item) => item.approval_status === "approved");
    const hours = reservations.reduce((sum, item) => sum + Math.max(0, (Date.parse(item.ends_at) - Date.parse(item.starts_at)) / 3_600_000), 0);
    const days = new Set(reservations.map((item) => new Date(item.starts_at).toLocaleDateString("pt-BR"))).size;
    const accesses = (state.data?.devices || [])
      .flatMap((device) => [device.last_seen_at, device.activated_at])
      .filter(Boolean)
      .sort((a, b) => Date.parse(b) - Date.parse(a));
    const lastAccess = accesses[0] ? new Date(accesses[0]) : null;
    const today = calendarTools().sameDay(lastAccess || new Date(0), now());

    const devices = state.data?.devices || [];
    const totalTokens = devices.reduce((sum, d) => sum + Number(d.observed_tokens || 0), 0);
    const avgHours = reservations.length > 0 ? (hours / reservations.length) : 0;
    const avgDurationFormatted = avgHours >= 1 ? `${avgHours.toFixed(1).replace(".0", "")}h` : avgHours > 0 ? `${Math.round(avgHours * 60)}min` : "—";
    const approvalRate = allReservations.length > 0 ? Math.round((reservations.length / allReservations.length) * 100) : 100;
    const totalInput = devices.reduce((sum, d) => sum + Number(d.observed_input_tokens || 0), 0);
    const totalCached = devices.reduce((sum, d) => sum + Number(d.observed_cached_input_tokens || 0), 0);
    const cachePercent = (totalInput + totalCached) > 0 ? Math.round((totalCached / (totalInput + totalCached)) * 100) : 0;

    $("#stat-approved").textContent = String(reservations.length);
    $("#stat-hours").textContent = formatDuration(hours);
    $("#stat-days").textContent = String(days);
    $("#stat-last-access").textContent = lastAccess ? (today ? `Hoje, ${components().formatTime(lastAccess)}` : components().formatDateTime(lastAccess)) : "—";
    $("#stat-last-access-note").textContent = lastAccess ? formatRelative(lastAccess) : "aguardando dados";
    if ($("#stat-tokens")) $("#stat-tokens").textContent = totalTokens > 0 ? formatTokenCount(totalTokens) : "0";
    if ($("#stat-avg-duration")) $("#stat-avg-duration").textContent = avgDurationFormatted;
    if ($("#stat-approval-rate")) $("#stat-approval-rate").textContent = `${approvalRate}%`;
    if ($("#stat-cache-rate")) $("#stat-cache-rate").textContent = totalTokens > 0 ? `${cachePercent}%` : "0%";
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
      const remainingTime = Math.max(0, end.getTime() - now().getTime());
      const timePercentage = Math.round((remainingTime / total) * 100);
      const usage = sessionUsage(reservation, device);
      const limited = sessionLimitReached(reservation);
      components().setProgress($("#session-progress"), timePercentage, `${formatCountdown(remainingTime)} restantes na sessão`);
      $("#session-percent").textContent = `${timePercentage}%`;
      $("#session-time").textContent = formatCountdown(remainingTime);
      $("#session-time-total").textContent = `até ${components().formatTime(end)}`;
      status.textContent = limited ? "Ativa (Uso esgotado)" : state.activationInFlight ? "Inicializando sessão" : "Sessão ativa";
      dot.classList.toggle("is-active", !limited);
      dot.classList.toggle("is-limited", limited);
      $("#session-started").textContent = state.activationInFlight
        ? "Gerando a credencial real no host central…"
        : limited
          ? `Janela ativa desde ${components().formatDateTime(start)} (cota esgotada)`
          : `Ativa desde ${components().formatDateTime(start)}`;

      components().setProgress($("#quota-progress"), usage.remainingPercent, `${usage.remaining.toFixed(1)}% de uso restante`);
      $("#quota-percent").textContent = `${usage.remainingPercent}%`;
      $("#quota-used").textContent = `${usage.remaining.toFixed(1).replace(".0", "")}% restante`;
      $("#quota-total").textContent = `de ${usage.budget}% aprovados`;
      $("#session-activity").textContent = state.activationInFlight
          ? "Aguardando o host central emitir o token."
          : limited
            ? "Cota aprovada desta sessão foi consumida; o token está bloqueado."
            : lastActivity
            ? `Última atividade ${formatRelative(lastActivity)}.`
            : lastSeen
              ? `CLI conectado ${formatRelative(lastSeen)}; aguardando uso.`
              : device
                ? "Token pronto; abra o Codex CLI para começar."
                : "Token sendo preparado para esta sessão.";
    } else {
      const upcoming = (state.data?.reservations || [])
        .filter((item) => item.status === "scheduled" && item.approval_status === "approved" && Date.parse(item.starts_at) > now().getTime())
        .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0];
      const untilStart = upcoming ? Math.max(0, Date.parse(upcoming.starts_at) - now().getTime()) : 0;
      const usage = upcoming ? sessionUsage(upcoming, null) : { budget: 0, remaining: 0, remainingPercent: 0 };
      components().setProgress($("#session-progress"), upcoming ? 100 : 0, upcoming ? `${formatCountdown(untilStart)} até a próxima sessão` : "Nenhuma sessão aprovada");
      components().setProgress($("#quota-progress"), upcoming ? 100 : 0, upcoming ? `${usage.budget}% aprovados para a próxima sessão` : "Sem uso aprovado");
      $("#session-percent").textContent = upcoming ? "100%" : "—";
      $("#session-time").textContent = upcoming ? formatCountdown(untilStart) : "—";
      $("#session-time-total").textContent = upcoming ? `começa ${components().formatDateTime(upcoming.starts_at)}` : "sem sessão aprovada";
      $("#quota-percent").textContent = upcoming ? "100%" : "—";
      $("#quota-used").textContent = upcoming ? `${usage.budget}% disponível` : "—";
      $("#quota-total").textContent = upcoming ? "na próxima sessão" : "sem uso aprovado";
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
      const limited = active && sessionLimitReached(item);
      return {
        id: `reservation-${item.id}`,
        title: ended ? "Encerrado" : limited ? "Ativa (Esgotada)" : active ? "Sessão ativa" : pending ? "Pendente" : "Aprovado",
        start: item.starts_at,
        end: item.ends_at,
        className: ["calendar-event-own", pending ? "calendar-event-pending" : "", ended ? "calendar-event-ended" : "", active ? (limited ? "calendar-event-limited" : "calendar-event-active") : ""].filter(Boolean).join(" "),
        extendedProps: { kind: "mine", pending, active, ended, limited, reservationId: item.id },
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
    const minimumRangeStart = calendarRangeStart();
    $("#calendar-range").textContent = calendarTools().formatRange(rangeStart, calendarTools().startOfDay(rangeEnd));
    $("#calendar-prev").disabled = rangeStart.getTime() <= minimumRangeStart.getTime();
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
        validRange: { start: calendarRangeStart(), end: calendarRangeEnd() },
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
      state.calendar.setOption("validRange", { start: calendarRangeStart(), end: calendarRangeEnd() });
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
    const reservations = (state.data?.reservations || []).slice();
    reservations
      .filter((item) => item.reviewed_at && ["approved", "rejected"].includes(item.approval_status))
      .sort((a, b) => Date.parse(b.reviewed_at) - Date.parse(a.reviewed_at))
      .slice(0, 6)
      .forEach((item) => {
        const requested = Number(item.requested_quota_percent || 5);
        const approved = Number(item.quota_budget_percent || requested);
        const rejected = item.approval_status === "rejected";
        const adjustment = approved === requested ? "" : approved > requested ? " com upgrade" : " com downgrade";
        const decision = rejected ? "Solicitação recusada" : `Solicitação aprovada${adjustment}`;
        const quotaCopy = rejected ? "" : ` Uso: ${requested}% → ${approved}%.`;
        const noteCopy = item.review_note ? ` Justificativa: ${item.review_note}` : " Sem justificativa informada.";
        items.push({
          type: rejected ? "danger" : "success",
          icon: rejected ? "ph-x-circle" : approved === requested ? "ph-check-circle" : approved > requested ? "ph-arrow-up" : "ph-arrow-down",
          title: decision,
          message: `${components().formatDateTime(item.starts_at)} · ${item.account_id}.${quotaCopy}${noteCopy}`,
          time: formatRelative(item.reviewed_at),
        });
      });
    reservations
      .filter((item) => item.approval_status === "pending" && item.status === "scheduled")
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, 3)
      .forEach((item) => {
        items.push({ type: "warning", icon: "ph-clock", title: "Solicitação em análise", message: `${components().formatDateTime(item.starts_at)} · ${item.requested_quota_percent || 5}% solicitados para ${item.account_id}.`, time: formatRelative(item.created_at) });
      });
    if (state.data?.relay && !state.data.relay.ready) items.unshift({ type: "warning", icon: "ph-warning", title: "Host temporariamente offline", message: "As solicitações continuam salvas, mas a ativação será retomada quando o host voltar.", time: "agora" });
    if (!items.length) items.push({ type: "info", icon: "ph-check-circle", title: "Tudo em dia", message: "Nenhuma notificação nova por enquanto.", time: "agora" });
    $("#notification-badge").hidden = items.length === 1 && items[0].title === "Tudo em dia";
    $("#notification-badge").textContent = String(items.length);
    $("#notification-count").textContent = items.length === 1 && items[0].title === "Tudo em dia" ? "sem novidades" : `${items.length} ${items.length === 1 ? "nova" : "novas"}`;
    $("#notification-list").innerHTML = items.map((item) => `<article class="notification-item is-${item.type}"><i class="ph ${item.icon}" aria-hidden="true"></i><div><strong>${components().escapeHTML(item.title)}</strong><p>${components().escapeHTML(item.message)}</p><time>${components().escapeHTML(item.time || "agora")}</time></div></article>`).join("");
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
    $("#booking-quota").value = "5";
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
    const requestedQuotaPercent = Number($("#booking-quota").value);
    if (!start || ![1, 2, 3].includes(duration) || requestedQuotaPercent < 1 || requestedQuotaPercent > 100 || !accountId) {
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
        addPreviewReservation(start, duration, accountId, requestedQuotaPercent);
        closeBooking();
        loadDashboardData({ ...state.data, serverTime: new Date().toISOString(), reservations: state.data.reservations });
        components().showToast("Pedido enviado para aprovação.", "success");
      } else {
        await api("/api/user/reservations", { method: "POST", body: JSON.stringify({ startsAt: start.toISOString(), durationHours: duration, accountId, requestedQuotaPercent }) });
        closeBooking();
        await loadDashboard(true);
        components().showToast("Pedido enviado para aprovação.", "success");
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
    document.querySelectorAll(".main-tab").forEach((tab) => tab.addEventListener("click", () => {
      if (tab.dataset.tab === "guides") {
        activateTab("guides");
        showGuidePage("unified");
        return;
      }
      window.history.pushState({}, "", window.location.pathname);
      activateTab("overview");
    }));
    $("#guides-back")?.addEventListener("click", () => {
      window.history.pushState({}, "", window.location.pathname);
      activateTab("overview");
    });
    $("#help-button").addEventListener("click", () => {
      activateTab("guides");
      showGuidePage("unified");
    });
    document.querySelectorAll("[data-open-guide]").forEach((button) => button.addEventListener("click", () => {
      activateTab("guides");
      showGuidePage("unified");
    }));
    document.querySelectorAll("[data-guide-back]").forEach((button) => button.addEventListener("click", () => {
      window.history.pushState({}, "", window.location.pathname);
      activateTab("overview");
    }));
    document.querySelectorAll("[data-guide-platform]").forEach((button) => button.addEventListener("click", () => {
      setGuidePlatform(button.closest(".guide-detail"), button.dataset.guidePlatform);
    }));
    document.querySelectorAll("[data-go-overview]").forEach((button) => button.addEventListener("click", () => {
      window.history.pushState({}, "", window.location.pathname);
      activateTab("overview");
      $(".token-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    window.addEventListener("popstate", restoreGuideFromLocation);
    $("#user-logout").addEventListener("click", logout);

    $("#notifications-toggle").addEventListener("click", () => toggleNotifications());
    $("#notifications-close").addEventListener("click", () => toggleNotifications(false));
    $(".notification-anchor").addEventListener("click", (event) => event.stopPropagation());
    document.addEventListener("click", () => toggleNotifications(false));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") toggleNotifications(false);
    });

    $("#toggle-token")?.addEventListener("click", () => {
      if (!sessionTokenAvailable(activeReservation())) {
        components().showToast("O token só está disponível durante uma sessão ativa.", "warning");
        return;
      }
      state.tokenVisible = !state.tokenVisible;
      renderToken();
    });
    document.querySelectorAll("[data-mode-select]").forEach((button) => {
      button.addEventListener("click", () => {
        state.accessProduct = button.dataset.modeSelect === "app" ? "app" : "cli";
        renderToken();
      });
    });

    document.querySelectorAll("[data-platform-select]").forEach((button) => {
      button.addEventListener("click", () => {
        state.platform = ["powershell", "cmd", "macos", "linux"].includes(button.dataset.platformSelect) ? button.dataset.platformSelect : "powershell";
        renderToken();
      });
    });

    $("#copy-cli-command").addEventListener("click", async () => {
      const reservation = activeReservation();
      const token = sessionTokenAvailable(reservation) ? tokenFor(reservation) : null;
      if (!token) {
        components().showToast("O comando só fica disponível durante uma sessão ativa.", "warning");
        return;
      }
      const isApp = state.accessProduct === "app";
      const cmd = isApp ? appCommandFor(token, state.platform) : cliCommandFor(token, state.platform);
      try {
        await navigator.clipboard.writeText(cmd);
        $("#access-copy-status").textContent = "Comando copiado para a área de transferência.";
        components().showToast(isApp ? "Comando do ChatGPT Desktop copiado." : "Comando do Codex CLI copiado.", "success");
      } catch {
        components().showToast("Não foi possível copiar o comando neste navegador.", "error");
      }
    });

    $("#copy-auto-config")?.addEventListener("click", async () => {
      const activeGuide = document.querySelector("#guide-cli");
      const activeBtn = activeGuide?.querySelector("[data-guide-platform].is-active");
      const platform = activeBtn?.dataset?.guidePlatform || "windows";
      try {
        await navigator.clipboard.writeText(autoConfigCommand(platform));
        components().showToast("Comando de configuração automática copiado!", "success");
      } catch {
        components().showToast("Não foi possível copiar o comando.", "error");
      }
    });

    $("#copy-restore-config")?.addEventListener("click", async () => {
      const activeGuide = document.querySelector("#guide-cli");
      const activeBtn = activeGuide?.querySelector("[data-guide-platform].is-active");
      const platform = activeBtn?.dataset?.guidePlatform || "windows";
      try {
        await navigator.clipboard.writeText(restoreConfigCommand(platform));
        components().showToast("Comando para restaurar padrão copiado!", "success");
      } catch {
        components().showToast("Não foi possível copiar o comando.", "error");
      }
    });

    $("#download-config-toml")?.addEventListener("click", () => {
      const toml = configTomlSnippet();
      const blob = new Blob([toml], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "config.toml";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      components().showToast("Download do config.toml iniciado.", "success");
    });

    $("#open-booking").addEventListener("click", () => openBooking());
    $("#open-booking-top")?.addEventListener("click", () => {
      activateTab("overview");
      const calendar = document.querySelector(".calendar-section");
      if (calendar) {
        calendar.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
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
    renderUserProfile();
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
    restoreGuideFromLocation();
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

export {};
