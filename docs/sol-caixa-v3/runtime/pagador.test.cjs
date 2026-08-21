'use strict';
// Caso Mayra/CG 17/08: Pix da MAE (Pamela) para o aluno Pedro Goncalves Serafim.
const assert = require('assert');
const F = require('./caixa-financeiro.cjs');
let n = 0, ok = 0;
function t(nome, fn) { n++; try { fn(); ok++; console.log('  ok  ' + nome); } catch (e) { console.log('FAIL  ' + nome + ' :: ' + e.message); process.exitCode = 1; } }
async function ta(nome, fn) { n++; try { await fn(); ok++; console.log('  ok  ' + nome); } catch (e) { console.log('FAIL  ' + nome + ' :: ' + e.message); process.exitCode = 1; } }

const OCR_PIX = 'Comprovante de Pix\nR$ 417,00\nRealizado em 17/08/2026\n\nDe\n\nPAMELA CRISTINA G SERAFIM\n\nInstituicao: ITAU UNIBANCO S.A\n\nPara\n\nLA MUSIC KIDS';

t('extrai o pagador do Pix', () => assert.strictEqual(F.extrairPagador(OCR_PIX), 'PAMELA CRISTINA G SERAFIM'));
t('extrai origem com identificador numérico antes do nome', () => assert.strictEqual(
  F.extrairPagador('Origem\nNome\n41.974.715 BEATRIZ FREITAS PEREIRA ZANARDO\nInstituição\nNU PAGAMENTOS'),
  'BEATRIZ FREITAS PEREIRA ZANARDO'
));
t('nao confunde instituicao com pessoa', () => assert.strictEqual(F.extrairPagador('De\n\nITAU UNIBANCO S.A'), null));
t('nao pega nome de uma palavra', () => assert.strictEqual(F.extrairPagador('De\n\nPAMELA'), null));

function h(pagadorResp, capt) {
  return F.criarHandlerFinanceiro({
    grupos: { 'g@g.us': { unidade_id: 'U-CG', nome: 'Campo Grande' } },
    sendFn: async (c, txt) => { capt.env.push(txt); return 'PV'; },
    lancarFn: async (p) => { capt.payload = p; return { ok: true, valor: 417, forma: 'pix' }; },
    ocrFn: async () => OCR_PIX, visaoFn: async () => null,
    interpretarFn: async () => ({ categoria: 'outro', aluno: null, competencia: null, forma: 'pix' }),
    casarFn: async () => null, responsavelFn: async () => null,
    pagadorFn: async () => pagadorResp, dryRun: false,
  });
}

(async () => {
  // 1 candidato via familia -> assume e AVISA que deduziu
  const c1 = { env: [], payload: null };
  await h({ ok: true, via: 'familia', total: 1, ambiguo: false,
    alunos: [{ aluno_nome: 'Pedro Gonçalves Serafim', sobrenome: 'serafim' }] }, c1)
    .handle({ chatId: 'g@g.us', messageId: 'P1', hasMedia: true, mediaType: 'image', body: '', mediaUrls: ['/tmp/p.jpg'], senderId: '55@c.us', senderName: 'Mayra Alves' });
  await ta('acha o aluno pelo sobrenome do pagador', async () => {
    assert.ok(/Pedro Gonçalves Serafim/.test(c1.env[0]), c1.env[0]);
    assert.ok(/deduzi pelo sobrenome/.test(c1.env[0]), c1.env[0]);
    assert.ok(/Pamela Cristina G Serafim/.test(c1.env[0]), c1.env[0]);
  });

  // responsavel cadastrado -> assume sem "deduzi"
  const c2 = { env: [], payload: null };
  await h({ ok: true, via: 'responsavel', total: 1, ambiguo: false,
    alunos: [{ aluno_nome: 'Helena Moreira Ferrari', responsavel_nome: 'Antonio Carlos Guimaraes Ferrari' }] }, c2)
    .handle({ chatId: 'g@g.us', messageId: 'P2', hasMedia: true, mediaType: 'image', body: '', mediaUrls: ['/tmp/p.jpg'], senderId: '55@c.us', senderName: 'Mayra' });
  await ta('responsavel cadastrado entra sem "deduzi"', async () => {
    assert.ok(/Helena Moreira Ferrari/.test(c2.env[0]), c2.env[0]);
    assert.ok(/responsável cadastrado/.test(c2.env[0]), c2.env[0]);
  });

  // ambiguo -> PERGUNTA, nao escolhe
  const c3 = { env: [], payload: null };
  await h({ ok: true, via: 'familia', total: 2, ambiguo: true,
    alunos: [{ aluno_nome: 'Pedro Gonçalves Serafim' }, { aluno_nome: 'Wylla Cristina Carvalho' }] }, c3)
    .handle({ chatId: 'g@g.us', messageId: 'P3', hasMedia: true, mediaType: 'image', body: '', mediaUrls: ['/tmp/p.jpg'], senderId: '55@c.us', senderName: 'Mayra' });
  await ta('dois candidatos: pergunta em vez de chutar', async () => {
    assert.ok(/É de qual aluno/.test(c3.env[0]), c3.env[0]);
    assert.ok(/Pedro Gonçalves Serafim/.test(c3.env[0]) && /Wylla/.test(c3.env[0]), c3.env[0]);
    assert.ok(!/• Aluno: Pedro/.test(c3.env[0]), 'nao pode afirmar um: ' + c3.env[0]);
  });

  // nao achou ninguem -> assume honestamente e pede
  const c4 = { env: [], payload: null };
  await h(null, c4).handle({ chatId: 'g@g.us', messageId: 'P4', hasMedia: true, mediaType: 'image', body: '', mediaUrls: ['/tmp/p.jpg'], senderId: '55@c.us', senderName: 'Mayra' });
  await ta('sem match: diz que nao achou e pede o nome', async () => {
    assert.ok(/[Nn]ão achei pelo pagador/.test(c4.env[0]), c4.env[0]);
    assert.ok(/Pamela Cristina G Serafim/.test(c4.env[0]), c4.env[0]);
  });

  // Caso real Beatriz 21/08: OCR em timeout; a visão trouxe quem pagou.
  // A fatura canônica precisa resolver direto, sem a equipe redigitar a aluna.
  const c5 = { env: [], canonicaChamadas: 0, pagadorChamadas: 0 };
  const h5 = F.criarHandlerFinanceiro({
    grupos: { 'g@g.us': { unidade_id: 'U-CG', nome: 'Campo Grande' } },
    sendFn: async (c, txt) => { c5.env.push(txt); return 'PV5'; },
    lancarFn: async () => ({ ok: true, valor: 377, forma: 'pix' }),
    ocrFn: async () => '',
    visaoFn: async () => ({ valor: 377, forma: 'pix', aluno: null, pagador_nome: 'Beatriz Freitas Pereira Zanardo' }),
    interpretarFn: async () => ({ categoria: 'outro', aluno: null, competencia: '08/2026', forma: 'pix' }),
    casarFn: async () => null,
    canonicaFn: async (u, nome, valor) => {
      c5.canonicaChamadas++;
      assert.strictEqual(nome, 'Beatriz Freitas Pereira Zanardo');
      assert.strictEqual(valor, 377);
      return { ok: true, aluno_nome: 'Beatriz Freitas Pereira Zanardo', motivo_escolha: 'ja_consta_paga', parcela: { competencia: '08/2026', valor_da_parcela: 377, valor_bate: true } };
    },
    responsavelFn: async () => null,
    pagadorFn: async () => { c5.pagadorChamadas++; return null; },
    dryRun: false,
  });
  await h5.handle({ chatId: 'g@g.us', messageId: 'P5', hasMedia: true, mediaType: 'image', body: '', mediaUrls: ['/tmp/p.jpg'], senderId: '55@c.us', senderName: 'Mayra' });
  await ta('visão do pagador resolve fatura sem pedir aluno', async () => {
    assert.strictEqual(c5.canonicaChamadas, 1);
    assert.strictEqual(c5.pagadorChamadas, 0);
    assert.ok(/Beatriz Freitas Pereira Zanardo/.test(c5.env[0]), c5.env[0]);
    assert.ok(/própria aluna no comprovante/.test(c5.env[0]), c5.env[0]);
    assert.ok(!/Não identifiquei/.test(c5.env[0]), c5.env[0]);
  });

  console.log('\n' + ok + '/' + n + ' testes ok');
  if (ok !== n) process.exitCode = 1;
})();
