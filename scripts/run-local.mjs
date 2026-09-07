import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readdir, readFile, unlink } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.LOCAL_RELAY_PORT || process.env.PORT || 10_000);
const host = process.env.LOCAL_RELAY_HOST?.trim() || "127.0.0.1";
const agentToken = process.env.RELAY_AGENT_TOKEN?.trim();

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("LOCAL_RELAY_PORT/PORT precisa ser uma porta válida.");
}
if (!agentToken) {
  throw new Error("Configure RELAY_AGENT_TOKEN no .env antes de executar npm run local.");
}

const localPostgres = await ensureLocalPostgres(projectRoot);
await ensureLocalPostgresSchema();

const sharedEnvironment = {
  ...process.env,
  HOST: host,
  PORT: String(port),
  SITE_DIR: process.env.SITE_DIR?.trim() || path.join(projectRoot, "site"),
};

const relayTokenHash = process.env.RELAY_AGENT_TOKEN_SHA256?.trim()
  || createHash("sha256").update(agentToken, "utf8").digest("hex");
const relayEnvironment = {
  ...sharedEnvironment,
  RELAY_AGENT_TOKEN_SHA256: relayTokenHash,
};
delete relayEnvironment.RELAY_AGENT_TOKEN;
delete relayEnvironment.SUPABASE_SECRET_KEY;
delete relayEnvironment.SUPABASE_SERVICE_ROLE_KEY;
delete relayEnvironment.SUPABASE_SERVICE_KEY;
delete relayEnvironment.RELAY_URL;

const hostEnvironment = {
  ...sharedEnvironment,
  RELAY_URL: `ws://127.0.0.1:${port}/tunnel`,
};

let stopping = false;
const processes = [
  ["relay", path.join(projectRoot, "dist", "src", "relay-main.js")],
  ["host", path.join(projectRoot, "dist", "src", "host-agent.js")],
].map(([name, entrypoint]) => {
  const environment = name === "relay" ? relayEnvironment : hostEnvironment;
  const child = spawn(process.execPath, [entrypoint], {
    cwd: projectRoot,
    env: environment,
    stdio: "inherit",
    windowsHide: true,
  });
  child.on("error", (error) => {
    console.error(`[local] ${name} failed to start: ${error.message}`);
  });
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(`[local] ${name} stopped (code=${code ?? "null"}, signal=${signal ?? "null"}).`);
      void stop(code === 0 ? 0 : 1);
    }
  });
  return { name, child };
});

async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const { child } of processes) {
    if (!child.killed) child.kill();
  }
  await stopLocalPostgres(localPostgres);
  setTimeout(() => process.exit(exitCode), 250);
}

process.once("SIGINT", () => void stop(0));
process.once("SIGTERM", () => void stop(0));

console.log(`[local] Site e relay: http://${host}:${port}/`);
console.log(`[local] Host-agent conectado ao relay local em ${hostEnvironment.RELAY_URL}.`);

async function ensureLocalPostgres(root) {
  if (process.env.LOCAL_PG_AUTO_START === "0") return null;

  const target = parseDatabaseTarget(process.env.DATABASE_URL);
  const expectedPort = Number(process.env.LOCAL_PG_PORT || 5_433);
  if (!target || !isLoopback(target.host) || target.port !== expectedPort) return null;

  if (await canConnect(target.host, target.port) && await canQueryDatabase(process.env.DATABASE_URL)) {
    console.log(`[local-db] PostgreSQL já está disponível em ${target.host}:${target.port}.`);
    return null;
  }

  const dataDir = path.resolve(process.env.LOCAL_PG_DATA_DIR?.trim() || path.join(root, "tmp", "local-postgres"));
  if (!(await exists(path.join(dataDir, "PG_VERSION")))) {
    throw new Error(
      `[local-db] DATABASE_URL aponta para PostgreSQL local em ${target.host}:${target.port}, `
      + `mas o diretório ${dataDir} não está inicializado.`,
    );
  }

  await removeStalePostmasterPid(dataDir);
  const postgresBin = await findPostgresBinary();
  const pgCtlBin = await findPgCtlBinary(postgresBin);
  console.log(`[local-db] Iniciando PostgreSQL em ${target.host}:${target.port}...`);

  const child = spawn(postgresBin, ["-D", dataDir, "-p", String(target.port)], {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let output = "";
  const captureOutput = (chunk) => {
    output = `${output}${chunk}`.slice(-8_000);
    const lines = String(chunk).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (/\b(FATAL|PANIC|ERROR)\b/i.test(line)) console.error(`[local-db] ${line}`);
    }
  };
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", captureOutput);
  child.stderr?.on("data", captureOutput);

  const exit = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", (error) => resolve({ error }));
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await canConnect(target.host, target.port) && await canQueryDatabase(process.env.DATABASE_URL)) {
      console.log(`[local-db] PostgreSQL pronto em ${target.host}:${target.port}.`);
      child.once("exit", (code, signal) => {
        if (!stopping) {
          console.error(`[local-db] PostgreSQL encerrou (código=${code ?? "null"}, sinal=${signal ?? "null"}).`);
          void stop(1);
        }
      });
      return { child, dataDir, pgCtlBin };
    }

    const result = await Promise.race([exit, delay(250).then(() => null)]);
    if (result) {
      const detail = result.error?.message || `código=${result.code ?? "null"}, sinal=${result.signal ?? "null"}`;
      throw new Error(`[local-db] PostgreSQL encerrou antes de ficar pronto (${detail}).${output ? `\n${output}` : ""}`);
    }
  }

  await stopLocalPostgres({ child, dataDir, pgCtlBin });
  throw new Error("[local-db] Timeout aguardando o PostgreSQL local ficar pronto.");
}

async function ensureLocalPostgresSchema() {
  if (process.env.LOCAL_PG_SCHEMA_AUTO_MIGRATE === "0") return;

  const target = parseDatabaseTarget(process.env.DATABASE_URL);
  const expectedPort = Number(process.env.LOCAL_PG_PORT || 5_433);
  if (!target || !isLoopback(target.host) || target.port !== expectedPort) return;

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await client.connect();
      await client.query(`
        alter table public.codex_device_snapshots
          add column if not exists quota_consumed_percent numeric not null default 0;

        alter table public.codex_device_snapshots
          drop constraint if exists codex_device_snapshots_quota_consumed_percent_check;

        alter table public.codex_device_snapshots
          add constraint codex_device_snapshots_quota_consumed_percent_check
          check (quota_consumed_percent >= 0);
      `);
      console.log("[local-db] Schema local verificado (quota_consumed_percent disponível).");
      return;
    } catch (error) {
      if (error && typeof error === "object" && (error.code === "57P03" || error.code === "ECONNREFUSED")) {
        await delay(250);
        continue;
      }
      throw error;
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  throw new Error("[local-db] Timeout aguardando o PostgreSQL aceitar queries para verificação de schema.");
}

async function stopLocalPostgres(runtime) {
  if (!runtime || runtime.child.exitCode !== null) return;
  console.log("[local-db] Encerrando PostgreSQL iniciado pelo npm run local...");
  const stopped = await runCommand(runtime.pgCtlBin, ["stop", "-D", runtime.dataDir, "-m", "fast", "-w"], 10_000);
  if (!stopped) runtime.child.kill();
  await Promise.race([onceExit(runtime.child), delay(5_000)]);
}

function parseDatabaseTarget(rawUrl) {
  if (!rawUrl?.trim()) return null;
  try {
    const url = new URL(rawUrl.trim());
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return null;
    if (!url.hostname) return null;
    const port = Number(url.port || 5_432);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
    return { host: url.hostname.replace(/^\[|\]$/g, ""), port };
  } catch {
    return null;
  }
}

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function canConnect(hostname, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: hostname, port });
    const finish = (connected) => {
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(1_000, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function canQueryDatabase(connectionString) {
  if (!connectionString) return false;
  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query("select 1;");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function removeStalePostmasterPid(dataDir) {
  const pidPath = path.join(dataDir, "postmaster.pid");
  let contents;
  try {
    contents = await readFile(pidPath, "utf8");
  } catch {
    return;
  }

  const pid = Number(contents.split(/\r?\n/, 1)[0]);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`[local-db] postmaster.pid inválido em ${pidPath}.`);
  }
  if (isProcessAlive(pid)) {
    throw new Error(`[local-db] O PostgreSQL local não responde, mas o PID ${pid} ainda está em execução.`);
  }

  await unlink(pidPath);
  console.log("[local-db] Removi um postmaster.pid órfão do PostgreSQL local.");
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function findPostgresBinary() {
  const configured = process.env.LOCAL_PG_SERVER?.trim();
  if (configured) return configured;

  if (process.platform === "win32") {
    const root = process.env.ProgramFiles || "C:\\Program Files";
    const installRoot = path.join(root, "PostgreSQL");
    try {
      const entries = await readdir(installRoot, { withFileTypes: true });
      const versions = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const version of versions) {
        const candidate = path.join(installRoot, version, "bin", "postgres.exe");
        if (await exists(candidate)) return candidate;
      }
    } catch {
      // Fall through to PATH so portable/custom PostgreSQL installations work too.
    }
    return "postgres.exe";
  }
  return "postgres";
}

async function findPgCtlBinary(postgresBin) {
  if (process.platform === "win32" && path.isAbsolute(postgresBin)) {
    const sibling = path.join(path.dirname(postgresBin), "pg_ctl.exe");
    if (await exists(sibling)) return sibling;
  }
  return process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl";
}

async function exists(filename) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function onceExit(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}

function runCommand(command, args, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
    const finish = (success) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(success);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, timeoutMs);
    child.once("error", () => finish(false));
    child.once("exit", (code) => finish(code === 0));
  });
}
