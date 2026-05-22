import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { IncomingMessage } from './types.js'
import { SessionManager } from './session.js'
import { classifyMessage } from './router.js'
import { buildSystemPrompt } from './context-builder.js'
import { runLLM } from './llm.js'
import { createToolRegistry, executeTool } from './tools/index.js'
import type { Config } from './config.js'

const queues = new Map<string, Promise<void>>()

function enqueue(phone: string, fn: () => Promise<void>): void {
  const prev = queues.get(phone) ?? Promise.resolve()
  const next = prev.then(fn).catch(console.error)
  queues.set(phone, next)
}

export async function registerWebhook(app: FastifyInstance, session: SessionManager, cfg: Config): Promise<void> {
  app.post('/webhook/uazapi', async (req: FastifyRequest, reply: FastifyReply) => {
    reply.send({ ok: true })

    const body = req.body as Record<string, unknown>
    const phone = (body.phone ?? body.from) as string
    if (!phone) return

    const msg: IncomingMessage = {
      phone,
      type: body.type === 'audio' ? 'audio' : body.type === 'image' ? 'image' : 'text',
      text: body.text as string | undefined,
      audioUrl: body.audioUrl as string | undefined,
      imageUrl: body.imageUrl as string | undefined,
      caption: body.caption as string | undefined,
    }

    enqueue(phone, async () => {
      let contact = await session.getContact(phone)
      if (!contact) {
        const name = (body.pushName as string) ?? phone
        contact = { phone, display_name: name, type: 'aluno', unit: 'all', emusys_id: null, is_master: false, notes: null }
      }

      const classified = classifyMessage(msg, contact)
      const history = await session.getHistory(phone)
      const systemPrompt = buildSystemPrompt(classified.mode, cfg.workspacePath)
      const tools = createToolRegistry(cfg, cfg.workspacePath)

      let userText = msg.text ?? msg.caption ?? ''
      if (msg.type === 'audio' && msg.audioUrl) {
        const audioTool = tools.find(t => t.name === 'transcribe_audio')
        if (audioTool) userText = await audioTool.handler({ audioUrl: msg.audioUrl })
      }

      // Mestre: não salva no admin_conversas
      if (!contact.is_master) {
        await session.saveMessage(phone, contact.display_name, 'user', userText || '[mídia]')
      }

      const result = await runLLM({
        systemPrompt,
        messages: [...history, { role: 'user', content: userText || '[mídia recebida]' }],
        tools,
      })

      if (!contact.is_master) {
        await session.saveMessage(phone, contact.display_name, 'assistant', result.response)
      }

      const sendTool = tools.find(t => t.name === 'send_whatsapp')
      if (sendTool && result.response) {
        await sendTool.handler({ phone, message: result.response })
      }
    })
  })
}
