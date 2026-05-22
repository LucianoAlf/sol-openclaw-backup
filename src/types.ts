export type MessageType = 'text' | 'audio' | 'image'
export type UserMode = 'master' | 'atendimento' | 'processo'

export interface IncomingMessage {
  phone: string
  type: MessageType
  text?: string
  audioUrl?: string
  imageUrl?: string
  caption?: string
}

export interface Contact {
  phone: string
  display_name: string
  type: 'aluno' | 'professor' | 'farmer' | 'gerente' | 'master'
  unit: string
  emusys_id: string | null
  is_master: boolean
  notes: string | null
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ToolCall {
  name: string
  args: Record<string, unknown>
}

export interface LLMResult {
  response: string
  toolCalls: ToolCall[]
}

export interface Tool {
  name: string
  description: string
  parameters: Record<string, unknown>
  handler: (args: Record<string, unknown>) => Promise<string>
}
