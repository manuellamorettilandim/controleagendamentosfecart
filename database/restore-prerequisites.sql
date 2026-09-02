-- Execute em um banco PostgreSQL 17 vazio, antes do pg_restore.
-- As roles existem somente para permitir restaurar policies históricas; o
-- runtime novo não expõe PostgREST nem entrega essas roles ao cliente.

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then create role supabase_admin nologin; end if;
end
$$;

-- Bancos novos já possuem public; o dump preservado contém CREATE SCHEMA.
drop schema if exists public cascade;

