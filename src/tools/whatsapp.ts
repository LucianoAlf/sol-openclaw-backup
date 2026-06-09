import axios from 'axios'
import { sanitizeWhatsappText } from '../utils/whatsapp-format.js'

export function createWhatsappTools(uazapiUrl: string, uazapiToken: string, instance: string, openaiApiKey?: string) {
  const headers = { token: uazapiToken }

  async function markRead(messageId: string): Promise<void> {
    try {
      await axios.post(`${uazapiUrl}/message/markread`, { id: [messageId] }, { headers })
    } catch { /* silencioso */ }
  }

  async function setPresence(phone: string, presence: 'composing' | 'recording' | 'paused'): Promise<void> {
    try {
      await axios.post(`${uazapiUrl}/message/presence`, { number: phone, presence }, { headers })
    } catch { /* silencioso */ }
  }

  async function sendWhatsapp(args: { phone: string; message: string }): Promise<string> {
    try {
      const text = sanitizeWhatsappText(args.message)
      if (!text) return 'Error: mensagem vazia após sanitização'
      const res = await axios.post(`${uazapiUrl}/send/text`, { number: args.phone, text }, { headers })
      console.log('[whatsapp] send/text response:', JSON.stringify(res.data).slice(0, 200))
      return `ok: mensagem enviada para ${args.phone}`
    } catch (e: any) {
      console.error('[whatsapp] send/text error:', e.response?.data ?? e.message)
      return `Error: ${e.message}`
    }
  }

  async function sendAudio(args: { phone: string; text: string }, elevenLabsKey: string, voiceId: string): Promise<string> {
    try {
      const ttsRes = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        { text: args.text, model_id: 'eleven_multilingual_v2' },
        { headers: { 'xi-api-key': elevenLabsKey }, responseType: 'arraybuffer' }
      )
      const base64 = Buffer.from(ttsRes.data).toString('base64')
      await axios.post(`${uazapiUrl}/send/media`, { number: args.phone, type: 'ptt', file: `data:audio/mpeg;base64,${base64}` }, { headers })
      return `ok: áudio enviado para ${args.phone}`
    } catch (e: any) {
      return `Error ao enviar áudio: ${e.message}`
    }
  }

  async function getAudioUrl(messageId: string): Promise<string | null> {
    try {
      const res = await axios.post(
        `${uazapiUrl}/message/download`,
        { id: messageId, generate_mp3: true, return_link: true },
        { headers }
      )
      return (res.data as any).fileURL as string ?? null
    } catch (e: any) {
      console.error('[whatsapp] getAudioUrl error:', e.message)
      return null
    }
  }

  return { sendWhatsapp, sendAudio, markRead, setPresence, getAudioUrl }
}
