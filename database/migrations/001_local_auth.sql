begin;

create extension if not exists pgcrypto;

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

-- Executado depois de restaurar o schema auth do dump do Supabase. Preserva
-- UUIDs, hashes bcrypt e metadados sem manter dependência do serviço Supabase.
insert into public.app_users (
  id,
  email,
  password_hash,
  app_metadata,
  user_metadata,
  email_confirmed_at,
  created_at,
  updated_at
)
select
  id,
  email,
  encrypted_password,
  coalesce(raw_app_meta_data, '{}'::jsonb),
  coalesce(raw_user_meta_data, '{}'::jsonb),
  email_confirmed_at,
  created_at,
  updated_at
from auth.users
on conflict (id) do update set
  email = excluded.email,
  password_hash = excluded.password_hash,
  app_metadata = excluded.app_metadata,
  user_metadata = excluded.user_metadata,
  email_confirmed_at = excluded.email_confirmed_at,
  updated_at = excluded.updated_at;

-- Redireciona toda FK da aplicação que ainda aponta para auth.users. A busca
-- dinâmica cobre colunas adicionadas por migrations antigas sem depender dos
-- nomes específicos das constraints.
do $$
declare
  item record;
  replacement text;
begin
  for item in
    select constraint_row.oid,
           namespace_row.nspname as schema_name,
           table_row.relname as table_name,
           constraint_row.conname as constraint_name,
           pg_get_constraintdef(constraint_row.oid) as definition
    from pg_constraint constraint_row
    join pg_class table_row on table_row.oid = constraint_row.conrelid
    join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
    where constraint_row.contype = 'f'
      and constraint_row.confrelid = 'auth.users'::regclass
      and namespace_row.nspname = 'public'
  loop
    replacement := replace(item.definition, 'REFERENCES auth.users(id)', 'REFERENCES public.app_users(id)');
    if replacement = item.definition then
      raise exception 'Não foi possível converter a constraint %.%', item.table_name, item.constraint_name;
    end if;
    execute format('alter table %I.%I drop constraint %I', item.schema_name, item.table_name, item.constraint_name);
    execute format('alter table %I.%I add constraint %I %s', item.schema_name, item.table_name, item.constraint_name, replacement);
  end loop;
end
$$;

revoke all on public.app_users, public.app_sessions from public;

commit;
