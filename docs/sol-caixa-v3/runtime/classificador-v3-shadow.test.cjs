'use strict';
const assert = require('node:assert/strict');
const { classificar } = require('./classificador-v3-shadow.cjs');

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
r = classificar({ event: event('parcela pix', { hasMedia: true }), grupo });
assert.equal(r.status, 'media_pending');
r = classificar({ event: event('pix', { senderPhone: null }), grupo });
assert.equal(r.reason, 'identity_unknown');
for (const result of [r]) assert.equal(result.writes, false);
console.log('classifier-v3-shadow: 6 passed');
