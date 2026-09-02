#!/usr/bin/env bash
set -euo pipefail

: "${DUMP_PATH:?DUMP_PATH ausente}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL ausente}"

if [[ "${CONFIRM_FECART_RESTORE:-}" != "restore-and-replace-target-schema" ]]; then
  echo "Restauração recusada. Defina CONFIRM_FECART_RESTORE=restore-and-replace-target-schema." >&2
  exit 64
fi
if [[ ! -f "$DUMP_PATH" ]]; then
  echo "Dump não encontrado: $DUMP_PATH" >&2
  exit 66
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"

pg_restore --list "$DUMP_PATH" >/dev/null
psql "$TARGET_DATABASE_URL" --no-psqlrc --set ON_ERROR_STOP=1 \
  --file "$PROJECT_ROOT/database/restore-prerequisites.sql"
pg_restore \
  --dbname "$TARGET_DATABASE_URL" \
  --no-owner \
  --no-acl \
  --exit-on-error \
  "$DUMP_PATH"
psql "$TARGET_DATABASE_URL" --no-psqlrc --set ON_ERROR_STOP=1 \
  --file "$PROJECT_ROOT/database/migrations/001_local_auth.sql" \
  --file "$PROJECT_ROOT/database/migrations/002_local_runtime_role.sql"

psql "$TARGET_DATABASE_URL" --no-psqlrc --set ON_ERROR_STOP=1 --command \
  "select (select count(*) from auth.users) as source_users,
          (select count(*) from public.app_users) as migrated_users,
          (select count(*) from public.profiles) as profiles,
          (select count(*) from public.codex_reservations) as reservations;"

echo "Restauração e migração local concluídas. Execute os testes de login antes do corte."

