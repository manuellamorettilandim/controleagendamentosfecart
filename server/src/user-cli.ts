import fs from "node:fs/promises";
import path from "node:path";

import { SupabaseServiceClient, type SupabaseAdminKeyType } from "./supabase.js";
import { loginEmailForUsername } from "./user-identity.js";

interface LegacyUser {
  username: string;
  password: string;
  groupName: string;
}

function parseLegacyUsers(sql: string): LegacyUser[] {
  const users: LegacyUser[] = [];
  const seen = new Set<string>();
  const pattern = /\('((?:''|[^'])+)',\s*'"([^"]+)"'::jsonb,\s*'((?:''|[^'])+)'\)/g;
  for (const match of sql.matchAll(pattern)) {
    const username = match[1].replaceAll("''", "'");
    const canonical = username.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (canonical === "admin" || canonical === "1ia" || seen.has(canonical)) continue;
    seen.add(canonical);
    users.push({ username, password: match[2], groupName: match[3].replaceAll("''", "'") });
  }
  return users;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "import-legacy") {
    console.log("Uso: npm.cmd run users -- import-legacy");
    return;
  }
  const url = process.env.SUPABASE_URL?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  const legacyKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const key = secretKey || legacyKey;
  if (!url || !key) throw new Error("Configure SUPABASE_URL e SUPABASE_SECRET_KEY no host central.");
  const sourcePath = path.resolve("legacy", "fecart-prototype", "SUPABASE_SETUP.sql");
  const users = parseLegacyUsers(await fs.readFile(sourcePath, "utf8"));
  if (users.length === 0) throw new Error("Nenhum login comum foi encontrado no SQL legado.");
  const client = new SupabaseServiceClient(url, key, secretKey ? "secret" : "service_role" as SupabaseAdminKeyType);
  for (const user of users) {
    await client.upsertEndUser({
      username: user.username,
      loginEmail: loginEmailForUsername(user.username),
      password: user.password,
      groupName: user.groupName,
      accountId: "primary",
      weeklyQuotaPercent: 100,
    });
    console.log(`Usuário migrado: ${user.username} · ${user.groupName}`);
  }
  console.log(`${users.length} usuários comuns migrados para o Supabase Auth.`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
