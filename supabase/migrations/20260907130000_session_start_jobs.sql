-- Host-only durable startup queue. No browser or user credential can claim jobs.
create table if not exists public.codex_session_starts (
 reservation_id uuid primary key references public.codex_reservations(id) on delete cascade,
 status text not null check(status in ('claimed','retry','submitting','submitted','completed','uncertain')),
 claim_token uuid not null,
 attempts integer not null default 1,
 updated_at timestamptz not null default now(),
 detail text
);
alter table public.codex_session_starts enable row level security;
revoke all on public.codex_session_starts from public,anon,authenticated;
grant select on public.codex_session_starts to service_role;

create or replace function public.codex_claim_session_starts()
returns table(reservation_id uuid, account_id text, ends_at timestamptz, claim_token uuid, enabled_models jsonb)
language plpgsql security definer set search_path='' as $$
begin
 return query
 with candidates as (
   select r.id from public.codex_reservations r
   left join public.codex_session_starts j on j.reservation_id=r.id
   where r.status='scheduled' and r.approval_status='approved'
     and r.starts_at<=now() and r.ends_at>now()
     and (j.reservation_id is null or (j.status in ('claimed','retry') and j.updated_at<now()-interval '2 minutes' and j.attempts<5))
   order by r.starts_at limit 16 for update of r skip locked
 ), claimed as (
   insert into public.codex_session_starts as j (reservation_id,status,claim_token)
   select id,'claimed',gen_random_uuid() from candidates
   on conflict on constraint codex_session_starts_pkey do update set status='claimed',claim_token=excluded.claim_token,attempts=j.attempts+1,updated_at=now()
   returning j.reservation_id,j.claim_token
 ) select r.id,r.account_id,r.ends_at,j.claim_token,s.enabled_models
 from claimed j join public.codex_reservations r on r.id=j.reservation_id
 cross join public.codex_app_settings s where s.singleton;
end; $$;

create or replace function public.codex_update_session_start(p_id uuid,p_token uuid,p_status text,p_detail text)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 if p_status not in ('retry','submitting','submitted','completed','uncertain') then raise exception 'Invalid startup status'; end if;
 update public.codex_session_starts j set status=p_status,detail=left(p_detail,500),updated_at=now()
 where j.reservation_id=p_id and j.claim_token=p_token
   and (p_status<>'submitting' or exists(select 1 from public.codex_reservations r where r.id=p_id and r.status='scheduled' and r.approval_status='approved' and r.starts_at<=now() and r.ends_at>now()))
   and ((j.status='claimed' and p_status in ('retry','submitting'))
     or (j.status='submitting' and p_status in ('submitted','uncertain'))
     or (j.status='submitted' and p_status in ('completed','uncertain')));
 get diagnostics changed=row_count;
 return changed=1;
end; $$;
revoke all on function public.codex_claim_session_starts() from public,anon,authenticated;
revoke all on function public.codex_update_session_start(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.codex_claim_session_starts() to service_role;
grant execute on function public.codex_update_session_start(uuid,uuid,text,text) to service_role;
do $$ declare role_name text; begin
 foreach role_name in array array['fecart_app','fecart-relay','fecart-host'] loop
  if exists(select 1 from pg_roles where rolname=role_name) then
   execute format('grant execute on function public.codex_claim_session_starts() to %I',role_name);
   execute format('grant execute on function public.codex_update_session_start(uuid,uuid,text,text) to %I',role_name);
   execute format('grant select on public.codex_session_starts to %I',role_name);
  end if;
 end loop;
end $$;
