-- Enhanced operational usage event types and reporting indexes.
-- Allows capturing session connected duration, heartbeats and unexpected disconnections.

alter table public.codex_usage_events
  drop constraint if exists codex_usage_events_event_type_check;

alter table public.codex_usage_events
  add constraint codex_usage_events_event_type_check
  check (event_type in (
    'turn_started',
    'turn_completed',
    'token_usage',
    'model_rerouted',
    'session_opened',
    'session_closed',
    'heartbeat',
    'connection_dropped'
  ));

create index if not exists codex_usage_events_observed_at_idx
  on public.codex_usage_events (observed_at);

create index if not exists codex_usage_events_type_time_idx
  on public.codex_usage_events (event_type, observed_at);
