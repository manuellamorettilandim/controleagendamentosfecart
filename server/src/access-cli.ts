import { parseArgs } from "node:util";

import { AccessStore } from "./access-store.js";
import { parseTtl } from "./crypto.js";

const DEFAULT_TTL = "30d";

function usage(): void {
  console.log(`Uso:
  npm run access -- issue --label pc-notebook --ttl 30d
  npm run access -- list
  npm run access -- revoke <device-id>
  npm run access -- revoke-all

O token bruto só é exibido uma vez no comando issue. O arquivo local guarda apenas hashes.`);
}

function statusOf(device: { revokedAt: string | null; expiresAt: string }): string {
  if (device.revokedAt !== null) {
    return "revoked";
  }
  return Date.parse(device.expiresAt) > Date.now() ? "active" : "expired";
}

async function main(): Promise<void> {
  const [command, ...positionals] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }

  const store = new AccessStore();
  if (command === "issue") {
    const parsed = parseArgs({
      args: positionals,
      options: {
        label: { type: "string" },
        ttl: { type: "string", default: DEFAULT_TTL },
      },
      strict: true,
    });
    const label = parsed.values.label;
    if (!label) {
      throw new Error("Informe --label.");
    }
    const ttl = parseTtl(parsed.values.ttl ?? DEFAULT_TTL);
    const issued = await store.issue(label, ttl);
    console.log(`deviceId: ${issued.device.deviceId}`);
    console.log(`label: ${issued.device.label}`);
    console.log(`expiresAt: ${issued.device.expiresAt}`);
    console.log("");
    console.log("TOKEN (copie agora; ele não será mostrado novamente):");
    console.log(issued.token);
    return;
  }

  if (command === "list") {
    const devices = await store.list();
    if (devices.length === 0) {
      console.log("Nenhum dispositivo registrado.");
      return;
    }
    for (const device of devices) {
      console.log(`${device.deviceId}\t${statusOf(device)}\t${device.label}\texpires=${device.expiresAt}\tlastSeen=${device.lastSeenAt ?? "never"}`);
    }
    return;
  }

  if (command === "revoke") {
    const deviceId = positionals[0];
    if (!deviceId) {
      throw new Error("Informe o device-id.");
    }
    const revoked = await store.revoke(deviceId);
    if (!revoked) {
      throw new Error("Dispositivo não encontrado ou já revogado.");
    }
    console.log(`Acesso revogado: ${revoked.deviceId} (${revoked.label}).`);
    return;
  }

  if (command === "revoke-all") {
    const count = await store.revokeAll();
    console.log(`${count} dispositivo(s) revogado(s).`);
    return;
  }

  usage();
  throw new Error(`Comando desconhecido: ${command}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
