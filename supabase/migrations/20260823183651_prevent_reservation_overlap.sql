-- Prevent new overlapping reservations even in databases created from schema
-- snapshots that predate the GiST exclusion constraint. Existing rows are kept
-- intact so this migration can be applied safely to development databases.

create schema if not exists codex_private;

create or replace function codex_private.prevent_reservation_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'scheduled' then
    return new;
  end if;

  -- Serialize checks for the same account to avoid concurrent inserts passing
  -- the overlap query at the same time.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.account_id, 0));

  if exists (
    select 1
    from public.codex_reservations existing
    where existing.id <> new.id
      and existing.account_id = new.account_id
      and existing.status = 'scheduled'
      and pg_catalog.tstzrange(existing.starts_at, existing.ends_at, '[)')
        && pg_catalog.tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'Já existe uma sessão nesta conta durante o horário solicitado.'
      using errcode = '23P01';
  end if;

  return new;
end;
$$;

revoke all on function codex_private.prevent_reservation_overlap() from public, anon, authenticated;

drop trigger if exists codex_reservations_prevent_overlap on public.codex_reservations;
create trigger codex_reservations_prevent_overlap
  before insert or update of account_id, starts_at, ends_at, status
  on public.codex_reservations
  for each row execute function codex_private.prevent_reservation_overlap();
