import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  setTimeout(() => process.exit(exitCode), 250);
}

process.once("SIGINT", () => void stop(0));
process.once("SIGTERM", () => void stop(0));

console.log(`[local] Site e relay: http://${host}:${port}/`);
console.log(`[local] Host-agent conectado ao relay local em ${hostEnvironment.RELAY_URL}.`);
