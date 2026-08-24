-- Migration: Reservation expiration, cumulative counters protection, account usage samples, and reports RLS
-- Date: 2026-08-22

-- 1. Extend approval_status to support 'expired'
alter table public.codex_reservations disable trigger codex_reservation_integrity;

alter table public.codex_reservations
  drop constraint if exists codex_reservations_approval_status_check,
  add constraint codex_reservations_approval_status_check
    check (approval_status in ('pending', 'approved', 'rejected', 'expired'));

-- Migrate any pending reservations whose end time is already in the past
update public.codex_reservations
set approval_status = 'expired',
    status = 'cancelled',
    cancelled_at = ends_at
where approval_status = 'pending' and ends_at <= now();

alter table public.codex_reservations enable trigger codex_reservation_integrity;

-- Keep historical busy-slot rows intact during deploy. The reservation sync
-- trigger maintains active slots during normal writes; any repair cleanup must
-- be an explicit, separately backed-up maintenance operation.

-- 2. Update integrity trigger to reject approving expired reservations
create or replace function codex_private.enforce_reservation_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  administrator boolean := codex_private.is_admin();
begin
  if new.user_id is distinct from old.user_id
    or new.requested_quota_percent is distinct from old.requested_quota_percent
    or new.created_at is distinct from old.created_at then
    raise exception 'reservation owner, request and creation time are immutable';
  end if;

  if not administrator and (
    new.account_id is distinct from old.account_id
    or new.starts_at is distinct from old.starts_at
    or new.ends_at is distinct from old.ends_at
    or new.quota_budget_percent is distinct from old.quota_budget_percent
  ) then
    raise exception 'only administrators can adjust reservation time or approved usage';
  end if;

  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'cancelled reservations cannot be reopened';
  end if;
  if new.status = 'cancelled' and old.device_id is not null then
    raise exception 'active reservations cannot be cancelled';
  end if;
  if old.device_id is not null and new.device_id is distinct from old.device_id then
    raise exception 'reservation credential is immutable';
  end if;
  if not administrator and (
    new.approval_status is distinct from old.approval_status
    or new.reviewed_by is distinct from old.reviewed_by
    or new.reviewed_at is distinct from old.reviewed_at
    or new.review_note is distinct from old.review_note
  ) then
    raise exception 'only administrators can review reservations';
  end if;

  -- Disallow approving a reservation that has already ended
  if new.approval_status = 'approved' and new.ends_at <= now() then
    raise exception 'cannot approve a reservation that has already ended';
  end if;

  return new;
end;
$$;

revoke all on function codex_private.enforce_reservation_integrity() from public, anon, authenticated;

-- 3. Create codex_account_usage_samples for 5-minute periodic telemetry snapshots
create table if not exists public.codex_account_usage_samples (
  id uuid primary key default gen_random_uuid(),
  account_id text not null,
  status text not null,
  rate_limits jsonb not null default '{}'::jsonb,
  usage jsonb,
  used_percent numeric,
  window_duration_mins integer,
  resets_at timestamptz,
  observed_at timestamptz not null default now()
);

create index if not exists codex_account_usage_samples_account_time_idx
  on public.codex_account_usage_samples (account_id, observed_at desc);

create index if not exists codex_account_usage_samples_time_idx
  on public.codex_account_usage_samples (observed_at desc);

alter table public.codex_account_usage_samples enable row level security;
revoke all on table public.codex_account_usage_samples from anon, public;
grant select on table public.codex_account_usage_samples to authenticated;
grant all on table public.codex_account_usage_samples to service_role;

drop policy if exists codex_account_usage_samples_select_admin on public.codex_account_usage_samples;
create policy codex_account_usage_samples_select_admin
  on public.codex_account_usage_samples for select to authenticated
  using ((select codex_private.is_admin()));

-- 4. Database protection for cumulative monotonic token counters in codex_device_snapshots
create or replace function codex_private.ensure_device_snapshots_monotonic_tokens()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.observed_tokens = greatest(coalesce(old.observed_tokens, 0), coalesce(new.observed_tokens, 0));
  new.observed_input_tokens = greatest(coalesce(old.observed_input_tokens, 0), coalesce(new.observed_input_tokens, 0));
  new.observed_cached_input_tokens = greatest(coalesce(old.observed_cached_input_tokens, 0), coalesce(new.observed_cached_input_tokens, 0));
  new.observed_output_tokens = greatest(coalesce(old.observed_output_tokens, 0), coalesce(new.observed_output_tokens, 0));
  new.observed_reasoning_tokens = greatest(coalesce(old.observed_reasoning_tokens, 0), coalesce(new.observed_reasoning_tokens, 0));
  return new;
end;
$$;

revoke all on function codex_private.ensure_device_snapshots_monotonic_tokens() from public, anon, authenticated;

drop trigger if exists codex_device_snapshots_monotonic_tokens_trg on public.codex_device_snapshots;
create trigger codex_device_snapshots_monotonic_tokens_trg
  before update on public.codex_device_snapshots
  for each row execute function codex_private.ensure_device_snapshots_monotonic_tokens();
