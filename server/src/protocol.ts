import type { RawData } from "ws";

export const PROTOCOL_VERSION = 1 as const;

export interface RegisterMessage {
  v: typeof PROTOCOL_VERSION;
  type: "register";
  hostId: string;
}

export interface RelayDevice {
  deviceId: string;
  label: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  disabledAt: string | null;
  lastSeenAt: string | null;
  /** New devices are pinned to one central account; null keeps v1/v2 compatibility. */
  accountId?: string | null;
  /** Absolute ceiling in the account's weekly rate-limit window. */
  weeklyLimitPercent?: number | null;
  /** End-user session metadata. Raw credentials are never included. */
  userId?: string | null;
  reservationId?: string | null;
  quotaBaseUsedPercent?: number | null;
  quotaBudgetPercent?: number | null;
  /** Model IDs this session may use. Null/undefined preserves legacy unrestricted access. */
  allowedModels?: string[] | null;
  usage?: DeviceUsageSnapshot | null;
}

export interface DeviceUsageSnapshot {
  windowResetsAt: string | null;
  observedTokens: number;
  observedInputTokens: number;
  observedCachedInputTokens: number;
  observedOutputTokens: number;
  observedReasoningTokens: number;
  lastUsageAt: string | null;
  accountUsedPercent: number | null;
  accountWindowDurationMins: number | null;
  accountResetsAt: number | null;
  quotaConsumedPercent?: number;
  lastAccountUsedPercent?: number | null;
  usageLimitReachedAt: string | null;
}

export interface RateLimitWindow {
  usedPercent: number | null;
  windowDurationMins: number | null;
  resetsAt: number | null;
  credits: Record<string, string | number | null> | null;
}

export interface AccountRateLimit {
  limitId: string;
  limitName: string | null;
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  rateLimitReachedType: string | null;
}

export interface AccountUsageSnapshot {
  lifetimeTokens: number | null;
  peakDailyTokens: number | null;
  longestRunningTurnSec: number | null;
  currentStreakDays: number | null;
  longestStreakDays: number | null;
  dailyUsageBuckets: Array<{ startDate: string; tokens: number }> | null;
}

export type AccountRuntimeStatus = "ready" | "login_required" | "offline" | "disabled" | "error";

export interface AccountSnapshot {
  accountId: string;
  label: string;
  email: string | null;
  planType: string | null;
  authMode: string | null;
  status: AccountRuntimeStatus;
  isDefault: boolean;
  updatedAt: string | null;
  rateLimits: Record<string, AccountRateLimit>;
  usage: AccountUsageSnapshot | null;
  error: string | null;
}

export interface AccessSyncMessage {
  v: typeof PROTOCOL_VERSION;
  type: "access.sync";
  devices: RelayDevice[];
}

export interface AccessRevokeMessage {
  v: typeof PROTOCOL_VERSION;
  type: "access.revoke";
  deviceId: string;
}

export interface AccountsSyncMessage {
  v: typeof PROTOCOL_VERSION;
  type: "accounts.sync";
  defaultAccountId: string | null;
  accounts: AccountSnapshot[];
}

export type ControlCommand =
  | "access.issue"
  | "access.list"
  | "access.update-policy"
  | "access.disable"
  | "access.enable"
  | "access.revoke"
  | "access.reactivate"
  | "session.issue"
  | "account.add"
  | "account.list"
  | "account.models.list"
  | "account.login.start"
  | "account.refresh"
  | "account.set-default"
  | "account.logout"
  | "account.remove"
  | "admin.list"
  | "admin.enable"
  | "admin.disable"
  | "admin.invite"
  | "audit.write";

export interface ControlRequestMessage {
  v: typeof PROTOCOL_VERSION;
  type: "control.request";
  requestId: string;
  command: ControlCommand;
  payload: Record<string, unknown>;
  actorId: string | null;
}

export interface ControlResponseMessage {
  v: typeof PROTOCOL_VERSION;
  type: "control.response";
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface AccessSeenMessage {
  v: typeof PROTOCOL_VERSION;
  type: "access.seen";
  deviceId: string;
}

export interface StreamOpenMessage {
  v: typeof PROTOCOL_VERSION;
  type: "stream.open";
  streamId: string;
  deviceId: string;
  accountId: string;
  reservationId: string | null;
}

export interface StreamDataMessage {
  v: typeof PROTOCOL_VERSION;
  type: "stream.data";
  streamId: string;
  kind: "text" | "binary";
  data: string;
}

export interface StreamCloseMessage {
  v: typeof PROTOCOL_VERSION;
  type: "stream.close";
  streamId: string;
  code?: number;
  reason?: string;
}

export interface HeartbeatMessage {
  v: typeof PROTOCOL_VERSION;
  type: "heartbeat";
  timestamp: number;
}

export interface ProviderRequestMessage {
  v: typeof PROTOCOL_VERSION;
  type: "provider.request";
  requestId: string;
  deviceId: string;
  accountId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export interface ProviderResponseStartMessage {
  v: typeof PROTOCOL_VERSION;
  type: "provider.response.start";
  requestId: string;
  status: number;
  headers: Record<string, string>;
}

export interface ProviderResponseChunkMessage {
  v: typeof PROTOCOL_VERSION;
  type: "provider.response.chunk";
  requestId: string;
  data: string;
}

export interface ProviderResponseEndMessage {
  v: typeof PROTOCOL_VERSION;
  type: "provider.response.end";
  requestId: string;
}

export interface ProviderResponseErrorMessage {
  v: typeof PROTOCOL_VERSION;
  type: "provider.response.error";
  requestId: string;
  status?: number;
  error: string;
}

export interface ProviderAbortMessage {
  v: typeof PROTOCOL_VERSION;
  type: "provider.abort";
  requestId: string;
  reason: string;
}

export type WireMessage =
  | RegisterMessage
  | AccessSyncMessage
  | AccessRevokeMessage
  | AccountsSyncMessage
  | ControlRequestMessage
  | ControlResponseMessage
  | AccessSeenMessage
  | StreamOpenMessage
  | StreamDataMessage
  | StreamCloseMessage
  | HeartbeatMessage
  | ProviderRequestMessage
  | ProviderResponseStartMessage
  | ProviderResponseChunkMessage
  | ProviderResponseEndMessage
  | ProviderResponseErrorMessage
  | ProviderAbortMessage;

export function encodeMessage(message: WireMessage): string {
  return JSON.stringify(message);
}

function rawDataToText(raw: RawData): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (Buffer.isBuffer(raw)) {
    return raw.toString("utf8");
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString("utf8");
  }
  return Buffer.from(raw).toString("utf8");
}

function rawDataToBuffer(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) {
    return raw;
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw);
  }
  if (typeof raw === "string") {
    return Buffer.from(raw, "utf8");
  }
  return Buffer.from(raw);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  return Object.values(value).every((v) => typeof v === "string");
}

function validDevice(value: unknown): value is RelayDevice {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isString(value.deviceId) &&
    isString(value.label) &&
    /^[a-f0-9]{64}$/i.test(String(value.tokenHash)) &&
    isString(value.createdAt) &&
    isString(value.expiresAt) &&
    (value.revokedAt === undefined || isNullableString(value.revokedAt)) &&
    (value.disabledAt === undefined || isNullableString(value.disabledAt)) &&
    isNullableString(value.lastSeenAt) &&
    (value.accountId === undefined || isNullableString(value.accountId)) &&
    (value.weeklyLimitPercent === undefined || value.weeklyLimitPercent === null || (typeof value.weeklyLimitPercent === "number" && Number.isFinite(value.weeklyLimitPercent) && value.weeklyLimitPercent >= 0 && value.weeklyLimitPercent <= 100)) &&
    (value.userId === undefined || isNullableString(value.userId)) &&
    (value.reservationId === undefined || isNullableString(value.reservationId)) &&
    (value.quotaBaseUsedPercent === undefined || value.quotaBaseUsedPercent === null || typeof value.quotaBaseUsedPercent === "number") &&
    (value.quotaBudgetPercent === undefined || value.quotaBudgetPercent === null || typeof value.quotaBudgetPercent === "number") &&
    (value.allowedModels === undefined || value.allowedModels === null || (Array.isArray(value.allowedModels) && value.allowedModels.length > 0 && value.allowedModels.every(isString))) &&
    (value.usage === undefined || value.usage === null || validDeviceUsage(value.usage))
  );
}

function validDeviceUsage(value: unknown): value is DeviceUsageSnapshot {
  if (!isRecord(value)) return false;
  const integerFields = [
    "observedTokens",
    "observedInputTokens",
    "observedCachedInputTokens",
    "observedOutputTokens",
    "observedReasoningTokens",
  ];
  return (
    isNullableString(value.windowResetsAt) &&
    integerFields.every((field) => typeof value[field] === "number" && Number.isSafeInteger(value[field]) && value[field] >= 0) &&
    isNullableString(value.lastUsageAt) &&
    (value.accountUsedPercent === null || typeof value.accountUsedPercent === "number") &&
    (value.accountWindowDurationMins === null || typeof value.accountWindowDurationMins === "number") &&
    (value.accountResetsAt === null || typeof value.accountResetsAt === "number") &&
    (value.quotaConsumedPercent === undefined || typeof value.quotaConsumedPercent === "number") &&
    (value.lastAccountUsedPercent === undefined || value.lastAccountUsedPercent === null || typeof value.lastAccountUsedPercent === "number") &&
    isNullableString(value.usageLimitReachedAt)
  );
}

function validControlCommand(value: unknown): value is ControlCommand {
  return (
    value === "access.issue" ||
    value === "access.list" ||
    value === "access.update-policy" ||
    value === "access.disable" ||
    value === "access.enable" ||
    value === "access.revoke" ||
    value === "access.reactivate" ||
    value === "session.issue" ||
    value === "account.add" ||
    value === "account.list" ||
    value === "account.models.list" ||
    value === "account.login.start" ||
    value === "account.refresh" ||
    value === "account.set-default" ||
    value === "account.logout" ||
    value === "account.remove" ||
    value === "admin.list" ||
    value === "admin.enable" ||
    value === "admin.disable" ||
    value === "admin.invite" ||
    value === "audit.write"
  );
}

function validRateLimitWindow(value: unknown): value is RateLimitWindow | null {
  if (value === null) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.usedPercent === null || typeof value.usedPercent === "number") &&
    (value.windowDurationMins === null || typeof value.windowDurationMins === "number") &&
    (value.resetsAt === null || typeof value.resetsAt === "number") &&
    (value.credits === null || value.credits === undefined || isRecord(value.credits))
  );
}

function validAccountSnapshot(value: unknown): value is AccountSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  if (
    !isString(value.accountId) ||
    !isString(value.label) ||
    !isNullableString(value.email) ||
    !isNullableString(value.planType) ||
    !isNullableString(value.authMode) ||
    !["ready", "login_required", "offline", "disabled", "error"].includes(String(value.status)) ||
    typeof value.isDefault !== "boolean" ||
    !isNullableString(value.updatedAt) ||
    !isRecord(value.rateLimits) ||
    !isNullableString(value.error)
  ) {
    return false;
  }

  return Object.values(value.rateLimits).every((limit) => {
    if (!isRecord(limit)) {
      return false;
    }
    return (
      isString(limit.limitId) &&
      isNullableString(limit.limitName) &&
      validRateLimitWindow(limit.primary) &&
      validRateLimitWindow(limit.secondary) &&
      isNullableString(limit.rateLimitReachedType)
    );
  });
}

function validMessage(value: unknown): value is WireMessage {
  if (!isRecord(value) || value.v !== PROTOCOL_VERSION || !isString(value.type)) {
    return false;
  }

  switch (value.type) {
    case "register":
      return isString(value.hostId) && value.hostId.length > 0 && value.hostId.length <= 120;
    case "access.sync":
      return Array.isArray(value.devices) && value.devices.every(validDevice);
    case "accounts.sync":
      return (
        (value.defaultAccountId === null || isString(value.defaultAccountId)) &&
        Array.isArray(value.accounts) &&
        value.accounts.every(validAccountSnapshot)
      );
    case "control.request":
      return (
        isString(value.requestId) &&
        value.requestId.length > 0 &&
        value.requestId.length <= 120 &&
        validControlCommand(value.command) &&
        isRecord(value.payload) &&
        isNullableString(value.actorId)
      );
    case "control.response":
      return (
        isString(value.requestId) &&
        value.requestId.length > 0 &&
        value.requestId.length <= 120 &&
        typeof value.ok === "boolean" &&
        (value.error === undefined || isString(value.error))
      );
    case "access.revoke":
    case "access.seen":
      return isString(value.deviceId) && value.deviceId.length > 0 && value.deviceId.length <= 120;
    case "stream.open":
      return isString(value.streamId) && isString(value.deviceId) && isString(value.accountId) && isNullableString(value.reservationId) && value.streamId.length > 0;
    case "stream.data":
      return (
        isString(value.streamId) &&
        (value.kind === "text" || value.kind === "binary") &&
        isString(value.data)
      );
    case "stream.close":
      return (
        isString(value.streamId) &&
        (value.code === undefined || typeof value.code === "number") &&
        (value.reason === undefined || isString(value.reason))
      );
    case "heartbeat":
      return typeof value.timestamp === "number" && Number.isFinite(value.timestamp);
    case "provider.request":
      return (
        isString(value.requestId) &&
        value.requestId.length > 0 &&
        value.requestId.length <= 120 &&
        isString(value.deviceId) &&
        isString(value.accountId) &&
        isString(value.method) &&
        isString(value.path) &&
        isStringRecord(value.headers) &&
        isString(value.body)
      );
    case "provider.response.start":
      return (
        isString(value.requestId) &&
        value.requestId.length > 0 &&
        value.requestId.length <= 120 &&
        typeof value.status === "number" &&
        Number.isInteger(value.status) &&
        isStringRecord(value.headers)
      );
    case "provider.response.chunk":
      return (
        isString(value.requestId) &&
        value.requestId.length > 0 &&
        value.requestId.length <= 120 &&
        isString(value.data)
      );
    case "provider.response.end":
      return (
        isString(value.requestId) &&
        value.requestId.length > 0 &&
        value.requestId.length <= 120
      );
    case "provider.response.error":
      return (
        isString(value.requestId) &&
        value.requestId.length > 0 &&
        value.requestId.length <= 120 &&
        (value.status === undefined || (typeof value.status === "number" && Number.isInteger(value.status))) &&
        isString(value.error)
      );
    case "provider.abort":
      return (
        isString(value.requestId) &&
        value.requestId.length > 0 &&
        value.requestId.length <= 120 &&
        isString(value.reason)
      );
    default:
      return false;
  }
}

export function decodeMessage(raw: RawData): WireMessage | null {
  try {
    const parsed: unknown = JSON.parse(rawDataToText(raw));
    return validMessage(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function encodeStreamData(raw: RawData, isBinary: boolean): StreamDataMessage {
  const data = isBinary ? rawDataToBuffer(raw).toString("base64") : rawDataToText(raw);
  return {
    v: PROTOCOL_VERSION,
    type: "stream.data",
    streamId: "",
    kind: isBinary ? "binary" : "text",
    data,
  };
}

export function decodeStreamData(message: StreamDataMessage): Buffer | string {
  return message.kind === "binary" ? Buffer.from(message.data, "base64") : message.data;
}
