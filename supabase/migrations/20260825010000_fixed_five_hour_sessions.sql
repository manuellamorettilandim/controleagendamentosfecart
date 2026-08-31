-- Every new reservation owns one complete Codex five-hour rate-limit window.
-- Legacy quota columns remain for compatibility and are fixed at 100%.

create or replace function codex_private.five_hour_reset(p_account_id text)
returns timestamptz
language sql
stable
security definer
set search_path = public, codex_private
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

create or replace function codex_private.is_five_hour_boundary(p_account_id text, p_starts_at timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = public, codex_private
as $$
declare
  reset_at timestamptz := codex_private.five_hour_reset(p_account_id);
  offset_seconds numeric;
begin
  if reset_at is null or p_starts_at is null then return false; end if;
  offset_seconds := pg_catalog.extract(epoch from (p_starts_at - reset_at));
  return pg_catalog.abs(offset_seconds - pg_catalog.round(offset_seconds / 18000) * 18000) <= 60;
end;
$$;

revoke all on function codex_private.five_hour_reset(text) from public, anon, authenticated;
revoke all on function codex_private.is_five_hour_boundary(text, timestamptz) from public, anon, authenticated;
grant execute on function codex_private.five_hour_reset(text) to service_role;
grant execute on function codex_private.is_five_hour_boundary(text, timestamptz) to service_role;

create or replace function public.enforce_reservation_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_admin boolean;
begin
  select (
    coalesce(auth.role(), '') in ('service_role', 'supabase_admin') or
    exists (select 1 from public.codex_admins where user_id = (select auth.uid()) and enabled = true)
  ) into is_admin;

  if TG_OP = 'INSERT' then
    if new.ends_at - new.starts_at <> interval '5 hours' then
      raise exception 'Toda nova sessão deve ter exatamente 5 horas';
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
    if new.approval_status = 'approved' then new.quota_budget_percent := 100; end if;
  end if;

  if TG_OP = 'UPDATE' then
    if (new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at)
       and new.ends_at - new.starts_at <> interval '5 hours' then
      raise exception 'Toda sessão ajustada deve ter exatamente 5 horas';
    end if;
    if old.approval_status = 'pending' and new.approval_status = 'approved' and new.ends_at <= now() then
      raise exception 'Não é permitido aprovar uma solicitação cujo horário já expirou.';
    end if;
    if old.approval_status = 'pending' and new.approval_status = 'approved' then
      new.requested_quota_percent := 100;
      new.quota_budget_percent := 100;
    end if;
  end if;

  return new;
end;
$$;

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
  ends_at_val timestamptz := p_starts_at + interval '5 hours';
begin
  if requester is null then raise exception 'Autenticação necessária.' using errcode = '42501'; end if;
  if p_duration_hours <> 5 or p_requested_quota_percent <> 100 then
    raise exception 'Cada sessão deve ter cinco horas e 100%% da quota da janela.' using errcode = '22023';
  end if;
  if p_starts_at < now() - interval '1 minute' then
    raise exception 'A sessão deve começar em um reset futuro da quota de 5 horas.' using errcode = '22023';
  end if;
  if not codex_private.is_five_hour_boundary(p_account_id, p_starts_at) then
    raise exception 'O início precisa coincidir com um reset da quota de 5 horas.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where user_id = requester and enabled = true and coalesce(scheduling_enabled, true) = true) then
    raise exception 'Os agendamentos deste grupo estão bloqueados pelo administrador.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.codex_account_snapshots where account_id = p_account_id and status = 'ready') then
    raise exception 'Essa conta não está pronta para receber agendamentos.' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_account_id, 0));
  if exists (
    select 1 from public.codex_reservations
    where account_id = p_account_id
      and status = 'scheduled'
      and approval_status in ('pending', 'approved')
      and starts_at < ends_at_val
      and ends_at > p_starts_at
  ) then
    raise exception 'Esse ciclo de 5 horas já está reservado.' using errcode = 'P0001';
  end if;

  select * into settings from public.codex_app_settings where singleton = true;
  approval := case when coalesce(settings.auto_approve_quota_percent, 0) > 0 then 'approved' else 'pending' end;
  return query
    insert into public.codex_reservations (
      user_id, account_id, starts_at, ends_at, status, approval_status,
      requested_quota_percent, quota_budget_percent, reviewed_at, review_note
    ) values (
      requester, p_account_id, p_starts_at, ends_at_val,
      'scheduled', approval, 100,
      case when approval = 'approved' then 100 else null end,
      case when approval = 'approved' then now() else null end,
      case when approval = 'approved' then 'Aprovado automaticamente pela política geral.' else null end
    ) returning *;
end;
$$;

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
set search_path = public, codex_private
as $$
declare
  reviewer uuid := (select auth.uid());
  reservation public.codex_reservations%rowtype;
begin
  if (reviewer is null or not exists (select 1 from public.codex_admins where user_id = reviewer and enabled = true))
     and coalesce(auth.role(), '') not in ('service_role', 'supabase_admin') then
    raise exception 'Acesso administrativo necessário.' using errcode = '42501';
  end if;
  select * into reservation from public.codex_reservations where id = p_reservation_id for update;
  if reservation.id is null or reservation.status <> 'scheduled' or reservation.approval_status <> 'pending' then
    raise exception 'A solicitação já foi revisada ou não está mais disponível.' using errcode = 'P0001';
  end if;
  if p_ends_at - p_starts_at <> interval '5 hours' or p_ends_at <= now() then
    raise exception 'O período aprovado deve ter exatamente cinco horas e ainda não pode ter terminado.' using errcode = '22023';
  end if;
  if not codex_private.is_five_hour_boundary(reservation.account_id, p_starts_at) then
    raise exception 'O início aprovado precisa coincidir com um reset da quota de 5 horas.' using errcode = '22023';
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
    raise exception 'Esse ciclo de 5 horas já está reservado.' using errcode = 'P0001';
  end if;

  return query
    update public.codex_reservations set
      approval_status = 'approved', reviewed_by = reviewer, reviewed_at = now(),
      review_note = nullif(pg_catalog.left(pg_catalog.btrim(p_note), 500), ''),
      starts_at = p_starts_at, ends_at = p_ends_at,
      requested_quota_percent = 100, quota_budget_percent = 100
    where id = reservation.id
    returning *;
end;
$$;

revoke all on function public.codex_request_reservation(text, timestamptz, integer, integer) from public, anon;
grant execute on function public.codex_request_reservation(text, timestamptz, integer, integer) to authenticated, service_role;
revoke all on function public.codex_approve_reservation(uuid, timestamptz, timestamptz, integer, text) from public, anon;
grant execute on function public.codex_approve_reservation(uuid, timestamptz, timestamptz, integer, text) to authenticated, service_role;
