import crypto from "node:crypto";

import { centralServiceFromEnvironment } from "./central-service.js";

function usage(): void {
  console.log(`Uso no host central:
  npm.cmd run admin -- bootstrap --email owner@example.com
  npm.cmd run admin -- invite --email admin@example.com
  npm.cmd run admin -- create --login professor --role owner
  npm.cmd run admin -- create --login raissa --role admin

Este comando usa DATABASE_URL no PostgreSQL local. As variáveis do Supabase são aceitas apenas durante a transição.`);
}

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value?.trim() || null;
}

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }
  const email = option("--email");
  const login = option("--login");
  const passwordOpt = option("--password");
  if (!email && !(command === "create" && login)) throw new Error("Informe --email ou, para create, --login.");
  const client = centralServiceFromEnvironment();

  if (command === "bootstrap") {
    const owner = await client.bootstrapOwner(email!);
    console.log(`Owner configurado: ${owner.email ?? email} (${owner.userId}).`);
    return;
  }
  if (command === "invite") {
    const invited = await client.inviteAdmin(email!, null);
    console.log(`Administrador registrado: ${invited.email ?? email} (${invited.userId}). Defina a senha com o comando create antes do primeiro acesso.`);
    return;
  }
  if (command === "create") {
    const role = option("--role");
    if (role !== "owner" && role !== "admin") throw new Error("Informe --role owner ou --role admin.");
    const password = passwordOpt || crypto.randomBytes(24).toString("base64url");
    const created = await client.createAdmin(email || `${login}@remote-codex.invalid`, password, role, null, login || undefined);
    console.log(`${role === "owner" ? "Owner" : "Administrador"} configurado: ${login || created.email || email} (${created.userId}).`);
    if (!passwordOpt) {
      console.log("SENHA TEMPORÁRIA FORTE (copie agora e troque após o primeiro acesso):");
      console.log(password);
    } else {
      console.log("Senha personalizada definida com sucesso!");
    }
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
