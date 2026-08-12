// ==========================================================================
// CONFIGURAÇÃO DIRETA DO BANCO DE DADOS SUPABASE (https://supabase.com)
// Cole a URL e a Anon Key do seu projeto Supabase aqui:
// ==========================================================================
const CONFIGURED_SUPABASE_URL = ""; // Ex: "https://abcdefghijklmnopqrst.supabase.co"
const CONFIGURED_SUPABASE_KEY = ""; // Ex: "eyJhbGciOiJIUzI1NiI..."

/**
 * Base de credenciais Padrão Inicial
 */
const DEFAULT_USER_DATABASE = [
  // 1IA - A
  { username: "1IA", password: "A", turma: "1IA - A" },
  { username: "fecurity", password: "joao01@", turma: "1IA - A" },
  { username: "itech", password: "luis02@", turma: "1IA - A" },
  { username: "olhardasmaquinas", password: "arthur03@", turma: "1IA - A" },
  { username: "tps", password: "eduardo04@", turma: "1IA - A" },
  { username: "flowtificial", password: "mariana05@", turma: "1IA - A" },
  { username: "equipenishimori", password: "caroline06@", turma: "1IA - A" },

  // 1IA - B
  { username: "lgm", password: "leonardo01@", turma: "1IA - B" },
  { username: "miladys", password: "ana02@", turma: "1IA - B" },
  { username: "inteligência", password: "leonardo01@", turma: "1IA - B" },
  { username: "intelectuai", password: "giancarlo04@", turma: "1IA - B" },
  { username: "urbia", password: "vitor01@", turma: "1IA - B" },
  { username: "smartflow", password: "thiago01@", turma: "1IA - B" },
  { username: "blackinwhite", password: "carlos04@", turma: "1IA - B" },
  { username: "atlas", password: "davi05@", turma: "1IA - B" },
  { username: "elite", password: "murilo06@", turma: "1IA - B" },
  { username: "urbanisatech", password: "angelo07@", turma: "1IA - B" },

  // 2IA - A
  { username: "condorshield", password: "davicho01@", turma: "2IA - A" },
  { username: "ethosai", password: "leonardo03@", turma: "2IA - A" },
  { username: "urbanscope", password: "victor03@", turma: "2IA - A" },
  { username: "infranexus", password: "luiz04@", turma: "2IA - A" },
  { username: "cognimove", password: "manuella04@", turma: "2IA - A" },
  { username: "dll", password: "davi08@", turma: "2IA - A" },
  { username: "neurocore", password: "heitor08@", turma: "2IA - A" },
  { username: "essenza", password: "beatriz04@", turma: "2IA - A" },
  { username: "neuralnexus", password: "isaac06@", turma: "2IA - A" },

  // 2IA - B
  { username: "pebsmart", password: "bruno06@", turma: "2IA - B" },
  { username: "segurancasemstress", password: "bernardo04@", turma: "2IA - B" },
  { username: "urmind", password: "nicolas08@", turma: "2IA - B" },
  { username: "eclipse", password: "afonso01@", turma: "2IA - B" },
  { username: "smartciv", password: "enzo05@", turma: "2IA - B" },
  { username: "neuraltrio", password: "gabriel08@", turma: "2IA - B" },
  { username: "trigêmeos", password: "lucas08@", turma: "2IA - B" },

  // Administrador
  { username: "admin", password: ["raissa", "melissa", "beatriz", "manuella"], turma: "Administrador" }
];

// Chaves do localStorage
const USERS_STORAGE_KEY = 'fecart_user_db';
const APPOINTMENTS_STORAGE_KEY = 'fecart_appointments_db';
const SUPABASE_CONFIG_KEY = 'fecart_supabase_config';

// Instância Global do Supabase Client
let supabaseClient = null;
let liveTimerInterval = null;

function getSupabaseConfig() {
  if (CONFIGURED_SUPABASE_URL && CONFIGURED_SUPABASE_KEY) {
    return { url: CONFIGURED_SUPABASE_URL, key: CONFIGURED_SUPABASE_KEY };
  }
  const stored = localStorage.getItem(SUPABASE_CONFIG_KEY);
  return stored ? JSON.parse(stored) : null;
}

function initSupabase() {
  const config = getSupabaseConfig();
  if (config && config.url && config.key && window.supabase) {
    try {
      supabaseClient = window.supabase.createClient(config.url, config.key);
      updateDBStatusBadge(true);
      return supabaseClient;
    } catch (e) {
      console.error('Erro ao conectar com Supabase:', e);
      updateDBStatusBadge(false);
    }
  } else {
    updateDBStatusBadge(false);
  }
  return null;
}

function updateDBStatusBadge(isConnected) {
  const badge = document.getElementById('db-status-badge');
  const text = document.getElementById('db-status-text');
  if (!badge || !text) return;

  if (isConnected) {
    badge.className = 'db-status-badge';
    text.textContent = 'Conectado ao Supabase';
  } else {
    badge.className = 'db-status-badge local';
    text.textContent = 'Base Local (Offline)';
  }
}

/**
 * Operações Assíncronas no Supabase / Local
 */
async function getUsersAsync() {
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('users').select('*');
      if (!error && data && data.length > 0) return data;
    } catch (e) {
      console.warn('Fallback local para usuários:', e);
    }
  }
  const stored = localStorage.getItem(USERS_STORAGE_KEY);
  if (stored) {
    try { return JSON.parse(stored); } catch (e) {}
  }
  localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(DEFAULT_USER_DATABASE));
  return DEFAULT_USER_DATABASE;
}

async function saveUsersAsync(usersArray) {
  localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(usersArray));
  if (supabaseClient) {
    try {
      await supabaseClient.from('users').upsert(usersArray, { onConflict: 'username' });
    } catch (e) {
      console.error('Erro ao salvar no Supabase:', e);
    }
  }
}

async function getAppointmentsAsync() {
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('appointments').select('*');
      if (!error && data) {
        return data.map(item => ({
          id: item.id,
          dateStr: item.date_str || item.dateStr,
          timeStr: item.time_str || item.timeStr || "08:00",
          durationMinutes: item.duration_minutes || item.durationMinutes || 180,
          username: item.username,
          turma: item.turma,
          authToken: item.auth_token || item.authToken,
          tokenUsage: item.token_usage !== undefined ? item.token_usage : 1250,
          limitPercent: item.limit_percent !== undefined ? item.limit_percent : 85,
          deviceInfo: item.device_info || item.deviceInfo,
          createdAt: item.created_at || item.createdAt
        }));
      }
    } catch (e) {
      console.warn('Fallback local para agendamentos:', e);
    }
  }
  const stored = localStorage.getItem(APPOINTMENTS_STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

async function saveAppointmentAsync(appointmentData) {
  const localList = await getAppointmentsAsync();
  localList.push(appointmentData);
  localStorage.setItem(APPOINTMENTS_STORAGE_KEY, JSON.stringify(localList));

  if (supabaseClient) {
    try {
      await supabaseClient.from('appointments').insert([{
        date_str: appointmentData.dateStr,
        time_str: appointmentData.timeStr,
        duration_minutes: appointmentData.durationMinutes,
        username: appointmentData.username,
        turma: appointmentData.turma,
        auth_token: appointmentData.authToken,
        token_usage: appointmentData.tokenUsage,
        limit_percent: appointmentData.limitPercent,
        device_info: appointmentData.deviceInfo,
        created_at: appointmentData.createdAt
      }]);
    } catch (e) {
      console.error('Erro ao salvar agendamento no Supabase:', e);
    }
  }
}

async function deleteAppointmentAsync(id, dateStr) {
  let localList = await getAppointmentsAsync();
  localList = localList.filter(a => a.id !== id && a.dateStr !== dateStr);
  localStorage.setItem(APPOINTMENTS_STORAGE_KEY, JSON.stringify(localList));

  if (supabaseClient) {
    try {
      await supabaseClient.from('appointments').delete().eq('date_str', dateStr);
    } catch (e) {
      console.error('Erro ao deletar no Supabase:', e);
    }
  }
}

// Elementos DOM Principais
const appContainer = document.getElementById('app-container');
const loginCard = document.getElementById('login-card');
const dashboardCard = document.getElementById('dashboard-card');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const togglePasswordBtn = document.getElementById('toggle-password');
const eyeIcon = document.getElementById('eye-icon');
const alertBanner = document.getElementById('alert-banner');
const alertMessage = document.getElementById('alert-message');

const loggedUsernameDisplay = document.getElementById('logged-username-display');
const btnLogout = document.getElementById('btn-logout');

// Elementos Dashboard Cronômetro e Métricas
const countdownTimerDisplay = document.getElementById('countdown-timer-display');
const countdownSubtext = document.getElementById('countdown-subtext');
const timerStatusBadge = document.getElementById('timer-status-badge');
const timerProgressFill = document.getElementById('timer-progress-fill');

const limitPercentBadge = document.getElementById('limit-percent-badge');
const limitMeterFill = document.getElementById('limit-meter-fill');
const tokenUsageCounter = document.getElementById('token-usage-counter');
const tokenMeterFill = document.getElementById('token-meter-fill');

// Botões de Ação
const btnOpenScheduleModal = document.getElementById('btn-open-schedule-modal');
const btnOpenViewAppointments = document.getElementById('btn-open-view-appointments');

// Elementos Admin
const adminPanel = document.getElementById('admin-panel');
const tabBtnUsers = document.getElementById('tab-btn-users');
const tabBtnAppointments = document.getElementById('tab-btn-appointments');
const tabBtnSupabaseConfig = document.getElementById('tab-btn-supabase-config');
const tabContentUsers = document.getElementById('tab-content-users');
const tabContentAppointments = document.getElementById('tab-content-appointments');
const userTableBody = document.getElementById('user-table-body');
const adminAppointmentsTableBody = document.getElementById('admin-appointments-table-body');
const adminAppointmentCount = document.getElementById('admin-appointment-count');
const adminSearchInput = document.getElementById('admin-search-input');
const btnAddUser = document.getElementById('btn-add-user');

// Modais e Relógio Interativo
const scheduleModal = document.getElementById('schedule-modal');
const btnCloseScheduleModal = document.getElementById('btn-close-schedule-modal');
const calPrevMonth = document.getElementById('cal-prev-month');
const calNextMonth = document.getElementById('cal-next-month');
const calMonthYearDisplay = document.getElementById('cal-month-year-display');
const calDaysGrid = document.getElementById('cal-days-grid');
const selectedDateText = document.getElementById('selected-date-text');
const btnConfirmSchedule = document.getElementById('btn-confirm-schedule');

// Elementos do Relógio Interativo
const inputManualHours = document.getElementById('input-manual-hours');
const inputManualMinutes = document.getElementById('input-manual-minutes');
const clockHourHand = document.getElementById('clock-hour-hand');
const clockMinuteHand = document.getElementById('clock-minute-hand');
const btnPeriodAM = document.getElementById('btn-period-am');
const btnPeriodPM = document.getElementById('btn-period-pm');
const btnHourMinus = document.getElementById('btn-hour-minus');
const btnHourPlus = document.getElementById('btn-hour-plus');
const btnMinMinus = document.getElementById('btn-min-minus');
const btnMinPlus = document.getElementById('btn-min-plus');
const adjustHourVal = document.getElementById('adjust-hour-val');
const adjustMinVal = document.getElementById('adjust-min-val');

const viewAppointmentsModal = document.getElementById('view-appointments-modal');
const btnCloseViewModal = document.getElementById('btn-close-view-modal');
const viewCalPrev = document.getElementById('view-cal-prev');
const viewCalNext = document.getElementById('view-cal-next');
const viewCalMonthYear = document.getElementById('view-cal-month-year');
const viewCalDaysGrid = document.getElementById('view-cal-days-grid');
const bookedDatesList = document.getElementById('booked-dates-list');

const userModal = document.getElementById('user-modal');
const modalTitle = document.getElementById('modal-title');
const userModalForm = document.getElementById('user-modal-form');
const editUserIndexInput = document.getElementById('edit-user-index');
const modalUsernameInput = document.getElementById('modal-username');
const modalPasswordInput = document.getElementById('modal-password');
const modalTurmaInput = document.getElementById('modal-turma');
const btnCloseUserModal = document.getElementById('btn-close-user-modal');
const btnCancelModal = document.getElementById('btn-cancel-modal');

const supabaseModal = document.getElementById('supabase-modal');
const supabaseConfigForm = document.getElementById('supabase-config-form');
const supabaseUrlInput = document.getElementById('supabase-url');
const supabaseKeyInput = document.getElementById('supabase-key');
const btnCloseSupabaseModal = document.getElementById('btn-close-supabase-modal');
const btnTestSupabase = document.getElementById('btn-test-supabase');

const auditModal = document.getElementById('audit-modal');
const btnCloseAuditModal = document.getElementById('btn-close-audit-modal');
const auditDetailsContent = document.getElementById('audit-details-content');

// Estado do Calendário
let currentCalYear = new Date().getFullYear();
let currentCalMonth = new Date().getMonth();
let selectedDateStr = null;

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

function normalizeString(str) {
  return str ? str.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";
}

togglePasswordBtn.addEventListener('click', () => {
  const isPassword = passwordInput.getAttribute('type') === 'password';
  passwordInput.setAttribute('type', isPassword ? 'text' : 'password');
  eyeIcon.className = isPassword ? 'ri-eye-off-line' : 'ri-eye-line';
});

function showError(message) {
  alertMessage.textContent = message;
  alertBanner.classList.remove('hidden');
  alertBanner.style.animation = 'none';
  alertBanner.offsetHeight;
  alertBanner.style.animation = 'bannerShake 0.4s ease-in-out';
}

function hideError() {
  alertBanner.classList.add('hidden');
}

/**
 * Efetuar Login
 */
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();

  const enteredUsername = usernameInput.value.trim();
  const enteredPassword = passwordInput.value;

  if (!enteredUsername || !enteredPassword) {
    showError('Por favor, preencha o usuário e a senha.');
    return;
  }

  const normalizedEnteredUser = normalizeString(enteredUsername);
  const userList = await getUsersAsync();

  const matchedUser = userList.find(user => {
    const normUser = normalizeString(user.username);
    const userMatches = normUser === normalizedEnteredUser;
    
    let passwordMatches = false;
    if (Array.isArray(user.password)) {
      passwordMatches = user.password.some(pass => pass.toLowerCase() === enteredPassword.toLowerCase().trim() || pass === enteredPassword);
    } else {
      passwordMatches = user.password === enteredPassword;
    }

    return userMatches && passwordMatches;
  });

  if (matchedUser) {
    const sessionData = {
      username: matchedUser.username,
      turma: matchedUser.turma || "Geral",
      isAdmin: matchedUser.turma === "Administrador" || normalizeString(matchedUser.username) === "admin",
      loginTime: new Date().toLocaleTimeString('pt-BR')
    };
    sessionStorage.setItem('activeSession', JSON.stringify(sessionData));
    renderLoggedInState(sessionData);
  } else {
    showError('Usuário ou senha incorretos.');
    passwordInput.value = '';
    passwordInput.focus();
  }
});

function renderLoggedInState(sessionData) {
  if (loggedUsernameDisplay) loggedUsernameDisplay.textContent = sessionData.username;

  if (sessionData.isAdmin) {
    appContainer.classList.add('admin-mode');
    adminPanel.classList.remove('hidden');
    renderUserTable();
    renderAdminAppointmentsTable();
  } else {
    appContainer.classList.remove('admin-mode');
    adminPanel.classList.add('hidden');
  }

  loginCard.classList.remove('active');
  loginCard.classList.add('hidden');
  dashboardCard.classList.remove('hidden');
  dashboardCard.classList.add('active');

  // Iniciar Cronômetro em Tempo Real da Reserva do Usuário
  startLiveReservationTimer(sessionData);
}

btnLogout.addEventListener('click', () => {
  sessionStorage.removeItem('activeSession');
  usernameInput.value = '';
  passwordInput.value = '';
  hideError();

  if (liveTimerInterval) clearInterval(liveTimerInterval);

  appContainer.classList.remove('admin-mode');
  dashboardCard.classList.remove('active');
  dashboardCard.classList.add('hidden');
  loginCard.classList.remove('hidden');
  loginCard.classList.add('active');
  usernameInput.focus();
});

/* ==========================================================================
   CRONÔMETRO DA RESERVA EM TEMPO REAL E MEDIDORES DE TOKEN / LIMITE %
   ========================================================================== */

async function startLiveReservationTimer(sessionData) {
  if (liveTimerInterval) clearInterval(liveTimerInterval);

  async function updateTimer() {
    const appointments = await getAppointmentsAsync();
    const now = new Date();
    
    // Obter data de hoje no formato YYYY-MM-DD
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Buscar reserva do usuário logado (ou a reserva de hoje)
    const userApp = appointments.find(a => normalizeString(a.username) === normalizeString(sessionData.username) || a.dateStr === todayStr);

    if (!userApp) {
      countdownTimerDisplay.textContent = "00:00:00";
      countdownSubtext.textContent = "Nenhum agendamento registrado no sistema.";
      timerStatusBadge.className = "timer-badge badge-pending";
      timerStatusBadge.textContent = "Sem Reserva";
      timerProgressFill.style.width = "0%";
      updateMeters(100, 0);
      return;
    }

    // Montar horário de início e fim da reserva
    const timeParts = (userApp.timeStr || "08:00").split(':');
    const startHour = parseInt(timeParts[0], 10) || 8;
    const startMin = parseInt(timeParts[1], 10) || 0;
    const duration = userApp.durationMinutes || 60;

    const [year, month, day] = userApp.dateStr.split('-').map(Number);
    const startDate = new Date(year, month - 1, day, startHour, startMin, 0);
    const endDate = new Date(startDate.getTime() + duration * 60 * 1000);

    const nowMs = now.getTime();
    const startMs = startDate.getTime();
    const endMs = endDate.getTime();

    if (nowMs < startMs) {
      // ANTES DA RESERVA COMEÇAR
      const diffMs = startMs - nowMs;
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diffMs % (1000 * 60)) / 1000);

      countdownTimerDisplay.textContent = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      countdownSubtext.textContent = `Sua reserva está agendada para ${userApp.dateStr.split('-').reverse().join('/')} às ${userApp.timeStr || '08:00'}.`;
      timerStatusBadge.className = "timer-badge badge-pending";
      timerStatusBadge.textContent = "Aguardando Horário";
      timerProgressFill.style.width = "0%";
      updateMeters(100, 0);

    } else if (nowMs >= startMs && nowMs <= endMs) {
      // RESERVA EM ANDAMENTO - CONTAGEM REGRESSIVA DO TEMPO RESTANTE
      const diffMs = endMs - nowMs;
      const totalMs = endMs - startMs;
      const elapsedPercent = Math.min(100, Math.max(0, ((nowMs - startMs) / totalMs) * 100));

      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diffMs % (1000 * 60)) / 1000);

      countdownTimerDisplay.textContent = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      countdownSubtext.textContent = `Sessão ativa de ${userApp.username}! O acesso será encerrado no fim da contagem.`;
      timerStatusBadge.className = "timer-badge badge-active";
      timerStatusBadge.textContent = "Sessão Ativa";
      timerProgressFill.style.width = `${elapsedPercent}%`;

      // Simulação do limite restante (%) caindo com o tempo de uso e consumo de tokens
      const remainingLimitPercent = Math.max(5, Math.round(100 - (elapsedPercent * 0.85)));
      const simulatedTokens = Math.min(10000, Math.round(elapsedPercent * 85 + 1250));
      updateMeters(remainingLimitPercent, simulatedTokens);

    } else {
      // RESERVA ENCERRADA
      countdownTimerDisplay.textContent = "00:00:00";
      countdownSubtext.textContent = `A reserva de ${userApp.dateStr.split('-').reverse().join('/')} foi finalizada.`;
      timerStatusBadge.className = "timer-badge badge-expired";
      timerStatusBadge.textContent = "Reserva Concluída";
      timerProgressFill.style.width = "100%";
      updateMeters(0, 10000);
    }
  }

  await updateTimer();
  liveTimerInterval = setInterval(updateTimer, 1000);
}

function updateMeters(limitPercent, tokenCount) {
  if (limitPercentBadge) limitPercentBadge.textContent = `${limitPercent}%`;
  if (limitMeterFill) limitMeterFill.style.width = `${limitPercent}%`;

  if (tokenUsageCounter) tokenUsageCounter.textContent = `${tokenCount.toLocaleString('pt-BR')} / 10.000`;
  if (tokenMeterFill) tokenMeterFill.style.width = `${Math.min(100, (tokenCount / 10000) * 100)}%`;
}

/* ==========================================================================
   AGENDAMENTO E AUTENTICAÇÃO SEGURA
   ========================================================================== */

function getActiveSession() {
  const session = sessionStorage.getItem('activeSession');
  return session ? JSON.parse(session) : null;
}

btnOpenScheduleModal.addEventListener('click', async () => {
  selectedDateStr = null;
  btnConfirmSchedule.disabled = true;
  selectedDateText.textContent = "Nenhuma data selecionada.";
  await renderScheduleCalendar();
  scheduleModal.classList.remove('hidden');
});

btnOpenViewAppointments.addEventListener('click', async () => {
  await renderViewCalendar();
  await renderBookedDatesList();
  viewAppointmentsModal.classList.remove('hidden');
});

btnCloseScheduleModal.addEventListener('click', () => scheduleModal.classList.add('hidden'));
btnCloseViewModal.addEventListener('click', () => viewAppointmentsModal.classList.add('hidden'));

calPrevMonth.addEventListener('click', () => {
  currentCalMonth--;
  if (currentCalMonth < 0) { currentCalMonth = 11; currentCalYear--; }
  renderScheduleCalendar();
});

calNextMonth.addEventListener('click', () => {
  currentCalMonth++;
  if (currentCalMonth > 11) { currentCalMonth = 0; currentCalYear++; }
  renderScheduleCalendar();
});

viewCalPrev.addEventListener('click', () => {
  currentCalMonth--;
  if (currentCalMonth < 0) { currentCalMonth = 11; currentCalYear--; }
  renderViewCalendar();
});

viewCalNext.addEventListener('click', () => {
  currentCalMonth++;
  if (currentCalMonth > 11) { currentCalMonth = 0; currentCalYear++; }
  renderViewCalendar();
});

function generateAuthToken() {
  const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
  const timePart = Date.now().toString(36).toUpperCase();
  return `SEC-FECART-${randomPart}-${timePart}`;
}

async function renderScheduleCalendar() {
  calMonthYearDisplay.textContent = `${MONTH_NAMES[currentCalMonth]} ${currentCalYear}`;
  calDaysGrid.innerHTML = '';

  const appointments = await getAppointmentsAsync();
  const bookedDatesSet = new Set(appointments.map(a => a.dateStr));

  const firstDayIndex = new Date(currentCalYear, currentCalMonth, 1).getDay();
  const daysInMonth = new Date(currentCalYear, currentCalMonth + 1, 0).getDate();

  for (let i = 0; i < firstDayIndex; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-day day-empty';
    calDaysGrid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dayEl = document.createElement('div');
    const dayFormatted = String(day).padStart(2, '0');
    const monthFormatted = String(currentCalMonth + 1).padStart(2, '0');
    const dateStr = `${currentCalYear}-${monthFormatted}-${dayFormatted}`;

    dayEl.textContent = day;
    dayEl.className = 'cal-day';

    const isBooked = bookedDatesSet.has(dateStr);

    if (isBooked) {
      dayEl.classList.add('booked');
      dayEl.title = 'Data já reservada no sistema (1 agendamento por dia).';
    } else {
      dayEl.classList.add('available');
      if (selectedDateStr === dateStr) dayEl.classList.add('selected');

      dayEl.addEventListener('click', () => {
        selectedDateStr = dateStr;
        document.querySelectorAll('#cal-days-grid .cal-day').forEach(d => d.classList.remove('selected'));
        dayEl.classList.add('selected');
        
        selectedDateText.innerHTML = `Data selecionada: <strong style="color:#38bdf8">${dayFormatted}/${monthFormatted}/${currentCalYear}</strong>`;
        btnConfirmSchedule.disabled = false;
      });
    }

    calDaysGrid.appendChild(dayEl);
  }
}

/* ==========================================================================
   MOTOR DO RELÓGIO ANALÓGICO / DIGITAL INTERATIVO
   ========================================================================== */

let clockSelectedHour = 14;
let clockSelectedMinute = 0;

function getClockTimeFormatted() {
  const h = String(clockSelectedHour).padStart(2, '0');
  const m = String(clockSelectedMinute).padStart(2, '0');
  return `${h}:${m}`;
}

function updateClockPickerUI() {
  const hDisplay = String(clockSelectedHour).padStart(2, '0');
  const mDisplay = String(clockSelectedMinute).padStart(2, '0');

  if (inputManualHours && document.activeElement !== inputManualHours) {
    inputManualHours.value = hDisplay;
  }
  if (inputManualMinutes && document.activeElement !== inputManualMinutes) {
    inputManualMinutes.value = mDisplay;
  }

  if (adjustHourVal) adjustHourVal.textContent = `${hDisplay}h`;
  if (adjustMinVal) adjustMinVal.textContent = `${mDisplay}m`;

  // Rotação dos ponteiros do relógio (360 graus / 12 horas = 30 deg por hora)
  const hour12 = clockSelectedHour % 12;
  const hourDeg = (hour12 + clockSelectedMinute / 60) * 30;
  const minDeg = clockSelectedMinute * 6; // 360 deg / 60 min = 6 deg por min

  if (clockHourHand) clockHourHand.style.transform = `rotate(${hourDeg}deg)`;
  if (clockMinuteHand) clockMinuteHand.style.transform = `rotate(${minDeg}deg)`;

  // Atualizar botões AM / PM
  if (clockSelectedHour >= 12) {
    if (btnPeriodPM) btnPeriodPM.classList.add('active');
    if (btnPeriodAM) btnPeriodAM.classList.remove('active');
  } else {
    if (btnPeriodAM) btnPeriodAM.classList.add('active');
    if (btnPeriodPM) btnPeriodPM.classList.remove('active');
  }

  // Destacar número no mostrador
  const current12Hour = hour12 === 0 ? 12 : hour12;
  document.querySelectorAll('#analog-clock-dial .clock-num').forEach(el => {
    const numVal = parseInt(el.getAttribute('data-hour'), 10);
    if (numVal === current12Hour) {
      el.classList.add('active-num');
    } else {
      el.classList.remove('active-num');
    }
  });
}

// Digitação manual de Horas
if (inputManualHours) {
  inputManualHours.addEventListener('input', (e) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 2) val = val.slice(0, 2);
    e.target.value = val;

    let h = parseInt(val, 10);
    if (!isNaN(h)) {
      if (h > 23) h = 23;
      clockSelectedHour = h;
      updateClockPickerUI();
    }
    if (val.length === 2 && inputManualMinutes) {
      inputManualMinutes.focus();
      inputManualMinutes.select();
    }
  });

  inputManualHours.addEventListener('blur', () => {
    updateClockPickerUI();
  });
}

// Digitação manual de Minutos
if (inputManualMinutes) {
  inputManualMinutes.addEventListener('input', (e) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 2) val = val.slice(0, 2);
    e.target.value = val;

    let m = parseInt(val, 10);
    if (!isNaN(m)) {
      if (m > 59) m = 59;
      clockSelectedMinute = m;
      updateClockPickerUI();
    }
  });

  inputManualMinutes.addEventListener('blur', () => {
    updateClockPickerUI();
  });
}

// Cliques nos números do mostrador do relógio
document.querySelectorAll('#analog-clock-dial .clock-num').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    const clickedHour = parseInt(el.getAttribute('data-hour'), 10);
    const isPM = clockSelectedHour >= 12;
    
    if (isPM) {
      clockSelectedHour = clickedHour === 12 ? 12 : clickedHour + 12;
    } else {
      clockSelectedHour = clickedHour === 12 ? 0 : clickedHour;
    }
    updateClockPickerUI();
  });
});

// Botões AM / PM
if (btnPeriodAM) {
  btnPeriodAM.addEventListener('click', () => {
    if (clockSelectedHour >= 12) clockSelectedHour -= 12;
    updateClockPickerUI();
  });
}
if (btnPeriodPM) {
  btnPeriodPM.addEventListener('click', () => {
    if (clockSelectedHour < 12) clockSelectedHour += 12;
    updateClockPickerUI();
  });
}

// Botões +/- de hora e minuto
if (btnHourMinus) {
  btnHourMinus.addEventListener('click', () => {
    clockSelectedHour = (clockSelectedHour - 1 + 24) % 24;
    updateClockPickerUI();
  });
}
if (btnHourPlus) {
  btnHourPlus.addEventListener('click', () => {
    clockSelectedHour = (clockSelectedHour + 1) % 24;
    updateClockPickerUI();
  });
}

if (btnMinMinus) {
  btnMinMinus.addEventListener('click', () => {
    clockSelectedMinute = (clockSelectedMinute - 15 + 60) % 60;
    updateClockPickerUI();
  });
}
if (btnMinPlus) {
  btnMinPlus.addEventListener('click', () => {
    clockSelectedMinute = (clockSelectedMinute + 15) % 60;
    updateClockPickerUI();
  });
}

// Inicializar Relógio
updateClockPickerUI();

/**
 * Confirmar Agendamento com Horário do Relógio
 */
btnConfirmSchedule.addEventListener('click', async () => {
  if (!selectedDateStr) return;

  const session = getActiveSession();
  if (!session) {
    alert("Sessão expirada. Por favor, faça login novamente.");
    return;
  }

  const appointments = await getAppointmentsAsync();

  if (appointments.some(a => a.dateStr === selectedDateStr)) {
    alert("Esta data já possui agendamento no banco de dados.");
    await renderScheduleCalendar();
    return;
  }

  const selectedTime = getClockTimeFormatted();
  const selectedDuration = 180; // 3 Horas Padrão Fixas
  const authToken = generateAuthToken();
  const deviceInfo = `${navigator.platform} - ${navigator.userAgent.slice(0, 60)}...`;

  const newAppointment = {
    id: Date.now(),
    dateStr: selectedDateStr,
    timeStr: selectedTime,
    durationMinutes: selectedDuration,
    username: session.username,
    turma: session.turma,
    authToken: authToken,
    tokenUsage: 1250,
    limitPercent: 85,
    deviceInfo: deviceInfo,
    createdAt: new Date().toLocaleString('pt-BR')
  };

  await saveAppointmentAsync(newAppointment);

  // Calcular horário de término (+3h)
  const timeParts = selectedTime.split(':');
  const startH = parseInt(timeParts[0], 10) || 14;
  const startM = timeParts[1] || "00";
  const endH = (startH + 3) % 24;
  const endFormatted = `${String(endH).padStart(2, '0')}:${startM}`;

  alert(`Agendamento de 3 Horas Confirmado!\nData: ${selectedDateStr.split('-').reverse().join('/')}\nHorário do Relógio: ${selectedTime} às ${endFormatted} (3h)\nToken de Segurança: ${authToken}`);
  scheduleModal.classList.add('hidden');

  startLiveReservationTimer(session);
  await renderAdminAppointmentsTable();
});

async function renderViewCalendar() {
  viewCalMonthYear.textContent = `${MONTH_NAMES[currentCalMonth]} ${currentCalYear}`;
  viewCalDaysGrid.innerHTML = '';

  const appointments = await getAppointmentsAsync();
  const bookedDatesMap = new Map();
  appointments.forEach(a => bookedDatesMap.set(a.dateStr, a));

  const firstDayIndex = new Date(currentCalYear, currentCalMonth, 1).getDay();
  const daysInMonth = new Date(currentCalYear, currentCalMonth + 1, 0).getDate();

  for (let i = 0; i < firstDayIndex; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-day day-empty';
    viewCalDaysGrid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dayEl = document.createElement('div');
    const dayFormatted = String(day).padStart(2, '0');
    const monthFormatted = String(currentCalMonth + 1).padStart(2, '0');
    const dateStr = `${currentCalYear}-${monthFormatted}-${dayFormatted}`;

    dayEl.textContent = day;
    dayEl.className = 'cal-day';

    if (bookedDatesMap.has(dateStr)) {
      const appInfo = bookedDatesMap.get(dateStr);
      dayEl.classList.add('booked');
      dayEl.title = `Agendado por: ${appInfo.username} (${appInfo.turma}) às ${appInfo.timeStr || '08:00'}`;
    } else {
      dayEl.classList.add('available');
    }

    viewCalDaysGrid.appendChild(dayEl);
  }
}

async function renderBookedDatesList() {
  const appointments = await getAppointmentsAsync();
  bookedDatesList.innerHTML = '';

  if (appointments.length === 0) {
    bookedDatesList.innerHTML = `<p style="color:var(--text-dim); font-size:0.85rem;">Nenhum agendamento registrado até o momento.</p>`;
    return;
  }

  appointments.sort((a, b) => a.dateStr.localeCompare(b.dateStr));

  appointments.forEach(app => {
    const item = document.createElement('div');
    item.className = 'booked-item';
    const dateFormatted = app.dateStr.split('-').reverse().join('/');

    item.innerHTML = `
      <div>
        <span class="booked-item-date"><i class="ri-calendar-line"></i> ${dateFormatted} às ${app.timeStr || '08:00'}</span>
      </div>
      <div class="booked-item-user">
        <strong>${app.username}</strong> (${app.turma})
      </div>
    `;
    bookedDatesList.appendChild(item);
  });
}

/* ==========================================================================
   PAINEL DO ADMINISTRADOR E AUDITORIA
   ========================================================================== */

tabBtnUsers.addEventListener('click', () => {
  tabBtnUsers.classList.add('active');
  tabBtnAppointments.classList.remove('active');
  tabContentUsers.classList.remove('hidden');
  tabContentUsers.classList.add('active');
  tabContentAppointments.classList.add('hidden');
  tabContentAppointments.classList.remove('active');
});

tabBtnAppointments.addEventListener('click', async () => {
  tabBtnAppointments.classList.add('active');
  tabBtnUsers.classList.remove('active');
  tabContentAppointments.classList.remove('hidden');
  tabContentAppointments.classList.add('active');
  tabContentUsers.classList.add('hidden');
  tabContentUsers.classList.remove('active');
  await renderAdminAppointmentsTable();
});

tabBtnSupabaseConfig.addEventListener('click', () => {
  const config = getSupabaseConfig();
  if (config) {
    supabaseUrlInput.value = config.url || '';
    supabaseKeyInput.value = config.key || '';
  }
  supabaseModal.classList.remove('hidden');
});

btnCloseSupabaseModal.addEventListener('click', () => supabaseModal.classList.add('hidden'));

supabaseConfigForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = supabaseUrlInput.value.trim();
  const key = supabaseKeyInput.value.trim();

  if (!url || !key) {
    alert('Por favor, informe a URL e a Anon Key do seu Supabase.');
    return;
  }

  localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify({ url, key }));
  initSupabase();
  alert('Configurações do Supabase salvas com sucesso!');
  supabaseModal.classList.add('hidden');
  renderAdminAppointmentsTable();
});

btnTestSupabase.addEventListener('click', async () => {
  const url = supabaseUrlInput.value.trim();
  const key = supabaseKeyInput.value.trim();
  if (!url || !key) {
    alert('Preencha a URL e a Key para testar.');
    return;
  }
  try {
    const testClient = window.supabase.createClient(url, key);
    const { data, error } = await testClient.from('users').select('count', { count: 'exact', head: true });
    if (error) throw error;
    alert('Conexão com o Supabase realizada com sucesso!');
  } catch (e) {
    alert('Erro ao conectar ao Supabase: ' + e.message);
  }
});

async function renderAdminAppointmentsTable() {
  const appointments = await getAppointmentsAsync();
  adminAppointmentCount.textContent = appointments.length;
  adminAppointmentsTableBody.innerHTML = '';

  if (appointments.length === 0) {
    adminAppointmentsTableBody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-dim); padding: 24px;">
          Nenhum agendamento autenticado no banco de dados.
        </td>
      </tr>
    `;
    return;
  }

  appointments.sort((a, b) => a.dateStr.localeCompare(b.dateStr));

  appointments.forEach(app => {
    const tr = document.createElement('tr');
    const dateFormatted = app.dateStr.split('-').reverse().join('/');
    const timeFormatted = app.timeStr || '08:00';
    const tokenShort = app.authToken ? app.authToken : 'VERIFICADO';

    tr.innerHTML = `
      <td class="user-name-cell"><i class="ri-calendar-event-fill" style="color:#a855f7"></i> ${dateFormatted} às ${timeFormatted}</td>
      <td><strong>${app.username}</strong></td>
      <td><span class="turma-badge">${app.turma || 'Geral'}</span></td>
      <td><strong style="color:#34d399">${app.limitPercent !== undefined ? app.limitPercent : 85}%</strong></td>
      <td><span style="color:#a855f7">${(app.tokenUsage !== undefined ? app.tokenUsage : 1250).toLocaleString('pt-BR')}</span></td>
      <td><span class="password-cell" style="color:#38bdf8">${tokenShort}</span></td>
      <td class="text-right">
        <div class="action-buttons">
          <button type="button" class="btn-icon edit-btn" title="Verificar Auditoria" onclick="openAuditModal('${app.dateStr}')">
            <i class="ri-shield-keyhole-line"></i>
          </button>
          <button type="button" class="btn-icon delete-btn" title="Cancelar Agendamento" onclick="cancelAppointment(${app.id}, '${app.dateStr}')">
            <i class="ri-delete-bin-line"></i>
          </button>
        </div>
      </td>
    `;
    adminAppointmentsTableBody.appendChild(tr);
  });
}

window.openAuditModal = async function(dateStr) {
  const appointments = await getAppointmentsAsync();
  const app = appointments.find(a => a.dateStr === dateStr);
  if (!app) return;

  const dateFormatted = app.dateStr.split('-').reverse().join('/');

  auditDetailsContent.innerHTML = `
    <div class="audit-field">
      <label>Status de Validação</label>
      <div class="value" style="color:var(--success-color)">
        <i class="ri-checkbox-circle-fill"></i> Autenticado no Supabase
      </div>
    </div>
    <div class="audit-field">
      <label>Token Único de Segurança</label>
      <div class="value token-value">${app.authToken || 'SEC-VERIFIED-' + app.id}</div>
    </div>
    <div class="audit-field">
      <label>Usuário & Turma</label>
      <div class="value">${app.username} (${app.turma || 'Geral'})</div>
    </div>
    <div class="audit-field">
      <label>Data & Horário Reservado</label>
      <div class="value">${dateFormatted} às ${app.timeStr || '08:00'} (${app.durationMinutes || 60} min)</div>
    </div>
    <div class="audit-field">
      <label>Métricas da Sessão</label>
      <div class="value" style="color:#34d399">Limite: ${app.limitPercent !== undefined ? app.limitPercent : 85}% | Tokens: ${app.tokenUsage || 1250}</div>
    </div>
    <div class="audit-field">
      <label>Registro do Dispositivo</label>
      <div class="value" style="font-size:0.8rem; color:var(--text-muted)">${app.deviceInfo || 'Navegador Web Padrão'}</div>
    </div>
  `;

  auditModal.classList.remove('hidden');
};

btnCloseAuditModal.addEventListener('click', () => auditModal.classList.add('hidden'));

window.cancelAppointment = async function(id, dateStr) {
  const appointments = await getAppointmentsAsync();
  const target = appointments.find(a => a.id === id || a.dateStr === dateStr);
  if (!target) return;

  const dateFormatted = dateStr.split('-').reverse().join('/');
  if (confirm(`Deseja cancelar e excluir o agendamento do dia ${dateFormatted} de ${target.username}?`)) {
    await deleteAppointmentAsync(id, dateStr);
    await renderAdminAppointmentsTable();
  }
};

/* ==========================================================================
   CRUD DE USUÁRIOS (SUPABASE + LOCAL)
   ========================================================================== */

async function renderUserTable(filterQuery = '') {
  const users = await getUsersAsync();
  userTableBody.innerHTML = '';

  const normalizedQuery = normalizeString(filterQuery);

  const filteredUsers = users.map((user, originalIndex) => ({ ...user, originalIndex }))
    .filter(user => {
      if (!normalizedQuery) return true;
      return normalizeString(user.username).includes(normalizedQuery) || 
             normalizeString(user.turma || '').includes(normalizedQuery);
    });

  if (filteredUsers.length === 0) {
    userTableBody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; color: var(--text-dim); padding: 24px;">
          Nenhum usuário encontrado.
        </td>
      </tr>
    `;
    return;
  }

  filteredUsers.forEach(user => {
    const tr = document.createElement('tr');
    const displayPassword = Array.isArray(user.password) ? user.password.join(', ') : user.password;

    tr.innerHTML = `
      <td class="user-name-cell">${user.username}</td>
      <td class="password-cell">${displayPassword}</td>
      <td><span class="turma-badge">${user.turma || 'Sem Turma'}</span></td>
      <td class="text-right">
        <div class="action-buttons">
          <button type="button" class="btn-icon edit-btn" title="Editar Usuário" onclick="openEditModal(${user.originalIndex})">
            <i class="ri-pencil-line"></i>
          </button>
          <button type="button" class="btn-icon delete-btn" title="Excluir Usuário" onclick="deleteUser(${user.originalIndex})">
            <i class="ri-delete-bin-line"></i>
          </button>
        </div>
      </td>
    `;
    userTableBody.appendChild(tr);
  });
}

adminSearchInput.addEventListener('input', (e) => {
  renderUserTable(e.target.value);
});

btnAddUser.addEventListener('click', () => {
  editUserIndexInput.value = "-1";
  modalTitle.textContent = "Adicionar Usuário";
  modalUsernameInput.value = "";
  modalPasswordInput.value = "";
  modalTurmaInput.value = "1IA - A";
  userModal.classList.remove('hidden');
  modalUsernameInput.focus();
});

window.openEditModal = async function(index) {
  const users = await getUsersAsync();
  const user = users[index];
  if (!user) return;

  editUserIndexInput.value = index;
  modalTitle.textContent = "Editar Usuário";
  modalUsernameInput.value = user.username;
  modalPasswordInput.value = Array.isArray(user.password) ? user.password.join(', ') : user.password;
  modalTurmaInput.value = user.turma || "";

  userModal.classList.remove('hidden');
  modalUsernameInput.focus();
};

window.deleteUser = async function(index) {
  const users = await getUsersAsync();
  const user = users[index];
  if (!user) return;

  if (confirm(`Tem certeza que deseja remover o usuário "${user.username}"?`)) {
    users.splice(index, 1);
    await saveUsersAsync(users);
    await renderUserTable(adminSearchInput.value);
  }
};

userModalForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const index = parseInt(editUserIndexInput.value, 10);
  const username = modalUsernameInput.value.trim();
  const rawPassword = modalPasswordInput.value.trim();
  const turma = modalTurmaInput.value.trim();

  if (!username || !rawPassword) {
    alert('Por favor, informe o usuário e a senha.');
    return;
  }

  let password = rawPassword;
  if (rawPassword.includes(',')) {
    password = rawPassword.split(',').map(p => p.trim()).filter(Boolean);
  }

  const users = await getUsersAsync();

  if (index === -1) {
    users.push({ username, password, turma });
  } else {
    users[index] = { username, password, turma };
  }

  await saveUsersAsync(users);
  await renderUserTable(adminSearchInput.value);
  closeUserModal();
});

function closeUserModal() {
  userModal.classList.add('hidden');
}

btnCloseUserModal.addEventListener('click', closeUserModal);
btnCancelModal.addEventListener('click', closeUserModal);

userModal.addEventListener('click', (e) => {
  if (e.target === userModal) closeUserModal();
});
scheduleModal.addEventListener('click', (e) => {
  if (e.target === scheduleModal) scheduleModal.classList.add('hidden');
});
viewAppointmentsModal.addEventListener('click', (e) => {
  if (e.target === viewAppointmentsModal) viewAppointmentsModal.classList.add('hidden');
});
auditModal.addEventListener('click', (e) => {
  if (e.target === auditModal) auditModal.classList.add('hidden');
});
supabaseModal.addEventListener('click', (e) => {
  if (e.target === supabaseModal) supabaseModal.classList.add('hidden');
});

/**
 * Inicialização do App
 */
document.addEventListener('DOMContentLoaded', () => {
  initSupabase();

  const savedSession = sessionStorage.getItem('activeSession');
  if (savedSession) {
    try {
      const sessionData = JSON.parse(savedSession);
      renderLoggedInState(sessionData);
    } catch (e) {
      sessionStorage.removeItem('activeSession');
    }
  }
});
