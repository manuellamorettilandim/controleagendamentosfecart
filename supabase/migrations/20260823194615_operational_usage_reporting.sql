-- Operational usage history used by the final multi-week utilization report.
-- Raw prompts, assistant messages and command output are deliberately excluded.

create table if not exists public.codex_usage_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null check (event_type in ('turn_started', 'turn_completed', 'token_usage', 'model_rerouted')),
  device_id text not null,
  user_id uuid references public.profiles(user_id) on delete set null,
  reservation_id uuid references public.codex_reservations(id) on delete set null,
  account_id text not null,
  thread_id text,
  turn_id text,
  model_id text,
  status text,
  thread_total_tokens bigint not null default 0 check (thread_total_tokens >= 0),
  thread_input_tokens bigint not null default 0 check (thread_input_tokens >= 0),
  thread_cached_input_tokens bigint not null default 0 check (thread_cached_input_tokens >= 0),
  thread_output_tokens bigint not null default 0 check (thread_output_tokens >= 0),
  thread_reasoning_tokens bigint not null default 0 check (thread_reasoning_tokens >= 0),
  account_used_percent numeric check (account_used_percent is null or account_used_percent between 0 and 100),
  account_window_duration_mins integer check (account_window_duration_mins is null or account_window_duration_mins > 0),
  account_resets_at timestamptz,
  observed_at timestamptz not null default now()
);

create index if not exists codex_usage_events_reservation_time_idx
  on public.codex_usage_events (reservation_id, observed_at);

create index if not exists codex_usage_events_account_time_idx
  on public.codex_usage_events (account_id, observed_at);

create index if not exists codex_usage_events_device_thread_time_idx
  on public.codex_usage_events (device_id, thread_id, observed_at);

create index if not exists codex_usage_events_model_time_idx
  on public.codex_usage_events (model_id, observed_at)
  where model_id is not null;

alter table public.codex_usage_events enable row level security;
revoke all on table public.codex_usage_events from public, anon;
grant select on table public.codex_usage_events to authenticated;
grant all on table public.codex_usage_events to service_role;

drop policy if exists codex_usage_events_select_admin on public.codex_usage_events;
create policy codex_usage_events_select_admin
  on public.codex_usage_events
  for select
  to authenticated
  using ((select codex_private.is_admin()));
