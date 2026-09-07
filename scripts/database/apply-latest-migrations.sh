#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
exec node --env-file=.env scripts/database/apply-latest-migrations.mjs
