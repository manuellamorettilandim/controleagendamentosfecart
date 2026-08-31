-- The DEV database had the public reservation RPC without the private helpers
-- introduced by the five-hour scheduling migrations. Keep these helpers private
-- and callable only by trusted database code.
create schema if not exists codex_private;

create or replace function codex_private.five_hour_reset(p_account_id text)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.to_timestamp((candidate.window_data ->> 'resetsAt')::double precision)
  from public.codex_account_snapshots snapshot
  cross join lateral pg_catalog.jsonb_each(coalesce(snapshot.rate_limits, '{}'::jsonb)) rate_limit
  cross join lateral (
    values (rate_limit.value -> 'primary'), (rate_limit.value -> 'secondary')
  ) candidate(window_data)
  where snapshot.account_id = p_account_id
    and snapshot.status = 'ready'
    and (candidate.window_data ->> 'windowDurationMins')::integer = 300
    and coalesce((candidate.window_data ->> 'resetsAt')::numeric, 0) > 0
  order by snapshot.observed_at desc
  limit 1;
$$;

create or replace function codex_private.is_five_hour_boundary(
  p_account_id text,
  p_starts_at timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  reset_at timestamptz := codex_private.five_hour_reset(p_account_id);
  offset_seconds numeric;
begin
  if reset_at is null or p_starts_at is null then
    return false;
  end if;
  offset_seconds := extract(epoch from (p_starts_at - reset_at));
  return pg_catalog.abs(offset_seconds - pg_catalog.round(offset_seconds / 18000) * 18000) <= 60;
end;
$$;

create or replace function codex_private.valid_five_hour_session(
  p_account_id text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  reset_at timestamptz := codex_private.five_hour_reset(p_account_id);
begin
  if reset_at is null or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    return false;
  end if;
  if p_ends_at - p_starts_at = interval '5 hours' then
    return codex_private.is_five_hour_boundary(p_account_id, p_starts_at);
  end if;
  return p_ends_at = reset_at
    and p_starts_at >= reset_at - interval '5 hours'
    and p_starts_at < reset_at
    and p_ends_at - p_starts_at >= interval '5 minutes';
end;
$$;

revoke all on function codex_private.five_hour_reset(text) from public, anon, authenticated;
revoke all on function codex_private.is_five_hour_boundary(text, timestamptz) from public, anon, authenticated;
revoke all on function codex_private.valid_five_hour_session(text, timestamptz, timestamptz) from public, anon, authenticated;

grant execute on function codex_private.five_hour_reset(text) to service_role;
grant execute on function codex_private.is_five_hour_boundary(text, timestamptz) to service_role;
grant execute on function codex_private.valid_five_hour_session(text, timestamptz, timestamptz) to service_role;
