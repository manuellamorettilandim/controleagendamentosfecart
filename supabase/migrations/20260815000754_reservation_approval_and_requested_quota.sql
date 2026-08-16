-- Approval workflow and per-request quota selection.
-- Account credentials and relay tokens remain outside Supabase.

alter table public.codex_reservations
  add column if not exists approval_status text,
  add column if not exists requested_quota_percent numeric,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;

update public.codex_reservations
set approval_status = case when status = 'scheduled' then 'approved' else 'rejected' end,
    requested_quota_percent = least(20, greatest(5, round(coalesce(quota_budget_percent, 5) / 5) * 5))
where approval_status is null or requested_quota_percent is null;

-- Until the admin workflow is enabled, every scheduled reservation is approved automatically.
update public.codex_reservations
set approval_status = 'approved'
where status = 'scheduled' and approval_status = 'pending';

alter table public.codex_reservations
  alter column approval_status set default 'approved',
  alter column approval_status set not null,
  alter column requested_quota_percent set default 5,
  alter column requested_quota_percent set not null;

alter table public.codex_reservations
  drop constraint if exists codex_reservations_approval_status_check,
  add constraint codex_reservations_approval_status_check check (approval_status in ('pending', 'approved', 'rejected')),
  drop constraint if exists codex_reservations_requested_quota_check,
  add constraint codex_reservations_requested_quota_check check (requested_quota_percent between 5 and 20 and mod(requested_quota_percent, 5) = 0),
  drop constraint if exists codex_reservations_review_note_length,
  add constraint codex_reservations_review_note_length check (review_note is null or char_length(review_note) <= 500);

create index if not exists codex_reservations_pending_review_idx
  on public.codex_reservations (created_at)
  where status = 'scheduled' and approval_status = 'pending';

drop policy if exists codex_account_snapshots_read_authorized on public.codex_account_snapshots;
create policy codex_account_snapshots_read_authorized
  on public.codex_account_snapshots for select to authenticated
  using ((select codex_private.is_admin()) or exists (
    select 1 from public.codex_user_profiles profile
    where profile.user_id = (select auth.uid()) and profile.enabled = true
  ));

drop policy if exists codex_busy_slots_read_assigned_account on public.codex_busy_slots;
create policy codex_busy_slots_read_enabled_user
  on public.codex_busy_slots for select to authenticated
  using ((select codex_private.is_admin()) or exists (
    select 1 from public.codex_user_profiles profile
    where profile.user_id = (select auth.uid()) and profile.enabled = true
  ));

drop policy if exists codex_reservations_insert_self on public.codex_reservations;
create policy codex_reservations_insert_self
  on public.codex_reservations for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and status = 'scheduled'
    and approval_status = 'approved'
    and starts_at >= now()
    and exists (select 1 from public.codex_user_profiles profile where profile.user_id = (select auth.uid()) and profile.enabled = true)
    and exists (select 1 from public.codex_account_snapshots account where account.account_id = codex_reservations.account_id and account.status = 'ready')
  );

create or replace function codex_private.enforce_reservation_integrity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id
    or new.account_id is distinct from old.account_id
    or new.starts_at is distinct from old.starts_at
    or new.ends_at is distinct from old.ends_at
    or new.requested_quota_percent is distinct from old.requested_quota_percent
    or new.created_at is distinct from old.created_at then
    raise exception 'reservation identity and schedule are immutable';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then raise exception 'cancelled reservations cannot be reopened'; end if;
  if new.status = 'cancelled' and old.device_id is not null then raise exception 'active reservations cannot be cancelled'; end if;
  if old.device_id is not null and new.device_id is distinct from old.device_id then raise exception 'reservation credential is immutable'; end if;
  if not codex_private.is_admin() and (
    new.approval_status is distinct from old.approval_status
    or new.reviewed_by is distinct from old.reviewed_by
    or new.reviewed_at is distinct from old.reviewed_at
    or new.review_note is distinct from old.review_note
  ) then raise exception 'only administrators can review reservations'; end if;
  return new;
end;
$$;

revoke all on function codex_private.enforce_reservation_integrity() from public, anon, authenticated;

;
