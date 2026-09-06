import { PostgresAuthClient } from "/opt/fecart/current/dist/src/postgres.js";
import { aggregateUsageReport } from "/opt/fecart/current/dist/src/report-aggregator.js";

const client = new PostgresAuthClient("postgresql:///fecart?host=/var/run/postgresql");

const from = "2026-08-03T00:00:00.000Z";
const to = "2026-09-02T23:59:59.999Z";
const timeZone = "America/Sao_Paulo";

// Query admin
const profilesRes = await client.pool.query("select user_id,username,group_name,enabled from public.profiles");
const reservationsRes = await client.pool.query("select id,user_id,account_id,starts_at,ends_at,status,approval_status,requested_quota_percent,quota_budget_percent,device_id,activated_at from public.codex_reservations where starts_at <= $1 order by starts_at asc", [to]);
const devicesRes = await client.pool.query("select device_id,user_id,reservation_id,created_at,observed_tokens,observed_input_tokens,observed_cached_input_tokens,observed_output_tokens,observed_reasoning_tokens,quota_base_used_percent,account_used_percent,usage_last_seen_at,stale_at from public.codex_device_snapshots where created_at <= $1 order by created_at asc", [to]);
const accountsRes = await client.pool.query("select account_id,label,status,rate_limits,usage,observed_at from public.codex_account_snapshots order by label asc");
const usageSamplesRes = await client.pool.query("select id,account_id,status,rate_limits,usage,used_percent,window_duration_mins,resets_at,observed_at from public.codex_account_usage_samples where observed_at >= $1 order by observed_at asc", [from]);
const usageEventsRes = await client.pool.query("select id,event_type,device_id,user_id,reservation_id,account_id,thread_id,turn_id,model_id,status,thread_total_tokens,thread_input_tokens,thread_cached_input_tokens,thread_output_tokens,thread_reasoning_tokens,account_used_percent,account_window_duration_mins,account_resets_at,observed_at from public.codex_usage_events where observed_at >= $1 order by observed_at asc", [from]);

const rawData = {
  profiles: profilesRes.rows,
  reservations: reservationsRes.rows,
  deviceSnapshots: devicesRes.rows,
  accountSnapshots: accountsRes.rows,
  accountUsageSamples: usageSamplesRes.rows,
  usageEvents: usageEventsRes.rows,
  adminAudit: [],
  hostConnected: true,
  lastHostSyncAt: null,
};

const report = aggregateUsageReport(rawData, { from, to, timeZone });
console.log("Summary:", JSON.stringify(report.summary, null, 2));
console.log("Groups with usage:", report.groups.filter(g => g.totalTokens > 0 || g.sessionsActivated > 0).map(g => ({ groupName: g.groupName, username: g.username, totalTokens: g.totalTokens, sessionsActivated: g.sessionsActivated })));

await client.close();