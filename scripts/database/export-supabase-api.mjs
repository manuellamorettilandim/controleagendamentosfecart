import { createHash } from "node:crypto";
import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const TABLES = [
  "profiles",
  "codex_admins",
  "codex_account_snapshots",
  "codex_reservations",
  "codex_busy_slots",
  "codex_device_snapshots",
  "codex_admin_audit",
  "codex_account_usage_samples",
  "codex_usage_events",
  "codex_user_profiles",
  "codex_app_settings",
];

const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
if (!url || !key) {
  throw new Error("SUPABASE_URL e SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY são obrigatórios.");
}
const sourceHost = new URL(url).host;
const sourceProjectRef = sourceHost.split(".")[0];
const expectedProjectRef = process.env.EXPECTED_SUPABASE_PROJECT_REF?.trim();
if (expectedProjectRef && sourceProjectRef !== expectedProjectRef) {
  throw new Error(`Projeto Supabase inesperado: ${sourceProjectRef}. Esperado: ${expectedProjectRef}.`);
}

const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const outputDirectory = path.resolve(process.argv[2] || "backups/emergency-production", `supabase-api-${timestamp}`);
await mkdir(outputDirectory, { recursive: true, mode: 0o700 });

const headers = {
  apikey: key,
  Accept: "application/json",
  ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}),
};

async function request(endpoint, extraHeaders = {}) {
  const response = await fetch(`${url}${endpoint}`, {
    headers: { ...headers, ...extraHeaders },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: response.ok, status: response.status, data };
}

async function saveJson(name, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  const file = `${name}.json`;
  await writeFile(path.join(outputDirectory, file), body, { encoding: "utf8", mode: 0o600 });
  return { file, sha256: createHash("sha256").update(body).digest("hex") };
}

async function exportTable(table) {
  const rows = [];
  const pageSize = 1_000;
  for (let offset = 0; ; offset += pageSize) {
    const result = await request(`/rest/v1/${encodeURIComponent(table)}?select=*`, {
      Range: `${offset}-${offset + pageSize - 1}`,
      Prefer: "count=exact",
    });
    if (!result.ok) return { table, status: "unavailable", httpStatus: result.status };
    if (!Array.isArray(result.data)) throw new Error(`Resposta inválida ao exportar ${table}.`);
    rows.push(...result.data);
    if (result.data.length < pageSize) break;
  }
  const saved = await saveJson(`table-${table}`, rows);
  return { table, status: "saved", rows: rows.length, ...saved };
}

async function exportAuthUsers() {
  const users = [];
  const pageSize = 1_000;
  for (let page = 1; ; page += 1) {
    const result = await request(`/auth/v1/admin/users?page=${page}&per_page=${pageSize}`);
    if (!result.ok) return { status: "unavailable", httpStatus: result.status };
    const pageUsers = Array.isArray(result.data?.users) ? result.data.users : [];
    users.push(...pageUsers);
    if (pageUsers.length < pageSize) break;
  }
  const saved = await saveJson("auth-users-without-password-hashes", users);
  return { status: "saved", users: users.length, passwordHashesIncluded: false, ...saved };
}

const tableResults = [];
for (const table of TABLES) {
  const result = await exportTable(table);
  tableResults.push(result);
  process.stdout.write(`${table}: ${result.status}${result.rows === undefined ? "" : ` (${result.rows})`}\n`);
}
const authUsers = await exportAuthUsers();
process.stdout.write(`auth.users API: ${authUsers.status}${authUsers.users === undefined ? "" : ` (${authUsers.users})`}\n`);

await cp(path.resolve("supabase/migrations"), path.join(outputDirectory, "migrations"), { recursive: true });
await cp(path.resolve("supabase/schema_full.sql"), path.join(outputDirectory, "schema_full.sql"));

const failedTables = tableResults.filter((result) => result.status !== "saved");
const manifest = {
  format: "fecart-supabase-api-emergency-v1",
  createdAt: new Date().toISOString(),
  sourceHost,
  tables: tableResults,
  authUsers,
  limitations: [
    "This API rescue does not contain password hashes or private auth schema rows.",
    "A PostgreSQL pg_dump is still required before decommissioning Supabase.",
  ],
};
const savedManifest = await saveJson("manifest", manifest);

if (failedTables.length > 0 || authUsers.status !== "saved") {
  process.stderr.write(`Resgate parcial salvo em ${outputDirectory}; consulte ${savedManifest.file}.\n`);
  process.exitCode = 2;
} else {
  process.stdout.write(`Resgate API validado em ${outputDirectory}\n`);
}
