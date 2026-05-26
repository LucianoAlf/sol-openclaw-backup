#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="/opt/sol-adm/.env"
STATUS_FILE="/opt/sol-adm/workspace/memory/backup-status.json"
TARGET_FILE="/opt/sol-adm/workspace/memory/heartbeat-telegram-target.json"

set -a
source "$ENV_FILE"
set +a

read -r CHAT_ID THREAD_ID < <(node - "$TARGET_FILE" "$TELEGRAM_MASTER_CHAT_ID" <<'NODE'
const fs = require('fs')
const [targetFile, fallbackChatId] = process.argv.slice(2)
let chatId = fallbackChatId || ''
let threadId = ''
try {
  const target = JSON.parse(fs.readFileSync(targetFile, 'utf8'))
  chatId = target.chat_id ? String(target.chat_id) : chatId
  threadId = target.message_thread_id ? String(target.message_thread_id) : ''
} catch {}
console.log(`${chatId} ${threadId}`)
NODE
)

TEXT="$(node - "$STATUS_FILE" <<'NODE'
const fs = require('fs')
const statusFile = process.argv[2]
const now = Date.now()

function fmt(iso) {
  if (!iso) return 'sem registro'
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(iso))
}

if (!fs.existsSync(statusFile)) {
  console.log('Backup diário: ERRO\nNenhum status de execução encontrado.')
  process.exit(0)
}

const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'))
const finishedAt = status.finished_at ? new Date(status.finished_at).getTime() : 0
const ageHours = finishedAt ? (now - finishedAt) / 36e5 : Infinity
const fresh = ageHours <= 6
const ok = status.ok === true && status.exit_code === 0 && fresh

const lines = [
  `Backup diário: ${ok ? 'SUCESSO' : 'ERRO'}`,
  `Finalizado: ${fmt(status.finished_at)}`,
  `Exit code: ${status.exit_code ?? 'sem registro'}`,
]

if (!fresh) lines.push('Alerta: não há execução recente do backup.')
if (status.output_tail) {
  lines.push('', 'Última saída:', String(status.output_tail).slice(-1200))
}

console.log(lines.join('\n'))
NODE
)"

PAYLOAD="$(node - "$CHAT_ID" "$THREAD_ID" "$TEXT" <<'NODE'
const [chatId, threadId, text] = process.argv.slice(2)
const payload = { chat_id: chatId, text }
if (threadId) payload.message_thread_id = Number(threadId)
process.stdout.write(JSON.stringify(payload))
NODE
)"

curl -fsS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" >/dev/null
