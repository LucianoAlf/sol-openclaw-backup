'use strict';
process.env.SOL_CAIXA_V3_LEDGER_MODE = 'production';
process.env.SOL_CAIXA_V3_LEDGER_STRICT = '1';
process.env.SOL_CAIXA_LOTE_MS = '0';
const assert = require('assert');
const F = require('./caixa-financeiro.cjs');

const grupo = { chatId: 'cg@g.us', unidade_id: 'U-CG', nome: 'Campo Grande' };
const itens = [
  { aluno_nome: 'João Victor Ramos Coelho', valor: 360, competencia: '08/2026', categoria: 'passaporte', responsavel_financeiro: 'Andrea De Cássia Ramos', canonical_fatura_id: 'F-1', descricao: 'Taxa de Matrícula do curso de Bateria', fatura: { status: 'paga', data_pagamento: '2026-08-21', forma_pagamento: { nome: 'Pix' } } },
  { aluno_nome: 'Pedro Victor Ramos Coelho', valor: 360, competencia: '08/2026', categoria: 'passaporte', responsavel_financeiro: 'Andrea De Cássia Ramos', canonical_fatura_id: 'F-2', descricao: 'Taxa de Matrícula do curso de Contrabaixo', fatura: { status: 'paga', data_pagamento: '2026-08-21', forma_pagamento: { nome: 'Pix' } } },
];

(async () => {
  const sent = [];
  const h = F.criarHandlerFinanceiro({
    grupos: { [grupo.chatId]: { unidade_id: grupo.unidade_id, nome: grupo.nome } },
    sendFn: async (_chat, text) => { sent.push(text); return `MSG-${sent.length}`; },
    registrarPreviewV3Fn: async () => ({ ok: true, preview_id: 'V3-PREVIEW', preview_hash: 'V3-HASH' }),
    registrarApprovalV3Fn: async () => ({ ok: true, approval_id: 'V3-APPROVAL' }),
    lancarLoteFn: async () => ({ ok: false, motivo: 'snapshot_valor_fatura_mudou' }),
    ocrFn: async () => 'Comprovante Pix R$720,00',
    visaoFn: async () => null,
    interpretarFn: async () => ({ categoria: 'passaporte', forma: 'pix', competencia: '08/2026' }),
    interpretarMultiFn: async () => ({ tipo_recebimento: 'multi_aluno', valor_total: 720, forma: 'pix', categoria: 'passaporte', itens }),
    resolverMultiFn: async () => ({ ok: true, itens }),
    identidadeFn: async () => ({ identificado: true, nome: 'Operador Financeiro' }),
    canonicaFn: async () => null, casarFn: async () => null, faturasMesFn: async () => null,
    responsavelFn: async () => null, pagadorFn: async () => null, duplicataFn: async () => null,
    log: () => {}, dryRun: false,
  });
  const preview = await h.handle({ chatId: grupo.chatId, messageId: 'IMG-1', hasMedia: true, mediaType: 'image', mediaUrls: ['/tmp/comprovante.png'], body: 'PG pix passaportes alunos João Victor Ramos Coelho e Pedro Victor Ramos Coelho — R$720,00', senderId: '55@c.us', senderPhone: '55', senderName: 'Operador' });
  assert.strictEqual(preview.acao, 'preview_multi_aluno_enviado', JSON.stringify({ preview, sent }));
  const resultado = await h.handle({ chatId: grupo.chatId, messageId: 'PODE-1', hasMedia: false, mediaUrls: [], body: 'pode', quotedMessageId: 'MSG-1', senderId: '55@c.us', senderPhone: '55', senderName: 'Operador' });
  assert.strictEqual(resultado.acao, 'lote_multi_recusado');
  assert.match(sent.at(-1), /valor de uma fatura mudou desde o preview/i);
  assert.match(sent.at(-1), /preview original foi preservado/i);
  assert.match(sent.at(-1), /não precisa reenviar/i);
  console.log('1/1 snapshot divergente preserva preview: OK');
})().catch((e) => { console.error(e); process.exitCode = 1; });
