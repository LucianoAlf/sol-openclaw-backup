import { z } from 'zod'

const schema = z.object({
  port: z.coerce.number().default(3001),
  uazapiUrl: z.string().url(),
  uazapiToken: z.string().min(1),
  uazapiInstance: z.string().min(1),
  supabaseUrl: z.string().url(),
  supabaseServiceKey: z.string().min(1),
  supabaseStudioId: z.string().min(1),
  supabaseFolhaId: z.string().min(1),
  supabaseWorkshopsId: z.string().min(1),
  supabaseExtraServiceKey: z.string().min(1),
  openaiApiKey: z.string().min(1),
  elevenlabsApiKey: z.string().min(1),
  elevenlabsVoiceId: z.string().min(1),
  masterPhone: z.string().min(10),
  solCaixaId: z.coerce.number().default(3),
  workspacePath: z.string().default('./workspace'),
})

export type Config = z.infer<typeof schema>

export function loadConfig(): Config {
  return schema.parse({
    port: process.env.PORT,
    uazapiUrl: process.env.UAZAPI_URL,
    uazapiToken: process.env.UAZAPI_TOKEN,
    uazapiInstance: process.env.UAZAPI_INSTANCE,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY,
    supabaseStudioId: process.env.SUPABASE_STUDIO_ID,
    supabaseFolhaId: process.env.SUPABASE_FOLHA_ID,
    supabaseWorkshopsId: process.env.SUPABASE_WORKSHOPS_ID,
    supabaseExtraServiceKey: process.env.SUPABASE_EXTRA_SERVICE_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    elevenlabsApiKey: process.env.ELEVENLABS_API_KEY,
    elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID,
    masterPhone: process.env.MASTER_PHONE,
    solCaixaId: process.env.SOL_CAIXA_ID,
    workspacePath: process.env.WORKSPACE_PATH,
  })
}
