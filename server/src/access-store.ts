import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createOpaqueToken, hashToken } from "./crypto.js";

export interface DeviceAccess {
  deviceId: string;
  label: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  disabledAt: string | null;
  lastSeenAt: string | null;
  accountId: string | null;
  weeklyLimitPercent: number;
  userId: string | null;
  reservationId: string | null;
  quotaBaseUsedPercent: number | null;
  quotaBudgetPercent: number | null;
  allowedModels: string[] | null;
  /** Public half of the ephemeral SSH credential used by the desktop app. */
  sshPublicKey: string | null;
  sshKeyFingerprint: string | null;
  usage: DeviceUsageState;
}

export interface DeviceUsageCounters {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface DeviceUsageState {
  /** Internal de-duplication cursors; never exposed to the relay or Supabase. */
  threadTotals: Record<string, number>;
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
  /** Monotonic account-quota delta observed while this session token is active. */
  quotaConsumedPercent: number;
  /** Last account percentage used to calculate the next monotonic delta. */
  lastAccountUsedPercent: number | null;
  usageLimitReachedAt: string | null;
}

export interface UsageObservation {
  threadId: string;
  total: DeviceUsageCounters;
  last: DeviceUsageCounters | null;
  accountUsedPercent: number | null;
  accountWindowDurationMins: number | null;
  accountResetsAt: number | null;
}

export interface AccessRegistry {
  version: 2;
  devices: DeviceAccess[];
}

export interface IssuedDevice {
  device: DeviceAccess;
  token: string;
  sshPrivateKey: string;
}

export interface IssueDeviceOptions {
  accountId?: string | null;
  weeklyLimitPercent?: number;
  expiresAt?: string | null;
  userId?: string | null;
  reservationId?: string | null;
  quotaBaseUsedPercent?: number | null;
  quotaBudgetPercent?: number | null;
  allowedModels?: string[] | null;
}

export interface UpdateDevicePolicyOptions {
  accountId?: string | null;
  weeklyLimitPercent?: number;
  expiresAt?: string;
  allowedModels?: string[] | null;
}

const writeLocks = new Map<string, Promise<void>>();

async function acquireFileLock(filePath: string): Promise<() => Promise<void>> {
  const lockPath = `${filePath}.lock`;
  const startedAt = Date.now();
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  while (true) {
    try {
      const handle = await fs.open(lockPath, "wx");
      try {
        await handle.writeFile(`${process.pid}\n`, "utf8");
        return async () => {
          await handle.close().catch(() => undefined);
          await fs.rm(lockPath, { force: true }).catch(() => undefined);
        };
      } catch (writeError) {
        await handle.close().catch(() => undefined);
        await fs.rm(lockPath, { force: true }).catch(() => undefined);
        throw writeError;
      }
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
      if (code !== "EEXIST") {
        throw error;
      }

      try {
        const lockStat = await fs.stat(lockPath);
        if (Date.now() - lockStat.mtimeMs > 30_000) {
          await fs.rm(lockPath, { force: true });
          continue;
        }
      } catch (statError) {
        const statCode = statError && typeof statError === "object" && "code" in statError ? (statError as { code?: string }).code : undefined;
        if (statCode !== "ENOENT") {
          throw statError;
        }
      }

      if (Date.now() - startedAt > 30_000) {
        throw new Error("Não foi possível obter o lock do registro de acessos.");
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function withWriteLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = writeLocks.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  writeLocks.set(filePath, current);
  await previous;
  let releaseFileLock: (() => Promise<void>) | null = null;
  try {
    releaseFileLock = await acquireFileLock(filePath);
    return await operation();
  } finally {
    await releaseFileLock?.();
    release();
    if (writeLocks.get(filePath) === current) {
      writeLocks.delete(filePath);
    }
  }
}

export function defaultCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

export function defaultAccessRegistryPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(defaultCodexHome(env), "remote-access.json");
}

function emptyRegistry(): AccessRegistry {
  return { version: 2, devices: [] };
}

function emptyUsage(): DeviceUsageState {
  return {
    threadTotals: {},
    windowResetsAt: null,
    observedTokens: 0,
    observedInputTokens: 0,
    observedCachedInputTokens: 0,
    observedOutputTokens: 0,
    observedReasoningTokens: 0,
    lastUsageAt: null,
    accountUsedPercent: null,
    accountWindowDurationMins: null,
    accountResetsAt: null,
    quotaConsumedPercent: 0,
    lastAccountUsedPercent: null,
    usageLimitReachedAt: null,
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeNonNegativeInteger(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function usageFromValue(value: unknown): DeviceUsageState {
  if (!value || typeof value !== "object") return emptyUsage();
  const source = value as Record<string, unknown>;
  const threadTotals: Record<string, number> = {};
  if (source.threadTotals && typeof source.threadTotals === "object") {
    for (const [threadId, total] of Object.entries(source.threadTotals as Record<string, unknown>).slice(-2_048)) {
      if (threadId.length <= 200 && typeof total === "number" && Number.isSafeInteger(total) && total >= 0) {
        threadTotals[threadId] = total;
      }
    }
  }
  return {
    threadTotals,
    windowResetsAt: isString(source.windowResetsAt) ? source.windowResetsAt : null,
    observedTokens: safeNonNegativeInteger(source.observedTokens),
    observedInputTokens: safeNonNegativeInteger(source.observedInputTokens),
    observedCachedInputTokens: safeNonNegativeInteger(source.observedCachedInputTokens),
    observedOutputTokens: safeNonNegativeInteger(source.observedOutputTokens),
    observedReasoningTokens: safeNonNegativeInteger(source.observedReasoningTokens),
    lastUsageAt: isString(source.lastUsageAt) ? source.lastUsageAt : null,
    accountUsedPercent: finiteNumber(source.accountUsedPercent),
    accountWindowDurationMins: finiteNumber(source.accountWindowDurationMins),
    accountResetsAt: finiteNumber(source.accountResetsAt),
    quotaConsumedPercent: Math.max(0, finiteNumber(source.quotaConsumedPercent) ?? 0),
    lastAccountUsedPercent: finiteNumber(source.lastAccountUsedPercent),
    usageLimitReachedAt: isString(source.usageLimitReachedAt) ? source.usageLimitReachedAt : null,
  };
}

function validateWeeklyLimitPercent(value: unknown, fallback = 100): number {
  const percent = finiteNumber(value) ?? fallback;
  if (percent < 0 || percent > 100) {
    throw new Error("weeklyLimitPercent deve estar entre 0 e 100.");
  }
  return Math.round(percent * 100) / 100;
}

function resetIsoFromUnixSeconds(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function positiveDelta(current: number, previous: number): number {
  return current > previous ? current - previous : 0;
}

function quotaLimitReached(device: DeviceAccess, accountUsedPercent: number | null): boolean {
  if (device.quotaBaseUsedPercent !== null && device.quotaBudgetPercent !== null) {
    const budget = device.quotaBudgetPercent;
    return device.usage.quotaConsumedPercent >= budget;
  }
  if (accountUsedPercent === null) return false;
  // A value of 100 with no per-session budget means monitoring only. It must
  // not revoke a group token when the shared account reaches a reported cap.
  if (device.weeklyLimitPercent >= 100) return false;
  return accountUsedPercent >= device.weeklyLimitPercent;
}

function updateQuotaProgress(
  device: DeviceAccess,
  usage: DeviceUsageState,
  accountUsedPercent: number | null,
  resetIso: string | null,
): void {
  if (accountUsedPercent === null) return;
  const current = Math.max(0, Math.min(100, accountUsedPercent));
  const previous = usage.lastAccountUsedPercent ?? usage.accountUsedPercent ?? device.quotaBaseUsedPercent;
  const windowChanged = Boolean(resetIso && usage.windowResetsAt && resetIso !== usage.windowResetsAt);

  let delta = 0;
  if (windowChanged && previous !== null && current < previous) {
    // A true window reset occurred (the reported percentage dropped and reset timestamp changed).
    // Usage observed in the new window is added to the prior window's consumption.
    delta = current;
  } else if (previous !== null && current >= previous) {
    delta = current - previous;
  } else if (previous === null && device.quotaBaseUsedPercent !== null) {
    delta = Math.max(0, current - device.quotaBaseUsedPercent);
  }

  usage.quotaConsumedPercent = Math.min(10_000, Math.round((usage.quotaConsumedPercent + delta) * 10_000) / 10_000);
  usage.lastAccountUsedPercent = current;
}

function addSafe(left: number, right: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, left + Math.max(0, right));
}

function sshString(value: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(value.length, 0);
  return Buffer.concat([length, value]);
}

export function createEphemeralSshKeyPair(): { publicKey: string; privateKey: string; fingerprint: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" });
  const rawPublicKey = spki.subarray(spki.length - 32);
  const wireKey = Buffer.concat([
    sshString(Buffer.from("ssh-ed25519", "ascii")),
    sshString(rawPublicKey),
  ]);
  return {
    publicKey: `ssh-ed25519 ${wireKey.toString("base64")}`,
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    fingerprint: `SHA256:${crypto.createHash("sha256").update(wireKey).digest("base64").replace(/=+$/u, "")}`,
  };
}

function validateDevice(value: unknown): DeviceAccess {
  if (!value || typeof value !== "object") {
    throw new Error("Registro de acesso inválido: dispositivo não é um objeto.");
  }

  const device = value as Record<string, unknown>;
  const fields = ["deviceId", "label", "tokenHash", "createdAt", "expiresAt"];
  if (fields.some((field) => !isString(device[field]))) {
    throw new Error("Registro de acesso inválido: campos obrigatórios ausentes.");
  }

  if (!/^[a-f0-9]{64}$/i.test(device.tokenHash as string)) {
    throw new Error("Registro de acesso inválido: tokenHash deve ser SHA-256 hexadecimal.");
  }

  if (device.revokedAt !== null && device.revokedAt !== undefined && !isString(device.revokedAt)) {
    throw new Error("Registro de acesso inválido: revokedAt deve ser string ou null.");
  }

  if (device.disabledAt !== null && device.disabledAt !== undefined && !isString(device.disabledAt)) {
    throw new Error("Invalid access registry: disabledAt must be a string or null.");
  }

  if (device.lastSeenAt !== null && device.lastSeenAt !== undefined && !isString(device.lastSeenAt)) {
    throw new Error("Registro de acesso inválido: lastSeenAt deve ser string ou null.");
  }

  const usage = usageFromValue(device.usage);
  const quotaBaseUsedPercent = finiteNumber(device.quotaBaseUsedPercent);
  const storedUsage = device.usage && typeof device.usage === "object" ? device.usage as Record<string, unknown> : null;
  if (finiteNumber(storedUsage?.quotaConsumedPercent) === null) {
    const current = usage.accountUsedPercent;
    if (current !== null && quotaBaseUsedPercent !== null) {
      usage.quotaConsumedPercent = Math.max(0, current >= quotaBaseUsedPercent ? current - quotaBaseUsedPercent : current);
      usage.lastAccountUsedPercent = current;
    }
  }

  return {
    deviceId: device.deviceId as string,
    label: device.label as string,
    tokenHash: device.tokenHash as string,
    createdAt: device.createdAt as string,
    expiresAt: device.expiresAt as string,
    revokedAt: (device.revokedAt as string | null | undefined) ?? null,
    disabledAt: (device.disabledAt as string | null | undefined) ?? null,
    lastSeenAt: (device.lastSeenAt as string | null | undefined) ?? null,
    accountId: isString(device.accountId) && device.accountId.trim() ? device.accountId.trim() : null,
    weeklyLimitPercent: validateWeeklyLimitPercent(device.weeklyLimitPercent),
    userId: isString(device.userId) && device.userId.trim() ? device.userId.trim() : null,
    reservationId: isString(device.reservationId) && device.reservationId.trim() ? device.reservationId.trim() : null,
    quotaBaseUsedPercent,
    quotaBudgetPercent: finiteNumber(device.quotaBudgetPercent),
    allowedModels: Array.isArray(device.allowedModels) && device.allowedModels.length > 0
      ? [...new Set(device.allowedModels.filter(isString).map((model) => model.trim()).filter(Boolean))]
      : null,
    sshPublicKey: isString(device.sshPublicKey) && device.sshPublicKey.startsWith("ssh-ed25519 ") ? device.sshPublicKey : null,
    sshKeyFingerprint: isString(device.sshKeyFingerprint) ? device.sshKeyFingerprint : null,
    usage,
  };
}

function validateRegistry(value: unknown): AccessRegistry {
  if (!value || typeof value !== "object") {
    throw new Error("Registro de acesso inválido.");
  }

  const registry = value as Record<string, unknown>;
  if ((registry.version !== 1 && registry.version !== 2) || !Array.isArray(registry.devices)) {
    throw new Error("Registro de acesso inválido: versão ou devices ausentes.");
  }

  return {
    version: 2,
    devices: registry.devices.map(validateDevice),
  };
}

function assertLabel(label: string): string {
  const normalized = label.trim();
  if (!normalized || normalized.length > 80) {
    throw new Error("O label deve ter entre 1 e 80 caracteres.");
  }
  return normalized;
}

function assertTtl(ttlMs: number): void {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000) {
    throw new Error("TTL interno inválido.");
  }
}

export class AccessStore {
  public readonly filePath: string;

  public constructor(filePath = defaultAccessRegistryPath()) {
    this.filePath = path.resolve(filePath);
  }

  public async read(): Promise<AccessRegistry> {
    try {
      const contents = await fs.readFile(this.filePath, "utf8");
      return validateRegistry(JSON.parse(contents) as unknown);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
      if (code === "ENOENT") {
        return emptyRegistry();
      }
      throw error;
    }
  }

  public async write(registry: AccessRegistry): Promise<void> {
    const validated = validateRegistry(registry);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    const temporaryPath = path.join(
      path.dirname(this.filePath),
      `.${path.basename(this.filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
    );
    const contents = `${JSON.stringify(validated, null, 2)}\n`;

    try {
      await fs.writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
      try {
        await fs.rename(temporaryPath, this.filePath);
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
        if (code !== "EEXIST" && code !== "EPERM" && code !== "ENOTEMPTY") {
          throw error;
        }
        await fs.rm(this.filePath, { force: true });
        await fs.rename(temporaryPath, this.filePath);
      }
      await fs.chmod(this.filePath, 0o600).catch(() => undefined);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  public async issue(label: string, ttlMs: number, now = new Date(), options: IssueDeviceOptions = {}): Promise<IssuedDevice> {
    const normalizedLabel = assertLabel(label);
    const expiresAt = options.expiresAt ? new Date(options.expiresAt) : new Date(now.getTime() + ttlMs);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
      throw new Error("expiresAt deve ser uma data futura válida.");
    }
    if (!options.expiresAt) assertTtl(ttlMs);
    const accountId = typeof options.accountId === "string" && options.accountId.trim() ? options.accountId.trim() : null;
    const weeklyLimitPercent = validateWeeklyLimitPercent(options.weeklyLimitPercent);

    return withWriteLock(this.filePath, async () => {
      const registry = await this.read();
      const reservationId = typeof options.reservationId === "string" && options.reservationId.trim() ? options.reservationId.trim() : null;
      if (accountId && registry.devices.some((device) =>
        device.accountId === accountId
        && device.revokedAt === null
        && Date.parse(device.expiresAt) > now.getTime()
        && (!reservationId || device.reservationId !== reservationId)
      )) {
        throw new Error("Já existe um token não revogado para esta conta em outra reserva. Revogue o anterior antes de emitir outro.");
      }
      const token = createOpaqueToken();
      const sshKey = createEphemeralSshKeyPair();
      const device: DeviceAccess = {
        deviceId: `device-${crypto.randomBytes(8).toString("hex")}`,
        label: normalizedLabel,
        tokenHash: hashToken(token),
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        revokedAt: null,
        disabledAt: null,
        lastSeenAt: null,
        accountId,
        weeklyLimitPercent,
        userId: typeof options.userId === "string" && options.userId.trim() ? options.userId.trim() : null,
        reservationId,
        quotaBaseUsedPercent: finiteNumber(options.quotaBaseUsedPercent),
        quotaBudgetPercent: finiteNumber(options.quotaBudgetPercent),
        allowedModels: Array.isArray(options.allowedModels) && options.allowedModels.length > 0
          ? [...new Set(options.allowedModels.map((model) => model.trim()).filter(Boolean))]
          : null,
        sshPublicKey: sshKey.publicKey,
        sshKeyFingerprint: sshKey.fingerprint,
        usage: emptyUsage(),
      };

      registry.devices.push(device);
      await this.write(registry);
      return { device, token, sshPrivateKey: sshKey.privateKey };
    });
  }

  public async list(): Promise<DeviceAccess[]> {
    const registry = await this.read();
    return registry.devices;
  }

  public async updatePolicy(deviceId: string, options: UpdateDevicePolicyOptions, now = new Date()): Promise<DeviceAccess | null> {
    return withWriteLock(this.filePath, async () => {
      const registry = await this.read();
      const device = registry.devices.find((candidate) => candidate.deviceId === deviceId);
      if (!device || device.revokedAt !== null) return null;
      if (options.accountId !== undefined) {
        const accountId = options.accountId && options.accountId.trim() ? options.accountId.trim() : null;
        if (device.accountId !== null && accountId !== device.accountId) {
          throw new Error("A conta vinculada de um token existente não pode ser trocada; revogue e emita outro token.");
        }
        if (accountId && registry.devices.some((candidate) => candidate.deviceId !== device.deviceId && candidate.accountId === accountId && candidate.revokedAt === null && Date.parse(candidate.expiresAt) > now.getTime())) {
          throw new Error("Já existe um token não revogado para esta conta.");
        }
        device.accountId = accountId;
      }
      if (options.weeklyLimitPercent !== undefined) {
        device.weeklyLimitPercent = validateWeeklyLimitPercent(options.weeklyLimitPercent);
      }
      if (options.expiresAt !== undefined) {
        const expiresAt = new Date(options.expiresAt);
        if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
          throw new Error("expiresAt deve ser uma data futura válida.");
        }
        device.expiresAt = expiresAt.toISOString();
      }
      if (options.allowedModels !== undefined) {
        const allowedModels = options.allowedModels === null
          ? null
          : [...new Set(options.allowedModels.map((model) => model.trim()).filter(Boolean))];
        if (allowedModels && allowedModels.length === 0) throw new Error("Ao menos um modelo deve permanecer ativo.");
        device.allowedModels = allowedModels;
      }
      await this.write(registry);
      return device;
    });
  }

  public async active(now = new Date()): Promise<DeviceAccess[]> {
    const timestamp = now.getTime();
    const registry = await this.read();
    return registry.devices.filter((device) => {
      const expiresAt = Date.parse(device.expiresAt);
      return (
        device.revokedAt === null &&
        device.disabledAt === null &&
        Number.isFinite(expiresAt) &&
        expiresAt > timestamp
      );
    });
  }

  public async disable(deviceId: string, now = new Date()): Promise<DeviceAccess | null> {
    return withWriteLock(this.filePath, async () => {
      const registry = await this.read();
      const device = registry.devices.find((candidate) => candidate.deviceId === deviceId);
      if (!device || device.revokedAt !== null || device.disabledAt !== null) {
        return null;
      }

      device.disabledAt = now.toISOString();
      await this.write(registry);
      return device;
    });
  }

  public async enable(deviceId: string, now = new Date()): Promise<DeviceAccess | null> {
    return withWriteLock(this.filePath, async () => {
      const registry = await this.read();
      const device = registry.devices.find((candidate) => candidate.deviceId === deviceId);
      if (
        !device ||
        device.revokedAt !== null ||
        device.disabledAt === null ||
        Date.parse(device.expiresAt) <= now.getTime()
      ) {
        return null;
      }

      device.disabledAt = null;
      await this.write(registry);
      return device;
    });
  }

  public async revoke(deviceId: string, now = new Date()): Promise<DeviceAccess | null> {
    return withWriteLock(this.filePath, async () => {
      const registry = await this.read();
      const device = registry.devices.find((candidate) => candidate.deviceId === deviceId);
      if (!device || device.revokedAt !== null) {
        return null;
      }

      device.revokedAt = now.toISOString();
      await this.write(registry);
      return device;
    });
  }

  public async reactivate(deviceId: string, now = new Date()): Promise<DeviceAccess | null> {
    return withWriteLock(this.filePath, async () => {
      const registry = await this.read();
      const device = registry.devices.find((candidate) => candidate.deviceId === deviceId);
      if (!device || device.revokedAt === null || Date.parse(device.expiresAt) <= now.getTime()) {
        return null;
      }
      if (device.accountId && registry.devices.some((candidate) => (
        candidate.deviceId !== device.deviceId
        && candidate.accountId === device.accountId
        && candidate.revokedAt === null
        && Date.parse(candidate.expiresAt) > now.getTime()
      ))) {
        throw new Error("Já existe outro token ativo para esta conta.");
      }

      device.revokedAt = null;
      device.disabledAt = null;
      await this.write(registry);
      return device;
    });
  }

  public async revokeAll(now = new Date()): Promise<number> {
    return withWriteLock(this.filePath, async () => {
      const registry = await this.read();
      const revokedAt = now.toISOString();
      let count = 0;
      for (const device of registry.devices) {
        if (device.revokedAt === null) {
          device.revokedAt = revokedAt;
          count += 1;
        }
      }

      if (count > 0) {
        await this.write(registry);
      }
      return count;
    });
  }

  public async revokeForAccount(accountId: string, now = new Date()): Promise<number> {
    return withWriteLock(this.filePath, async () => {
      const registry = await this.read();
      const revokedAt = now.toISOString();
      let count = 0;
      for (const device of registry.devices) {
        if (device.accountId !== accountId || device.revokedAt !== null) continue;
        device.revokedAt = revokedAt;
        count += 1;
      }
      if (count > 0) await this.write(registry);
      return count;
    });
  }

  public async touch(deviceId: string, now = new Date()): Promise<void> {
    await withWriteLock(this.filePath, async () => {
      const registry = await this.read();
      const device = registry.devices.find((candidate) => candidate.deviceId === deviceId);
      if (
        !device ||
        device.revokedAt !== null ||
        device.disabledAt !== null ||
        Date.parse(device.expiresAt) <= now.getTime()
      ) {
        return;
      }

      device.lastSeenAt = now.toISOString();
      await this.write(registry);
    });
  }

  public async recordUsage(deviceId: string, observation: UsageObservation, now = new Date()): Promise<DeviceAccess | null> {
    return withWriteLock(this.filePath, async () => {
      const registry = await this.read();
      const device = registry.devices.find((candidate) => candidate.deviceId === deviceId);
      if (
        !device ||
        device.revokedAt !== null ||
        device.disabledAt !== null ||
        Date.parse(device.expiresAt) <= now.getTime()
      ) {
        return null;
      }

      const usage = device.usage ?? emptyUsage();
      const resetIso = resetIsoFromUnixSeconds(observation.accountResetsAt);
      updateQuotaProgress(device, usage, observation.accountUsedPercent, resetIso);
      if (resetIso) usage.windowResetsAt = resetIso;

      const previousTotal = usage.threadTotals[observation.threadId];
      const counters = previousTotal === undefined
        ? (observation.last ?? observation.total)
        : {
            totalTokens: positiveDelta(observation.total.totalTokens, previousTotal),
            inputTokens: positiveDelta(observation.total.inputTokens, 0),
            cachedInputTokens: positiveDelta(observation.total.cachedInputTokens, 0),
            outputTokens: positiveDelta(observation.total.outputTokens, 0),
            reasoningOutputTokens: positiveDelta(observation.total.reasoningOutputTokens, 0),
          };

      if (previousTotal !== undefined) {
        const previousCounters = usage.threadTotals[`${observation.threadId}:input`] ?? 0;
        const previousCached = usage.threadTotals[`${observation.threadId}:cached`] ?? 0;
        const previousOutput = usage.threadTotals[`${observation.threadId}:output`] ?? 0;
        const previousReasoning = usage.threadTotals[`${observation.threadId}:reasoning`] ?? 0;
        counters.inputTokens = positiveDelta(observation.total.inputTokens, previousCounters);
        counters.cachedInputTokens = positiveDelta(observation.total.cachedInputTokens, previousCached);
        counters.outputTokens = positiveDelta(observation.total.outputTokens, previousOutput);
        counters.reasoningOutputTokens = positiveDelta(observation.total.reasoningOutputTokens, previousReasoning);
      }

      usage.threadTotals[observation.threadId] = Math.max(0, observation.total.totalTokens);
      usage.threadTotals[`${observation.threadId}:input`] = Math.max(0, observation.total.inputTokens);
      usage.threadTotals[`${observation.threadId}:cached`] = Math.max(0, observation.total.cachedInputTokens);
      usage.threadTotals[`${observation.threadId}:output`] = Math.max(0, observation.total.outputTokens);
      usage.threadTotals[`${observation.threadId}:reasoning`] = Math.max(0, observation.total.reasoningOutputTokens);
      const threadKeys = Object.keys(usage.threadTotals);
      if (threadKeys.length > 10_240) {
        for (const key of threadKeys.slice(0, threadKeys.length - 10_240)) delete usage.threadTotals[key];
      }

      usage.observedTokens = addSafe(usage.observedTokens, counters.totalTokens);
      usage.observedInputTokens = addSafe(usage.observedInputTokens, counters.inputTokens);
      usage.observedCachedInputTokens = addSafe(usage.observedCachedInputTokens, counters.cachedInputTokens);
      usage.observedOutputTokens = addSafe(usage.observedOutputTokens, counters.outputTokens);
      usage.observedReasoningTokens = addSafe(usage.observedReasoningTokens, counters.reasoningOutputTokens);
      usage.lastUsageAt = now.toISOString();
      usage.accountUsedPercent = finiteNumber(observation.accountUsedPercent);
      usage.accountWindowDurationMins = finiteNumber(observation.accountWindowDurationMins);
      usage.accountResetsAt = finiteNumber(observation.accountResetsAt);
      if (quotaLimitReached(device, usage.accountUsedPercent)) {
        usage.usageLimitReachedAt ??= now.toISOString();
      } else {
        usage.usageLimitReachedAt = null;
      }
      device.usage = usage;
      await this.write(registry);
      return device;
    });
  }

  public async updateAccountLimit(
    accountId: string,
    accountUsedPercent: number | null,
    accountWindowDurationMins: number | null,
    accountResetsAt: number | null,
    now = new Date(),
    scope: "all" | "reservations" | "manual" = "all",
  ): Promise<boolean> {
    return withWriteLock(this.filePath, async () => {
      const registry = await this.read();
      let changed = false;
      const resetIso = resetIsoFromUnixSeconds(accountResetsAt);
      for (const device of registry.devices) {
        if (device.accountId !== accountId || device.revokedAt !== null || device.disabledAt !== null) continue;
        if (scope === "reservations" && !device.reservationId) continue;
        if (scope === "manual" && device.reservationId) continue;
        const usage = device.usage ?? emptyUsage();
        const before = JSON.stringify(usage);
        updateQuotaProgress(device, usage, accountUsedPercent, resetIso);
        if (resetIso) usage.windowResetsAt = resetIso;
        usage.accountUsedPercent = accountUsedPercent;
        usage.accountWindowDurationMins = accountWindowDurationMins;
        usage.accountResetsAt = accountResetsAt;
        if (quotaLimitReached(device, accountUsedPercent)) {
          usage.usageLimitReachedAt ??= now.toISOString();
        } else {
          usage.usageLimitReachedAt = null;
        }
        device.usage = usage;
        changed ||= before !== JSON.stringify(usage);
      }
      if (changed) await this.write(registry);
      return changed;
    });
  }
}
