create or replace function codex_private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.codex_admins
    where user_id = (select auth.uid())
      and role = 'owner'
      and enabled = true
  );
$$;

revoke all on function codex_private.is_owner() from public, anon;
grant execute on function codex_private.is_owner() to authenticated, service_role;

drop policy if exists codex_admin_audit_read_admin on public.codex_admin_audit;
drop policy if exists codex_admin_audit_read_owner on public.codex_admin_audit;
create policy codex_admin_audit_read_owner
  on public.codex_admin_audit
  for select
  to authenticated
  using ((select codex_private.is_owner()));
