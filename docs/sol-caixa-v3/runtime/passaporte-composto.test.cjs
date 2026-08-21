'use strict';
// Caso Perola (19/08): legenda humana diz parcela R$387 + diferenca de
// passaporte R$280 no mesmo comprovante. A Sol precisa totalizar R$667,
// buscar as faturas da competencia e montar um preview composto.
const assert = require('assert');
const F = require('./caixa-financeiro.cjs');

let n = 0, ok = 0;
async function ta(nome, fn) {
  n++;
  try { await fn(); ok++; console.log('  ok  ' + nome); }
  catch (e) { console.log('FAIL  ' + nome + ' :: ' + e.message); process.exitCode = 1; }
}

function handler(capt, extra = {}) {
  return F.criarHandlerFinanceiro({
    grupos: { 'g@g.us': { unidade_id: 'U-CG', nome: 'Campo Grande' } },
    sendFn: async (c, txt) => { capt.env.push(txt); return 'PV' + capt.env.length; },
    lancarFn: async (payload) => { capt.lancamentos.push(payload); return { ok: true, valor: Number(payload.valor), forma: payload.forma, movimentacao_id: 'M1' }; },
    ocrFn: async () => 'COMPROVANTE PIX\nVALOR R$667,00\nPAGO',
    visaoFn: async () => null,
    interpretarFn: async () => ({ categoria: 'outro', aluno: 'Pérola Teixeira da Cruz', competencia: null, forma: 'pix' }),
    casarFn: async () => ({ ok: false }),
    canonicaFn: async () => ({ ok: false, motivo: 'nao_encontrada' }),
    faturasMesFn: async (unidade, aluno, competencia, valor) => {
      capt.faturasArgs.push({ unidade, aluno, competencia, valor });
      if (Number(valor) !== 667) return null;
      return { ok: true, aluno_nome: 'Pérola Teixeira da Cruz', competencia: '08/2026', partes: [
        { curso: 'Violão', valor: 387 },
        { curso: 'Passaporte', valor: 280 },
      ] };
    },
    responsavelFn: async () => ({ responsavel_nome: 'Taís Teixeira da Cruz' }),
    pagadorFn: async () => ({ ok: false }),
    duplicataFn: async () => null,
    identidadeFn: async () => ({ identificado: true, nome: 'Mayra ADM CG' }),
    log: (x) => capt.logs.push(x),
    dryRun: false,
    ...extra,
  });
}

const midiaPerola = () => ({
  chatId: 'g@g.us',
  messageId: 'IMG-PEROLA',
  hasMedia: true,
  mediaType: 'image',
  body: 'PG pix parcela 08/2026 R$387,00 + PG dif. passaporte R$280,00 aluna Pérola Teixeira da Cruz - Kids CG',
  mediaUrls: ['/tmp/perola.jpg'],
  senderId: '55@c.us',
  senderName: 'Mayra ADM CG',
});

(async () => {
  await ta('soma parcela + passaporte vira valor total', async () => {
    const s = F.extrairSomaAditivaPagamento('PG pix parcela 08/2026 R$387,00 + PG dif. passaporte R$280,00 aluna Pérola');
    assert.deepStrictEqual(s, { total: 667, partes: [387, 280] });
  });

  await ta('fatura de passaporte aparece como Passaporte no composto', async () => {
    const comp = F.compostoDeFaturas([
      { descricao: 'Parcela 08/2026 do curso de Violão', tipo_fatura: 'parcela', valor_pago: 387, status: 'paga' },
      { descricao: 'Taxa de Matrícula do curso de Violão', tipo_fatura: 'passaporte_taxa_matricula', valor_pago: 280, status: 'paga' },
    ], 667, '08/2026', 'Pérola Teixeira da Cruz');
    assert.ok(comp);
    assert.deepStrictEqual(comp.partes.map((p) => p.curso), ['Violão', 'Passaporte']);
  });

  await ta('Perola monta preview composto parcela + passaporte', async () => {
    const c = { env: [], logs: [], lancamentos: [], faturasArgs: [] };
    const h = handler(c);
    const r = await h.handle(midiaPerola(), 1000);
    assert.strictEqual(r.acao, 'preview_enviado');
    assert.strictEqual(c.faturasArgs[0].valor, 667);
    const txt = c.env[0] || '';
    assert.ok(/R\$ 667,00/.test(txt), txt);
    assert.ok(/Pagamento composto/i.test(txt), txt);
    assert.ok(/Viol/i.test(txt), txt);
    assert.ok(/Passaporte/.test(txt), txt);
    assert.strictEqual(h._pendentes.get('g@g.us')[0].valor, 667);
    assert.strictEqual(h._pendentes.get('g@g.us')[0].composto.partes.length, 2);
  });

  await ta('correcao humana de passaporte remonta preview e exige novo pode', async () => {
    const c = { env: [], logs: [], lancamentos: [], faturasArgs: [] };
    const h = handler(c, {
      ocrFn: async () => 'COMPROVANTE PIX\nVALOR R$387,00\nPAGO',
      canonicaFn: async () => ({ ok: true, motivo: 'ja_consta_paga', aluno_nome: 'Pérola Teixeira da Cruz',
        fatura: { tipo_fatura: 'parcela', valor_da_parcela: 387, competencia: '2026-08-01', status: 'paga' },
        parcela: { valor: 387, status: 'paga', descricao: 'Parcela 08/2026 do curso de Violão', valor_bate: true, competencia: '08/2026' } }),
      faturasMesFn: async (unidade, aluno, competencia, valor) => {
        c.faturasArgs.push({ unidade, aluno, competencia, valor });
        if (Number(valor) === 667) return { ok: true, aluno_nome: 'Pérola Teixeira da Cruz', competencia: '08/2026', partes: [
          { curso: 'Violão', valor: 387 },
          { curso: 'Passaporte', valor: 280 },
        ] };
        return null;
      },
    });
    await h.handle({ ...midiaPerola(), body: 'PG pix parcela 08/2026 R$387,00 aluna Pérola Teixeira da Cruz - Kids CG' }, 1000);
    const previewAntigo = h._pendentes.get('g@g.us')[0].previewId;
    const r = await h.handle({ chatId: 'g@g.us', messageId: 'TXT-CORR', hasMedia: false, body: 'Sol, ta errado. Falta o passaporte R$280,00 que esta junto nesse comprovante', quotedMessageId: previewAntigo, senderId: '55@c.us', senderName: 'Mayra ADM CG' }, 2000);
    assert.strictEqual(r.acao, 'preview_adicional_corrigido');
    assert.strictEqual(c.lancamentos.length, 0);
    assert.strictEqual(h._pendentes.get('g@g.us')[0].valor, 667);
    assert.ok(/faltava Passaporte/i.test(c.env[1] || ''), c.env[1] || '');
    assert.ok(/R\$ 667,00/.test(c.env[1] || ''), c.env[1] || '');
  });

  console.log('\n' + ok + '/' + n + ' testes ok');
})();
