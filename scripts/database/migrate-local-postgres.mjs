import bcrypt from "bcryptjs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Client } from "pg";

const PG_HOST = process.env.LOCAL_PG_HOST || "127.0.0.1";
const PG_PORT = Number(process.env.LOCAL_PG_PORT || 5432);
const PG_USER = process.env.LOCAL_PG_USER || "postgres";
const PG_PASSWORD = process.env.LOCAL_PG_PASSWORD || "postgres";
const TARGET_DB = process.env.LOCAL_PG_DB || "fecart";

const backupDir = path.resolve(
  process.argv[2] || "backups/dev-export/supabase-api-20260902T023329Z"
);

const PASSWORD_MAP = {
  "renan.morellato96@gmail.com": "@Hfit2020",
  "user-0c8b2ef33fb224d764d0bc0a9f9742fec3a502725f46b4bea9198206f8ed5020@remote-codex.invalid": "SenhaTeste123!",
  "aluno-teste": "SenhaTeste123!",
  "admin-teste@fecart.org": "SenhaTeste123!",
  default: "SenhaDevFecart123!",
};

async function loadJson(filename) {
  try {
    const filePath = path.join(backupDir, filename);
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (err) {
    console.warn(`[migrate] Arquivo não encontrado ou inválido: ${filename}`);
    return [];
  }
}

async function main() {
  console.log(`[migrate] Conectando ao PostgreSQL em ${PG_HOST}:${PG_PORT}...`);

  // 1. Conectar ao postgres padrão e garantir que o banco alvo exista
  const rootClient = new Client({
    host: PG_HOST,
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASSWORD,
    database: "postgres",
  });
  await rootClient.connect();

  const checkDb = await rootClient.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [TARGET_DB]
  );
  if (checkDb.rowCount === 0) {
    console.log(`[migrate] Criando banco de dados '${TARGET_DB}'...`);
    await rootClient.query(`CREATE DATABASE "${TARGET_DB}"`);
  } else {
    console.log(`[migrate] Banco de dados '${TARGET_DB}' já existe.`);
  }
  await rootClient.end();

  // 2. Conectar ao banco alvo
  const dbClient = new Client({
    host: PG_HOST,
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASSWORD,
    database: TARGET_DB,
  });
  await dbClient.connect();

  console.log(`[migrate] Configurando extensões e schemas em '${TARGET_DB}'...`);
  await dbClient.query(`
    create schema if not exists extensions;
    create extension if not exists pgcrypto with schema extensions;
    create extension if not exists btree_gist with schema extensions;
    create extension if not exists "uuid-ossp" with schema extensions;
    create schema if not exists auth;
    create schema if not exists codex_private;
  `);

  console.log(`[migrate] Criando roles operacionais...`);
  await dbClient.query(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'fecart_app') then
        create role fecart_app login bypassrls;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'fecart-relay') then
        create role "fecart-relay" login bypassrls;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'fecart-host') then
        create role "fecart-host" login bypassrls;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'fecart-backup') then
        create role "fecart-backup" login bypassrls;
      end if;
    end
    $$;
    alter role fecart_app bypassrls;
    alter role "fecart-relay" bypassrls;
    alter role "fecart-host" bypassrls;
    alter role "fecart-backup" bypassrls;
    grant fecart_app to "fecart-relay", "fecart-host";
  `);

  console.log(`[migrate] Criando estrutura de tabelas...`);
  await dbClient.query(`
    create table if not exists public.app_users (
      id uuid primary key,
      email text unique,
      password_hash text,
      app_metadata jsonb not null default '{}'::jsonb,
      user_metadata jsonb not null default '{}'::jsonb,
      email_confirmed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      disabled_at timestamptz
    );

    create table if not exists public.app_sessions (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references public.app_users(id) on delete cascade,
      access_token_hash text not null unique,
      refresh_token_hash text not null unique,
      access_expires_at timestamptz not null,
      refresh_expires_at timestamptz not null,
      created_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      revoked_at timestamptz
    );

    create index if not exists app_sessions_user_active_idx
      on public.app_sessions (user_id, refresh_expires_at desc)
      where revoked_at is null;

    create table if not exists public.profiles (
      user_id uuid primary key references public.app_users(id) on delete cascade,
      username text not null unique,
      group_name text not null,
      weekly_quota_percent integer not null default 5 check (weekly_quota_percent between 1 and 100),
      enabled boolean not null default true,
      scheduling_enabled boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists public.codex_admins (
      user_id uuid primary key references public.app_users(id) on delete cascade,
      email text,
      role text not null check (role in ('owner', 'admin')),
      enabled boolean not null default true,
      created_at timestamptz not null default now(),
      created_by uuid references public.app_users(id) on delete set null
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
      reviewed_by uuid references public.app_users(id) on delete set null,
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

    create table if not exists public.codex_admin_audit (
      id uuid primary key default gen_random_uuid(),
      actor_user_id uuid references public.app_users(id) on delete set null,
      actor_email text,
      action text not null,
      target_type text not null,
      target_id text,
      details jsonb not null default '{}'::jsonb,
      metadata jsonb not null default '{}'::jsonb,
      ip_address text,
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

    create table if not exists public.codex_usage_events (
      id uuid primary key default gen_random_uuid(),
      event_key text not null unique,
      device_id text not null,
      user_id uuid references public.profiles(user_id) on delete set null,
      reservation_id uuid references public.codex_reservations(id) on delete set null,
      account_id text not null,
      thread_id text,
      turn_id text,
      model_id text,
      event_type text not null,
      status text,
      thread_total_tokens bigint not null default 0,
      thread_input_tokens bigint not null default 0,
      thread_cached_input_tokens bigint not null default 0,
      thread_output_tokens bigint not null default 0,
      thread_reasoning_tokens bigint not null default 0,
      account_used_percent numeric,
      account_window_duration_mins integer,
      account_resets_at timestamptz,
      observed_at timestamptz not null default now()
    );

    create table if not exists public.codex_user_profiles (
      user_id uuid primary key references public.app_users(id) on delete cascade,
      username text not null unique,
      login_email text not null,
      group_name text not null default 'Geral',
      weekly_quota_percent numeric not null default 5,
      enabled boolean not null default true,
      scheduling_enabled boolean not null default true,
      account_id text not null default 'primary',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    drop table if exists public.codex_app_settings cascade;
    create table if not exists public.codex_app_settings (
      singleton boolean primary key default true check (singleton),
      max_request_quota_percent integer not null default 100,
      auto_approve_quota_percent integer not null default 0,
      session_weekly_quota_percent integer not null default 10,
      enabled_models jsonb not null default '["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]'::jsonb,
      updated_at timestamptz not null default now(),
      updated_by uuid references public.app_users(id) on delete set null
    );
    -- Funções de autenticação e contexto
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
    create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon'); $$;

    create or replace function public.codex_is_admin() returns boolean language sql stable security definer set search_path = public as $$
      select coalesce(auth.role(), '') in ('service_role', 'supabase_admin') or exists (
        select 1 from public.codex_admins where user_id = (select auth.uid()) and enabled = true
      );
    $$;

    create or replace function public.codex_is_owner() returns boolean language sql stable security definer set search_path = public as $$
      select coalesce(auth.role(), '') in ('service_role', 'supabase_admin') or exists (
        select 1 from public.codex_admins where user_id = (select auth.uid()) and role = 'owner' and enabled = true
      );
    $$;

    -- Helpers de 5 horas e quota
    create or replace function codex_private.account_quota_capacity(target_account_id text, excluded_reservation_id uuid default null)
    returns table (used_percent numeric, committed_percent numeric, available_percent numeric, resets_at timestamptz)
    language sql stable security definer set search_path = public, codex_private as $$
      with account_window as (
        select greatest(0::numeric, least(100::numeric, coalesce((quota_window.value ->> 'usedPercent')::numeric, 0))) as used_percent,
          case when coalesce((quota_window.value ->> 'resetsAt')::numeric, 0) > 0 then pg_catalog.to_timestamp((quota_window.value ->> 'resetsAt')::double precision) else now() + interval '7 days' end as resets_at
        from public.codex_account_snapshots account
        cross join lateral (
          select candidate.value from pg_catalog.jsonb_each(coalesce(account.rate_limits, '{}'::jsonb)) limit_entry
          cross join lateral pg_catalog.jsonb_array_elements(pg_catalog.jsonb_build_array(limit_entry.value -> 'primary', limit_entry.value -> 'secondary')) candidate(value)
          where candidate.value is not null and candidate.value <> 'null'::jsonb order by coalesce((candidate.value ->> 'windowDurationMins')::numeric, 0) desc limit 1
        ) quota_window
        where account.account_id = target_account_id and account.status = 'ready' order by account.observed_at desc limit 1
      ), commitments as (
        select coalesce(sum(greatest(0::numeric, coalesce(reservation.quota_budget_percent, 10)::numeric -
          case when device.account_used_percent is null or device.quota_base_used_percent is null then 0 when device.account_used_percent >= device.quota_base_used_percent then device.account_used_percent - device.quota_base_used_percent else device.account_used_percent end
        )), 0) as committed_percent
        from public.codex_reservations reservation cross join account_window
        left join lateral (
          select snapshot.account_used_percent, snapshot.quota_base_used_percent from public.codex_device_snapshots snapshot
          where snapshot.reservation_id = reservation.id and snapshot.status in ('reserved', 'running', 'active') order by snapshot.created_at desc limit 1
        ) device on true
        where reservation.account_id = target_account_id and reservation.id is distinct from excluded_reservation_id and reservation.status = 'scheduled' and reservation.approval_status = 'approved' and reservation.ends_at > now() and reservation.starts_at < account_window.resets_at and reservation.quota_budget_percent is not null
      )
      select coalesce(account_window.used_percent, 0::numeric), coalesce(commitments.committed_percent, 0::numeric),
        greatest(0::numeric, 100 - coalesce(account_window.used_percent, 0::numeric) - coalesce(commitments.committed_percent, 0::numeric)),
        coalesce(account_window.resets_at, now() + interval '7 days')
      from (select 1) dummy left join account_window on true left join commitments on true;
    $$;

    create or replace function codex_private.five_hour_reset(p_account_id text) returns timestamptz language sql stable security definer set search_path = '' as $$
      select pg_catalog.to_timestamp((candidate.window_data ->> 'resetsAt')::double precision)
      from public.codex_account_snapshots snapshot cross join lateral pg_catalog.jsonb_each(coalesce(snapshot.rate_limits, '{}'::jsonb)) rate_limit
      cross join lateral (values (rate_limit.value -> 'primary'), (rate_limit.value -> 'secondary')) candidate(window_data)
      where snapshot.account_id = p_account_id and snapshot.status = 'ready' and (candidate.window_data ->> 'windowDurationMins')::integer = 300 and coalesce((candidate.window_data ->> 'resetsAt')::numeric, 0) > 0
      order by snapshot.observed_at desc limit 1;
    $$;

    create or replace function codex_private.is_account_window_active(p_account_id text) returns boolean language sql stable security definer set search_path = '' as $$
      with latest as (
        select coalesce((candidate.window_data ->> 'usedPercent')::numeric, 0) as used_pct, pg_catalog.to_timestamp((candidate.window_data ->> 'resetsAt')::double precision) as reset_ts
        from public.codex_account_snapshots snapshot cross join lateral pg_catalog.jsonb_each(coalesce(snapshot.rate_limits, '{}'::jsonb)) rate_limit
        cross join lateral (values (rate_limit.value -> 'primary'), (rate_limit.value -> 'secondary')) candidate(window_data)
        where snapshot.account_id = p_account_id and snapshot.status = 'ready' and (candidate.window_data ->> 'windowDurationMins')::integer = 300 and coalesce((candidate.window_data ->> 'resetsAt')::numeric, 0) > 0
        order by snapshot.observed_at desc limit 1
      )
      select coalesce(latest.reset_ts > now() and (latest.used_pct > 0 or exists (
        select 1 from public.codex_reservations r where r.account_id = p_account_id and r.status = 'scheduled' and r.approval_status = 'approved' and r.starts_at <= now() and r.ends_at > now()
      )), false) from (select 1) dummy left join latest on true;
    $$;

    create or replace function codex_private.is_five_hour_boundary(p_account_id text, p_starts_at timestamptz) returns boolean language plpgsql stable security definer set search_path = '' as $$
    declare reset_at timestamptz := codex_private.five_hour_reset(p_account_id); offset_seconds numeric;
    begin
      if reset_at is null or p_starts_at is null then return false; end if;
      offset_seconds := extract(epoch from (p_starts_at - reset_at));
      return pg_catalog.abs(offset_seconds - pg_catalog.round(offset_seconds / 18000) * 18000) <= 60;
    end;
    $$;

    create or replace function codex_private.valid_five_hour_session(p_account_id text, p_starts_at timestamptz, p_ends_at timestamptz) returns boolean language plpgsql stable security definer set search_path = '' as $$
    declare reset_at timestamptz := codex_private.five_hour_reset(p_account_id); active boolean := codex_private.is_account_window_active(p_account_id); starts_now boolean := p_starts_at between now() - interval '1 minute' and now() + interval '1 minute';
    begin
      if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then return false; end if;
      if not active and starts_now and p_ends_at - p_starts_at = interval '5 hours' then return true; end if;
      if p_ends_at - p_starts_at = interval '5 hours' and codex_private.is_five_hour_boundary(p_account_id, p_starts_at) then return true; end if;
      if active and starts_now and reset_at is not null and p_ends_at = reset_at and p_starts_at >= reset_at - interval '5 hours' and p_starts_at < reset_at and p_ends_at - p_starts_at >= interval '5 minutes' then return true; end if;
      return false;
    end;
    $$;

    create or replace function public.enforce_reservation_integrity() returns trigger language plpgsql security definer set search_path = public, codex_private as $$
    declare is_admin boolean; default_budget integer;
    begin
      if TG_OP = 'UPDATE' and old.approval_status = 'pending' and new.approval_status = 'expired' and new.ends_at <= now() then
        return new;
      end if;
      select (coalesce(auth.role(), '') in ('service_role', 'supabase_admin') or current_user in ('postgres', 'fecart_app', 'fecart-relay', 'fecart-host') or exists (select 1 from public.codex_admins where user_id = (select auth.uid()) and enabled = true)) into is_admin;
      if TG_OP = 'INSERT' then
        if not codex_private.valid_five_hour_session(new.account_id, new.starts_at, new.ends_at) then raise exception 'A sessão deve ocupar um ciclo completo ou terminar no reset atual'; end if;
        if not is_admin and (new.ends_at <= now() or new.starts_at < now() - interval '1 minute') then raise exception 'Não é possível agendar horários passados'; end if;
        if not is_admin and new.approval_status is null then new.approval_status := 'pending'; new.quota_budget_percent := null; new.reviewed_at := null; new.reviewed_by := null; new.review_note := null; end if;
        new.requested_quota_percent := 100;
        if new.approval_status = 'approved' and new.quota_budget_percent is null then select coalesce(session_weekly_quota_percent, 10) into default_budget from public.codex_app_settings where singleton = true; new.quota_budget_percent := coalesce(default_budget, 10); end if;
      end if;
      if TG_OP = 'UPDATE' then
        if not is_admin and (new.approval_status is distinct from old.approval_status or new.quota_budget_percent is distinct from old.quota_budget_percent or new.requested_quota_percent is distinct from old.requested_quota_percent or new.reviewed_at is distinct from old.reviewed_at or new.reviewed_by is distinct from old.reviewed_by or new.review_note is distinct from old.review_note or new.user_id is distinct from old.user_id or new.account_id is distinct from old.account_id or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at) then raise exception 'Somente administradores podem aprovar ou alterar parâmetros da reserva.'; end if;
        if not is_admin and new.device_id is distinct from old.device_id and not (old.device_id is null and new.device_id is not null and pg_catalog.btrim(new.device_id) <> '' and old.approval_status = 'approved' and new.approval_status = 'approved' and old.status = 'scheduled' and new.status = 'scheduled' and new.user_id = (select auth.uid()) and new.starts_at <= now() + interval '1 minute' and new.ends_at > now() and old.activated_at is null and new.activated_at between now() - interval '1 minute' and now() + interval '1 minute') then raise exception 'A credencial só pode ser vinculada uma vez durante uma reserva aprovada e ativa.'; end if;
        if (new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at) and not codex_private.valid_five_hour_session(new.account_id, new.starts_at, new.ends_at) then raise exception 'A sessão deve ocupar um ciclo completo ou terminar no reset atual'; end if;
        if old.approval_status = 'pending' and new.approval_status = 'approved' and new.ends_at <= now() then raise exception 'Não é permitido aprovar uma solicitação cujo horário já expirou.'; end if;
        if old.approval_status = 'pending' and new.approval_status = 'approved' and new.quota_budget_percent is null then select coalesce(session_weekly_quota_percent, 10) into default_budget from public.codex_app_settings where singleton = true; new.requested_quota_percent := 100; new.quota_budget_percent := coalesce(default_budget, 10); end if;
      end if;
      return new;
    end;
    $$;

    drop trigger if exists enforce_reservation_integrity_trg on public.codex_reservations;
    create trigger enforce_reservation_integrity_trg before insert or update on public.codex_reservations for each row execute function public.enforce_reservation_integrity();

    create or replace function public.sync_busy_slots() returns trigger language plpgsql security definer set search_path = public as $$
    begin
      if TG_OP = 'DELETE' or (TG_OP = 'UPDATE' and (new.status = 'cancelled' or new.approval_status in ('rejected', 'expired'))) then delete from public.codex_busy_slots where reservation_id = old.id; return coalesce(new, old); end if;
      if new.status = 'scheduled' and new.approval_status in ('pending', 'approved') then
        insert into public.codex_busy_slots (account_id, starts_at, ends_at, reservation_id) values (new.account_id, new.starts_at, new.ends_at, new.id) on conflict (reservation_id) do update set account_id = excluded.account_id, starts_at = excluded.starts_at, ends_at = excluded.ends_at;
      else delete from public.codex_busy_slots where reservation_id = new.id; end if;
      return new;
    end;
    $$;

    drop trigger if exists sync_busy_slots_trg on public.codex_reservations;
    create trigger sync_busy_slots_trg after insert or update or delete on public.codex_reservations for each row execute function public.sync_busy_slots();

    create or replace function codex_private.prevent_reservation_overlap() returns trigger language plpgsql security definer set search_path = '' as $$
    begin
      if new.status <> 'scheduled' then return new; end if;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.account_id, 0));
      if exists (select 1 from public.codex_reservations existing where existing.id <> new.id and existing.account_id = new.account_id and existing.status = 'scheduled' and pg_catalog.tstzrange(existing.starts_at, existing.ends_at, '[)') && pg_catalog.tstzrange(new.starts_at, new.ends_at, '[)')) then
        raise exception 'Já existe uma sessão nesta conta durante o horário solicitado.' using errcode = '23P01';
      end if;
      return new;
    end;
    $$;

    drop trigger if exists codex_reservations_prevent_overlap on public.codex_reservations;
    create trigger codex_reservations_prevent_overlap before insert or update of account_id, starts_at, ends_at, status on public.codex_reservations for each row execute function codex_private.prevent_reservation_overlap();

    create or replace function public.ensure_device_snapshots_monotonic_tokens() returns trigger language plpgsql security definer set search_path = public as $$
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
    create trigger codex_device_snapshots_monotonic_tokens_trg before update on public.codex_device_snapshots for each row execute function public.ensure_device_snapshots_monotonic_tokens();

    create or replace function public.codex_approve_reservation(
      p_reservation_id uuid, p_starts_at timestamptz, p_ends_at timestamptz,
      p_quota_budget_percent integer default null, p_note text default null
    )
    returns setof public.codex_reservations language plpgsql security definer set search_path = public, codex_private as $$
    declare
      reviewer uuid := (select auth.uid()); reservation public.codex_reservations%rowtype; settings public.codex_app_settings%rowtype;
      capacity record; desired_budget integer; granted_budget integer; final_note text;
    begin
      if (reviewer is null or not exists (select 1 from public.codex_admins where user_id = reviewer and enabled = true)) and coalesce(auth.role(), '') not in ('service_role', 'supabase_admin') then
        raise exception 'Acesso administrativo necessário.' using errcode = '42501';
      end if;
      select * into reservation from public.codex_reservations where id = p_reservation_id for update;
      if reservation.id is null or reservation.status <> 'scheduled' or reservation.approval_status <> 'pending' then
        raise exception 'A solicitação já foi revisada ou não está mais disponível.' using errcode = 'P0001';
      end if;
      if p_ends_at <= now() then
        raise exception 'Não é possível aprovar uma solicitação cujo horário já terminou.' using errcode = '22023';
      end if;
      if p_starts_at < now() and p_ends_at > now() then
        p_starts_at := now();
      end if;
      if not codex_private.valid_five_hour_session(reservation.account_id, p_starts_at, p_ends_at) then
        raise exception 'O período deve ocupar um ciclo completo ou terminar no reset atual.' using errcode = '22023';
      end if;
      if not exists (select 1 from public.codex_account_snapshots where account_id = reservation.account_id and status = 'ready') then
        raise exception 'Essa conta não está pronta para receber agendamentos.' using errcode = 'P0001';
      end if;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(reservation.account_id, 0));
      if exists (
        select 1 from public.codex_reservations other
        where other.account_id = reservation.account_id and other.id <> reservation.id and other.status = 'scheduled' and other.approval_status in ('pending', 'approved') and other.starts_at < p_ends_at and other.ends_at > p_starts_at
      ) then raise exception 'Esse horário já está reservado.' using errcode = 'P0001'; end if;
      select * into settings from public.codex_app_settings where singleton = true;
      desired_budget := coalesce(p_quota_budget_percent, settings.session_weekly_quota_percent, 10);
      if desired_budget < 1 or desired_budget > 100 then desired_budget := 10; end if;
      select * into capacity from codex_private.account_quota_capacity(reservation.account_id, reservation.id);
      if capacity.available_percent is not null and capacity.available_percent <= 0 then
        raise exception 'Cota semanal insuficiente: a conta não possui limite semanal disponível para novas aprovações nesta semana.' using errcode = 'P0001';
      end if;
      if capacity.available_percent is not null and capacity.available_percent < desired_budget then
        granted_budget := greatest(1, floor(capacity.available_percent)::integer);
        final_note := coalesce(nullif(pg_catalog.btrim(p_note), ''), 'Aprovado com cota ajustada para ' || granted_budget || '% (restante disponível da conta nesta semana).');
        if p_note is not null and pg_catalog.btrim(p_note) <> '' and position('restante disponível' in p_note) = 0 then
          final_note := pg_catalog.left(pg_catalog.btrim(p_note) || ' [Cota ajustada: ' || granted_budget || '%]', 500);
        end if;
      else
        granted_budget := desired_budget; final_note := nullif(pg_catalog.left(pg_catalog.btrim(p_note), 500), '');
      end if;
      return query
        update public.codex_reservations set
          approval_status = 'approved', reviewed_by = reviewer, reviewed_at = now(), review_note = final_note,
          starts_at = p_starts_at, ends_at = p_ends_at, requested_quota_percent = 100, quota_budget_percent = granted_budget
        where id = reservation.id returning *;
    end;
    $$;

    create or replace function public.codex_request_reservation(
      p_account_id text, p_starts_at timestamptz, p_duration_hours integer, p_requested_quota_percent integer
    )
    returns setof public.codex_reservations language plpgsql security definer set search_path = public, codex_private as $$
    declare
      requester uuid := (select auth.uid()); settings public.codex_app_settings%rowtype; approval text;
      reset_at timestamptz := codex_private.five_hour_reset(p_account_id); active boolean := codex_private.is_account_window_active(p_account_id);
      starts_now boolean := p_starts_at between now() - interval '1 minute' and now() + interval '1 minute';
      ends_at_val timestamptz; default_budget integer;
    begin
      if requester is null then raise exception 'Autenticação necessária.' using errcode = '42501'; end if;
      if p_duration_hours <> 5 or p_requested_quota_percent <> 100 then raise exception 'Cada sessão usa a quota disponível de uma janela de cinco horas.' using errcode = '22023'; end if;
      if p_starts_at < now() - interval '1 minute' then raise exception 'Não é possível agendar um horário passado.' using errcode = '22023'; end if;
      if not active and starts_now then ends_at_val := p_starts_at + interval '5 hours';
      elsif codex_private.is_five_hour_boundary(p_account_id, p_starts_at) then ends_at_val := p_starts_at + interval '5 hours';
      elsif active and starts_now and reset_at is not null and p_starts_at < reset_at and reset_at - p_starts_at >= interval '5 minutes' then ends_at_val := reset_at;
      else raise exception 'Escolha agora ou o início de um novo ciclo de 5 horas.' using errcode = '22023'; end if;
      if not exists (select 1 from public.profiles where user_id = requester and enabled = true and coalesce(scheduling_enabled, true) = true) then
        raise exception 'Os agendamentos deste grupo estão bloqueados pelo administrador.' using errcode = '42501';
      end if;
      if not exists (select 1 from public.codex_account_snapshots where account_id = p_account_id and status = 'ready') then
        raise exception 'Essa conta não está pronta para receber agendamentos.' using errcode = 'P0001';
      end if;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_account_id, 0));
      if exists (select 1 from public.codex_reservations where account_id = p_account_id and status = 'scheduled' and approval_status in ('pending', 'approved') and starts_at < ends_at_val and ends_at > p_starts_at) then
        raise exception 'Esse horário já está reservado.' using errcode = 'P0001';
      end if;
      select * into settings from public.codex_app_settings where singleton = true;
      approval := case when coalesce(settings.auto_approve_quota_percent, 0) > 0 then 'approved' else 'pending' end;
      default_budget := coalesce(settings.session_weekly_quota_percent, 10);
      return query
        insert into public.codex_reservations (user_id, account_id, starts_at, ends_at, status, approval_status, requested_quota_percent, quota_budget_percent, reviewed_at, review_note)
        values (requester, p_account_id, p_starts_at, ends_at_val, 'scheduled', approval, 100, case when approval = 'approved' then default_budget else null end, case when approval = 'approved' then now() else null end, case when approval = 'approved' then 'Aprovado automaticamente pela política geral.' else null end)
        returning *;
    end;
    $$;
  \`);

  console.log(\`[migrate] Aplicando privilégios e permissões...\`);
  await dbClient.query(\`
    grant usage on schema public, codex_private, auth to fecart_app, "fecart-relay", "fecart-host", postgres;
    grant select, insert, update, delete on all tables in schema public to fecart_app, "fecart-relay", "fecart-host", postgres;
    grant usage, select on all sequences in schema public to fecart_app, "fecart-relay", "fecart-host", postgres;
    grant execute on all functions in schema public, codex_private, auth to fecart_app, "fecart-relay", "fecart-host", postgres;
    alter default privileges in schema public grant select, insert, update, delete on tables to fecart_app;
    alter default privileges in schema public grant usage, select on sequences to fecart_app;
    alter default privileges in schema public grant execute on functions to fecart_app;
  \`);

  console.log(`[migrate] Importando dados de ${backupDir}...`);

  // 3. Importar authUsers -> app_users
  const authUsers = await loadJson("auth-users-without-password-hashes.json");
  console.log(`[migrate] Importando ${authUsers.length} usuários para app_users...`);
  for (const user of authUsers) {
    const email = user.email || "";
    const plainPassword = PASSWORD_MAP[email] || PASSWORD_MAP[email.toLowerCase()] || PASSWORD_MAP.default;
    const passwordHash = bcrypt.hashSync(plainPassword, 10);
    await dbClient.query(
      `
      insert into public.app_users (
        id, email, password_hash, app_metadata, user_metadata, email_confirmed_at, created_at, updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (id) do update set
        email = excluded.email,
        password_hash = excluded.password_hash,
        app_metadata = excluded.app_metadata,
        user_metadata = excluded.user_metadata,
        email_confirmed_at = excluded.email_confirmed_at,
        updated_at = excluded.updated_at
      `,
      [
        user.id,
        user.email,
        passwordHash,
        JSON.stringify(user.app_metadata || {}),
        JSON.stringify(user.user_metadata || {}),
        user.email_confirmed_at || new Date().toISOString(),
        user.created_at || new Date().toISOString(),
        user.updated_at || new Date().toISOString(),
      ]
    );
  }

  // 4. Importar profiles
  const profiles = await loadJson("table-profiles.json");
  console.log(`[migrate] Importando ${profiles.length} perfis...`);
  for (const p of profiles) {
    await dbClient.query(
      `
      insert into public.profiles (
        user_id, username, group_name, weekly_quota_percent, enabled, scheduling_enabled, created_at, updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (user_id) do update set
        username = excluded.username,
        group_name = excluded.group_name,
        weekly_quota_percent = excluded.weekly_quota_percent,
        enabled = excluded.enabled,
        scheduling_enabled = excluded.scheduling_enabled,
        updated_at = excluded.updated_at
      `,
      [
        p.user_id,
        p.username,
        p.group_name,
        p.weekly_quota_percent ?? 5,
        p.enabled ?? true,
        p.scheduling_enabled ?? true,
        p.created_at || new Date().toISOString(),
        p.updated_at || new Date().toISOString(),
      ]
    );

    // Sincronizar codex_user_profiles
    const user = authUsers.find((u) => u.id === p.user_id);
    const loginEmail = user?.email || `${p.username}@fecart.org`;
    await dbClient.query(
      `
      insert into public.codex_user_profiles (
        user_id, username, login_email, group_name, weekly_quota_percent, enabled, scheduling_enabled, created_at, updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      on conflict (user_id) do update set
        username = excluded.username,
        login_email = excluded.login_email,
        group_name = excluded.group_name,
        weekly_quota_percent = excluded.weekly_quota_percent,
        enabled = excluded.enabled,
        scheduling_enabled = excluded.scheduling_enabled,
        updated_at = excluded.updated_at
      `,
      [
        p.user_id,
        p.username,
        loginEmail,
        p.group_name,
        p.weekly_quota_percent ?? 5,
        p.enabled ?? true,
        p.scheduling_enabled ?? true,
        p.created_at || new Date().toISOString(),
        p.updated_at || new Date().toISOString(),
      ]
    );
  }

  // 5. Importar codex_admins
  const codexAdmins = await loadJson("table-codex_admins.json");
  console.log(`[migrate] Importando ${codexAdmins.length} administradores...`);
  for (const admin of codexAdmins) {
    await dbClient.query(
      `
      insert into public.codex_admins (
        user_id, email, role, enabled, created_at, created_by
      ) values ($1, $2, $3, $4, $5, $6)
      on conflict (user_id) do update set
        email = excluded.email,
        role = excluded.role,
        enabled = excluded.enabled
      `,
      [
        admin.user_id,
        admin.email,
        admin.role,
        admin.enabled ?? true,
        admin.created_at || new Date().toISOString(),
        admin.created_by || null,
      ]
    );
  }

  // 6. Importar codex_account_snapshots
  const accountSnapshots = await loadJson("table-codex_account_snapshots.json");
  console.log(`[migrate] Importando ${accountSnapshots.length} contas OpenAI...`);
  for (const acc of accountSnapshots) {
    await dbClient.query(
      `
      insert into public.codex_account_snapshots (
        account_id, label, email, plan_type, auth_mode, status, is_default, updated_at, rate_limits, usage, error, observed_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      on conflict (account_id) do update set
        label = excluded.label,
        email = excluded.email,
        plan_type = excluded.plan_type,
        auth_mode = excluded.auth_mode,
        status = excluded.status,
        is_default = excluded.is_default,
        updated_at = excluded.updated_at,
        rate_limits = excluded.rate_limits,
        usage = excluded.usage,
        error = excluded.error,
        observed_at = excluded.observed_at
      `,
      [
        acc.account_id,
        acc.label,
        acc.email,
        acc.plan_type,
        acc.auth_mode,
        acc.status,
        acc.is_default ?? false,
        acc.updated_at,
        JSON.stringify(acc.rate_limits || {}),
        acc.usage ? JSON.stringify(acc.usage) : null,
        acc.error,
        acc.observed_at || new Date().toISOString(),
      ]
    );
  }

  // 7. Importar codex_reservations
  const reservations = await loadJson("table-codex_reservations.json");
  console.log(`[migrate] Importando ${reservations.length} reservas...`);
  for (const res of reservations) {
    await dbClient.query(
      `
      insert into public.codex_reservations (
        id, user_id, account_id, starts_at, ends_at, status, approval_status, device_id,
        created_at, cancelled_at, reviewed_at, reviewed_by, review_note, requested_quota_percent,
        quota_budget_percent, quota_base_used_percent, activated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      on conflict (id) do update set
        status = excluded.status,
        approval_status = excluded.approval_status,
        device_id = excluded.device_id,
        cancelled_at = excluded.cancelled_at,
        reviewed_at = excluded.reviewed_at,
        reviewed_by = excluded.reviewed_by,
        review_note = excluded.review_note,
        quota_budget_percent = excluded.quota_budget_percent,
        quota_base_used_percent = excluded.quota_base_used_percent,
        activated_at = excluded.activated_at
      `,
      [
        res.id,
        res.user_id,
        res.account_id,
        res.starts_at,
        res.ends_at,
        res.status,
        res.approval_status,
        res.device_id,
        res.created_at,
        res.cancelled_at,
        res.reviewed_at,
        res.reviewed_by,
        res.review_note,
        res.requested_quota_percent ?? 5,
        res.quota_budget_percent,
        res.quota_base_used_percent,
        res.activated_at,
      ]
    );
  }

  // 8. Importar codex_busy_slots
  const busySlots = await loadJson("table-codex_busy_slots.json");
  console.log(`[migrate] Importando ${busySlots.length} slots ocupados...`);
  for (const slot of busySlots) {
    await dbClient.query(
      `
      insert into public.codex_busy_slots (
        account_id, starts_at, ends_at, reservation_id, created_at
      ) values ($1, $2, $3, $4, $5)
      on conflict (reservation_id) do update set
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at
      `,
      [
        slot.account_id,
        slot.starts_at,
        slot.ends_at,
        slot.reservation_id,
        slot.created_at || new Date().toISOString(),
      ]
    );
  }

  // 9. Importar codex_device_snapshots
  const deviceSnapshots = await loadJson("table-codex_device_snapshots.json");
  console.log(`[migrate] Importando ${deviceSnapshots.length} snapshots de dispositivos...`);
  for (const dev of deviceSnapshots) {
    const validUserId = profiles.some((p) => p.user_id === dev.user_id) ? dev.user_id : null;
    const validResId = reservations.some((r) => r.id === dev.reservation_id) ? dev.reservation_id : null;

    await dbClient.query(
      `
      insert into public.codex_device_snapshots (
        device_id, label, user_id, reservation_id, account_id, weekly_limit_percent,
        quota_base_used_percent, quota_budget_percent, created_at, expires_at, revoked_at,
        disabled_at, last_seen_at, status, fingerprint, stale_at, usage_window_resets_at,
        observed_tokens, observed_input_tokens, observed_cached_input_tokens, observed_output_tokens,
        observed_reasoning_tokens, account_used_percent, account_window_duration_mins,
        account_resets_at, usage_limit_reached_at, usage_last_seen_at, activated_at
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28
      )
      on conflict (device_id) do update set
        status = excluded.status,
        revoked_at = excluded.revoked_at,
        disabled_at = excluded.disabled_at,
        last_seen_at = excluded.last_seen_at,
        observed_tokens = excluded.observed_tokens,
        observed_input_tokens = excluded.observed_input_tokens,
        observed_cached_input_tokens = excluded.observed_cached_input_tokens,
        observed_output_tokens = excluded.observed_output_tokens,
        observed_reasoning_tokens = excluded.observed_reasoning_tokens,
        account_used_percent = excluded.account_used_percent,
        usage_last_seen_at = excluded.usage_last_seen_at
      `,
      [
        dev.device_id,
        dev.label,
        validUserId,
        validResId,
        dev.account_id,
        dev.weekly_limit_percent ?? 100,
        dev.quota_base_used_percent,
        dev.quota_budget_percent,
        dev.created_at,
        dev.expires_at,
        dev.revoked_at,
        dev.disabled_at,
        dev.last_seen_at,
        dev.status,
        dev.fingerprint || "0",
        dev.stale_at || new Date().toISOString(),
        dev.usage_window_resets_at,
        dev.observed_tokens || 0,
        dev.observed_input_tokens || 0,
        dev.observed_cached_input_tokens || 0,
        dev.observed_output_tokens || 0,
        dev.observed_reasoning_tokens || 0,
        dev.account_used_percent,
        dev.account_window_duration_mins,
        dev.account_resets_at,
        dev.usage_limit_reached_at,
        dev.usage_last_seen_at,
        dev.activated_at,
      ]
    );
  }

  // 10. Importar codex_admin_audit
  const auditLogs = await loadJson("table-codex_admin_audit.json");
  console.log(`[migrate] Importando ${auditLogs.length} logs de auditoria...`);
  for (const log of auditLogs) {
    const validActorId = authUsers.some((u) => u.id === log.actor_user_id) ? log.actor_user_id : null;
    await dbClient.query(
      `
      insert into public.codex_admin_audit (
        id, actor_user_id, action, target_type, target_id, metadata, details, ip_address, created_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      on conflict (id) do nothing
      `,
      [
        log.id,
        validActorId,
        log.action,
        log.target_type,
        log.target_id,
        JSON.stringify(log.metadata || {}),
        JSON.stringify(log.metadata || {}),
        log.ip_address || null,
        log.created_at || new Date().toISOString(),
      ]
    );
  }

  // 11. Importar codex_app_settings
  const appSettings = await loadJson("table-codex_app_settings.json");
  console.log(`[migrate] Importando ${appSettings.length} configurações...`);
  for (const s of appSettings) {
    const validUpdatedBy = authUsers.some((u) => u.id === s.updated_by) ? s.updated_by : null;
    await dbClient.query(
      `
      insert into public.codex_app_settings (
        singleton, max_request_quota_percent, auto_approve_quota_percent,
        session_weekly_quota_percent, enabled_models, updated_at, updated_by
      ) values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (singleton) do update set
        max_request_quota_percent = excluded.max_request_quota_percent,
        auto_approve_quota_percent = excluded.auto_approve_quota_percent,
        session_weekly_quota_percent = excluded.session_weekly_quota_percent,
        enabled_models = excluded.enabled_models,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
      `,
      [
        s.singleton ?? true,
        s.max_request_quota_percent ?? 100,
        s.auto_approve_quota_percent ?? 0,
        s.session_weekly_quota_percent ?? 10,
        JSON.stringify(s.enabled_models || ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]),
        s.updated_at || new Date().toISOString(),
        validUpdatedBy,
      ]
    );
  }

  // 12. Validação e contagem final
  console.log("\n[migrate] Verificação final de integridade no banco 'fecart':");
  const tables = [
    "app_users",
    "app_sessions",
    "profiles",
    "codex_admins",
    "codex_account_snapshots",
    "codex_reservations",
    "codex_busy_slots",
    "codex_device_snapshots",
    "codex_admin_audit",
    "codex_app_settings",
  ];

  for (const t of tables) {
    const countRes = await dbClient.query(`SELECT count(*)::int as total FROM public."${t}"`);
    console.log(`  - public.${t}: ${countRes.rows[0].total} registros`);
  }

  await dbClient.end();
  console.log("\n[migrate] ✓ Migração concluída com sucesso no PostgreSQL local!");
}

main().catch((err) => {
  console.error("[migrate] ERRO:", err);
  process.exit(1);
});
