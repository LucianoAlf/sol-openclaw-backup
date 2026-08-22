'use strict';
process.env.SOL_CAIXA_V3_LEDGER_MODE = 'production';
process.env.SOL_CAIXA_V3_LEDGER_STRICT = '1';
process.env.SOL_CAIXA_LOTE_MS = '0';
const assert = require('assert');
const F = require('./caixa-financeiro.cjs');

const grupo = { chatId: 'cg@g.us', unidade_id: '2ec861f6-023f-4d7b-9927-3960ad8c2a92', nome: 'Campo Grande' };
const baseEvent = (overrides = {}) => ({
  chatId: grupo.chatId, messageId: 'IMG-1', hasMedia: true, mediaType: 'image', mediaUrls: ['/tmp/comprovante.png'],
  body: 'PG pix passaportes alunos João Victor Ramos Coelho e Pedro Victor Ramos Coelho — R$ 720,00',
  senderId: '5521999999999@c.us', senderPhone: '5521999999999', senderName: 'Operador', ...overrides,
});

function criar({ multi, loteResultado } = {}) {
  const c = { env: [], previews: [], approvals: [], lotes: [], singles: [] };
  const h = F.criarHandlerFinanceiro({
    grupos: { [grupo.chatId]: { unidade_id: grupo.unidade_id, nome: grupo.nome } },
    sendFn: async (_chat, text) => { c.env.push(text); return `MSG-${c.env.length}`; },
    registrarPreviewV3Fn: async (payload) => { c.previews.push(payload); return { ok: true, preview_id: `PV-${c.previews.length}`, preview_hash: `HASH-${c.previews.length}` }; },
    registrarApprovalV3Fn: async (payload) => { c.approvals.push(payload); return { ok: true, approval_id: `AP-${c.approvals.length}` }; },
    lancarFn: async (payload) => { c.singles.push(payload); return { ok: true, valor: payload.valor, forma: payload.forma }; },
    lancarLoteFn: async (payload) => {
      c.lotes.push(payload);
      return loteResultado || {
        ok: true,
        lote_id: 'LOTE-1',
        movimentacoes: payload.itens.map((i, n) => ({ movimentacao_id: `MOV-${n + 1}`, aluno_nome: i.aluno_nome, valor: i.valor })),
      };
    },
    ocrFn: async () => 'Comprovante Pix realizado Valor R$ 720,00', visaoFn: async () => null,
    interpretarFn: async () => ({ categoria: 'passaporte', aluno: null, competencia: '08/2026', forma: 'pix' }),
    interpretarMultiFn: async () => multi,
    resolverMultiFn: async (payload) => ({ ok: true, itens: payload.itens.map((i, n) => ({ ...i, aluno_nome: i.aluno_nome, valor: i.valor || 360, competencia: i.competencia || '08/2026', descricao: n === 0 ? 'Taxa de Matrícula do curso de Bateria' : 'Taxa de Matrícula do curso de Contrabaixo', canonical_fatura_id: `F-${n + 1}`, responsavel_financeiro: 'Andrea De Cássia Ramos', fatura: { status: 'paga', data_pagamento: '2026-08-21', forma_pagamento: { nome: 'Pix' } } })) }),
    canonicaFn: async () => null, casarFn: async () => null, faturasMesFn: async () => null, responsavelFn: async () => null,
    pagadorFn: async () => null, duplicataFn: async () => null, identidadeFn: async () => ({ identificado: true, nome: 'Operador Financeiro' }),
    log: () => {}, dryRun: false,
  });
  return { c, h };
}

(async () => {
  assert.strictEqual(F.detectarContextoMultiAluno('alunos João e Pedro R$720'), true);
  assert.strictEqual(F.detectarContextoMultiAluno('aluno João R$720'), false);
  const totalDoComprovanteVenceLlm = F.validarIntencaoMultiAluno({
    valor_total: 20,
    forma: 'pix', categoria: 'passaporte',
    itens: [
      { aluno_nome: 'João Victor Ramos Coelho', valor: null },
      { aluno_nome: 'Pedro Victor Ramos Coelho', valor: null },
    ],
  }, 720, { forma: 'pix', categoria: 'passaporte' });
  assert.strictEqual(totalDoComprovanteVenceLlm.ok, true);
  assert.strictEqual(totalDoComprovanteVenceLlm.valor_total, 720);

  const semDivisao = criar({ multi: { tipo_recebimento: 'multi_aluno', valor_total: 720, forma: 'pix', categoria: 'passaporte', itens: [
    { aluno_nome: 'João Victor Ramos Coelho', valor: null }, { aluno_nome: 'Pedro Victor Ramos Coelho', valor: null },
  ] } });
  const r1 = await semDivisao.h.handle(baseEvent());
  assert.strictEqual(r1.acao, 'preview_multi_aluno_enviado');
  assert.strictEqual(semDivisao.c.previews.length, 1);
  assert.match(semDivisao.c.env[0], /João Victor Ramos Coelho — R\$ 360,00/);
  assert.match(semDivisao.c.env[0], /Resp\. financeiro: Andrea De Cássia Ramos/);
  assert.match(semDivisao.c.env[0], /Taxas de Matrícula dos cursos de Bateria e Contrabaixo/);
  assert.match(semDivisao.c.env[0], /Já pago no Emusys em 21\/08 no Pix/);

  const completo = criar({ multi: { tipo_recebimento: 'multi_aluno', valor_total: 720, forma: 'pix', categoria: 'passaporte', competencia: '08/2026', itens: [
    { aluno_nome: 'João Victor Ramos Coelho', valor: 360, competencia: '08/2026', categoria: 'passaporte' },
    { aluno_nome: 'Pedro Victor Ramos Coelho', valor: 360, competencia: '08/2026', categoria: 'passaporte' },
  ] } });
  const r2 = await completo.h.handle(baseEvent());
  assert.strictEqual(r2.acao, 'preview_multi_aluno_enviado');
  assert.strictEqual(completo.c.previews.length, 1);
  assert.strictEqual(completo.c.previews[0].operacao, 'entrada');
  assert.strictEqual(completo.c.previews[0].preview_json.pending.tipoOperacao, 'lancar_recebimento_lote');
  assert.strictEqual(completo.c.previews[0].preview_json.pending.itens.length, 2);
  const r3 = await completo.h.handle(baseEvent({ messageId: 'PODE-1', hasMedia: false, mediaUrls: [], body: 'pode', quotedMessageId: 'MSG-1' }));
  assert.strictEqual(r3.acao, 'lote_multi_lancado');
  assert.strictEqual(completo.c.approvals.length, 1);
  assert.strictEqual(completo.c.lotes.length, 1);
  assert.strictEqual(completo.c.singles.length, 0);
  assert.strictEqual(completo.c.lotes[0].itens.length, 2);

  const caixaNaoAberto = criar({ multi: { tipo_recebimento: 'multi_aluno', valor_total: 720, forma: 'pix', categoria: 'passaporte', competencia: '08/2026', itens: [
    { aluno_nome: 'João Victor Ramos Coelho', valor: 360, competencia: '08/2026', categoria: 'passaporte' },
    { aluno_nome: 'Pedro Victor Ramos Coelho', valor: 360, competencia: '08/2026', categoria: 'passaporte' },
  ] }, loteResultado: { ok: false, motivo: 'caixa_nao_aberto' } });
  const r4 = await caixaNaoAberto.h.handle(baseEvent({ messageId: 'IMG-CAIXA-NAO-ABERTO' }));
  assert.strictEqual(r4.acao, 'preview_multi_aluno_enviado');
  const r5 = await caixaNaoAberto.h.handle(baseEvent({ messageId: 'PODE-CAIXA-NAO-ABERTO', hasMedia: false, mediaUrls: [], body: 'pode', quotedMessageId: 'MSG-1' }));
  assert.strictEqual(r5.acao, 'lote_multi_recusado');
  assert.match(caixaNaoAberto.c.env.at(-1), /caixa da Campo Grande ainda não está aberto/);
  assert.doesNotMatch(caixaNaoAberto.c.env.at(-1), /fatura não confere/);
  console.log('4/4 testes ok');
})().catch((e) => { console.error(e); process.exitCode = 1; });
