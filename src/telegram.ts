import axios from 'axios'
import * as fs from 'fs'
import * as path from 'path'
import type { Config } from './config.js'
import { enqueueMessage, processIncomingMessage } from './message-processor.js'
import { SessionManager } from './session.js'
import type { Contact, IncomingMessage } from "./types.js"
import { notifyMasterError } from "./notify.js"

interface TelegramChat {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  type?: string
}

interface PhotoSize {
  file_id: string
  file_unique_id: string
  width: number
  height: number
  file_size?: number
}

interface TelegramMessage {
  message_id: number
  message_thread_id?: number
  chat: TelegramChat
  from?: TelegramChat & { is_bot?: boolean }
  text?: string
  caption?: string
  photo?: PhotoSize[]
  document?: { file_id: string; mime_type?: string }
  voice?: { file_id: string; duration: number; mime_type?: string }
  audio?: { file_id: string; duration: number; mime_type?: string }
}

interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

interface TelegramApiResponse<T> {
  ok: boolean
  result: T
  description?: string
}

function displayName(message: TelegramMessage): string {
  const user = message.from ?? message.chat
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
  return name || user.username || String(message.chat.id)
}

function offsetPath(workspacePath: string): string {
  return path.join(workspacePath, 'memory', 'telegram-offset.json')
}

function readOffset(workspacePath: string): number | undefined {
  const p = offsetPath(workspacePath)
  if (!fs.existsSync(p)) return undefined
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as { offset?: number }
    return parsed.offset
  } catch {
    return undefined
  }
}

function writeOffset(workspacePath: string, offset: number): void {
  const p = offsetPath(workspacePath)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify({ offset }, null, 2), 'utf-8')
}

function chatsPath(workspacePath: string): string {
  return path.join(workspacePath, 'memory', 'telegram-chats.json')
}

function recordTelegramChat(workspacePath: string, message: TelegramMessage): void {
  const p = chatsPath(workspacePath)
  const user = message.from ?? message.chat
  const chatId = String(message.chat.id)
  let chats: Record<string, unknown> = {}

  if (fs.existsSync(p)) {
    try {
      chats = JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>
    } catch {
      chats = {}
    }
  }

  chats[chatId] = {
    chat_id: chatId,
    chat_type: message.chat.type,
    first_name: user.first_name,
    last_name: user.last_name,
    username: user.username,
    last_text: message.text,
    last_seen_at: new Date().toISOString(),
  }

  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(chats, null, 2), 'utf-8')
}

function chunkTelegramText(text: string): string[] {
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += 3900) {
    chunks.push(text.slice(i, i + 3900))
  }
  return chunks.length ? chunks : ['']
}

function telegramMasterContact(cfg: Config, chatId: string): Contact | undefined {
  if (!cfg.telegramMasterChatId || cfg.telegramMasterChatId !== chatId) return undefined
  return {
    phone: `tg:${chatId}`,
    display_name: 'Admin',
    type: 'master',
    unit: 'all',
    emusys_id: null,
    is_master: true,
    notes: null,
  }
}

export async function startTelegramBot(cfg: Config, session: SessionManager): Promise<void> {
  if (!cfg.telegramBotToken) {
    console.log('[telegram] token ausente; bot desativado')
    return
  }

  const baseUrl = `https://api.telegram.org/bot${cfg.telegramBotToken}`
  let offset = readOffset(cfg.workspacePath)
  let stopped = false

  async function sendTelegram(chatId: number, text: string, threadId?: number): Promise<void> {
    for (const chunk of chunkTelegramText(text)) {
      await axios.post(`${baseUrl}/sendMessage`, {
        chat_id: chatId,
        ...(threadId ? { message_thread_id: threadId } : {}),
        text: chunk,
      })
      console.log(`[telegram] resposta enviada para ${chatId}`)
    }
  }


  async function sendTyping(chatId: number, threadId?: number): Promise<() => void> {
    const send = () => axios.post(`${baseUrl}/sendChatAction`, {
      chat_id: chatId,
      ...(threadId ? { message_thread_id: threadId } : {}),
      action: 'typing',
    }).catch(() => {})
    await send()
    const interval = setInterval(send, 4000)
    return () => clearInterval(interval)
  }

  async function handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message
    if (!message || message.from?.is_bot) return

    console.log(`[telegram] update ${update.update_id} recebido de ${message.chat.id}`)
    recordTelegramChat(cfg.workspacePath, message)

    const chatId = String(message.chat.id)
    const fromId = message.from?.id ? String(message.from.id) : undefined
    const masterContact = telegramMasterContact(cfg, fromId ?? chatId) ?? telegramMasterContact(cfg, chatId)
    const senderId = masterContact ? `tg:${cfg.telegramMasterChatId}` : `tg:${chatId}`
    const text = message.text?.trim() ?? message.caption?.trim()
    const threadId = message.message_thread_id

    // Resolver URL de imagem via Telegram getFile API
    let imageUrl: string | undefined
    if (message.photo && message.photo.length > 0) {
      const largest = message.photo[message.photo.length - 1]
      try {
        const fileRes = await axios.get<{ ok: boolean; result: { file_path: string } }>(
          `${baseUrl}/getFile?file_id=${largest.file_id}`
        )
        if (fileRes.data.ok) {
          imageUrl = `https://api.telegram.org/file/bot${cfg.telegramBotToken}/${fileRes.data.result.file_path}`
        }
      } catch {}
    }

    // Resolver URL de áudio (voice note ou audio file)
    let audioUrl: string | undefined
    const audioFileId = message.voice?.file_id ?? message.audio?.file_id
    if (audioFileId) {
      try {
        const fileRes = await axios.get<{ ok: boolean; result: { file_path: string } }>(
          `${baseUrl}/getFile?file_id=${audioFileId}`
        )
        if (fileRes.data.ok) {
          audioUrl = `https://api.telegram.org/file/bot${cfg.telegramBotToken}/${fileRes.data.result.file_path}`
        }
      } catch {}
    }

    if (!text && !imageUrl && !audioUrl) {
      try { await sendTelegram(message.chat.id, 'Por enquanto só processo textos, imagens e áudios por aqui.', threadId) } catch {}
      return
    }

    if (text === '/status' && masterContact) {
      await sendTelegram(message.chat.id, [
        'Status: Telegram ativo.',
        'Bot: @Sol_adm_bot.',
        `Master: ${fromId ?? chatId}.`,
        'Container: sol-adm online.',
      ].join('\n'), threadId)
      return
    }

    const incoming: IncomingMessage = {
      phone: senderId,
      type: audioUrl ? 'audio' : imageUrl ? 'image' : 'text',
      text,
      imageUrl,
      audioUrl,
    }

    const queueKey = threadId ? `${senderId}:thread:${threadId}` : senderId

    await enqueueMessage(queueKey, async () => {
      const stopTyping = await sendTyping(message.chat.id, threadId)
      try {
        await processIncomingMessage({
          channel: 'telegram',
          senderId,
          senderName: displayName(message),
          message: incoming,
          session,
          cfg,
          contactOverride: masterContact,
          sendText: async (response) => sendTelegram(message.chat.id, response, threadId),
        })
      } catch (e: any) {
        console.error('[telegram] erro ao processar mensagem:', e.message); void notifyMasterError(cfg, { channel: 'telegram', sender: displayName(message), chatId: String(message.chat.id), text: text || (audioUrl ? '[audio]' : imageUrl ? '[image]' : ''), error: e })
        await sendTelegram(message.chat.id, 'Tive um problema interno ao processar essa mensagem. Pode tentar de novo?', threadId)
      } finally {
        stopTyping()
      }
    })
  }

  async function poll(): Promise<void> {
    while (!stopped) {
      try {
        const res = await axios.get<TelegramApiResponse<TelegramUpdate[]>>(`${baseUrl}/getUpdates`, {
          params: {
            timeout: 50,
            offset,
            allowed_updates: JSON.stringify(['message']),
          },
          timeout: 60000,
        })

        for (const update of res.data.result) {
          offset = update.update_id + 1
          writeOffset(cfg.workspacePath, offset)
          void handleUpdate(update).catch((e: any) => {
            console.error('[telegram] erro em handleUpdate:', e.message)
            void notifyMasterError(cfg, { channel: 'telegram-update', error: e })
          })
        }
      } catch (e: any) {
        const detail = e.response?.data?.description ?? e.message
        console.error('[telegram] erro no polling:', detail)
        await new Promise(resolve => setTimeout(resolve, 5000))
      }
    }
  }

  const me = await axios.get<TelegramApiResponse<{ username?: string }>>(`${baseUrl}/getMe`)
  console.log(`[telegram] bot ativo${me.data.result.username ? `: @${me.data.result.username}` : ''}`)

  void poll()
}
