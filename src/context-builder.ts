import * as fs from 'fs'
import * as path from 'path'
import type { UserMode } from './types.js'

function readIfExists(filePath: string): string {
  if (!fs.existsSync(filePath)) return ''
  return fs.readFileSync(filePath, 'utf-8')
}

function section(label: string, content: string): string {
  if (!content.trim()) return ''
  return `\n\n## ${label}\n${content}`
}

export function buildSystemPrompt(mode: UserMode, workspacePath: string): string {
  const w = workspacePath
  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]

  if (mode === 'master') {
    return [
      readIfExists(path.join(w, 'IDENTITY.md')),
      section('Personalidade', readIfExists(path.join(w, 'SOUL.md'))),
      section('Regras de Sessão', readIfExists(path.join(w, 'AGENTS.md'))),
      section('Contexto', readIfExists(path.join(w, 'USER.md'))),
      section('Mapa', readIfExists(path.join(w, 'MAPA.md'))),
      section('Memória Hoje', readIfExists(path.join(w, 'memory', `${today}.md`))),
      section('Memória Ontem', readIfExists(path.join(w, 'memory', `${yesterday}.md`))),
      section('Memória Longo Prazo', readIfExists(path.join(w, 'MEMORY.md'))),
    ].filter(Boolean).join('')
  }

  if (mode === 'processo') {
    return [
      readIfExists(path.join(w, 'IDENTITY.md')),
      section('Processos Internos', readIfExists(path.join(w, 'HEARTBEAT.md'))),
    ].filter(Boolean).join('')
  }

  return [
    readIfExists(path.join(w, 'IDENTITY.md')),
    section('Regras de Sessão', readIfExists(path.join(w, 'AGENTS.md'))),
  ].filter(Boolean).join('')
}

export function loadSkill(workspacePath: string, skillName: string): string {
  const skillPath = path.join(workspacePath, 'skills', skillName, 'SKILL.md')
  return readIfExists(skillPath)
}
