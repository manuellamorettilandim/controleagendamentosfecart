#!/usr/bin/env bash
set -euo pipefail

TIER="${1:-}"
case "$TIER" in
  six-hour) RETENTION_COUNT=8 ;;
  daily) RETENTION_COUNT=30 ;;
  *) echo "Uso: $0 six-hour|daily" >&2; exit 64 ;;
esac

: "${DATABASE_URL:?DATABASE_URL ausente}"
: "${S3_BUCKET:?S3_BUCKET ausente}"

BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/fecart/postgres}"
S3_PREFIX="${S3_PREFIX:-fecart/postgres}"

case "$BACKUP_ROOT" in
  ""|/|/var|/var/backups) echo "BACKUP_ROOT inseguro: $BACKUP_ROOT" >&2; exit 64 ;;
esac
if [[ "$S3_BUCKET" =~ [^a-zA-Z0-9.-] ]] || [[ -z "$S3_PREFIX" ]] || [[ "$S3_PREFIX" == /* ]] || [[ "$S3_PREFIX" == *..* ]]; then
  echo "Destino S3 inválido." >&2
  exit 64
fi

for command in pg_dump pg_restore sha256sum aws find sort; do
  command -v "$command" >/dev/null 2>&1 || { echo "Comando ausente: $command" >&2; exit 69; }
done

umask 077
TIER_DIR="$BACKUP_ROOT/$TIER"
install -d -m 0700 "$TIER_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASE_NAME="fecart-${TIER}-${TIMESTAMP}.dump"
PARTIAL_PATH="$TIER_DIR/$BASE_NAME.partial"
DUMP_PATH="$TIER_DIR/$BASE_NAME"
CHECKSUM_PATH="$DUMP_PATH.sha256"
trap 'rm -f -- "$PARTIAL_PATH"' EXIT

pg_dump \
  --dbname="$DATABASE_URL" \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-acl \
  --file="$PARTIAL_PATH"

pg_restore --list "$PARTIAL_PATH" >/dev/null
mv -- "$PARTIAL_PATH" "$DUMP_PATH"
(
  cd "$TIER_DIR"
  sha256sum "$BASE_NAME" > "$BASE_NAME.sha256"
)

S3_DESTINATION="s3://$S3_BUCKET/$S3_PREFIX/$TIER"
aws s3 cp "$DUMP_PATH" "$S3_DESTINATION/$BASE_NAME" --sse AES256 --only-show-errors
aws s3 cp "$CHECKSUM_PATH" "$S3_DESTINATION/$BASE_NAME.sha256" --sse AES256 --only-show-errors

mapfile -t BACKUPS < <(find "$TIER_DIR" -maxdepth 1 -type f -name 'fecart-*.dump' -printf '%f\n' | sort -r)
for ((index=RETENTION_COUNT; index<${#BACKUPS[@]}; index++)); do
  OLD_DUMP="$TIER_DIR/${BACKUPS[$index]}"
  rm -f -- "$OLD_DUMP" "$OLD_DUMP.sha256"
done

echo "Backup $TIER validado e enviado para $S3_DESTINATION/$BASE_NAME"
