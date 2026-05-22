import { execSync } from 'child_process'
import type { ConversationMessage, LLMResult, Tool, ToolCall } from './types.js'

export function parseToolCalls(response: string): ToolCall[] {
  const calls: ToolCall[] = []
  const regex = /```tool_call\n([\s\S]*?)\n```/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(response)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as { name: string; args: Record<string, unknown> }
      calls.push({ name: parsed.name, args: parsed.args ?? {} })
    } catch {
      // bloco malformado — ignorar
    }
  }
  return calls
}

export function buildCodexPrompt(systemPrompt: string, messages: ConversationMessage[], tools: Tool[]): string {
  const toolDocs = tools.map(t => `- **${t.name}**: ${t.description}`).join('\n')
  const history = messages.map(m => `${m.role === 'user' ? 'Usuário' : 'Sol'}: ${m.content}`).join('\n\n')

  return `${systemPrompt}

## Ferramentas disponíveis
Quando precisar usar uma ferramenta, responda com um bloco \`\`\`tool_call contendo JSON:
\`\`\`tool_call
{"name":"nome_da_tool","args":{"arg":"valor"}}
\`\`\`

${toolDocs}

## Conversa
${history}`
}

export async function runLLM(opts: {
  systemPrompt: string
  messages: ConversationMessage[]
  tools: Tool[]
  maxRounds?: number
}): Promise<LLMResult> {
  const { systemPrompt, messages, tools, maxRounds = 5 } = opts
  const allToolCalls: ToolCall[] = []
  let currentMessages = [...messages]

  for (let round = 0; round < maxRounds; round++) {
    const prompt = buildCodexPrompt(systemPrompt, currentMessages, tools)

    let rawResponse: string
    try {
      rawResponse = execSync(`codex --approval-mode full-auto --quiet "${prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`, {
        timeout: 30000,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
      })
    } catch (e: any) {
      return { response: 'Desculpe, tive um problema interno. Tente novamente em instantes.', toolCalls: allToolCalls }
    }

    const toolCalls = parseToolCalls(rawResponse)
    if (toolCalls.length === 0) {
      return { response: rawResponse.trim(), toolCalls: allToolCalls }
    }

    for (const tc of toolCalls) {
      allToolCalls.push(tc)
      const tool = tools.find(t => t.name === tc.name)
      const result = tool ? await tool.handler(tc.args) : `Error: tool "${tc.name}" não encontrada`
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: rawResponse },
        { role: 'user', content: `Resultado de ${tc.name}: ${result}` },
      ]
    }
  }

  return { response: 'Não consegui concluir a tarefa. Pode tentar novamente?', toolCalls: allToolCalls }
}
