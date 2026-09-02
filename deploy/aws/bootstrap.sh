#!/usr/bin/env bash
set -euo pipefail

PUBLIC_HOST="${1:-}"
APP_ARCHIVE="/tmp/fecart-app.tar.gz"

if [[ -z "$PUBLIC_HOST" || "$PUBLIC_HOST" =~ [^a-zA-Z0-9.-] ]]; then
  echo "Public hostname invalido." >&2
  exit 1
fi

if [[ ! -f "$APP_ARCHIVE" ]]; then
  echo "Arquivo $APP_ARCHIVE nao encontrado." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg tar caddy openssh-server awscli

install -d -m 0755 /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/postgresql.gpg ]]; then
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg
fi
source /etc/os-release
printf '%s\n' "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
  > /etc/apt/sources.list.d/postgresql.list
apt-get update
apt-get install -y postgresql-17 postgresql-client-17

if [[ ! -f /etc/apt/keyrings/nodesource.gpg ]]; then
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
fi
printf '%s\n' 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main' \
  > /etc/apt/sources.list.d/nodesource.list
apt-get update
apt-get install -y nodejs

npm install --global @openai/codex@0.147.0

install -d -o root -g root -m 0755 /etc/codex
cat > /etc/codex/requirements.toml <<'REQUIREMENTS'
allowed_approval_policies = ["never"]
allowed_sandbox_modes = ["read-only", "workspace-write"]
default_permissions = ":workspace"
allow_login_shell = false
allow_managed_hooks_only = true
allowed_web_search_modes = ["disabled"]

[allowed_permission_profiles]
":read-only" = true
":workspace" = true
":danger-full-access" = false

[features]
apps = false
browser_use = false
browser_use_external = false
browser_use_full_cdp_access = false
computer_use = false
plugins = false
remote_plugin = false
REQUIREMENTS
chmod 0644 /etc/codex/requirements.toml

id -u fecart-relay >/dev/null 2>&1 \
  || useradd --system --home-dir /var/lib/fecart-relay --create-home --shell /usr/sbin/nologin fecart-relay
id -u fecart-host >/dev/null 2>&1 \
  || useradd --system --home-dir /var/lib/fecart-host --create-home --shell /bin/bash fecart-host
id -u fecart-backup >/dev/null 2>&1 \
  || useradd --system --home-dir /var/lib/fecart-backup --create-home --shell /usr/sbin/nologin fecart-backup
usermod --shell /bin/bash fecart-host
passwd --lock fecart-host >/dev/null 2>&1 || true

systemctl enable postgresql
systemctl start postgresql

sudo -u postgres psql --set ON_ERROR_STOP=1 <<'POSTGRES_ROLES'
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fecart-relay') THEN
    CREATE ROLE "fecart-relay" LOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fecart-host') THEN
    CREATE ROLE "fecart-host" LOGIN BYPASSRLS;
  END IF;
END
$do$;
SELECT 'CREATE DATABASE fecart OWNER postgres'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'fecart')\gexec
POSTGRES_ROLES

install -d -o root -g root -m 0755 /opt/fecart/releases
install -d -o root -g root -m 0755 /etc/fecart
install -d -o fecart-relay -g fecart-relay -m 0750 /var/lib/fecart-relay
install -d -o fecart-host -g fecart-host -m 0700 \
  /var/lib/fecart-host \
  /var/lib/fecart-host/primary-codex \
  /var/lib/fecart-host/accounts \
  /var/lib/fecart-host/app-server-tokens \
  /var/lib/fecart-host/workspaces
install -d -o fecart-host -g fecart-host -m 0700 /var/lib/fecart-host/.ssh
install -d -o fecart-backup -g fecart-backup -m 0700 /var/backups/fecart/postgres
touch /var/lib/fecart-host/.ssh/authorized_keys
chown fecart-host:fecart-host /var/lib/fecart-host/.ssh/authorized_keys
chmod 0600 /var/lib/fecart-host/.ssh/authorized_keys

cat > /etc/ssh/sshd_config.d/90-fecart-codex-app.conf <<'SSHD'
Match User fecart-host
    AuthorizedKeysFile /var/lib/fecart-host/.ssh/authorized_keys
    AuthenticationMethods publickey
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PermitTTY no
    AllowTcpForwarding no
    X11Forwarding no
    PermitTunnel no
    GatewayPorts no
SSHD
sshd -t
systemctl enable ssh
systemctl restart ssh

RELEASE_ID="$(date -u +%Y%m%d%H%M%S)"
RELEASE_DIR="/opt/fecart/releases/$RELEASE_ID"
install -d -o root -g root -m 0755 "$RELEASE_DIR"
tar -xzf "$APP_ARCHIVE" -C "$RELEASE_DIR"
cd "$RELEASE_DIR"
npm ci
npm run build
npm prune --omit=dev
chown -R root:root "$RELEASE_DIR"
chmod -R o-w "$RELEASE_DIR"
ln -sfn "$RELEASE_DIR" /opt/fecart/current

install -o root -g root -m 0644 \
  "$RELEASE_DIR/deploy/aws/postgres/fecart-db-backup@.service" \
  /etc/systemd/system/fecart-db-backup@.service
install -o root -g root -m 0644 \
  "$RELEASE_DIR/deploy/aws/postgres/fecart-db-backup-six-hour.timer" \
  /etc/systemd/system/fecart-db-backup-six-hour.timer
install -o root -g root -m 0644 \
  "$RELEASE_DIR/deploy/aws/postgres/fecart-db-backup-daily.timer" \
  /etc/systemd/system/fecart-db-backup-daily.timer

install -o root -g root -m 0755 "$RELEASE_DIR/deploy/aws/install-env.sh" /usr/local/sbin/fecart-install-env
sed -i 's/\r$//' /usr/local/sbin/fecart-install-env

cat > /etc/systemd/system/fecart-relay.service <<'UNIT'
[Unit]
Description=FECART public relay and web interface
After=network-online.target postgresql.service
Wants=network-online.target postgresql.service

[Service]
Type=simple
User=fecart-relay
Group=fecart-relay
WorkingDirectory=/opt/fecart/current
EnvironmentFile=/etc/fecart/relay.env
ExecStart=/usr/bin/node /opt/fecart/current/dist/src/relay-main.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/fecart-relay
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/fecart-host.service <<'UNIT'
[Unit]
Description=FECART Codex central host agent
After=network-online.target postgresql.service fecart-relay.service
Wants=network-online.target postgresql.service
Requires=fecart-relay.service

[Service]
Type=simple
User=fecart-host
Group=fecart-host
WorkingDirectory=/opt/fecart/current
EnvironmentFile=/etc/fecart/host.env
ExecStart=/usr/bin/node /opt/fecart/current/dist/src/host-agent.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/fecart-host
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/caddy/Caddyfile <<CADDY
${PUBLIC_HOST} {
  encode zstd gzip
  reverse_proxy 127.0.0.1:10000
  header {
    X-Content-Type-Options nosniff
    Referrer-Policy strict-origin-when-cross-origin
    -Server
  }
}
CADDY

caddy validate --config /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable caddy
systemctl restart caddy

echo "Bootstrap concluido. Instale os ambientes com fecart-install-env e inicie os servicos."
