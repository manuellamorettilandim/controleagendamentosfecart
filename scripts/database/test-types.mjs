import { PostgresAuthClient } from "/opt/fecart/current/dist/src/postgres.js";

const client = new PostgresAuthClient("postgresql:///fecart?host=/var/run/postgresql");

const events = await client.pool.query("select observed_at, thread_total_tokens, account_used_percent from public.codex_usage_events limit 1");
console.log("Event row types:", {
  observed_at_type: typeof events.rows[0]?.observed_at,
  isDate: events.rows[0]?.observed_at instanceof Date,
  thread_total_tokens_type: typeof events.rows[0]?.thread_total_tokens,
  thread_total_tokens_val: events.rows[0]?.thread_total_tokens,
});

await client.close();