#!/bin/bash
set -euo pipefail

for file in \
  /tmp/20260825003902_allow_group_multi_device_sessions.sql \
  /tmp/20260825010000_fixed_five_hour_sessions.sql \
  /tmp/20260825210000_allow_immediate_partial_sessions.sql \
  /tmp/20260831042005_fix_five_hour_reservation_request.sql \
  /tmp/20260831042308_add_five_hour_reservation_helpers.sql \
  /tmp/20260831042416_align_reservation_integrity_with_five_hour_sessions.sql \
  /tmp/20260831042910_allow_owner_credential_activation.sql \
  /tmp/20260901200000_session_weekly_quota_budget.sql; do
  echo "Aplicando $file..."
  sudo -u postgres psql -d fecart -f "$file"
done

rm -f /tmp/202608*.sql /tmp/202609*.sql
echo 'Todas as migra��es mais recentes foram aplicadas com sucesso!'