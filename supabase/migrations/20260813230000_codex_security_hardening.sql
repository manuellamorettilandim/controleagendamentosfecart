-- Keep privileged helpers out of the exposed public RPC surface.

create schema if not exists codex_private;
revoke all on schema codex_private from public, anon;
grant usage on schema codex_private to authenticated, service_role;

create or replace function codex_private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.codex_admins
    where user_id = (select auth.uid())
      and enabled = true
  );
$$;

revoke all on function codex_private.is_admin() from public, anon;
grant execute on function codex_private.is_admin() to authenticated, service_role;

drop policy if exists codex_user_profiles_read_self_or_admin on public.codex_user_profiles;
create policy codex_user_profiles_read_self_or_admin
  on public.codex_user_profiles for select
  to authenticated
  using ((select auth.uid()) = user_id or (select codex_private.is_admin()));

drop policy if exists codex_reservations_read_self_or_admin on public.codex_reservations;
create policy codex_reservations_read_self_or_admin
  on public.codex_reservations for select
  to authenticated
  using ((select auth.uid()) = user_id or (select codex_private.is_admin()));

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
      and device_id is null
    )
  );

drop policy if exists codex_account_snapshots_read_admin on public.codex_account_snapshots;
drop policy if exists codex_account_snapshots_read_assigned_user on public.codex_account_snapshots;
create policy codex_account_snapshots_read_authorized
  on public.codex_account_snapshots for select
  to authenticated
  using (
    (select codex_private.is_admin())
    or exists (
      select 1 from public.codex_user_profiles profile
      where profile.user_id = (select auth.uid())
        and profile.enabled = true
        and profile.account_id = codex_account_snapshots.account_id
    )
  );

drop policy if exists codex_device_snapshots_read_admin on public.codex_device_snapshots;
drop policy if exists codex_device_snapshots_read_owner on public.codex_device_snapshots;
create policy codex_device_snapshots_read_authorized
  on public.codex_device_snapshots for select
  to authenticated
  using ((select codex_private.is_admin()) or user_id = (select auth.uid()));

drop policy if exists codex_admin_audit_read_admin on public.codex_admin_audit;
create policy codex_admin_audit_read_admin
  on public.codex_admin_audit for select
  to authenticated
  using ((select codex_private.is_admin()));

revoke all on function public.codex_is_admin() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

create index if not exists codex_admin_audit_actor_idx
  on public.codex_admin_audit (actor_user_id);
create index if not exists codex_admins_created_by_idx
  on public.codex_admins (created_by);
