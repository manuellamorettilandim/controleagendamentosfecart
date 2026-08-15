-- Fix RLS policies on codex_reservations:
-- 1. INSERT policy: allow booking the ongoing current hour (starts_at >= date_trunc('hour', now()) and ends_at > now())
-- 2. UPDATE policy: allow setting device_id upon session activation (immutable schedule and credentials enforced by trigger)

drop policy if exists codex_reservations_insert_self on public.codex_reservations;
create policy codex_reservations_insert_self
  on public.codex_reservations for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and status = 'scheduled'
    and approval_status = 'approved'
    and ends_at > now()
    and starts_at >= date_trunc('hour', now())
    and exists (select 1 from public.codex_user_profiles profile where profile.user_id = (select auth.uid()) and profile.enabled = true)
    and exists (select 1 from public.codex_account_snapshots account where account.account_id = codex_reservations.account_id and account.status = 'ready')
  );

drop policy if exists codex_reservations_update_self_or_admin on public.codex_reservations;
create policy codex_reservations_update_self_or_admin
  on public.codex_reservations for update
  to authenticated
  using ((select auth.uid()) = user_id or (select codex_private.is_admin()))
  with check (
    (select codex_private.is_admin())
    or (
      (select auth.uid()) = user_id
      and status in ('scheduled', 'cancelled')
    )
  );
