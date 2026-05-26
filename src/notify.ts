import axios from 'axios'
import type { Config } from './config.js'

interface ErrorContext {
  channel: 'telegram' | 'webhook' | 'scheduler' | string
  sender?: string
  chatId?: string
  text?: string
  error: Error | unknown
}

export async function notifyMasterError(cfg: Config, ctx: ErrorContext): Promise<void> {
  if (!cfg.telegramBotToken || !cfg.telegramMasterChatId) return

  const err = ctx.error instanceof Error ? ctx.error : new Error(String(ctx.error))
  const lines = [
    `⚠️ Falha em ${ctx.channel}`,
    ctx.sender ? `From: ${ctx.sender}` : null,
    ctx.chatId ? `Chat: ${ctx.chatId}` : null,
    ctx.text ? `Msg: ${ctx.text.slice(0, 200)}` : null,
    '',
    `Erro: ${err.message}`,
    err.stack ? `Stack:\n${err.stack.split('\n').slice(0, 6).join('\n')}` : null,
  ].filter(Boolean).join('\n')

  try {
    await axios.post(`https://api.telegram.org/bot${cfg.telegramBotToken}/sendMessage`, {
      chat_id: cfg.telegramMasterChatId,
      text: lines,
    }, { timeout: 5000 })
  } catch {
    // não escalar erro do notificador
  }
}
