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
  lastSeenAt: string | null;
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

export type WireMessage =
  | RegisterMessage
  | AccessSyncMessage
  | AccessRevokeMessage
  | AccessSeenMessage
  | StreamOpenMessage
  | StreamDataMessage
  | StreamCloseMessage
  | HeartbeatMessage;

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
    isNullableString(value.revokedAt) &&
    isNullableString(value.lastSeenAt)
  );
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
    case "access.revoke":
    case "access.seen":
      return isString(value.deviceId) && value.deviceId.length > 0 && value.deviceId.length <= 120;
    case "stream.open":
      return isString(value.streamId) && isString(value.deviceId) && value.streamId.length > 0;
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
