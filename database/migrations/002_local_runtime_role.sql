begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'fecart_app') then
    create role fecart_app login bypassrls;
  end if;
end
$$;

alter role fecart_app bypassrls;

do $$
begin
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

alter role "fecart-relay" bypassrls;
alter role "fecart-host" bypassrls;
alter role "fecart-backup" bypassrls;
grant fecart_app to "fecart-relay", "fecart-host";

grant usage on schema public, codex_private to fecart_app;
grant select, insert, update, delete on all tables in schema public to fecart_app;
grant usage, select on all sequences in schema public to fecart_app;
grant execute on all functions in schema public, codex_private to fecart_app;

alter default privileges in schema public
  grant select, insert, update, delete on tables to fecart_app;
alter default privileges in schema public
  grant usage, select on sequences to fecart_app;
alter default privileges in schema public, codex_private
  grant execute on functions to fecart_app;

do $$
begin
  execute format('grant connect on database %I to "fecart-backup"', current_database());
end
$$;
grant usage on schema public, auth, codex_private, extensions, supabase_migrations to "fecart-backup";
grant select on all tables in schema public, auth, supabase_migrations to "fecart-backup";
grant usage, select on all sequences in schema public, auth, supabase_migrations to "fecart-backup";
alter default privileges in schema public, auth, supabase_migrations
  grant select on tables to "fecart-backup";
alter default privileges in schema public, auth, supabase_migrations
  grant usage, select on sequences to "fecart-backup";

commit;
