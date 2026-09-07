import {before,after} from './schema-scenarios.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import fs from 'node:fs/promises';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const db=new PGlite({extensions:{btree_gist}});
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;`);
for(const name of ['supabase/schema_full.sql',...['20260823184959_add_general_quota_settings.sql','20260823190154_add_enabled_models_policy.sql','20260901200000_session_weekly_quota_budget.sql','20260902150000_preserve_requested_window_on_approval.sql','20260905173000_use_fixed_site_sessions.sql','20260905190000_persist_session_quota_consumption.sql','20260907120000_operational_fixed_slots.sql','20260907130000_session_start_jobs.sql'].map(x=>'supabase/migrations/'+x)]) {
 try {if(name.endsWith('20260907120000_operational_fixed_slots.sql')) await before(db); await db.exec('begin;'+await fs.readFile(app+'/'+name,'utf8')+';commit;'); console.log('APPLIED '+name)}catch(e){console.error('FAILED '+name,e.message,e.position,e.internalQuery,e.where);await db.exec('rollback');process.exitCode=1;await db.close();process.exit(1);}
}
try { await after(db); } catch(error) { console.error('SQL CHECK FAILED:',error.message,error.code ?? '');process.exitCode=1; }
await db.close();
