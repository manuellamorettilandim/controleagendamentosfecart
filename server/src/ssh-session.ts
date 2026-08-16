import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { AccessStore } from "./access-store.js";
import { AccountStore } from "./account-store.js";
import type { DeviceUsageCounters } from "./access-store.js";

function safeId(value: string | undefined, label: string): string {
  if (!value || !/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error(`${label} inválido.`);
  return value;
}

function counters(value: unknown): DeviceUsageCounters | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const names = ["totalTokens", "inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens"] as const;
  if (names.some((name) => typeof source[name] !== "number" || !Number.isFinite(source[name]) || Number(source[name]) < 0)) return null;
  return Object.fromEntries(names.map((name) => [name, Math.floor(Number(source[name]))])) as unknown as DeviceUsageCounters;
}

function sessionPaths(env: NodeJS.ProcessEnv = process.env): {
  accessRegistry: string;
  accountRegistry: string;
  accountsDirectory: string;
  workspaceRoot: string;
  codexBin: string;
} {
  const home = os.homedir();
  const stateRoot = path.resolve(env.REMOTE_CODEX_STATE_DIR || (process.platform === "linux" ? "/var/lib/fecart-host" : path.join(home, ".remote-codex")));
  return {
    accessRegistry: path.resolve(env.CODEX_ACCESS_REGISTRY || path.join(stateRoot, "primary-codex", "remote-access.json")),
    accountRegistry: path.resolve(env.CODEX_ACCOUNT_REGISTRY || path.join(stateRoot, "accounts.json")),
    accountsDirectory: path.resolve(env.CODEX_ACCOUNTS_DIR || path.join(stateRoot, "accounts")),
    workspaceRoot: path.resolve(env.CODEX_SSH_WORKSPACE_ROOT || path.join(stateRoot, "workspaces")),
    codexBin: env.CODEX_BIN?.trim() || (process.platform === "linux" ? "/usr/bin/codex" : "codex"),
  };
}

async function main(): Promise<void> {
  const deviceId = safeId(process.argv[2], "Dispositivo");
  const accountId = safeId(process.argv[3], "Conta");
  const config = sessionPaths();
  const accessStore = new AccessStore(config.accessRegistry);
  const accountStore = new AccountStore(config.accountRegistry, config.accountsDirectory);
  const [devices, account] = await Promise.all([accessStore.active(), accountStore.get(accountId)]);
  const device = devices.find((candidate) => candidate.deviceId === deviceId && candidate.accountId === accountId);
  if (!device || !account || !account.enabled) throw new Error("A sessão foi revogada, expirou ou a conta não está disponível.");

  const original = process.env.SSH_ORIGINAL_COMMAND?.trim() || "";
  if (/^(command -v|which)\s+codex(?:\s|$)/u.test(original)) {
    process.stdout.write(`${config.codexBin}\n`);
    return;
  }
  if (/codex\s+--version/u.test(original)) {
    const version = spawn(config.codexBin, ["--version"], { stdio: "inherit", shell: false });
    process.exitCode = await new Promise<number>((resolve) => version.once("exit", (code) => resolve(code ?? 1)));
    return;
  }
  if (original && !/codex(?:\.exe)?(?:['"])?\s+app-server(?:\s|['"]|$)/u.test(original)) {
    throw new Error("Este acesso SSH permite somente o Codex App.");
  }

  const owner = (device.userId || device.deviceId).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
  const workspace = path.join(config.workspaceRoot, owner);
  await fs.mkdir(workspace, { recursive: true, mode: 0o700 });
  await accessStore.touch(deviceId);

  const child = spawn(config.codexBin, ["app-server", "--listen", "stdio://"], {
    cwd: workspace,
    env: {
      ...process.env,
      CODEX_HOME: account.codeHome,
      FECART_DEVICE_ID: deviceId,
      FECART_RESERVATION_ID: device.reservationId || "",
    },
    stdio: ["inherit", "pipe", "inherit"],
    shell: false,
  });
  let outputBuffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    process.stdout.write(chunk);
    outputBuffer += chunk.toString("utf8");
    const lines = outputBuffer.split("\n");
    outputBuffer = lines.pop() || "";
    for (const line of lines) {
      try {
        const message = JSON.parse(line) as Record<string, unknown>;
        const params = message.method === "thread/tokenUsage/updated" && message.params && typeof message.params === "object"
          ? message.params as Record<string, unknown>
          : null;
        const tokenUsage = params?.tokenUsage && typeof params.tokenUsage === "object" ? params.tokenUsage as Record<string, unknown> : null;
        const total = counters(tokenUsage?.total);
        if (!params || typeof params.threadId !== "string" || !total) continue;
        void accessStore.list().then((allDevices) => {
          const current = allDevices.find((candidate) => candidate.deviceId === deviceId);
          return accessStore.recordUsage(deviceId, {
            threadId: params.threadId as string,
            total,
            last: counters(tokenUsage?.last),
            accountUsedPercent: current?.usage.accountUsedPercent ?? null,
            accountWindowDurationMins: current?.usage.accountWindowDurationMins ?? null,
            accountResetsAt: current?.usage.accountResetsAt ?? null,
          });
        }).catch(() => child.kill("SIGTERM"));
      } catch {
        // Non-JSON diagnostic output is forwarded unchanged.
      }
    }
  });
  const accessWatch = setInterval(() => {
    void accessStore.active().then((activeDevices) => {
      const stillActive = activeDevices.some((candidate) => (
        candidate.deviceId === deviceId
        && candidate.accountId === accountId
        && !candidate.usage?.usageLimitReachedAt
      ));
      if (!stillActive) child.kill("SIGTERM");
    }).catch(() => child.kill("SIGTERM"));
  }, 1_000);
  accessWatch.unref();
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => child.kill(signal));
  process.exitCode = await new Promise<number>((resolve) => child.once("exit", (code) => {
    clearInterval(accessWatch);
    resolve(code ?? 1);
  }));
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`FECART Codex App: ${message}\n`);
  process.exitCode = 1;
});
