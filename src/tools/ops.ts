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

export function restartSelf(args: { confirm?: boolean }): string {
  if (!args.confirm) {
    return 'Confirmação necessária. Chame de novo com { confirm: true } se realmente quer reiniciar o container (a thread atual será perdida).'
  }
  try {
    // detached: o restart mata o próprio processo; não esperamos resposta
    execSync(`(sleep 1 && docker restart ${CONTAINER_NAME}) &`, { timeout: 2000 })
    return 'Restart agendado em 1s. Vou cair e voltar.'
  } catch (e: any) {
    return `Error: ${e.message}`
  }
}
