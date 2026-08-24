-- Groups are not bound to a single Codex account. The account is selected for
-- each reservation and remains attached to that reservation for auditing.

alter table public.codex_user_profiles
  alter column account_id drop not null,
  alter column account_id drop default;

comment on column public.codex_user_profiles.account_id is
  'Legacy historical assignment kept for compatibility. New account selection belongs to each reservation.';

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
  if not exists (
    select 1 from public.codex_user_profiles
    where user_id = requester and enabled and scheduling_enabled
  ) then
    raise exception 'Os agendamentos deste grupo estão bloqueados pelo administrador.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.codex_account_snapshots
    where account_id = p_account_id and status = 'ready'
  ) then
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
      requester, p_account_id, p_starts_at + interval '0 seconds', p_starts_at + pg_catalog.make_interval(hours => p_duration_hours),
      'scheduled', approval, p_requested_quota_percent,
      case when approval = 'approved' then p_requested_quota_percent else null end,
      case when approval = 'approved' then now() else null end,
      case when approval = 'approved' then 'Aprovado automaticamente pela política geral.' else null end
    ) returning *;
end;
$$;

revoke all on function public.codex_request_reservation(text, timestamptz, integer, integer) from public, anon;
grant execute on function public.codex_request_reservation(text, timestamptz, integer, integer) to authenticated, service_role;

drop policy if exists codex_reservations_insert_self on public.codex_reservations;
create policy codex_reservations_insert_self
  on public.codex_reservations
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and status = 'scheduled'
    and starts_at >= now()
    and exists (
      select 1 from public.codex_user_profiles profile
      where profile.user_id = (select auth.uid())
        and profile.enabled = true
        and profile.scheduling_enabled = true
    )
    and exists (
      select 1 from public.codex_account_snapshots account
      where account.account_id = codex_reservations.account_id
        and account.status = 'ready'
    )
  );

drop policy if exists codex_reservations_update_self_or_admin on public.codex_reservations;
create policy codex_reservations_update_self_or_admin
  on public.codex_reservations
  for update
  to authenticated
  using ((select auth.uid()) = user_id or (select public.codex_is_admin()))
  with check (
    (select public.codex_is_admin())
    or (
      (select auth.uid()) = user_id
      and exists (
        select 1 from public.codex_user_profiles profile
        where profile.user_id = (select auth.uid())
          and profile.enabled = true
          and profile.scheduling_enabled = true
      )
    )
  );

drop policy if exists codex_account_snapshots_read_assigned_user on public.codex_account_snapshots;
drop policy if exists codex_account_snapshots_read_scheduling_user on public.codex_account_snapshots;
create policy codex_account_snapshots_read_scheduling_user
  on public.codex_account_snapshots
  for select
  to authenticated
  using (
    exists (
      select 1 from public.codex_user_profiles profile
      where profile.user_id = (select auth.uid())
        and profile.enabled = true
        and profile.scheduling_enabled = true
    )
  );

drop policy if exists codex_busy_slots_read_assigned_account on public.codex_busy_slots;
drop policy if exists codex_busy_slots_read_scheduling_user on public.codex_busy_slots;
create policy codex_busy_slots_read_scheduling_user
  on public.codex_busy_slots
  for select
  to authenticated
  using (
    exists (
      select 1 from public.codex_user_profiles profile
      where profile.user_id = (select auth.uid())
        and profile.enabled = true
        and profile.scheduling_enabled = true
    )
  );
