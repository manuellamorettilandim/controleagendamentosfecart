import { SupabaseServiceClient, type SupabaseAdminKeyType } from "./supabase.js";

function usage(): void {
  console.log(`Uso no host central:
  npm.cmd run admin -- bootstrap --email owner@example.com
  npm.cmd run admin -- invite --email admin@example.com

Este comando usa SUPABASE_SECRET_KEY somente na máquina central (SUPABASE_SERVICE_ROLE_KEY é aceito apenas como fallback legado).`);
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
  if (!email) throw new Error("Informe --email.");
  const url = process.env.SUPABASE_URL?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  const legacyKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const key = secretKey || legacyKey;
  if (!url || !key) throw new Error("Configure SUPABASE_URL e SUPABASE_SECRET_KEY no host central.");
  const keyType: SupabaseAdminKeyType = secretKey ? "secret" : "service_role";
  const client = new SupabaseServiceClient(url, key, keyType);

  if (command === "bootstrap") {
    const owner = await client.bootstrapOwner(email);
    console.log(`Owner configurado: ${owner.email ?? email} (${owner.userId}).`);
    return;
  }
  if (command === "invite") {
    const invited = await client.inviteAdmin(email, null);
    console.log(`Convite enviado para: ${invited.email ?? email} (${invited.userId}).`);
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
