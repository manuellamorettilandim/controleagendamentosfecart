import assert from 'node:assert/strict';
export async function fixtures(db){
await db.exec(`insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into profiles(user_id,username,group_name) values ('00000000-0000-0000-0000-000000000001','audit-user','Audit');
insert into codex_admins(user_id,role) values('00000000-0000-0000-0000-000000000002','admin');
insert into codex_account_snapshots(account_id,label,status,observed_at,rate_limits) values('audit','Audit','ready',now(),jsonb_build_object('codex',jsonb_build_object('primary',jsonb_build_object('usedPercent',90,'windowDurationMins',300,'resetsAt',extract(epoch from now()+interval '5 hours')),'secondary',jsonb_build_object('usedPercent',20,'windowDurationMins',10080,'resetsAt',extract(epoch from now()+interval '7 days')))));
select set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);`);
}
const day=`((date_trunc('day',now() at time zone 'America/Sao_Paulo')+interval '1 day') at time zone 'America/Sao_Paulo')`;
export async function before(db){await fixtures(db);
const r=await db.query(`select * from codex_request_reservation('audit',${day}+interval '8 hours',5,100)`);
await db.exec(`select set_config('request.jwt.claim.role','service_role',false); update codex_reservations set approval_status='rejected' where id='${r.rows[0].id}'`);
let rejected=false;try{await db.query(`select * from codex_request_reservation('audit',${day}+interval '8 hours',5,100)`)}catch(e){rejected=e.code==='23P01'; console.log('REPRODUCED: rejected booking still blocks replacement:',e.code)}assert.equal(rejected,true);
await db.exec(`delete from codex_reservations;select set_config('request.jwt.claim.role','authenticated',false);`);
}
export async function after(db){
let passed=0;const check=(label,condition)=>{assert.ok(condition,label);console.log('PASS '+label);passed++};
const rows=[];
for(const hour of [4,9,14,19]) rows.push((await db.query(`select * from codex_request_reservation('audit',${day}+interval '${hour} hours',5,100)`)).rows[0]);
check('four adjacent bookings are accepted, including midnight',rows.length===4);
let blocked=false;try{await db.query(`select * from codex_request_reservation('audit',${day}+interval '9 hours',5,100)`)}catch(e){blocked=true}check('genuine duplicate remains blocked',blocked);
check('seconds cannot masquerade as fixed boundaries',(await db.query(`select codex_private.is_fixed_slot(${day}+interval '4 hours 1 second',${day}+interval '9 hours 1 second') as valid`)).rows[0].valid===false);
check('old 08–13 slot is rejected',(await db.query(`select codex_private.is_fixed_slot(${day}+interval '8 hours',${day}+interval '13 hours') as valid`)).rows[0].valid===false);
await db.exec(`select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false)`);
for (const r of rows) {const approved=(await db.query(`select * from codex_approve_reservation($1,$2,$3,null,null)`,[r.id,r.starts_at,r.ends_at])).rows[0];check('approval uses configured weekly 10% budget',Number(approved.quota_budget_percent)===10);}
let capacity=(await db.query(`select * from codex_private.account_quota_capacity('audit')`)).rows[0];check('weekly capacity ignores five-hour 90% usage',Number(capacity.available_percent)===40);

await db.exec(`insert into codex_device_snapshots(device_id,label,reservation_id,account_id,quota_consumed_percent,account_window_duration_mins,created_at,expires_at,status,fingerprint) values('audit-device','Audit','${rows[1].id}','audit',3,10080,now(),now()+interval '1 hour','revoked','synthetic');`);
capacity=(await db.query(`select * from codex_private.account_quota_capacity('audit')`)).rows[0];check('capacity retains persisted consumption of revoked credentials',Number(capacity.committed_percent)===37);
await db.exec(`select set_config('request.jwt.claim.role','service_role',false);
-- A synthetic due fixture isolates queue behavior from the wall-clock slot gap.
alter table codex_reservations disable trigger enforce_reservation_integrity_trg;
alter table codex_reservations disable trigger z_enforce_weekly_capacity;
update codex_reservations set starts_at=now()-interval '1 minute',ends_at=now()+interval '5 minutes' where id='${rows[1].id}';
alter table codex_reservations enable trigger enforce_reservation_integrity_trg;
alter table codex_reservations enable trigger z_enforce_weekly_capacity;`);
const jobs=(await db.query('select * from codex_claim_session_starts()')).rows;
check('due approved booking is claimed once',jobs.length===1 && (await db.query('select * from codex_claim_session_starts()')).rows.length===0);
check('stale claim token cannot submit',(await db.query(`select codex_update_session_start($1,'00000000-0000-0000-0000-000000000099','submitting',null) as ok`,[jobs[0].reservation_id])).rows[0].ok===false);
for(const status of ['submitting','submitted','completed']) check('startup persists '+status,(await db.query('select codex_update_session_start($1,$2,$3,null) as ok',[jobs[0].reservation_id,jobs[0].claim_token,status])).rows[0].ok===true);
check('completed startup is never reclaimed',(await db.query('select * from codex_claim_session_starts()')).rows.length===0);
await db.exec(`select set_config('request.jwt.claim.role','authenticated',false)`);

await db.exec(`update codex_reservations set approval_status='rejected' where id='${rows[0].id}'`);
await db.exec(`select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false)`);
const replacement=(await db.query(`select * from codex_request_reservation('audit',${day}+interval '4 hours',5,100)`)).rows[0];check('rejected reservation no longer occupies its slot',Boolean(replacement));
check('busy slots reconciled',(await db.query(`select count(*)::int n from codex_busy_slots`)).rows[0].n===4);
let denied=false;try{await db.exec(`update codex_reservations set quota_budget_percent=100 where id='${replacement.id}'`)}catch(e){denied=true}check('nonadmin cannot change quota',denied);
await db.exec(`set role authenticated`);
let queueDenied=false;try{await db.query('select * from codex_claim_session_starts()')}catch(e){queueDenied=e.code==='42501'}check('authenticated database role cannot claim startup jobs',queueDenied);
await db.exec('reset role');
await db.exec(`select set_config('request.jwt.claim.role','service_role',false);update codex_app_settings set auto_approve_quota_percent=10;update codex_account_snapshots set rate_limits='{}';`);
let missing=false;try{await db.query(`select * from codex_request_reservation('audit',${day}+interval '2 days 4 hours',5,100)`)}catch(e){missing=true}check('autoapproval fails safely without weekly telemetry',missing);
console.log(`SQL operational checks passed: ${passed}`);
}
