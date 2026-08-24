-- Some projects were created from the migration chain without the original
-- application profile table. Create the minimum canonical shape before later
-- scheduling functions and policies reference it.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  group_name text not null default 'Geral',
  weekly_quota_percent integer not null default 5 check (weekly_quota_percent between 1 and 100),
  enabled boolean not null default true,
  scheduling_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists scheduling_enabled boolean not null default true;
alter table public.profiles enable row level security;
grant select on table public.profiles to authenticated;
grant update (scheduling_enabled) on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = user_id or (select public.codex_is_admin()));

drop policy if exists profiles_update_scheduling_admin on public.profiles;
create policy profiles_update_scheduling_admin
  on public.profiles for update
  to authenticated
  using ((select public.codex_is_admin()))
  with check ((select public.codex_is_admin()));

create or replace function public.enforce_reservation_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_admin boolean;
begin
  select (
    coalesce(auth.role(), '') in ('service_role', 'supabase_admin') or
    exists (
      select 1 from public.codex_admins
      where user_id = (select auth.uid()) and enabled = true
    )
  ) into is_admin;

  if TG_OP = 'INSERT' then
    if new.starts_at >= new.ends_at then
      raise exception 'A data de início deve ser anterior à de término';
    end if;
    if (new.ends_at - new.starts_at) > interval '3 hours' then
      raise exception 'A duração máxima permitida é de 3 horas';
    end if;
    if (new.ends_at - new.starts_at) < interval '1 hour' then
      raise exception 'A duração mínima permitida é de 1 hora';
    end if;
    if not is_admin and (new.ends_at <= now() or new.starts_at < (pg_catalog.date_trunc('hour', now()) - interval '1 minute')) then
      raise exception 'Não é possível agendar horários passados';
    end if;
    if not is_admin and new.approval_status is null then
      new.approval_status := 'pending';
      new.quota_budget_percent := null;
      new.reviewed_at := null;
      new.reviewed_by := null;
      new.review_note := null;
    end if;
  end if;

  if TG_OP = 'UPDATE' then
    if old.approval_status = 'pending' and new.approval_status = 'approved' and new.ends_at <= now() then
      raise exception 'Não é permitido aprovar uma solicitação cujo horário já expirou.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.codex_request_reservation(
  p_account_id text,
  p_starts_at timestamptz,
  p_duration_hours integer,
  p_requested_quota_percent integer
)
returns setof public.codex_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  requester uuid := (select auth.uid());
  settings public.codex_app_settings%rowtype;
  approval text;
  ends_at_val timestamptz;
begin
  if requester is null then raise exception 'Autenticação necessária.' using errcode = '42501'; end if;
  if p_duration_hours not between 1 and 3 then raise exception 'A duração deve ser de uma a três horas.' using errcode = '22023'; end if;
  ends_at_val := p_starts_at + pg_catalog.make_interval(hours => p_duration_hours);
  if ends_at_val <= now() or p_starts_at < (pg_catalog.date_trunc('hour', now()) - interval '1 minute') or p_starts_at <> pg_catalog.date_trunc('hour', p_starts_at) then
    raise exception 'A reserva deve começar no horário atual ou em uma hora cheia futura.' using errcode = '22023';
  end if;

  select * into settings from public.codex_app_settings where singleton = true;
  if p_requested_quota_percent < 1 or p_requested_quota_percent > coalesce(settings.max_request_quota_percent, 100) then
    raise exception '%', pg_catalog.format('A cota solicitada deve ser entre 1%% e %s%%.', coalesce(settings.max_request_quota_percent, 100)) using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where user_id = requester and enabled = true and coalesce(scheduling_enabled, true) = true) then
    raise exception 'Os agendamentos deste grupo estão bloqueados pelo administrador.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.codex_account_snapshots where account_id = p_account_id and status = 'ready') then
    raise exception 'Essa conta não está pronta para receber agendamentos.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.codex_reservations
    where account_id = p_account_id
      and status = 'scheduled'
      and approval_status in ('pending', 'approved')
      and starts_at < ends_at_val
      and ends_at > p_starts_at
  ) then
    raise exception 'Esse horário já está reservado.' using errcode = 'P0001';
  end if;

  approval := case when coalesce(settings.auto_approve_quota_percent, 20) > 0 and p_requested_quota_percent <= coalesce(settings.auto_approve_quota_percent, 20) then 'approved' else 'pending' end;
  return query
    insert into public.codex_reservations (
      user_id, account_id, starts_at, ends_at, status, approval_status,
      requested_quota_percent, quota_budget_percent, reviewed_at, review_note
    ) values (
      requester, p_account_id, p_starts_at, ends_at_val,
      'scheduled', approval, p_requested_quota_percent,
      case when approval = 'approved' then p_requested_quota_percent else null end,
      case when approval = 'approved' then now() else null end,
      case when approval = 'approved' then 'Aprovado automaticamente pela política geral.' else null end
    ) returning *;
end;
$$;
