import type { ConversationMessage, LLMResult } from './types.js'

// ─── Prompt builder ───────────────────────────────────────────────────────────

export function buildNativePrompt(systemPrompt: string, messages: ConversationMessage[]): string {
  const history = messages.map(m => `${m.role === 'user' ? 'Usuário' : 'Sol'}: ${m.content}`).join('\n\n')
  return `${systemPrompt}\n\n## Conversa\n${history}`
}

// ─── Codex App-Server Client (WebSocket persistente) ─────────────────────────

// Host Docker gateway — app-server roda no host, container acessa via socat
const APP_SERVER_URL = process.env.APP_SERVER_URL ?? 'ws://172.21.0.1:9100'

type PendingRequest = { resolve: (v: any) => void; reject: (e: Error) => void }

class AppServerClient {
  private ws: InstanceType<typeof WebSocket> | null = null
  private msgId = 0
  private pending = new Map<number, PendingRequest>()
  private handlers = new Map<string, Set<(p: any) => void>>()
  private _readyResolve!: () => void
  private _readyReject!: (e: Error) => void
  _ready: Promise<void>

  constructor(private url: string) {
    this._ready = new Promise((res, rej) => {
      this._readyResolve = res
      this._readyReject = rej
    })
    this._connect()
  }

  private _connect() {
    try {
      const ws = new WebSocket(this.url) as any
      this.ws = ws

      ws.onopen = async () => {
        try {
          await this._sendRaw('initialize', {
            clientInfo: { name: 'sol-adm', version: '1.0.0' },
            capabilities: null,
          })
          this._readyResolve()
          console.log('[app-server] conectado e inicializado')
        } catch (e: any) {
          console.error('[app-server] falha no initialize:', e.message)
          this._readyReject(e)
        }
      }

      ws.onmessage = (evt: any) => {
        let msg: any
        try { msg = JSON.parse(typeof evt.data === 'string' ? evt.data : evt.data.toString()) }
        catch { return }

        if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!
          this.pending.delete(msg.id)
          if (msg.error) p.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)))
          else p.resolve(msg.result ?? null)
        } else if (msg.method) {
          this.handlers.get(msg.method)?.forEach(h => {
            try { h(msg.params) } catch {}
          })
        }
      }

      ws.onerror = () => {}
      ws.onclose = () => {
        console.log('[app-server] conexão fechada, reconectando em 3s...')
        this._ready = new Promise((res, rej) => {
          this._readyResolve = res
          this._readyReject = rej
        })
        setTimeout(() => this._connect(), 3000)
      }
    } catch {
      setTimeout(() => this._connect(), 3000)
    }
  }

  private _sendRaw(method: string, params: any): Promise<any> {
    const id = ++this.msgId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws!.send(JSON.stringify({ id, method, params }))
    })
  }

  async request(method: string, params: any): Promise<any> {
    await this._ready
    return this._sendRaw(method, params)
  }

  on(method: string, handler: (p: any) => void): () => void {
    if (!this.handlers.has(method)) this.handlers.set(method, new Set())
    this.handlers.get(method)!.add(handler)
    return () => this.handlers.get(method)?.delete(handler)
  }
}

let _client: AppServerClient | null = null

function getClient(): AppServerClient {
  if (!_client) _client = new AppServerClient(APP_SERVER_URL)
  return _client
}

// ─── Helpers de protocolo ─────────────────────────────────────────────────────

async function startThread(client: AppServerClient): Promise<string> {
  const threadStarted = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('thread/started timeout')), 8000)
    const off = client.on('thread/started', (p: { thread: { id: string } }) => {
      clearTimeout(timeout)
      off()
      resolve(p.thread.id)
    })
  })

  const result = await client.request('thread/start', {
    ephemeral: true,
    approvalPolicy: 'never',
  })

  const threadId = result?.id ?? result?.thread?.id
  if (threadId) return threadId
  return threadStarted
}

async function runTurn(
  client: AppServerClient,
  threadId: string,
  prompt: string,
  timeoutMs: number,
): Promise<string> {
  const chunks: string[] = []

  const offDelta = client.on('item/agentMessage/delta', (p: { threadId: string; delta: string }) => {
    if (p.threadId === threadId) chunks.push(p.delta)
  })

  const turnDone = new Promise<void>((resolve, reject) => {
    const offDone = client.on('turn/completed', (p: { threadId: string }) => {
      if (p.threadId !== threadId) return
      offDone()
      offDelta()
      resolve()
    })
    setTimeout(() => {
      offDelta()
      reject(new Error(`timeout após ${timeoutMs / 1000}s`))
    }, timeoutMs)
  })

  await client.request('turn/start', {
    threadId,
    input: [{ type: 'text', text: prompt, text_elements: [] }],
    approvalPolicy: 'never',
    sandboxPolicy: { type: 'dangerFullAccess' },
  })

  await turnDone
  return chunks.join('')
}

// ─── runLLM ───────────────────────────────────────────────────────────────────

export async function runLLM(opts: {
  systemPrompt: string
  messages: ConversationMessage[]
  timeoutMs?: number
}): Promise<LLMResult> {
  const { systemPrompt, messages, timeoutMs = 120000 } = opts
  const client = getClient()

  try {
    await Promise.race([
      client._ready,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('app-server indisponível')), 10000)),
    ])
  } catch (e: any) {
    console.error('[llm] app-server não está pronto:', e.message)
    return { response: 'Desculpe, tive um problema interno. Tente novamente em instantes.', toolCalls: [] }
  }

  const prompt = buildNativePrompt(systemPrompt, messages)

  let threadId: string
  try {
    threadId = await startThread(client)
  } catch (e: any) {
    console.error('[llm] erro ao criar thread:', e.message)
    return { response: 'Desculpe, tive um problema interno. Tente novamente em instantes.', toolCalls: [] }
  }

  try {
    const response = await runTurn(client, threadId, prompt, timeoutMs)
    return { response, toolCalls: [] }
  } catch (e: any) {
    console.error('[llm] erro no turn:', e.message)
    return { response: 'Desculpe, tive um problema interno. Tente novamente em instantes.', toolCalls: [] }
  }
}
