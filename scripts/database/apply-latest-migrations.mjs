import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const url=process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if(!url) throw new Error('Set MIGRATION_DATABASE_URL (schema owner) or DATABASE_URL. No database was changed.');
const client=new pg.Client({connectionString:url,connectionTimeoutMillis:10000,application_name:'fecart_schema_upgrade'});
try {
 await client.connect();
 await client.query('begin');
 await client.query("set local lock_timeout='15s'; set local statement_timeout='120s'");
 await client.query("select pg_advisory_xact_lock(hashtextextended('fecart-schema-upgrade',0))");
 if(!(await client.query("select to_regclass('public.codex_reservations') as name")).rows[0].name)
   throw new Error('Reservation schema is missing. Restore the documented base schema first; this is an upgrade, not a database reset.');
 const prerequisites=[];
 if(!(await client.query("select to_regclass('public.codex_app_settings') as name")).rows[0].name)
   prerequisites.push('20260823184959_add_general_quota_settings.sql','20260823190154_add_enabled_models_policy.sql');
 else if(!(await client.query("select 1 from information_schema.columns where table_schema='public' and table_name='codex_app_settings' and column_name='enabled_models'")).rowCount)
   prerequisites.push('20260823190154_add_enabled_models_policy.sql');
 await client.query(`create table if not exists public.codex_schema_migrations(name text primary key,sha256 text not null,applied_at timestamptz not null default now()); revoke all on public.codex_schema_migrations from public,anon,authenticated`);
 const files=[...prerequisites,'20260901200000_session_weekly_quota_budget.sql','20260902150000_preserve_requested_window_on_approval.sql','20260905173000_use_fixed_site_sessions.sql','20260905190000_persist_session_quota_consumption.sql','20260907120000_operational_fixed_slots.sql','20260907130000_session_start_jobs.sql'];
 for(const name of files){
  const sql=await fs.readFile(path.join(root,'supabase/migrations',name),'utf8');
  const hash=crypto.createHash('sha256').update(sql).digest('hex');
  const existing=(await client.query('select sha256 from public.codex_schema_migrations where name=$1',[name])).rows[0];
  if(existing){if(existing.sha256!==hash)throw new Error(`Migration changed after installation: ${name}`);continue;}
  await client.query(sql);
  await client.query('insert into public.codex_schema_migrations(name,sha256) values($1,$2)',[name,hash]);
  console.log(`Prepared ${name}`);
 }
 await client.query('commit');
 console.log('Upgrade committed. Run the read-only audit before restarting the host and relay.');
} catch(error){
 await client.query('rollback').catch(()=>{});
 console.error(`Upgrade failed and rolled back: ${error.message}`);
 process.exitCode=1;
} finally {await client.end().catch(()=>{});}
