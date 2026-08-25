-- Backfill the canonical profile directory from the historical scheduling
-- table. Existing canonical rows win so this migration never overwrites data.
insert into public.profiles (
  user_id,
  username,
  group_name,
  weekly_quota_percent,
  enabled,
  scheduling_enabled,
  created_at,
  updated_at
)
select
  profile.user_id,
  profile.username,
  profile.group_name,
  profile.weekly_quota_percent,
  profile.enabled,
  coalesce(profile.scheduling_enabled, true),
  coalesce(profile.created_at, now()),
  coalesce(profile.updated_at, now())
from public.codex_user_profiles profile
on conflict (user_id) do nothing;

-- This function is used only by a database trigger. It must not be exposed as
-- a callable SECURITY DEFINER RPC through the Data API.
revoke all on function public.enforce_reservation_integrity()
  from public, anon, authenticated;
