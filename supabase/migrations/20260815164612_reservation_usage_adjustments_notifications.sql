-- Per-reservation usage requests and administrator adjustments.
-- Decisions remain visible to the requesting group through its own reservation rows.

alter table public.codex_reservations disable trigger codex_reservation_integrity;

update public.codex_reservations
set requested_quota_percent = least(20, greatest(5, round(coalesce(requested_quota_percent, 5) / 5) * 5));

update public.codex_reservations
set quota_budget_percent = requested_quota_percent
where approval_status = 'approved' and quota_budget_percent is null;

alter table public.codex_reservations enable trigger codex_reservation_integrity;

alter table public.codex_reservations
  alter column requested_quota_percent set default 5,
  alter column requested_quota_percent set not null,
  drop constraint if exists codex_reservations_requested_quota_check,
  add constraint codex_reservations_requested_quota_check
    check (requested_quota_percent between 5 and 20 and mod(requested_quota_percent, 5) = 0),
  drop constraint if exists codex_reservations_quota_budget_check,
  add constraint codex_reservations_quota_budget_check
    check (quota_budget_percent is null or (quota_budget_percent between 5 and 20 and mod(quota_budget_percent, 5) = 0));

drop policy if exists codex_reservations_insert_self on public.codex_reservations;
create policy codex_reservations_insert_self
  on public.codex_reservations for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and status = 'scheduled'
    and approval_status = 'pending'
    and requested_quota_percent between 5 and 20
    and mod(requested_quota_percent, 5) = 0
    and ends_at > now()
    and starts_at >= date_trunc('hour', now())
    and exists (
      select 1
      from public.codex_user_profiles profile
      where profile.user_id = (select auth.uid())
        and profile.enabled = true
        and profile.scheduling_enabled = true
    )
    and exists (
      select 1
      from public.codex_account_snapshots account
      where account.account_id = codex_reservations.account_id
        and account.status = 'ready'
    )
  );

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
  return new;
end;
$$;

revoke all on function codex_private.enforce_reservation_integrity() from public, anon, authenticated;
