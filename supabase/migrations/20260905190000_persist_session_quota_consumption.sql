alter table public.codex_device_snapshots
  add column if not exists quota_consumed_percent numeric not null default 0;

alter table public.codex_device_snapshots
  drop constraint if exists codex_device_snapshots_quota_consumed_percent_check;

alter table public.codex_device_snapshots
  add constraint codex_device_snapshots_quota_consumed_percent_check
  check (quota_consumed_percent >= 0);
