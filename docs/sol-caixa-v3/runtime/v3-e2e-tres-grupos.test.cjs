'use strict';
const assert = require('assert');
const fs = require('fs');
const F = require('./caixa-financeiro.cjs');
const ABF = require('./caixa-abertura-fechamento.cjs');

function loadEnv(file) {
  try {
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m) continue;
      if (process.env[m[1]] == null) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch (_) {}
}

function gruposFinanceiros() {
  loadEnv('/home/sol/.openclaw/gateway.systemd.env');
  const raw = String(process.env.SOL_CAIXA_FINANCE_GROUPS || '').trim();
  const parsed = raw.split(';').map((entry) => {
    const [chatId, unidade_id, nome] = entry.split('|').map((x) => String(x || '').trim());
    return chatId && unidade_id ? { chatId, unidade_id, nome: nome || chatId } : null;
  }).filter(Boolean);
  if (parsed.length >= 3) return parsed.slice(0, 3);
  return [
    { nome: 'Campo Grande', chatId: 'cg@g.us', unidade_id: '2ec861f6-023f-4d7b-9927-3960ad8c2a92' },
    { nome: 'Barra', chatId: 'barra@g.us', unidade_id: '368d47f5-2d88-4475-bc14-ba084a9a348e' },
    { nome: 'Recreio', chatId: 'recreio@g.us', unidade_id: '95553e96-971b-4590-a6eb-0201d013c14d' },
  ];
}

const grupos = gruposFinanceiros();

let n = 0, ok = 0;
async function t(nome, fn) {
  n++;
  try { await fn(); ok++; console.log('  ok  ' + nome); }
  catch (e) { console.log('FAIL  ' + nome + ' :: ' + e.stack); process.exitCode = 1; }
}

function capt() {
  return { env: [], logs: [], previews: [], approvals: [], lancamentos: [], saidas: [], forma: [], correcoes: [], estornos: [], buscas: [] };
}

function mkHandler(c, grupo) {
  process.env.SOL_CAIXA_V3_LEDGER_MODE = 'production';
  process.env.SOL_CAIXA_V3_LEDGER_STRICT = '1';
  return F.criarHandlerFinanceiro({
    grupos: { [grupo.chatId]: { unidade_id: grupo.unidade_id, nome: grupo.nome } },
    sendFn: async (_chat, txt) => { c.env.push(txt); return `MSG-${c.env.length}`; },
    registrarPreviewV3Fn: async (payload) => { c.previews.push(payload); return { ok: true, event_id: `EV-${c.previews.length}`, preview_id: `PV3-${c.previews.length}` }; },
    registrarApprovalV3Fn: async (payload) => { c.approvals.push(payload); return { ok: true, approval_id: `AP-${c.approvals.length}` }; },
    lancarFn: async (payload) => { c.lancamentos.push(payload); return { ok: true, valor: payload.valor, forma: payload.forma, movimentacao_id: `MOV-${c.lancamentos.length}` }; },
    lancarSaidaFn: async (payload) => { c.saidas.push(payload); return { ok: true, valor: payload.valor, forma: payload.forma, movimentacao_id: `SAI-${c.saidas.length}` }; },
    corrigirFormaFn: async (payload) => { c.forma.push(payload); return { ok: true, movimentacao_id: payload.movimentacao_id || 'MOV-FORMA', forma_nova: payload.forma_nova || payload.forma || 'dinheiro' }; },
    buscarCorrecaoFn: async () => ({ ok: true, movimentacao_id: 'MOV-FORMA', valor: 400, categoria: 'parcela', forma_atual: 'pix' }),
    buscarMovimentosFn: async (payload) => { c.buscas.push(payload); return { ok: true, count: 1, items: [{ movimentacao_id: 'MOV-ALVO', unidade_id: grupo.unidade_id, valor: 400, categoria: 'parcela', forma_pagamento: 'pix' }] }; },
    corrigirMovimentoFn: async (payload) => { c.correcoes.push(payload); return { ok: true, depois: { valor: 450, categoria: 'parcela', forma_pagamento: 'pix' } }; },
    estornarMovimentoFn: async (payload) => { c.estornos.push(payload); return { ok: true, valor: 400, movimentacao_estorno_id: 'EST-1' }; },
    ocrFn: async (_media) => 'Comprovante Pix realizado Valor R$ 400,00',
    visaoFn: async () => null,
    interpretarFn: async () => ({ categoria: 'parcela', aluno: 'Aluno Teste', competencia: '09/2026', forma: 'pix' }),
    canonicaFn: async () => ({ ok: true, aluno_nome: 'Aluno Teste', fatura: { categoria: 'parcela', competencia: '09/2026', descricao: 'Parcela 09/2026 - Aluno Teste' } }),
    casarFn: async () => null,
    faturasMesFn: async () => null,
    responsavelFn: async () => ({ responsavel_nome: 'Responsavel Teste' }),
    pagadorFn: async () => null,
    duplicataFn: async () => null,
    identidadeFn: async () => ({ identificado: true, nome: 'Operador Financeiro' }),
    log: (x) => c.logs.push(x),
    dryRun: false,
  });
}

async function previewPode(c, h, grupo, mediaType = 'image', messageId = 'MIDIA') {
  const r1 = await h.handle({
    chatId: grupo.chatId, messageId: `${grupo.nome}-${messageId}`, hasMedia: true,
    mediaType, mediaUrls: [`/tmp/${messageId}.pdf`],
    body: 'comprovante pix R$ 400 Aluno Teste parcela setembro',
    senderId: '5521999999999@c.us', senderPhone: '5521999999999', senderName: 'Operador',
  });
  assert.strictEqual(r1.acao, 'preview_enviado');
  assert.strictEqual(c.previews.at(-1).unidade_id, grupo.unidade_id);
  const r2 = await h.handle({
    chatId: grupo.chatId, messageId: `${grupo.nome}-PODE-${messageId}`, hasMedia: false,
    body: 'pode', quotedMessageId: `MSG-${c.env.length}`,
    senderId: '5521999999999@c.us', senderPhone: '5521999999999', senderName: 'Operador',
  });
  assert.strictEqual(r2.acao, 'lancado');
  assert.strictEqual(c.approvals.at(-1).decision, 'approved');
  assert.strictEqual(c.lancamentos.at(-1).chat_id, grupo.chatId);
}

async function runGrupo(grupo) {
  const c = capt();
  const h = mkHandler(c, grupo);

  await previewPode(c, h, grupo, 'image', 'IMG');
  await previewPode(c, h, grupo, 'document', 'PDF');

  const forma = await h.handle({
    chatId: grupo.chatId, messageId: `${grupo.nome}-FORMA`, hasMedia: false,
    body: 'Sol, não é pix, é dinheiro',
    quotedMessageId: c.env.at(-1) ? `MSG-${c.env.length}` : null,
    quotedBody: `✅ Lancei no caixa da ${grupo.nome}: Parcela — R$ 400,00 (pix).`,
    senderId: '5521999999999@c.us', senderPhone: '5521999999999', senderName: 'Operador',
  });
  assert.strictEqual(forma.acao, 'correcao_forma_preview_enviado');
  assert.strictEqual(c.previews.at(-1).operacao, 'correcao_movimento');
  const formaPode = await h.handle({
    chatId: grupo.chatId, messageId: `${grupo.nome}-FORMA-PODE`, hasMedia: false,
    body: 'pode', quotedMessageId: `MSG-${c.env.length}`,
    senderId: '5521999999999@c.us', senderPhone: '5521999999999', senderName: 'Operador',
  });
  assert.strictEqual(formaPode.acao, 'movimento_corrigido');
  assert.ok(c.correcoes.at(-1).v3_approval_id);

  const corr = await h.handle({
    chatId: grupo.chatId, messageId: `${grupo.nome}-VALOR`, hasMedia: false,
    body: 'Sol, corrige o valor para R$ 450,00',
    senderId: '5521999999999@c.us', senderPhone: '5521999999999', senderName: 'Operador',
  });
  assert.strictEqual(corr.acao, 'movimento_operacao_preview_enviado');
  assert.strictEqual(c.previews.at(-1).operacao, 'correcao_movimento');
  const corrPode = await h.handle({
    chatId: grupo.chatId, messageId: `${grupo.nome}-VALOR-PODE`, hasMedia: false,
    body: 'pode', quotedMessageId: `MSG-${c.env.length}`,
    senderId: '5521999999999@c.us', senderPhone: '5521999999999', senderName: 'Operador',
  });
  assert.strictEqual(corrPode.acao, 'movimento_corrigido');
  assert.strictEqual(c.correcoes.at(-1).grupo_jid, grupo.chatId);
  assert.ok(c.correcoes.at(-1).v3_approval_id);

  const est = await h.handle({
    chatId: grupo.chatId, messageId: `${grupo.nome}-ESTORNO`, hasMedia: false,
    body: 'Sol, estorna esse lançamento',
    quotedBody: `✅ Lancei no caixa da ${grupo.nome}: Parcela — R$ 400,00 (pix).`,
    senderId: '5521999999999@c.us', senderPhone: '5521999999999', senderName: 'Operador',
  });
  assert.strictEqual(est.acao, 'movimento_operacao_preview_enviado');
  assert.strictEqual(c.previews.at(-1).operacao, 'estorno');
  const estPode = await h.handle({
    chatId: grupo.chatId, messageId: `${grupo.nome}-ESTORNO-PODE`, hasMedia: false,
    body: 'pode', quotedMessageId: `MSG-${c.env.length}`,
    senderId: '5521999999999@c.us', senderPhone: '5521999999999', senderName: 'Operador',
  });
  assert.strictEqual(estPode.acao, 'movimento_estornado');
  assert.strictEqual(c.estornos.at(-1).grupo_jid, grupo.chatId);
  assert.ok(c.estornos.at(-1).v3_approval_id);

  const saidaPreview = await h.handle({
    chatId: grupo.chatId, messageId: `${grupo.nome}-SAIDA`, hasMedia: false,
    body: 'Sol, pagamento semanal do segurança R$ 100 no dinheiro',
    senderId: '5521999999999@c.us', senderPhone: '5521999999999', senderName: 'Operador',
  });
  assert.strictEqual(saidaPreview.acao, 'saida_texto_preview_enviado');
  const saidaPode = await h.handle({
    chatId: grupo.chatId, messageId: `${grupo.nome}-SAIDA-PODE`, hasMedia: false,
    body: 'pode', quotedMessageId: `MSG-${c.env.length}`,
    senderId: '5521999999999@c.us', senderPhone: '5521999999999', senderName: 'Operador',
  });
  assert.strictEqual(saidaPode.acao, 'saida_lancada');
  assert.strictEqual(c.saidas.at(-1).categoria, 'seguranca');

  const envFechamento = [];
  const pend = { id: `${grupo.nome}-PEND`, tipo: 'fechar', unidade_id: grupo.unidade_id, data: '2026-08-21', preview_message_id: 'FECHA-1', idade_min: 1 };
  const rpcCalls = [];
  const rpcFn = async (nome, args) => {
    rpcCalls.push({ nome, args });
    if (nome === 'sol_caixa_dados_abertura') return { ja_aberto: true, caixa_id_aberto: `${grupo.nome}-CAIXA` };
    if (nome === 'sol_caixa_dados_fechamento') return { unidadeNome: grupo.nome, data: '2026-08-21', saldoInicial: 100, entradas: 400, saidas: 0, saldoFinal: 500 };
    if (nome === 'sol_caixa_pendencia_criar') return `${grupo.nome}-PEND`;
    if (nome === 'sol_caixa_pendencia_aguardando') return pend;
    if (nome === 'sol_caixa_pendencia_resolver') return null;
    if (nome === 'sol_caixa_fechar') return { ok: true, caixa_diario_id: `${grupo.nome}-CAIXA` };
    return null;
  };
  const direto = await ABF.tratarPedidoDiretoFechamento({
    chatId: grupo.chatId, body: 'Sol, vamos fechar o caixa agora', hasMedia: false,
    senderId: '5521999999999@c.us', senderPhone: '5521999999999', senderName: 'Operador',
  }, { grupo, rpcFn, sendFn: async (_chat, txt) => { envFechamento.push(txt); return 'FECHA-1'; } });
  assert.strictEqual(direto, true);
  assert.ok(/Posso fechar agora/i.test(envFechamento.at(-1)), envFechamento.at(-1));
  const nao = await ABF.tratarConfirmacao({
    chatId: grupo.chatId, body: 'Não', hasMedia: false, quotedMessageId: 'FECHA-1',
    quotedBody: envFechamento.at(-1), senderId: '5521999999999@c.us', senderPhone: '5521999999999', senderName: 'Operador',
  }, { rpcFn, sendFn: async (_chat, txt) => { envFechamento.push(txt); return 'NEG-1'; } });
  assert.strictEqual(nao, true);
  assert.ok(envFechamento.at(-1).includes('não vou fechar'));
  const pode = await ABF.tratarConfirmacao({
    chatId: grupo.chatId, body: 'pode', hasMedia: false, quotedMessageId: 'FECHA-1',
    quotedBody: envFechamento.at(0), senderId: '5521999999999@c.us', senderPhone: '5521999999999', senderName: 'Operador',
  }, { rpcFn, sendFn: async (_chat, txt) => { envFechamento.push(txt); return 'OK-1'; } });
  assert.strictEqual(pode, true);
  assert.ok(rpcCalls.some((x) => x.nome === 'sol_caixa_fechar'));
}

(async () => {
  for (const grupo of grupos) {
    await t(`E2E completo em ${grupo.nome}`, () => runGrupo(grupo));
  }
  console.log('\n' + ok + '/' + n + ' testes ok');
})();
