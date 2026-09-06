import type { SessionModelUsage } from "../../components/active-session/ModelUsageTable";

export type SessionDataRecord = Record<string, unknown>;

export interface ActiveSessionMetrics {
  modelsUsed: SessionModelUsage[];
  modelsCount: number;
  totalTokens: number;
  commandsCount: number;
  quotaRemainingPercent: number | null;
  statusLabel: string;
}

interface ActiveSessionMetricsInput {
  reservation?: SessionDataRecord | null;
  device?: SessionDataRecord | null;
  usageEvents: SessionDataRecord[];
  hasToken: boolean;
}

function asRecord(value: unknown): SessionDataRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as SessionDataRecord : null;
}

function firstNumber(values: unknown[]): number | null {
  for (const value of values) {
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function firstText(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function eventType(event: SessionDataRecord): string {
  return firstText([event.event_type, event.eventType])?.toLowerCase() || "";
}

function eventModelId(event: SessionDataRecord): string | null {
  return firstText([event.model_id, event.modelId]);
}

function eventTurnKey(event: SessionDataRecord, index: number): string {
  return firstText([event.turn_id, event.turnId, event.id, event.event_key, event.eventKey, event.thread_id, event.threadId]) || `event-${index}`;
}

function eventTokenTotal(event: SessionDataRecord): number {
  const input = firstNumber([event.thread_input_tokens, event.threadInputTokens]) ?? 0;
  const output = firstNumber([event.thread_output_tokens, event.threadOutputTokens]) ?? 0;
  const reasoning = firstNumber([event.thread_reasoning_tokens, event.threadReasoningTokens]) ?? 0;
  const storedTotal = firstNumber([event.thread_total_tokens, event.threadTotalTokens]);
  return Math.max(0, storedTotal ?? input + output + reasoning);
}

function uniqueEventsByTurn(events: SessionDataRecord[]): SessionDataRecord[] {
  const seen = new Set<string>();
  return events.filter((event, index) => {
    const key = eventTurnKey(event, index);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function reservationEvents(
  events: SessionDataRecord[],
  reservationId: string | null | undefined,
  deviceId: string | null | undefined,
): SessionDataRecord[] {
  if (!reservationId && !deviceId) return [];
  return events.filter((event) => {
    const eventReservationId = firstText([event.reservation_id, event.reservationId]);
    const eventDeviceId = firstText([event.device_id, event.deviceId]);
    return eventReservationId === reservationId
      || (!eventReservationId && Boolean(deviceId) && eventDeviceId === deviceId);
  });
}

function deviceNumber(device: SessionDataRecord | null | undefined, keys: string[]): number | null {
  if (!device) return null;
  const usage = asRecord(device.usage);
  return firstNumber([
    ...keys.map((key) => device[key]),
    ...keys.map((key) => usage?.[key]),
  ]);
}

function deviceText(device: SessionDataRecord | null | undefined, keys: string[]): string | null {
  if (!device) return null;
  const usage = asRecord(device.usage);
  return firstText([
    ...keys.map((key) => device[key]),
    ...keys.map((key) => usage?.[key]),
  ]);
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function modelIcon(modelId: string): string {
  if (modelId.includes("sol")) return "ph-sun";
  if (modelId.includes("terra")) return "ph-plant";
  if (modelId.includes("luna") || modelId.includes("mini")) return "ph-moon";
  return "ph-cpu";
}

function formatLastUsedAt(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function statusLabel(device: SessionDataRecord | null | undefined, hasToken: boolean): string {
  const status = deviceText(device, ["status"])?.toLowerCase();
  if (status === "limited") return "Cota atingida";
  if (status === "revoked") return "Encerrada";
  if (status === "disabled") return "Bloqueada";
  if (status === "expired") return "Expirada";
  if (status === "active" && hasToken) return "Conectada";
  if (hasToken) return "Conectada";
  return "Aguardando conexão";
}

function quotaRemainingPercent(
  reservation: SessionDataRecord | null | undefined,
  device: SessionDataRecord | null | undefined,
): number | null {
  const usage = asRecord(device?.usage);
  const directConsumed = firstNumber([
    usage?.quotaConsumedPercent,
    usage?.quota_consumed_percent,
    device?.quotaConsumedPercent,
    device?.quota_consumed_percent,
  ]);
  const accountUsed = deviceNumber(device, ["account_used_percent", "accountUsedPercent"]);
  const quotaBase = firstNumber([
    device?.quota_base_used_percent,
    device?.quotaBaseUsedPercent,
    reservation?.quota_base_used_percent,
    reservation?.quotaBaseUsedPercent,
  ]);
  const quotaBudget = firstNumber([
    device?.quota_budget_percent,
    device?.quotaBudgetPercent,
    reservation?.quota_budget_percent,
    reservation?.quotaBudgetPercent,
  ]) ?? 100;

  let consumed = directConsumed;
  if (consumed === null && accountUsed !== null && quotaBase !== null) {
    consumed = accountUsed >= quotaBase ? accountUsed - quotaBase : accountUsed;
  }
  if (consumed === null || quotaBudget <= 0) return null;
  return clampPercent(((quotaBudget - Math.max(0, consumed)) / quotaBudget) * 100);
}

export function mergeSessionDevices(
  issuedDevice: SessionDataRecord | null | undefined,
  snapshotDevice: SessionDataRecord | null | undefined,
): SessionDataRecord | null {
  if (!issuedDevice && !snapshotDevice) return null;
  if (!issuedDevice) return snapshotDevice || null;
  if (!snapshotDevice) return issuedDevice;

  const merged: SessionDataRecord = {
    ...issuedDevice,
    ...snapshotDevice,
    usage: {
      ...asRecord(issuedDevice.usage),
      ...asRecord(snapshotDevice.usage),
    },
  };

  const usage = merged.usage as SessionDataRecord;
  const counters: Array<[string, string[]]> = [
    ["observedTokens", ["observed_tokens", "observedTokens"]],
    ["observedInputTokens", ["observed_input_tokens", "observedInputTokens"]],
    ["observedCachedInputTokens", ["observed_cached_input_tokens", "observedCachedInputTokens"]],
    ["observedOutputTokens", ["observed_output_tokens", "observedOutputTokens"]],
    ["observedReasoningTokens", ["observed_reasoning_tokens", "observedReasoningTokens"]],
    ["quotaConsumedPercent", ["quota_consumed_percent", "quotaConsumedPercent"]],
  ];
  for (const [target, keys] of counters) {
    const values = [deviceNumber(issuedDevice, keys), deviceNumber(snapshotDevice, keys)].filter((value): value is number => value !== null);
    if (values.length > 0) usage[target] = Math.max(...values);
  }

  const latestAccountUsed = firstNumber([
    snapshotDevice.account_used_percent,
    snapshotDevice.accountUsedPercent,
    asRecord(snapshotDevice.usage)?.account_used_percent,
    asRecord(snapshotDevice.usage)?.accountUsedPercent,
    issuedDevice.account_used_percent,
    issuedDevice.accountUsedPercent,
    asRecord(issuedDevice.usage)?.account_used_percent,
    asRecord(issuedDevice.usage)?.accountUsedPercent,
  ]);
  if (latestAccountUsed !== null) usage.accountUsedPercent = latestAccountUsed;

  return merged;
}

export function buildActiveSessionMetrics({ reservation, device, usageEvents, hasToken }: ActiveSessionMetricsInput): ActiveSessionMetrics {
  const reservationId = firstText([reservation?.id]);
  const deviceId = firstText([device?.device_id, device?.deviceId]);
  const events = reservationEvents(usageEvents, reservationId, deviceId);
  const tokenEvents = events.filter((event) => eventType(event) === "token_usage");
  const completedEvents = uniqueEventsByTurn(events.filter((event) => eventType(event) === "turn_completed"));
  const commandEvents = uniqueEventsByTurn([...completedEvents, ...tokenEvents]);
  const modelEvents = tokenEvents.length > 0 ? tokenEvents : completedEvents.filter((event) => eventModelId(event) || eventTokenTotal(event) > 0);

  const modelStats = new Map<string, SessionModelUsage>();
  const modelLatestTimestamps = new Map<string, number>();
  for (const event of modelEvents) {
    const modelId = eventModelId(event);
    if (!modelId) continue;
    const current = modelStats.get(modelId) || {
      modelName: modelId,
      icon: modelIcon(modelId),
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: null,
      totalTokens: 0,
    };
    const inputTokens = firstNumber([event.thread_input_tokens, event.threadInputTokens]) ?? 0;
    const outputTokens = firstNumber([event.thread_output_tokens, event.threadOutputTokens]) ?? 0;
    const reasoningTokens = firstNumber([event.thread_reasoning_tokens, event.threadReasoningTokens]) ?? 0;
    current.inputTokens += Math.max(0, inputTokens);
    current.outputTokens += Math.max(0, outputTokens);
    current.totalTokens += eventTokenTotal(event);
    current.thinkingTokens = (current.thinkingTokens || reasoningTokens) > 0
      ? (current.thinkingTokens || 0) + Math.max(0, reasoningTokens)
      : null;
    const observedAt = firstText([event.observed_at, event.observedAt]);
    const observedTimestamp = observedAt ? Date.parse(observedAt) : Number.NaN;
    if (observedAt && Number.isFinite(observedTimestamp) && observedTimestamp > (modelLatestTimestamps.get(modelId) ?? 0)) {
      modelLatestTimestamps.set(modelId, observedTimestamp);
      current.lastUsedAt = formatLastUsedAt(observedAt);
    }
    modelStats.set(modelId, current);
  }

  const eventTokens = modelEvents.reduce((sum, event) => sum + eventTokenTotal(event), 0);
  const deviceTokens = deviceNumber(device, ["observed_tokens", "observedTokens"]);

  return {
    modelsUsed: Array.from(modelStats.values()).sort((a, b) => (b.totalTokens - a.totalTokens) || a.modelName.localeCompare(b.modelName)),
    modelsCount: modelStats.size,
    totalTokens: Math.max(0, deviceTokens ?? 0, eventTokens),
    commandsCount: commandEvents.length,
    quotaRemainingPercent: quotaRemainingPercent(reservation, device),
    statusLabel: statusLabel(device, hasToken),
  };
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(".", ",")}k`;
  return value.toLocaleString("pt-BR");
}
