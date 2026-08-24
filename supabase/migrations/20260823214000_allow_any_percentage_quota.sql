-- Relax check constraints on codex_app_settings
alter table public.codex_app_settings drop constraint if exists codex_app_settings_max_request_quota_percent_check;
alter table public.codex_app_settings add constraint codex_app_settings_max_request_quota_percent_check
  check (max_request_quota_percent between 1 and 100);

alter table public.codex_app_settings drop constraint if exists codex_app_settings_auto_approve_quota_percent_check;
alter table public.codex_app_settings add constraint codex_app_settings_auto_approve_quota_percent_check
  check (auto_approve_quota_percent between 0 and 100);

-- Update codex_approve_reservation to accept any quota from 1% to max_request_quota_percent
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
set search_path = public
as $$
declare
  reviewer uuid := (select auth.uid());
  reservation public.codex_reservations%rowtype;
  settings public.codex_app_settings%rowtype;
  capacity record;
begin
  if (reviewer is null or not exists (select 1 from public.codex_admins where user_id = reviewer and enabled = true))
     and coalesce(auth.role(), '') not in ('service_role', 'supabase_admin') then
    raise exception 'Acesso administrativo necessário.' using errcode = '42501';
  end if;
  select * into reservation from public.codex_reservations where id = p_reservation_id for update;
  if reservation.id is null or reservation.status <> 'scheduled' or reservation.approval_status <> 'pending' then
    raise exception 'A solicitação já foi revisada ou não está mais disponível.' using errcode = 'P0001';
  end if;
  select * into settings from public.codex_app_settings where singleton = true;
  if p_quota_budget_percent < 1 or p_quota_budget_percent > coalesce(settings.max_request_quota_percent, 100) then
    raise exception '%', pg_catalog.format('A cota aprovada deve ser entre 1%% e %s%%.', coalesce(settings.max_request_quota_percent, 100)) using errcode = '22023';
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
