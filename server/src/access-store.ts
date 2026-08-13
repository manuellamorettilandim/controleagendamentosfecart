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
}

export interface AccessRegistry {
  version: 2;
  devices: DeviceAccess[];
}

export interface IssuedDevice {
  device: DeviceAccess;
  token: string;
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

function isString(value: unknown): value is string {
  return typeof value === "string";
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

  return {
    deviceId: device.deviceId as string,
    label: device.label as string,
    tokenHash: device.tokenHash as string,
    createdAt: device.createdAt as string,
    expiresAt: device.expiresAt as string,
    revokedAt: (device.revokedAt as string | null | undefined) ?? null,
    disabledAt: (device.disabledAt as string | null | undefined) ?? null,
    lastSeenAt: (device.lastSeenAt as string | null | undefined) ?? null,
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

  public async issue(label: string, ttlMs: number, now = new Date()): Promise<IssuedDevice> {
    const normalizedLabel = assertLabel(label);
    assertTtl(ttlMs);

    return withWriteLock(this.filePath, async () => {
      const registry = await this.read();
      const token = createOpaqueToken();
      const device: DeviceAccess = {
        deviceId: `device-${crypto.randomBytes(8).toString("hex")}`,
        label: normalizedLabel,
        tokenHash: hashToken(token),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
        revokedAt: null,
        disabledAt: null,
        lastSeenAt: null,
      };

      registry.devices.push(device);
      await this.write(registry);
      return { device, token };
    });
  }

  public async list(): Promise<DeviceAccess[]> {
    const registry = await this.read();
    return registry.devices;
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
}
