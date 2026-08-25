-- A reservation belongs to a group login, so each member/device may receive
-- its own revocable credential while sharing the reservation and account quota.
drop index if exists public.codex_device_snapshots_reservation_idx;
create index codex_device_snapshots_reservation_idx
  on public.codex_device_snapshots (reservation_id)
  where reservation_id is not null;

-- Later scheduling migrations accidentally pointed these policies back to the
-- public compatibility helper, whose EXECUTE permission is intentionally
-- revoked. Keep authorization on the private helper used by the hardened schema.
drop policy if exists codex_reservations_update_self_or_admin on public.codex_reservations;
create policy codex_reservations_update_self_or_admin
  on public.codex_reservations for update
  to authenticated
  using ((select auth.uid()) = user_id or (select codex_private.is_admin()))
  with check (
    (select codex_private.is_admin())
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

drop policy if exists codex_app_settings_update_admin on public.codex_app_settings;
create policy codex_app_settings_update_admin
  on public.codex_app_settings for update
  to authenticated
  using ((select codex_private.is_admin()))
  with check ((select codex_private.is_admin()));

drop policy if exists profiles_read on public.profiles;
create policy profiles_read
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = user_id or (select codex_private.is_admin()));

drop policy if exists profiles_update_scheduling_admin on public.profiles;
create policy profiles_update_scheduling_admin
  on public.profiles for update
  to authenticated
  using ((select codex_private.is_admin()))
  with check ((select codex_private.is_admin()));
