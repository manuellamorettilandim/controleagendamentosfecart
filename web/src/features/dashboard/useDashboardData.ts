import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { apiClient } from "../../lib/api/client";
import { AccountOption, DayScheduleData } from "../../components/schedule/ScheduleGrid";
import { DaySlotData } from "../../components/schedule/ScheduleDay";
import { generateSlotsForDate } from "./scheduleSlots";
import { ReservationInfo } from "../../components/overview/NextSessionCard";
import { SessionModelUsage } from "../../components/active-session/ModelUsageTable";
import { LineChartPoint } from "../../components/statistics/LineChart";
import { BarChartItem } from "../../components/statistics/BarChart";
import { ObservedModelRow } from "../../components/statistics/ObservedModelsTable";
import {
  buildActiveSessionMetrics,
  formatTokenCount,
  mergeSessionDevices,
  type SessionDataRecord,
} from "./activeSessionMetrics";

export interface UserProfile {
  userId?: string;
  username: string;
  groupName: string;
  role: string;
}

export interface UserStatisticsData {
  sessionsCount: string;
  sessionsDeltaText: string;
  hoursCount: string;
  hoursDeltaText: string;
  tokensCount: string;
  tokensDeltaText: string;
  occupancyRate: string;
  occupancyDeltaText: string;
  lineChartData: LineChartPoint[];
  barChartItems: BarChartItem[];
  heatmapMatrix: number[][];
  observedModels: ObservedModelRow[];
}

function formatSessionDateTime(value: string, nowMs: number): string {
  const date = new Date(value);
  const now = new Date(nowMs);
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Hoje às ${time}`;
  return `${date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })} às ${time}`;
}

function formatSessionDuration(durationMs: number): string {
  const totalMinutes = Math.max(0, Math.round(durationMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}min`;
  if (hours > 0) return `${hours} ${hours === 1 ? "hora" : "horas"}`;
  return `${minutes}min`;
}

export function useDashboardData() {
  const [profile, setProfile] = useState<UserProfile>({
    username: "Carregando…",
    groupName: "",
    role: "",
  });
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [weekOffset, setWeekOffset] = useState<number>(0);
  const [reservations, setReservations] = useState<any[]>([]);
  const [busySlots, setBusySlots] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [usageEvents, setUsageEvents] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [activeSessionToken, setActiveSessionToken] = useState<string | null>(null);
  const [issuedSessionDevice, setIssuedSessionDevice] = useState<SessionDataRecord | null>(null);
  const activeSessionRef = useRef<{ reservationId: string; token: string } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [clockMs, setClockMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setClockMs(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  // Fetch dashboard data
  const loadData = useCallback(async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const data = await apiClient.user("/api/user/dashboard");

      if (data.profile) {
        setProfile({
          userId: data.profile.user_id,
          username: data.profile.username || "Usuário",
          groupName: data.profile.group_name || "",
          role: data.profile.role === "owner" ? "Admin / Owner" : data.profile.role === "admin" ? "Admin" : "Aluno",
        });
      }

      if (Array.isArray(data.accounts)) {
        const accs: AccountOption[] = data.accounts.map((a: any) => ({
          accountId: String(a.account_id),
          label: String(a.label || "ChatGPT"),
          status: a.status,
          isDefault: Boolean(a.is_default),
          rate_limits: a.rate_limits || a.rateLimits,
          rateLimits: a.rateLimits || a.rate_limits,
          usage: a.usage,
        }));
        setAccounts(accs);
        setSelectedAccountId((prev) => {
          if (prev && accs.some((a) => a.accountId === prev)) return prev;
          const def = data.accounts.find((a: any) => a.is_default);
          return def ? String(def.account_id) : accs[0]?.accountId || "";
        });
      }

      if (Array.isArray(data.reservations)) {
        setReservations(data.reservations);
      }

      if (Array.isArray(data.busySlots)) {
        setBusySlots(data.busySlots);
      }

      if (Array.isArray(data.devices)) {
        setDevices(data.devices);
      }

      if (Array.isArray(data.usageEvents)) {
        setUsageEvents(data.usageEvents);
      }

      if (data.settings) {
        setSettings(data.settings);
      }

      setError(null);

      // Check active reservation & fetch session token if needed
      const nowMs = Date.now();
      const activeRes = (data.reservations || []).find(
        (r: any) =>
          r.status === "scheduled" &&
          r.approval_status === "approved" &&
          Date.parse(r.starts_at) <= nowMs &&
          Date.parse(r.ends_at) > nowMs
      );

      if (activeRes) {
        if (activeSessionRef.current?.reservationId !== String(activeRes.id)) {
          activeSessionRef.current = null;
          setActiveSessionToken(null);
          setIssuedSessionDevice(null);
        }

        if (activeSessionRef.current) return;

        try {
          const sessionRes = await apiClient.user(`/api/user/reservations/${encodeURIComponent(activeRes.id)}/session`, {
            method: "POST",
            body: JSON.stringify({}),
          });
          if (typeof sessionRes?.token === "string" && sessionRes.token.trim()) {
            activeSessionRef.current = { reservationId: String(activeRes.id), token: sessionRes.token };
            setActiveSessionToken(sessionRes.token);
            setIssuedSessionDevice(
              sessionRes.device && typeof sessionRes.device === "object" && !Array.isArray(sessionRes.device)
                ? sessionRes.device as SessionDataRecord
                : null,
            );
          }
        } catch {
          // The reservation is real, but the credential may still be provisioning.
          if (!activeSessionRef.current) {
            setActiveSessionToken(null);
            setIssuedSessionDevice(null);
          }
        }
      } else {
        activeSessionRef.current = null;
        setActiveSessionToken(null);
        setIssuedSessionDevice(null);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Não foi possível carregar os dados da sessão.";
      setError(message);
      if (!silent) {
        setProfile({ username: "Usuário", groupName: "", role: "" });
        setAccounts([]);
        setSelectedAccountId("");
        setReservations([]);
        setBusySlots([]);
        setDevices([]);
        setUsageEvents([]);
        setSettings(null);
        activeSessionRef.current = null;
        setActiveSessionToken(null);
        setIssuedSessionDevice(null);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    // Auto refresh every 60 seconds
    const interval = setInterval(() => void loadData(true), 60000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Current active reservation. Keep the original record as well because it
  // contains the quota/device fields needed by the live-session view.
  const activeReservationRecord = useMemo(() => {
    const nowMs = clockMs;
    return reservations.find(
      (r) =>
        r.status === "scheduled" &&
        r.approval_status === "approved" &&
        Date.parse(r.starts_at) <= nowMs &&
        Date.parse(r.ends_at) > nowMs
    ) || null;
  }, [clockMs, reservations]);

  useEffect(() => {
    if (!activeReservationRecord) return;
    // Usage events are written when a provider turn finishes. Keep the live
    // panel responsive without requiring the user to click "Atualizar".
    const interval = window.setInterval(() => void loadData(true), 5000);
    return () => window.clearInterval(interval);
  }, [activeReservationRecord?.id, loadData]);

  const activeReservation = useMemo(() => {
    if (!activeReservationRecord) return null;
    const acc = accounts.find((a) => a.accountId === activeReservationRecord.account_id);
    return {
      id: activeReservationRecord.id,
      accountId: activeReservationRecord.account_id,
      accountLabel: acc?.label || "ChatGPT",
      startsAt: activeReservationRecord.starts_at,
      endsAt: activeReservationRecord.ends_at,
      status: activeReservationRecord.status,
      approvalStatus: activeReservationRecord.approval_status,
    } as ReservationInfo;
  }, [activeReservationRecord, accounts]);

  const activeSessionDevice = useMemo(() => {
    if (!activeReservationRecord) return null;
    const snapshot = devices.find((device) => {
      const reservationId = device.reservation_id || device.reservationId;
      const deviceId = device.device_id || device.deviceId;
      return String(reservationId || "") === String(activeReservationRecord.id)
        || (activeReservationRecord.device_id && String(deviceId || "") === String(activeReservationRecord.device_id));
    }) as SessionDataRecord | undefined;
    const issued = activeSessionRef.current?.reservationId === String(activeReservationRecord.id) ? issuedSessionDevice : null;
    return mergeSessionDevices(issued, snapshot);
  }, [activeReservationRecord, devices, issuedSessionDevice]);

  const activeSessionAccount = useMemo(() => {
    if (!activeReservationRecord) return null;
    return accounts.find((account) => account.accountId === activeReservationRecord.account_id) || null;
  }, [activeReservationRecord, accounts]);

  const activeSessionMetrics = useMemo(() => buildActiveSessionMetrics({
    reservation: activeReservationRecord as SessionDataRecord | null,
    device: activeSessionDevice,
    account: activeSessionAccount as SessionDataRecord | null,
    usageEvents: usageEvents as SessionDataRecord[],
    hasToken: Boolean(activeSessionToken),
  }), [activeReservationRecord, activeSessionAccount, activeSessionDevice, activeSessionToken, usageEvents]);

  // Next upcoming reservation
  const nextReservation = useMemo(() => {
    const nowMs = clockMs;
    const upcoming = reservations
      .filter(
        (r) =>
          r.status === "scheduled" &&
          r.approval_status === "approved" &&
          Date.parse(r.starts_at) > nowMs
      )
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0];

    if (!upcoming) return null;
    const acc = accounts.find((a) => a.accountId === upcoming.account_id);
    return {
      id: upcoming.id,
      accountId: upcoming.account_id,
      accountLabel: acc?.label || "ChatGPT",
      startsAt: upcoming.starts_at,
      endsAt: upcoming.ends_at,
      status: upcoming.status,
      approvalStatus: upcoming.approval_status,
    } as ReservationInfo;
  }, [clockMs, reservations, accounts]);

  // Format timings for active session
  const activeSessionTimings = useMemo(() => {
    if (!activeReservation) {
      return {
        remainingTimeFormatted: "—",
        timePercentage: 0,
        quotaRemainingPercent: null,
        startTimeFormatted: "—",
        endTimeFormatted: "—",
        durationLabel: "—",
      };
    }

    const start = new Date(activeReservation.startsAt);
    const end = new Date(activeReservation.endsAt);
    const totalMs = Math.max(1, end.getTime() - start.getTime());
    const remainingMs = Math.max(0, end.getTime() - clockMs);
    const timePercentage = Math.min(100, Math.max(0, Math.round((remainingMs / totalMs) * 100)));

    const hours = Math.floor(remainingMs / 3600000);
    const mins = Math.floor((remainingMs % 3600000) / 60000);
    const remainingTimeFormatted = hours > 0 ? `${hours}h ${mins}min` : `${mins}min`;

    const startTimeFormatted = formatSessionDateTime(activeReservation.startsAt, clockMs);
    const endTimeFormatted = formatSessionDateTime(activeReservation.endsAt, clockMs);

    return {
      remainingTimeFormatted,
      timePercentage,
      quotaRemainingPercent: activeSessionMetrics.quotaRemainingPercent,
      startTimeFormatted,
      endTimeFormatted,
      durationLabel: formatSessionDuration(totalMs),
    };
  }, [activeReservation, activeSessionMetrics.quotaRemainingPercent, clockMs]);

  // Week Dates & Slot Calculation
  const { weekLabel, days } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find current week Monday
    const currentDay = today.getDay(); // 0 is Sunday, 1 is Monday...
    const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diffToMonday + weekOffset * 7);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const pad = (n: number) => String(n).padStart(2, "0");
    const monthNames = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
    const startLabel = monday.getMonth() === sunday.getMonth() && monday.getFullYear() === sunday.getFullYear()
      ? pad(monday.getDate())
      : `${pad(monday.getDate())} de ${monthNames[monday.getMonth()]}${monday.getFullYear() !== sunday.getFullYear() ? ` de ${monday.getFullYear()}` : ""}`;
    const weekLabel = `${startLabel} – ${pad(sunday.getDate())} de ${monthNames[sunday.getMonth()]} de ${sunday.getFullYear()}`;

    const dayNamesShort = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
    const nowMs = clockMs;
    const selectedAccount = accounts.find((a) => a.accountId === selectedAccountId);

    const daysData: DayScheduleData[] = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);

      const isToday =
        d.getDate() === today.getDate() &&
        d.getMonth() === today.getMonth() &&
        d.getFullYear() === today.getFullYear();

      const slots = generateSlotsForDate(d, selectedAccount, reservations, busySlots, nowMs);

      daysData.push({
        date: d,
        dayName: dayNamesShort[i],
        dayNumber: pad(d.getDate()),
        isToday,
        slots,
      });
    }

    return { weekLabel, days: daysData };
  }, [clockMs, weekOffset, reservations, busySlots, selectedAccountId, accounts]);

  // Calculate real user statistics
  const userStatistics: UserStatisticsData = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const currentDay = today.getDay(); // 0 is Sunday, 1 is Monday...
    const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diffToMonday + weekOffset * 7);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    const mondayMs = monday.getTime();
    const sundayMs = sunday.getTime();

    const weekReservations = reservations.filter((r) => {
      const s = Date.parse(r.starts_at);
      return s >= mondayMs && s <= sundayMs;
    });

    const prevMondayMs = mondayMs - 7 * 86400000;
    const prevSundayMs = mondayMs - 1;
    const prevWeekReservations = reservations.filter((r) => {
      const s = Date.parse(r.starts_at);
      return s >= prevMondayMs && s <= prevSundayMs;
    });

    // 1. Sessions count & delta
    const sessionsCount = String(weekReservations.length);
    let sessionsDeltaText = "Sem reservas nesta semana";
    if (prevWeekReservations.length === 0) {
      sessionsDeltaText = weekReservations.length > 0 ? "+100% vs semana anterior" : "Sem histórico anterior";
    } else {
      const diff = Math.round(((weekReservations.length - prevWeekReservations.length) / prevWeekReservations.length) * 100);
      sessionsDeltaText = `${diff >= 0 ? "+" : ""}${diff}% vs semana anterior`;
    }

    // 2. Hours used
    const totalHours = weekReservations.reduce((sum, r) => {
      if (r.status === "cancelled") return sum;
      const s = Date.parse(r.starts_at);
      const e = Date.parse(r.ends_at);
      return sum + Math.max(0, (e - s) / 3600000);
    }, 0);
    const hoursCount = `${totalHours.toFixed(1).replace(".0", "")} h`;
    const hoursDeltaText = totalHours > 0 ? `${totalHours.toFixed(1).replace(".0", "")} horas agendadas` : "Nenhuma hora agendada";

    // 3. Tokens
    const totalObservedTokens = devices.reduce((sum, d) => sum + Number(d.observed_tokens || 0), 0);
    const totalInputTokens = devices.reduce((sum, d) => sum + Number(d.observed_input_tokens || 0), 0);
    const totalOutputTokens = devices.reduce((sum, d) => sum + Number(d.observed_output_tokens || 0), 0);
    const eventsTokens = usageEvents.reduce((sum, ev) => sum + Number(ev.thread_total_tokens || 0), 0);
    const effectiveTokens = Math.max(totalObservedTokens, eventsTokens);

    const tokensCount = formatTokenCount(effectiveTokens);
    const tokensDeltaText = effectiveTokens > 0 ? "Consumo acumulado" : "Nenhum token consumido ainda";

    // 4. Approval / Occupancy rate
    const approvedCount = weekReservations.filter((r) => r.approval_status === "approved" || r.status === "scheduled").length;
    const approvalRate = weekReservations.length > 0 ? Math.round((approvedCount / weekReservations.length) * 100) : 100;
    const occupancyRate = `${approvalRate}%`;
    const occupancyDeltaText = `${approvedCount} de ${weekReservations.length || 1} reservas confirmadas`;

    // 5. LineChart Data: 7 points for current week
    const dayNamesShort = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
    const monthNames = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
    const pad = (n: number) => String(n).padStart(2, "0");

    const lineChartData: LineChartPoint[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      d.setHours(0, 0, 0, 0);
      const dEnd = new Date(d);
      dEnd.setHours(23, 59, 59, 999);

      const count = reservations.filter((r) => {
        if (r.status === "cancelled") return false;
        const s = Date.parse(r.starts_at);
        return s >= d.getTime() && s <= dEnd.getTime();
      }).length;

      lineChartData.push({
        dateLabel: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`,
        dayLabel: dayNamesShort[i],
        value: count,
        fullDate: `${d.getDate()} de ${monthNames[d.getMonth()]}`,
      });
    }

    // 6. Models Breakdown & BarChart items
    const defaultModelNames = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4"];
    const enabledModels: string[] = Array.isArray(settings?.enabled_models) && settings.enabled_models.length > 0
      ? settings.enabled_models
      : defaultModelNames;

    const modelStatsMap = new Map<string, { sessions: number; input: number; output: number; total: number }>();
    for (const m of enabledModels) {
      modelStatsMap.set(m, { sessions: 0, input: 0, output: 0, total: 0 });
    }

    if (usageEvents.length > 0) {
      for (const ev of usageEvents) {
        const mId = ev.model_id || enabledModels[0] || "gpt-5.6-sol";
        const current = modelStatsMap.get(mId) || { sessions: 0, input: 0, output: 0, total: 0 };
        current.sessions += 1;
        const inTok = Number(ev.thread_input_tokens || 0);
        const outTok = Number(ev.thread_output_tokens || 0);
        const totTok = Number(ev.thread_total_tokens || (inTok + outTok));
        current.input += inTok;
        current.output += outTok;
        current.total += totTok;
        modelStatsMap.set(mId, current);
      }
    } else if (effectiveTokens > 0) {
      const topModel = enabledModels[0] || "gpt-5.6-sol";
      modelStatsMap.set(topModel, {
        sessions: reservations.length || 1,
        input: totalInputTokens,
        output: totalOutputTokens,
        total: effectiveTokens,
      });
    }

    const modelColorMap: Record<string, string> = {
      "gpt-5.6-sol": "#2563eb",
      "gpt-5.6-terra": "#10b981",
      "gpt-5.6-luna": "#8b5cf6",
      "gpt-5.5": "#f59e0b",
      "gpt-5.4": "#64748b",
      "gpt-4o": "#0ea5e9",
      "o4-mini": "#f97316",
    };

    const barChartItems: BarChartItem[] = Array.from(modelStatsMap.entries()).map(([modelId, stats]) => ({
      modelId,
      label: modelId.replace("-", " "),
      tokensMillion: Number((stats.total / 1_000_000).toFixed(2)),
      color: modelColorMap[modelId] || "#2563eb",
    }));

    const modelIconMap: Record<string, { icon: string; color: string }> = {
      "gpt-5.6-sol": { icon: "ph-sun", color: "#eab308" },
      "gpt-5.6-terra": { icon: "ph-plant", color: "#10b981" },
      "gpt-5.6-luna": { icon: "ph-moon", color: "#8b5cf6" },
      "gpt-5.5": { icon: "ph-cube", color: "#3b82f6" },
      "gpt-5.4": { icon: "ph-sparkle", color: "#6366f1" },
      "gpt-4o": { icon: "ph-chat-circle-dots", color: "#2563eb" },
      "o4-mini": { icon: "ph-lightning", color: "#f97316" },
    };

    const grandTotalTokens = Array.from(modelStatsMap.values()).reduce((sum, s) => sum + s.total, 0);

    const observedModels: ObservedModelRow[] = Array.from(modelStatsMap.entries()).map(([modelId, stats]) => {
      const meta = modelIconMap[modelId] || { icon: "ph-cube", color: "var(--color-brand-primary)" };
      const part = grandTotalTokens > 0 ? Math.round((stats.total / grandTotalTokens) * 100) : 0;
      return {
        name: modelId.replace("-", " "),
        icon: meta.icon,
        iconColor: meta.color,
        sessions: stats.sessions,
        inputTokens: formatTokenCount(stats.input),
        outputTokens: formatTokenCount(stats.output),
        totalTokens: formatTokenCount(stats.total),
        participationPercent: part,
      };
    });

    // 7. Heatmap matrix: 7 days x 12 time slots
    const heatmapMatrix: number[][] = [];
    for (let dIdx = 0; dIdx < 7; dIdx++) {
      const row: number[] = [];
      const dayStart = new Date(monday);
      dayStart.setDate(monday.getDate() + dIdx);

      for (let h = 0; h < 12; h++) {
        const startHour = h * 2;
        const endHour = startHour + 2;
        const slotS = new Date(dayStart);
        slotS.setHours(startHour, 0, 0, 0);
        const slotE = new Date(dayStart);
        slotE.setHours(endHour, 0, 0, 0);

        const hasRes = reservations.some((r) => {
          if (r.status === "cancelled") return false;
          const s = Date.parse(r.starts_at);
          const e = Date.parse(r.ends_at);
          return s < slotE.getTime() && e > slotS.getTime();
        });

        const hasEvent = usageEvents.some((ev) => {
          const t = Date.parse(ev.observed_at);
          return t >= slotS.getTime() && t < slotE.getTime();
        });

        let level = 0;
        if (hasEvent) level = 4;
        else if (hasRes) level = 3;

        row.push(level);
      }
      heatmapMatrix.push(row);
    }

    return {
      sessionsCount,
      sessionsDeltaText,
      hoursCount,
      hoursDeltaText,
      tokensCount,
      tokensDeltaText,
      occupancyRate,
      occupancyDeltaText,
      lineChartData,
      barChartItems,
      heatmapMatrix,
      observedModels,
    };
  }, [reservations, devices, usageEvents, settings, weekOffset]);

  // Actions
  async function createReservation(accountId: string, startsAt: Date, durationHours?: number) {
    const computedDuration = durationHours ?? 5;
    await apiClient.user("/api/user/reservations", {
      method: "POST",
      body: JSON.stringify({
        accountId,
        startsAt: startsAt.toISOString(),
        durationHours: computedDuration,
        requestedQuotaPercent: 100,
      }),
    });
    await loadData(true);
  }

  async function cancelReservation(reservationId: string) {
    await apiClient.user(`/api/user/reservations/${encodeURIComponent(reservationId)}/cancel`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    await loadData(true);
  }

  function handleLogout() {
    window.localStorage.removeItem("remote_codex_admin_session");
    window.sessionStorage.clear();
    window.location.replace("/login");
  }

  return {
    profile,
    accounts,
    selectedAccountId,
    setSelectedAccountId,
    weekLabel,
    days,
    reservations,
    busySlots,
    prevWeek: () => setWeekOffset((prev) => prev - 1),
    nextWeek: () => setWeekOffset((prev) => prev + 1),
    activeReservation,
    nextReservation,
    activeSessionToken,
    activeSessionDevice,
    activeSessionMetrics,
    activeSessionTimings,
    userStatistics,
    isLoading,
    isRefreshing,
    error,
    refreshData: () => loadData(false),
    createReservation,
    cancelReservation,
    logout: handleLogout,
  };
}
