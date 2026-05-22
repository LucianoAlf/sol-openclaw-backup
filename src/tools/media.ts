import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

export function createMediaTools(openaiKey: string, supabaseUrl: string, supabaseKey: string) {
  const openai = new OpenAI({ apiKey: openaiKey })
  const db = createClient(supabaseUrl, supabaseKey)

  async function analyzeImage(args: { imageUrl: string; prompt: string }): Promise<string> {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: [
        { type: 'text', text: args.prompt },
        { type: 'image_url', image_url: { url: args.imageUrl } }
      ]}]
    })
    return response.choices[0]?.message?.content ?? 'Sem resultado de análise'
  }

  async function storeMedia(args: { phone: string; type: string; base64Content: string; mimeType: string }): Promise<string> {
    const fileName = `${args.phone}/${args.type}-${Date.now()}`
    const buffer = Buffer.from(args.base64Content, 'base64')
    const { error } = await db.storage.from('sol-media').upload(fileName, buffer, { contentType: args.mimeType })
    if (error) return `Error ao armazenar mídia: ${error.message}`
    return `ok: mídia salva em ${fileName}`
  }

  return { analyzeImage, storeMedia }
}
