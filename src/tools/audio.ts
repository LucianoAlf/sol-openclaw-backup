import OpenAI from 'openai'
import axios from 'axios'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export function createAudioTools(openaiKey: string, groqKey?: string) {
  async function transcribeAudio(args: { audioUrl: string }): Promise<string> {
    const tmpPath = path.join(os.tmpdir(), `sol-audio-${Date.now()}.mp3`)
    try {
      const res = await axios.get(args.audioUrl, { responseType: 'arraybuffer', timeout: 10000 })
      fs.writeFileSync(tmpPath, Buffer.from(res.data))

      // Tenta Groq primeiro (gratuito), depois OpenAI
      const providers = []
      if (groqKey) providers.push({ key: groqKey, baseURL: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3-turbo' })
      if (openaiKey) providers.push({ key: openaiKey, baseURL: undefined, model: 'whisper-1' })

      for (const p of providers) {
        try {
          const client = new OpenAI({ apiKey: p.key, ...(p.baseURL ? { baseURL: p.baseURL } : {}) })
          const result = await client.audio.transcriptions.create({
            file: fs.createReadStream(tmpPath),
            model: p.model,
            language: 'pt',
          })
          console.log(`[audio] transcrição (${p.baseURL ? 'groq' : 'openai'}): "${result.text.slice(0, 80)}"`)
          return result.text
        } catch (e: any) {
          console.error(`[audio] ${p.baseURL ? 'groq' : 'openai'} erro:`, e.message?.slice(0, 100))
        }
      }
      return '[não foi possível transcrever o áudio]'
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    }
  }

  return { transcribeAudio }
}
