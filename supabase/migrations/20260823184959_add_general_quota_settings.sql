create table public.codex_app_settings (
  singleton boolean primary key default true check (singleton),
  max_request_quota_percent integer not null default 20
    check (max_request_quota_percent between 5 and 100 and max_request_quota_percent % 5 = 0),
  auto_approve_quota_percent integer not null default 0
    check (auto_approve_quota_percent between 0 and 100 and auto_approve_quota_percent % 5 = 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  check (auto_approve_quota_percent <= max_request_quota_percent)
);

insert into public.codex_app_settings (singleton) values (true);

alter table public.codex_app_settings enable row level security;
revoke all on table public.codex_app_settings from public, anon, authenticated;
grant select, update on table public.codex_app_settings to authenticated;
grant all on table public.codex_app_settings to service_role;

create policy codex_app_settings_read
  on public.codex_app_settings for select
  to authenticated
  using (true);

create policy codex_app_settings_update_admin
  on public.codex_app_settings for update
  to authenticated
  using ((select public.codex_is_admin()))
  with check ((select public.codex_is_admin()));

create or replace function codex_private.account_quota_capacity(
  target_account_id text,
  excluded_reservation_id uuid default null
)
returns table (
  used_percent numeric,
  committed_percent numeric,
  available_percent numeric,
  resets_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with account_window as (
    select
      greatest(0::numeric, least(100::numeric, coalesce((quota_window.value ->> 'usedPercent')::numeric, 0))) as used_percent,
      case
        when coalesce((quota_window.value ->> 'resetsAt')::numeric, 0) > 0
          then pg_catalog.to_timestamp((quota_window.value ->> 'resetsAt')::double precision)
        else now() + interval '7 days'
      end as resets_at
    from public.codex_account_snapshots account
    cross join lateral (
      select candidate.value
      from pg_catalog.jsonb_each(account.rate_limits) limit_entry
      cross join lateral pg_catalog.jsonb_array_elements(
        pg_catalog.jsonb_build_array(limit_entry.value -> 'primary', limit_entry.value -> 'secondary')
      ) candidate(value)
      where candidate.value <> 'null'::jsonb
      order by coalesce((candidate.value ->> 'windowDurationMins')::numeric, 0) desc
      limit 1
    ) quota_window
    where account.account_id = target_account_id
  ), commitments as (
    select coalesce(sum(greatest(0::numeric,
      reservation.quota_budget_percent::numeric -
      case
        when device.account_used_percent is null or device.quota_base_used_percent is null then 0
        when device.account_used_percent >= device.quota_base_used_percent
          then device.account_used_percent - device.quota_base_used_percent
        else device.account_used_percent
      end
    )), 0) as committed_percent
    from public.codex_reservations reservation
    cross join account_window
    left join lateral (
      select snapshot.account_used_percent, snapshot.quota_base_used_percent
      from public.codex_device_snapshots snapshot
      where snapshot.reservation_id = reservation.id
        and snapshot.status in ('reserved', 'running', 'active')
      order by snapshot.created_at desc
      limit 1
    ) device on true
    where reservation.account_id = target_account_id
      and reservation.id is distinct from excluded_reservation_id
      and reservation.status = 'scheduled'
      and reservation.approval_status = 'approved'
      and reservation.ends_at > now()
      and reservation.starts_at < account_window.resets_at
      and reservation.quota_budget_percent is not null
  )
  select
    account_window.used_percent,
    commitments.committed_percent,
    greatest(0::numeric, 100 - account_window.used_percent - commitments.committed_percent),
    account_window.resets_at
  from account_window cross join commitments;
$$;

revoke all on function codex_private.account_quota_capacity(text, uuid) from public, anon, authenticated;
grant execute on function codex_private.account_quota_capacity(text, uuid) to service_role;

create or replace function public.codex_request_reservation(
  p_account_id text,
  p_starts_at timestamptz,
  p_duration_hours integer,
  p_requested_quota_percent integer
)
returns setof public.codex_reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester uuid := (select auth.uid());
  settings public.codex_app_settings%rowtype;
  capacity record;
  approval text;
begin
  if requester is null then raise exception 'Autenticação necessária.' using errcode = '42501'; end if;
  if p_duration_hours not between 1 and 3 then raise exception 'A duração deve ser de uma a três horas.' using errcode = '22023'; end if;
  if p_starts_at < pg_catalog.date_trunc('hour', now()) or p_starts_at <> pg_catalog.date_trunc('hour', p_starts_at) then
    raise exception 'A reserva deve começar no horário atual ou em uma hora cheia futura.' using errcode = '22023';
  end if;

  select * into settings from public.codex_app_settings where singleton = true;
  if p_requested_quota_percent < 5 or p_requested_quota_percent > settings.max_request_quota_percent or p_requested_quota_percent % 5 <> 0 then
    raise exception '%', pg_catalog.format('A cota solicitada deve ser entre 5%% e %s%%, em passos de 5%%.', settings.max_request_quota_percent) using errcode = '22023';
  end if;
  if not exists (select 1 from public.codex_user_profiles where user_id = requester and enabled and scheduling_enabled and account_id = p_account_id) then
    raise exception 'Os agendamentos deste grupo estão bloqueados pelo administrador.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.codex_account_snapshots where account_id = p_account_id and status = 'ready') then
    raise exception 'Essa conta não está pronta para receber agendamentos.' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_account_id, 0));
  select * into capacity from codex_private.account_quota_capacity(p_account_id, null);
  if capacity.available_percent is null or p_requested_quota_percent > capacity.available_percent then
    raise exception 'Cota insuficiente: % disponível, % já comprometida e % solicitada.',
      coalesce(capacity.available_percent, 0) || '%', coalesce(capacity.committed_percent, 0) || '%', p_requested_quota_percent || '%'
      using errcode = 'P0001';
  end if;

  approval := case when settings.auto_approve_quota_percent > 0 and p_requested_quota_percent <= settings.auto_approve_quota_percent then 'approved' else 'pending' end;
  return query
    insert into public.codex_reservations (
      user_id, account_id, starts_at, ends_at, status, approval_status,
      requested_quota_percent, quota_budget_percent, reviewed_at, review_note
    ) values (
      requester, p_account_id, p_starts_at, p_starts_at + pg_catalog.make_interval(hours => p_duration_hours),
      'scheduled', approval, p_requested_quota_percent,
      case when approval = 'approved' then p_requested_quota_percent else null end,
      case when approval = 'approved' then now() else null end,
      case when approval = 'approved' then 'Aprovado automaticamente pela política geral.' else null end
    ) returning *;
end;
$$;

revoke all on function public.codex_request_reservation(text, timestamptz, integer, integer) from public, anon;
grant execute on function public.codex_request_reservation(text, timestamptz, integer, integer) to authenticated, service_role;

create or replace function public.codex_approve_reservation(
  p_reservation_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_quota_budget_percent integer,
  p_note text default null
)
returns setof public.codex_reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  reviewer uuid := (select auth.uid());
  settings public.codex_app_settings%rowtype;
  reservation public.codex_reservations%rowtype;
  capacity record;
begin
  if reviewer is null or not public.codex_is_admin() then raise exception 'Acesso administrativo necessário.' using errcode = '42501'; end if;
  select * into reservation from public.codex_reservations where id = p_reservation_id for update;
  if reservation.id is null or reservation.status <> 'scheduled' or reservation.approval_status <> 'pending' then
    raise exception 'A solicitação já foi revisada ou não está mais disponível.' using errcode = 'P0001';
  end if;
  select * into settings from public.codex_app_settings where singleton = true;
  if p_quota_budget_percent < 5 or p_quota_budget_percent > settings.max_request_quota_percent or p_quota_budget_percent % 5 <> 0 then
    raise exception '%', pg_catalog.format('A cota aprovada deve ser entre 5%% e %s%%, em passos de 5%%.', settings.max_request_quota_percent) using errcode = '22023';
  end if;
  if p_ends_at - p_starts_at < interval '1 hour' or p_ends_at - p_starts_at > interval '3 hours' or p_ends_at <= now() then
    raise exception 'O período aprovado deve ter entre uma e três horas e ainda não pode ter terminado.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.codex_account_snapshots where account_id = reservation.account_id and status = 'ready') then
    raise exception 'Essa conta não está pronta para receber agendamentos.' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(reservation.account_id, 0));
  select * into capacity from codex_private.account_quota_capacity(reservation.account_id, reservation.id);
  if capacity.available_percent is null or p_quota_budget_percent > capacity.available_percent then
    raise exception 'Cota insuficiente: % disponível, % já comprometida e % solicitada para aprovação.',
      coalesce(capacity.available_percent, 0) || '%', coalesce(capacity.committed_percent, 0) || '%', p_quota_budget_percent || '%'
      using errcode = 'P0001';
  end if;

  return query
    update public.codex_reservations set
      approval_status = 'approved', reviewed_by = reviewer, reviewed_at = now(), review_note = nullif(pg_catalog.left(pg_catalog.btrim(p_note), 500), ''),
      starts_at = p_starts_at, ends_at = p_ends_at, quota_budget_percent = p_quota_budget_percent
    where id = reservation.id
    returning *;
end;
$$;

revoke all on function public.codex_approve_reservation(uuid, timestamptz, timestamptz, integer, text) from public, anon;
grant execute on function public.codex_approve_reservation(uuid, timestamptz, timestamptz, integer, text) to authenticated, service_role;
