// Read-only metadata and aggregate audit. Does not return names, bookings or credentials.
import pg from 'pg';
const client=new pg.Client({connectionString:process.env.AUDIT_DATABASE_URL || process.env.DATABASE_URL,connectionTimeoutMillis:7000,query_timeout:15000,application_name:'fecart_readonly_audit'});
const report={checkedAt:new Date().toISOString(),connected:false,checks:{},errors:[]};
const checks={
 version:"select version() as version, current_user as role, current_setting('TimeZone') as timezone",
 roles:"select rolname,rolsuper,rolbypassrls from pg_roles where rolname=current_user or rolname in ('authenticated','anon','service_role','fecart_app','fecart-relay','fecart-host')",
 rls:"select n.nspname as schema,c.relname as table,c.relrowsecurity as rls,c.relforcerowsecurity as forced from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and (c.relname like 'codex_%' or c.relname='profiles') order by c.relname",
 policies:"select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname",
 constraints:"select conname,pg_get_constraintdef(oid) as definition,convalidated from pg_constraint where conrelid='public.codex_reservations'::regclass",
 triggers:"select tgname,tgenabled,pg_get_triggerdef(oid) as definition from pg_trigger where tgrelid='public.codex_reservations'::regclass and not tgisinternal",
 functions:"select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,p.prosecdef,p.proconfig,p.proacl,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','codex_private') and p.proname in ('codex_request_reservation','codex_approve_reservation','is_fixed_slot','fixed_slot_end','valid_five_hour_session','account_quota_capacity','enforce_reservation_integrity','codex_claim_session_starts','codex_update_session_start')",
 overlaps:"select count(*) as overlapping_pairs from codex_reservations a join codex_reservations b on a.id<b.id and a.account_id=b.account_id and a.starts_at<b.ends_at and a.ends_at>b.starts_at where a.status='scheduled' and b.status='scheduled' and a.approval_status in ('pending','approved') and b.approval_status in ('pending','approved') and a.ends_at>now() and b.ends_at>now()",
 legacy_windows:"select count(*) as future_requests_requiring_review from codex_reservations where status='scheduled' and approval_status in ('pending','approved') and ends_at>now() and (ends_at is distinct from codex_private.fixed_slot_end(starts_at) or ends_at-starts_at>interval '5 hours' or ends_at-starts_at<interval '5 minutes')",
 stale_busy:"select count(*) as stale_busy_rows from codex_busy_slots b left join codex_reservations r on r.id=b.reservation_id where r.id is null or r.status<>'scheduled' or r.approval_status not in ('pending','approved') or b.starts_at<>r.starts_at or b.ends_at<>r.ends_at",
 startup:"select status,count(*) as jobs,min(updated_at) as oldest from codex_session_starts group by status",
 missing_startup:"select count(*) as overdue_startups from codex_reservations r left join codex_session_starts j on j.reservation_id=r.id where r.status='scheduled' and r.approval_status='approved' and r.starts_at<now()-interval '1 minute' and r.ends_at>now() and (j.reservation_id is null or j.status<>'completed')",
 migration_history:"select name,sha256,applied_at from public.codex_schema_migrations order by name",
 quota_capacity:"select count(*) as accounts,count(*) filter(where capacity.available_percent is null) as missing_weekly_telemetry from codex_account_snapshots a cross join lateral codex_private.account_quota_capacity(a.account_id) capacity where a.status='ready'"
};
try {
 if(!process.env.AUDIT_DATABASE_URL && !process.env.DATABASE_URL) throw new Error('DATABASE_URL or AUDIT_DATABASE_URL is required.');
 await client.connect();report.connected=true;
 await client.query('begin read only');
 for(const [name,sql] of Object.entries(checks)){
  await client.query('savepoint audit_check');
  try {report.checks[name]=(await client.query(sql)).rows;}
  catch(error){await client.query('rollback to savepoint audit_check');report.errors.push({check:name,code:error.code,message:error.message});}
  await client.query('release savepoint audit_check');
 }
 await client.query('rollback');
} catch(error){report.errors.push({code:error.code,message:error.code==='ECONNREFUSED'?'Configured database endpoint refused the connection.':error.message});}
finally {await client.end().catch(()=>{});}
console.log(JSON.stringify(report,null,2));
if(!report.connected || report.errors.length)process.exitCode=1;
