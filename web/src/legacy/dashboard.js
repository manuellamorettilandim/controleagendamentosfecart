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
    carouselSlots: [],
    carouselIndex: 0,
    bookingSelectedDate: null,
    isDraggingCarousel: false,
    dragStartX: 0,
    dragDeltaX: 0,
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
    const budget = Number(device.quota_budget_percent ?? reservation.quota_budget_percent ?? 10);
    const accumulated = Number(device.quota_consumed_percent);
    if (Number.isFinite(budget) && Number.isFinite(accumulated)) return accumulated >= budget;
    const base = Number(device.quota_base_used_percent ?? reservation.quota_base_used_percent ?? 0);
    const current = Number(device.account_used_percent);
    if (!Number.isFinite(budget) || !Number.isFinite(current)) return false;
    const consumed = current >= base ? current - base : current;
    return consumed >= budget;
  }

  function sessionUsage(reservation, device = deviceFor(reservation)) {
    const account = readyAccounts().find((item) => item.account_id === reservation?.account_id);
    const fiveHour = fiveHourWindow(account);
    const fiveHourUsed = Number.isFinite(Number(fiveHour?.usedPercent)) ? Math.max(0, Math.min(100, Number(fiveHour?.usedPercent))) : 0;
    const fiveHourRemainingPercent = Math.max(0, 100 - fiveHourUsed);

    const budget = Math.max(1, Number(device?.quota_budget_percent ?? reservation?.quota_budget_percent ?? 10));
    const accumulatedWeekly = Number(device?.quota_consumed_percent ?? 0);
    const weeklyConsumed = Number.isFinite(accumulatedWeekly) ? Math.max(0, Math.min(budget, accumulatedWeekly)) : 0;
    const weeklyRemaining = Math.max(0, budget - weeklyConsumed);
    const weeklyRemainingPercent = Math.max(0, Math.min(100, Math.round((weeklyRemaining / budget) * 100)));

    const exhausted = device?.status === "limited" || Boolean(device?.usage_limit_reached_at);
    if (exhausted) {
      return {
        budget,
        consumed: budget,
        remaining: 0,
        remainingPercent: 0,
        weeklyRemaining: 0,
        weeklyConsumed: budget,
        fiveHourRemainingPercent: 0,
      };
    }

    const effectiveRemainingPercent = Math.min(weeklyRemainingPercent, fiveHourRemainingPercent);

    return {
      budget,
      consumed: weeklyConsumed,
      remaining: weeklyRemaining,
      remainingPercent: effectiveRemainingPercent,
      weeklyRemaining,
      weeklyConsumed,
      fiveHourRemainingPercent,
    };
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
    return `model = "${model}"\nmodel_provider = "fecart"\nweb_search = "live"\n\n[features]\nstandalone_web_search = true\n\n[model_providers.fecart]\nname = "FECART Codex"\nbase_url = "${baseUrl}"\nenv_key = "FECART_CODEX_TOKEN"\nwire_api = "responses"\nsupports_websockets = false\nsupports_standalone_web_search = true`;
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

  function rateLimitWindows(account) {
    const limits = Object.values(account?.rate_limits || account?.rateLimits || {});
    return limits.flatMap((limit) => [limit?.primary, limit?.secondary]).filter(Boolean);
  }

  function fiveHourWindow(account) {
    return rateLimitWindows(account).find((window) => Number(window.windowDurationMins) === 300) || null;
  }

  function resetMilliseconds(window) {
    const value = Number(window?.resetsAt);
    if (!Number.isFinite(value) || value <= 0) return null;
    return value < 10_000_000_000 ? value * 1_000 : value;
  }

  function isAccountWindowActive(account = selectedAccount()) {
    if (!account) return false;
    const window = fiveHourWindow(account);
    const resetAt = resetMilliseconds(window);
    const current = now().getTime();
    if (!resetAt || resetAt <= current) return false;
    const used = Number(window?.usedPercent);
    const hasUsage = Number.isFinite(used) && used > 0;
    const hasActiveReservation = (state.data?.reservations || []).some((item) =>
      item.account_id === account.account_id &&
      item.status === "scheduled" &&
      item.approval_status === "approved" &&
      Date.parse(item.starts_at) <= current &&
      Date.parse(item.ends_at) > current
    );
    return hasUsage || hasActiveReservation;
  }

  function alignedResetStart(requested, account = selectedAccount()) {
    const active = isAccountWindowActive(account);
    const requestedMs = new Date(requested).getTime();
    if (!Number.isFinite(requestedMs)) return null;
    if (!active) {
      return new Date(requestedMs);
    }
    const anchor = resetMilliseconds(fiveHourWindow(account));
    if (anchor === null) return null;
    if (requestedMs <= anchor) return new Date(anchor);
    return new Date(anchor + Math.ceil((requestedMs - anchor) / (5 * 3_600_000)) * 5 * 3_600_000);
  }

  function isResetBoundary(start, account = selectedAccount()) {
    const active = isAccountWindowActive(account);
    const aligned = alignedResetStart(new Date(start).getTime() - 60_000, account);
    return Boolean(aligned && Math.abs(aligned.getTime() - new Date(start).getTime()) <= 60_000);
  }

  function reservationWindow(start, account = selectedAccount()) {
    const candidate = new Date(start);
    const startsAt = candidate.getTime();
    const current = now().getTime();
    if (!Number.isFinite(startsAt) || startsAt < current - 60_000) return null;
    const active = isAccountWindowActive(account);
    const resetAt = resetMilliseconds(fiveHourWindow(account));
    const immediate = startsAt <= current + 60_000;

    // 1. Account is idle: immediate session gets full 5 hours starting now!
    if (!active && immediate) {
      return { start: candidate, end: new Date(startsAt + 5 * 3_600_000), complete: true };
    }

    // 2. Future 5-hour boundary aligned to reset
    if (isResetBoundary(candidate, account)) {
      return { start: candidate, end: new Date(startsAt + 5 * 3_600_000), complete: true };
    }

    // 3. Account is active: immediate start gets remainder of active window
    if (active && immediate && resetAt && startsAt < resetAt && resetAt - startsAt >= 5 * 60_000) {
      return { start: candidate, end: new Date(resetAt), complete: false };
    }
    return null;
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
        { account_id: "account-1", label: "Account 1", status: "ready", is_default: true, rate_limits: { codex: { primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 1800 }, secondary: { usedPercent: 28, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 432000 } } }, observed_at: new Date().toISOString() },
        { account_id: "account-2", label: "Account 2", status: "ready", is_default: false, rate_limits: { codex: { primary: { usedPercent: 7, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 3600 }, secondary: { usedPercent: 19, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 518400 } } }, observed_at: new Date().toISOString() },
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
      const account = readyAccounts().find((item) => item.account_id === reservation.account_id);
      const quotaReset = resetMilliseconds(fiveHourWindow(account));
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
      $("#quota-total").textContent = quotaReset
        ? `de ${usage.budget}% da semana • reset ${components().formatDateTime(new Date(quotaReset))}`
        : `de ${usage.budget}% da cota semanal`;
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
      components().setProgress($("#session-progress"), upcoming ? 100 : 0, upcoming ? `${formatCountdown(untilStart)} até a próxima sessão` : "Nenhuma sessão aprovada");
      components().setProgress($("#quota-progress"), 0, "Sem sessão ativa");
      $("#session-percent").textContent = upcoming ? "100%" : "—";
      $("#session-time").textContent = upcoming ? formatCountdown(untilStart) : "—";
      $("#session-time-total").textContent = upcoming ? `começa ${components().formatDateTime(upcoming.starts_at)}` : "sem sessão aprovada";
      $("#quota-percent").textContent = "—";
      $("#quota-used").textContent = "sem sessão ativa";
      $("#quota-total").textContent = "disponível na sessão ativa";
      status.textContent = "Sessão desligada";
      dot.classList.remove("is-active", "is-limited");
      $("#session-started").textContent = upcoming ? `Próxima janela ${components().formatDateTime(upcoming.starts_at)}` : "Ative um horário aprovado para começar.";
      $("#session-activity").textContent = "Aguardando a próxima janela ativa.";
    }
  }

  function reservationsForAccount() {
    return (state.data?.reservations || []).filter((item) => item.account_id === selectedAccount()?.account_id && item.status !== "cancelled");
  }

  function slotConflict(start, end, accountId = selectedAccount()?.account_id) {
    if (!accountId) return true;
    const startTime = start.getTime();
    const endTime = new Date(end).getTime();
    const reservations = (state.data?.reservations || []).filter((item) =>
      item.account_id === accountId &&
      item.status === "scheduled" &&
      item.approval_status !== "rejected" &&
      !reservationIsEnded(item)
    );
    const busy = (state.data?.busySlots || []).filter((item) =>
      item.account_id === accountId &&
      Date.parse(item.ends_at) > now().getTime()
    );
    return [...reservations, ...busy].some((item) => {
      const itemStart = Date.parse(item.starts_at);
      const itemEnd = Date.parse(item.ends_at);
      return itemStart < endTime && itemEnd > startTime;
    });
  }

  function isBookable(start) {
    const candidate = new Date(start);
    const window = reservationWindow(candidate);
    if (!selectedAccount() || !window) return false;
    if (candidate.getTime() > state.bookingMax.getTime()) return false;
    return !slotConflict(candidate, window.end);
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

    const start = alignedResetStart(new Date(`${dayCell.dataset.date}T${slot.dataset.time}`));
    if (!start || Number.isNaN(start.getTime()) || !isBookable(start, 5)) {
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
        if (!start || !isBookable(start, 5)) {
          components().showToast("Esse horário não está mais livre para solicitação.", "warning");
          return;
        }
        openBooking(start);
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
          const aligned = alignedResetStart(info.start);
          return Boolean(aligned && isBookable(aligned, 5));
        },
        dateClick: (info) => {
          const start = alignedResetStart(info.date);
          if (!start || !isBookable(start, 5)) {
            const limit = components().formatDate(state.bookingMax);
            const isPastBookingMax = Boolean(start && state.bookingMax && start.getTime() > state.bookingMax.getTime());
            components().showToast(isPastBookingMax ? `Solicitações disponíveis até ${limit}.` : "Esse horário não está livre para solicitação.", "warning");
            return;
          }
          openBooking(start);
        },
        select: (info) => {
          state.calendar.unselect();
          const start = alignedResetStart(info.start);
          if (!start || !isBookable(start, 5)) {
            components().showToast("Não há um ciclo completo de 5 horas livre após esse horário.", "warning");
            return;
          }
          openBooking(start);
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

  function getDayPeriodLabel(date) {
    const hours = date.getHours();
    if (hours >= 0 && hours < 6) return { label: "Madrugada", icon: "ph-moon-stars" };
    if (hours >= 6 && hours < 12) return { label: "Manhã", icon: "ph-sun" };
    if (hours >= 12 && hours < 18) return { label: "Tarde", icon: "ph-sun-dim" };
    return { label: "Noite", icon: "ph-moon" };
  }

  function getDayRelativeName(date) {
    if (!date) return "";
    const today = calendarTools().startOfDay(now());
    const target = calendarTools().startOfDay(date);
    const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
    if (diffDays === 0) return "Hoje";
    if (diffDays === 1) return "Amanhã";
    if (diffDays === 2) return "Depois de amanhã";
    const daysOfWeek = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
    return daysOfWeek[target.getDay()];
  }

  function getDayFormattedShort(date) {
    const daysShort = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    return daysShort[date.getDay()];
  }

  function getFormattedDateExtended(date) {
    if (!date) return "";
    const months = [
      "janeiro", "fevereiro", "março", "abril", "maio", "junho",
      "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
    ];
    return `${date.getDate()} de ${months[date.getMonth()]}`;
  }

  function generateSlotsForDate(targetDate, account = selectedAccount()) {
    if (!account) return [];
    const dayStart = calendarTools().startOfDay(targetDate);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const active = isAccountWindowActive(account);
    const anchor = resetMilliseconds(fiveHourWindow(account));
    const fiveHoursMs = 5 * 3_600_000;
    const current = now().getTime();
    const isToday = dayStart.getTime() === calendarTools().startOfDay(now()).getTime();
    const slots = [];

    // 1. Immediate slot if date is today
    if (isToday) {
      const imm = reservationWindow(now(), account);
      if (imm && imm.end.getTime() > current + 5 * 60_000) {
        const isConflict = slotConflict(imm.start, imm.end, account.account_id);
        const period = getDayPeriodLabel(imm.start);
        const relativeDay = getDayRelativeName(imm.start);
        const durationHours = Math.max(1, Math.round((imm.end.getTime() - imm.start.getTime()) / 3_600_000));
        slots.push({
          start: imm.start,
          end: imm.end,
          isPartial: !imm.complete,
          durationHours,
          isPast: false,
          isBusy: isConflict,
          isAvailable: !isConflict && imm.start.getTime() <= state.bookingMax.getTime(),
          period,
          relativeDay,
          periodTag: `${relativeDay} • ${period.label}`,
        });
      }
    }

    // 2. Future 5-hour slots throughout target day
    const baseAnchor = (active && anchor) ? anchor : (current + fiveHoursMs);
    let t = baseAnchor - Math.ceil((baseAnchor - dayStart.getTime()) / fiveHoursMs) * fiveHoursMs;
    while (t < dayStart.getTime() - fiveHoursMs) {
      t += fiveHoursMs;
    }

    while (t < dayEnd.getTime()) {
      const slotStart = new Date(t);
      const slotEnd = new Date(t + fiveHoursMs);

      const isNearNow = isToday && Math.abs(slotStart.getTime() - current) < 10 * 60_000;

      if (!isNearNow && slotStart.getTime() >= dayStart.getTime() && slotStart.getTime() < dayEnd.getTime()) {
        const isPast = slotStart.getTime() < current - 60_000;
        const isConflict = slotConflict(slotStart, slotEnd, account.account_id);
        const isWithinMax = slotStart.getTime() <= state.bookingMax.getTime();
        const period = getDayPeriodLabel(slotStart);
        const relativeDay = getDayRelativeName(slotStart);
        const dayShort = getDayFormattedShort(slotStart);
        const diffDays = Math.round((dayStart.getTime() - calendarTools().startOfDay(now()).getTime()) / 86_400_000);

        slots.push({
          start: slotStart,
          end: slotEnd,
          isPartial: false,
          durationHours: 5,
          isPast,
          isBusy: !isPast && isConflict,
          isAvailable: !isPast && !isConflict && isWithinMax,
          period,
          relativeDay,
          periodTag: diffDays <= 1 ? `${relativeDay} • ${period.label}` : `${dayShort} • ${period.label}`,
        });
      }

      t += fiveHoursMs;
    }

    return slots;
  }

  function updateCarouselCardClasses() {
    const track = $("#booking-carousel-track");
    if (!track) return;
    const cards = track.querySelectorAll(".booking-carousel-card");
    cards.forEach((card, i) => {
      const diff = i - state.carouselIndex;
      card.classList.remove("is-center", "is-prev", "is-next", "is-far-prev", "is-far-next", "is-hidden");
      if (diff === 0) {
        card.classList.add("is-center");
      } else if (diff === -1) {
        card.classList.add("is-prev");
      } else if (diff === 1) {
        card.classList.add("is-next");
      } else if (diff === -2) {
        card.classList.add("is-far-prev");
      } else if (diff === 2) {
        card.classList.add("is-far-next");
      } else {
        card.classList.add("is-hidden");
      }
      card.setAttribute("aria-selected", String(diff === 0));
    });

    const dotsContainer = $("#booking-carousel-dots");
    if (dotsContainer) {
      const dots = dotsContainer.querySelectorAll(".carousel-dot");
      dots.forEach((dot, i) => {
        dot.classList.toggle("is-active", i === state.carouselIndex);
      });
      const activeDot = dots[state.carouselIndex];
      if (activeDot && typeof activeDot.scrollIntoView === "function") {
        activeDot.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    }

    const prevBtn = $("#carousel-prev-btn");
    const nextBtn = $("#carousel-next-btn");
    if (prevBtn) prevBtn.disabled = state.carouselIndex <= 0;
    if (nextBtn) nextBtn.disabled = state.carouselIndex >= state.carouselSlots.length - 1;

    syncSelectedSlotDetails();
  }

  function syncSelectedSlotDetails() {
    const slot = state.carouselSlots[state.carouselIndex];
    if (!slot) {
      const feedback = $("#booking-feedback");
      if (feedback) feedback.className = "booking-feedback is-past";
      const feedbackText = $("#booking-feedback-text");
      if (feedbackText) feedbackText.textContent = "Nenhum intervalo disponível para esta data.";
      const submit = $("#booking-submit");
      if (submit) submit.disabled = true;
      return;
    }

    $("#booking-date").value = dateInputValue(slot.start);
    $("#booking-time").value = timeInputValue(slot.start);

    const feedback = $("#booking-feedback");
    const feedbackText = $("#booking-feedback-text");
    const submit = $("#booking-submit");

    if (slot.isAvailable) {
      if (feedback) {
        feedback.className = "booking-feedback is-available";
        const icon = feedback.querySelector(".ph");
        if (icon) icon.className = "ph ph-check-circle";
      }
      if (feedbackText) {
        feedbackText.textContent = `Intervalo pronto para agendamento (${components().formatTime(slot.start)} às ${components().formatTime(slot.end)} • ${slot.isPartial ? `${slot.durationHours}h disponíveis` : "5 horas completas"}).`;
      }
      if (submit) submit.disabled = false;
    } else if (slot.isBusy) {
      if (feedback) {
        feedback.className = "booking-feedback is-conflict";
        const icon = feedback.querySelector(".ph");
        if (icon) icon.className = "ph ph-warning-circle";
      }
      if (feedbackText) {
        feedbackText.textContent = "Este horário já está reservado ou em análise para outro usuário.";
      }
      if (submit) submit.disabled = true;
    } else {
      if (feedback) {
        feedback.className = "booking-feedback is-past";
        const icon = feedback.querySelector(".ph");
        if (icon) icon.className = "ph ph-clock";
      }
      if (feedbackText) {
        feedbackText.textContent = "Este horário já encerrou. Escolha um próximo intervalo livre.";
      }
      if (submit) submit.disabled = true;
    }

    const summaryTitle = $("#booking-summary-title");
    if (summaryTitle) summaryTitle.textContent = slot.isPartial ? "Janela disponível agora" : "5 horas de acesso completo";
    const summaryWindow = $("#booking-summary-window");
    if (summaryWindow) summaryWindow.textContent = `${components().formatDateTime(slot.start)} até ${components().formatTime(slot.end)}`;
  }

  function renderBookingCarousel() {
    if (!state.bookingSelectedDate) {
      state.bookingSelectedDate = calendarTools().startOfDay(now());
    }

    const dayName = $("#booking-date-day-name");
    if (dayName) dayName.textContent = getDayRelativeName(state.bookingSelectedDate);

    const formattedDate = $("#booking-date-formatted");
    if (formattedDate) formattedDate.textContent = getFormattedDateExtended(state.bookingSelectedDate);

    const dateInput = $("#booking-date");
    if (dateInput) {
      dateInput.value = dateInputValue(state.bookingSelectedDate);
      dateInput.min = dateInputValue(calendarTools().startOfDay(now()));
      dateInput.max = dateInputValue(state.bookingMax);
    }

    const prevDateBtn = $("#booking-date-prev");
    if (prevDateBtn) {
      prevDateBtn.disabled = state.bookingSelectedDate.getTime() <= calendarTools().startOfDay(now()).getTime();
    }
    const nextDateBtn = $("#booking-date-next");
    if (nextDateBtn) {
      nextDateBtn.disabled = state.bookingSelectedDate.getTime() >= calendarTools().startOfDay(state.bookingMax).getTime();
    }

    const slots = generateSlotsForDate(state.bookingSelectedDate, selectedAccount());
    state.carouselSlots = slots;

    if (state.carouselIndex >= slots.length) {
      state.carouselIndex = Math.max(0, slots.length - 1);
    } else if (state.carouselIndex < 0) {
      state.carouselIndex = 0;
    }

    const track = $("#booking-carousel-track");
    if (track) {
      if (!slots.length) {
        track.innerHTML = `<div class="booking-carousel-empty"><p>Nenhum horário gerado para este dia.</p></div>`;
      } else {
        track.innerHTML = slots.map((slot, i) => {
          const diff = i - state.carouselIndex;
          const posClass = diff === 0 ? "is-center" : diff === -1 ? "is-prev" : diff === 1 ? "is-next" : diff === -2 ? "is-far-prev" : diff === 2 ? "is-far-next" : "is-hidden";
          const statusClass = slot.isAvailable ? "is-available" : slot.isBusy ? "is-busy is-blocked" : "is-past is-blocked";
          const badgeClass = slot.isAvailable ? "is-available" : slot.isBusy ? "is-busy" : "is-past";
          const badgeText = slot.isAvailable ? `Disponível (${slot.durationHours}h)` : slot.isBusy ? "Ocupado" : "Encerrado";
          const descText = slot.isPartial ? `${slot.durationHours} horas • janela em andamento` : "5 horas completas • 100% quota";

          return `
            <article class="booking-carousel-card booking-slot-card carousel-slot slot-button ${posClass} ${statusClass}" data-slot-index="${i}" role="tab" aria-selected="${diff === 0}">
              <div class="carousel-card-header">
                <span class="carousel-period-pill">
                  <i class="ph ${slot.period.icon}" aria-hidden="true"></i>
                  <span>${components().escapeHTML(slot.periodTag)}</span>
                </span>
                <span class="carousel-status-badge ${badgeClass}">
                  <span class="status-indicator-dot"></span>
                  <span>${components().escapeHTML(badgeText)}</span>
                </span>
              </div>
              <div class="carousel-card-time">
                <span class="time-part">${components().formatTime(slot.start)}</span>
                <i class="ph ph-arrow-right time-arrow" aria-hidden="true"></i>
                <span class="time-part">${components().formatTime(slot.end)}</span>
              </div>
              <div class="carousel-card-footer">
                <span class="carousel-card-desc">${components().escapeHTML(descText)}</span>
              </div>
            </article>
          `;
        }).join("");
      }
    }

    const dotsContainer = $("#booking-carousel-dots");
    if (dotsContainer) {
      dotsContainer.innerHTML = slots.map((_, i) => `
        <button type="button" class="carousel-dot ${i === state.carouselIndex ? "is-active" : ""}" data-index="${i}" aria-label="Ir para intervalo ${i + 1}"></button>
      `).join("");
    }

    updateCarouselCardClasses();
  }

  function setCarouselIndex(index) {
    if (index < 0 || index >= state.carouselSlots.length) return;
    state.carouselIndex = index;
    updateCarouselCardClasses();
  }

  function carouselPrev() {
    if (state.carouselIndex > 0) {
      setCarouselIndex(state.carouselIndex - 1);
    }
  }

  function carouselNext() {
    if (state.carouselIndex < state.carouselSlots.length - 1) {
      setCarouselIndex(state.carouselIndex + 1);
    }
  }

  function bookingDatePrev() {
    const today = calendarTools().startOfDay(now());
    const prevDay = calendarTools().addDays(state.bookingSelectedDate, -1);
    if (prevDay.getTime() >= today.getTime()) {
      state.bookingSelectedDate = prevDay;
      state.carouselIndex = 0;
      renderBookingCarousel();
      findFirstAvailableSlotOrIndex();
    }
  }

  function bookingDateNext() {
    const maxDay = calendarTools().startOfDay(state.bookingMax);
    const nextDay = calendarTools().addDays(state.bookingSelectedDate, 1);
    if (nextDay.getTime() <= maxDay.getTime()) {
      state.bookingSelectedDate = nextDay;
      state.carouselIndex = 0;
      renderBookingCarousel();
      findFirstAvailableSlotOrIndex();
    }
  }

  function findFirstAvailableSlotOrIndex() {
    const availIdx = state.carouselSlots.findIndex((s) => s.isAvailable);
    if (availIdx >= 0) {
      setCarouselIndex(availIdx);
    } else {
      setCarouselIndex(0);
    }
  }

  function renderBookingOptions() {
    const accounts = readyAccounts();
    const select = $("#booking-account");
    if (select) {
      if (!select.options.length || [...select.options].some((option) => option.value !== accounts.find((account) => account.account_id === option.value)?.account_id)) {
        select.innerHTML = accounts.map((account) => `<option value="${components().escapeHTML(account.account_id)}">${components().escapeHTML(account.label || account.account_id)}</option>`).join("");
      }
      if (selectedAccount()) select.value = selectedAccount().account_id;
    }

    const accountField = $("#booking-account-field") || $(".booking-account-tabs-wrapper");
    if (accountField) accountField.hidden = accounts.length <= 1;

    const tabsContainer = $("#booking-account-tabs");
    if (tabsContainer) {
      tabsContainer.innerHTML = accounts.map((account) => {
        const isActive = account.account_id === selectedAccount()?.account_id;
        return `<button type="button" class="booking-account-tab ${isActive ? "is-active" : ""}" data-booking-account="${components().escapeHTML(account.account_id)}" role="tab" aria-selected="${isActive}">
          <span>${components().escapeHTML(account.label || account.account_id)}</span>
          <span class="tab-badge">100% livre</span>
        </button>`;
      }).join("");
    }

    const today = calendarTools().startOfDay(now());
    const dateInput = $("#booking-date");
    if (dateInput) {
      dateInput.min = dateInputValue(today);
      dateInput.max = dateInputValue(state.bookingMax);
    }
  }

  function renderNotifications() {
    const items = [];
    const reservations = (state.data?.reservations || []).slice();
    reservations
      .filter((item) => item.reviewed_at && ["approved", "rejected"].includes(item.approval_status))
      .sort((a, b) => Date.parse(b.reviewed_at) - Date.parse(a.reviewed_at))
      .slice(0, 6)
      .forEach((item) => {
        const rejected = item.approval_status === "rejected";
        const decision = rejected ? "Solicitação recusada" : "Solicitação aprovada";
        const durationHours = (Date.parse(item.ends_at) - Date.parse(item.starts_at)) / 3_600_000;
        const quotaCopy = rejected ? "" : durationHours < 5 ? ` Acesso disponível até ${components().formatTime(item.ends_at)}.` : " Janela completa de 5 horas (100%).";
        const noteCopy = item.review_note ? ` Justificativa: ${item.review_note}` : " Sem justificativa informada.";
        items.push({
          type: rejected ? "danger" : "success",
          icon: rejected ? "ph-x-circle" : "ph-check-circle",
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
        const durationHours = (Date.parse(item.ends_at) - Date.parse(item.starts_at)) / 3_600_000;
        const windowCopy = durationHours < 5 ? `até ${components().formatTime(item.ends_at)}` : "por 5 horas";
        items.push({ type: "warning", icon: "ph-clock", title: "Solicitação em análise", message: `${components().formatDateTime(item.starts_at)} · acesso ${windowCopy} em ${item.account_id}.`, time: formatRelative(item.created_at) });
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
    const immediate = now();
    immediate.setSeconds(0, 0);
    if (isBookable(immediate)) return immediate;

    let candidate = alignedResetStart(now());
    while (candidate && candidate.getTime() <= state.bookingMax.getTime()) {
      if (isBookable(candidate)) return candidate;
      candidate = new Date(candidate.getTime() + 5 * 3_600_000);
    }
    return null;
  }

  function setBookingMessage(message = "") {
    const output = $("#booking-message");
    output.textContent = message;
    output.hidden = !message;
  }

  function updateBookingEnd() {
    const requested = inputDateTime($("#booking-date").value, $("#booking-time").value);
    let start = requested;
    let window = start ? reservationWindow(start) : null;
    if (start && !window) {
      start = alignedResetStart(start);
      window = start ? reservationWindow(start) : null;
    }
    const adjustedByMinutes = start && requested ? Math.abs(start.getTime() - requested.getTime()) >= 60_000 : false;
    if (start && requested && start.getTime() !== requested.getTime()) {
      $("#booking-date").value = dateInputValue(start);
      $("#booking-time").value = timeInputValue(start);
    }
    const end = window?.end || null;
    const summaryTitle = $("#booking-summary-title");
    if (summaryTitle) {
      summaryTitle.textContent = window?.complete ? "5 horas de acesso completo" : window ? "Usar a janela disponível agora" : "Horário da sessão";
    }
    const summaryWindow = $("#booking-summary-window");
    if (summaryWindow) {
      summaryWindow.textContent = start && end
        ? `${components().formatDateTime(start)} até ${components().formatTime(end)}`
        : "Escolha a data e o horário";
    }
    const quota = $("#booking-summary-quota");
    if (quota) {
      const rawUsedPercent = fiveHourWindow(selectedAccount())?.usedPercent;
      const usedPercent = typeof rawUsedPercent === "number" ? rawUsedPercent : Number.NaN;
      const remainingPercent = Number.isFinite(usedPercent) ? Math.max(0, Math.min(100, Math.round(100 - usedPercent))) : null;
      quota.hidden = Boolean(!window || window.complete || remainingPercent === null);
      quota.textContent = !quota.hidden ? `${remainingPercent}% da quota de 5 horas disponível agora` : "";
    }
    const adjustment = $("#booking-adjustment");
    if (adjustment) {
      adjustment.hidden = !adjustedByMinutes;
      adjustment.textContent = adjustedByMinutes && start
        ? `Ajustamos para ${components().formatTime(start)}, o próximo horário com 5 horas completas.`
        : "";
    }
    const feedback = $("#booking-feedback-text");
    if (feedback) {
      feedback.textContent = start && end
        ? `Intervalo pronto para agendamento (${components().formatTime(start)} às ${components().formatTime(end)} • 5 horas completas).`
        : "Selecione um intervalo";
    }
  }

  function openBooking(start = null) {
    hideCalendarHover();
    if (!readyAccounts().length) {
      components().showToast("Nenhuma conta está pronta para receber agendamentos.", "warning");
      return;
    }
    renderBookingOptions();

    let value = start ? (reservationWindow(start) ? new Date(start) : alignedResetStart(start)) : nextBookableStart();
    if (!value || value.getTime() < now().getTime() - 60_000 || value.getTime() > state.bookingMax.getTime()) value = nextBookableStart() || now();

    state.bookingSelectedDate = calendarTools().startOfDay(value);
    renderBookingCarousel();

    const matchingIdx = state.carouselSlots.findIndex((s) => Math.abs(s.start.getTime() - value.getTime()) <= 60_000);
    if (matchingIdx >= 0) {
      setCarouselIndex(matchingIdx);
    } else {
      findFirstAvailableSlotOrIndex();
    }

    setBookingMessage();
    const modal = $("#booking-modal");
    if (typeof modal.showModal === "function") modal.showModal();
    else modal.setAttribute("open", "");
    window.setTimeout(() => $("#booking-date")?.focus(), 60);
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

  function addPreviewReservation(start, accountId) {
    const end = reservationWindow(start)?.end || new Date(start.getTime() + 5 * 3_600_000);
    state.data.reservations.push({
      id: `preview-${Date.now()}`,
      account_id: accountId,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      status: "scheduled",
      approval_status: "approved",
      requested_quota_percent: 100,
      quota_budget_percent: 100,
      created_at: new Date().toISOString(),
    });
  }

  async function submitBooking(event) {
    event.preventDefault();
    const start = inputDateTime($("#booking-date").value, $("#booking-time").value);
    const accountId = $("#booking-account").value;
    if (!start || !accountId) {
      setBookingMessage("Confira os dados do agendamento.");
      return;
    }
    if (!isBookable(start)) {
      setBookingMessage(start.getTime() > state.bookingMax.getTime() ? `Solicitações disponíveis até ${components().formatDate(state.bookingMax)}.` : "Esse horário não está livre. Para usar agora, escolha o minuto atual; para depois, escolha o início de um novo ciclo.");
      return;
    }
    const button = $("#booking-submit");
    button.disabled = true;
    setBookingMessage("Enviando solicitação…");
    try {
      if (preview) {
        addPreviewReservation(start, accountId);
        closeBooking();
        loadDashboardData({ ...state.data, serverTime: new Date().toISOString(), reservations: state.data.reservations });
        components().showToast("Pedido enviado para aprovação.", "success");
      } else {
        await api("/api/user/reservations", { method: "POST", body: JSON.stringify({ startsAt: start.toISOString(), durationHours: 5, accountId, requestedQuotaPercent: 100 }) });
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
    $("#open-booking-top")?.addEventListener("click", () => openBooking());
    $("#booking-close").addEventListener("click", closeBooking);
    $("#booking-cancel").addEventListener("click", closeBooking);
    $("#booking-form").addEventListener("submit", submitBooking);

    // Carousel buttons
    $("#carousel-prev-btn")?.addEventListener("click", carouselPrev);
    $("#carousel-next-btn")?.addEventListener("click", carouselNext);

    // Date navigation buttons
    $("#booking-date-prev")?.addEventListener("click", bookingDatePrev);
    $("#booking-date-next")?.addEventListener("click", bookingDateNext);

    // Date input change
    $("#booking-date")?.addEventListener("change", (e) => {
      const val = e.currentTarget.value;
      if (val) {
        state.bookingSelectedDate = calendarTools().startOfDay(new Date(`${val}T00:00:00`));
        renderBookingCarousel();
        findFirstAvailableSlotOrIndex();
      }
    });

    // Account tab buttons
    $("#booking-account-tabs")?.addEventListener("click", (e) => {
      const tab = e.target.closest("[data-booking-account]");
      if (tab) {
        state.selectedAccountId = tab.dataset.bookingAccount;
        renderBookingOptions();
        renderBookingCarousel();
        findFirstAvailableSlotOrIndex();
      }
    });

    // Carousel track card click
    $("#booking-carousel-track")?.addEventListener("click", (e) => {
      const card = e.target.closest(".booking-carousel-card");
      if (card && card.dataset.slotIndex !== undefined) {
        setCarouselIndex(Number(card.dataset.slotIndex));
      }
    });

    // Carousel dots click
    $("#booking-carousel-dots")?.addEventListener("click", (e) => {
      const dot = e.target.closest(".carousel-dot");
      if (dot && dot.dataset.index !== undefined) {
        setCarouselIndex(Number(dot.dataset.index));
      }
    });

    // Carousel touch / mouse drag with real-time smooth tracking
    const track = $("#booking-carousel-track");
    if (track) {
      const onDragStart = (e) => {
        state.isDraggingCarousel = true;
        state.dragStartX = e.pageX !== undefined ? e.pageX : (e.touches?.[0]?.pageX || 0);
        state.dragDeltaX = 0;
        track.classList.add("is-dragging");
        track.style.transition = "none";
      };

      const onDragMove = (e) => {
        if (!state.isDraggingCarousel) return;
        const currentX = e.pageX !== undefined ? e.pageX : (e.touches?.[0]?.pageX || 0);
        if (!currentX) return;
        state.dragDeltaX = currentX - state.dragStartX;
        let offset = state.dragDeltaX;
        // Damping at edge limits
        if ((state.carouselIndex === 0 && offset > 0) || (state.carouselIndex >= state.carouselSlots.length - 1 && offset < 0)) {
          offset = offset * 0.32;
        }
        track.style.transform = `translateX(${offset}px) rotateY(${offset * -0.035}deg)`;
      };

      const onDragEnd = () => {
        if (!state.isDraggingCarousel) return;
        state.isDraggingCarousel = false;
        track.classList.remove("is-dragging");

        const diffX = state.dragDeltaX;
        state.dragDeltaX = 0;

        track.style.transition = "transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)";
        track.style.transform = "";

        window.setTimeout(() => {
          if (!state.isDraggingCarousel) {
            track.style.transition = "";
          }
        }, 300);

        if (diffX < -40) {
          carouselNext();
        } else if (diffX > 40) {
          carouselPrev();
        }
      };

      track.addEventListener("mousedown", onDragStart);
      window.addEventListener("mousemove", onDragMove);
      window.addEventListener("mouseup", onDragEnd);

      track.addEventListener("touchstart", onDragStart, { passive: true });
      track.addEventListener("touchmove", onDragMove, { passive: true });
      track.addEventListener("touchend", onDragEnd, { passive: true });
      track.addEventListener("touchcancel", onDragEnd, { passive: true });
    }

    $("#booking-account")?.addEventListener("change", (event) => {
      state.selectedAccountId = event.currentTarget.value;
      renderBookingOptions();
      renderBookingCarousel();
      findFirstAvailableSlotOrIndex();
    });
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
