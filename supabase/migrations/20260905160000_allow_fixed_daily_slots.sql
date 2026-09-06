-- 20260905160000_allow_fixed_daily_slots.sql
-- Allow the 4 fixed daily sessions defined for the product:
-- 1. 08:00 - 09:00 (1 hour)
-- 2. 09:00 - 14:00 (5 hours)
-- 3. 14:00 - 19:00 (5 hours)
-- 4. 19:00 - 00:00 (5 hours)
-- All evaluated in America/Sao_Paulo timezone.

create or replace function codex_private.is_fixed_slot(p_starts_at timestamptz, p_ends_at timestamptz)
returns boolean
language sql
stable
security definer
as $$
  select (
    (extract(hour from p_starts_at at time zone 'America/Sao_Paulo') = 8 and extract(minute from p_starts_at at time zone 'America/Sao_Paulo') = 0 and p_ends_at - p_starts_at = interval '1 hour') or
    (extract(hour from p_starts_at at time zone 'America/Sao_Paulo') = 9 and extract(minute from p_starts_at at time zone 'America/Sao_Paulo') = 0 and p_ends_at - p_starts_at = interval '5 hours') or
    (extract(hour from p_starts_at at time zone 'America/Sao_Paulo') = 14 and extract(minute from p_starts_at at time zone 'America/Sao_Paulo') = 0 and p_ends_at - p_starts_at = interval '5 hours') or
    (extract(hour from p_starts_at at time zone 'America/Sao_Paulo') = 19 and extract(minute from p_starts_at at time zone 'America/Sao_Paulo') = 0 and p_ends_at - p_starts_at = interval '5 hours')
  );
$$;

revoke all on function codex_private.is_fixed_slot(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function codex_private.is_fixed_slot(timestamptz, timestamptz) to service_role;

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
  reset_at timestamptz := codex_private.five_hour_reset(p_account_id);
  active boolean := codex_private.is_account_window_active(p_account_id);
  starts_now boolean := p_starts_at between now() - interval '1 minute' and now() + interval '1 minute';
begin
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    return false;
  end if;

  -- 0. The 4 fixed daily sessions defined by the project
  if codex_private.is_fixed_slot(p_starts_at, p_ends_at) then
    return true;
  end if;

  -- 1. Full 5-hour session starting now on an idle account
  if not active and starts_now and p_ends_at - p_starts_at = interval '5 hours' then
    return true;
  end if;

  -- 2. Full 5-hour session on an aligned 5-hour reset boundary
  if p_ends_at - p_starts_at = interval '5 hours' and codex_private.is_five_hour_boundary(p_account_id, p_starts_at) then
    return true;
  end if;

  -- 3. Remaining partial session within an active window
  if active and starts_now and reset_at is not null
     and pg_catalog.abs(extract(epoch from (p_ends_at - reset_at))) <= 60
     and p_starts_at >= reset_at - interval '5 hours' and p_starts_at < reset_at
     and p_ends_at - p_starts_at >= interval '5 minutes' then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function codex_private.valid_five_hour_session(text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function codex_private.valid_five_hour_session(text, timestamptz, timestamptz) to service_role;

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
  reset_at timestamptz := codex_private.five_hour_reset(p_account_id);
  active boolean := codex_private.is_account_window_active(p_account_id);
  starts_now boolean := p_starts_at between now() - interval '1 minute' and now() + interval '1 minute';
  ends_at_val timestamptz;
  default_budget integer;
begin
  if requester is null then
    raise exception 'Autenticação necessária.' using errcode = '42501';
  end if;
  if p_duration_hours not in (1, 5) then
    raise exception 'A duração deve ser de 1 hora (08:00) ou 5 horas.' using errcode = '22023';
  end if;
  if p_starts_at < now() - interval '1 minute' then
    raise exception 'Não é possível agendar um horário passado.' using errcode = '22023';
  end if;

  ends_at_val := p_starts_at + pg_catalog.make_interval(hours => p_duration_hours);

  if codex_private.is_fixed_slot(p_starts_at, ends_at_val) then
    -- valid fixed slot!
  elsif not active and starts_now then
    ends_at_val := p_starts_at + interval '5 hours';
  elsif codex_private.is_five_hour_boundary(p_account_id, p_starts_at) then
    ends_at_val := p_starts_at + interval '5 hours';
  elsif active and starts_now
      and reset_at is not null
      and p_starts_at < reset_at
      and reset_at - p_starts_at >= interval '5 minutes' then
    ends_at_val := reset_at;
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
      user_id,
      account_id,
      starts_at,
      ends_at,
      status,
      approval_status,
      requested_quota_percent,
      quota_budget_percent,
      reviewed_at,
      review_note
    )
    values (
      requester,
      p_account_id,
      p_starts_at,
      ends_at_val,
      'scheduled',
      approval,
      coalesce(p_requested_quota_percent, 100),
      case when approval = 'approved' then default_budget else null end,
      case when approval = 'approved' then now() else null end,
      case when approval = 'approved' then 'Aprovado automaticamente pela política geral.' else null end
    )
    returning *;
end;
$$;

revoke all on function public.codex_request_reservation(text, timestamptz, integer, integer) from public, anon;
grant execute on function public.codex_request_reservation(text, timestamptz, integer, integer) to authenticated, service_role;
