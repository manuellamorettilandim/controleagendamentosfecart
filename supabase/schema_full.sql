-- ==============================================================================
-- FECART AI SHARE - SCHEMA COMPLETO ATUALIZADO (PRODUÇÃO / TESTE)
-- ==============================================================================

-- 1. Tabelas Principais
-- ------------------------------------------------------------------------------

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  group_name text not null,
  weekly_quota_percent integer not null default 5 check (weekly_quota_percent between 1 and 100),
  enabled boolean not null default true,
  scheduling_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.codex_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null check (role in ('owner', 'admin')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table if not exists public.codex_account_snapshots (
  account_id text primary key,
  label text not null,
  email text,
  plan_type text,
  auth_mode text,
  status text not null,
  is_default boolean not null default false,
  updated_at timestamptz,
  rate_limits jsonb not null default '{}'::jsonb,
  usage jsonb,
  error text,
  observed_at timestamptz not null default now()
);

create table if not exists public.codex_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  account_id text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected', 'expired')),
  device_id text,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text,
  requested_quota_percent integer not null default 5 check (requested_quota_percent between 1 and 100),
  quota_budget_percent integer check (quota_budget_percent is null or (quota_budget_percent between 1 and 100)),
  quota_base_used_percent integer check (quota_base_used_percent is null or (quota_base_used_percent between 0 and 100)),
  activated_at timestamptz
);

create table if not exists public.codex_busy_slots (
  account_id text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reservation_id uuid not null unique references public.codex_reservations(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.codex_device_snapshots (
  device_id text primary key,
  label text not null,
  user_id uuid references public.profiles(user_id) on delete set null,
  reservation_id uuid references public.codex_reservations(id) on delete set null,
  account_id text,
  weekly_limit_percent numeric not null default 100 check (weekly_limit_percent >= 0 and weekly_limit_percent <= 100),
  quota_base_used_percent integer check (quota_base_used_percent is null or (quota_base_used_percent >= 0 and quota_base_used_percent <= 100)),
  quota_budget_percent integer check (quota_budget_percent is null or (quota_budget_percent >= 1 and quota_budget_percent <= 100)),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  disabled_at timestamptz,
  last_seen_at timestamptz,
  status text not null,
  fingerprint text not null,
  stale_at timestamptz not null default now(),
  usage_window_resets_at timestamptz,
  observed_tokens bigint not null default 0,
  observed_input_tokens bigint not null default 0,
  observed_cached_input_tokens bigint not null default 0,
  observed_output_tokens bigint not null default 0,
  observed_reasoning_tokens bigint not null default 0,
  account_used_percent numeric,
  account_window_duration_mins integer,
  account_resets_at timestamptz,
  usage_limit_reached_at timestamptz,
  usage_last_seen_at timestamptz,
  activated_at timestamptz
);

-- Garantir que colunas adicionadas existam caso a tabela já tenha sido criada antes
alter table public.codex_device_snapshots add column if not exists account_id text;
alter table public.codex_device_snapshots add column if not exists weekly_limit_percent numeric not null default 100;
alter table public.codex_device_snapshots add column if not exists usage_window_resets_at timestamptz;
alter table public.codex_device_snapshots add column if not exists account_used_percent numeric;
alter table public.codex_device_snapshots add column if not exists account_window_duration_mins integer;
alter table public.codex_device_snapshots add column if not exists account_resets_at timestamptz;
alter table public.codex_device_snapshots add column if not exists usage_limit_reached_at timestamptz;
alter table public.codex_device_snapshots add column if not exists usage_last_seen_at timestamptz;

create table if not exists public.codex_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.codex_account_usage_samples (
  id uuid primary key default gen_random_uuid(),
  account_id text not null,
  status text not null default 'ready',
  rate_limits jsonb not null default '{}'::jsonb,
  usage jsonb,
  used_percent numeric,
  window_duration_mins integer,
  resets_at timestamptz,
  observed_at timestamptz not null default now()
);

-- Garantir colunas em codex_account_usage_samples caso já tenha sido criada
alter table public.codex_account_usage_samples add column if not exists rate_limits jsonb not null default '{}'::jsonb;
alter table public.codex_account_usage_samples add column if not exists usage jsonb;
alter table public.codex_account_usage_samples add column if not exists used_percent numeric;
alter table public.codex_account_usage_samples add column if not exists window_duration_mins integer;
alter table public.codex_account_usage_samples add column if not exists resets_at timestamptz;

-- 2. Índices
-- ------------------------------------------------------------------------------

create index if not exists profiles_username_idx on public.profiles (username);
create index if not exists codex_admins_enabled_idx on public.codex_admins (enabled, role);
create index if not exists codex_reservations_account_idx on public.codex_reservations (account_id, starts_at, ends_at);
create index if not exists codex_reservations_user_idx on public.codex_reservations (user_id, starts_at);
create index if not exists codex_busy_slots_account_idx on public.codex_busy_slots (account_id, starts_at, ends_at);
create index if not exists codex_device_snapshots_user_idx on public.codex_device_snapshots (user_id);
create index if not exists codex_device_snapshots_reservation_idx on public.codex_device_snapshots (reservation_id);
create index if not exists codex_audit_created_at_idx on public.codex_admin_audit (created_at desc);
create index if not exists codex_account_usage_samples_account_idx on public.codex_account_usage_samples (account_id, observed_at desc);

-- 3. Funções Utilitárias e de Segurança
-- ------------------------------------------------------------------------------

create or replace function public.codex_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.role(), '') in ('service_role', 'supabase_admin') or exists (
    select 1
    from public.codex_admins
    where user_id = (select auth.uid())
      and enabled = true
  );
$$;

create or replace function public.codex_is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.role(), '') in ('service_role', 'supabase_admin') or exists (
    select 1
    from public.codex_admins
    where user_id = (select auth.uid())
      and role = 'owner'
      and enabled = true
  );
$$;

-- 4. Triggers de Integridade e Reconciliação
-- ------------------------------------------------------------------------------

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
    if new.ends_at - new.starts_at <> interval '5 hours' then
      raise exception 'Toda nova sessão deve ter exatamente 5 horas';
    end if;
    if not is_admin and (new.ends_at <= now() or new.starts_at < now() - interval '1 minute') then
      raise exception 'Não é possível agendar horários passados';
    end if;
    if not is_admin and new.approval_status is null then
      new.approval_status := 'pending';
      new.quota_budget_percent := null;
      new.reviewed_at := null;
      new.reviewed_by := null;
      new.review_note := null;
    end if;
    new.requested_quota_percent := 100;
    if new.approval_status = 'approved' then new.quota_budget_percent := 100; end if;
  end if;

  if TG_OP = 'UPDATE' then
    if (new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at)
       and new.ends_at - new.starts_at <> interval '5 hours' then
      raise exception 'Toda sessão ajustada deve ter exatamente 5 horas';
    end if;
    if old.approval_status = 'pending' and new.approval_status = 'approved' and new.ends_at <= now() then
      raise exception 'Não é permitido aprovar uma solicitação cujo horário já expirou.';
    end if;
    if old.approval_status = 'pending' and new.approval_status = 'approved' then
      new.requested_quota_percent := 100;
      new.quota_budget_percent := 100;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_reservation_integrity_trg on public.codex_reservations;
create trigger enforce_reservation_integrity_trg
  before insert or update on public.codex_reservations
  for each row
  execute function public.enforce_reservation_integrity();

create or replace function public.sync_busy_slots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'DELETE' or (TG_OP = 'UPDATE' and (new.status = 'cancelled' or new.approval_status in ('rejected', 'expired'))) then
    delete from public.codex_busy_slots where reservation_id = old.id;
    return coalesce(new, old);
  end if;

  if new.status = 'scheduled' and new.approval_status in ('pending', 'approved') then
    insert into public.codex_busy_slots (account_id, starts_at, ends_at, reservation_id)
    values (new.account_id, new.starts_at, new.ends_at, new.id)
    on conflict (reservation_id) do update
    set account_id = excluded.account_id,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at;
  else
    delete from public.codex_busy_slots where reservation_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_busy_slots_trg on public.codex_reservations;
create trigger sync_busy_slots_trg
  after insert or update or delete on public.codex_reservations
  for each row
  execute function public.sync_busy_slots();

-- Serializa e rejeita novas sessões sobrepostas na mesma conta. O trigger é
-- mantido mesmo quando a constraint GiST das migrações também estiver presente.
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

create or replace function public.ensure_device_snapshots_monotonic_tokens()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.observed_tokens := greatest(coalesce(old.observed_tokens, 0), coalesce(new.observed_tokens, 0));
  new.observed_input_tokens := greatest(coalesce(old.observed_input_tokens, 0), coalesce(new.observed_input_tokens, 0));
  new.observed_cached_input_tokens := greatest(coalesce(old.observed_cached_input_tokens, 0), coalesce(new.observed_cached_input_tokens, 0));
  new.observed_output_tokens := greatest(coalesce(old.observed_output_tokens, 0), coalesce(new.observed_output_tokens, 0));
  new.observed_reasoning_tokens := greatest(coalesce(old.observed_reasoning_tokens, 0), coalesce(new.observed_reasoning_tokens, 0));
  return new;
end;
$$;

drop trigger if exists codex_device_snapshots_monotonic_tokens_trg on public.codex_device_snapshots;
create trigger codex_device_snapshots_monotonic_tokens_trg
  before update on public.codex_device_snapshots
  for each row
  execute function public.ensure_device_snapshots_monotonic_tokens();

-- 5. Row Level Security (RLS) e Permissões
-- ------------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.codex_admins enable row level security;
alter table public.codex_account_snapshots enable row level security;
alter table public.codex_reservations enable row level security;
alter table public.codex_busy_slots enable row level security;
alter table public.codex_device_snapshots enable row level security;
alter table public.codex_admin_audit enable row level security;
alter table public.codex_account_usage_samples enable row level security;

-- Revoke padrões
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.codex_admins from anon, authenticated;
revoke all on table public.codex_account_snapshots from anon, authenticated;
revoke all on table public.codex_reservations from anon, authenticated;
revoke all on table public.codex_busy_slots from anon, authenticated;
revoke all on table public.codex_device_snapshots from anon, authenticated;
revoke all on table public.codex_admin_audit from anon, authenticated;
revoke all on table public.codex_account_usage_samples from anon, authenticated;

-- Grants para authenticated
grant select on table public.profiles to authenticated;
grant update (scheduling_enabled) on table public.profiles to authenticated;
grant select on table public.codex_admins to authenticated;
grant select on table public.codex_account_snapshots to authenticated;
grant select, insert, update on table public.codex_reservations to authenticated;
grant select on table public.codex_busy_slots to authenticated;
grant select on table public.codex_device_snapshots to authenticated;
grant select on table public.codex_admin_audit to authenticated;
grant select on table public.codex_account_usage_samples to authenticated;

-- Grants para service_role
grant all on table public.profiles to service_role;
grant all on table public.codex_admins to service_role;
grant all on table public.codex_account_snapshots to service_role;
grant all on table public.codex_reservations to service_role;
grant all on table public.codex_busy_slots to service_role;
grant all on table public.codex_device_snapshots to service_role;
grant all on table public.codex_admin_audit to service_role;
grant all on table public.codex_account_usage_samples to service_role;

-- Políticas RLS

-- Profiles
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated
  using ((select auth.uid()) = user_id or (select public.codex_is_admin()));

drop policy if exists profiles_update_scheduling_admin on public.profiles;
create policy profiles_update_scheduling_admin on public.profiles
  for update to authenticated
  using ((select public.codex_is_admin()))
  with check ((select public.codex_is_admin()));

-- Codex Admins
drop policy if exists codex_admins_read on public.codex_admins;
create policy codex_admins_read on public.codex_admins
  for select to authenticated
  using ((select auth.uid()) = user_id or (select public.codex_is_owner()));

-- Account Snapshots
drop policy if exists codex_account_snapshots_read on public.codex_account_snapshots;
create policy codex_account_snapshots_read on public.codex_account_snapshots
  for select to authenticated
  using (
    (select public.codex_is_admin())
    or exists (
      select 1 from public.profiles profile
      where profile.user_id = (select auth.uid())
        and profile.enabled = true
        and profile.scheduling_enabled = true
    )
  );

-- Reservations
drop policy if exists codex_reservations_read on public.codex_reservations;
create policy codex_reservations_read on public.codex_reservations
  for select to authenticated
  using ((select auth.uid()) = user_id or (select public.codex_is_admin()));

drop policy if exists codex_reservations_insert on public.codex_reservations;
create policy codex_reservations_insert on public.codex_reservations
  for insert to authenticated
  with check (
    ((select auth.uid()) = user_id and (select enabled from public.profiles where user_id = (select auth.uid())) = true)
    or (select public.codex_is_admin())
  );

drop policy if exists codex_reservations_update on public.codex_reservations;
create policy codex_reservations_update on public.codex_reservations
  for update to authenticated
  using ((select auth.uid()) = user_id or (select public.codex_is_admin()))
  with check ((select auth.uid()) = user_id or (select public.codex_is_admin()));

-- Busy Slots
drop policy if exists codex_busy_slots_read on public.codex_busy_slots;
create policy codex_busy_slots_read on public.codex_busy_slots
  for select to authenticated
  using (
    (select public.codex_is_admin())
    or exists (
      select 1 from public.profiles profile
      where profile.user_id = (select auth.uid())
        and profile.enabled = true
        and profile.scheduling_enabled = true
    )
  );

-- Device Snapshots
drop policy if exists codex_device_snapshots_read on public.codex_device_snapshots;
create policy codex_device_snapshots_read on public.codex_device_snapshots
  for select to authenticated
  using ((select auth.uid()) = user_id or (select public.codex_is_admin()));

-- Audit
drop policy if exists codex_admin_audit_read on public.codex_admin_audit;
create policy codex_admin_audit_read on public.codex_admin_audit
  for select to authenticated
  using ((select public.codex_is_owner()));

-- Account Usage Samples
drop policy if exists codex_account_usage_samples_read on public.codex_account_usage_samples;
create policy codex_account_usage_samples_read on public.codex_account_usage_samples
  for select to authenticated
  using ((select public.codex_is_admin()));

-- Operational Usage Events
create table if not exists public.codex_usage_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null check (event_type in (
    'turn_started',
    'turn_completed',
    'token_usage',
    'model_rerouted',
    'session_opened',
    'session_closed',
    'heartbeat',
    'connection_dropped'
  )),
  device_id text not null,
  user_id uuid references public.profiles(user_id) on delete set null,
  reservation_id uuid references public.codex_reservations(id) on delete set null,
  account_id text not null,
  thread_id text,
  turn_id text,
  model_id text,
  status text,
  thread_total_tokens bigint not null default 0 check (thread_total_tokens >= 0),
  thread_input_tokens bigint not null default 0 check (thread_input_tokens >= 0),
  thread_cached_input_tokens bigint not null default 0 check (thread_cached_input_tokens >= 0),
  thread_output_tokens bigint not null default 0 check (thread_output_tokens >= 0),
  thread_reasoning_tokens bigint not null default 0 check (thread_reasoning_tokens >= 0),
  account_used_percent numeric check (account_used_percent is null or account_used_percent between 0 and 100),
  account_window_duration_mins integer check (account_window_duration_mins is null or account_window_duration_mins > 0),
  account_resets_at timestamptz,
  observed_at timestamptz not null default now()
);

create index if not exists codex_usage_events_reservation_time_idx
  on public.codex_usage_events (reservation_id, observed_at);

create index if not exists codex_usage_events_account_time_idx
  on public.codex_usage_events (account_id, observed_at);

create index if not exists codex_usage_events_device_thread_time_idx
  on public.codex_usage_events (device_id, thread_id, observed_at);

create index if not exists codex_usage_events_model_time_idx
  on public.codex_usage_events (model_id, observed_at)
  where model_id is not null;

create index if not exists codex_usage_events_observed_at_idx
  on public.codex_usage_events (observed_at);

create index if not exists codex_usage_events_type_time_idx
  on public.codex_usage_events (event_type, observed_at);

alter table public.codex_usage_events enable row level security;
revoke all on table public.codex_usage_events from public, anon;
grant select on table public.codex_usage_events to authenticated;
grant all on table public.codex_usage_events to service_role;

drop policy if exists codex_usage_events_select_admin on public.codex_usage_events;
create policy codex_usage_events_select_admin
  on public.codex_usage_events
  for select
  to authenticated
  using ((select public.codex_is_admin()));

grant execute on function public.codex_is_admin() to authenticated;
grant execute on function public.codex_is_owner() to authenticated;
