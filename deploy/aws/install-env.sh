#!/usr/bin/env bash
set -euo pipefail

IFS= read -r RELAY_ENV_BASE64
IFS= read -r HOST_ENV_BASE64

if [[ -z "$RELAY_ENV_BASE64" || -z "$HOST_ENV_BASE64" ]]; then
  echo "Ambientes relay/host ausentes." >&2
  exit 1
fi

RELAY_TMP="$(mktemp /etc/fecart/relay.env.XXXXXX)"
HOST_TMP="$(mktemp /etc/fecart/host.env.XXXXXX)"
trap 'rm -f -- "$RELAY_TMP" "$HOST_TMP"' EXIT

printf '%s' "$RELAY_ENV_BASE64" | base64 --decode > "$RELAY_TMP"
printf '%s' "$HOST_ENV_BASE64" | base64 --decode > "$HOST_TMP"

grep -q '^RELAY_AGENT_TOKEN_SHA256=' "$RELAY_TMP"
if grep -q '^RELAY_AGENT_TOKEN=' "$RELAY_TMP"; then
  echo "O token bruto nao pode ficar no ambiente do relay." >&2
  exit 1
fi
grep -q '^RELAY_AGENT_TOKEN=' "$HOST_TMP"
if ! grep -q '^DATABASE_URL=' "$HOST_TMP" && ! grep -q '^SUPABASE_SECRET_KEY=' "$HOST_TMP"; then
  echo "DATABASE_URL ou SUPABASE_SECRET_KEY ausente no host." >&2
  exit 1
fi
if grep -q '^DATABASE_URL=' "$HOST_TMP" && ! grep -q '^DATABASE_URL=' "$RELAY_TMP"; then
  echo "DATABASE_URL precisa estar nos ambientes do relay e do host." >&2
  exit 1
fi

install -o root -g fecart-relay -m 0640 "$RELAY_TMP" /etc/fecart/relay.env
install -o root -g fecart-host -m 0640 "$HOST_TMP" /etc/fecart/host.env

systemctl enable fecart-relay fecart-host
systemctl restart fecart-relay
systemctl restart fecart-host

sleep 3
systemctl --no-pager --full status fecart-relay.service | sed -n '1,12p'
systemctl --no-pager --full status fecart-host.service | sed -n '1,12p'
