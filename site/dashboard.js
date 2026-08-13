(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const state = { config: null, data: null, selectedDate: null, selectedHour: null, duration: 1, nowOffset: 0 };
  const formatter = new Intl.NumberFormat("pt-BR");

  function localTokenKey(reservationId) { return `remote_codex_reservation_${reservationId}`; }
  function now() { return new Date(Date.now() + state.nowOffset); }
  function startOfDay(date) { const value = new Date(date); value.setHours(0, 0, 0, 0); return value; }
  function sameDay(left, right) { return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate(); }
  function formatShort(date) { return new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short" }).format(date).replace(".", ""); }
  function formatDateTime(value) { return new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
  function activeReservation() {
    const timestamp = now().getTime();
    return (state.data?.reservations || []).find((item) => item.status === "scheduled" && Date.parse(item.starts_at) <= timestamp && Date.parse(item.ends_at) > timestamp) || null;
  }
  function deviceFor(reservation) { return reservation ? (state.data?.devices || []).find((item) => item.reservation_id === reservation.id) || null : null; }
  function tokenFor(reservation) {
    if (!reservation) return null;
    try {
      const stored = JSON.parse(localStorage.getItem(localTokenKey(reservation.id)) || "null");
      if (!stored?.token || Date.parse(stored.expiresAt) <= now().getTime()) { localStorage.removeItem(localTokenKey(reservation.id)); return null; }
      return stored;
    } catch { return null; }
  }

  async function api(path, options = {}, retry = true) {
    const session = window.RemoteCodexAuth.getSession();
    if (!session?.access_token) { window.location.replace("/login"); throw new Error("Sessão ausente."); }
    const response = await fetch(path, { ...options, headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", ...(options.headers || {}) }, cache: "no-store" });
    if (response.status === 401 && retry && session.refresh_token) {
      await window.RemoteCodexAuth.refreshSession(state.config);
      return api(path, options, false);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Não foi possível concluir a operação.");
    return data;
  }

  async function loadDashboard(silent = false) {
    if (!silent) $("#sync-status").innerHTML = "<span></span> Sincronizando";
    const data = await api("/api/user/dashboard");
    state.data = data;
    state.nowOffset = Date.parse(data.serverTime) - Date.now();
    if (!state.selectedDate) state.selectedDate = startOfDay(now());
    render();
    $("#sync-status").innerHTML = `<span></span> ${data.relay?.ready ? "Host online" : "Host indisponível"}`;
    $("#sync-status").classList.toggle("offline", !data.relay?.ready);
  }

  function renderIdentity() {
    const profile = state.data.profile;
    $("#user-name").textContent = profile.username;
    $("#user-group").textContent = profile.group_name;
    $("#user-avatar").textContent = profile.username.slice(0, 2).toUpperCase();
    $("#quota-budget").textContent = `${Number(profile.weekly_quota_percent)}%`;
  }

  function renderClock() {
    const current = now();
    $("#current-time").textContent = current.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    $("#current-seconds").textContent = current.toLocaleTimeString("pt-BR", { second: "2-digit" }).slice(-2);
    $("#current-date").textContent = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" }).format(current);
    const reservation = activeReservation();
    const device = deviceFor(reservation);
    const future = (state.data?.reservations || []).filter((item) => item.status === "scheduled" && Date.parse(item.starts_at) > current.getTime()).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0];
    $("#next-booking").textContent = future ? formatDateTime(future.starts_at) : "Nenhuma";
    $("#tokens-used").textContent = formatter.format(Number(device?.observed_tokens || 0));
    if (reservation) {
      const remainingMs = Math.max(0, Date.parse(reservation.ends_at) - current.getTime());
      const hours = Math.floor(remainingMs / 3_600_000);
      const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
      $("#time-left").textContent = `${hours}h ${String(minutes).padStart(2, "0")}min`;
      $("#session-state").className = "state-chip online";
      $("#session-state").innerHTML = "<i></i> Horário ativo";
      $("#session-message").textContent = `Sua janela termina às ${new Date(reservation.ends_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`;
    } else {
      $("#time-left").textContent = "—";
      $("#session-state").className = "state-chip offline";
      $("#session-state").innerHTML = "<i></i> Desligado";
      $("#session-message").textContent = future ? "Aguardando o próximo horário reservado." : "Nenhum horário ativo agora.";
    }
    renderQuota(reservation, device);
    renderCredential(reservation, device);
  }

  function renderQuota(reservation, device) {
    const budget = Number(device?.quota_budget_percent ?? state.data.profile.weekly_quota_percent ?? 5);
    const base = Number(device?.quota_base_used_percent ?? 0);
    const current = Number(device?.account_used_percent ?? base);
    const consumed = reservation && device ? Math.max(0, current >= base ? current - base : current) : 0;
    const remaining = Math.max(0, Math.min(100, Math.round((1 - consumed / Math.max(budget, 0.01)) * 100)));
    $("#quota-ring").style.setProperty("--remaining", String(remaining));
    $("#quota-value").textContent = `${remaining}%`;
    const limited = device?.status === "limited" || Boolean(device?.usage_limit_reached_at);
    $("#quota-account-state").textContent = limited ? "limite atingido" : reservation ? "em uso" : "bloqueada";
    $("#quota-reset").textContent = device?.account_resets_at ? `Janela da conta reinicia em ${formatDateTime(device.account_resets_at)}.` : reservation ? "Uso observado em tempo real pelo host." : "Libera junto com o horário reservado.";
  }

  function remoteAddress() { return `wss://${window.location.hostname}:443`; }
  function commandFor(token) { return `$env:CODEX_REMOTE_TOKEN = "${token}"\ncodex --remote "${remoteAddress()}" --remote-auth-token-env CODEX_REMOTE_TOKEN`; }
  function renderCredential(reservation, device) {
    let stored = tokenFor(reservation);
    const unavailable = Boolean(device && ["limited", "revoked", "disabled", "expired"].includes(device.status));
    if (stored && unavailable) {
      localStorage.removeItem(`remote-codex-session:${reservation.id}`);
      stored = null;
    }
    const quick = $("#quick-access");
    const active = Boolean(reservation);
    quick.classList.toggle("locked", !active);
    quick.classList.toggle("ready", active);
    $("#credential-locked").hidden = active;
    $("#credential-ready").hidden = !stored;
    $("#issue-session").hidden = !active || Boolean(stored) || Boolean(reservation?.device_id);
    if (stored) {
      $("#session-command").textContent = commandFor(stored.token);
      $("#quick-access-description").textContent = "Credencial ativa neste navegador. Copie e execute no PowerShell.";
    } else if (active && reservation?.device_id) {
      $("#quick-access-description").textContent = "A credencial já foi emitida em outra janela e não pode ser recuperada. Aguarde a próxima reserva.";
    } else if (active) {
      $("#quick-access-description").textContent = "Seu horário começou. Gere agora a credencial temporária.";
    } else {
      $("#quick-access-description").textContent = "Agende um horário para liberar sua credencial temporária.";
    }
    if (unavailable) $("#quick-access-description").textContent = device?.status === "limited" ? "A franquia desta sessão terminou e o acesso foi bloqueado." : "Esta credencial não está mais disponível.";
  }

  function renderDates() {
    const strip = $("#date-strip");
    const today = startOfDay(now());
    strip.innerHTML = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today.getTime() + index * 86_400_000);
      const selected = sameDay(date, state.selectedDate);
      return `<button type="button" role="tab" aria-selected="${selected}" class="${selected ? "active" : ""}" data-date="${date.toISOString()}"><span>${index === 0 ? "Hoje" : date.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}</span><strong>${date.getDate()}</strong><small>${date.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</small></button>`;
    }).join("");
    strip.querySelectorAll("[data-date]").forEach((button) => button.addEventListener("click", () => { state.selectedDate = startOfDay(new Date(button.dataset.date)); state.selectedHour = null; renderDates(); renderHours(); }));
  }

  function slotConflict(start, duration) {
    const end = start.getTime() + duration * 3_600_000;
    return (state.data.busySlots || []).some((slot) => Date.parse(slot.starts_at) < end && Date.parse(slot.ends_at) > start.getTime());
  }

  function renderHours() {
    const container = $("#hour-slots");
    container.innerHTML = Array.from({ length: 24 }, (_, hour) => {
      const start = new Date(state.selectedDate); start.setHours(hour, 0, 0, 0);
      const past = start.getTime() < now().getTime();
      const busy = slotConflict(start, state.duration);
      const disabled = past || busy || hour + state.duration > 24;
      const selected = state.selectedHour === hour;
      return `<button type="button" data-hour="${hour}" class="${selected ? "selected" : ""} ${busy ? "busy" : ""}" ${disabled ? "disabled" : ""} title="${busy ? "Horário reservado" : past ? "Horário encerrado" : `${String(hour).padStart(2, "0")}:00`}"><span>${String(hour).padStart(2, "0")}</span><i></i></button>`;
    }).join("");
    container.querySelectorAll("[data-hour]:not(:disabled)").forEach((button) => button.addEventListener("click", () => { state.selectedHour = Number(button.dataset.hour); renderHours(); updateBookingSummary(); }));
    updateBookingSummary();
  }

  function selectedStart() { if (state.selectedHour === null) return null; const date = new Date(state.selectedDate); date.setHours(state.selectedHour, 0, 0, 0); return date; }
  function updateBookingSummary() {
    const start = selectedStart();
    $("#book-slot").disabled = !start;
    $("#booking-summary").textContent = start ? `${formatShort(start)} · ${String(start.getHours()).padStart(2, "0")}:00–${String(start.getHours() + state.duration).padStart(2, "0")}:00` : "Selecione um horário livre";
  }

  function renderReservations() {
    const list = $("#reservation-list");
    const rows = [...(state.data.reservations || [])].sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
    list.innerHTML = rows.length ? rows.map((item) => {
      const start = new Date(item.starts_at); const end = new Date(item.ends_at); const active = item.status === "scheduled" && start <= now() && end > now(); const future = item.status === "scheduled" && start > now();
      const status = item.status === "cancelled" ? "Cancelado" : active ? "Em andamento" : future ? "Agendado" : "Encerrado";
      return `<article class="reservation-row ${active ? "active" : ""}"><time><strong>${start.getDate()}</strong><span>${start.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</span></time><div><strong>${start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}–${end.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</strong><span>${start.toLocaleDateString("pt-BR", { weekday: "long" })}</span></div><span class="reservation-status">${status}</span>${future ? `<button type="button" class="quiet-button" data-cancel="${item.id}">Cancelar</button>` : ""}</article>`;
    }).join("") : `<div class="empty-state"><strong>Nenhum horário agendado</strong><span>Escolha um dia e uma hora na agenda acima.</span></div>`;
    list.querySelectorAll("[data-cancel]").forEach((button) => button.addEventListener("click", () => cancelReservation(button.dataset.cancel)));
  }

  function render() { renderIdentity(); renderClock(); renderDates(); renderHours(); renderReservations(); }

  async function book() {
    const start = selectedStart(); if (!start) return;
    const message = $("#booking-message"); message.textContent = "Agendando…";
    try { await api("/api/user/reservations", { method: "POST", body: JSON.stringify({ startsAt: start.toISOString(), durationHours: state.duration }) }); state.selectedHour = null; message.textContent = "Horário reservado com sucesso."; await loadDashboard(true); }
    catch (error) { message.textContent = error.message; message.className = "form-message error"; }
  }

  async function cancelReservation(id) {
    try { await api(`/api/user/reservations/${id}/cancel`, { method: "POST", body: "{}" }); await loadDashboard(true); }
    catch (error) { $("#booking-message").textContent = error.message; }
  }

  async function issueSession() {
    const reservation = activeReservation(); if (!reservation) return;
    const button = $("#issue-session"); button.disabled = true; $("#credential-status").textContent = "Gerando credencial no host central…";
    try {
      const result = await api(`/api/user/reservations/${reservation.id}/session`, { method: "POST", body: "{}" });
      localStorage.setItem(localTokenKey(reservation.id), JSON.stringify({ token: result.token, expiresAt: reservation.ends_at, deviceId: result.device?.deviceId }));
      $("#credential-status").textContent = "Credencial criada. Ela será removida deste navegador ao expirar.";
      await loadDashboard(true);
    } catch (error) { $("#credential-status").textContent = error.message; }
    finally { button.disabled = false; }
  }

  async function copyText(value, success) { try { await navigator.clipboard.writeText(value); $("#credential-status").textContent = success; } catch { $("#credential-status").textContent = "Não foi possível copiar. Selecione o comando manualmente."; } }
  async function logout() { await window.RemoteCodexAuth.signOut(state.config); window.location.replace("/login"); }

  async function init() {
    state.config = await window.RemoteCodexAuth.loadConfig();
    if (!window.RemoteCodexAuth.getSession()?.access_token) { window.location.replace("/login"); return; }
    $("#user-logout").addEventListener("click", logout);
    $("#refresh-dashboard").addEventListener("click", () => loadDashboard());
    $("#book-slot").addEventListener("click", book);
    $("#issue-session").addEventListener("click", issueSession);
    $("#copy-command").addEventListener("click", () => { const reservation = activeReservation(); const stored = tokenFor(reservation); if (stored) copyText(commandFor(stored.token), "Comando copiado."); });
    $("#copy-token").addEventListener("click", () => { const stored = tokenFor(activeReservation()); if (stored) copyText(stored.token, "Token copiado."); });
    document.querySelectorAll("[data-duration]").forEach((button) => button.addEventListener("click", () => { state.duration = Number(button.dataset.duration); document.querySelectorAll("[data-duration]").forEach((item) => item.classList.toggle("active", item === button)); state.selectedHour = null; renderHours(); }));
    await loadDashboard();
    setInterval(() => renderClock(), 1_000);
    setInterval(() => loadDashboard(true).catch(() => undefined), 30_000);
  }

  init().catch((error) => { $("#sync-status").textContent = error.message; });
})();
