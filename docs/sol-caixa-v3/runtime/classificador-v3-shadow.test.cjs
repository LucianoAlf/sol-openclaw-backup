'use strict';
const assert = require('node:assert/strict');
const { classificar, registrar } = require('./classificador-v3-shadow.cjs');

const grupo = { unidade_id: '00000000-0000-0000-0000-000000000001' };
function event(body, extra = {}) { return { messageId: 'shadow-test', body, senderPhone: '5521999999999', hasMedia: false, ...extra }; }

let r = classificar({ event: event('Sol, foi PIX, não foi cartão.'), grupo });
assert.equal(r.status, 'classified'); assert.equal(r.operacao, 'correcao_forma'); assert.equal(r.forma, 'pix');
r = classificar({ event: event('estorna esse lançamento'), grupo });
assert.equal(r.operacao, 'estornar_movimento');
r = classificar({ event: event('saída pagar segurança R$ 100,00'), grupo });
assert.equal(r.operacao, 'lancar_saida'); assert.equal(r.valor_centavos, 10000);
r = classificar({ event: event('parcela pix R$ 377,00'), grupo });
assert.equal(r.operacao, 'lancar_recebimento'); assert.equal(r.valor_centavos, 37700);
r = classificar({ event: event('Foi PIX, não foi cartão.'), grupo });
assert.deepEqual(r.evidence, ['pix', 'nao foi cartao', 'foi pix']);
r = classificar({ event: event('parcela pix', { hasMedia: true }), grupo });
assert.equal(r.status, 'media_pending');
r = classificar({ event: event('Aluna Beatriz\nCompetência 08/2026\nParcela', { quotedMessageId: 'preview-1' }), grupo });
assert.equal(r.rule_id, 'correcao_categoria_parcela:v1');

const logs = [];
const texto = event('Comprovante pix R$ 377,00 - parcela 08/2026', { messageId: 'caption-1', chatId: 'cg' });
registrar({ log: (x) => logs.push(x), event: texto, grupo,
  classificacao: classificar({ event: texto, grupo }), legado: { acao: 'lote_texto_anexado' } });
const midia = event('[image received]', { messageId: 'image-1', chatId: 'cg', hasMedia: true });
registrar({ log: (x) => logs.push(x), event: midia, grupo,
  classificacao: classificar({ event: midia, grupo }), legado: { acao: 'preview_enviado' } });
assert.equal(logs[0].comparison_status, 'awaiting_media');
assert.equal(logs[1].comparison_status, 'legacy_not_normalized');
assert.equal(logs[1].correlation_event_hashes.length, 2);
assert.ok(!JSON.stringify(logs).includes('caption-1'));
r = classificar({ event: event('pix', { senderPhone: null }), grupo });
assert.equal(r.reason, 'identity_unknown');
for (const result of [r]) assert.equal(result.writes, false);
console.log('classifier-v3-shadow: 10 passed');
