import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { defaultCodexHome } from "./access-store.js";

export interface AccountRecord {
  accountId: string;
  label: string;
  codeHome: string;
  appServerPort: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AccountRegistry {
  version: 1;
  defaultAccountId: string | null;
  accounts: AccountRecord[];
}

export interface PrimaryAccountOptions {
  accountId?: string;
  label?: string;
  codeHome: string;
  appServerPort: number;
}

const writeLocks = new Map<string, Promise<void>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function validateAccount(value: unknown): AccountRecord {
  if (!isRecord(value)) {
    throw new Error("Account registry is invalid: account is not an object.");
  }

  if (
    !isString(value.accountId) ||
    !isString(value.label) ||
    !isString(value.codeHome) ||
    !Number.isInteger(value.appServerPort) ||
    typeof value.enabled !== "boolean" ||
    !isString(value.createdAt) ||
    !isString(value.updatedAt)
  ) {
    throw new Error("Account registry is invalid: required fields are missing.");
  }

  const appServerPort = Number(value.appServerPort);

  return {
    accountId: value.accountId,
    label: value.label,
    codeHome: path.resolve(value.codeHome),
    appServerPort,
    enabled: value.enabled,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function validateRegistry(value: unknown): AccountRegistry {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.accounts)) {
    throw new Error("Account registry is invalid.");
  }

  return {
    version: 1,
    defaultAccountId: value.defaultAccountId === null ? null : String(value.defaultAccountId),
    accounts: value.accounts.map(validateAccount),
  };
}

function emptyRegistry(): AccountRegistry {
  return { version: 1, defaultAccountId: null, accounts: [] };
}

async function withWriteLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = writeLocks.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  writeLocks.set(filePath, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (writeLocks.get(filePath) === current) {
      writeLocks.delete(filePath);
    }
  }
}

export function defaultRemoteStateDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.REMOTE_CODEX_STATE_DIR || path.join(os.homedir(), ".remote-codex"));
}

export function defaultAccountRegistryPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(defaultRemoteStateDirectory(env), "accounts.json");
}

export function defaultAccountsDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.CODEX_ACCOUNTS_DIR || path.join(defaultRemoteStateDirectory(env), "accounts"));
}

export function defaultAccountTokenFile(accountId: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(defaultRemoteStateDirectory(env), "app-server-tokens", `${accountId}.token`);
}

export function primaryAccountOptions(env: NodeJS.ProcessEnv = process.env): PrimaryAccountOptions {
  return {
    accountId: env.RELAY_PRIMARY_ACCOUNT_ID?.trim() || "primary",
    label: env.RELAY_PRIMARY_ACCOUNT_LABEL?.trim() || "Conta principal",
    codeHome: defaultCodexHome(env),
    appServerPort: Number(env.APP_SERVER_PORT || 4_500),
  };
}

export class AccountStore {
  public readonly filePath: string;
  public readonly accountsDirectory: string;

  public constructor(
    filePath = defaultAccountRegistryPath(),
    accountsDirectory = defaultAccountsDirectory(),
  ) {
    this.filePath = path.resolve(filePath);
    this.accountsDirectory = path.resolve(accountsDirectory);
  }

  public async read(): Promise<AccountRegistry> {
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

  public async write(registry: AccountRegistry): Promise<void> {
    const validated = validateRegistry(registry);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = path.join(
      path.dirname(this.filePath),
      `.${path.basename(this.filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
    );
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await fs.rename(temporaryPath, this.filePath);
      await fs.chmod(this.filePath, 0o600).catch(() => undefined);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  public async ensurePrimary(options: PrimaryAccountOptions, now = new Date()): Promise<AccountRecord> {
    return withWriteLock(this.filePath, async () => {
      const registry = await this.read();
      const accountId = options.accountId || "primary";
      const existing = registry.accounts.find((account) => account.accountId === accountId);
      if (existing) {
        const defaultExists = registry.accounts.some((account) => account.accountId === registry.defaultAccountId && account.enabled);
        if (!defaultExists) {
          registry.defaultAccountId = existing.accountId;
          await this.write(registry);
        }
        return existing;
      }

      const usedPorts = new Set(registry.accounts.map((a) => a.appServerPort));
      let assignedPort = options.appServerPort;
      while (usedPorts.has(assignedPort)) {
        assignedPort++;
      }

      const account: AccountRecord = {
        accountId,
        label: options.label?.trim() || "Conta principal",
        codeHome: path.resolve(options.codeHome),
        appServerPort: assignedPort,
        enabled: true,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      registry.accounts.push(account);
      registry.defaultAccountId ??= account.accountId;
      await this.write(registry);
      return account;
    });
  }

  public async list(): Promise<AccountRecord[]> {
    return (await this.read()).accounts;
  }

  public async get(accountId: string): Promise<AccountRecord | null> {
    return (await this.read()).accounts.find((account) => account.accountId === accountId) ?? null;
  }

  public async getDefault(): Promise<AccountRecord | null> {
    const registry = await this.read();
    return registry.accounts.find((account) => account.accountId === registry.defaultAccountId && account.enabled) ?? null;
  }

  public async add(label: string, now = new Date()): Promise<AccountRecord> {
    const normalized = label.trim();
    if (!normalized || normalized.length > 80) {
      throw new Error("Account label must be between 1 and 80 characters.");
    }

    return withWriteLock(this.filePath, async () => {
      const registry = await this.read();
      const accountId = `account-${crypto.randomBytes(8).toString("hex")}`;
      const highestPort = registry.accounts.reduce((highest, account) => Math.max(highest, account.appServerPort), 4_499);
      const account: AccountRecord = {
        accountId,
        label: normalized,
        codeHome: path.join(this.accountsDirectory, accountId, "CODEX_HOME"),
        appServerPort: highestPort + 1,
        enabled: true,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      registry.accounts.push(account);
      await this.write(registry);
      await fs.mkdir(account.codeHome, { recursive: true });
      return account;
    });
  }

  public async remove(accountId: string): Promise<AccountRecord> {
    return withWriteLock(this.filePath, async () => {
      const registry = await this.read();
      const account = registry.accounts.find((candidate) => candidate.accountId === accountId);
      if (!account) {
        throw new Error("Account not found.");
      }
      if (registry.defaultAccountId === accountId) {
        throw new Error("Defina outra conta padrão antes de excluir esta conta.");
      }

      registry.accounts = registry.accounts.filter((candidate) => candidate.accountId !== accountId);
      await this.write(registry);

      const accountsRoot = path.resolve(this.accountsDirectory);
      const accountHome = path.resolve(account.codeHome);
      const relativeHome = path.relative(accountsRoot, accountHome);
      const isManagedHome = Boolean(relativeHome) && !relativeHome.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeHome);
      if (isManagedHome) {
        await fs.rm(accountHome, { recursive: true, force: true });
      }
      return account;
    });
  }

  public async removePlaceholder(accountId: string): Promise<{ removed: boolean; defaultAccountId: string | null }> {
    return withWriteLock(this.filePath, async () => {
      const registry = await this.read();
      if (!registry.accounts.some((account) => account.accountId === accountId)) {
        return { removed: false, defaultAccountId: registry.defaultAccountId };
      }

      const replacement = registry.accounts.find((account) => account.accountId !== accountId && account.enabled);
      if (!replacement) {
        throw new Error("Não é possível remover a conta placeholder sem outra conta habilitada.");
      }

      registry.accounts = registry.accounts.filter((account) => account.accountId !== accountId);
      if (registry.defaultAccountId === accountId || !registry.accounts.some((account) => account.accountId === registry.defaultAccountId && account.enabled)) {
        registry.defaultAccountId = replacement.accountId;
      }
      await this.write(registry);
      return { removed: true, defaultAccountId: registry.defaultAccountId };
    });
  }

  public async setDefault(accountId: string, now = new Date()): Promise<AccountRecord> {
    return withWriteLock(this.filePath, async () => {
      const registry = await this.read();
      const account = registry.accounts.find((candidate) => candidate.accountId === accountId);
      if (!account || !account.enabled) {
        throw new Error("Account not found or disabled.");
      }
      registry.defaultAccountId = accountId;
      account.updatedAt = now.toISOString();
      await this.write(registry);
      return account;
    });
  }

  public async setEnabled(accountId: string, enabled: boolean, now = new Date()): Promise<AccountRecord> {
    return withWriteLock(this.filePath, async () => {
      const registry = await this.read();
      const account = registry.accounts.find((candidate) => candidate.accountId === accountId);
      if (!account) {
        throw new Error("Account not found.");
      }
      if (!enabled && registry.defaultAccountId === accountId) {
        throw new Error("Set another default account before disabling this account.");
      }
      account.enabled = enabled;
      account.updatedAt = now.toISOString();
      await this.write(registry);
      return account;
    });
  }

  public async defaultId(): Promise<string | null> {
    return (await this.read()).defaultAccountId;
  }
}
