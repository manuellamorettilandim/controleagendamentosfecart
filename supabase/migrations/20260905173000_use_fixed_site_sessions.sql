-- Make the site's four fixed sessions authoritative for scheduling.
-- Provider resetAt/usedPercent values are observability data only; they must
-- not move the end of a reservation or make the next fixed session busy.

create or replace function codex_private.is_fixed_slot(p_starts_at timestamptz, p_ends_at timestamptz)
returns boolean
language sql
stable
security definer
as $$
  select (
    (extract(hour from p_starts_at at time zone 'America/Sao_Paulo') = 8 and extract(minute from p_starts_at at time zone 'America/Sao_Paulo') = 0 and p_ends_at - p_starts_at = interval '5 hours') or
    (extract(hour from p_starts_at at time zone 'America/Sao_Paulo') = 9 and extract(minute from p_starts_at at time zone 'America/Sao_Paulo') = 0 and p_ends_at - p_starts_at = interval '5 hours') or
    (extract(hour from p_starts_at at time zone 'America/Sao_Paulo') = 14 and extract(minute from p_starts_at at time zone 'America/Sao_Paulo') = 0 and p_ends_at - p_starts_at = interval '5 hours') or
    (extract(hour from p_starts_at at time zone 'America/Sao_Paulo') = 19 and extract(minute from p_starts_at at time zone 'America/Sao_Paulo') = 0 and p_ends_at - p_starts_at = interval '5 hours')
  );
$$;

create or replace function codex_private.fixed_slot_end(p_starts_at timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  with local_value as (
    select p_starts_at at time zone 'America/Sao_Paulo' as local_at
  )
  select case
    when extract(hour from local_at) = 8
      then ((pg_catalog.date_trunc('day', local_at) + interval '13 hours') at time zone 'America/Sao_Paulo')
    when extract(hour from local_at) >= 9
      and extract(hour from local_at) < 14
      then ((pg_catalog.date_trunc('day', local_at) + interval '14 hours') at time zone 'America/Sao_Paulo')
    when extract(hour from local_at) >= 14
      and extract(hour from local_at) < 19
      then ((pg_catalog.date_trunc('day', local_at) + interval '19 hours') at time zone 'America/Sao_Paulo')
    when extract(hour from local_at) >= 19
      and extract(hour from local_at) < 24
      then ((pg_catalog.date_trunc('day', local_at) + interval '1 day') at time zone 'America/Sao_Paulo')
    else null
  end
  from local_value;
$$;

revoke all on function codex_private.fixed_slot_end(timestamptz) from public;
do $grant_fixed_slot_end$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname in ('anon', 'authenticated')) then
    execute 'revoke all on function codex_private.fixed_slot_end(timestamptz) from anon, authenticated';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    execute 'grant execute on function codex_private.fixed_slot_end(timestamptz) to service_role';
  end if;
end;
$grant_fixed_slot_end$;

create or replace function codex_private.valid_five_hour_session(
  p_account_id text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  fixed_slot_end_at timestamptz := codex_private.fixed_slot_end(p_starts_at);
  starts_now boolean := p_starts_at between now() - interval '1 minute' and now() + interval '1 minute';
begin
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    return false;
  end if;

  if codex_private.is_fixed_slot(p_starts_at, p_ends_at) then
    return true;
  end if;

  -- An immediate reservation ends at the site's current fixed boundary,
  -- regardless of the provider's sliding reset timestamp.
  if starts_now
     and fixed_slot_end_at is not null
     and abs(extract(epoch from (p_ends_at - fixed_slot_end_at))) <= 60
     and p_ends_at - p_starts_at >= interval '5 minutes' then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function codex_private.valid_five_hour_session(text, timestamptz, timestamptz) from public;
do $grant_fixed_session_validator$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname in ('anon', 'authenticated')) then
    execute 'revoke all on function codex_private.valid_five_hour_session(text, timestamptz, timestamptz) from anon, authenticated';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    execute 'grant execute on function codex_private.valid_five_hour_session(text, timestamptz, timestamptz) to service_role';
  end if;
end;
$grant_fixed_session_validator$;

create or replace function public.codex_request_reservation(
  p_account_id text,
  p_starts_at timestamptz,
  p_duration_hours integer,
  p_requested_quota_percent integer
)
returns setof public.codex_reservations
language plpgsql
security definer
set search_path = public, codex_private
as $$
declare
  requester uuid := (select auth.uid());
  settings public.codex_app_settings%rowtype;
  approval text;
  fixed_slot_end_at timestamptz := codex_private.fixed_slot_end(p_starts_at);
  slot_duration_hours integer := case
    when extract(hour from p_starts_at at time zone 'America/Sao_Paulo') = 8 then 5
    when extract(hour from p_starts_at at time zone 'America/Sao_Paulo') >= 9
      and extract(hour from p_starts_at at time zone 'America/Sao_Paulo') < 24 then 5
    else null
  end;
  starts_now boolean := p_starts_at between now() - interval '1 minute' and now() + interval '1 minute';
  ends_at_val timestamptz;
  default_budget integer;
begin
  if requester is null then
    raise exception 'Autenticação necessária.' using errcode = '42501';
  end if;
  if p_duration_hours <> 5 then
    raise exception 'Cada sessão deve ter duração de 5 horas.' using errcode = '22023';
  end if;
  if p_starts_at < now() - interval '1 minute' then
    raise exception 'Não é possível agendar um horário passado.' using errcode = '22023';
  end if;

  ends_at_val := p_starts_at + pg_catalog.make_interval(hours => p_duration_hours);

  if codex_private.is_fixed_slot(p_starts_at, ends_at_val) then
    -- One of the four exact fixed sessions.
    null;
  elsif starts_now
      and fixed_slot_end_at is not null
      and p_duration_hours = slot_duration_hours
      and fixed_slot_end_at - p_starts_at >= interval '5 minutes' then
    -- Immediate start: always stop at the current site's fixed boundary.
    ends_at_val := fixed_slot_end_at;
  else
    raise exception 'Escolha uma das 4 sessões fixas (08:00, 09:00, 14:00 ou 19:00) ou início imediato.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles
    where user_id = requester
      and enabled = true
      and coalesce(scheduling_enabled, true) = true
  ) then
    raise exception 'Os agendamentos deste grupo estão bloqueados pelo administrador.' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.codex_account_snapshots
    where account_id = p_account_id and status = 'ready'
  ) then
    raise exception 'Essa conta não está pronta para receber agendamentos.' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_account_id, 0));
  if exists (
    select 1
    from public.codex_reservations
    where account_id = p_account_id
      and status = 'scheduled'
      and approval_status in ('pending', 'approved')
      and starts_at < ends_at_val
      and ends_at > p_starts_at
  ) then
    raise exception 'Esse horário já está reservado.' using errcode = 'P0001';
  end if;

  select * into settings from public.codex_app_settings where singleton = true;
  approval := case when coalesce(settings.auto_approve_quota_percent, 0) > 0 then 'approved' else 'pending' end;
  default_budget := coalesce(settings.session_weekly_quota_percent, 10);

  return query
    insert into public.codex_reservations (
      user_id, account_id, starts_at, ends_at, status, approval_status,
      requested_quota_percent, quota_budget_percent, reviewed_at, review_note
    )
    values (
      requester, p_account_id, p_starts_at, ends_at_val, 'scheduled', approval,
      coalesce(p_requested_quota_percent, 100),
      case when approval = 'approved' then default_budget else null end,
      case when approval = 'approved' then now() else null end,
      case when approval = 'approved' then 'Aprovado automaticamente pela política geral.' else null end
    )
    returning *;
end;
$$;

revoke all on function public.codex_request_reservation(text, timestamptz, integer, integer) from public;
do $grant_reservation_rpc$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.codex_request_reservation(text, timestamptz, integer, integer) from anon';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname in ('authenticated', 'service_role')) then
    execute 'grant execute on function public.codex_request_reservation(text, timestamptz, integer, integer) to authenticated, service_role';
  end if;
end;
$grant_reservation_rpc$;
