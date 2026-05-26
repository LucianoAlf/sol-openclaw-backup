import { execSync } from 'child_process'
import * as fs from 'fs'

const CONTAINER_NAME = 'sol-adm'
const ENV_PATH = '/app/.env'

// Whitelist de chaves editáveis via tool. Service keys, tokens e segredos ficam de fora.
const EDITABLE_KEYS = new Set([
  'TELEGRAM_MASTER_CHAT_ID',
  'HEARTBEAT_DRY_RUN',
  'LOG_LEVEL',
  'DEBUG',
])

export function readLogs(args: { lines?: number; grep?: string }): string {
  const n = Math.min(Math.max(args.lines ?? 80, 1), 500)
  try {
    const out = execSync(`docker logs ${CONTAINER_NAME} --tail ${n} 2>&1`, {
      encoding: 'utf-8',
      timeout: 8000,
      maxBuffer: 5 * 1024 * 1024,
    })
    if (!args.grep) return out || '(sem logs)'
    const re = new RegExp(args.grep, 'i')
    return out.split('\n').filter(l => re.test(l)).join('\n') || '(nenhuma linha bate com o filtro)'
  } catch (e: any) {
    return `Error: ${e.message}`
  }
}

export function editEnv(args: { key: string; value: string }): string {
  const key = args.key.trim()
  if (!EDITABLE_KEYS.has(key)) {
    return `Error: chave "${key}" não está na whitelist. Editáveis: ${[...EDITABLE_KEYS].join(', ')}`
  }
  if (!fs.existsSync(ENV_PATH)) return `Error: ${ENV_PATH} não encontrado`

  const lines = fs.readFileSync(ENV_PATH, 'utf-8').split('\n')
  const idx = lines.findIndex(l => l.startsWith(`${key}=`))
  const newLine = `${key}=${args.value}`

  if (idx >= 0) lines[idx] = newLine
  else lines.push(newLine)

  fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf-8')
  return `OK: ${key} atualizado. Use restart_self para aplicar.`
}

const RESTART_LOCK = '/tmp/sol-restart.lock'
const RESTART_COOLDOWN_MS = 5 * 60 * 1000

export function restartSelf(args: { confirm?: boolean; master_token?: string; reason?: string }): string {
  // Exige token master explícito — bloqueia loops de auto-restart por iniciativa do LLM
  if (args.master_token !== 'RESTART_NOW') {
    return 'Restart bloqueado. Esta tool só pode ser usada quando o master pedir EXPLICITAMENTE para reiniciar e fornecer { master_token: "RESTART_NOW" }. Se você só editou .env, AVISE o master e peça pra ele confirmar com /restart.'
  }
  if (!args.confirm) {
    return 'Confirmação necessária. Chame com { confirm: true, master_token: "RESTART_NOW", reason: "..." }.'
  }
  if (!args.reason || args.reason.length < 10) {
    return 'reason obrigatório (mínimo 10 chars). Descreva por que está reiniciando.'
  }
  // Cooldown — nunca mais de 1 restart a cada 5min
  if (fs.existsSync(RESTART_LOCK)) {
    const last = fs.statSync(RESTART_LOCK).mtimeMs
    const elapsed = Date.now() - last
    if (elapsed < RESTART_COOLDOWN_MS) {
      const wait = Math.ceil((RESTART_COOLDOWN_MS - elapsed) / 1000)
      return `Cooldown: último restart há ${Math.floor(elapsed/1000)}s. Aguarde ${wait}s antes do próximo.`
    }
  }
  try {
    fs.writeFileSync(RESTART_LOCK, JSON.stringify({ at: Date.now(), reason: args.reason }))
    // sleep maior pra dar tempo da resposta LLM ser enviada antes do kill
    execSync(`(sleep 5 && docker restart ${CONTAINER_NAME}) &`, { timeout: 2000 })
    return `Restart agendado em 5s. Motivo: ${args.reason}. Vou cair e voltar.`
  } catch (e: any) {
    return `Error: ${e.message}`
  }
}
