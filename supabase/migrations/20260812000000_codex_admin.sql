-- Remote Codex admin metadata only.
-- Never add auth.json, ChatGPT tokens, OpenAI API keys, or device token hashes here.

create table if not exists public.codex_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null check (role in ('owner', 'admin')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table if not exists public.codex_account_snapshots (
  account_id text primary key,
  label text not null,
  email text,
  plan_type text,
  auth_mode text,
  status text not null,
  is_default boolean not null default false,
  updated_at timestamptz,
  rate_limits jsonb not null default '{}'::jsonb,
  usage jsonb,
  error text,
  observed_at timestamptz not null default now()
);

create table if not exists public.codex_device_snapshots (
  device_id text primary key,
  label text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  disabled_at timestamptz,
  last_seen_at timestamptz,
  status text not null,
  fingerprint text not null,
  stale_at timestamptz not null default now()
);

create table if not exists public.codex_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists codex_admins_enabled_idx on public.codex_admins (enabled, role);
create index if not exists codex_audit_created_at_idx on public.codex_admin_audit (created_at desc);

alter table public.codex_admins enable row level security;
alter table public.codex_account_snapshots enable row level security;
alter table public.codex_device_snapshots enable row level security;
alter table public.codex_admin_audit enable row level security;

create or replace function public.codex_is_admin()
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

revoke all on table public.codex_admins from anon, authenticated;
revoke all on table public.codex_account_snapshots from anon, authenticated;
revoke all on table public.codex_device_snapshots from anon, authenticated;
revoke all on table public.codex_admin_audit from anon, authenticated;
grant select on table public.codex_admins to authenticated;
grant select on table public.codex_account_snapshots to authenticated;
grant select on table public.codex_device_snapshots to authenticated;
grant select on table public.codex_admin_audit to authenticated;

drop policy if exists codex_admins_read_self on public.codex_admins;
create policy codex_admins_read_self
  on public.codex_admins
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists codex_account_snapshots_read_admin on public.codex_account_snapshots;
create policy codex_account_snapshots_read_admin
  on public.codex_account_snapshots
  for select
  to authenticated
  using ((select public.codex_is_admin()));

drop policy if exists codex_device_snapshots_read_admin on public.codex_device_snapshots;
create policy codex_device_snapshots_read_admin
  on public.codex_device_snapshots
  for select
  to authenticated
  using ((select public.codex_is_admin()));

drop policy if exists codex_admin_audit_read_admin on public.codex_admin_audit;
create policy codex_admin_audit_read_admin
  on public.codex_admin_audit
  for select
  to authenticated
  using ((select public.codex_is_admin()));

grant execute on function public.codex_is_admin() to authenticated;

-- The Supabase secret key authenticates as the elevated service_role database role.
grant all on table public.codex_admins to service_role;
grant all on table public.codex_account_snapshots to service_role;
grant all on table public.codex_device_snapshots to service_role;
grant all on table public.codex_admin_audit to service_role;
