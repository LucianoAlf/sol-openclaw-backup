import axios from 'axios'

export function createWhatsappTools(uazapiUrl: string, uazapiToken: string, instance: string) {
  const headers = { Authorization: uazapiToken }
  const base = `${uazapiUrl}/instance/${instance}`

  async function sendWhatsapp(args: { phone: string; message: string }): Promise<string> {
    try {
      await axios.post(`${base}/sendText`, { phone: args.phone, message: args.message }, { headers })
      return `ok: mensagem enviada para ${args.phone}`
    } catch (e: any) {
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
      await axios.post(`${base}/sendAudio`, { phone: args.phone, audio: base64, mimetype: 'audio/mpeg' }, { headers })
      return `ok: áudio enviado para ${args.phone}`
    } catch (e: any) {
      return `Error ao enviar áudio: ${e.message}`
    }
  }

  return { sendWhatsapp, sendAudio }
}
