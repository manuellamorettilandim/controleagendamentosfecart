-- Keep partial-session approvals valid when a client rounds the account reset
-- timestamp to the nearest displayed second or minute.
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
  active boolean := codex_private.is_account_window_active(p_account_id);
  starts_now boolean := p_starts_at between now() - interval '1 minute' and now() + interval '1 minute';
begin
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    return false;
  end if;

  if not active and starts_now and p_ends_at - p_starts_at = interval '5 hours' then
    return true;
  end if;

  if p_ends_at - p_starts_at = interval '5 hours'
     and codex_private.is_five_hour_boundary(p_account_id, p_starts_at) then
    return true;
  end if;

  if active and starts_now and reset_at is not null
     and pg_catalog.abs(extract(epoch from (p_ends_at - reset_at))) <= 60
     and p_starts_at >= reset_at - interval '5 hours'
     and p_starts_at < reset_at
     and p_ends_at - p_starts_at >= interval '5 minutes' then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function codex_private.valid_five_hour_session(text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function codex_private.valid_five_hour_session(text, timestamptz, timestamptz)
  to service_role;
