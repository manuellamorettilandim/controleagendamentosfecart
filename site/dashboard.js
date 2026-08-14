(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const state = { config: null, data: null, selectedDate: null, selectedHour: null, duration: 1, nowOffset: 0, weekStart: null };
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
    if (!state.weekStart) state.weekStart = startOfDay(now());
    if (!state.selectedDate) state.selectedDate = new Date(state.weekStart);
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
    $("#quota-account-state").textContent = limited ? "limite atingido" : reservation ? "em uso" : "aguardando reserva";
    $("#quota-ring").setAttribute("aria-label", `${remaining}% da franquia disponível`);
    $("#quota-reset").textContent = device?.account_resets_at ? `Janela da conta reinicia em ${formatDateTime(device.account_resets_at)}.` : reservation ? "Uso observado em tempo real pelo host." : "Libera junto com o horário reservado.";
  }

  function remoteAddress() { return `wss://${window.location.hostname}:443`; }
  function commandFor(token) { return `$env:CODEX_REMOTE_TOKEN = "${token}"\ncodex --remote "${remoteAddress()}" --remote-auth-token-env CODEX_REMOTE_TOKEN`; }
  function renderCredential(reservation, device) {
    let stored = tokenFor(reservation);
    const unavailable = Boolean(device && ["limited", "revoked", "disabled", "expired"].includes(device.status));
    if (stored && unavailable) {
      localStorage.removeItem(localTokenKey(reservation.id));
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

  function slotConflict(start, duration) {
    const end = start.getTime() + duration * 3_600_000;
    return (state.data.busySlots || []).some((slot) => Date.parse(slot.starts_at) < end && Date.parse(slot.ends_at) > start.getTime());
  }

  function weekDays() {
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(state.weekStart);
      date.setDate(date.getDate() + index);
      return date;
    });
  }

  function formatWeekRange(days) {
    const start = days[0];
    const end = days.at(-1);
    const startText = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(start).replace(".", "");
    const endText = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(end).replace(".", "");
    return `${startText} – ${endText}`;
  }

  function eventSpanFor(day, startsAt, endsAt) {
    const dayStart = startOfDay(day).getTime();
    const dayEnd = dayStart + 24 * 3_600_000;
    const start = Math.max(dayStart, Date.parse(startsAt));
    const end = Math.min(dayEnd, Date.parse(endsAt));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return { start: (start - dayStart) / 3_600_000, span: Math.max(.5, (end - start) / 3_600_000) };
  }

  function calendarEventsFor(day) {
    const ownReservations = (state.data?.reservations || []).filter((item) => item.status === "scheduled" && eventSpanFor(day, item.starts_at, item.ends_at));
    const ownKeys = new Set(ownReservations.map((item) => `${item.starts_at}|${item.ends_at}`));
    const busy = (state.data?.busySlots || [])
      .filter((slot) => !ownKeys.has(`${slot.starts_at}|${slot.ends_at}`))
      .filter((slot) => eventSpanFor(day, slot.starts_at, slot.ends_at))
      .map((slot) => ({ ...slot, kind: "busy" }));
    return [
      ...ownReservations.map((item) => ({ ...item, kind: "mine" })),
      ...busy,
    ].map((event) => ({ ...event, geometry: eventSpanFor(day, event.starts_at, event.ends_at) }));
  }

  function renderCalendar() {
    const board = $("#calendar-board");
    const days = weekDays();
    const current = now();
    const today = startOfDay(current);
    $("#schedule-range").textContent = formatWeekRange(days);
    $("#calendar-prev").disabled = startOfDay(state.weekStart).getTime() <= today.getTime();
    $("#calendar-next").disabled = false;

    const headers = days.map((date) => {
      const isToday = sameDay(date, today);
      const weekday = date.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
      const month = date.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
      return `<div class="calendar-day-head ${isToday ? "today" : ""}"><span>${isToday ? "Hoje" : weekday}</span><strong>${date.getDate()}</strong><small>${month}</small></div>`;
    }).join("");
    const times = Array.from({ length: 24 }, (_, hour) => `<div class="calendar-time-label">${String(hour).padStart(2, "0")}:00</div>`).join("");
    const columns = days.map((date) => {
      const cells = Array.from({ length: 24 }, (_, hour) => {
        const start = new Date(date); start.setHours(hour, 0, 0, 0);
        const past = start.getTime() < current.getTime();
        const busy = slotConflict(start, state.duration);
        const selected = sameDay(date, state.selectedDate) && state.selectedHour === hour;
        const overflow = hour + state.duration > 24;
        const disabled = past || busy || overflow;
        const title = busy ? "Horário reservado" : past ? "Horário encerrado" : overflow ? "A duração ultrapassa o dia" : `Reservar ${String(hour).padStart(2, "0")}:00`;
        return `<div class="calendar-cell ${past ? "past" : ""} ${selected ? "selected" : ""}"><button type="button" data-date="${date.toISOString()}" data-hour="${hour}" aria-label="${title}" title="${title}" ${disabled ? "disabled" : ""}></button></div>`;
      }).join("");
      const events = calendarEventsFor(date).map((event) => {
        const start = new Date(event.starts_at);
        const label = event.kind === "mine" ? "Sua reserva" : "Ocupado";
        const time = `${start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · ${Math.round(event.geometry.span)}h`;
        return `<div class="calendar-event ${event.kind}" style="--event-start:${event.geometry.start};--event-span:${event.geometry.span}" aria-label="${label}, ${time}"><strong>${label}</strong><span>${time}</span></div>`;
      }).join("");
      const nowLine = sameDay(date, today) ? `<div class="calendar-now-line" style="--now-position:${current.getHours() + current.getMinutes() / 60}"><span class="sr-only">Agora</span></div>` : "";
      return `<div class="calendar-day-column">${cells}${events}${nowLine}</div>`;
    }).join("");
    board.innerHTML = `<div class="calendar-corner">HORA</div>${headers}<div class="calendar-time-column">${times}</div>${columns}`;
    board.querySelectorAll(".calendar-cell button:not(:disabled)").forEach((button) => button.addEventListener("click", () => {
      state.selectedDate = startOfDay(new Date(button.dataset.date));
      state.selectedHour = Number(button.dataset.hour);
      renderCalendar();
    }));
    updateBookingSummary();
  }

  function selectedStart() { if (state.selectedHour === null) return null; const date = new Date(state.selectedDate); date.setHours(state.selectedHour, 0, 0, 0); return date; }
  function updateBookingSummary() {
    const start = selectedStart();
    $("#book-slot").disabled = !start;
    const summary = start ? `${formatShort(start)} · ${String(start.getHours()).padStart(2, "0")}:00–${String(start.getHours() + state.duration).padStart(2, "0")}:00` : "Selecione um horário livre";
    $("#booking-summary").textContent = summary;
    $("#schedule-selection").textContent = start ? summary : "Nenhum horário selecionado";
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

  function render() { renderIdentity(); renderClock(); renderCalendar(); renderReservations(); }

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
    $("#calendar-today").addEventListener("click", () => { state.weekStart = startOfDay(now()); state.selectedDate = new Date(state.weekStart); state.selectedHour = null; renderCalendar(); });
    $("#calendar-prev").addEventListener("click", () => { const next = new Date(state.weekStart); next.setDate(next.getDate() - 7); state.weekStart = next < startOfDay(now()) ? startOfDay(now()) : startOfDay(next); state.selectedDate = new Date(state.weekStart); state.selectedHour = null; renderCalendar(); });
    $("#calendar-next").addEventListener("click", () => { const next = new Date(state.weekStart); next.setDate(next.getDate() + 7); state.weekStart = startOfDay(next); state.selectedDate = new Date(state.weekStart); state.selectedHour = null; renderCalendar(); });
    $("#book-slot").addEventListener("click", book);
    $("#issue-session").addEventListener("click", issueSession);
    $("#copy-command").addEventListener("click", () => { const reservation = activeReservation(); const stored = tokenFor(reservation); if (stored) copyText(commandFor(stored.token), "Comando copiado."); });
    $("#copy-token").addEventListener("click", () => { const stored = tokenFor(activeReservation()); if (stored) copyText(stored.token, "Token copiado."); });
    document.querySelectorAll("[data-duration]").forEach((button) => button.addEventListener("click", () => { state.duration = Number(button.dataset.duration); document.querySelectorAll("[data-duration]").forEach((item) => item.classList.toggle("active", item === button)); state.selectedHour = null; renderCalendar(); }));
    await loadDashboard();
    setInterval(() => renderClock(), 1_000);
    setInterval(() => loadDashboard(true).catch(() => undefined), 30_000);
  }

  init().catch((error) => {
    const status = $("#sync-status");
    status.innerHTML = `<span></span> ${error.message}`;
    status.classList.add("offline");
  });
})();
