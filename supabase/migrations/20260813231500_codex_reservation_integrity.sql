-- A user may cancel or activate a reservation, but cannot move or reopen it
-- through the Data API after the relay has validated the original booking.

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
    or new.created_at is distinct from old.created_at then
    raise exception 'reservation identity and schedule are immutable';
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

  return new;
end;
$$;

revoke all on function codex_private.enforce_reservation_integrity() from public, anon, authenticated;

drop trigger if exists codex_reservation_integrity on public.codex_reservations;
create trigger codex_reservation_integrity
before update on public.codex_reservations
for each row execute function codex_private.enforce_reservation_integrity();
