#!/usr/bin/env bash
set -euo pipefail

APP="${SOL_CAIXA_V3_SHADOW_APP:-/home/sol/.openclaw/workspace/scripts/sol-caixa-v3-shadow-worker.js}"
NODE="${SOL_CAIXA_V3_SHADOW_NODE:-/home/sol/.openclaw/tools/node-v22.22.0/bin/node}"
LOG="${SOL_CAIXA_V3_SHADOW_STDOUT:-/home/sol/.openclaw/workspace/memory/sol-caixa-v3-shadow-worker.stdout.log}"
LOCK="${SOL_CAIXA_V3_SHADOW_LOCK:-/tmp/sol-caixa-v3-shadow-worker.lock}"

cd "$(dirname "$APP")"
exec /usr/bin/flock -n "$LOCK" /usr/bin/env bash -lc '
  set -euo pipefail
  while true; do
    echo "[$(date -Is)] supervisor starting sol-caixa-v3-shadow-worker" >> "'"$LOG"'"
    "'"$NODE"'" "'"$APP"'" >> "'"$LOG"'" 2>&1
    code=$?
    echo "[$(date -Is)] supervisor exited code=$code; restarting in 5s" >> "'"$LOG"'"
    sleep 5
  done
'
