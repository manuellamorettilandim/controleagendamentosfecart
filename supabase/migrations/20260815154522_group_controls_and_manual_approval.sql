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

-- Migrations must not delete Auth users or operational data implicitly. If a
-- development database contains obsolete demo rows, clean it explicitly with
-- the guarded seed/reset tooling instead of coupling that deletion to deploy.
