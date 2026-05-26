#!/usr/bin/env bash
set -uo pipefail

BACKUP_SCRIPT="/opt/sol-adm/backup.sh"
STATUS_FILE="/opt/sol-adm/workspace/memory/backup-status.json"
LOG_FILE="/var/log/sol-adm-backup.log"
TMP_OUTPUT="$(mktemp)"
STARTED_AT="$(date -Is)"

mkdir -p "$(dirname "$STATUS_FILE")" "$(dirname "$LOG_FILE")"

bash "$BACKUP_SCRIPT" >"$TMP_OUTPUT" 2>&1
EXIT_CODE=$?
FINISHED_AT="$(date -Is)"

cat "$TMP_OUTPUT" >> "$LOG_FILE"
printf '\n[%s] backup exit_code=%s\n' "$FINISHED_AT" "$EXIT_CODE" >> "$LOG_FILE"

node - "$STATUS_FILE" "$STARTED_AT" "$FINISHED_AT" "$EXIT_CODE" "$TMP_OUTPUT" <<'NODE'
const fs = require('fs')
const [statusFile, startedAt, finishedAt, exitCode, outputFile] = process.argv.slice(2)
const output = fs.readFileSync(outputFile, 'utf8').trim()
const payload = {
  job: 'sol-adm-backup',
  started_at: startedAt,
  finished_at: finishedAt,
  exit_code: Number(exitCode),
  ok: Number(exitCode) === 0,
  output_tail: output.split('\n').slice(-20).join('\n'),
}
fs.writeFileSync(statusFile, JSON.stringify(payload, null, 2) + '\n')
NODE

rm -f "$TMP_OUTPUT"
exit "$EXIT_CODE"
