import cron from 'node-cron'
import * as fs from 'fs'
import * as path from 'path'
import { buildSystemPrompt } from './context-builder.js'
import { runLLM } from './llm.js'
import { createToolRegistry } from './tools/index.js'
import type { Config } from './config.js'

export interface HeartbeatJob {
  schedule: string
  description: string
}

export function parseHeartbeatJobs(content: string): HeartbeatJob[] {
  const jobs: HeartbeatJob[] = []
  const sections = content.split(/^##\s+/m).slice(1)

  for (const section of sections) {
    const cronMatch = section.match(/<!--\s*cron:\s*([\w\s*/,-]+)\s*-->/)
    if (!cronMatch) continue
    const schedule = cronMatch[1].trim()
    const description = section.split('\n').slice(0, 3).join(' ').replace(/<!--.*?-->/g, '').trim()
    jobs.push({ schedule, description })
  }

  return jobs
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
      console.log(`[heartbeat] executando: ${job.description}`)
      try {
        const systemPrompt = buildSystemPrompt('processo', cfg.workspacePath)
        const tools = createToolRegistry(cfg, cfg.workspacePath)
        await runLLM({ systemPrompt, messages: [{ role: 'user', content: job.description }], tools })
      } catch (e) {
        console.error(`[heartbeat] erro em "${job.description}":`, e)
      }
    }, { timezone: 'America/Sao_Paulo' })

    console.log(`[scheduler] registrado: "${job.description}" — ${job.schedule}`)
  }
}
