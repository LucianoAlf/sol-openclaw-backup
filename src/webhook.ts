import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { IncomingMessage } from './types.js'
import { SessionManager } from './session.js'
import { classifyMessage } from './router.js'
import { buildSystemPrompt } from './context-builder.js'
import { runLLM } from './llm.js'
import { createWhatsappTools } from './tools/whatsapp.js'
import { createAudioTools } from './tools/audio.js'
import type { Config } from './config.js'

const queues = new Map<string, Promise<void>>()

function enqueue(phone: string, fn: () => Promise<void>): void {
  const prev = queues.get(phone) ?? Promise.resolve()
  const next = prev.then(fn).catch(console.error)
  queues.set(phone, next)
}

export async function registerWebhook(app: FastifyInstance, session: SessionManager, cfg: Config): Promise<void> {
  const wa = createWhatsappTools(cfg.uazapiUrl, cfg.uazapiToken, cfg.uazapiInstance, cfg.openaiApiKey)

  app.post('/webhook/uazapi', async (req: FastifyRequest, reply: FastifyReply) => {
    reply.send({ ok: true })

    const body = req.body as Record<string, unknown>
    const message = body.message as Record<string, unknown> | undefined
    if (!message) return
    if (message.fromMe === true) return

    const senderPn = message.sender_pn as string | undefined
    if (!senderPn) return
    const phone = senderPn.replace('@s.whatsapp.net', '').replace('@c.us', '')
    const messageId = message.messageid as string | undefined

    const msgType = (message.type as string | undefined) ?? 'text'
    const mediaType = (message.mediaType as string | undefined) ?? ''
    const content = (message.content as Record<string, unknown> | undefined) ?? {}
    // UAZAPI: type="media" para qualquer mídia; mediaType especifica o subtipo
    const isAudio = msgType === 'audio' || msgType === 'ptt' || msgType === 'myaudio'
      || (msgType === 'media' && (mediaType === 'ptt' || mediaType === 'audio' || mediaType === 'myaudio'))
    const isImage = msgType === 'image'
      || (msgType === 'media' && mediaType === 'image')
    const mediaUrl = (content.URL ?? content.url ?? message.fileURL ?? message.audioUrl ?? message.imageUrl) as string | undefined
    const msg: IncomingMessage = {
      phone,
      type: isAudio ? 'audio' : isImage ? 'image' : 'text',
      text: message.text as string | undefined,
      audioUrl: isAudio ? (mediaUrl ?? 'pending') : undefined,
      imageUrl: isImage ? mediaUrl : undefined,
      caption: message.caption as string | undefined,
    }

    enqueue(phone, async () => {
      console.log(`[webhook] processando ${phone}`)

      if (messageId) await wa.markRead(messageId)
      await wa.setPresence(phone, 'composing')

      let contact = await session.getContact(phone)
      if (!contact) {
        const name = (message.senderName as string) ?? phone
        contact = { phone, display_name: name, type: 'aluno', unit: 'all', emusys_id: null, is_master: false, notes: null }
      }

      const classified = classifyMessage(msg, contact)
      const history = await session.getHistory(phone)
      const systemPrompt = buildSystemPrompt(classified.mode, cfg.workspacePath)
      let userText = msg.text ?? msg.caption ?? ''
      if (msg.type === 'audio' && messageId) {
        console.log(`[webhook] transcrevendo áudio, messageId: ${messageId}`)
        try {
          const mp3Url = await wa.getAudioUrl(messageId)
          if (mp3Url) {
            const { transcribeAudio } = createAudioTools(cfg.openaiApiKey, cfg.groqApiKey)
            const transcribePromise = transcribeAudio({ audioUrl: mp3Url })
            const timeoutPromise = new Promise<string>((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))
            userText = await Promise.race([transcribePromise, timeoutPromise])
          } else {
            userText = '[o usuário enviou um áudio mas não foi possível baixá-lo]'
          }
        } catch (e: any) {
          console.error('[webhook] transcrição falhou:', e.message)
          userText = '[o usuário enviou um áudio de voz — transcrição indisponível. Peça para reenviar em texto.]'
        }
        console.log(`[webhook] transcrição: "${userText.slice(0, 100)}"`)
      }

      await session.saveMessage(phone, contact.display_name, 'user', userText || '[mídia]')

      console.log(`[webhook] chamando LLM para ${phone} (mode: ${classified.mode})`)
      const result = await runLLM({
        systemPrompt,
        messages: [...history, { role: 'user', content: userText || '[mídia recebida]' }],
      })

      await session.saveMessage(phone, contact.display_name, 'assistant', result.response)

      console.log(`[webhook] resposta LLM: "${result.response.slice(0, 80)}"`)
      if (result.response) {
        await wa.sendWhatsapp({ phone, message: result.response })
      }
    })
  })
}
