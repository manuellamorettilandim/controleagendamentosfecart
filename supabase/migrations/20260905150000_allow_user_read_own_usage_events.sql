-- Allow authenticated users to view their own operational usage events for personal statistics
grant select on table public.codex_usage_events to authenticated;

drop policy if exists codex_usage_events_select_self on public.codex_usage_events;
create policy codex_usage_events_select_self
  on public.codex_usage_events
  for select
  to authenticated
  using ((select auth.uid()) = user_id);
