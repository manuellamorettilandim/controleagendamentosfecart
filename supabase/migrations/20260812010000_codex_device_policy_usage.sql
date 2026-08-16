-- Device policy and observed app-server usage metadata.
-- This migration never stores raw device tokens or any OpenAI credential.

alter table public.codex_device_snapshots
  add column if not exists account_id text,
  add column if not exists weekly_limit_percent numeric not null default 100,
  add column if not exists usage_window_resets_at timestamptz,
  add column if not exists observed_tokens bigint not null default 0,
  add column if not exists observed_input_tokens bigint not null default 0,
  add column if not exists observed_cached_input_tokens bigint not null default 0,
  add column if not exists observed_output_tokens bigint not null default 0,
  add column if not exists observed_reasoning_tokens bigint not null default 0,
  add column if not exists account_used_percent numeric,
  add column if not exists account_window_duration_mins integer,
  add column if not exists account_resets_at timestamptz,
  add column if not exists usage_limit_reached_at timestamptz,
  add column if not exists usage_last_seen_at timestamptz;

alter table public.codex_device_snapshots
  drop constraint if exists codex_device_snapshots_weekly_limit_percent_check;

alter table public.codex_device_snapshots
  add constraint codex_device_snapshots_weekly_limit_percent_check
  check (weekly_limit_percent >= 0 and weekly_limit_percent <= 100);

create index if not exists codex_device_snapshots_account_idx
  on public.codex_device_snapshots (account_id, status);
