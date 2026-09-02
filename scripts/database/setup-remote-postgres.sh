#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "=== 1. Instalando depend�ncias e reposit�rio PostgreSQL 17 ==="
install -d -m 0755 /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/postgresql.gpg ]; then
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg
fi
. /etc/os-release
echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/postgresql.list

apt-get update
apt-get install -y postgresql-17 postgresql-client-17

systemctl enable postgresql
systemctl restart postgresql

echo "=== 2. Configurando banco e roles locais ==="
id -u fecart-relay >/dev/null 2>&1 || useradd --system --home-dir /var/lib/fecart-relay --create-home --shell /usr/sbin/nologin fecart-relay
id -u fecart-host >/dev/null 2>&1 || useradd --system --home-dir /var/lib/fecart-host --create-home --shell /bin/bash fecart-host
id -u fecart-backup >/dev/null 2>&1 || useradd --system --home-dir /var/lib/fecart-backup --create-home --shell /usr/sbin/nologin fecart-backup

sudo -u postgres psql --set ON_ERROR_STOP=1 <<'EOF_PG'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fecart_app') THEN
    CREATE ROLE fecart_app LOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fecart-relay') THEN
    CREATE ROLE "fecart-relay" LOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fecart-host') THEN
    CREATE ROLE "fecart-host" LOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fecart-backup') THEN
    CREATE ROLE "fecart-backup" LOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fecart_backup') THEN
    CREATE ROLE "fecart_backup" LOGIN BYPASSRLS;
  END IF;
END
$$;

SELECT 'CREATE DATABASE fecart OWNER postgres'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'fecart')\gexec
EOF_PG

sudo -u postgres psql -d fecart --set ON_ERROR_STOP=1 <<'EOF_PG2'
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create schema if not exists auth;
create schema if not exists codex_private;
create schema if not exists public;

grant usage on schema extensions, public, auth, codex_private to fecart_app, "fecart-relay", "fecart-host", "fecart-backup", fecart_backup;
grant all privileges on all tables in schema public, auth, codex_private to fecart_app, "fecart-relay", "fecart-host";
grant all privileges on all sequences in schema public, auth, codex_private to fecart_app, "fecart-relay", "fecart-host";
grant all privileges on all routines in schema public, auth, codex_private to fecart_app, "fecart-relay", "fecart-host";
EOF_PG2

echo "PostgreSQL 17 configurado com sucesso!"