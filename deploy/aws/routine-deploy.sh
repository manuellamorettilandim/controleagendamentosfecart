#!/usr/bin/env bash
set -euo pipefail

PUBLIC_HOST="${1:-}"
RELEASE_ID="${2:-$(date -u +%Y%m%d%H%M%S)}"
APP_ARCHIVE="/tmp/fecart-app.tar.gz"

if [[ -z "$PUBLIC_HOST" || "$PUBLIC_HOST" =~ [^a-zA-Z0-9.-] ]]; then
  echo "Public hostname inválido." >&2
  exit 1
fi

if [[ ! -f "$APP_ARCHIVE" ]]; then
  echo "Arquivo de release $APP_ARCHIVE não encontrado." >&2
  exit 1
fi

RELEASE_DIR="/opt/fecart/releases/$RELEASE_ID"
CURRENT_LINK="/opt/fecart/current"
PREVIOUS_RELEASE=""

if [[ -L "$CURRENT_LINK" ]]; then
  PREVIOUS_RELEASE="$(readlink -f "$CURRENT_LINK")"
fi

echo "==> Iniciando deploy da release $RELEASE_ID..."
echo "==> Release anterior identificada: ${PREVIOUS_RELEASE:-nenhuma}"

install -d -o root -g root -m 0755 "$RELEASE_DIR"
tar -xzf "$APP_ARCHIVE" -C "$RELEASE_DIR"

cd "$RELEASE_DIR"
echo "==> Instalando dependências e compilando release..."
npm ci --omit=dev || npm ci
npm run build

echo "==> Atualizando symlink atômico /opt/fecart/current -> $RELEASE_DIR..."
ln -sfn "$RELEASE_DIR" /opt/fecart/current_next
mv -Tf /opt/fecart/current_next "$CURRENT_LINK"

echo "==> Reiniciando serviços do Fecart AI Share..."
systemctl restart fecart-relay || true
systemctl restart fecart-host || true

# Função de rollback automático
rollback() {
  local exit_code=$?
  echo "==> [FALHA NO DEPLOY] Código de saída: $exit_code. Iniciando rollback automático..." >&2
  if [[ -n "$PREVIOUS_RELEASE" && -d "$PREVIOUS_RELEASE" ]]; then
    echo "==> Revertendo symlink para $PREVIOUS_RELEASE..." >&2
    ln -sfn "$PREVIOUS_RELEASE" /opt/fecart/current_rollback
    mv -Tf /opt/fecart/current_rollback "$CURRENT_LINK"
    systemctl restart fecart-relay || true
    systemctl restart fecart-host || true
    echo "==> [ROLLBACK CONCLUÍDO] Sistema revertido com sucesso para a release anterior." >&2
  else
    echo "==> [AVISO] Nenhuma release anterior disponível para rollback automático." >&2
  fi
  exit "$exit_code"
}

trap rollback ERR

echo "==> Executando smoke tests de pós-publicação..."
sleep 3

# 1. Verificar serviços systemd ativos
systemctl is-active --quiet fecart-relay || { echo "fecart-relay não está ativo." >&2; false; }
systemctl is-active --quiet fecart-host || { echo "fecart-host não está ativo." >&2; false; }

# 2. Verificar /healthz
HEALTHZ="$(curl -fsS --max-time 5 http://127.0.0.1:10000/healthz)"
if [[ "$HEALTHZ" != *"ok"* ]]; then
  echo "Smoke check /healthz falhou: $HEALTHZ" >&2
  false
fi

# 3. Verificar /readyz (tolerância de até 15 segundos para conexão do host)
READY=0
for i in {1..15}; do
  READYZ="$(curl -fsS --max-time 3 http://127.0.0.1:10000/readyz 2>/dev/null || echo '')"
  if [[ "$READYZ" == *"ready"* ]]; then
    READY=1
    break
  fi
  sleep 1
done

if [[ $READY -ne 1 ]]; then
  echo "Smoke check /readyz falhou (host não sincronizou no tempo limite)." >&2
  false
fi

# Desarmar trap de erro após validação bem-sucedida
trap - ERR

echo "==> Smoke tests aprovados com sucesso!"

# Limpeza de releases antigas mantendo as 5 mais recentes
echo "==> Limpando releases antigas (mantendo as 5 mais recentes)..."
cd /opt/fecart/releases
ls -1dt */ 2>/dev/null | tail -n +6 | xargs rm -rf -- || true

rm -f "$APP_ARCHIVE"
echo "==> [DEPLOY CONCLUÍDO COM SUCESSO] Release $RELEASE_ID em produção."
