import OpenAI from 'openai'
import axios from 'axios'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export function createAudioTools(openaiKey: string) {
  const openai = new OpenAI({ apiKey: openaiKey })

  async function transcribeAudio(args: { audioUrl: string }): Promise<string> {
    const tmpPath = path.join(os.tmpdir(), `sol-audio-${Date.now()}.ogg`)
    try {
      const res = await axios.get(args.audioUrl, { responseType: 'arraybuffer' })
      fs.writeFileSync(tmpPath, Buffer.from(res.data))
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tmpPath),
        model: 'whisper-1',
        language: 'pt',
      })
      return transcription.text
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    }
  }

  return { transcribeAudio }
}
