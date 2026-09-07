-- Apply in one transaction, after the migrations through 20260905190000.
-- Existing reservations are never silently moved. Correct real live overlaps first.
create extension if not exists btree_gist;
lock table public.codex_reservations in access exclusive mode;
-- Provider percentages may be fractional; activation must not fail integer casts.
alter table public.codex_reservations alter column quota_base_used_percent type numeric;
alter table public.codex_device_snapshots alter column quota_base_used_percent type numeric;
alter table public.codex_reservations drop constraint if exists codex_reservations_hour_boundary;
alter table public.codex_reservations drop constraint if exists codex_reservations_duration;
alter table public.codex_reservations drop constraint if exists codex_reservations_no_overlap;
-- Snapshot installations and migration installations used different trigger names.
drop trigger if exists codex_reservation_integrity on public.codex_reservations;
drop trigger if exists codex_reservations_sync_busy_slot on public.codex_reservations;
drop trigger if exists codex_reservations_prevent_overlap on public.codex_reservations;
-- Half-open ranges permit adjacent slots; rejected/expired requests do not occupy space.
alter table public.codex_reservations add constraint codex_reservations_no_overlap
 exclude using gist (account_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
 where (status = 'scheduled' and approval_status in ('pending', 'approved'));
-- Make the site's four fixed sessions authoritative for scheduling.
-- Provider resetAt/usedPercent values are observability data only; they must
-- not move the end of a reservation or make the next fixed session busy.

create or replace function codex_private.is_fixed_slot(p_starts_at timestamptz, p_ends_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select extract(second from p_starts_at) = 0 and (
    (extract(hour from p_starts_at at time zone 'America/Sao_Paulo') = 4 and extract(minute from p_starts_at at time zone 'America/Sao_Paulo') = 0 and p_ends_at - p_starts_at = interval '5 hours') or
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
    when extract(hour from local_at) >= 4 and extract(hour from local_at) < 9
      then ((pg_catalog.date_trunc('day', local_at) + interval '9 hours') at time zone 'America/Sao_Paulo')
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
     and p_ends_at = fixed_slot_end_at
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
    when extract(hour from p_starts_at at time zone 'America/Sao_Paulo') >= 4 and extract(hour from p_starts_at at time zone 'America/Sao_Paulo') < 9 then 5
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
  if p_duration_hours is null or p_duration_hours <> 5 or p_starts_at is null then
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
    raise exception 'Escolha uma das 4 sessões fixas (04:00, 09:00, 14:00 ou 19:00) ou início imediato.' using errcode = '22023';
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
        and (candidate.value ->> 'windowDurationMins')::numeric > 300
        and (candidate.value ->> 'resetsAt')::numeric > extract(epoch from now())
        and candidate.value ->> 'usedPercent' is not null
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
      coalesce(device.quota_consumed_percent, 0)
    )), 0) as committed_percent
    from public.codex_reservations reservation
    cross join account_window
    left join lateral (
      select max(snapshot.quota_consumed_percent) as quota_consumed_percent
      from public.codex_device_snapshots snapshot
      where snapshot.reservation_id = reservation.id
        and snapshot.account_window_duration_mins > 300
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
    case when account_window.resets_at is null then null else greatest(0::numeric, 100 - account_window.used_percent - coalesce(commitments.committed_percent, 0::numeric)) end,
    coalesce(account_window.resets_at, now() + interval '7 days')
  from (select 1) dummy
  left join account_window on true
  left join commitments on true;
$$;

revoke all on function codex_private.account_quota_capacity(text, uuid) from public, anon, authenticated;
grant execute on function codex_private.account_quota_capacity(text, uuid) to service_role;

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
    if not is_admin then
      if new.user_id is distinct from auth.uid() then raise exception 'Reserva de outro usuário.' using errcode='42501'; end if;
      select * into default_budget from (select session_weekly_quota_percent from public.codex_app_settings where singleton) s;
      new.approval_status := case when (select auto_approve_quota_percent > 0 from public.codex_app_settings where singleton) then 'approved' else 'pending' end;
      new.quota_budget_percent := case when new.approval_status = 'approved' then coalesce(default_budget, 10) else null end;
      new.reviewed_by := null;
    end if;
    new.requested_quota_percent := 100;
    if new.approval_status = 'approved' and new.quota_budget_percent is null then
      select coalesce(session_weekly_quota_percent, 10) into default_budget from public.codex_app_settings where singleton = true;
      new.quota_budget_percent := coalesce(default_budget, 10);
    end if;
  end if;

  if TG_OP = 'UPDATE' then
    if not is_admin and new.status is distinct from old.status and not (old.status = 'scheduled' and new.status = 'cancelled') then raise exception 'Transição de estado não permitida.' using errcode='42501'; end if;
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
    if not is_admin and (new.device_id is distinct from old.device_id or new.activated_at is distinct from old.activated_at or new.quota_base_used_percent is distinct from old.quota_base_used_percent) and not (
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

-- Approval must preserve the period accepted when the request was created.
-- A delayed review unlocks only the remaining time; it never shifts the session.
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
  requested_window_unchanged boolean;
begin
  if (reviewer is null or not exists (select 1 from public.codex_admins where user_id = reviewer and enabled = true))
     and coalesce(auth.role(), '') not in ('service_role', 'supabase_admin') then
    raise exception 'Acesso administrativo necessário.' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(account_id, 0))
  from public.codex_reservations where id = p_reservation_id;
  select * into reservation
  from public.codex_reservations
  where id = p_reservation_id
  for update;

  if reservation.id is null or reservation.status <> 'scheduled' or reservation.approval_status <> 'pending' then
    raise exception 'A solicitação já foi revisada ou não está mais disponível.' using errcode = 'P0001';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= now() then
    raise exception 'Não é possível aprovar uma solicitação cujo horário já terminou.' using errcode = '22023';
  end if;

  requested_window_unchanged :=
    pg_catalog.abs(extract(epoch from (p_starts_at - reservation.starts_at))) <= 1
    and pg_catalog.abs(extract(epoch from (p_ends_at - reservation.ends_at))) <= 1;

  if requested_window_unchanged then
    p_starts_at := reservation.starts_at;
    p_ends_at := reservation.ends_at;
  end if;

  if p_ends_at is distinct from codex_private.fixed_slot_end(p_starts_at)
     or p_ends_at - p_starts_at < interval '5 minutes'
     or (not requested_window_unchanged and not codex_private.valid_five_hour_session(reservation.account_id, p_starts_at, p_ends_at)) then
    raise exception 'O período deve terminar no limite do horário fixo; revise reservas antigas antes de aprovar.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.codex_account_snapshots
    where account_id = reservation.account_id and status = 'ready'
  ) then
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
  if capacity.available_percent is null or capacity.available_percent < 1 then
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

revoke all on function public.codex_approve_reservation(uuid, timestamptz, timestamptz, integer, text)
  from public, anon;
grant execute on function public.codex_approve_reservation(uuid, timestamptz, timestamptz, integer, text)
  to authenticated, service_role;

drop trigger if exists enforce_reservation_integrity_trg on public.codex_reservations;
create trigger enforce_reservation_integrity_trg before insert or update on public.codex_reservations
for each row execute function public.enforce_reservation_integrity();

-- Apply the same capacity check to manual, automatic and direct database approvals.
create or replace function codex_private.enforce_weekly_capacity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare capacity record;
begin
  if new.status = 'scheduled' and new.approval_status = 'approved' then
    if TG_OP = 'UPDATE' then
      if old.status = new.status and old.approval_status = new.approval_status
         and old.quota_budget_percent is not distinct from new.quota_budget_percent
         and old.account_id = new.account_id and old.starts_at = new.starts_at and old.ends_at = new.ends_at then return new; end if;
    end if;
    if new.ends_at is distinct from codex_private.fixed_slot_end(new.starts_at) or new.ends_at-new.starts_at < interval '5 minutes' then raise exception 'Revise o horário fixo antes de aprovar.' using errcode='22023'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.account_id, 0));
    select * into capacity from codex_private.account_quota_capacity(new.account_id, new.id);
    if capacity.available_percent is null or new.quota_budget_percent is null or new.quota_budget_percent > capacity.available_percent then
      raise exception 'Telemetria semanal indisponível ou cota insuficiente para aprovar.' using errcode='P0001';
    end if;
  end if;
  return new;
end; $$;
revoke all on function codex_private.enforce_weekly_capacity() from public, anon, authenticated;
drop trigger if exists z_enforce_weekly_capacity on public.codex_reservations;
create trigger z_enforce_weekly_capacity before insert or update on public.codex_reservations
for each row execute function codex_private.enforce_weekly_capacity();
create or replace function public.sync_busy_slots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'DELETE' or (TG_OP = 'UPDATE' and (new.status = 'cancelled' or new.approval_status in ('rejected', 'expired'))) then
    delete from public.codex_busy_slots where reservation_id = old.id;
    return coalesce(new, old);
  end if;

  if new.status = 'scheduled' and new.approval_status in ('pending', 'approved') then
    insert into public.codex_busy_slots (account_id, starts_at, ends_at, reservation_id)
    values (new.account_id, new.starts_at, new.ends_at, new.id)
    on conflict (reservation_id) do update
    set account_id = excluded.account_id,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at;
  else
    delete from public.codex_busy_slots where reservation_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_busy_slots_trg on public.codex_reservations;
create trigger sync_busy_slots_trg
  after insert or update or delete on public.codex_reservations
  for each row
  execute function public.sync_busy_slots();


-- Reconcile the derived occupancy table without changing reservations.
delete from public.codex_busy_slots b where not exists (
 select 1 from public.codex_reservations r where r.id=b.reservation_id
 and r.status='scheduled' and r.approval_status in ('pending','approved'));
insert into public.codex_busy_slots (reservation_id,account_id,starts_at,ends_at)
 select id,account_id,starts_at,ends_at from public.codex_reservations
 where status='scheduled' and approval_status in ('pending','approved')
 on conflict(reservation_id) do update set account_id=excluded.account_id,starts_at=excluded.starts_at,ends_at=excluded.ends_at;
