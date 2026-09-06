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

  if not requested_window_unchanged
     and not codex_private.valid_five_hour_session(reservation.account_id, p_starts_at, p_ends_at) then
    raise exception 'O período deve ocupar um ciclo completo ou terminar no reset atual.' using errcode = '22023';
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

revoke all on function public.codex_approve_reservation(uuid, timestamptz, timestamptz, integer, text)
  from public, anon;
grant execute on function public.codex_approve_reservation(uuid, timestamptz, timestamptz, integer, text)
  to authenticated, service_role;
