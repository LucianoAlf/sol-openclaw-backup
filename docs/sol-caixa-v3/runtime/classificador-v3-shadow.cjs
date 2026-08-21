'use strict';

// Shadow-only mirror of the versioned deterministic contract. This module has
// no network, database, WhatsApp, preview, approval, or mutation dependency.
const crypto = require('node:crypto');
const CORRELATION_TTL_MS = 5 * 60 * 1000;
const pendingByChat = new Map();

const RULES = [
  { id: 'correcao_forma_pix:v1', priority: 100, confidence: 1,
    all: ['pix'], any: ['nao foi cartao', 'foi pix', 'nao cartao'],
    intent: { operacao: 'correcao_forma', forma: 'pix', requires: ['movimentacao_id'] } },
  { id: 'estornar_movimento:v1', priority: 95, confidence: 1,
    any: ['estorna', 'estornar', 'exclui esse lancamento', 'apaga esse lancamento'],
    intent: { operacao: 'estornar_movimento', requires: ['movimentacao_id'] } },
  { id: 'saida_seguranca_dinheiro:v1', priority: 90, confidence: 1,
    all: ['seguranca'], any: ['saida', 'pagamento semanal', 'pagar seguranca'],
    intent: { operacao: 'lancar_saida', categoria: 'seguranca', forma: 'dinheiro', requires: [] } },
  { id: 'entrada_parcela_pix:v1', priority: 80, confidence: 0.95,
    all: ['parcela', 'pix'],
    intent: { operacao: 'lancar_recebimento', categoria: 'parcela', forma: 'pix', requires: ['aluno'] } },
];

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizar(value) {
  return ` ${String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

function contem(texto, termo) {
  return normalizar(texto).includes(normalizar(termo));
}

function extrairValorCentavos(texto) {
  const m = String(texto || '').match(/r\$\s*(\d{1,6})(?:[,.](\d{2}))?/i);
  return m ? Number(m[1]) * 100 + Number(m[2] || '00') : undefined;
}

function classificar({ event, grupo }) {
  if (event.hasMedia) return { status: 'media_pending', writes: false };
  if (!grupo || !grupo.unidade_id) return { status: 'manual_review', reason: 'canonical_context_required', writes: false };
  if (!event.senderPhone) return { status: 'manual_review', reason: 'identity_unknown', writes: false };

  const texto = String(event.body || '');
  // A correction sent as a reply to a preview is not a new payment. Keep this
  // deliberately narrow until this shadow rule has enough observed evidence.
  if (event.quotedMessageId && contem(texto, 'parcela') &&
      (contem(texto, 'competencia') || contem(texto, 'categoria'))) {
    return {
      status: 'classified', rule_id: 'correcao_categoria_parcela:v1', confidence: 0.9,
      evidence: ['parcela', contem(texto, 'competencia') ? 'competencia' : 'categoria'],
      unit_source: 'group_jid', writes: false,
      operacao: 'correcao_categoria', categoria: 'parcela', requires: ['movimentacao_id'],
    };
  }
  const regras = RULES.filter((r) =>
    (r.all || []).every((t) => contem(texto, t)) &&
    (!(r.any || []).length || r.any.some((t) => contem(texto, t))));
  regras.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence || a.id.localeCompare(b.id));
  if (!regras.length) return { status: 'no_match', writes: false };
  const top = regras[0];
  const empate = regras.filter((r) => r.priority === top.priority && r.confidence === top.confidence).length > 1;
  if (empate) return { status: 'ambiguous', reason: 'rule_tie', writes: false };

  const matchedAny = (top.any || []).filter((t) => contem(texto, t));
  const out = { status: 'classified', rule_id: top.id, confidence: top.confidence,
    evidence: [...(top.all || []), ...matchedAny], unit_source: 'group_jid', writes: false, ...top.intent };
  const valor = extrairValorCentavos(texto);
  if (valor != null) out.valor_centavos = valor;
  return out;
}

function resumoLegado(resultado) {
  const r = resultado && typeof resultado === 'object' ? resultado : {};
  return { acao: r.acao || 'unknown', motivo: r.motivo || null, categoria: r.categoria || null, forma: r.forma || null };
}

function limparPendencias(now) {
  for (const [chatId, value] of pendingByChat) {
    if (now - value.at > CORRELATION_TTL_MS) pendingByChat.delete(chatId);
  }
}

function comparar({ event, classificacao, legado }) {
  const now = Date.now();
  limparPendencias(now);
  const legacy = resumoLegado(legado);
  const chatKey = String(event.chatId || '');
  const pending = pendingByChat.get(chatKey);
  const currentId = String(event.messageId || '');

  // Caption and media can arrive as separate WhatsApp messages. The legacy
  // parser joins them as a chat batch; the shadow must not call that a mismatch.
  if (legacy.acao === 'lote_texto_anexado' && classificacao.status === 'classified') {
    pendingByChat.set(chatKey, { at: now, messageId: currentId, classificacao });
    return { status: 'awaiting_media', event_ids: [currentId] };
  }
  if (classificacao.status === 'media_pending') {
    if (!pending) return { status: 'awaiting_media', event_ids: [currentId] };
    pendingByChat.delete(chatKey);
    return {
      status: legacy.acao === 'preview_enviado' ? 'legacy_not_normalized' : 'media_pending',
      event_ids: [pending.messageId, currentId],
    };
  }
  if (legacy.acao === 'preview_categoria_parcela_corrigida') {
    return {
      status: classificacao.rule_id === 'correcao_categoria_parcela:v1'
        ? 'legacy_not_normalized' : 'coverage_gap',
      event_ids: [currentId],
    };
  }
  if (classificacao.status === 'no_match' && !['nada', 'ignorado_fora_grupo'].includes(legacy.acao)) {
    return { status: 'coverage_gap', event_ids: [currentId] };
  }
  return { status: 'observed', event_ids: [currentId] };
}

function registrar({ log, event, grupo, classificacao, legado }) {
  const comparison = comparar({ event, classificacao, legado });
  log({
    step: 'classificador_v3_shadow',
    contract_version: 1,
    shadow_only: true,
    event_hash: hash(event.messageId).slice(0, 24),
    body_hash: hash(event.body).slice(0, 24),
    grupo_hash: hash(event.chatId).slice(0, 24),
    unidade_id: grupo && grupo.unidade_id || null,
    comparison_status: comparison.status,
    correlation_event_hashes: comparison.event_ids.map((id) => hash(id).slice(0, 24)),
    classifier: classificacao,
    legacy: resumoLegado(legado),
  });
}

module.exports = { classificar, registrar, normalizar, extrairValorCentavos, comparar };
