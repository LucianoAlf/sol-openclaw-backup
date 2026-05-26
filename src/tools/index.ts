import type { Tool } from '../types.js'
import { readFile, writeFile, listFiles } from './files.js'
import { executeShell } from './shell.js'
import { createSupabaseTool } from './supabase.js'
import { httpRequest } from './http.js'
import { createWhatsappTools } from './whatsapp.js'
import { createAudioTools } from './audio.js'
import { createMediaTools } from './media.js'
import { createLareportTools } from './lareport.js'
import { readLogs, editEnv, restartSelf } from './ops.js'
import type { Config } from '../config.js'

export type ToolContext =
  | { role: 'master' }
  | { role: 'aluno'; alunoId: number }

export function createToolRegistry(cfg: Config, workspacePath: string, context: ToolContext): Tool[] {
  const { sendWhatsapp, sendAudio } = createWhatsappTools(cfg.uazapiUrl, cfg.uazapiToken, cfg.uazapiInstance)
  const { transcribeAudio } = createAudioTools(cfg.openaiApiKey)

  if (context.role === 'aluno') {
    const lareportUrl = cfg.supabaseUrl!
    const lareportKey = cfg.lareportAnonKey!
    return createLareportTools(lareportUrl, lareportKey, context.alunoId, cfg.masterPhone, sendWhatsapp)
  }

  // master: conjunto completo
  const hasSupabase = !!(cfg.supabaseUrl && cfg.supabaseServiceKey)
  const mediaTools = hasSupabase
    ? createMediaTools(cfg.openaiApiKey, cfg.supabaseUrl!, cfg.supabaseServiceKey!)
    : null
  const supabaseQuery = hasSupabase
    ? createSupabaseTool(cfg.supabaseUrl!, cfg.supabaseServiceKey!, {
        studio: cfg.supabaseStudioId,
        folha: cfg.supabaseFolhaId,
        workshops: cfg.supabaseWorkshopsId,
        extraServiceKey: cfg.supabaseExtraServiceKey,
      })
    : async (_args: any) => 'Supabase não configurado.'

  const analyzeImage = mediaTools?.analyzeImage ?? (async (_args: any) => 'Supabase não configurado.')
  const storeMedia = mediaTools?.storeMedia ?? (async (_args: any) => 'Supabase não configurado.')

  return [
    {
      name: 'read_file',
      description: 'Lê um arquivo do workspace. Args: { path: string }',
      parameters: { path: { type: 'string' } },
      handler: (args) => readFile(workspacePath, args as { path: string }),
    },
    {
      name: 'write_file',
      description: 'Escreve conteúdo em um arquivo do workspace. Args: { path: string, content: string }',
      parameters: { path: { type: 'string' }, content: { type: 'string' } },
      handler: (args) => writeFile(workspacePath, args as { path: string; content: string }),
    },
    {
      name: 'list_files',
      description: 'Lista arquivos de um diretório do workspace. Args: { path: string }',
      parameters: { path: { type: 'string' } },
      handler: (args) => listFiles(workspacePath, args as { path: string }),
    },
    {
      name: 'execute_shell',
      description: 'Executa comando shell na VPS. Args: { command: string }',
      parameters: { command: { type: 'string' } },
      handler: (args) => executeShell(args as { command: string }),
    },
    {
      name: 'supabase_query',
      description: 'Executa SELECT na Supabase. Args: { query: string, project?: "main"|"studio"|"folha"|"workshops" }',
      parameters: { query: { type: 'string' }, project: { type: 'string' } },
      handler: (args) => supabaseQuery(args as { query: string; project?: string }),
    },
    {
      name: 'http_request',
      description: 'Faz requisição HTTP. Args: { url, method?, body?, headers? }',
      parameters: { url: { type: 'string' } },
      handler: (args) => httpRequest(args as Parameters<typeof httpRequest>[0]),
    },
    {
      name: 'send_whatsapp',
      description: 'Envia mensagem WhatsApp. Args: { phone: string, message: string }',
      parameters: { phone: { type: 'string' }, message: { type: 'string' } },
      handler: (args) => sendWhatsapp(args as { phone: string; message: string }),
    },
    {
      name: 'transcribe_audio',
      description: 'Transcreve áudio via Whisper. Args: { audioUrl: string }',
      parameters: { audioUrl: { type: 'string' } },
      handler: (args) => transcribeAudio(args as { audioUrl: string }),
    },
    {
      name: 'analyze_image',
      description: 'Analisa imagem com OpenAI Vision. Args: { imageUrl: string, prompt: string }',
      parameters: { imageUrl: { type: 'string' }, prompt: { type: 'string' } },
      handler: (args) => analyzeImage(args as { imageUrl: string; prompt: string }),
    },
    {
      name: 'store_media',
      description: 'Armazena mídia no Supabase Storage. Args: { phone, type, base64Content, mimeType }',
      parameters: { phone: { type: 'string' }, type: { type: 'string' }, base64Content: { type: 'string' }, mimeType: { type: 'string' } },
      handler: (args) => storeMedia(args as any),
    },
    {
      name: 'read_logs',
      description: 'Lê logs do próprio container (docker logs sol-adm). Args: { lines?: number (1-500, default 80), grep?: string (regex case-insensitive) }',
      parameters: { lines: { type: 'number' }, grep: { type: 'string' } },
      handler: async (args) => readLogs(args as { lines?: number; grep?: string }),
    },
    {
      name: 'edit_env',
      description: 'Edita uma variável em /app/.env (apenas chaves whitelistadas: TELEGRAM_MASTER_CHAT_ID, HEARTBEAT_DRY_RUN, LOG_LEVEL, DEBUG). Args: { key: string, value: string }. Não aplica até restart_self ser chamado.',
      parameters: { key: { type: 'string' }, value: { type: 'string' } },
      handler: async (args) => editEnv(args as { key: string; value: string }),
    },
    {
      name: 'restart_self',
      description: 'Reinicia o próprio container (docker restart sol-adm). Args: { confirm: boolean }. Use após edit_env. A thread LLM atual será perdida — avise o usuário antes.',
      parameters: { confirm: { type: 'boolean' } },
      handler: async (args) => restartSelf(args as { confirm?: boolean }),
    },
  ]
}

export async function executeTool(tools: Tool[], name: string, args: Record<string, unknown>): Promise<string> {
  const tool = tools.find(t => t.name === name)
  if (!tool) return `Error: tool desconhecida "${name}"`
  try {
    return await tool.handler(args)
  } catch (e: any) {
    return `Error em ${name}: ${e.message}`
  }
}
