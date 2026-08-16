-- Scheduled end-user access for Remote Codex.
-- OpenAI credentials and raw relay tokens are never stored in Supabase.

create extension if not exists btree_gist with schema extensions;

create table if not exists public.codex_user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  login_email text not null,
  group_name text not null default 'Geral',
  enabled boolean not null default true,
  account_id text not null default 'primary',
  weekly_quota_percent numeric not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint codex_user_profiles_username_length check (char_length(username) between 1 and 80),
  constraint codex_user_profiles_weekly_quota_check check (weekly_quota_percent > 0 and weekly_quota_percent <= 100)
);

create unique index if not exists codex_user_profiles_username_lower_idx
  on public.codex_user_profiles (lower(username));
create unique index if not exists codex_user_profiles_login_email_idx
  on public.codex_user_profiles (login_email);
create index if not exists codex_user_profiles_group_idx
  on public.codex_user_profiles (group_name, enabled);

create table if not exists public.codex_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  device_id text,
  quota_base_used_percent numeric,
  quota_budget_percent numeric,
  activated_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint codex_reservations_hour_boundary check (
    extract(minute from starts_at) = 0 and extract(second from starts_at) = 0 and
    extract(minute from ends_at) = 0 and extract(second from ends_at) = 0
  ),
  constraint codex_reservations_duration check (
    ends_at - starts_at in (interval '1 hour', interval '2 hours', interval '3 hours')
  ),
  constraint codex_reservations_quota_base_check check (
    quota_base_used_percent is null or (quota_base_used_percent >= 0 and quota_base_used_percent <= 100)
  ),
  constraint codex_reservations_quota_budget_check check (
    quota_budget_percent is null or (quota_budget_percent > 0 and quota_budget_percent <= 100)
  )
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'codex_reservations_no_overlap'
  ) then
    alter table public.codex_reservations
      add constraint codex_reservations_no_overlap
      exclude using gist (
        account_id with =,
        tstzrange(starts_at, ends_at, '[)') with &&
      ) where (status = 'scheduled');
  end if;
end
$$;

create index if not exists codex_reservations_user_time_idx
  on public.codex_reservations (user_id, starts_at desc);
create index if not exists codex_reservations_account_time_idx
  on public.codex_reservations (account_id, starts_at, ends_at)
  where status = 'scheduled';

create table if not exists public.codex_busy_slots (
  reservation_id uuid primary key references public.codex_reservations(id) on delete cascade,
  account_id text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null
);

create index if not exists codex_busy_slots_account_time_idx
  on public.codex_busy_slots (account_id, starts_at, ends_at);

create schema if not exists codex_private;
revoke all on schema codex_private from public, anon, authenticated;

create or replace function codex_private.sync_busy_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or new.status <> 'scheduled' then
    delete from public.codex_busy_slots where reservation_id = old.id;
    return coalesce(new, old);
  end if;
  insert into public.codex_busy_slots (reservation_id, account_id, starts_at, ends_at)
  values (new.id, new.account_id, new.starts_at, new.ends_at)
  on conflict (reservation_id) do update
    set account_id = excluded.account_id,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at;
  return new;
end;
$$;

revoke all on function codex_private.sync_busy_slot() from public, anon, authenticated;
drop trigger if exists codex_reservations_sync_busy_slot on public.codex_reservations;
create trigger codex_reservations_sync_busy_slot
  after insert or update or delete on public.codex_reservations
  for each row execute function codex_private.sync_busy_slot();

insert into public.codex_busy_slots (reservation_id, account_id, starts_at, ends_at)
select id, account_id, starts_at, ends_at
from public.codex_reservations
where status = 'scheduled'
on conflict (reservation_id) do update
  set account_id = excluded.account_id,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at;

alter table public.codex_device_snapshots
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists reservation_id uuid references public.codex_reservations(id) on delete set null,
  add column if not exists quota_base_used_percent numeric,
  add column if not exists quota_budget_percent numeric;

create index if not exists codex_device_snapshots_user_idx
  on public.codex_device_snapshots (user_id, created_at desc);
create unique index if not exists codex_device_snapshots_reservation_idx
  on public.codex_device_snapshots (reservation_id)
  where reservation_id is not null;

alter table public.codex_user_profiles enable row level security;
alter table public.codex_reservations enable row level security;
alter table public.codex_busy_slots enable row level security;

revoke all on table public.codex_user_profiles from anon, authenticated;
revoke all on table public.codex_reservations from anon, authenticated;
revoke all on table public.codex_busy_slots from anon, authenticated;
grant select on table public.codex_user_profiles to authenticated;
grant select, insert, update on table public.codex_reservations to authenticated;
grant select on table public.codex_busy_slots to authenticated;
grant all on table public.codex_user_profiles to service_role;
grant all on table public.codex_reservations to service_role;
grant all on table public.codex_busy_slots to service_role;

drop policy if exists codex_user_profiles_read_self_or_admin on public.codex_user_profiles;
create policy codex_user_profiles_read_self_or_admin
  on public.codex_user_profiles
  for select
  to authenticated
  using ((select auth.uid()) = user_id or (select public.codex_is_admin()));

drop policy if exists codex_reservations_read_self_or_admin on public.codex_reservations;
create policy codex_reservations_read_self_or_admin
  on public.codex_reservations
  for select
  to authenticated
  using ((select auth.uid()) = user_id or (select public.codex_is_admin()));

drop policy if exists codex_reservations_insert_self on public.codex_reservations;
create policy codex_reservations_insert_self
  on public.codex_reservations
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and status = 'scheduled'
    and starts_at >= now()
    and account_id = (
      select profile.account_id
      from public.codex_user_profiles profile
      where profile.user_id = (select auth.uid()) and profile.enabled = true
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
      and account_id = (
        select profile.account_id
        from public.codex_user_profiles profile
        where profile.user_id = (select auth.uid()) and profile.enabled = true
      )
    )
  );

drop policy if exists codex_account_snapshots_read_assigned_user on public.codex_account_snapshots;
create policy codex_account_snapshots_read_assigned_user
  on public.codex_account_snapshots
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.codex_user_profiles profile
      where profile.user_id = (select auth.uid())
        and profile.enabled = true
        and profile.account_id = account_id
    )
  );

drop policy if exists codex_device_snapshots_read_owner on public.codex_device_snapshots;
create policy codex_device_snapshots_read_owner
  on public.codex_device_snapshots
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists codex_busy_slots_read_assigned_account on public.codex_busy_slots;
create policy codex_busy_slots_read_assigned_account
  on public.codex_busy_slots
  for select
  to authenticated
  using (
    account_id = (
      select profile.account_id
      from public.codex_user_profiles profile
      where profile.user_id = (select auth.uid()) and profile.enabled = true
    )
  );

;
