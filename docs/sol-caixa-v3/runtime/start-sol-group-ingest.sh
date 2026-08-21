#!/usr/bin/env bash
# Sobe o worker sol-group-ingest com supervisao (flock + loop de restart).
# Segue o mesmo padrao do lareport-sol-worker, que ja roda ha meses nesta VPS.
set -euo pipefail

export LOCK=/tmp/sol-group-ingest.lock
export LOG=/home/sol/.openclaw/workspace/memory/sol-group-ingest.stdout.log
export APP=/home/sol/.openclaw/workspace/scripts/sol-group-ingest/index.js
export NODE=/home/sol/.openclaw/tools/node-v22.22.0/bin/node

mkdir -p "$(dirname "$LOG")"

# flock -n: se ja existir uma instancia rodando (lock ocupado), sai na hora sem travar.
# O loop interno reinicia o processo sozinho se ele cair, com 5s de espera entre tentativas.
# Variaveis exportadas acima ficam disponiveis para o bash filho via ambiente
# (necessario porque o script do supervisor usa aspas simples, para que
# $(date -Is) e $code sejam avaliados a cada iteracao do loop, e nao uma vez so aqui).
exec /usr/bin/flock -n "$LOCK" /usr/bin/env bash -lc '
  cd "$(dirname "$APP")"
  while true; do
    echo "[$(date -Is)] supervisor starting sol-group-ingest" >> "$LOG"
    "$NODE" "$APP" >> "$LOG" 2>&1
    code=$?
    echo "[$(date -Is)] supervisor exited code=$code; restarting in 5s" >> "$LOG"
    sleep 5
  done
'
