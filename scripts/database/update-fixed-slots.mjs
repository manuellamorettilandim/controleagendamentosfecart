import { readFile } from "node:fs/promises";
import pg from "pg";

const client = new pg.Client("postgresql://postgres:postgres@127.0.0.1:5433/fecart");

async function main() {
  await client.connect();
  const migration = await readFile(
    new URL("../../supabase/migrations/20260905173000_use_fixed_site_sessions.sql", import.meta.url),
    "utf8",
  );
  await client.query(migration);
  console.log("Successfully applied fixed site session functions to postgres!");
  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  await client.end().catch(() => undefined);
  process.exit(1);
});
