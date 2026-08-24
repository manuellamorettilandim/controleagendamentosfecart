-- Keep the canonical profiles directory and the historical scheduling table
-- synchronized. This makes clean installs and existing projects follow the
-- same authorization path for user dashboard and reservation RPCs.

alter table public.profiles
  add column if not exists scheduling_enabled boolean not null default true;

alter table public.codex_user_profiles
  add column if not exists scheduling_enabled boolean not null default true;

insert into public.codex_user_profiles (
  user_id,
  username,
  login_email,
  group_name,
  enabled,
  scheduling_enabled,
  weekly_quota_percent,
  updated_at
)
select
  profile.user_id,
  profile.username,
  coalesce(nullif(lower(auth_user.email), ''), profile.user_id::text || '@invalid.local'),
  profile.group_name,
  profile.enabled,
  coalesce(profile.scheduling_enabled, true),
  profile.weekly_quota_percent,
  coalesce(profile.updated_at, now())
from public.profiles profile
left join auth.users auth_user on auth_user.id = profile.user_id
on conflict (user_id) do update set
  username = excluded.username,
  login_email = excluded.login_email,
  group_name = excluded.group_name,
  enabled = excluded.enabled,
  scheduling_enabled = excluded.scheduling_enabled,
  weekly_quota_percent = excluded.weekly_quota_percent,
  updated_at = excluded.updated_at;

create or replace function public.sync_scheduling_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if tg_table_name = 'profiles' then
    update public.codex_user_profiles
    set username = new.username,
        group_name = new.group_name,
        enabled = new.enabled,
        scheduling_enabled = coalesce(new.scheduling_enabled, true),
        weekly_quota_percent = new.weekly_quota_percent,
        updated_at = coalesce(new.updated_at, now())
    where user_id = new.user_id;
  else
    update public.profiles
    set scheduling_enabled = coalesce(new.scheduling_enabled, true),
        updated_at = coalesce(new.updated_at, now())
    where user_id = new.user_id;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_scheduling_profile() from public, anon, authenticated;

drop trigger if exists profiles_sync_scheduling on public.profiles;
create trigger profiles_sync_scheduling
  after insert or update of username, group_name, enabled, scheduling_enabled, weekly_quota_percent
  on public.profiles
  for each row execute function public.sync_scheduling_profile();

drop trigger if exists codex_user_profiles_sync_scheduling on public.codex_user_profiles;
create trigger codex_user_profiles_sync_scheduling
  after update of scheduling_enabled
  on public.codex_user_profiles
  for each row execute function public.sync_scheduling_profile();
