'use strict';
const assert = require('assert');
const F = require('./caixa-financeiro.cjs');

let n = 0, ok = 0;
async function t(nome, fn) {
  n++;
  try { await fn(); ok++; console.log('  ok  ' + nome); }
  catch (e) { console.log('FAIL  ' + nome + ' :: ' + e.message); process.exitCode = 1; }
}

function handler(capt, grupo) {
  process.env.SOL_CAIXA_V3_LEDGER_MODE = 'production';
  process.env.SOL_CAIXA_V3_LEDGER_STRICT = '1';
  return F.criarHandlerFinanceiro({
    grupos: { [grupo.chatId]: { unidade_id: grupo.unidade_id, nome: grupo.nome } },
    sendFn: async (_chat, txt) => { capt.env.push(txt); return `MSG-${capt.env.length}`; },
    registrarPreviewV3Fn: async (payload) => {
      capt.previews.push(payload);
      return { ok: true, event_id: `EV-${capt.previews.length}`, preview_id: `PV3-${capt.previews.length}` };
    },
    registrarApprovalV3Fn: async (payload) => {
      capt.approvals.push(payload);
      return { ok: true, approval_id: `AP-${capt.approvals.length}` };
    },
    lancarFn: async (payload) => { capt.lancamentos.push(payload); return { ok: true, valor: payload.valor, forma: payload.forma, movimentacao_id: `MOV-${capt.lancamentos.length}` }; },
    lancarSaidaFn: async (payload) => { capt.lancamentos.push(payload); return { ok: true, valor: payload.valor, forma: payload.forma, movimentacao_id: `SAI-${capt.lancamentos.length}` }; },
    ocrFn: async () => 'Comprovante Pix realizado Valor R$ 400,00',
    visaoFn: async () => null,
    interpretarFn: async () => ({ categoria: 'parcela', aluno: 'Aluno Teste', competencia: '09/2026', forma: 'pix' }),
    canonicaFn: async () => ({ ok: true, aluno_nome: 'Aluno Teste', fatura: { categoria: 'parcela', competencia: '09/2026', descricao: 'Parcela 09/2026 - Aluno Teste' } }),
    casarFn: async () => null,
    faturasMesFn: async () => null,
    responsavelFn: async () => ({ responsavel_nome: 'Responsavel Teste' }),
    pagadorFn: async () => null,
    duplicataFn: async () => null,
    identidadeFn: async () => ({ identificado: true, nome: 'Operador Financeiro' }),
    log: (x) => capt.logs.push(x),
    dryRun: false,
  });
}

async function fluxoGrupo(grupo) {
  const c = { env: [], logs: [], previews: [], approvals: [], lancamentos: [] };
  const h = handler(c, grupo);
  const r1 = await h.handle({
    chatId: grupo.chatId, messageId: `${grupo.nome}-IMG`, hasMedia: true,
    mediaType: 'image', mediaUrls: ['/tmp/comprovante.png'],
    body: 'comprovante pix R$ 400 Aluno Teste parcela setembro',
    senderId: '5521999999999@c.us', senderPhone: '5521999999999', senderName: 'Operador',
  });
  assert.strictEqual(r1.acao, 'preview_enviado');
  assert.strictEqual(c.previews.length, 1);
  assert.strictEqual(c.previews[0].mode, 'v3_production_public_preview');
  assert.strictEqual(c.previews[0].status, 'public_preview_sent');
  assert.strictEqual(c.previews[0].unidade_id, grupo.unidade_id);
  assert.strictEqual(c.previews[0].operacao, 'entrada');
  assert.strictEqual(c.previews[0].valor_centavos, '40000');
  assert.strictEqual(c.previews[0].forma, 'pix');
  assert.strictEqual(c.previews[0].categoria, 'parcela');

  const r2 = await h.handle({
    chatId: grupo.chatId, messageId: `${grupo.nome}-PODE`, hasMedia: false,
    body: 'pode', quotedMessageId: 'MSG-1',
    senderId: '5521999999999@c.us', senderPhone: '5521999999999', senderName: 'Operador',
  });
  assert.strictEqual(r2.acao, 'lancado');
  assert.strictEqual(c.approvals.length, 1);
  assert.strictEqual(c.approvals[0].preview_id, 'PV3-1');
  assert.strictEqual(c.approvals[0].decision, 'approved');
  assert.strictEqual(c.lancamentos.length, 1);
  assert.strictEqual(c.lancamentos[0].chat_id, grupo.chatId);
  assert.strictEqual(c.lancamentos[0].unidade_id, grupo.unidade_id);
}

(async () => {
  const grupos = [
    { nome: 'Campo Grande', chatId: 'cg@g.us', unidade_id: '2ec861f6-023f-4d7b-9927-3960ad8c2a92' },
    { nome: 'Barra', chatId: 'barra@g.us', unidade_id: '368d47f5-2d88-4475-bc14-ba084a9a348e' },
    { nome: 'Recreio', chatId: 'recreio@g.us', unidade_id: '95553e96-971b-4590-a6eb-0201d013c14d' },
  ];
  for (const grupo of grupos) {
    await t(`preview + approval V3 em ${grupo.nome}`, () => fluxoGrupo(grupo));
  }
  console.log('\n' + ok + '/' + n + ' testes ok');
})();
