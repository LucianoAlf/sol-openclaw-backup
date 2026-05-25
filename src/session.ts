import * as fs from 'fs'
import * as path from 'path'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { Contact, ConversationMessage } from './types.js'

const MASTER_SESSION_LIMIT = 40

export class SessionManager {
  private db: SupabaseClient | null = null

  constructor(
    url: string | undefined,
    serviceKey: string | undefined,
    private caixaId: number,
    private masterPhone: string,
    private workspacePath: string,
    private masterAliases: string[] = []
  ) {
    if (url && serviceKey) {
      this.db = createClient(url, serviceKey)
    } else {
      console.log('[session] Supabase não configurado — usando apenas armazenamento local para master')
    }
  }

  private isMasterSession(phone: string): boolean {
    return phone === this.masterPhone || this.masterAliases.includes(phone)
  }

  private masterSessionPath(): string {
    return path.join(this.workspacePath, 'memory', 'session-master.json')
  }

  private readMasterSession(): ConversationMessage[] {
    const p = this.masterSessionPath()
    if (!fs.existsSync(p)) return []
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return [] }
  }

  private writeMasterSession(msgs: ConversationMessage[]): void {
    const p = this.masterSessionPath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    const trimmed = msgs.slice(-MASTER_SESSION_LIMIT)
    fs.writeFileSync(p, JSON.stringify(trimmed, null, 2), 'utf-8')
  }

  async getContact(phone: string): Promise<Contact | null> {
    if (this.isMasterSession(phone)) {
      return { phone, display_name: 'Admin', type: 'master', unit: 'all', emusys_id: null, is_master: true, notes: null }
    }

    if (!this.db) return null

    const { data: aluno } = await this.db
      .from('aluno_contatos')
      .select('aluno_id, alunos(nome, unidade_id)')
      .eq('telefone', phone)
      .maybeSingle()
    if (aluno) {
      const a = aluno as any
      return { phone, is_master: false, type: 'aluno', display_name: a.alunos?.nome ?? phone, unit: a.alunos?.unidade_id ?? 'all', emusys_id: String(a.aluno_id), notes: null }
    }

    const { data: prof } = await this.db
      .from('professores')
      .select('id, nome, unidade_id')
      .eq('telefone', phone)
      .maybeSingle()
    if (prof) {
      const p = prof as any
      return { phone, is_master: false, type: 'professor', display_name: p.nome, unit: p.unidade_id ?? 'all', emusys_id: String(p.id), notes: null }
    }

    const { data: colab } = await this.db
      .from('colaboradores')
      .select('id, nome, cargo, unidade_id')
      .eq('telefone', phone)
      .maybeSingle()
    if (colab) {
      const c = colab as any
      const type = c.cargo?.toLowerCase().includes('gerente') ? 'gerente' : 'farmer'
      return { phone, is_master: false, type, display_name: c.nome, unit: c.unidade_id ?? 'all', emusys_id: null, notes: null }
    }

    return null
  }

  private async getOrCreateConversa(phone: string, nome: string): Promise<string> {
    const { data: existing } = await this.db!
      .from('admin_conversas')
      .select('id')
      .eq('caixa_id', this.caixaId)
      .eq('telefone_externo', phone)
      .maybeSingle()
    if (existing) return existing.id

    const { data: created, error } = await this.db!
      .from('admin_conversas')
      .insert({ caixa_id: this.caixaId, telefone_externo: phone, nome_externo: nome, status: 'aberta', nao_lidas: 0 })
      .select('id')
      .single()

    if (error) throw new Error(`getOrCreateConversa failed: ${error.message}`)
    return created.id
  }

  async getHistory(phone: string, limit = 10): Promise<ConversationMessage[]> {
    if (this.isMasterSession(phone)) {
      const msgs = this.readMasterSession()
      return msgs.slice(-limit)
    }

    if (!this.db) return []

    const { data: conversa } = await this.db
      .from('admin_conversas')
      .select('id')
      .eq('caixa_id', this.caixaId)
      .eq('telefone_externo', phone)
      .maybeSingle()

    if (!conversa) return []

    const { data, error } = await this.db
      .from('admin_mensagens')
      .select('direcao, conteudo')
      .eq('conversa_id', conversa.id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) throw new Error(`getHistory failed: ${error.message}`)
    return ((data ?? []) as any[]).reverse().map(m => ({
      role: (m.direcao === 'saida' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.conteudo ?? '',
    }))
  }

  async saveMessage(
    phone: string,
    nome: string,
    role: 'user' | 'assistant',
    content: string
  ): Promise<void> {
    if (this.isMasterSession(phone)) {
      const msgs = this.readMasterSession()
      msgs.push({ role, content })
      this.writeMasterSession(msgs)
      return
    }

    if (!this.db) { console.log('[session] sem Supabase, mensagem não salva para', phone); return }

    const conversaId = await this.getOrCreateConversa(phone, nome)
    const direcao = role === 'assistant' ? 'saida' : 'entrada'
    const remetente = role === 'assistant' ? 'sol' : 'aluno'

    const { error: msgError } = await this.db
      .from('admin_mensagens')
      .insert({ conversa_id: conversaId, direcao, conteudo: content, remetente, remetente_nome: role === 'assistant' ? 'Sol' : nome, tipo: 'texto' })

    if (msgError) throw new Error(`saveMessage failed: ${msgError.message}`)

    await this.db
      .from('admin_conversas')
      .update({ ultima_mensagem_at: new Date().toISOString(), ultima_mensagem_preview: content.slice(0, 120) })
      .eq('id', conversaId)
  }
}
