-- Each end-user profile represents one real team from the original Fecart SQL.
-- Reservations require an explicit administrator decision and have no quota cap.

alter table public.codex_user_profiles
  add column if not exists scheduling_enabled boolean not null default true;

alter table public.codex_reservations
  alter column approval_status set default 'pending',
  alter column requested_quota_percent drop not null,
  alter column requested_quota_percent drop default;

alter table public.codex_reservations
  drop constraint if exists codex_reservations_requested_quota_check;

update public.codex_reservations
set requested_quota_percent = null,
    quota_base_used_percent = null,
    quota_budget_percent = null;

grant update (scheduling_enabled) on table public.codex_user_profiles to authenticated;

drop policy if exists codex_user_profiles_update_scheduling_admin on public.codex_user_profiles;
create policy codex_user_profiles_update_scheduling_admin
  on public.codex_user_profiles for update
  to authenticated
  using ((select codex_private.is_admin()))
  with check ((select codex_private.is_admin()));

drop policy if exists codex_reservations_insert_self on public.codex_reservations;
create policy codex_reservations_insert_self
  on public.codex_reservations for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and status = 'scheduled'
    and approval_status = 'pending'
    and requested_quota_percent is null
    and ends_at > now()
    and starts_at >= date_trunc('hour', now())
    and exists (
      select 1
      from public.codex_user_profiles profile
      where profile.user_id = (select auth.uid())
        and profile.enabled = true
        and profile.scheduling_enabled = true
    )
    and exists (
      select 1
      from public.codex_account_snapshots account
      where account.account_id = codex_reservations.account_id
        and account.status = 'ready'
    )
  );

-- The browser calls these tables through PostgREST. Keep grants explicit for
-- projects created with automatic Data API exposure disabled.
grant select on table public.codex_user_profiles to authenticated;
grant select, insert, update on table public.codex_reservations to authenticated;
grant select on table public.codex_account_snapshots to authenticated;
grant select on table public.codex_busy_slots to authenticated;

-- Remove the known test login and duplicate spelling aliases if an earlier
-- import already created them. Deleting the Auth row also removes its profile.
delete from auth.users
where id in (
  select user_id
  from public.codex_user_profiles
  where lower(username) in ('1ia', 'inteligencia', 'trigemeos')
);

-- Some installations still have the prototype table. It is not part of the
-- current authentication flow, but weak shared admin/test rows must not remain.
do $$
begin
  if to_regclass('public.users') is not null then
    execute $cleanup$
      delete from public.users
      where lower(username) in ('admin', '1ia', 'inteligencia', 'trigemeos')
    $cleanup$;
  end if;
end
$$;
