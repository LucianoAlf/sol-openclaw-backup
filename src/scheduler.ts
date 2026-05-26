import cron from 'node-cron'
import axios from 'axios'
import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import { buildSystemPrompt } from './context-builder.js'
import { runLLM } from './llm.js'
import type { Config } from './config.js'

export interface HeartbeatJob {
  title: string
  schedule: string
  description: string
}

type KnownHeartbeatKind = 'inadimplencia' | 'sumidos' | 'renovacoes' | 'aniversariantes'

interface HeartbeatRow {
  nome: string | null
  valor_parcela?: number | string | null
  dias_atraso?: number | string | null
  professor?: string | null
  curso?: string | null
  unidade?: string | null
  ultima_aula?: string | null
  dias_sem_aula?: number | string | null
  data_fim_contrato?: string | null
  dias_para_fim?: number | string | null
  data_nascimento?: string | null
  idade?: number | string | null
}

export function parseHeartbeatJobs(content: string): HeartbeatJob[] {
  const jobs: HeartbeatJob[] = []
  const sections = content.split(/^##\s+/m).slice(1)

  for (const section of sections) {
    const cronMatch = section.match(/<!--\s*cron:\s*([\w\s*/,-]+)\s*-->/)
    if (!cronMatch) continue
    const [rawTitle, ...lines] = section.split('\n')
    const title = rawTitle.trim()
    const schedule = cronMatch[1].trim()
    const description = lines.join('\n').replace(/<!--.*?-->/g, '').trim()
    jobs.push({ title, schedule, description })
  }

  return jobs
}

function heartbeatKind(title: string): KnownHeartbeatKind | undefined {
  const normalized = title.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  if (normalized.includes('inadimplencia')) return 'inadimplencia'
  if (normalized.includes('sumidos')) return 'sumidos'
  if (normalized.includes('renovacoes')) return 'renovacoes'
  if (normalized.includes('aniversariantes')) return 'aniversariantes'
  return undefined
}

function firstName(name?: string | null): string {
  return (name ?? 'aluno').trim().split(/\s+/)[0] || 'aluno'
}

function money(value?: number | string | null): string {
  if (value == null || value === '') return 'sem valor'
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(value?: string | null): string {
  if (!value) return 'sem data'
  const [date] = value.split('T')
  const [year, month, day] = date.split('-')
  return year && month && day ? `${day}/${month}/${year}` : value
}

function chunkTelegramText(text: string): string[] {
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += 3900) chunks.push(text.slice(i, i + 3900))
  return chunks.length ? chunks : ['']
}

async function sendTelegramReport(cfg: Config, text: string): Promise<void> {
  if (!cfg.telegramBotToken || !cfg.telegramMasterChatId) {
    console.warn('[heartbeat] Telegram não configurado; relatório não enviado')
    return
  }

  const baseUrl = `https://api.telegram.org/bot${cfg.telegramBotToken}`
  for (const chunk of chunkTelegramText(text)) {
    await axios.post(`${baseUrl}/sendMessage`, {
      chat_id: cfg.telegramMasterChatId,
      text: chunk,
    })
  }
}

async function execReadonly(cfg: Config, sql: string): Promise<HeartbeatRow[]> {
  if (!cfg.supabaseUrl || !cfg.lareportAnonKey) {
    throw new Error('Supabase/LAREPORT não configurado')
  }

  const supabase = createClient(cfg.supabaseUrl, cfg.lareportAnonKey)
  const { data, error } = await supabase.rpc('exec_readonly_sql', { query: sql.trim() })
  if (error) throw new Error(error.message)
  return (data as HeartbeatRow[]) ?? []
}

function activeStudentWhere(): string {
  return "a.status = 'ativo' and coalesce(a.is_ex_aluno, false) = false"
}

async function fetchHeartbeatRows(cfg: Config, kind: KnownHeartbeatKind): Promise<HeartbeatRow[]> {
  if (kind === 'inadimplencia') {
    return execReadonly(cfg, `
      select * from (
        with base as (
          select
            a.nome,
            a.valor_parcela,
            p.nome as professor,
            c.nome as curso,
            u.nome as unidade,
            case
              when a.dia_vencimento is null then null
              else (
                current_date -
                case
                  when a.dia_vencimento <= extract(day from current_date)::int then
                    make_date(
                      extract(year from current_date)::int,
                      extract(month from current_date)::int,
                      least(a.dia_vencimento, extract(day from (date_trunc('month', current_date) + interval '1 month - 1 day'))::int)
                    )
                  else
                    make_date(
                      extract(year from (current_date - interval '1 month'))::int,
                      extract(month from (current_date - interval '1 month'))::int,
                      least(a.dia_vencimento, extract(day from (date_trunc('month', current_date - interval '1 month') + interval '1 month - 1 day'))::int)
                    )
                end
              )
            end as dias_atraso
          from alunos a
          left join professores p on p.id = a.professor_atual_id
          left join cursos c on c.id = a.curso_id
          left join unidades u on u.id = a.unidade_id
          where ${activeStudentWhere()}
            and a.status_pagamento in ('atrasado', 'inadimplente')
        )
        select * from base
        where coalesce(dias_atraso, 0) >= 5
      ) heartbeat_inadimplencia
      order by dias_atraso desc, nome asc
    `)
  }

  if (kind === 'sumidos') {
    return execReadonly(cfg, `
      select * from (
        with ultimas as (
          select aluno_id, max(data_aula) as ultima_aula
          from aluno_presenca
          where status in ('presente', 'falta', 'pendente', 'agendada', 'remarcada')
          group by aluno_id
        )
        select
          a.nome,
          p.nome as professor,
          c.nome as curso,
          u.nome as unidade,
          ultimas.ultima_aula,
          case
            when ultimas.ultima_aula is null then null
            else current_date - ultimas.ultima_aula
          end as dias_sem_aula
        from alunos a
        left join ultimas on ultimas.aluno_id = a.id
        left join professores p on p.id = a.professor_atual_id
        left join cursos c on c.id = a.curso_id
        left join unidades u on u.id = a.unidade_id
        where ${activeStudentWhere()}
          and (ultimas.ultima_aula is null or ultimas.ultima_aula <= current_date - interval '14 days')
      ) heartbeat_sumidos
      order by ultima_aula asc nulls first, nome asc
    `)
  }

  if (kind === 'renovacoes') {
    return execReadonly(cfg, `
      select
        a.nome,
        a.valor_parcela,
        a.data_fim_contrato,
        (a.data_fim_contrato - current_date) as dias_para_fim,
        p.nome as professor,
        c.nome as curso,
        u.nome as unidade
      from alunos a
      left join professores p on p.id = a.professor_atual_id
      left join cursos c on c.id = a.curso_id
      left join unidades u on u.id = a.unidade_id
      where ${activeStudentWhere()}
        and a.data_fim_contrato between current_date and current_date + interval '30 days'
      order by a.data_fim_contrato asc, a.nome asc
    `)
  }

  return execReadonly(cfg, `
    select
      a.nome,
      a.data_nascimento,
      extract(year from age(current_date, a.data_nascimento))::int as idade,
      p.nome as professor,
      c.nome as curso,
      u.nome as unidade
    from alunos a
    left join professores p on p.id = a.professor_atual_id
    left join cursos c on c.id = a.curso_id
    left join unidades u on u.id = a.unidade_id
    where ${activeStudentWhere()}
      and a.data_nascimento is not null
      and extract(month from a.data_nascimento) = extract(month from current_date)
      and extract(day from a.data_nascimento) = extract(day from current_date)
    order by a.nome asc
  `)
}

function exampleMessage(kind: KnownHeartbeatKind, row?: HeartbeatRow): string {
  if (kind === 'inadimplencia') {
    return `Oi, ${firstName(row?.nome)}. Tudo bem? Passando para lembrar com carinho que consta uma mensalidade da LA Music em aberto. Posso te ajudar com a melhor forma de regularizar?`
  }
  if (kind === 'sumidos') {
    return `Oi, ${firstName(row?.nome)}. Sentimos sua falta na LA Music. Quer que eu te ajude a confirmar seu próximo horário de aula?`
  }
  if (kind === 'renovacoes') {
    return `Oi, ${firstName(row?.nome)}. Seu contrato na LA Music está chegando ao fim. Quer que eu te ajude com a renovação para manter seus horários?`
  }
  return `Oi, ${firstName(row?.nome)}. Feliz aniversário! A equipe LA Music te deseja um dia lindo, com muita música e alegria.`
}

function formatRow(kind: KnownHeartbeatKind, row: HeartbeatRow): string {
  if (kind === 'inadimplencia') {
    return `- ${row.nome ?? 'Sem nome'} | ${money(row.valor_parcela)} | ${row.dias_atraso ?? '?'} dias | Prof. ${row.professor ?? 'sem professor'}`
  }
  if (kind === 'sumidos') {
    return `- ${row.nome ?? 'Sem nome'} | última aula: ${formatDate(row.ultima_aula)} | ${row.dias_sem_aula ?? 'sem registro'} dias | Prof. ${row.professor ?? 'sem professor'}`
  }
  if (kind === 'renovacoes') {
    return `- ${row.nome ?? 'Sem nome'} | fim: ${formatDate(row.data_fim_contrato)} | ${row.dias_para_fim ?? '?'} dias | ${money(row.valor_parcela)} | Prof. ${row.professor ?? 'sem professor'}`
  }
  return `- ${row.nome ?? 'Sem nome'} | ${row.idade ?? '?'} anos | ${row.curso ?? 'sem curso'} | ${row.unidade ?? 'sem unidade'}`
}

function reportTitle(kind: KnownHeartbeatKind): string {
  if (kind === 'inadimplencia') return 'Inadimplência diária'
  if (kind === 'sumidos') return 'Alunos sumidos'
  if (kind === 'renovacoes') return 'Renovações próximas'
  return 'Aniversariantes do dia'
}

function buildReport(kind: KnownHeartbeatKind, rows: HeartbeatRow[], dryRun: boolean): string {
  const limit = 80
  const shown = rows.slice(0, limit)
  const hidden = rows.length - shown.length
  const lines = [
    `[DRY-RUN] ${reportTitle(kind)}`,
    `Total detectado: ${rows.length}`,
    `Modo: ${dryRun ? 'somente relatório; nenhum aluno recebeu mensagem' : 'envio real desativado para segurança nesta versão'}`,
    '',
    'Lista:',
    ...(shown.length ? shown.map(row => formatRow(kind, row)) : ['- Nenhum aluno encontrado.']),
    ...(hidden > 0 ? [`- ... mais ${hidden} alunos não exibidos neste relatório.`] : []),
    '',
    'Exemplo de mensagem:',
    exampleMessage(kind, rows[0]),
  ]

  return lines.join('\n')
}

export async function runHeartbeatJob(cfg: Config, job: HeartbeatJob): Promise<void> {
  const kind = heartbeatKind(job.title)

  if (!kind) {
    console.log(`[heartbeat] executando prompt: ${job.title}`)
    const systemPrompt = await buildSystemPrompt('processo', cfg.workspacePath)
    await runLLM({ systemPrompt, messages: [{ role: 'user', content: job.description }] })
    return
  }

  console.log(`[heartbeat] executando job: ${job.title}`)
  const rows = await fetchHeartbeatRows(cfg, kind)
  await sendTelegramReport(cfg, buildReport(kind, rows, cfg.heartbeatDryRun))
  console.log(`[heartbeat] relatório enviado: ${job.title} (${rows.length} registros)`)
}

export async function runHeartbeatJobByTitle(cfg: Config, title: string): Promise<void> {
  const heartbeatPath = path.join(cfg.workspacePath, 'HEARTBEAT.md')
  const content = fs.readFileSync(heartbeatPath, 'utf-8')
  const jobs = parseHeartbeatJobs(content)
  const job = jobs.find(candidate => candidate.title.toLowerCase() === title.toLowerCase())
  if (!job) throw new Error(`Heartbeat não encontrado: ${title}`)
  await runHeartbeatJob(cfg, job)
}

export async function startScheduler(cfg: Config): Promise<void> {
  const heartbeatPath = path.join(cfg.workspacePath, 'HEARTBEAT.md')
  if (!fs.existsSync(heartbeatPath)) return

  const content = fs.readFileSync(heartbeatPath, 'utf-8')
  const jobs = parseHeartbeatJobs(content)

  for (const job of jobs) {
    if (!cron.validate(job.schedule)) {
      console.warn(`[scheduler] cron inválido: "${job.schedule}" — ignorando`)
      continue
    }

    cron.schedule(job.schedule, async () => {
      try {
        await runHeartbeatJob(cfg, job)
      } catch (e) {
        console.error(`[heartbeat] erro em "${job.title}":`, e)
      }
    }, { timezone: 'America/Sao_Paulo' })

    console.log(`[scheduler] registrado: "${job.title}" — ${job.schedule}`)
  }
}
