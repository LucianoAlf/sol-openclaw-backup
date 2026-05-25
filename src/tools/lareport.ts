import { createClient } from '@supabase/supabase-js'
import type { Tool } from '../types.js'

async function execReadonly(supabase: ReturnType<typeof createClient>, sql: string): Promise<any[]> {
  const { data, error } = await supabase.rpc('exec_readonly_sql', { query: sql })
  if (error) throw new Error(error.message)
  return (data as any[]) ?? []
}

export function createLareportTools(
  supabaseUrl: string,
  anonKey: string,
  alunoId: number,
  masterPhone: string,
  sendWhatsapp: (args: { phone: string; message: string }) => Promise<string>
): Tool[] {
  const supabase = createClient(supabaseUrl, anonKey)

  return [
    {
      name: 'meus_dados',
      description: 'Retorna dados cadastrais do aluno: nome, curso, professor, unidade, valor de parcela, status do contrato e datas.',
      parameters: {},
      handler: async (_args: any) => {
        const rows = await execReadonly(supabase, `
          SELECT
            a.nome, a.status, a.data_matricula, a.data_fim_contrato,
            a.valor_parcela, a.whatsapp,
            c.nome AS curso,
            p.nome AS professor,
            u.nome AS unidade
          FROM alunos a
          LEFT JOIN cursos c ON c.id = a.curso_id
          LEFT JOIN professores p ON p.id = a.professor_atual_id
          LEFT JOIN unidades u ON u.id = a.unidade_id
          WHERE a.id = ${alunoId}
        `)
        if (!rows.length) return 'Dados não encontrados.'
        return JSON.stringify(rows[0], null, 2)
      },
    },
    {
      name: 'minha_presenca',
      description: 'Retorna o histórico de presença do aluno nas últimas 30 aulas registradas.',
      parameters: {},
      handler: async (_args: any) => {
        const rows = await execReadonly(supabase, `
          SELECT
            ap.data_aula, ap.horario_aula, ap.status,
            ap.curso_nome, ap.turma_nome,
            ae.professor_nome, ae.cancelada
          FROM aluno_presenca ap
          LEFT JOIN aulas_emusys ae ON ae.id = ap.aula_emusys_id
          WHERE ap.aluno_id = ${alunoId}
          ORDER BY ap.data_aula DESC
          LIMIT 30
        `)
        return JSON.stringify(rows, null, 2)
      },
    },
    {
      name: 'meu_pagamento',
      description: 'Retorna situação de pagamento, valor de parcela, forma de pagamento e histórico de renovações do aluno.',
      parameters: {},
      handler: async (_args: any) => {
        const situacao = await execReadonly(supabase, `
          SELECT
            a.status, a.valor_parcela, a.data_fim_contrato,
            fp.nome AS forma_pagamento
          FROM alunos a
          LEFT JOIN formas_pagamento fp ON fp.id = a.forma_pagamento_id
          WHERE a.id = ${alunoId}
        `)
        const renovacoes = await execReadonly(supabase, `
          SELECT
            data_renovacao, valor_parcela_novo, status, observacoes
          FROM renovacoes
          WHERE aluno_id = ${alunoId}
          ORDER BY data_renovacao DESC
          LIMIT 5
        `)
        return JSON.stringify({ situacao: situacao[0] ?? null, renovacoes }, null, 2)
      },
    },
    {
      name: 'escalar_farmer',
      description: 'Escala o atendimento para a equipe humana. Use quando a situação exige ação da equipe ou você não consegue resolver. Args: { motivo: string }',
      parameters: { motivo: { type: 'string' } },
      handler: async (args: any) => {
        await sendWhatsapp({
          phone: masterPhone,
          message: `🔔 Aluno (id: ${alunoId}) precisa de atenção\nMotivo: ${args.motivo ?? 'não informado'}`
        })
        return 'Encaminhei para a equipe. Alguém vai entrar em contato em breve.'
      },
    },
  ]
}

export async function lookupAlunoPorTelefone(
  supabaseUrl: string,
  anonKey: string,
  phone: string
): Promise<number | null> {
  const supabase = createClient(supabaseUrl, anonKey)
  const normalized = phone.replace(/\D/g, '')

  const rows = await execReadonly(supabase, `
    SELECT id FROM alunos
    WHERE regexp_replace(whatsapp, '\\D', '', 'g') = '${normalized}'
       OR regexp_replace(telefone, '\\D', '', 'g') = '${normalized}'
    LIMIT 1
  `).catch(() => [])

  if (rows.length) return rows[0].id

  const contatos = await execReadonly(supabase, `
    SELECT aluno_id FROM aluno_contatos
    WHERE regexp_replace(telefone, '\\D', '', 'g') = '${normalized}'
    LIMIT 1
  `).catch(() => [])

  return contatos.length ? contatos[0].aluno_id : null
}
