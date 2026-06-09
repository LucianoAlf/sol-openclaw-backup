export function sanitizeWhatsappText(input: string): string {
  if (!input) return ''

  let text = String(input).trim()

  // Algumas rotas antigas persistem texto JSON-escapado e depois reenviam cru.
  // Ex.: "Linha 1\\n\\nLinha 2" aparecia literalmente no WhatsApp.
  if (/\\n|\\r|\\t/.test(text)) {
    text = text
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\n')
      .replace(/\\t/g, ' ')
  }

  // Se vier como string JSON completa, tenta decodificar com segurança.
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    try {
      const parsed = JSON.parse(text)
      if (typeof parsed === 'string') text = parsed
    } catch {
      text = text.slice(1, -1)
    }
  }

  // WhatsApp usa *negrito*, não **markdown**. Pares válidos viram *texto*;
  // marcadores órfãos são removidos para não quebrar a leitura.
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
  text = text.replace(/\*\*/g, '')

  // Remove fences/markdown que ficam feios no WhatsApp.
  text = text.replace(/```[a-zA-Z]*\n?/g, '')
  text = text.replace(/```/g, '')

  // Evita promessas falsas que o LLM às vezes inventa depois de errar.
  text = text.replace(/\n?⚠️\s*Vou travar essa regra[^\n]*/gi, '')
  text = text.replace(/\n?Vou travar essa regra[^\n]*/gi, '')

  // Normalização leve de espaços/linhas.
  text = text
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()

  return text
}
