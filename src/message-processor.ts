import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { Config } from './config.js'
import { buildSystemPrompt } from './context-builder.js'
import { runLLM } from './llm.js'
import { classifyMessage } from './router.js'
import { SessionManager } from './session.js'
import { createToolRegistry } from './tools/index.js'
import type { Contact, IncomingMessage } from './types.js'

// ─── Handlers de comando master ───────────────────────────────────────────────

function cmdStatus(cfg: Config): string {
  const uptimeSecs = Math.floor(process.uptime())
  const h = Math.floor(uptimeSecs / 3600)
  const m = Math.floor((uptimeSecs % 3600) / 60)

  let pkg = { version: '?' }
  try { pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')) } catch {}

  const memMb = Math.round(process.memoryUsage().rss / 1024 / 1024)

  return [
    `🤖 *Sol ADM* v${pkg.version}`,
    `⏱ Uptime: ${h}h ${m}m`,
    `🧠 Modelo: openai-codex/gpt-5.5 · oauth (subscription)`,
    `🔌 App-server: ws://172.21.0.1:9100`,
    `💾 RAM: ${memMb}MB · Host: ${os.hostname()}`,
    `📁 Workspace: ${cfg.workspacePath}`,
    `📱 WhatsApp: UAZAPI ativo`,
    `✈️ Telegram: @Sol_adm_bot ativo`,
  ].join('\n')
}

function cmdHelp(): string {
  return [
    `📋 *Comandos disponíveis*`,
    ``,
    `*Diagnóstico*`,
    `/status — informações do sistema`,
    `/ping — verificar latência`,
    `/logs — últimas linhas do log`,
    ``,
    `*Sessão*`,
    `/clear — limpar histórico da sessão`,
    `/history — ver últimas mensagens`,
    ``,
    `*Memória*`,
    `/memory — ver conteúdo do MEMORY.md`,
    `/lembrar <texto> — salvar algo na memória`,
    ``,
    `*Ajuda*`,
    `/help — esta mensagem`,
  ].join('\n')
}

function cmdPing(): string {
  return `🏓 Pong! ${Date.now() % 10000}ms ref`
}

function cmdHistory(workspacePath: string): string {
  const p = path.join(workspacePath, 'memory', 'session-master.json')
  try {
    const msgs: Array<{ role: string; content: string }> = JSON.parse(fs.readFileSync(p, 'utf-8'))
    const last = msgs.slice(-10)
    const lines = last.map(m => `*${m.role === 'user' ? 'Você' : 'Sol'}:* ${m.content.slice(0, 120)}`)
    return `📜 *Últimas ${last.length} mensagens:*\n\n${lines.join('\n\n')}`
  } catch {
    return 'Nenhum histórico encontrado.'
  }
}

function cmdClear(workspacePath: string): string {
  const p = path.join(workspacePath, 'memory', 'session-master.json')
  try {
    fs.writeFileSync(p, '[]', 'utf-8')
    return '🗑 Histórico da sessão limpo.'
  } catch {
    return 'Erro ao limpar histórico.'
  }
}

function cmdMemory(workspacePath: string): string {
  const p = path.join(workspacePath, 'MEMORY.md')
  try {
    const content = fs.readFileSync(p, 'utf-8').trim()
    return `🧠 *MEMORY.md:*\n\n${content.slice(0, 3000)}`
  } catch {
    return 'MEMORY.md não encontrado.'
  }
}

function cmdLembrar(workspacePath: string, texto: string): string {
  if (!texto.trim()) return 'Use: /lembrar <texto>'
  const today = new Date().toISOString().split('T')[0]
  const dailyPath = path.join(workspacePath, 'memory', `${today}.md`)
  const entry = `\n- ${texto.trim()}`
  try {
    if (!fs.existsSync(dailyPath)) {
      fs.writeFileSync(dailyPath, `# ${today}${entry}`, 'utf-8')
    } else {
      fs.appendFileSync(dailyPath, entry, 'utf-8')
    }
    return `✅ Anotado na memória de hoje (${today}).`
  } catch {
    return 'Erro ao salvar na memória.'
  }
}

function cmdLogs(): string {
  // Lê o próprio processo — log vai para stdout capturado pelo Docker
  return '📋 Use `docker logs sol-adm --tail 30` na VPS para ver os logs em tempo real.'
}

// ─── Dispatcher de comandos ───────────────────────────────────────────────────

function handleMasterCommand(text: string, cfg: Config): string | null {
  const cmd = text.trim()
  const lower = cmd.toLowerCase()

  if (lower === '/status') return cmdStatus(cfg)
  if (lower === '/help') return cmdHelp()
  if (lower === '/ping') return cmdPing()
  if (lower === '/history') return cmdHistory(cfg.workspacePath)
  if (lower === '/clear') return cmdClear(cfg.workspacePath)
  if (lower === '/memory') return cmdMemory(cfg.workspacePath)
  if (lower === '/logs') return cmdLogs()
  if (lower.startsWith('/lembrar ')) return cmdLembrar(cfg.workspacePath, cmd.slice(9))
  if (lower === '/lembrar') return 'Use: /lembrar <texto>'

  return null
}

// ─── Fila e processador principal ────────────────────────────────────────────

interface ProcessIncomingMessageArgs {
  channel: string
  senderId: string
  senderName: string
  message: IncomingMessage
  session: SessionManager
  cfg: Config
  sendText: (message: string) => Promise<void>
  beforeRun?: () => Promise<void>
  contactOverride?: Contact
}

const queues = new Map<string, Promise<void>>()

export function enqueueMessage(key: string, fn: () => Promise<void>): Promise<void> {
  const prev = queues.get(key) ?? Promise.resolve()
  const next = prev.then(fn).catch(console.error)
  queues.set(key, next)
  return next
}

export async function processIncomingMessage(args: ProcessIncomingMessageArgs): Promise<void> {
  const { channel, senderId, senderName, message, session, cfg, sendText, beforeRun, contactOverride } = args

  console.log(`[${channel}] processando ${senderId}`)
  if (beforeRun) await beforeRun()

  let contact = contactOverride ?? await session.getContact(senderId)
  if (!contact) {
    contact = {
      phone: senderId,
      display_name: senderName || senderId,
      type: 'aluno',
      unit: 'all',
      emusys_id: null,
      is_master: false,
      notes: null,
    }
  }

  const classified = classifyMessage(message, contact)
  const history = await session.getHistory(senderId)
  const systemPrompt = await buildSystemPrompt(classified.mode, cfg.workspacePath, contact)
  const tools = createToolRegistry(cfg, cfg.workspacePath, { role: 'master' })

  let userText = message.text ?? message.caption ?? ''
  if (message.type === 'audio' && message.audioUrl) {
    const audioTool = tools.find(t => t.name === 'transcribe_audio')
    if (audioTool) userText = await audioTool.handler({ audioUrl: message.audioUrl })
  }

  // Comandos master — resposta instantânea sem LLM
  if (contact.is_master) {
    const cmdResponse = handleMasterCommand(userText, cfg)
    if (cmdResponse !== null) {
      await sendText(cmdResponse)
      return
    }
  }

  await session.saveMessage(senderId, contact.display_name, 'user', userText || '[midia]')

  console.log(`[${channel}] chamando LLM para ${senderId} (mode: ${classified.mode})`)
  const result = await runLLM({
    systemPrompt,
    messages: [...history, { role: 'user', content: userText || '[midia recebida]' }],
    timeoutMs: contact.is_master ? 300000 : 90000,
  })

  await session.saveMessage(senderId, contact.display_name, 'assistant', result.response)

  console.log(`[${channel}] resposta LLM: "${result.response.slice(0, 80)}"`)
  if (result.response) {
    await sendText(result.response)
  }
}
