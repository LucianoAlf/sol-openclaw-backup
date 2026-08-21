'use strict';

const assert = require('assert');
const F = require('./caixa-financeiro.cjs');

const chatId = 'cg@g.us';
const unidade_id = '2ec861f6-023f-4d7b-9927-3960ad8c2a92';
const logs = [];
const sent = [];

const handler = F.criarHandlerFinanceiro({
  grupos: { [chatId]: { unidade_id, nome: 'Campo Grande' } },
  sendFn: async (_chat, text) => { sent.push(text); return `MSG-${sent.length}`; },
  // Reproduz o caso de hoje: OCR sem texto, mas visao consegue o comprovante.
  ocrFn: async () => ({ text: '', status: 'timeout', duration_ms: 45000, file_bytes: 217412, exit_code: 'ETIMEDOUT', timed_out: true }),
  visaoFn: async () => ({ valor: 377, forma: 'pix', aluno: 'Beatriz Teste' }),
  interpretarFn: async () => ({ categoria: 'parcela', aluno: 'Beatriz Teste', competencia: '08/2026', forma: 'pix' }),
  canonicaFn: async () => ({ ok: true, aluno_nome: 'Beatriz Teste', fatura: { categoria: 'parcela', competencia: '08/2026', descricao: 'Parcela 08/2026 - Beatriz Teste' } }),
  casarFn: async () => null,
  faturasMesFn: async () => null,
  responsavelFn: async () => ({ responsavel_nome: 'Responsavel Teste' }),
  pagadorFn: async () => null,
  duplicataFn: async () => null,
  identidadeFn: async () => ({ identificado: true, nome: 'Operador Teste' }),
  registrarPreviewV3Fn: async () => ({ ok: true, event_id: 'EV-1', preview_id: 'PV-1' }),
  log: (entry) => logs.push(entry),
  dryRun: true,
});

(async () => {
  const r = await handler.handle({
    chatId, messageId: 'OCR-TIMEOUT-FALLBACK', hasMedia: true, mediaType: 'image', mediaUrls: ['/tmp/comprovante-legivel.jpg'], body: '',
    senderId: '5521999999999@c.us', senderPhone: '5521999999999', senderName: 'Operador',
  });
  assert.strictEqual(r.acao, 'preview_enviado');
  assert.ok(logs.some((x) => x.acao === 'fallback_vision_attempt' && x.motivo === 'timeout'));
  assert.ok(logs.some((x) => x.acao === 'fallback_vision_result' && x.ok));
  const ocr = logs.find((x) => x.acao === 'ocr_result');
  assert.strictEqual(ocr.ocr_status, 'timeout');
  assert.strictEqual(ocr.ocr_file_bytes, 217412);
  assert.ok(!sent.some((text) => /não consegui ler/i.test(text)));
  console.log('1/1 OCR timeout chama visao antes de recusar: OK');
})().catch((err) => { console.error(err.stack || err); process.exitCode = 1; });
