-- Configurable session weekly quota budget and resilient approval with partial capacity support

alter table public.codex_app_settings
  add column if not exists session_weekly_quota_percent integer not null default 10
  check (session_weekly_quota_percent between 1 and 100);

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
set search_path = public, codex_private
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
      from pg_catalog.jsonb_each(coalesce(account.rate_limits, '{}'::jsonb)) limit_entry
      cross join lateral pg_catalog.jsonb_array_elements(
        pg_catalog.jsonb_build_array(limit_entry.value -> 'primary', limit_entry.value -> 'secondary')
      ) candidate(value)
      where candidate.value is not null and candidate.value <> 'null'::jsonb
      order by coalesce((candidate.value ->> 'windowDurationMins')::numeric, 0) desc
      limit 1
    ) quota_window
    where account.account_id = target_account_id
      and account.status = 'ready'
    order by account.observed_at desc
    limit 1
  ), commitments as (
    select coalesce(sum(greatest(0::numeric,
      coalesce(reservation.quota_budget_percent, 10)::numeric -
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
    coalesce(account_window.used_percent, 0::numeric),
    coalesce(commitments.committed_percent, 0::numeric),
    greatest(0::numeric, 100 - coalesce(account_window.used_percent, 0::numeric) - coalesce(commitments.committed_percent, 0::numeric)),
    coalesce(account_window.resets_at, now() + interval '7 days')
  from (select 1) dummy
  left join account_window on true
  left join commitments on true;
$$;

revoke all on function codex_private.account_quota_capacity(text, uuid) from public, anon, authenticated;
grant execute on function codex_private.account_quota_capacity(text, uuid) to service_role;

create or replace function codex_private.five_hour_reset(p_account_id text)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.to_timestamp((candidate.window_data ->> 'resetsAt')::double precision)
  from public.codex_account_snapshots snapshot
  cross join lateral pg_catalog.jsonb_each(coalesce(snapshot.rate_limits, '{}'::jsonb)) rate_limit
  cross join lateral (
    values (rate_limit.value -> 'primary'), (rate_limit.value -> 'secondary')
  ) candidate(window_data)
  where snapshot.account_id = p_account_id
    and snapshot.status = 'ready'
    and (candidate.window_data ->> 'windowDurationMins')::integer = 300
    and coalesce((candidate.window_data ->> 'resetsAt')::numeric, 0) > 0
  order by snapshot.observed_at desc
  limit 1;
$$;

create or replace function codex_private.is_account_window_active(p_account_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select
      coalesce((candidate.window_data ->> 'usedPercent')::numeric, 0) as used_pct,
      pg_catalog.to_timestamp((candidate.window_data ->> 'resetsAt')::double precision) as reset_ts
    from public.codex_account_snapshots snapshot
    cross join lateral pg_catalog.jsonb_each(coalesce(snapshot.rate_limits, '{}'::jsonb)) rate_limit
    cross join lateral (
      values (rate_limit.value -> 'primary'), (rate_limit.value -> 'secondary')
    ) candidate(window_data)
    where snapshot.account_id = p_account_id
      and snapshot.status = 'ready'
      and (candidate.window_data ->> 'windowDurationMins')::integer = 300
      and coalesce((candidate.window_data ->> 'resetsAt')::numeric, 0) > 0
    order by snapshot.observed_at desc
    limit 1
  )
  select coalesce(latest.reset_ts > now() and (latest.used_pct > 0 or exists (
    select 1 from public.codex_reservations r
    where r.account_id = p_account_id
      and r.status = 'scheduled'
      and r.approval_status = 'approved'
      and r.starts_at <= now()
      and r.ends_at > now()
  )), false)
  from (select 1) dummy
  left join latest on true;
$$;

create or replace function codex_private.is_five_hour_boundary(
  p_account_id text,
  p_starts_at timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  reset_at timestamptz := codex_private.five_hour_reset(p_account_id);
  offset_seconds numeric;
begin
  if reset_at is null or p_starts_at is null then
    return false;
  end if;
  offset_seconds := extract(epoch from (p_starts_at - reset_at));
  return pg_catalog.abs(offset_seconds - pg_catalog.round(offset_seconds / 18000) * 18000) <= 60;
end;
$$;

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

  -- 1. Full 5-hour session starting now on an idle account
  if not active and starts_now and p_ends_at - p_starts_at = interval '5 hours' then
    return true;
  end if;

  -- 2. Full 5-hour session on an aligned 5-hour reset boundary
  if p_ends_at - p_starts_at = interval '5 hours' and codex_private.is_five_hour_boundary(p_account_id, p_starts_at) then
    return true;
  end if;

  -- 3. Remaining partial session within an active window
  if active and starts_now and reset_at is not null and p_ends_at = reset_at
     and p_starts_at >= reset_at - interval '5 hours' and p_starts_at < reset_at
     and p_ends_at - p_starts_at >= interval '5 minutes' then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function codex_private.five_hour_reset(text) from public, anon, authenticated;
revoke all on function codex_private.is_account_window_active(text) from public, anon, authenticated;
revoke all on function codex_private.is_five_hour_boundary(text, timestamptz) from public, anon, authenticated;
revoke all on function codex_private.valid_five_hour_session(text, timestamptz, timestamptz) from public, anon, authenticated;

grant execute on function codex_private.five_hour_reset(text) to service_role;
grant execute on function codex_private.is_account_window_active(text) to service_role;
grant execute on function codex_private.is_five_hour_boundary(text, timestamptz) to service_role;
grant execute on function codex_private.valid_five_hour_session(text, timestamptz, timestamptz) to service_role;

create or replace function public.enforce_reservation_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, codex_private
as $$
declare
  is_admin boolean;
  default_budget integer;
begin
  select (
    coalesce(auth.role(), '') in ('service_role', 'supabase_admin') or
    exists (
      select 1
      from public.codex_admins
      where user_id = (select auth.uid()) and enabled = true
    )
  ) into is_admin;

  if TG_OP = 'INSERT' then
    if not codex_private.valid_five_hour_session(new.account_id, new.starts_at, new.ends_at) then
      raise exception 'A sessão deve ocupar um ciclo completo ou terminar no reset atual';
    end if;
    if not is_admin and (new.ends_at <= now() or new.starts_at < now() - interval '1 minute') then
      raise exception 'Não é possível agendar horários passados';
    end if;
    if not is_admin and new.approval_status is null then
      new.approval_status := 'pending';
      new.quota_budget_percent := null;
      new.reviewed_at := null;
      new.reviewed_by := null;
      new.review_note := null;
    end if;
    new.requested_quota_percent := 100;
    if new.approval_status = 'approved' and new.quota_budget_percent is null then
      select coalesce(session_weekly_quota_percent, 10) into default_budget from public.codex_app_settings where singleton = true;
      new.quota_budget_percent := coalesce(default_budget, 10);
    end if;
  end if;

  if TG_OP = 'UPDATE' then
    if not is_admin and (
      new.approval_status is distinct from old.approval_status or
      new.quota_budget_percent is distinct from old.quota_budget_percent or
      new.requested_quota_percent is distinct from old.requested_quota_percent or
      new.reviewed_at is distinct from old.reviewed_at or
      new.reviewed_by is distinct from old.reviewed_by or
      new.review_note is distinct from old.review_note or
      new.user_id is distinct from old.user_id or
      new.account_id is distinct from old.account_id or
      new.starts_at is distinct from old.starts_at or
      new.ends_at is distinct from old.ends_at
    ) then
      raise exception 'Somente administradores podem aprovar ou alterar parâmetros da reserva.';
    end if;
    if not is_admin and new.device_id is distinct from old.device_id and not (
      old.device_id is null and
      new.device_id is not null and
      pg_catalog.btrim(new.device_id) <> '' and
      old.approval_status = 'approved' and
      new.approval_status = 'approved' and
      old.status = 'scheduled' and
      new.status = 'scheduled' and
      new.user_id = (select auth.uid()) and
      new.starts_at <= now() + interval '1 minute' and
      new.ends_at > now() and
      old.activated_at is null and
      new.activated_at between now() - interval '1 minute' and now() + interval '1 minute'
    ) then
      raise exception 'A credencial só pode ser vinculada uma vez durante uma reserva aprovada e ativa.';
    end if;
    if (new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at)
       and not codex_private.valid_five_hour_session(new.account_id, new.starts_at, new.ends_at) then
      raise exception 'A sessão deve ocupar um ciclo completo ou terminar no reset atual';
    end if;
    if old.approval_status = 'pending' and new.approval_status = 'approved' and new.ends_at <= now() then
      raise exception 'Não é permitido aprovar uma solicitação cujo horário já expirou.';
    end if;
    if old.approval_status = 'pending' and new.approval_status = 'approved' and new.quota_budget_percent is null then
      select coalesce(session_weekly_quota_percent, 10) into default_budget from public.codex_app_settings where singleton = true;
      new.requested_quota_percent := 100;
      new.quota_budget_percent := coalesce(default_budget, 10);
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_reservation_integrity() from public, anon, authenticated;

create or replace function public.codex_approve_reservation(
  p_reservation_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_quota_budget_percent integer default null,
  p_note text default null
)
returns setof public.codex_reservations
language plpgsql
security definer
set search_path = public, codex_private
as $$
declare
  reviewer uuid := (select auth.uid());
  reservation public.codex_reservations%rowtype;
  settings public.codex_app_settings%rowtype;
  capacity record;
  desired_budget integer;
  granted_budget integer;
  final_note text;
begin
  if (reviewer is null or not exists (select 1 from public.codex_admins where user_id = reviewer and enabled = true))
     and coalesce(auth.role(), '') not in ('service_role', 'supabase_admin') then
    raise exception 'Acesso administrativo necessário.' using errcode = '42501';
  end if;
  select * into reservation from public.codex_reservations where id = p_reservation_id for update;
  if reservation.id is null or reservation.status <> 'scheduled' or reservation.approval_status <> 'pending' then
    raise exception 'A solicitação já foi revisada ou não está mais disponível.' using errcode = 'P0001';
  end if;
  if p_ends_at <= now() or not codex_private.valid_five_hour_session(reservation.account_id, p_starts_at, p_ends_at) then
    raise exception 'O período deve ocupar um ciclo completo ou terminar no reset atual.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.codex_account_snapshots where account_id = reservation.account_id and status = 'ready') then
    raise exception 'Essa conta não está pronta para receber agendamentos.' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(reservation.account_id, 0));
  if exists (
    select 1 from public.codex_reservations other
    where other.account_id = reservation.account_id
      and other.id <> reservation.id
      and other.status = 'scheduled'
      and other.approval_status in ('pending', 'approved')
      and other.starts_at < p_ends_at
      and other.ends_at > p_starts_at
  ) then
    raise exception 'Esse horário já está reservado.' using errcode = 'P0001';
  end if;

  select * into settings from public.codex_app_settings where singleton = true;
  desired_budget := coalesce(p_quota_budget_percent, settings.session_weekly_quota_percent, 10);
  if desired_budget < 1 or desired_budget > 100 then
    desired_budget := 10;
  end if;

  select * into capacity from codex_private.account_quota_capacity(reservation.account_id, reservation.id);
  if capacity.available_percent is not null and capacity.available_percent <= 0 then
    raise exception 'Cota semanal insuficiente: a conta não possui limite semanal disponível para novas aprovações nesta semana.' using errcode = 'P0001';
  end if;

  if capacity.available_percent is not null and capacity.available_percent < desired_budget then
    granted_budget := greatest(1, floor(capacity.available_percent)::integer);
    final_note := coalesce(nullif(pg_catalog.btrim(p_note), ''), 'Aprovado com cota ajustada para ' || granted_budget || '% (restante disponível da conta nesta semana).');
    if p_note is not null and pg_catalog.btrim(p_note) <> '' and position('restante disponível' in p_note) = 0 then
      final_note := pg_catalog.left(pg_catalog.btrim(p_note) || ' [Cota ajustada: ' || granted_budget || '%]', 500);
    end if;
  else
    granted_budget := desired_budget;
    final_note := nullif(pg_catalog.left(pg_catalog.btrim(p_note), 500), '');
  end if;

  return query
    update public.codex_reservations set
      approval_status = 'approved', reviewed_by = reviewer, reviewed_at = now(),
      review_note = final_note,
      starts_at = p_starts_at, ends_at = p_ends_at,
      requested_quota_percent = 100,
      quota_budget_percent = granted_budget
    where id = reservation.id
    returning *;
end;
$$;

revoke all on function public.codex_approve_reservation(uuid, timestamptz, timestamptz, integer, text) from public, anon;
grant execute on function public.codex_approve_reservation(uuid, timestamptz, timestamptz, integer, text) to authenticated, service_role;

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
  if p_duration_hours <> 5 or p_requested_quota_percent <> 100 then
    raise exception 'Cada sessão usa a quota disponível de uma janela de cinco horas.' using errcode = '22023';
  end if;
  if p_starts_at < now() - interval '1 minute' then
    raise exception 'Não é possível agendar um horário passado.' using errcode = '22023';
  end if;

  if not active and starts_now then
    ends_at_val := p_starts_at + interval '5 hours';
  elsif codex_private.is_five_hour_boundary(p_account_id, p_starts_at) then
    ends_at_val := p_starts_at + interval '5 hours';
  elsif active and starts_now
      and reset_at is not null
      and p_starts_at < reset_at
      and reset_at - p_starts_at >= interval '5 minutes' then
    ends_at_val := reset_at;
  else
    raise exception 'Escolha agora ou o início de um novo ciclo de 5 horas.' using errcode = '22023';
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
    ) values (
      requester,
      p_account_id,
      p_starts_at,
      ends_at_val,
      'scheduled',
      approval,
      100,
      case when approval = 'approved' then default_budget else null end,
      case when approval = 'approved' then now() else null end,
      case when approval = 'approved' then 'Aprovado automaticamente pela política geral.' else null end
    ) returning *;
end;
$$;

revoke all on function public.codex_request_reservation(text, timestamptz, integer, integer) from public, anon;
grant execute on function public.codex_request_reservation(text, timestamptz, integer, integer) to authenticated, service_role;
