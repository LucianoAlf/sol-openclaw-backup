'use strict';
/*
 * Sol Caixa — Fatia 1 (caminho A: determinístico no bridge).
 * Comprovante cai no grupo financeiro -> monta preview "posso lançar?".
 * Membro do grupo responde "pode" -> chama a RPC guardada -> "lancei ✅".
 * O LLM NUNCA entra no caminho do dinheiro. Funções puras testáveis + handler.
 */
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { execFile } = require('child_process');

const ENV_CANDIDATES = [
  '/opt/LA-Organizer/.env',                       // (Sol nao le; ok)
  '/home/sol/.openclaw/gateway.systemd.env',      // fonte real (SUPABASE_SERVICE_KEY)
];

const FIN_KW = /(pix|comprovante|pago|paguei|parcela|passaporte|lojinha|venda|corda|palheta|baqueta|capotraste|afinador|cabo|transfer|dep[óo]sito|boleto|recibo|matr[íi]cula|mensalidade|pagamento)/i;
const MONEY = /r\$\s*[\d.,]+/i;
const FORMA_KW = /\b(pix|dinheiro|cart[ãa]o|cheque|transfer[êe]ncia)\b/i;

// ---- funções puras -------------------------------------------------------

function parseBRMoney(s) {
  if (s === null || s === undefined) return null;
  let t = String(s).replace(/[^\d.,]/g, '');
  if (!t) return null;
  if (t.includes(',')) {
    t = t.replace(/\./g, '').replace(',', '.');           // 1.397,00 -> 1397.00
  } else if (t.includes('.')) {
    const parts = t.split('.');
    const last = parts[parts.length - 1];
    if (!(parts.length === 2 && last.length === 2)) {
      t = t.replace(/\./g, '');                            // 1.397 -> 1397 (milhar)
    }
  }
  const v = parseFloat(t);
  return isFinite(v) && v > 0 ? v : null;
}

// Rótulos que marcam O valor do comprovante (vence "R$ 0,00" de taxa/desconto).
const VALOR_ROTULADO = /(valor\s*(da\s*conta|do\s*pix|pago|total|da\s*transa[çc][ãa]o|recebido)?\s*[:\-]?\s*)r\$\s*([\d.]+(?:,\d{1,2})?)/gi;

function extrairValor(text, { allowBare = false } = {}) {
  if (!text) return null;
  const t = String(text);
  // 1) valor rotulado > 0 (o "Valor da conta: R$ 405,00" do comprovante)
  let m;
  VALOR_ROTULADO.lastIndex = 0;
  while ((m = VALOR_ROTULADO.exec(t)) !== null) {
    if (!m[1] || !m[1].trim()) continue;              // sem rótulo -> deixa pro passo 2
    const v = parseBRMoney(m[3]);
    if (v) return v;
  }
  // 2) primeiro R$ com valor > 0 (antes parava no primeiro "R$ 0,00" e desistia)
  const todos = t.match(/r\$\s*[\d.]+(?:,\d{1,2})?/gi) || [];
  for (const bruto of todos) {
    const v = parseBRMoney(String(bruto).replace(/r\$\s*/i, ''));
    if (v) return v;
  }
  if (allowBare) {
    const b = t.match(/(?<![\d\/])(\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d+(?:,\d{2})?)(?![\d\/])/);
    if (b) return parseBRMoney(b[1]);
  }
  return null;
}

function valoresMonetarios(texto) {
  return [...String(texto || '').matchAll(/r\$\s*[\d.]+(?:,\d{1,2})?/gi)]
    .map((m) => ({ valor: parseBRMoney(String(m[0]).replace(/r\$\s*/i, '')), idx: m.index || 0 }))
    .filter((m) => m.valor && m.valor > 0);
}

function extrairSomaAditivaPagamento(texto) {
  const t = String(texto || '');
  if (!t || !/\+/.test(t)) return null;
  if (/=/.test(t)) return null;
  const valores = valoresMonetarios(t);
  if (valores.length < 2) return null;
  const soma = valores.reduce((s, m) => s + Number(m.valor || 0), 0);
  return soma > 0 ? { total: Number(soma.toFixed(2)), partes: valores.map((m) => m.valor) } : null;
}

const PRODUTO_LOJINHA_RE = /\b(lojinha|loja|cordas?|palhetas?|baquetas?|capotraste|afinador(?:es)?|cabos?|correia|encordoamento|livro|apostila|camiseta)\b/i;
function detectarLojinhaProduto(texto) {
  const t = String(texto || '');
  if (/passaporte|taxa\s+de\s+matr[íi]cula/i.test(t)) return null;
  if (!PRODUTO_LOJINHA_RE.test(t)) return null;
  let item = null;
  const mCorda = t.match(/\bcorda(?:s)?(?:\s+de\s+([a-zA-ZÀ-ÿ]+))?/i);
  if (mCorda) item = 'Corda' + (mCorda[1] ? ' de ' + tituloNome(mCorda[1]) : '');
  if (!item) {
    const mItem = t.match(/\b(palheta|baqueta|capotraste|afinador|cabo|correia|encordoamento|livro|apostila|camiseta)(?:\s+de\s+([a-zA-ZÀ-ÿ]+))?/i);
    if (mItem) item = tituloNome(mItem[1] + (mItem[2] ? ' de ' + mItem[2] : ''));
  }
  if (!item && !/\b(lojinha|loja)\b/i.test(t)) return null;
  return { categoria: 'lojinha', item: item || 'Produto de lojinha' };
}

// OCR de cupom nao tem "R$": aceita 5.700,00 / 1.234,56 (decimal obrigatorio, pra nao
// confundir com CNPJ, NSU, AUT, data ou numero de terminal).
function extrairValorOcr(text) {
  const t = String(text || '');
  const comRotulo = extrairValor(t);
  if (comRotulo) return comRotulo;
  const re = /(?<![\d.,:\/-])(\d{1,3}(?:\.\d{3})+,\d{2}|\d{1,6},\d{2})(?![\d.,:\/-])/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const v = parseBRMoney(m[1]);
    if (v && v < 1000000) return v;
  }
  return null;
}

// Cupom de cartao (PagBank/Cielo/Stone): bandeira, modalidade e parcelas.
const SINAL_CARTAO = /(visa|master(?:card)?|elo\b|amex|hipercard|cr[eé]dito|d[eé]bito|nsu|pagbank|cielo|stone|getnet|rede\b|autorizado com senha|venda\s+cr[eé]dito|venda\s+d[eé]bito)/i;
function extrairCartao(text) {
  const t = String(text || '');
  if (!SINAL_CARTAO.test(t)) return null;
  const debito = /(d[eé]bito)/i.test(t) && !/(cr[eé]dito)/i.test(t);
  let parcelas = null;
  const m = t.match(/em\s+(\d{1,2})\s*(?:x|parcelas?|vezes)/i) || t.match(/(\d{1,2})\s*x\s*(?:de|sem juros)/i);
  if (m) { const n = parseInt(m[1], 10); if (n >= 1 && n <= 24) parcelas = n; }
  return { forma: 'cartao', modalidade: debito ? 'debito' : 'credito', parcelas: debito ? null : parcelas };
}

function extrairForma(text, dflt = 'pix') {
  const t = String(text || '');
  // "Transferência Pix realizada" é como vários bancos rotulam Pix. Nesses
  // casos Pix é a forma real; "transferência" é só o tipo de movimentação.
  if (/\bpix\b/i.test(t)) return 'pix';
  const m = t.match(FORMA_KW);
  if (!m) return dflt;
  const w = m[1].toLowerCase();
  if (w.startsWith('cart')) return 'cartao';
  if (w.startsWith('transfer')) return 'transferencia';
  return w; // pix | dinheiro | cheque
}

// ---- PORTA 2: o que a mídia REALMENTE é (fix 17/08/2026) -------------------
// Print de tela do LA Report/Emusys tem valor e nome do aluno escritos nele:
// sem esta porta, a Sol lê o próprio relatório como comprovante e lança dinheiro
// que nunca entrou. Ordem importa: tela vence tudo.
const SINAL_TELA = /(fechamento de caixa|abertura de caixa|saldo inicial|saldo final|movimenta[cç][oõ]es do dia|vendas do dia|gerado pelo la report|la report|gest[aã]o de renova[cç][oõ]es|dados pessoais|hist[oó]rico de aulas|aulas a repor|cr[eé]dito de horas|fideliza|em andamento|status\s+descri[cç][aã]o\s+vencimento|forma de pagamento\s+recebedor|valor devido|comprovante recebido|posso lan[cç]ar|lancei no caixa|conferido por)/i;
const SINAL_COMPROVANTE = /(comprovante|transa[cç][aã]o conclu[ií]da|transfer[eê]ncia (realizada|conclu)|id da transa|e2e[a-z0-9]|chave pix|pix copia|recibo|pagamento (realizado|efetuado|conclu)|transferir para|dados do (recebedor|destinat)|detalhes do (remetente|destinat)|institui[cç][aã]o|autentica[cç][aã]o|nsu|valor pago|data de pagamento|remetente)/i;
const SINAL_DESPESA = /(or[cç]amento|cota[cç][aã]o|proposta comercial|pedido\s*#|totalizadores|vendedor|nota fiscal|danfe|fornecedor|itens:)/i;
const BODY_SINTETICO = /^\s*(document|image|video|audio|sticker|photo)\s+received\s*$/i;

// O bridge manda "document received" quando não há legenda — isso não é texto humano.
function bodyLimpo(body) {
  const t = String(body || '').trim();
  return BODY_SINTETICO.test(t) ? '' : t;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// tipo: 'comprovante' | 'tela_sistema' | 'despesa' | 'indefinido'
function classificarMidia(ocrText, body) {
  const ocr = String(ocrText || '');
  const cap = bodyLimpo(body);
  if (SINAL_TELA.test(ocr)) return { tipo: 'tela_sistema', motivo: 'print_de_tela_do_sistema' };
  if (SINAL_COMPROVANTE.test(ocr)) return { tipo: 'comprovante', motivo: 'sinal_de_comprovante' };
  if (SINAL_DESPESA.test(ocr)) return { tipo: 'despesa', motivo: 'orcamento_ou_compra' };
  if (cap && (FIN_KW.test(cap) || MONEY.test(cap))) return { tipo: 'comprovante', motivo: 'legenda_financeira' };
  if (ocr.trim().length < 20) return { tipo: 'indefinido', motivo: 'nao_consegui_ler' };
  return { tipo: 'indefinido', motivo: 'sem_sinal_de_comprovante' };
}

function detectarComprovante(event) {
  if (!event || !event.hasMedia) return { ok: false, motivo: 'sem_midia' };
  const mt = String(event.mediaType || '').toLowerCase();
  if (mt.startsWith('audio') || mt === 'ptt') return { ok: false, motivo: 'audio' };
  const body = String(event.body || '');
  if (FIN_KW.test(body) || MONEY.test(body)) return { ok: true, motivo: 'midia+financeiro' };
  if (mt.startsWith('image') || mt.includes('pdf') || mt === 'document') {
    return { ok: true, motivo: 'midia_financeira_provavel' };
  }
  return { ok: false, motivo: 'midia_nao_financeira' };
}


// ---- gate de confirmacao (fix 17/08/2026: token solto no meio de frase NAO autoriza) ----
function _normConf(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
// A mensagem INTEIRA e a confirmacao? ("pode", "pode lancar", "pode, R$ 430",
// "pode dinheiro 250,00"). Uma palavra afirmativa perdida no meio de uma frase de
// conversa ("pode responder mas...", "quando a sol lancar no report...") NAO conta.
function confirmacaoLimpa(text, tokens) {
  let t = _normConf(text);
  if (!t) return false;
  t = t.replace(/[\s.!?]+$/, '').replace(/^[\s,.]+/, '');
  if (!t) return false;
  const cauda = '(\\s*[,;:-]?\\s*(pode|sim|sol|entao|ai|ta|ta\\s+certo|tudo\\s+certo|por\\s+favor|pfv|obrigad[ao]|vlw|valeu))*';
  const valor = '(\\s*[,;:-]?\\s*(r\\$\\s*)?\\d[\\d.,]*)?';
  const forma = '(\\s*[,;:-]?\\s*(no|na|em|via|com)?\\s*(pix|dinheiro|cartao(?:\\s+(?:de)?bito|\\s+credito)?|cheque|transferencia)(\\s*\\d{1,2}\\s*x)?)?';
  const re = new RegExp('^' + tokens + cauda + valor + forma + valor + '$');
  return re.test(t);
}

// Tokens que valem como mensagem INTEIRA (forte) e os que so valem citando o preview (frouxo).
const TOK_LANCAR_FORTE = '(pode|sol\\s+pode|pode\\s+sim|pode\\s+lancar|pode\\s+lanca|confirmo|confirmado|autorizo|autorizado|manda\\s+ver)';
const TOK_LANCAR_REPLY = '(pode|sol\\s+pode|pode\\s+sim|pode\\s+lancar|pode\\s+lanca|lancar|lanca|confirmo|confirmado|autorizo|autorizado|isso\\s+mesmo|manda\\s+ver|sim|ok|blz|beleza|isso)';

// "pode" de confirmação (evita "pode ser" = talvez). Extrai valor/forma opcionais.
// respondeuPreview=true (a msg cita o preview) afrouxa o gate; sem citar, a mensagem
// inteira tem que ser a confirmação.
function casarPode(text, { respondeuPreview = false } = {}) {
  const t = String(text || '').trim();
  if (!t) return { pode: false };
  if (/\bpode\s+ser\b/i.test(t)) return { pode: false };
  const ok = respondeuPreview
    ? (confirmacaoLimpa(t, TOK_LANCAR_REPLY) || new RegExp('(^|\\s)' + TOK_LANCAR_REPLY + '(\\s|$|[,.!])', 'i').test(_normConf(t)))
    : confirmacaoLimpa(t, TOK_LANCAR_FORTE);
  if (!ok) return { pode: false };
  const cartao = extrairCartao(t);
  return {
    pode: true,
    valor: extrairValor(t, { allowBare: true }),
    forma: extrairForma(t, null),
    cartaoModalidade: cartao && cartao.modalidade,
    cartaoParcelas: cartao && cartao.parcelas,
  };
}

function fmtBRL(v) {
  return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Normaliza nome (igual cleanRecebedorName da Maria): title-case + conectores minusculos.
// "RAYSSA CRISTINE COSTA DA SILVA" -> "Rayssa Cristine Costa da Silva".
function tituloNome(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.toLowerCase().replace(/\b\p{L}/gu, ch => ch.toUpperCase()).replace(/\b(De|Da|Do|Das|Dos|E)\b/g, m => m.toLowerCase());
}

function montarPreview({ unidadeNome, valor, forma, categoria, aluno, competencia, parcela, confiancaBaixa, responsavelFinanceiro, formaIncerta, cartaoModalidade, cartaoParcelas, multiplas, alunoViaPagador, pagadorNome, candidatosAluno, canonica, duplicata, quitacao, faturaIndisponivel, composto, bloqueiaLancamento, itemLojinha }) {
  // forma legível
  let formaTxt;
  if (forma === 'cartao') {
    const mod = cartaoModalidade === 'credito' ? 'crédito' : (cartaoModalidade === 'debito' ? 'débito' : cartaoModalidade);
    formaTxt = 'cartão' + (mod ? ' ' + mod : '') + (cartaoParcelas && cartaoParcelas > 1 ? ` ${cartaoParcelas}x` : '');
  } else if (forma) {
    formaTxt = forma;
  } else {
    formaTxt = '❓ forma não identificada';
  }

  const blocos = [];
  blocos.push([`📄 *Comprovante recebido — ${unidadeNome}*`]);

  // ---- RECEBIMENTO: o dinheiro que entrou
  blocos.push(['*RECEBIMENTO*', `${valor ? '*' + fmtBRL(valor) + '*' : '❓ valor não identificado'} · ${formaTxt}`]);

  // ---- ALUNO: de quem é
  const bAluno = ['*ALUNO*'];
  if (aluno) {
    bAluno.push(aluno);
    if (responsavelFinanceiro) bAluno.push(`Resp. financeiro: ${tituloNome(responsavelFinanceiro)}`);
    else if (pagadorNome && alunoViaPagador === 'comprovante' && mesmaPessoa(pagadorNome, aluno)) {
      bAluno.push(`Resp. financeiro: ${tituloNome(pagadorNome)} _(própria aluna no comprovante)_`);
    }
    if (pagadorNome && alunoViaPagador === 'familia') {
      bAluno.push(`Pagou: ${tituloNome(pagadorNome)} _(deduzi pelo sobrenome — confere?)_`);
    } else if (pagadorNome && alunoViaPagador === 'responsavel') {
      bAluno.push(`Pagou: ${tituloNome(responsavelFinanceiro || pagadorNome)} _(responsável cadastrado)_`);
    }
    if (confiancaBaixa) bAluno.push('⚠️ Não tenho certeza de qual aluno é — confere o nome.');
  } else if (candidatosAluno && candidatosAluno.length) {
    bAluno.push(`❓ Não identifiquei${pagadorNome ? ` — o pagamento veio de *${tituloNome(pagadorNome)}*` : ''}.`);
    bAluno.push('É de qual aluno?');
    candidatosAluno.forEach((c) => bAluno.push(`   – ${c}`));
  } else if (pagadorNome) {
    bAluno.push(`❓ Não achei pelo pagador (*${tituloNome(pagadorNome)}*) — me diz de quem é.`);
  } else {
    bAluno.push('❓ Não identifiquei — me diz de quem é.');
  }
  blocos.push(bAluno);

  let fecho = null;

  // ---- FATURA: a que se refere
  const linhasCan = canonica ? linhasDaFatura(canonica, valor) : [];
  if (composto && Array.isArray(composto.partes) && composto.partes.length >= 2) {
    const b = ['*FATURA*'];
    b.push(`Pagamento composto — ${composto.partes.length} parcelas/curso${composto.partes.length > 1 ? 's' : ''}`);
    if (composto.competencia) b.push(`Competência: *${composto.competencia}*`);
    composto.partes.forEach((p) => b.push(`${p.curso || p.label || 'Parte'}: ${fmtBRL(p.valor)}`));
    if (valor && Math.abs(composto.partes.reduce((s, p) => s + Number(p.valor || 0), 0) - Number(valor)) < 0.05) {
      b.push(`✅ Soma confere com o comprovante (${fmtBRL(valor)})`);
    }
    blocos.push(b);
  } else if (multiplas) {
    const b = ['*FATURA*'];
    const q = quitacao || {};
    b.push('Quitação — pagamento de *várias parcelas*' + (q.n ? ` (${q.n}x` + (q.vparc ? ` de ${fmtBRL(q.vparc)}` : '') + ')' : ''));
    if (q.inicio && q.fim) {
      b.push(`Meses: *${q.inicio} a ${q.fim}*`);
      if (q.proposto) b.push('_Deduzi pela 1ª parcela — se for outro período, me diz: *de 09/2026 a 08/2027*._');
    } else {
      b.push('❓ Quais meses? Me diz: *de 08/2026 a 07/2027*');
    }
    blocos.push(b);
  } else if (linhasCan.length) {
    blocos.push(['*FATURA*'].concat(linhasCan));
  } else if (parcela && parcela.descricao) {
    const b = ['*FATURA*'];
    let l = parcela.descricao;
    if (parcela.vencimento) l += ` · vence ${parcela.vencimento}`;
    b.push(l);
    if (parcela.valor !== null && parcela.valor !== undefined) b.push(`Valor: ${fmtBRL(parcela.valor)}`);
    if (parcela.valor_bate === false) b.push('⚠️ O valor do comprovante difere do valor da parcela — confere.');
    if (parcela.multiplas_no_mes) b.push('⚠️ Esse aluno tem mais de uma parcela aberta no mês — confere o curso.');
    if (bloqueiaLancamento) b.push('⚠️ Não vou lançar com *pode* enquanto essa divergência não for explicada.');
    blocos.push(b);
  } else if (bloqueiaLancamento) {
    fecho = '👉 Me explica a divisão ou responde no preview certo antes de lançar.';
  } else {
    const b = ['*LANÇAMENTO*', `Categoria: ${categoria || 'parcela'}`];
    if (categoria === 'lojinha' && itemLojinha) b.push(`Item: ${itemLojinha}`);
    if (competencia) b.push(`Competência: ${competencia}`);
    if (faturaIndisponivel) b.push('⚠️ Não consegui confirmar a fatura na fonte oficial agora — não vou lançar com *pode* até confirmar.');
    blocos.push(b);
  }

  // ---- ATENÇÃO: só quando existe
  if (duplicata) {
    blocos.push(['*ATENÇÃO*',
      `Já tem uma entrada de ${fmtBRL(Number(duplicata.valor))} no caixa de hoje (${duplicata.hora}${duplicata.descricao ? ' — ' + duplicata.descricao : ''}).`,
      'É outro pagamento?']);
  }

  // ---- o que eu preciso pra lançar
  const semAluno = !aluno && !!(candidatosAluno && candidatosAluno.length || pagadorNome);
  if (faturaIndisponivel) {
    fecho = '👉 Confirma aluno, competência e curso/parcela antes de lançar.';
  } else if (semAluno && valor && !formaIncerta) {
    fecho = '👉 Me diz de qual aluno é que eu lanço.';
  } else if (!valor && formaIncerta) {
    fecho = '👉 Me diz o valor e a forma: *pode, R$ 5.700 no cartão 12x*';
  } else if (!valor) {
    fecho = '👉 Me manda o valor: *pode, R$ 300*';
  } else if (formaIncerta) {
    fecho = '👉 Me confirma a forma: *pode, pix* / *pode, dinheiro* / *pode, cartão*';
  } else {
    fecho = '👉 *Posso lançar no caixa de hoje?* Responde *pode*';
  }
  blocos.push([fecho]);

  // Cada secao: TITULO, linha em branco, itens com bullet (pedido do Alf). Uso '•' e nao '*'
  // porque no WhatsApp o asterisco e' marcador de NEGRITO e negritaria metade do bloco.
  const _ehTitulo = (t) => /^\*[A-ZÇÃÁÉÍÓÚÂÊÔ ]+\*$/.test(t);
  const _semBullet = (l) => /^[\s•–—]/.test(l) || /^(⚠|🔴|✅|ℹ|❓|👉|_)/u.test(l.trim());
  const formatarBloco = (b) => {
    if (b.length <= 2 || !_ehTitulo(b[0])) return b.join('\n');
    const itens = b.slice(1).map((l) => (_semBullet(l) ? l : '• ' + l));
    return b[0] + '\n\n' + itens.join('\n');
  };
  return blocos.map(formatarBloco).join('\n\n');
}

// Nome de quem PAGOU, lido do comprovante ("De\nFULANO", "Detalhes do remetente ... Nome X").
const _NAO_PESSOA = /(institui|banco|santander|itau|ita[uú]|nubank|bradesco|caixa|inter|pagbank|99pay|picpay|mercado|ltda|me\b|s\.?a\.?$|music|escola|chave|pix|cnpj|cpf|ag[eê]ncia|conta)/i;
function extrairPagador(texto) {
  const t = String(texto || '').replace(/\r/g, '');
  const tentativas = [
    /(?:^|\n)\s*de\s*:?\s*\n+\s*([^\n]{6,100})/i,
    /remetente[\s\S]{0,180}?nome\s*:?\s*(?:\n+\s*)?([^\n]{6,100})/i,
    /origem[\s\S]{0,220}?nome\s*:?\s*(?:\n+\s*)?([^\n]{6,100})/i,
    /(?:pagador|origem|debitado de|enviado por)\s*:?\s*([^\n]{6,100})/i,
  ];
  for (const re of tentativas) {
    const m = t.match(re);
    if (!m) continue;
    // Alguns bancos prefixam o nome com CPF/CNPJ/identificador. Isso não é
    // nome: removemos só o prefixo e deixamos a resolução para a RPC canônica.
    const nome = String(m[1]).split('\n')[0]
      .replace(/^(?:\d[\d.\-\/\s]{5,}\s+)+/, '')
      .replace(/\s+/g, ' ').trim();
    if (nome.length < 6) continue;
    if (_NAO_PESSOA.test(nome)) continue;
    if (nome.split(' ').filter(Boolean).length < 2) continue;
    return nome;
  }
  return null;
}

// ---- I/O: env + chamada da RPC ------------------------------------------

function carregarEnv() {
  const env = {};
  for (const p of ENV_CANDIDATES) {
    let txt;
    try { txt = fs.readFileSync(p, 'utf8'); } catch { continue; }
    for (const raw of txt.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const i = line.indexOf('=');
      env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  const url = env.LA_REPORT_SUPABASE_URL || env.SUPABASE_URL || 'https://ouqwbbermlzqqvtqwlul.supabase.co';
  const key = env.LA_REPORT_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  return { url: String(url).replace(/\/+$/, ''), key };
}

function hashHex(alg, value) {
  return crypto.createHash(alg).update(String(value || '')).digest('hex');
}

function sha256(value) {
  return hashHex('sha256', value);
}

function md5(value) {
  return hashHex('md5', value);
}

function _parseVisionJson(stdout) {
  const txt = String(stdout || '').trim();
  if (!txt) return null;
  const lines = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith('{')) continue;
    try { return JSON.parse(lines[i]); } catch {}
  }
  const ini = txt.lastIndexOf('{');
  const fim = txt.lastIndexOf('}');
  if (ini >= 0 && fim > ini) {
    try { return JSON.parse(txt.slice(ini, fim + 1)); } catch {}
  }
  return null;
}

// Le o comprovante (imagem) por visao e extrai {valor, aluno, forma}. Best-effort:
// falha -> resolve(null) (o preview cai no fallback de pedir o valor). O humano
// SEMPRE confirma o valor no "pode" — a visao so monta o preview, nao decide dinheiro.
function extrairComprovanteVisao(imagePath, env, { timeout = 45000 } = {}) {
  return new Promise((resolve) => {
    if (!imagePath) return resolve(null);
    try { if (!fs.existsSync(imagePath)) return resolve(null); } catch { return resolve(null); }

    const prompt = 'Este e um comprovante de pagamento (Pix, transferencia ou cartao) de uma escola. '
      + 'Extraia e responda SOMENTE um JSON valido, sem markdown, com as chaves: '
      + 'valor (numero em reais, ex 509.00), '
      + 'aluno (nome do aluno, se estiver explícito; string, ou null), '
      + 'pagador_nome (nome de quem enviou o pagamento/origem do Pix; nunca o destinatário; string, ou null), '
      + 'forma ("pix" | "dinheiro" | "cartao" | "transferencia" | null). '
      + 'Se nao tiver certeza de um campo, use null.';

    execFile(
      '/home/sol/.hermes/hermes-agent/venv/bin/python',
      [
        '-m', 'hermes_cli.main',
        'chat',
        '-Q',
        '--source', 'tool',
        '--max-turns', '1',
        '--ignore-rules',
        '--image', imagePath,
        '-q', prompt,
      ],
      {
        cwd: '/home/sol',
        timeout,
        maxBuffer: 256 * 1024,
        env: Object.assign({}, process.env, {
          HOME: process.env.HOME || '/home/sol',
          HERMES_HOME: process.env.HERMES_HOME || '/home/sol/.hermes/profiles/sol',
        }),
      },
      (err, stdout) => {
        if (err) return resolve(null);
        const o = _parseVisionJson(stdout);
        if (!o || typeof o !== 'object') return resolve(null);
        let valor = o.valor;
        if (typeof valor === 'string') valor = parseBRMoney(valor);
        resolve({
          valor: (typeof valor === 'number' && valor > 0) ? valor : null,
          aluno: o.aluno || o.aluno_ou_pagador || null,
          pagador_nome: o.pagador_nome || o.pagador || null,
          forma: (o.forma ? String(o.forma).toLowerCase() : null),
        });
      }
    );
  });
}

function lancarRecebimento(payload, { url, key } = carregarEnv()) {
  return new Promise((resolve, reject) => {
    if (!key) return reject(new Error('missing SUPABASE service key'));
    const body = JSON.stringify({ p_payload: payload });
    const u = new URL(`${url}/rest/v1/rpc/sol_caixa_lancar_recebimento`);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: {
        'apikey': key, 'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(data ? JSON.parse(data) : null); }
        catch (e) { reject(new Error(`resposta invalida (${res.statusCode})`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout RPC lancar')));
    req.write(body); req.end();
  });
}

function lancarSaidaCaixa(payload, { url, key } = carregarEnv()) {
  return new Promise((resolve, reject) => {
    if (!key) return reject(new Error('missing SUPABASE service key'));
    const body = JSON.stringify({ p_payload: payload });
    const u = new URL(`${url}/rest/v1/rpc/sol_caixa_lancar_saida`);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: {
        'apikey': key, 'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(data ? JSON.parse(data) : null); }
        catch (e) { reject(new Error(`resposta invalida (${res.statusCode})`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout RPC saida')));
    req.write(body); req.end();
  });
}

function corrigirFormaRecebimento(payload, { url, key } = carregarEnv()) {
  return new Promise((resolve, reject) => {
    if (!key) return reject(new Error('missing SUPABASE service key'));
    const body = JSON.stringify({ p_payload: payload });
    const u = new URL(`${url}/rest/v1/rpc/sol_caixa_corrigir_forma_recebimento`);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: {
        'apikey': key, 'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(data ? JSON.parse(data) : null); }
        catch (e) { reject(new Error(`resposta invalida (${res.statusCode})`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout RPC corrigir')));
    req.write(body); req.end();
  });
}

function buscarLancamentoParaCorrecao(payload, { url, key } = carregarEnv()) {
  return new Promise((resolve, reject) => {
    if (!key) return reject(new Error('missing SUPABASE service key'));
    const body = JSON.stringify({ p_payload: payload });
    const u = new URL(`${url}/rest/v1/rpc/sol_caixa_buscar_lancamento_para_correcao`);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: {
        'apikey': key, 'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(data ? JSON.parse(data) : null); }
        catch (e) { reject(new Error(`resposta invalida (${res.statusCode})`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout RPC buscar correcao')));
    req.write(body); req.end();
  });
}

function chamarRpcCaixa(nome, payload, { url, key } = carregarEnv(), timeout = 15000) {
  return new Promise((resolve, reject) => {
    if (!key) return reject(new Error('missing SUPABASE service key'));
    const body = JSON.stringify({ p_payload: payload });
    const u = new URL(`${url}/rest/v1/rpc/${nome}`);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: {
        'apikey': key, 'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(data ? JSON.parse(data) : null); }
        catch (e) { reject(new Error(`resposta invalida (${res.statusCode})`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error(`timeout RPC ${nome}`)));
    req.write(body); req.end();
  });
}

function chamarRpcCaixaParam(nome, argName, payload, { url, key } = carregarEnv(), timeout = 15000) {
  return new Promise((resolve, reject) => {
    if (!key) return reject(new Error('missing SUPABASE service key'));
    const body = JSON.stringify({ [argName]: payload });
    const u = new URL(`${url}/rest/v1/rpc/${nome}`);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: {
        'apikey': key, 'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(data ? JSON.parse(data) : null); }
        catch (e) { reject(new Error(`resposta invalida (${res.statusCode})`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error(`timeout RPC ${nome}`)));
    req.write(body); req.end();
  });
}

function registrarPreviewV3(payload, env) {
  return chamarRpcCaixa('sol_caixa_shadow_registrar', payload, env);
}

function registrarApprovalV3(payload, env) {
  return chamarRpcCaixaParam('sol_caixa_shadow_registrar_approval', 'payload', payload, env);
}

function buscarMovimentosCaixa(payload, env) {
  return chamarRpcCaixa('sol_caixa_buscar_movimentos_v1', payload, env);
}

function corrigirMovimentoCaixa(payload, env) {
  return chamarRpcCaixa('sol_caixa_corrigir_movimento_v1', payload, env);
}

function estornarMovimentoCaixa(payload, env) {
  return chamarRpcCaixa('sol_caixa_estornar_movimento_v1', payload, env);
}

function extrairCorrecaoForma(text) {
  const t = _normConf(text).replace(/^sol\b\s*[,;:-]?\s*/i, '');
  if (!t) return null;
  if (!/\b(pix|dinheiro|cartao|debito|credito|cheque|transferencia|transfer)\b/i.test(t)) return null;
  const querCorrigir = /(foi|era|corrig|muda|troca|nao e|não é|entrou como|lancou como|lançou como)/i.test(t);
  if (!querCorrigir) return null;
  const cartao = extrairCartao(t);
  if (cartao && !/\bnao\s+(?:e|eh|é)\s+cartao\b/.test(t)) {
    return { forma: 'cartao', cartaoModalidade: cartao.modalidade || null, cartaoParcelas: cartao.parcelas || null };
  }
  if (/\bpix\b/i.test(t)) return { forma: 'pix', cartaoModalidade: null, cartaoParcelas: null };
  if (/\bdinheiro\b/i.test(t)) return { forma: 'dinheiro', cartaoModalidade: null, cartaoParcelas: null };
  if (/\btransferencia\b|\btransferência\b|\btransfer\b/i.test(t)) return { forma: 'transferencia', cartaoModalidade: null, cartaoParcelas: null };
  if (/\bcheque\b/i.test(t)) return { forma: 'cheque', cartaoModalidade: null, cartaoParcelas: null };
  if (/\b(?:entrou|lancou|lancou)\s+como\s+cartao\b/i.test(t) || /\bnao\s+(?:e|eh)\s+cartao\b/i.test(t)) return { forma: null };
  if (/\bcartao\b/i.test(t)) return { forma: 'cartao', cartaoModalidade: null, cartaoParcelas: null };
  return { forma: null };
}

function extrairLancamentoCitado(text) {
  const raw = String(text || '');
  if (!/lancei no caixa/i.test(raw)) return null;
  const valor = extrairValor(raw, { allowBare: true });
  if (!valor) return null;
  const forma = /\(([^)]+)\)/.exec(raw);
  const formaTxt = forma ? _normConf(forma[1]) : '';
  let formaAtual = null;
  let cartaoModalidade = null;
  if (/\bpix\b/.test(formaTxt)) formaAtual = 'pix';
  else if (/\bdinheiro\b/.test(formaTxt)) formaAtual = 'dinheiro';
  else if (/\btransfer/.test(formaTxt)) formaAtual = 'transferencia';
  else if (/\bcheque\b/.test(formaTxt)) formaAtual = 'cheque';
  else if (/\bcartao\b/.test(formaTxt)) {
    formaAtual = 'cartao';
    if (/\bdebito\b/.test(formaTxt)) cartaoModalidade = 'debito';
    if (/\bcredito\b/.test(formaTxt)) cartaoModalidade = 'credito';
  }
  const cat = /:\s*([^—\-\n]+)[—\-]/.exec(raw);
  const categoriaTxt = cat ? _normConf(cat[1]).trim() : '';
  let categoria = null;
  if (/passaporte/.test(categoriaTxt)) categoria = 'passaporte';
  else if (/lojinha|venda/.test(categoriaTxt)) categoria = 'lojinha';
  else if (/matricula|matr[ií]cula/.test(categoriaTxt)) categoria = 'matricula';
  else if (/parcela|mensalidade|quitacao|quitacao/.test(categoriaTxt)) categoria = 'parcela';
  return { valor, formaAtual, cartaoModalidade, categoria };
}

function extrairComandoMovimento(text) {
  const raw = String(text || '');
  const t = _normConf(raw).replace(/^sol\b\s*[,;:-]?\s*/i, '').trim();
  if (!t) return null;
  if (/\b(estorna|estornar|cancela|cancelar|exclui|excluir|apaga|apagar|desfaz|desfazer)\b/i.test(t)) {
    return { tipo: 'estornar', motivo: raw.replace(/^sol\b\s*[,;:-]?\s*/i, '').trim() || 'Estorno solicitado pelo grupo' };
  }
  const querCorrigir = /\b(corrig|corrige|corrigir|muda|mudar|altera|alterar|troca|trocar|nao e|não é|valor certo|valor correto)\b/i.test(t);
  if (!querCorrigir) return null;

  const correcoes = {};
  const valor = extrairValor(raw, { allowBare: true });
  if (valor && /\b(valor|r\$|reais|real|corrig|muda|altera|troca|nao e|não é)\b/i.test(t)) correcoes.valor = valor;

  const forma = extrairCorrecaoForma(raw);
  if (forma && forma.forma) {
    correcoes.forma_pagamento = forma.forma;
    correcoes.cartao_modalidade = forma.cartaoModalidade || null;
    correcoes.cartao_parcelas = forma.cartaoParcelas || null;
  }

  const cat = _categoriaExplicitaFromCaption(raw);
  if (cat && /\b(categoria|nao e|não é|corrig|muda|altera|troca|parcela|passaporte|lojinha|matr[ií]cula|seguran[cç]a)\b/i.test(t)) correcoes.categoria = cat;

  const responsavel = /respons[aá]vel\s+(?:e|é|eh|para|pra)\s+(.{3,80})$/i.exec(raw);
  if (responsavel) correcoes.responsavel = responsavel[1].trim();

  const descricao = /descri[cç][aã]o\s+(?:e|é|eh|para|pra)\s+(.{3,180})$/i.exec(raw);
  if (descricao) correcoes.descricao = descricao[1].trim();

  const keys = Object.keys(correcoes);
  const soForma = keys.length > 0 && keys.every((k) => ['forma_pagamento', 'cartao_modalidade', 'cartao_parcelas'].includes(k));
  if (keys.length === 0 || soForma) return null;
  return { tipo: 'corrigir', correcoes, motivo: raw.replace(/^sol\b\s*[,;:-]?\s*/i, '').trim() || 'Correção solicitada pelo grupo' };
}

// Casa o comprovante com a parcela REAL do aluno (emusys_faturas) via RPC read-only.
// Best-effort: falha/sem-match -> null. So enriquece o preview; nao decide dinheiro.
function casarParcela(unidadeId, aluno, valor, competencia, { url, key } = carregarEnv(), { timeout = 12000 } = {}) {
  return new Promise((resolve) => {
    if (!key || !unidadeId || !aluno) return resolve(null);
    const body = JSON.stringify({
      p_unidade_id: unidadeId,
      p_aluno: String(aluno),
      p_valor: (valor !== null && valor !== undefined) ? Number(valor) : null,
      p_competencia: competencia || null,
    });
    let u;
    try { u = new URL(`${url}/rest/v1/rpc/sol_caixa_casar_parcela`); } catch (e) { return resolve(null); }
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: {
        'apikey': key, 'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { const j = data ? JSON.parse(data) : null; resolve(j && j.ok ? j : null); }
        catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeout, () => req.destroy());
    req.write(body); req.end();
  });
}

// Responsável financeiro do aluno (read-only). Best-effort: falha -> null.
// O responsavel financeiro as vezes E o proprio aluno (as vezes com typo no cadastro).
// Nesse caso a linha do preview vira ruido -- omite.
function _chave(x) {
  return String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
function _dist(a, b) {
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
function mesmaPessoa(a, b) {
  const x = _chave(a), y = _chave(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  return _dist(x, y) / Math.max(x.length, y.length) <= 0.15;
}

function buscarResponsavel(unidadeId, aluno, { url, key } = carregarEnv(), { timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    if (!key || !unidadeId || !aluno) return resolve(null);
    const body = JSON.stringify({ p_unidade_id: unidadeId, p_aluno: String(aluno) });
    let u;
    try { u = new URL(`${url}/rest/v1/rpc/sol_caixa_responsavel_aluno`); } catch (e) { return resolve(null); }
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { const j = data ? JSON.parse(data) : null; resolve(j && j.ok ? j : null); }
        catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeout, () => req.destroy());
    req.write(body); req.end();
  });
}

// Identifica o aluno a partir do PAGADOR (responsavel cadastrado -> sobrenome de familia).
function identificarPorPagador(unidadeId, nome, { url, key } = carregarEnv(), { timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    if (!key || !unidadeId || !nome) return resolve(null);
    const body = JSON.stringify({ p_unidade_id: unidadeId, p_nome: String(nome) });
    let u;
    try { u = new URL(`${url}/rest/v1/rpc/sol_caixa_identificar_por_pagador`); } catch (e) { return resolve(null); }
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { const j = data ? JSON.parse(data) : null; resolve(j && j.ok ? j : null); }
        catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeout, () => req.destroy());
    req.write(body); req.end();
  });
}

// Duplicidade que importa e' no CAIXA DO DIA (nao no Emusys). Read-only, best-effort.
function jaLancadoHoje(unidadeId, valor, aluno, { url, key } = carregarEnv(), { timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    if (!key || !unidadeId || !valor) return resolve(null);
    const body = JSON.stringify({ p_unidade_id: unidadeId, p_valor: Number(valor), p_aluno: aluno || null });
    let u;
    try { u = new URL(`${url}/rest/v1/rpc/sol_caixa_ja_lancado_hoje`); } catch (e) { return resolve(null); }
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(data ? JSON.parse(data) : null); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeout, () => req.destroy());
    req.write(body); req.end();
  });
}

// Parcela na FONTE CANONICA (contrato v4): tipo, numero da parcela, competencia,
// vencimento, status (paga/aberta/vencida), dias de atraso e os tres valores.
function casarParcelaCanonica(unidadeId, aluno, valor, { url, key } = carregarEnv(), { timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    if (!key || !unidadeId || !aluno) return resolve(null);
    const body = JSON.stringify({ p_unidade_id: unidadeId, p_aluno: String(aluno),
      p_valor: (valor !== null && valor !== undefined) ? Number(valor) : null });
    let u;
    try { u = new URL(`${url}/rest/v1/rpc/sol_caixa_parcela_canonica`); } catch (e) { return resolve(null); }
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(data ? JSON.parse(data) : null); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeout, () => req.destroy());
    req.write(body); req.end();
  });
}

// Linhas do preview a partir da fatura canonica. Regras do contrato:
//  - so chamar de "parcela" quando tipo_fatura='parcela';
//  - "parcela N de M" so quando os dois existem;
//  - valor da parcela = valor_com_desconto; vencida = valor_hoje (com multa/mora);
//  - nunca apresentar valor_sem_desconto_condicional como "o valor da parcela".
function linhasDaFatura(can, valorComprovante) {
  const f = can && can.fatura;
  if (!f) return [];
  const L = [];
  const rotulo = f.tipo_fatura === 'parcela'
    ? ((f.numero_parcela && f.total_parcelas_contrato)
        ? `Parcela ${f.numero_parcela}/${f.total_parcelas_contrato}` : 'Parcela')
    : (f.descricao || 'Lançamento');
  const comp = f.competencia ? String(f.competencia).slice(0, 7).split('-').reverse().join('/') : null;
  const venc = f.data_vencimento ? String(f.data_vencimento).slice(0, 10).split('-').reverse().slice(0, 2).join('/') : null;

  const cab = [rotulo];
  if (comp) cab.push(comp);
  if (venc) cab.push((f.vencida ? 'venceu ' : 'vence ') + venc);
  L.push(cab.join(' · '));

  const vp = (f.valor_da_parcela !== null && f.valor_da_parcela !== undefined) ? Number(f.valor_da_parcela) : null;
  const vh = (f.valor_hoje !== null && f.valor_hoje !== undefined) ? Number(f.valor_hoje) : null;
  const base = (f.status !== 'paga' && f.vencida && vh !== null) ? vh : vp;
  const bate = (valorComprovante && base !== null) ? Math.abs(Number(valorComprovante) - base) < 0.01 : null;
  const quitacao = (valorComprovante && vp) ? (Number(valorComprovante) % vp < 0.01 && Number(valorComprovante) / vp >= 2) : false;

  if (vp !== null) {
    L.push(`Valor: ${fmtBRL(vp)}${f.vencida ? ' (até o vencimento)' : ''}${bate === true ? '  ✅ confere' : ''}`);
  }
  if (f.vencida) {
    let l = `🔴 Atrasada há ${f.dias_atraso} dia(s)`;
    if (vh !== null && vp !== null && Math.abs(vh - vp) >= 0.01) l += ` — hoje com multa/mora: *${fmtBRL(vh)}*`;
    L.push(l);
  }
  if (f.status === 'paga') {
    const dt = f.data_pagamento ? String(f.data_pagamento).slice(0, 10).split('-').reverse().slice(0, 2).join('/') : null;
    const via = f.forma_pagamento && f.forma_pagamento.nome ? ` (${f.forma_pagamento.nome})` : '';
    L.push(`Já pago no Emusys${dt ? ' em ' + dt : ''}${via} — falta a baixa no caixa`);
  }
  if (quitacao) {
    L.push(`_O valor bate com ${Math.round(Number(valorComprovante) / vp)} parcelas — parece quitação._`);
  } else if (bate === false) {
    L.push(`⚠️ O comprovante (${fmtBRL(Number(valorComprovante))}) difere do valor da parcela — confere.`);
  }
  return L;
}

// ---- S3: resumo do caixa do dia (determinístico) ---------------------------
const PERGUNTA_CAIXA = /(quanto (entrou|entrando|recebeu|recebemos|foi lan[çc]ado)|como (t[áa]|esta|está) o caixa|resumo do caixa|caixa (de )?hoje|fechamento (de )?hoje|o que (j[áa] )?(entrou|foi lan[çc]ado)|total (do dia|de hoje)|quanto (tem|deu) (no |de )?caixa)/i;
function ehPerguntaDeCaixa(texto) {
  const t = bodyLimpo(texto);
  if (!t || t.length > 200) return false;
  return PERGUNTA_CAIXA.test(t);
}

function resumoDoDia(unidadeId, { url, key } = carregarEnv(), { timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    if (!key || !unidadeId) return resolve(null);
    const body = JSON.stringify({ p_unidade_id: unidadeId });
    let u;
    try { u = new URL(`${url}/rest/v1/rpc/sol_caixa_resumo_do_dia`); } catch (e) { return resolve(null); }
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { const j = data ? JSON.parse(data) : null; resolve(j && j.ok ? j : null); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeout, () => req.destroy());
    req.write(body); req.end();
  });
}

const _FORMA_LABEL = { pix: 'Pix', dinheiro: 'Dinheiro', cartao: 'Cartão', cheque: 'Cheque', transferencia: 'Transferência', outro: 'Outro' };
function montarResumoCaixa(r) {
  if (!r) return null;
  const L = [`📊 *Caixa de ${r.unidade} — ${r.data}*`, ''];
  if (r.caixa === 'nao_aberto') {
    L.push('O caixa de hoje ainda não foi aberto.');
    return L.join('\n');
  }
  const total = Number(r.total_entradas || 0);
  L.push('*ENTRADAS*');
  L.push('');
  L.push(`• Total: *${fmtBRL(total)}* em ${r.qtd} lançamento(s)`);
  const formas = r.por_forma || {};
  Object.keys(formas).forEach((f) => {
    L.push(`• ${_FORMA_LABEL[f] || f}: ${fmtBRL(Number(formas[f]))}`);
  });
  const lanc = Array.isArray(r.lancamentos) ? r.lancamentos : [];
  if (lanc.length) {
    L.push('');
    L.push('*LANÇAMENTOS*');
    L.push('');
    lanc.slice(0, 10).forEach((x) => {
      L.push(`• ${x.hora} — ${fmtBRL(Number(x.valor))} (${_FORMA_LABEL[x.forma] || x.forma}) — ${x.descricao || x.categoria || ''}`);
    });
    if (lanc.length > 10) L.push(`_(+${lanc.length - 10} lançamento(s))_`);
  }
  L.push('');
  L.push(r.caixa === 'fechado'
    ? `✅ Caixa *fechado*${r.fechado_por ? ' por ' + r.fechado_por : ''} — saldo final ${fmtBRL(Number(r.saldo_final || 0))}.`
    : `🟢 Caixa *aberto* — saldo do cofre ${fmtBRL(Number(r.saldo_inicial_cofre || 0))}.`);
  return L.join('\n');
}

// ---- handler com estado (pendências por grupo) --------------------------

// S0: quem e' a pessoa, pelo TELEFONE (o senderId e' LID do WhatsApp, id interno --
// nao serve pra cruzar cadastro). Read-only; falha -> null (cai no pushName).
function identificarPessoa(telefone, unidadeId, { url, key } = carregarEnv(), { timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    if (!key || !telefone) return resolve(null);
    const body = JSON.stringify({ p_telefone: String(telefone), p_unidade_id: unidadeId || null });
    let u;
    try { u = new URL(`${url}/rest/v1/rpc/sol_caixa_quem_e`); } catch (e) { return resolve(null); }
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(data ? JSON.parse(data) : null); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeout, () => req.destroy());
    req.write(body); req.end();
  });
}

// Nome pra assinar o lançamento: cadastro > pushName > 4 últimos dígitos.
function nomeParaCarimbo(identidade, event) {
  if (identidade && identidade.identificado && identidade.nome) return identidade.nome;
  return nomeDoAtor(event) + ' (não identificado)';
}

// Nome de quem falou (pushName do WhatsApp), com fallback pro número.
// Nome de aluno plausivel? ("image received", "document", "nao informado" nao sao nomes.
// O bridge injeta esse texto quando a midia vem sem legenda.)
const _NAO_NOME = /^(image|document|video|audio|sticker|photo|file)([\s_-]*received)?$|^(nao|n[aã]o)\s|received$|^null$|^undefined$|^(aluno|cliente|pagador|comprovante|recibo)$/i;
function nomePlausivel(nome) {
  const t = String(nome || '').trim();
  if (t.length < 4) return false;
  if (_NAO_NOME.test(t)) return false;
  if (!/[a-zA-ZÀ-ÿ]{3}/.test(t)) return false;
  if (/^\d+$/.test(t.replace(/\s/g, ''))) return false;
  return true;
}

function nomeDoAtor(event) {
  const n = String((event && event.senderName) || '').trim();
  if (n && !/^\+?\d[\d\s-]*$/.test(n)) return n;
  const num = String((event && event.senderId) || '').replace(/@.*/, '').replace(/\D/g, '');
  return num ? ('...' + num.slice(-4)) : 'alguém do grupo';
}

// "todas as parcelas", "quitou o ano", "antecipou": e' pagamento de VARIAS parcelas --
// casar uma parcela unica aqui seria mentira no lancamento.
const MULTIPLAS = /(todas\s+as\s+parcelas|todas\s+parcelas|quita(?:c|ç)(?:a|ã)o|quitou|quitar|antecipa(?:c|ç)(?:a|ã)o|antecipou|pacote\s+de\s+parcelas|ano\s+todo|semestre\s+todo)/i;
function pagamentoMultiplo(texto) { return MULTIPLAS.test(String(texto || '')); }

function extrairDivisaoPagamento(texto, total) {
  const t = String(texto || '');
  if (!t || !/(=|\+|divid|separad|guitarra|canto|piano|bateria|viol[aã]o|teclado)/i.test(t)) return null;
  const matches = [...t.matchAll(/(?:r\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+,\d{2}/gi)]
    .map((m) => ({ bruto: m[0], valor: parseBRMoney(m[0]), idx: m.index || 0 }))
    .filter((m) => m.valor && m.valor > 0);
  if (matches.length < 2) return null;
  const totalNum = Number(total || 0);
  let partes = matches;
  if (totalNum) {
    const iTotal = partes.findIndex((m) => Math.abs(m.valor - totalNum) < 0.05);
    if (iTotal >= 0 && partes.length > 2) partes = partes.filter((_, i) => i !== iTotal);
  }
  if (partes.length < 2) return null;
  const soma = partes.reduce((s, m) => s + Number(m.valor || 0), 0);
  if (totalNum && Math.abs(soma - totalNum) > 0.05) return null;
  return partes.map((m) => {
    const antes = t.slice(Math.max(0, m.idx - 28), m.idx).replace(/[=+,:;\-–—()]/g, ' ').replace(/\s+/g, ' ').trim();
    const label = (antes.split(' ').filter(Boolean).slice(-2).join(' ') || 'parte').trim();
    return { label, valor: m.valor };
  });
}

function extrairAdicionalPagamento(texto) {
  const t = String(texto || '');
  if (!t || !/(falta|faltou|junto|inclui|incluir|mais|\+|banda|projeto|passaporte|taxa\s+de\s+matr[íi]cula)/i.test(t)) return null;
  const valores = valoresMonetarios(t);
  if (valores.length !== 1) return null;
  const idx = valores[0].idx;
  const trecho = t.slice(Math.max(0, idx - 50), Math.min(t.length, idx + 50));
  let label = 'adicional';
  if (/banda|projeto\s+de\s+banda/i.test(trecho)) label = 'Projeto de banda';
  if (/passaporte|taxa\s+de\s+matr[íi]cula/i.test(trecho)) label = 'Passaporte';
  const valor = valores[0].valor;
  return valor > 0 ? { label, valor } : null;
}

function _categoriaFromCaption(body) {
  const t = String(body || '');
  if (/seguran[çc]a|vigia|porteiro/i.test(t)) return 'seguranca';
  if (/passaporte/i.test(t)) return 'passaporte';
  if (detectarLojinhaProduto(t)) return 'lojinha';
  if (/matr[íi]cula/i.test(t)) return 'matricula';
  return 'parcela';
}
function _categoriaExplicitaFromCaption(body) {
  const t = String(body || '');
  if (/seguran[çc]a|vigia|porteiro/i.test(t)) return 'seguranca';
  if (/passaporte/i.test(t)) return 'passaporte';
  if (/matr[íi]cula/i.test(t)) return 'matricula';
  if (detectarLojinhaProduto(t)) return 'lojinha';
  if (/\b(parcela|mensalidade)\b/i.test(t)) return 'parcela';
  return null;
}

function _descricaoSaidaTexto(texto, categoria) {
  const cat = String(categoria || '').toLowerCase();
  let t = bodyLimpo(texto)
    .replace(/^sol\s*[,!?:-]?\s*/i, ' ')
    .replace(/r\$\s*[\d.,]+/ig, ' ')
    .replace(/\b(pagamento|pg|semanal|semana|comprovante|recibo|dinheiro|pix|cart[ãa]o|transfer[êe]ncia|foi|no|na|de|do|da|em)\b/ig, ' ')
    .replace(/[^\p{L}\d\s./-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length < 3) return `PG Semana ${cap(cat)}`;
  return `PG Semana ${cap(cat)}${t.toLowerCase().includes(cat) ? '' : ' - ' + t}`;
}

function _pareceTesteLancarApagar(texto) {
  const t = bodyLimpo(texto);
  return /\b(apag(?:o|a|ar)|exclu(?:o|i|ir)|delet(?:o|a|ar))\b/i.test(t)
    && /\b(test(?:e|ar|ando)?|lanc(?:o|a|ar)|lan[çc](?:o|a|ar))\b/i.test(t);
}

function _alunoFromCaption(body) {
  let t = bodyLimpo(body);
  if (!t) return null;
  const rotulado = _alunoRotulado(t);
  if (rotulado) return rotulado;
  t = t.replace(/\b(parcela|passaporte|lojinha|mensalidade|matr[íi]cula|pagamento|comprovante|recibo|pix|dinheiro|cart[ãa]o|transfer[êe]ncia|boleto)\b/gi, ' ');
  t = t.replace(/\b(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/gi, ' ');
  t = t.replace(/r\$\s*[\d.,]+/gi, ' ').replace(/\d+/g, ' ').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return t.length >= 3 ? t : null;
}

// Nome do aluno quando o humano ROTULA explicitamente ("aluno: Fulano" / "aluna: Fulana").
// Sinal forte -- vale mais que o palpite do LLM (que pode ter dado timeout). Corta no fim
// da frase e tira etiqueta de unidade (KIDS/LA/CG/Barra/Recreio) e um instrumento no fim.
const _UNIDADE_TAG = /\b(kids|l\.?a|campo\s+grande|c\.?\s*grande|cg|barra|recreio|unidade)\b/gi;
const _INSTRUMENTO = /^(viol[a\u00e3]o|guitarra|baixo|teclado|piano|bateria|canto|voz|trombone|trombeta|trompete|sax(?:ofone)?|flauta|clarinete|viol(?:ino|oncelo)|cavaco|cavaquinho|ukulele|banjo|percuss[a\u00e3]o|teoria|musicaliza[c\u00e7][a\u00e3]o)$/i;
function _limparAlunoRotulado(nome) {
  let n = String(nome || '').split(/[\n,;|]/)[0];
  n = n.replace(/\b(v[eê]\s+se\s+localiza|se\s+localiza|localiza\s+sol|confere(?:\s+o\s+nome)?|por\s+favor|pfv)\b.*$/i, ' ');
  n = n.replace(/\br\$\s*[\d.,]+.*$/i, ' ');
  n = n.replace(/\br\s*$/i, ' ');
  n = n.replace(_UNIDADE_TAG, ' ').replace(/\s+/g, ' ').trim();
  let toks = n.split(' ').filter(Boolean);
  if (toks.length >= 3 && _INSTRUMENTO.test(toks[toks.length - 1])) toks = toks.slice(0, -1);
  n = toks.join(' ');
  return (nomePlausivel(n) && toks.length >= 2) ? n : null;
}
function _alunoRotulado(body) {
  const t = bodyLimpo(body);
  if (!t) return null;
  const m = t.match(/\balun[oa]s?\s*(?:(?:[:\-])\s*|(?:e|é)\s+)?([A-Za-z\u00c0-\u00ff][A-Za-z\u00c0-\u00ff.'\s]{3,80})/i);
  if (!m) return null;
  return _limparAlunoRotulado(m[1]);
}

function _cursoRotulado(body) {
  const t = bodyLimpo(body);
  if (!t) return null;
  const m = t.match(/\bcurso\s*(?:(?:[:\-])\s*|(?:e|é)\s+)?([A-Za-z\u00c0-\u00ff][A-Za-z\u00c0-\u00ff.'\s]{2,50})/i);
  if (!m) return null;
  let c = String(m[1] || '').split(/[\n,;|]/)[0].replace(/\s+/g, ' ').trim();
  c = c.replace(/\b(parcela|compet[eê]ncia|alun[oa]|valor|r\$).*$/i, '').trim();
  return c ? tituloNome(c) : null;
}

function _confirmacaoManualFatura(texto) {
  const aluno = _alunoRotulado(texto);
  const curso = _cursoRotulado(texto);
  const competencia = extrairCompetenciaTexto(texto);
  const temParcela = /\b(parcela|mensalidade)\b/i.test(String(texto || ''));
  if (!aluno || !competencia || !(curso || temParcela)) return null;
  return { aluno, curso, competencia };
}

function _alunoSuspeito(nome) {
  const n = bodyLimpo(nome);
  if (!n) return true;
  return /\b(restante|alun[oa]|passaporte|parcela|mensalidade|pagamento|comprovante)\b/i.test(n)
    || /\b(do|da|de)\s+(do|da|de)\b/i.test(n);
}

// Camada 1 de visao: OCR LOCAL (igual Maria) -- sem LLM, sem billing.
// Imagem -> tesseract (por+eng); PDF -> pdftotext, fallback pdftoppm+tesseract.
// `detailed` preserva o contrato legado (string por padrao), mas permite ao
// handler distinguir timeout, erro do tesseract e texto realmente vazio.
function ocrLocal(imagePath, { timeout = 45000, detailed = false } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let bytes = null;
    const finish = (text, meta = {}) => {
      const clean = String(text || '').trim();
      const result = {
        text: clean,
        status: meta.status || (clean ? 'ok' : 'texto_vazio'),
        duration_ms: Date.now() - startedAt,
        file_bytes: bytes,
        ...meta,
      };
      return resolve(detailed ? result : clean);
    };
    if (!imagePath) return finish('', { status: 'arquivo_ausente' });
    try {
      if (!fs.existsSync(imagePath)) return finish('', { status: 'arquivo_inexistente' });
      bytes = fs.statSync(imagePath).size;
    } catch (e) { return finish('', { status: 'arquivo_indisponivel', error_code: e && e.code || null }); }
    const isPdf = /\.pdf$/i.test(imagePath);
    if (isPdf) {
      execFile('/usr/bin/pdftotext', ['-layout', imagePath, '-'], { timeout, maxBuffer: 3 * 1024 * 1024 }, (err, stdout) => {
        const t = String(stdout || '').trim();
        if (t.length >= 15) return finish(t, { status: 'ok', engine: 'pdftotext', exit_code: err && err.code || 0, signal: err && err.signal || null });
        try {
          const cp = require('child_process');
          const pre = imagePath + '.ocrpg';
          const r = cp.spawnSync('/usr/bin/pdftoppm', ['-r', '200', '-png', '-f', '1', '-l', '1', imagePath, pre], { timeout, encoding: 'utf8' });
          const png = pre + '-1.png';
          if (!r.status && fs.existsSync(png)) {
            const rr = cp.spawnSync('/usr/bin/tesseract', [png, 'stdout', '-l', 'por+eng', '--psm', '6'], { timeout, encoding: 'utf8', maxBuffer: 3 * 1024 * 1024 });
            try { fs.unlinkSync(png); } catch (e) {}
            return finish(String(rr.stdout || '').trim(), { status: rr.status === 0 ? 'ok' : 'tesseract_error', engine: 'tesseract', psm: 6, exit_code: rr.status, signal: rr.signal || null });
          }
        } catch (e) {}
        return finish(t, { status: err && (err.killed || err.code === 'ETIMEDOUT') ? 'timeout' : 'texto_vazio', engine: 'pdftotext', exit_code: err && err.code || null, signal: err && err.signal || null });
      });
    } else {
      // PSM 6 (bloco) e 4 (colunas) em paralelo. Antes eram sequenciais e
      // dois timeouts de 45s transformavam uma falha transitória em 90s.
      const outcomes = [];
      const children = [];
      let done = false;
      const stopOthers = () => children.forEach((child) => { try { if (child && !child.killed) child.kill('SIGTERM'); } catch (_) {} });
      const isUsable = (text) => text.length >= 20 && (Boolean(extrairValorOcr(text)) || SINAL_COMPROVANTE.test(text));
      const conclude = (text, meta) => {
        if (done) return;
        done = true;
        stopOthers();
        finish(text, meta);
      };
      const onResult = (psm, err, stdout) => {
        if (done) return;
        const text = String(stdout || '').trim();
        const meta = {
          psm,
          engine: 'tesseract',
          exit_code: err && err.code || 0,
          signal: err && err.signal || null,
          timed_out: Boolean(err && (err.killed || err.code === 'ETIMEDOUT')),
        };
        outcomes.push({ text, meta });
        if (isUsable(text)) return conclude(text, { status: 'ok', ...meta, parallel: true });
        if (outcomes.length < 2) return;
        const texts = outcomes.map((x) => x.text).filter(Boolean);
        const timeoutSeen = outcomes.some((x) => x.meta.timed_out);
        const errorSeen = outcomes.some((x) => x.meta.exit_code && !x.meta.timed_out);
        conclude(texts.join('\n--- psm4 ---\n'), {
          status: texts.length ? 'ok_parcial' : (timeoutSeen ? 'timeout' : (errorSeen ? 'tesseract_error' : 'texto_vazio')),
          engine: 'tesseract',
          psm: outcomes.map((x) => x.meta.psm),
          exit_code: outcomes.map((x) => x.meta.exit_code),
          signal: outcomes.map((x) => x.meta.signal),
          timed_out: timeoutSeen,
          parallel: true,
        });
      };
      for (const psm of [6, 4]) {
        children.push(execFile('/usr/bin/tesseract', [imagePath, 'stdout', '-l', 'por+eng', '--psm', String(psm)], { timeout, maxBuffer: 3 * 1024 * 1024 }, (err, stdout) => onResult(psm, err, stdout)));
      }
    }
  });
}

// Interpreta categoria/aluno/competencia da legenda+OCR (LLM texto OAuth).
// Best-effort: falha -> null (cai no regex). NUNCA decide valor (isso e OCR).
function interpretarComprovante(texto, { timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    const t = String(texto || '').trim();
    if (t.length < 3) return resolve(null);
    const prompt = 'Recebimento de uma escola de musica. Do texto (legenda do WhatsApp + OCR do comprovante), '
      + 'responda SOMENTE um JSON valido, sem markdown: '
      + '{"categoria":"parcela|lojinha|passaporte|matricula|venda|seguranca|outro",'
      + '"aluno":"nome do ALUNO (nao o pagador do banco), ou null",'
      + '"competencia":"mes/parcela referida (ex: Agosto, 08/2026), ou null",'
      + '"forma":"pix|dinheiro|cartao|transferencia|cheque ou null"}. '
      + 'categoria: parcela=mensalidade; lojinha=produto/loja; passaporte=passaporte; matricula=matricula; incerto=outro. '
      + 'So o JSON.\n\nTEXTO:\n' + t.slice(0, 1500);
    execFile(
      '/home/sol/.hermes/hermes-agent/venv/bin/python',
      ['-m', 'hermes_cli.main', 'chat', '-Q', '--source', 'tool', '--max-turns', '1', '--ignore-rules', '-q', prompt],
      { cwd: '/home/sol', timeout, maxBuffer: 256 * 1024,
        env: Object.assign({}, process.env, { HOME: process.env.HOME || '/home/sol', HERMES_HOME: process.env.HERMES_HOME || '/home/sol/.hermes/profiles/sol' }) },
      (err, stdout) => {
        if (err) return resolve(null);
        const o = _parseVisionJson(stdout);
        if (!o || typeof o !== 'object') return resolve(null);
        const validas = ['parcela', 'lojinha', 'passaporte', 'matricula', 'venda', 'seguranca', 'despesa', 'retirada', 'troco', 'outro'];
        let cat = String(o.categoria || '').toLowerCase().trim().replace(/[^a-z0-9_-]/g, '');
        if (!validas.includes(cat)) cat = null;
        resolve({
          categoria: cat,
          aluno: (o.aluno && String(o.aluno).trim()) || null,
          competencia: (o.competencia && String(o.competencia).trim()) || null,
          forma: (o.forma ? String(o.forma).toLowerCase().trim() : null),
        });
      }
    );
  });
}

// tipo_fatura do contrato -> categoria do caixa
const _TIPO_CAT = { parcela: 'parcela', passaporte_taxa_matricula: 'passaporte',
  lojinha_produto: 'lojinha', venda_ingressos: 'venda', avulsa_outro: 'outro' };
function categoriaDaFatura(can) {
  const f = can && can.fatura;
  if (!f || !f.tipo_fatura) return null;
  return _TIPO_CAT[f.tipo_fatura] || null;
}
// descricao do lancamento a partir da fatura canonica
function descricaoDaFatura(can, aluno) {
  const f = can && can.fatura;
  if (!f) return null;
  let base;
  if (f.tipo_fatura === 'parcela') {
    const comp = f.competencia ? String(f.competencia).slice(0, 7).split('-').reverse().join('/') : null;
    base = (f.numero_parcela && f.total_parcelas_contrato)
      ? `Parcela ${f.numero_parcela}/${f.total_parcelas_contrato}` : 'Parcela';
    if (comp) base += ' ' + comp;
  } else {
    base = f.descricao || 'Recebimento';
  }
  return aluno ? `${base} - ${aluno}` : base;
}

// ---- quitacao: QUAIS meses (pedido da gerente da Barra) --------------------
const _MES_NOME = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7,
  agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
const _mm = (m, a) => String(m).padStart(2, '0') + '/' + a;
function _somaMeses(mes, ano, n) {
  let t = (ano * 12) + (mes - 1) + n;
  return { mes: (t % 12) + 1, ano: Math.floor(t / 12) };
}
// A partir da parcela escolhida (ex.: 1/12 competencia 08/2026) e do numero de parcelas pagas,
// projeta o intervalo. E' PROPOSTA -- o humano confirma ou corrige.
function periodoQuitacao(canonica, nParcelas) {
  const f = canonica && canonica.fatura;
  if (!f || !f.competencia || !nParcelas || nParcelas < 2) return null;
  const comp = String(f.competencia).slice(0, 7).split('-');
  const ano = Number(comp[0]), mes = Number(comp[1]);
  if (!ano || !mes) return null;
  const fim = _somaMeses(mes, ano, nParcelas - 1);
  return { inicio: _mm(mes, ano), fim: _mm(fim.mes, fim.ano), n: nParcelas, proposto: true };
}
// "de 09/2026 a 08/2027", "setembro a agosto", "ago/26 ate jul/27", "08/26-07/27"
function extrairPeriodoMeses(texto) {
  const t = _normConf(texto);
  if (!t) return null;
  const anoAtual = new Date().getFullYear();
  const num = /(\d{1,2})\s*[\/-]\s*(\d{2,4})\s*(?:a|ate|até|-|\u2192|=>)\s*(\d{1,2})\s*[\/-]\s*(\d{2,4})/;
  let m = t.match(num);
  if (m) {
    const a1 = Number(m[2]) < 100 ? 2000 + Number(m[2]) : Number(m[2]);
    const a2 = Number(m[4]) < 100 ? 2000 + Number(m[4]) : Number(m[4]);
    return { inicio: _mm(Number(m[1]), a1), fim: _mm(Number(m[3]), a2) };
  }
  const nomes = Object.keys(_MES_NOME).join('|');
  const re = new RegExp('(' + nomes + ')[a-z]*\\s*(?:\\/|de\\s*)?(\\d{2,4})?\\s*(?:a|ate|até|-)\\s*(' + nomes + ')[a-z]*\\s*(?:\\/|de\\s*)?(\\d{2,4})?');
  m = t.match(re);
  if (m) {
    const m1 = _MES_NOME[m[1]], m2 = _MES_NOME[m[3]];
    let a1 = m[2] ? (Number(m[2]) < 100 ? 2000 + Number(m[2]) : Number(m[2])) : anoAtual;
    let a2 = m[4] ? (Number(m[4]) < 100 ? 2000 + Number(m[4]) : Number(m[4])) : a1;
    if (!m[4] && m2 <= m1) a2 = a1 + 1;
    return { inicio: _mm(m1, a1), fim: _mm(m2, a2) };
  }
  return null;
}

function extrairCompetenciaTexto(texto) {
  const t = _normConf(texto);
  if (!t) return null;
  const anoAtual = new Date().getFullYear();
  let m = t.match(/\b(0?[1-9]|1[0-2])\s*[\/.-]\s*(20\d{2}|\d{2})\b/);
  if (m) {
    const mes = Number(m[1]);
    const ano = Number(m[2].length === 2 ? '20' + m[2] : m[2]);
    return _mm(mes, ano);
  }
  m = t.match(/\b(janeiro|fevereiro|marco|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\b(?:\s*(?:de|\/|-)?\s*(20\d{2}|\d{2}))?/);
  if (m) {
    const mes = _MES_NOME[m[1].replace('ç', 'c')];
    const ano = m[2] ? Number(m[2].length === 2 ? '20' + m[2] : m[2]) : anoAtual;
    if (mes && ano) return _mm(mes, ano);
  }
  return null;
}

function competenciaIso(competencia) {
  const c = extrairCompetenciaTexto(competencia) || String(competencia || '');
  const m = c.match(/\b(0[1-9]|1[0-2])\/(20\d{2})\b/);
  if (!m) return null;
  return `${m[2]}-${m[1]}-01`;
}

function valorFaturaCaixa(f) {
  const direto = f && (f.valor_pago !== null && f.valor_pago !== undefined) ? Number(f.valor_pago) : null;
  if (direto && direto > 0) return direto;
  const payload = f && f.payload && typeof f.payload === 'object' ? f.payload : {};
  const liquido = payload.valor_liquido_recebido !== null && payload.valor_liquido_recebido !== undefined ? Number(payload.valor_liquido_recebido) : null;
  if (liquido && liquido > 0) return liquido;
  const original = f && f.valor_original !== null && f.valor_original !== undefined ? Number(f.valor_original) : null;
  const desc = f && f.desconto_aplicado !== null && f.desconto_aplicado !== undefined ? Number(f.desconto_aplicado) : 0;
  if (original && original > 0) return Math.max(0, original - (desc || 0));
  return null;
}

function cursoDaFatura(f) {
  const tipo = String((f && f.tipo_fatura) || '');
  const d = String((f && f.descricao) || '');
  if (/passaporte|taxa.*matr/i.test(tipo) || /passaporte|taxa\s+de\s+matr[íi]cula/i.test(d)) return 'Passaporte';
  const m = d.match(/curso\s+(?:de\s+)?(.+?)\s*$/i);
  return (m && m[1] ? tituloNome(m[1].trim()) : (d || 'Parcela'));
}

function compostoDeFaturas(rows, valor, competencia, alunoNome) {
  const partes = (Array.isArray(rows) ? rows : [])
    .map((f) => ({ curso: cursoDaFatura(f), label: cursoDaFatura(f), valor: valorFaturaCaixa(f), descricao: f.descricao, status: f.status }))
    .filter((p) => p.valor && p.valor > 0);
  if (partes.length < 2) return null;
  const soma = partes.reduce((s, p) => s + Number(p.valor || 0), 0);
  if (valor && Math.abs(soma - Number(valor)) > 0.05) return null;
  return { ok: true, aluno_nome: alunoNome || null, competencia: extrairCompetenciaTexto(competencia), partes };
}

function descricaoDoComposto(composto, aluno) {
  if (!composto || !Array.isArray(composto.partes) || composto.partes.length < 2) return null;
  const cursos = composto.partes.map((p) => p.curso || p.label).filter(Boolean).join(' + ');
  const comp = composto.competencia ? ` ${composto.competencia}` : '';
  return `Parcelas${comp}${cursos ? ' ' + cursos : ''}${aluno ? ' - ' + aluno : ''}`;
}

function restGetJson(path, { url, key } = carregarEnv(), { timeout = 12000 } = {}) {
  return new Promise((resolve) => {
    if (!key || !url) return resolve(null);
    let u;
    try { u = new URL(`${String(url).replace(/\/+$/, '')}${path}`); } catch (e) { return resolve(null); }
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(data ? JSON.parse(data) : null); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeout, () => req.destroy());
    req.end();
  });
}

async function buscarCompostoFaturasMes(unidadeId, aluno, competencia, valor, env = carregarEnv()) {
  const iso = competenciaIso(competencia);
  if (!unidadeId || !aluno || !iso) return null;
  const nome = String(aluno).replace(/\s+/g, ' ').trim();
  if (!nome) return null;
  const alunos = await restGetJson(`/rest/v1/alunos?select=id,nome,emusys_student_id&unidade_id=eq.${encodeURIComponent(unidadeId)}&nome=ilike.*${encodeURIComponent(nome)}*&limit=5`, env);
  const alunoRow = Array.isArray(alunos) ? alunos.find((a) => a && a.emusys_student_id) : null;
  if (!alunoRow) return null;
  const rows = await restGetJson(`/rest/v1/emusys_faturas?select=id,descricao,status,competencia,data_vencimento,data_pagamento,valor_original,valor_pago,desconto_aplicado,payload&emusys_student_id=eq.${encodeURIComponent(alunoRow.emusys_student_id)}&competencia=eq.${encodeURIComponent(iso)}&order=descricao.asc`, env);
  const composto = compostoDeFaturas(rows, valor, competencia, alunoRow.nome || aluno);
  return composto;
}

function _descricaoLancamento(categoria, competencia, aluno, parcela) {
  if (parcela && parcela.descricao) {
    return aluno ? `${parcela.descricao} - ${aluno}` : parcela.descricao;
  }
  const cat = String(categoria || 'parcela');
  let s2 = cat.charAt(0).toUpperCase() + cat.slice(1);
  if (competencia) s2 += ' ' + competencia;
  if (aluno) s2 += ' - ' + aluno;
  return s2.length >= 3 ? s2 : 'Recebimento via Sol';
}

function _fonteCanonicaIndisponivel(c) {
  const motivo = String(c && (c.motivo || c.motivo_escolha || c.erro || '') || '').toLowerCase();
  return !c || motivo === 'fonte_indisponivel' || /fonte.*indispon|timeout|temporar|indisponivel/.test(motivo);
}

function categoriaEhSaida(categoria) {
  return ['seguranca', 'despesa', 'retirada', 'troco'].includes(String(categoria || '').toLowerCase());
}

function criarHandlerFinanceiro({ grupos, sendFn, lancarFn = lancarRecebimento, lancarSaidaFn = lancarSaidaCaixa, corrigirFormaFn = corrigirFormaRecebimento, buscarCorrecaoFn = buscarLancamentoParaCorrecao, buscarMovimentosFn = buscarMovimentosCaixa, corrigirMovimentoFn = corrigirMovimentoCaixa, estornarMovimentoFn = estornarMovimentoCaixa, registrarPreviewV3Fn = registrarPreviewV3, registrarApprovalV3Fn = registrarApprovalV3, visaoFn = extrairComprovanteVisao, ocrFn = ocrLocal, interpretarFn = interpretarComprovante, casarFn = casarParcela, responsavelFn = buscarResponsavel, pagadorFn = identificarPorPagador, canonicaFn = casarParcelaCanonica, faturasMesFn = buscarCompostoFaturasMes, duplicataFn = jaLancadoHoje, identidadeFn = identificarPessoa, resumoFn = resumoDoDia, log = () => {}, janelaMs = 30 * 60 * 1000, dryRun = (process.env.SOL_CAIXA_DRYRUN === '1') }) {
  // grupos: { [chatId]: { unidade_id, nome } }
  const pendentes = new Map();   // chatId -> [ {previewId, unidade_id, nome, valor, forma, categoria, aluno, idemKey, origem, ts} ]
  const lancadosRecentes = new Map(); // chatId -> [ {confirmMessageId, movimentacao_id, unidade_id, nome, valor, forma, ts} ]
  const vistos = new Set();      // idemKeys ja processados (anti-redelivery)
  const textosRecentes = new Map(); // chatId+senderId -> {texto, ts}: legenda/nome que veio em bolha IRMA (comprovante + nome em mensagens separadas)
  const lotesMidia = new Map();  // chatId+senderId -> lote curto: 2 PDFs + texto humano viram UM preview
  const textoIrmaoKey = (event) => `${event.chatId}::${event.senderId || event.senderPhone || 'sem_sender'}`;
  const loteJanelaMs = Math.max(0, Number(process.env.SOL_CAIXA_LOTE_MS || 900));
  const v3LedgerMode = String(process.env.SOL_CAIXA_V3_LEDGER_MODE || '').toLowerCase();
  const v3LedgerAtivo = ['production', 'prod', 'on', '1'].includes(v3LedgerMode);
  const v3LedgerStrict = process.env.SOL_CAIXA_V3_LEDGER_STRICT === '1';

  async function registrarPreviewPublicoV3({ event, grupo, previewId, texto, pendencia, result }) {
    if (!v3LedgerAtivo) return null;
    const previewJson = {
      public_preview_sent: true,
      preview_message_id: previewId,
      text: String(texto || '').slice(0, 5000),
      pending: pendencia,
      handler_result: result || null,
    };
    const previewHash = sha256(JSON.stringify(previewJson));
    const payload = {
      event_id_hash: sha256(event.messageId),
      chat_id_hash: md5(event.chatId),
      sender_id_hash: sha256(event.senderId || event.senderPhone || ''),
      unidade_id: grupo.unidade_id,
      observed_at: event.ts || new Date(Number(event.timestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      source: 'sol_caixa_whatsapp_production',
      mode: 'v3_production_public_preview',
      status: 'public_preview_sent',
      raw_ref: {
        message_id_sha256: sha256(event.messageId),
        body_sha256: sha256(event.body || ''),
        has_media: !!event.hasMedia,
        media_type: event.mediaType || null,
        preview_message_id: previewId,
      },
      resolver_json: {
        resolver: 'caixa-financeiro.cjs production',
        handler_result: result || null,
      },
      warnings: [],
      blocks: [],
      preview_hash: previewHash,
      operacao: pendencia.v3Operacao || (categoriaEhSaida(pendencia.categoria) ? 'saida' : 'entrada'),
      categoria: pendencia.categoria || 'unknown',
      valor_centavos: pendencia.valor != null ? String(Math.round(Number(pendencia.valor) * 100)) : '',
      forma: pendencia.forma || 'unknown',
      preview_status: 'public_preview_sent',
      preview_json: previewJson,
    };
    try {
      const registered = await registrarPreviewV3Fn(payload);
      log({ acao: 'v3_preview_ledger_registrado', ok: !!(registered && registered.ok), preview_ledger_id: registered && registered.preview_id });
      return { ...(registered || {}), preview_hash: previewHash };
    } catch (e) {
      log({ acao: 'v3_preview_ledger_erro', erro: String(e && e.message) });
      if (v3LedgerStrict) throw e;
      return null;
    }
  }

  async function registrarApprovalPublicoV3({ event, alvo, decision = 'approved' }) {
    if (!v3LedgerAtivo || !alvo || !alvo.v3PreviewId) return null;
    const approvalEventHash = sha256(event.messageId);
    const actorIdHash = sha256(event.senderId || event.senderPhone || '');
    const payload = {
      preview_id: alvo.v3PreviewId,
      approval_event_hash: approvalEventHash,
      actor_id_hash: actorIdHash,
      decision,
      decision_json: {
        source: 'sol_caixa_whatsapp_production',
        message_id_sha256: sha256(event.messageId),
        chat_id_hash: md5(event.chatId),
        preview_message_id: alvo.previewId || null,
        quoted_message_id: event.quotedMessageId || null,
        text_sha256: sha256(event.body || ''),
      },
    };
    try {
      const registered = await registrarApprovalV3Fn(payload);
      log({ acao: 'v3_approval_ledger_registrado', ok: !!(registered && registered.ok), approval_id: registered && registered.approval_id });
      return { ...(registered || {}), approval_event_hash: approvalEventHash, actor_id_hash: actorIdHash };
    } catch (e) {
      log({ acao: 'v3_approval_ledger_erro', erro: String(e && e.message) });
      if (v3LedgerStrict) throw e;
      return null;
    }
  }

  function lembrarLancado(chatId, item) {
    const arr = (lancadosRecentes.get(chatId) || []).filter((x) => (Date.now() - x.ts) <= 2 * janelaMs);
    arr.push({ ...item, ts: Date.now() });
    lancadosRecentes.set(chatId, arr.slice(-5));
  }
  function alvoLancado(chatId, quotedMessageId, agora = Date.now()) {
    const arr = (lancadosRecentes.get(chatId) || []).filter((x) => (agora - x.ts) <= 2 * janelaMs);
    lancadosRecentes.set(chatId, arr);
    if (quotedMessageId) return arr.find((x) => x.confirmMessageId === quotedMessageId || x.previewId === quotedMessageId) || null;
    return arr.length === 1 ? arr[0] : null;
  }

  async function prepararLoteMidia(event, agora) {
    if (!loteJanelaMs) return { event };
    const k = textoIrmaoKey(event);
    let lote = lotesMidia.get(k);
    if (!lote || (agora - lote.ts) > 5000) {
      lote = { lider: event.messageId, ts: agora, eventos: [event], textos: [] };
      lotesMidia.set(k, lote);
      await sleep(loteJanelaMs);
      if (lotesMidia.get(k) !== lote || lote.lider !== event.messageId) return { skip: true, acao: 'lote_midia_ignorado' };
      lotesMidia.delete(k);
      if (lote.eventos.length <= 1 && lote.textos.length === 0) return { event };
      const corpos = []
        .concat(lote.eventos.map((e) => bodyLimpo(e.body)).filter(Boolean))
        .concat(lote.textos.map((x) => bodyLimpo(x.texto)).filter(Boolean));
      const mediaUrls = lote.eventos.flatMap((e) => Array.isArray(e.mediaUrls) ? e.mediaUrls : []);
      const consolidado = {
        ...event,
        messageId: lote.eventos.map((e) => e.messageId).filter(Boolean).join('+') || event.messageId,
        body: corpos.join(' · '),
        mediaUrls,
      };
      log({ acao: 'lote_midia_consolidado', chatId: event.chatId, midias: lote.eventos.length, textos: lote.textos.length });
      return { event: consolidado };
    }
    lote.eventos.push(event);
    lote.ts = agora;
    log({ acao: 'lote_midia_anexada', chatId: event.chatId, midias: lote.eventos.length });
    return { skip: true, acao: 'lote_midia_anexada' };
  }

  function anexarTextoAoLote(event, texto, agora) {
    if (!loteJanelaMs || !texto) return false;
    const lote = lotesMidia.get(textoIrmaoKey(event));
    if (!lote || (agora - lote.ts) > 5000) return false;
    lote.textos.push({ texto, ts: agora });
    lote.ts = agora;
    log({ acao: 'lote_texto_anexado', chatId: event.chatId, textos: lote.textos.length });
    return true;
  }

  function limparVelhos(chatId, agora) {
    const arr = pendentes.get(chatId) || [];
    const vivos = arr.filter((p) => agora - p.ts < janelaMs);
    pendentes.set(chatId, vivos);
    return vivos;
  }

  async function handle(event, agora = Date.now()) {
    const chatId = event.chatId;
    const grp = grupos[chatId];
    if (!grp) return { acao: 'ignorado_fora_grupo' };
    const senderNum = String(event.senderPhone || event.senderId || '').replace(/@.*/, '').replace(/\D/g, '');

    // 0) pergunta sobre o caixa do dia -> resposta com DADO (nunca LLM)
    if (process.env.SOL_RESUMO_SHORTCUT !== '0' && !event.hasMedia && ehPerguntaDeCaixa(event.body)) {
      let quem = null;
      try { quem = await identidadeFn(event.senderPhone, grp.unidade_id); } catch (e) { /* best-effort */ }
      if (quem && quem.identificado && quem.pode_consultar === false) {
        log({ acao: 'resumo_negado', motivo: 'sem_permissao' });
        return { acao: 'resumo_negado' };
      }
      const r = await resumoFn(grp.unidade_id);
      const txt = montarResumoCaixa(r);
      if (txt) {
        await sendFn(chatId, txt);
        log({ acao: 'resumo_enviado', total: r && r.total_entradas });
        return { acao: 'resumo_enviado' };
      }
      log({ acao: 'resumo_indisponivel' });
      return { acao: 'nada' };
    }

    // 0.5) saida operacional por TEXTO tambem e caixa.
    // Caso real (19/08): "Sol, pagamento semanal do seguranca... R$100 no
    // dinheiro" caiu no LLM porque nao tinha midia. Isso nao pode acontecer:
    // o bridge monta preview deterministico e o "pode" de qualquer operador
    // autorizado da unidade passa pela RPC auditada.
    if (!event.hasMedia && !casarPode(event.body).pode) {
      const texto = bodyLimpo(event.body);
      const categoriaTexto = _categoriaExplicitaFromCaption(texto);
      if (categoriaEhSaida(categoriaTexto)) {
        const valor = extrairValor(texto);
        const forma = extrairForma(texto, null);
        if (!valor) {
          await sendFn(chatId, `Entendi que é saída de ${categoriaTexto}, mas falta o valor. Manda de novo com o valor.`);
          log({ acao: 'saida_texto_sem_valor', chatId, categoria: categoriaTexto });
          return { acao: 'saida_texto_sem_valor' };
        }
        if (!forma) {
          await sendFn(chatId, `Entendi que é saída de ${categoriaTexto}. Me diz a forma: *dinheiro*.`);
          log({ acao: 'saida_texto_sem_forma', chatId, categoria: categoriaTexto, valor });
          return { acao: 'saida_texto_sem_forma' };
        }
        const descricao = _descricaoSaidaTexto(texto, categoriaTexto);
        let textoPreview = montarPreview({
          unidadeNome: grp.nome, valor, forma, categoria: categoriaTexto,
          aluno: null, competencia: null, parcela: null, confiancaBaixa: false,
          responsavelFinanceiro: null, formaIncerta: false, cartaoModalidade: null,
          cartaoParcelas: null, multiplas: false, alunoViaPagador: null,
          pagadorNome: null, candidatosAluno: null, canonica: null, duplicata: null,
          quitacao: null, faturaIndisponivel: false, composto: null,
          bloqueiaLancamento: false, itemLojinha: null,
        });
        if (dryRun) textoPreview += '\n\n_(modo teste — nada será gravado no caixa)_';
        const previewId = await sendFn(chatId, textoPreview);
        const arr = limparVelhos(chatId, agora);
        let idEnviou = null;
        try { idEnviou = await identidadeFn(event.senderPhone, grp.unidade_id); } catch (e) { /* best-effort */ }
        const pendencia = {
          previewId, unidade_id: grp.unidade_id, nome: grp.nome, valor, forma,
          categoria: categoriaTexto, aluno: null, competencia: null, descricao,
          parcela: null, responsavelFinanceiro: null, cartaoModalidade: null,
          cartaoParcelas: null, formaIncerta: false, quitacao: null, multiplas: false,
          composto: null, itemLojinha: null, bloqueiaLancamento: false,
          faturaIndisponivel: false, bloqueiaFonteIndisponivel: false,
          enviadoPor: nomeParaCarimbo(idEnviou, event),
          idemKey: `${chatId}:${event.messageId}`, origem: event.messageId, ts: agora,
        };
        const v3 = await registrarPreviewPublicoV3({
          event, grupo: grp, previewId, texto: textoPreview, pendencia,
          result: { acao: 'saida_texto_preview_enviado', valor, forma, categoria: categoriaTexto },
        });
        if (v3 && v3.preview_id) {
          pendencia.v3PreviewId = v3.preview_id;
          pendencia.v3PreviewHash = v3.preview_hash || null;
        }
        arr.push(pendencia);
        pendentes.set(chatId, arr);
        log({ acao: 'saida_texto_preview_enviado', chatId, previewId, categoria: categoriaTexto, valor });
        return { acao: 'saida_texto_preview_enviado', previewId };
      }
    }

    // 0.6) correção/estorno de lançamento já gravado.
    // "Excluir" no caixa vira estorno auditado; alteração de valor/categoria/
    // descrição passa pela RPC de correção controlada. O alvo precisa vir de
    // mensagem citada, memória recente do lançamento ou busca que retorne item único.
    if (!event.hasMedia && !casarPode(event.body).pode) {
      const cmdMov = extrairComandoMovimento(event.body);
      const pendentesAtivos = limparVelhos(chatId, agora);
      const corrigePreviewAtivo = cmdMov && cmdMov.tipo === 'corrigir' && (
        pendentesAtivos.some((p) => p.previewId === event.quotedMessageId) ||
        (!event.quotedBody && pendentesAtivos.length === 1)
      );
      if (cmdMov && !corrigePreviewAtivo) {
        let alvo = alvoLancado(chatId, event.quotedMessageId, agora);
        const citado = event.quotedBody ? extrairLancamentoCitado(event.quotedBody) : null;
        if (!alvo && citado) {
          let rBusca = null;
          try {
            rBusca = await buscarMovimentosFn({
              unidade_id: grp.unidade_id,
              valor: citado.valor || null,
              categoria: citado.categoria || null,
              forma: citado.formaAtual || null,
              texto: null,
              chat_id: chatId,
              grupo_jid: chatId,
              ator_numero: senderNum,
              ator_papel: 'grupo',
              origem_message_id: event.messageId,
              quoted_message_id: event.quotedMessageId || null,
            });
          } catch (e) {
            log({ acao: 'erro_rpc_buscar_movimento_citado', erro: String(e && e.message) });
          }
          const items = rBusca && Array.isArray(rBusca.items) ? rBusca.items : [];
          if (items.length === 1) alvo = items[0];
          else if (items.length > 1) {
            await sendFn(chatId, 'Achei mais de um lançamento parecido. Responde citando a minha mensagem exata do lançamento ou informa o valor/aluno.');
            log({ acao: 'movimento_alvo_ambiguo', chatId, count: items.length });
            return { acao: 'movimento_alvo_ambiguo' };
          }
        }
        if (!alvo) {
          const valorBusca = cmdMov.correcoes && cmdMov.correcoes.valor ? cmdMov.correcoes.valor : extrairValor(event.body, { allowBare: true });
          let rBusca = null;
          try {
            rBusca = await buscarMovimentosFn({
              unidade_id: grp.unidade_id,
              valor: valorBusca || null,
              texto: valorBusca ? null : bodyLimpo(event.body).replace(/^sol\b\s*[,;:-]?\s*/i, '').slice(0, 80),
              chat_id: chatId,
              grupo_jid: chatId,
              ator_numero: senderNum,
              ator_papel: 'grupo',
              origem_message_id: event.messageId,
              quoted_message_id: event.quotedMessageId || null,
            });
          } catch (e) {
            log({ acao: 'erro_rpc_buscar_movimento', erro: String(e && e.message) });
          }
          const items = rBusca && Array.isArray(rBusca.items) ? rBusca.items : [];
          if (items.length === 1) alvo = items[0];
          else if (items.length > 1) {
            const linhas = items.slice(0, 5).map((x, i) => `${i + 1}. ${fmtBRL(x.valor)} · ${x.categoria || 'sem categoria'} · ${x.forma_pagamento || 'sem forma'} · ${x.responsavel || x.descricao || ''}`.trim()).join('\n');
            await sendFn(chatId, `Achei mais de um lançamento. Me diz qual é, ou responde citando a mensagem correta:\n${linhas}`);
            log({ acao: 'movimento_alvo_ambiguo', chatId, count: items.length });
            return { acao: 'movimento_alvo_ambiguo' };
          }
        }
        const movimentacaoId = alvo && (alvo.movimentacao_id || alvo.movimentacaoId);
        if (!movimentacaoId) {
          await sendFn(chatId, 'Consigo corrigir/estornar, mas preciso saber qual lançamento. Responde citando minha mensagem do lançamento.');
          log({ acao: 'movimento_sem_alvo', chatId, tipo: cmdMov.tipo });
          return { acao: 'movimento_sem_alvo' };
        }
        if (dryRun) {
          await sendFn(chatId, `🧪 (teste) Eu ${cmdMov.tipo === 'estornar' ? 'estornaria' : 'corrigiria'} o lançamento ${movimentacaoId}.`);
          return { acao: `dryrun_${cmdMov.tipo}_movimento` };
        }
        let idAut = null;
        try { idAut = await identidadeFn(event.senderPhone || event.senderId, grp.unidade_id); } catch (e) { /* best-effort */ }
        const autorizadoPor = nomeParaCarimbo(idAut, event);
        const payloadBase = {
          movimentacao_id: movimentacaoId,
          unidade_id: alvo.unidade_id || grp.unidade_id,
          valor: String(cmdMov.tipo === 'estornar' ? (alvo.valor || 0) : (cmdMov.correcoes && cmdMov.correcoes.valor ? cmdMov.correcoes.valor : (alvo.valor || 0))),
          forma: String((cmdMov.correcoes && (cmdMov.correcoes.forma_pagamento || cmdMov.correcoes.forma)) || alvo.forma_pagamento || alvo.forma || ''),
          categoria: String((cmdMov.correcoes && cmdMov.correcoes.categoria) || alvo.categoria || 'movimento'),
          ator_numero: senderNum,
          ator_papel: 'grupo',
          grupo_jid: chatId,
          chat_id: chatId,
          origem_message_id: event.messageId,
          preview_message_id: event.quotedMessageId || alvo.previewId || alvo.confirmMessageId || null,
          autorizado_por: autorizadoPor,
          motivo: cmdMov.motivo,
          idempotency_key: `${chatId}:${event.messageId}:${cmdMov.tipo}:${movimentacaoId}`,
        };
        if (v3LedgerAtivo) {
          const opLabel = cmdMov.tipo === 'estornar' ? 'estorno' : 'correção';
          const valorPreview = Number(payloadBase.valor || 0);
          const formaPreview = payloadBase.forma || 'sem forma';
          const categoriaPreview = payloadBase.categoria || 'movimento';
          let textoPreview = cmdMov.tipo === 'estornar'
            ? `Vou estornar este lançamento no caixa da ${grp.nome}: ${fmtBRL(valorPreview)} · ${categoriaPreview} · ${formaPreview}.\nNão vou apagar o original; vou criar um movimento inverso auditado.\n\n👉 Posso estornar agora? Responde *pode*.`
            : `Vou corrigir este lançamento no caixa da ${grp.nome}: ${fmtBRL(valorPreview)} · ${categoriaPreview} · ${formaPreview}.\n\n👉 Posso corrigir agora? Responde *pode*.`;
          const previewId = await sendFn(chatId, textoPreview);
          const pendenciaOperacao = {
            previewId,
            tipoOperacao: cmdMov.tipo === 'estornar' ? 'estornar_movimento' : 'corrigir_movimento',
            v3Operacao: cmdMov.tipo === 'estornar' ? 'estorno' : 'correcao_movimento',
            unidade_id: payloadBase.unidade_id,
            nome: grp.nome,
            valor: valorPreview,
            forma: payloadBase.forma,
            categoria: payloadBase.categoria,
            aluno: null,
            descricao: cmdMov.tipo === 'estornar' ? 'Estorno de movimento' : 'Correção de movimento',
            idemKey: payloadBase.idempotency_key,
            origem: event.messageId,
            payloadBase,
            correcoes: cmdMov.correcoes || null,
            movimentacao_id: movimentacaoId,
            ts: agora,
          };
          const v3 = await registrarPreviewPublicoV3({
            event, grupo: grp, previewId, texto: textoPreview, pendencia: pendenciaOperacao,
            result: { acao: 'movimento_operacao_preview_enviado', tipo: pendenciaOperacao.tipoOperacao, movimentacao_id: movimentacaoId },
          });
          if (v3 && v3.preview_id) {
            pendenciaOperacao.v3PreviewId = v3.preview_id;
            pendenciaOperacao.v3PreviewHash = v3.preview_hash || null;
          }
          const arr = limparVelhos(chatId, agora);
          arr.push(pendenciaOperacao);
          pendentes.set(chatId, arr);
          log({ acao: 'movimento_operacao_preview_enviado', tipo: pendenciaOperacao.tipoOperacao, movimentacao_id: movimentacaoId });
          return { acao: 'movimento_operacao_preview_enviado', tipo: pendenciaOperacao.tipoOperacao, movimentacao_id: movimentacaoId };
        }
        if (cmdMov.tipo === 'estornar') {
          let rEst;
          try { rEst = await estornarMovimentoFn(payloadBase); }
          catch (e) { await sendFn(chatId, '⚠️ Deu erro técnico ao estornar. Já registrei o problema.'); log({ acao: 'erro_rpc_estornar_movimento', erro: String(e && e.message) }); return { acao: 'erro_estornar_movimento' }; }
          if (rEst && rEst.ok) {
            await sendFn(chatId, `Estornei no caixa: ${fmtBRL(rEst.valor || alvo.valor)}. Não apaguei o original; criei o movimento inverso auditado.`);
            log({ acao: 'movimento_estornado', movimentacao_id: movimentacaoId, estorno_id: rEst.movimentacao_estorno_id });
            return { acao: 'movimento_estornado', movimentacao_id: movimentacaoId, movimentacao_estorno_id: rEst.movimentacao_estorno_id };
          }
          await sendFn(chatId, `⚠️ Não consegui estornar: ${rEst && rEst.motivo ? rEst.motivo : 'erro desconhecido'}.`);
          log({ acao: 'estorno_recusado', motivo: rEst && rEst.motivo });
          return { acao: 'estorno_recusado', motivo: rEst && rEst.motivo };
        }
        let rCorr;
        try { rCorr = await corrigirMovimentoFn({ ...payloadBase, correcoes: cmdMov.correcoes }); }
        catch (e) { await sendFn(chatId, '⚠️ Deu erro técnico ao corrigir. Já registrei o problema.'); log({ acao: 'erro_rpc_corrigir_movimento', erro: String(e && e.message) }); return { acao: 'erro_corrigir_movimento' }; }
        if (rCorr && rCorr.ok) {
          const depois = rCorr.depois || {};
          await sendFn(chatId, `Corrigi no caixa: ${fmtBRL(depois.valor || alvo.valor)} · ${depois.categoria || alvo.categoria || 'lançamento'} · ${depois.forma_pagamento || alvo.forma || alvo.forma_pagamento || ''}.`);
          log({ acao: 'movimento_corrigido', movimentacao_id: movimentacaoId });
          return { acao: 'movimento_corrigido', movimentacao_id: movimentacaoId };
        }
        await sendFn(chatId, `⚠️ Não consegui corrigir: ${rCorr && rCorr.motivo ? rCorr.motivo : 'erro desconhecido'}.`);
        log({ acao: 'movimento_correcao_recusada', motivo: rCorr && rCorr.motivo });
        return { acao: 'movimento_correcao_recusada', motivo: rCorr && rCorr.motivo };
      }
    }

    // 1) comprovante -> preview
    const det = detectarComprovante(event);
    if (event.hasMedia && det.ok) {
      const lote = await prepararLoteMidia(event, agora);
      if (lote.skip) return { acao: lote.acao };
      event = lote.event;
      const idemKey = `${chatId}:${event.messageId}`;
      if (vistos.has(idemKey)) return { acao: 'dup_ignorada' };
      vistos.add(idemKey);
      let valor = extrairValor(event.body);
      let forma = extrairForma(event.body, null);
      let cartaoModalidade = null, cartaoParcelas = null;
      const media = (event.mediaUrls || [])[0];
      // Camada 1: OCR LOCAL (igual Maria) -- roda sempre que ha midia (texto p/ valor E interpretacao)
      let ocrText = '';
      let ocrMeta = { status: 'nao_executado', duration_ms: 0, file_bytes: null };
      if (media) {
        try {
          log({ acao: 'ocr_attempt', chatId });
          const rawOcr = await ocrFn(media, { detailed: true });
          if (rawOcr && typeof rawOcr === 'object' && Object.prototype.hasOwnProperty.call(rawOcr, 'text')) {
            ocrText = String(rawOcr.text || '');
            ocrMeta = { ...ocrMeta, ...rawOcr };
          } else {
            ocrText = String(rawOcr || '');
            ocrMeta = { ...ocrMeta, status: ocrText.trim() ? 'ok' : 'texto_vazio' };
          }
        } catch (e) {
          ocrText = '';
          ocrMeta = { ...ocrMeta, status: 'ocr_exception', error_code: e && e.code || null, error_message: e && e.message || null };
        }
        log({
          acao: 'ocr_result', chatId, ocr_text_len: ocrText.length,
          ocr_status: ocrMeta.status, ocr_duration_ms: ocrMeta.duration_ms || null,
          ocr_file_bytes: ocrMeta.file_bytes || null, ocr_exit_code: ocrMeta.exit_code || null,
          ocr_signal: ocrMeta.signal || null, ocr_timed_out: Boolean(ocrMeta.timed_out),
        });
        if (!valor) { const vv = extrairValorOcr(ocrText); if (vv) valor = vv; }
        if (!forma) { const ff = extrairForma(ocrText, null); if (ff) forma = ff; }
        const cc = extrairCartao(ocrText);
        if (cc) { forma = 'cartao'; cartaoModalidade = cc.modalidade; cartaoParcelas = cc.parcelas; }
      }
      // Camada 2: visao OAuth e' fallback do OCR — inclusive quando ele falha.
      // O fluxo antigo recusava a midia antes de chegar aqui justamente no caso
      // de texto vazio/timeout, que e' quando a visao e' mais necessaria.
      let alunoVis = null;
      let visao = null;
      if (media && (!valor || ocrText.trim().length < 20)) {
        try {
          log({ acao: 'fallback_vision_attempt', chatId, motivo: ocrText.trim().length < 20 ? (ocrMeta.status || 'ocr_curto') : 'valor_ausente' });
          visao = await visaoFn(media);
          log({ acao: 'fallback_vision_result', ok: !!(visao && visao.valor), chatId });
          if (visao) { if (!valor && visao.valor) valor = visao.valor; if (!forma && visao.forma) forma = visao.forma; if (visao.aluno) alunoVis = visao.aluno; }
        } catch (e) {
          log({ acao: 'fallback_vision_error', chatId, error_code: e && e.code || null, error_message: e && e.message || null });
        }
      }
      // PORTA 2: print de tela / orçamento NÃO viram recebimento.
      let cls = classificarMidia(ocrText, event.body);
      // A visao so promove para comprovante quando trouxe dado financeiro;
      // print/orcamento sem esse sinal continua bloqueado.
      if (cls.tipo !== 'comprovante' && visao && (visao.valor || visao.aluno)) cls = { tipo: 'comprovante', motivo: 'vision_fallback' };
      if (cls.tipo !== 'comprovante') {
        log({ acao: 'midia_recusada', tipo: cls.tipo, motivo: cls.motivo, chatId });
        if (cls.tipo === 'despesa') {
          await sendFn(chatId, '📄 Isso parece um orçamento/compra (despesa), não um recebimento — não lancei nada no caixa.');
        } else if (cls.motivo === 'nao_consegui_ler') {
          await sendFn(chatId, '👀 Recebi, mas não consegui ler. Se for comprovante, manda com a legenda (ex.: *comprovante pix R$ 300 - Fulano*).');
        }
        return { acao: 'midia_recusada', tipo: cls.tipo, motivo: cls.motivo };
      }
      // Legenda EFETIVA: costura a legenda da propria midia com a mensagem IRMA (o nome do
      // aluno que veio em bolha separada ~0,1s). Igual a Maria: o texto adjacente NAO se perde.
      let legendaEfetiva = bodyLimpo(event.body);
      {
        const _kTextoIrmao = textoIrmaoKey(event);
        const _buf = textosRecentes.get(_kTextoIrmao);
        const _fresco = _buf && _buf.ts >= agora - 150000 && _buf.ts <= agora + 60000;
        const _temNome = _fresco && (_alunoRotulado(_buf.texto) || nomePlausivel(_alunoFromCaption(_buf.texto)));
        if (_temNome && bodyLimpo(_buf.texto) && bodyLimpo(_buf.texto) !== legendaEfetiva) {
          legendaEfetiva = (legendaEfetiva ? legendaEfetiva + ' \u00b7 ' : '') + bodyLimpo(_buf.texto);
          textosRecentes.delete(_kTextoIrmao);
          log({ acao: 'legenda_irma_anexada', chatId });
        }
      }
      const somaLegenda = extrairSomaAditivaPagamento(legendaEfetiva);
      if (somaLegenda) {
        valor = somaLegenda.total;
        log({ acao: 'valor_soma_legenda', chatId, total: valor, partes: somaLegenda.partes.length });
      }
      // Camada 3: INTERPRETACAO FLUIDA (categoria/aluno/competencia via LLM texto; humano confirma)
      let categoria = null, aluno = null, competencia = null;
      try {
        log({ acao: 'interpretar_attempt', chatId });
        const it = await interpretarFn((legendaEfetiva + '\n' + ocrText).trim());
        log({ acao: 'interpretar_result', categoria: it && it.categoria });
        if (it) { categoria = it.categoria; aluno = it.aluno; competencia = it.competencia; if (!forma && it.forma) forma = it.forma; }
      } catch (e) { /* best-effort */ }
      const textoClassificacao = legendaEfetiva + '\n' + ocrText;
      const categoriaLegenda = _categoriaFromCaption(textoClassificacao);
      const categoriaExplicita = _categoriaExplicitaFromCaption(textoClassificacao);
      const lojinhaInfo = categoriaLegenda === 'passaporte' ? null : detectarLojinhaProduto(textoClassificacao);
      if (categoriaExplicita === 'parcela') categoria = 'parcela';
      else if (categoriaExplicita === 'seguranca') categoria = 'seguranca';
      else if (categoriaLegenda === 'passaporte') categoria = 'passaporte';
      else if (lojinhaInfo) categoria = 'lojinha';
      categoria = categoria || categoriaLegenda;
      const competenciaHumana = extrairCompetenciaTexto(legendaEfetiva);
      competencia = competencia || competenciaHumana;
      if (!nomePlausivel(aluno)) aluno = null;              // "image received" nao e' aluno
      aluno = _alunoRotulado(legendaEfetiva) || aluno || _alunoFromCaption(legendaEfetiva) || alunoVis;
      if (!nomePlausivel(aluno)) aluno = null;
      let alunoViaPagador = null, pagadorNome = (visao && visao.pagador_nome) || null, candidatosAluno = null;
      // sem sinal de forma: NAO chuta pix -- pergunta no preview.
      const formaIncerta = !forma;
      // Camada 4: casa com a parcela REAL do aluno (read-only) -- enriquece o preview
      let parcela = null, confiancaBaixa = false;
      const multiplas = pagamentoMultiplo(bodyLimpo(event.body) + ' ' + ocrText);
      const querParcela = !lojinhaInfo && !multiplas && (!categoria || categoria === 'parcela' || categoria === 'mensalidade' || categoria === 'passaporte' || categoria === 'matricula' || categoria === 'outro');
      const categoriaExplicitaTaxa = categoria === 'passaporte' || categoria === 'matricula' || categoriaLegenda === 'passaporte';
      const podeFallbackLegadoParcela = querParcela && !categoriaExplicitaTaxa;
      // FONTE CANONICA primeiro (contrato v4): tipo/parcela N-de-M/status/valores certos.
      let canonica = null;
      // aplica o resultado do casador (nome canonico do banco + parcela real)
      const aplicarCasamento = (m) => {
        if (!m || !m.ok) return false;
        if (m.aluno_nome) aluno = m.aluno_nome;
        if (m.ambiguo) confiancaBaixa = true;
        if (m.parcela && querParcela) {
          parcela = m.parcela;
          if (m.parcela.competencia) competencia = m.parcela.competencia;
          if (categoria === 'outro') categoria = 'parcela';   // 'outro' era chute sem contexto
        }
        return true;
      };
      let alunoConfirmado = !!(lojinhaInfo && aluno);
      let canonicaIndisponivel = false;
      let bloqueiaFonteIndisponivel = false;
      // Timeout/erro de transporte resolve null (ou erro PostgREST sem campo `ok`);
      // "nao achei" de verdade responde {ok:false, motivo}. Indisponivel => retry 1x;
      // se seguir mudo, NUNCA cair na fonte legada (contrato v4: canonica e A fonte —
      // em 18/08 um statement timeout fez o fallback chutar a parcela errada no preview).
      const tentarCanonica = async (nome) => {
        try {
          let c = await canonicaFn(grp.unidade_id, nome, valor);
          let respondeu = !!(c && (c.ok === true || c.ok === false));
          if (c && c.ok === false && _fonteCanonicaIndisponivel(c)) { respondeu = false; bloqueiaFonteIndisponivel = true; }
          if (!respondeu) {
            log({ acao: 'canonica_retry', chatId });
            c = await canonicaFn(grp.unidade_id, nome, valor);
            respondeu = !!(c && (c.ok === true || c.ok === false));
            if (c && c.ok === false && _fonteCanonicaIndisponivel(c)) { respondeu = false; bloqueiaFonteIndisponivel = true; }
          }
          canonicaIndisponivel = !respondeu;
          log({ acao: 'canonica_result', ok: !!(c && c.ok), motivo: c && (c.motivo_escolha || c.motivo), indisponivel: canonicaIndisponivel || undefined });
          if (c && c.ok) { canonica = c; if (c.aluno_nome) aluno = c.aluno_nome; return true; }
        } catch (e) { canonicaIndisponivel = true; bloqueiaFonteIndisponivel = true; }
        return false;
      };
      if (aluno && (querParcela || multiplas)) alunoConfirmado = await tentarCanonica(aluno);
      if (!alunoConfirmado && aluno && !canonicaIndisponivel && podeFallbackLegadoParcela) {
        try {
          log({ acao: 'casar_attempt', chatId });
          const m = await casarFn(grp.unidade_id, aluno, valor, competencia);
          log({ acao: 'casar_result', ok: !!(m && m.parcela), conf: m && m.confianca_nome });
          alunoConfirmado = aplicarCasamento(m);
        } catch (e) { /* best-effort */ }
      }
      // Camada 4.5: quem paga quase nunca e' o aluno. Se o BANCO nao confirmou o nome
      // (ou nao veio nome nenhum), identifica pelo PAGADOR do comprovante e recasa.
      if (!alunoConfirmado) {
        pagadorNome = pagadorNome || extrairPagador(ocrText);
        if (pagadorNome) {
          try {
            // A fatura canônica recebe nome + valor e resolve quando o pagador
            // é a própria aluna ou quando o nome abrevia um sobrenome. Só cai
            // na relação familiar se essa confirmação não for possível.
            if (querParcela || multiplas) {
              alunoConfirmado = await tentarCanonica(pagadorNome);
              if (alunoConfirmado) alunoViaPagador = 'comprovante';
            }
            if (alunoConfirmado) {
              log({ acao: 'pagador_canonica_confirmado', chatId });
            } else {
            const idp = await pagadorFn(grp.unidade_id, pagadorNome);
            log({ acao: 'pagador_result', ok: !!(idp && idp.ok), via: idp && idp.via, total: idp && idp.total });
            if (idp && idp.ok && Array.isArray(idp.alunos) && idp.alunos.length) {
              if (idp.ambiguo) {
                candidatosAluno = idp.alunos.map((x) => x.aluno_nome).slice(0, 4);
                aluno = null;
              } else {
                aluno = idp.alunos[0].aluno_nome;
                alunoViaPagador = idp.via;
                const okCan = await tentarCanonica(aluno);
                alunoConfirmado = okCan;
                if (!okCan && !canonicaIndisponivel && podeFallbackLegadoParcela) {
                  try {
                    const m2 = await casarFn(grp.unidade_id, aluno, valor, competencia);
                    log({ acao: 'casar_result_2', ok: !!(m2 && m2.parcela) });
                    aplicarCasamento(m2);
                  } catch (e) { /* best-effort */ }
                }
              }
            } else if (!aluno) {
              log({ acao: 'pagador_sem_match', chatId });
            }
            }
          } catch (e) { /* best-effort */ }
        }
        if (!alunoConfirmado && aluno && !alunoViaPagador) {
          // nome veio da legenda/LLM mas o banco nao confirmou: nao afirmar como certo
          confiancaBaixa = true;
        }
      }
      // Aluno com dois cursos/parcelas no mesmo mes (caso Pedro 18/08):
      // se a legenda diz 08/2026 e o comprovante e a soma de Canto+Guitarra,
      // o preview precisa mostrar o composto em vez de puxar uma fatura isolada.
      let composto = null;
      const competenciaComposto = competenciaHumana || competencia;
      if (aluno && valor && competenciaComposto && querParcela && !multiplas) {
        try {
          const compMes = await faturasMesFn(grp.unidade_id, aluno, competenciaComposto, valor);
          if (compMes && compMes.ok && Array.isArray(compMes.partes) && compMes.partes.length >= 2) {
            composto = compMes;
            if (compMes.aluno_nome) aluno = compMes.aluno_nome;
            if (compMes.competencia) competencia = compMes.competencia;
            categoria = 'parcela';
            parcela = null;
            canonica = null;
            confiancaBaixa = false;
            bloqueiaFonteIndisponivel = false;
            log({ acao: 'composto_mes_result', ok: true, partes: compMes.partes.length, competencia: compMes.competencia });
          }
        } catch (e) { /* best-effort */ }
      }

      // Responsável financeiro do aluno (quem paga) — pedido do Alf/Fernanda.
      let responsavelFinanceiro = null;
      if (aluno) {
        try {
          const rr = await responsavelFn(grp.unidade_id, aluno);
          if (rr && rr.responsavel_nome && !mesmaPessoa(rr.responsavel_nome, aluno)) responsavelFinanceiro = rr.responsavel_nome;
          log({ acao: 'responsavel_result', ok: !!responsavelFinanceiro });
        } catch (e) { /* best-effort */ }
      }
      // categoria/descricao: a fatura canonica manda (contrato v4); LLM so entra como fallback
      const catCanonica = categoriaDaFatura(canonica);
      if (catCanonica) categoria = catCanonica;
      // duplicidade no CAIXA do dia (o Emusys estar pago e' normal; o caixa e' que nao pode repetir)
      let duplicata = null;
      if (valor) {
        try {
          const d = await duplicataFn(grp.unidade_id, valor, aluno);
          if (d && d.ja_lancado && Array.isArray(d.itens) && d.itens.length) duplicata = d.itens[0];
          log({ acao: 'duplicata_caixa', ja_lancado: !!duplicata });
        } catch (e) { /* best-effort */ }
      }
      // quitação: quantas parcelas e QUAIS meses (pedido da gerente da Barra)
      let quitacao = null;
      if (multiplas) {
        const vparc = canonica && canonica.fatura && Number(canonica.fatura.valor_da_parcela);
        let n = (valor && vparc) ? Math.round(Number(valor) / vparc) : null;
        if (!n || n < 2) n = (cartaoParcelas && cartaoParcelas > 1) ? cartaoParcelas : null;
        const informado = extrairPeriodoMeses(bodyLimpo(event.body));
        const proposto = periodoQuitacao(canonica, n);
        quitacao = { n, vparc: vparc || null,
          inicio: (informado && informado.inicio) || (proposto && proposto.inicio) || null,
          fim: (informado && informado.fim) || (proposto && proposto.fim) || null,
          proposto: !informado && !!proposto };
      }
      const bloqueiaLancamento = !composto && parcela && parcela.multiplas_no_mes && parcela.valor_bate === false;
      const saidaCaixa = categoriaEhSaida(categoria);
      const descricaoSaida = saidaCaixa
        ? (bodyLimpo(legendaEfetiva)
          .replace(/r\$\s*[\d.,]+/ig, ' ')
          .replace(/\b(pagamento|pg|semanal|semana|comprovante|recibo|dinheiro|pix|cart[ãa]o|transfer[êe]ncia)\b/ig, ' ')
          .replace(/[^\p{L}\d\s./-]/gu, ' ')
          .replace(/\s+/g, ' ')
          .trim())
        : null;
      const descricao = composto
        ? (descricaoDoComposto(composto, aluno) || _descricaoLancamento(categoria, competencia, aluno, parcela))
        : lojinhaInfo
        ? `Lojinha/Venda - ${lojinhaInfo.item || 'Produto'}${aluno ? ' - ' + aluno : ''}`
        : saidaCaixa
        ? (descricaoSaida && descricaoSaida.length >= 3 ? `PG Semana ${cap(categoria)}${descricaoSaida.toLowerCase().includes(String(categoria).toLowerCase()) ? '' : ' - ' + descricaoSaida}` : `PG Semana ${cap(categoria)}`)
        : multiplas
        ? ('Quitacao' + (quitacao && quitacao.n ? ' ' + quitacao.n + 'x' : ' de parcelas')
           + (quitacao && quitacao.inicio ? ` (${quitacao.inicio} a ${quitacao.fim})` : '')
           + (aluno ? ' - ' + aluno : ''))
        : (descricaoDaFatura(canonica, aluno) || _descricaoLancamento(categoria, competencia, aluno, parcela));
      let texto = montarPreview({ unidadeNome: grp.nome, valor, forma, categoria, aluno, competencia, parcela, confiancaBaixa, responsavelFinanceiro, formaIncerta, cartaoModalidade, cartaoParcelas, multiplas, alunoViaPagador, pagadorNome, candidatosAluno, canonica, duplicata, quitacao, faturaIndisponivel: canonicaIndisponivel, composto, bloqueiaLancamento, itemLojinha: lojinhaInfo && lojinhaInfo.item });
      if (dryRun) texto += '\n\n_(modo teste — nada será gravado no caixa)_';
      const previewId = await sendFn(chatId, texto);
      const arr = limparVelhos(chatId, agora);
      let idEnviou = null;
      try { idEnviou = await identidadeFn(event.senderPhone, grp.unidade_id); } catch (e) { /* best-effort */ }
      log({ acao: 'identidade_envio', identificado: !!(idEnviou && idEnviou.identificado) });
      const pendencia = { previewId, unidade_id: grp.unidade_id, nome: grp.nome, valor, forma, categoria, aluno, competencia, descricao, parcela, responsavelFinanceiro, cartaoModalidade, cartaoParcelas, formaIncerta, quitacao, multiplas, composto, itemLojinha: lojinhaInfo && lojinhaInfo.item, bloqueiaLancamento, faturaIndisponivel: canonicaIndisponivel, bloqueiaFonteIndisponivel, enviadoPor: nomeParaCarimbo(idEnviou, event), idemKey, origem: event.messageId, ts: agora };
      const v3 = await registrarPreviewPublicoV3({
        event, grupo: grp, previewId, texto, pendencia,
        result: { acao: 'preview_enviado', valor, forma, categoria, aluno, competencia },
      });
      if (v3 && v3.preview_id) {
        pendencia.v3PreviewId = v3.preview_id;
        pendencia.v3PreviewHash = v3.preview_hash || null;
      }
      arr.push(pendencia);
      pendentes.set(chatId, arr);
      log({ acao: 'preview_enviado', chatId, previewId, valor: valor || null });
      return { acao: 'preview_enviado', previewId };
    }

    // 1.5) resposta curta que COMPLETA o que ela pediu (valor e/ou forma).
    // Nao lanca: so preenche a lacuna e repergunta -- o gate do "pode" continua valendo.
    {
      const arrP = limparVelhos(chatId, agora);
      const txt = String(event.body || '').trim();

      // 1.5a) CORRECAO DE FORMA: "Sol, foi pix" / "nao e cartao, e pix".
      // Antes do lançamento, remonta o preview. Depois do lançamento, muda só a
      // forma de pagamento via RPC auditada e referencia o lançamento recente.
      if (!event.hasMedia && txt && !casarPode(txt).pode) {
        const corrForma = extrairCorrecaoForma(txt);
        if (corrForma) {
          if (!corrForma.forma) {
            await sendFn(chatId, 'Me diz a forma certa pra eu corrigir: *pix*, *dinheiro*, *cartão débito* ou *cartão crédito*.');
            log({ acao: 'correcao_forma_sem_destino', chatId });
            return { acao: 'correcao_forma_sem_destino' };
          }
          const candidatos = arrP.filter((p) => p.valor);
          let alvoP = null;
          if (event.quotedMessageId) alvoP = candidatos.find((p) => p.previewId === event.quotedMessageId) || null;
          if (!alvoP && candidatos.length === 1) alvoP = candidatos[0];
          if (alvoP && !alvoP.forma) {
            // "foi no cartao/pix" ainda pode ser só complemento de preview
            // incompleto; deixa a rotina 1.5b preencher e perguntar o "pode".
          } else {
          if (alvoP) {
            alvoP.forma = corrForma.forma;
            alvoP.formaIncerta = false;
            alvoP.cartaoModalidade = corrForma.cartaoModalidade || null;
            alvoP.cartaoParcelas = corrForma.cartaoParcelas || null;
            alvoP.ts = agora;
            let texto = `Você tem razão: a forma é ${corrForma.forma === 'cartao' ? 'cartão' : corrForma.forma}. Remontei o preview:\n\n` + montarPreview({
              unidadeNome: alvoP.nome, valor: alvoP.valor, forma: alvoP.forma,
              categoria: alvoP.categoria || 'parcela', aluno: alvoP.aluno, competencia: alvoP.competencia,
              parcela: alvoP.parcela, confiancaBaixa: false,
              responsavelFinanceiro: alvoP.responsavelFinanceiro, formaIncerta: false,
              cartaoModalidade: alvoP.cartaoModalidade, cartaoParcelas: alvoP.cartaoParcelas,
              multiplas: alvoP.multiplas, alunoViaPagador: null, pagadorNome: null, candidatosAluno: null,
              canonica: null, duplicata: null, quitacao: alvoP.quitacao || null,
              faturaIndisponivel: false, composto: alvoP.composto || null,
              bloqueiaLancamento: alvoP.bloqueiaLancamento, itemLojinha: alvoP.itemLojinha,
            });
            if (dryRun) texto += '\n\n_(modo teste — nada será gravado no caixa)_';
            alvoP.previewId = await sendFn(chatId, texto);
            log({ acao: 'preview_forma_corrigida', chatId, forma: alvoP.forma });
            return { acao: 'preview_forma_corrigida', forma: alvoP.forma };
          }
          let alvoL = alvoLancado(chatId, event.quotedMessageId, agora);
          if (!alvoL && event.quotedBody) {
            const citado = extrairLancamentoCitado(event.quotedBody);
            if (citado && citado.valor) {
              let achado = null;
              try {
                achado = await buscarCorrecaoFn({
                  unidade_id: grp.unidade_id,
                  valor: citado.valor,
                  categoria: citado.categoria,
                  forma_atual: citado.formaAtual,
                  chat_id: chatId,
                  quoted_message_id: event.quotedMessageId || null,
                });
              } catch (e) {
                log({ acao: 'erro_rpc_buscar_correcao_forma', erro: String(e && e.message) });
              }
              if (achado && achado.ok && achado.movimentacao_id) {
                alvoL = {
                  confirmMessageId: event.quotedMessageId || null,
                  previewId: null,
                  movimentacao_id: achado.movimentacao_id,
                  unidade_id: achado.unidade_id || grp.unidade_id,
                  nome: grp.nome,
                  valor: Number(achado.valor || citado.valor),
                  forma: achado.forma || citado.formaAtual,
                  categoria: achado.categoria || citado.categoria,
                  cartaoModalidade: achado.cartao_modalidade || citado.cartaoModalidade || null,
                };
                log({ acao: 'correcao_forma_alvo_por_citado', chatId, movimentacao_id: alvoL.movimentacao_id });
              } else if (achado && achado.motivo) {
                log({ acao: 'correcao_forma_citado_sem_match', chatId, motivo: achado.motivo });
              }
            }
          }
          if (!alvoL) {
            await sendFn(chatId, 'Consigo corrigir, mas preciso saber qual lançamento. Responde citando minha mensagem do lançamento e manda: *Sol, foi pix*.');
            log({ acao: 'correcao_forma_sem_alvo', chatId });
            return { acao: 'correcao_forma_sem_alvo' };
          }
          if (dryRun) {
            await sendFn(chatId, `🧪 (teste) Eu corrigiria ${fmtBRL(alvoL.valor)} de ${alvoL.forma} para ${corrForma.forma}.`);
            return { acao: 'dryrun_corrigir_forma' };
          }
          let idAut = null;
          try { idAut = await identidadeFn(event.senderPhone || event.senderId, alvoL.unidade_id); } catch (e) { /* best-effort */ }
          const autorizadoPor = nomeParaCarimbo(idAut, event);
          const payloadCorr = {
            movimentacao_id: alvoL.movimentacao_id, unidade_id: alvoL.unidade_id,
            valor: String(alvoL.valor || 0),
            categoria: String(alvoL.categoria || 'movimento'),
            forma: corrForma.forma, cartao_modalidade: corrForma.cartaoModalidade, cartao_parcelas: corrForma.cartaoParcelas,
            ator_numero: senderNum, ator_papel: 'grupo', chat_id: chatId, grupo_jid: chatId,
            origem_message_id: event.messageId, preview_message_id: alvoL.previewId || alvoL.confirmMessageId || null,
            autorizado_por: autorizadoPor,
            motivo: 'correcao de forma solicitada no grupo',
            idempotency_key: `${chatId}:${event.messageId}:corrigir_forma:${alvoL.movimentacao_id}`,
          };
          if (v3LedgerAtivo) {
            const textoPreview = `Vou corrigir a forma deste lançamento no caixa da ${grp.nome}: ${fmtBRL(alvoL.valor)} de ${alvoL.forma || 'forma atual'} para ${corrForma.forma === 'cartao' ? 'cartão' : corrForma.forma}.\n\n👉 Posso corrigir agora? Responde *pode*.`;
            const previewId = await sendFn(chatId, textoPreview);
            const pendenciaOperacao = {
              previewId,
              tipoOperacao: 'corrigir_movimento',
              v3Operacao: 'correcao_movimento',
              unidade_id: payloadCorr.unidade_id,
              nome: grp.nome,
              valor: Number(payloadCorr.valor || 0),
              forma: payloadCorr.forma,
              categoria: payloadCorr.categoria,
              aluno: null,
              descricao: 'Correção de forma',
              idemKey: payloadCorr.idempotency_key,
              origem: event.messageId,
              payloadBase: payloadCorr,
              correcoes: {
                forma_pagamento: corrForma.forma,
                cartao_modalidade: corrForma.cartaoModalidade || null,
                cartao_parcelas: corrForma.cartaoParcelas || null,
              },
              movimentacao_id: alvoL.movimentacao_id,
              ts: agora,
            };
            const v3 = await registrarPreviewPublicoV3({
              event, grupo: grp, previewId, texto: textoPreview, pendencia: pendenciaOperacao,
              result: { acao: 'correcao_forma_preview_enviado', movimentacao_id: alvoL.movimentacao_id, forma: corrForma.forma },
            });
            if (v3 && v3.preview_id) {
              pendenciaOperacao.v3PreviewId = v3.preview_id;
              pendenciaOperacao.v3PreviewHash = v3.preview_hash || null;
            }
            const arr = limparVelhos(chatId, agora);
            arr.push(pendenciaOperacao);
            pendentes.set(chatId, arr);
            log({ acao: 'correcao_forma_preview_enviado', movimentacao_id: alvoL.movimentacao_id, forma: corrForma.forma });
            return { acao: 'correcao_forma_preview_enviado', movimentacao_id: alvoL.movimentacao_id, forma: corrForma.forma };
          }
          let rCorr;
          try { rCorr = await corrigirFormaFn(payloadCorr); }
          catch (e) { await sendFn(chatId, '⚠️ Deu erro técnico ao corrigir a forma. Já registrei o problema.'); log({ acao: 'erro_rpc_corrigir_forma', erro: String(e && e.message) }); return { acao: 'erro_corrigir_forma' }; }
          if (rCorr && rCorr.ok) {
            alvoL.forma = rCorr.forma || corrForma.forma;
            alvoL.cartaoModalidade = rCorr.cartao_modalidade || null;
            await sendFn(chatId, `Corrigi no caixa: ${fmtBRL(rCorr.valor)} agora está como *${rCorr.forma === 'cartao' ? 'cartão' : rCorr.forma}*.`);
            log({ acao: 'forma_corrigida', movimentacao_id: alvoL.movimentacao_id, forma: alvoL.forma });
            return { acao: 'forma_corrigida', movimentacao_id: alvoL.movimentacao_id, forma: alvoL.forma };
          }
          await sendFn(chatId, `⚠️ Não consegui corrigir: ${rCorr && rCorr.motivo ? rCorr.motivo : 'erro desconhecido'}.`);
          log({ acao: 'forma_correcao_recusada', motivo: rCorr && rCorr.motivo });
          return { acao: 'forma_correcao_recusada', motivo: rCorr && rCorr.motivo };
          }
        }
      }

      // 1.5b) CORRECAO TARDIA: preview saiu sem aluno, ou com aluno claramente
      // contaminado por legenda ("restante do passaporte da aluna X"), e o humano
      // respondeu depois "Aluno: X" / "A aluna e X". Ainda exige "pode" para lancar.
      if (!event.hasMedia && txt && !casarPode(txt).pode) {
        const nomeTardio = _alunoRotulado(txt);
        const semAluno = arrP.filter((x) => (!x.aluno || _alunoSuspeito(x.aluno)) && (event.quotedMessageId || (agora - x.ts) <= 5 * 60 * 1000));
        let alvoP = null;
        if (event.quotedMessageId) alvoP = semAluno.find((p) => p.previewId === event.quotedMessageId) || null;
        if (!alvoP && semAluno.length === 1) alvoP = semAluno[0];
        if (nomeTardio && alvoP) {
          let alunoConfirmado = false;
          let confiancaBaixa = false;
          let canonica = null;
          let composto = null;
          let canonicaIndisponivel = false;
          let bloqueiaFonteIndisponivel = false;
          let categoria = alvoP.categoria;
          let competencia = alvoP.competencia;
          let parcela = alvoP.parcela;
          const querParcela = !alvoP.multiplas && (!categoria || categoria === 'parcela' || categoria === 'mensalidade' || categoria === 'passaporte' || categoria === 'matricula' || categoria === 'outro');

          try {
            let c = await canonicaFn(alvoP.unidade_id, nomeTardio, alvoP.valor);
            let respondeu = !!(c && (c.ok === true || c.ok === false));
            if (c && c.ok === false && _fonteCanonicaIndisponivel(c)) { respondeu = false; bloqueiaFonteIndisponivel = true; }
            if (!respondeu) {
              log({ acao: 'canonica_retry_tardia', chatId });
              c = await canonicaFn(alvoP.unidade_id, nomeTardio, alvoP.valor);
              respondeu = !!(c && (c.ok === true || c.ok === false));
              if (c && c.ok === false && _fonteCanonicaIndisponivel(c)) { respondeu = false; bloqueiaFonteIndisponivel = true; }
            }
            canonicaIndisponivel = !respondeu;
            if (c && c.ok) {
              canonica = c;
              alvoP.aluno = c.aluno_nome || nomeTardio;
              alunoConfirmado = true;
              if (c.parcela && querParcela) {
                parcela = c.parcela;
                if (c.parcela.competencia) competencia = c.parcela.competencia;
              }
              const catCanonica = categoriaDaFatura(c);
              if (catCanonica) categoria = catCanonica;
            }
          } catch (e) { canonicaIndisponivel = true; bloqueiaFonteIndisponivel = true; }

          if (!alunoConfirmado && !canonicaIndisponivel) {
            try {
              const m = await casarFn(alvoP.unidade_id, nomeTardio, alvoP.valor, competencia);
              if (m && m.ok) {
                alvoP.aluno = m.aluno_nome || nomeTardio;
                if (m.ambiguo) confiancaBaixa = true;
                if (m.parcela && querParcela) {
                  parcela = m.parcela;
                  if (m.parcela.competencia) competencia = m.parcela.competencia;
                  if (categoria === 'outro') categoria = 'parcela';
                }
                alunoConfirmado = true;
              }
            } catch (e) { /* best-effort */ }
          }

          if (!alunoConfirmado) {
            alvoP.aluno = nomeTardio;
            confiancaBaixa = true;
          }

          if (alvoP.aluno && alvoP.valor && competencia && querParcela) {
            try {
              const compMes = await faturasMesFn(alvoP.unidade_id, alvoP.aluno, competencia, alvoP.valor);
              if (compMes && compMes.ok && Array.isArray(compMes.partes) && compMes.partes.length >= 2) {
                composto = compMes;
                if (compMes.aluno_nome) alvoP.aluno = compMes.aluno_nome;
                categoria = 'parcela';
                parcela = null;
                canonica = null;
                confiancaBaixa = false;
                bloqueiaFonteIndisponivel = false;
                log({ acao: 'composto_mes_tardia', chatId, partes: compMes.partes.length, competencia: compMes.competencia });
              }
            } catch (e) { /* best-effort */ }
          }

          let responsavelFinanceiro = alvoP.responsavelFinanceiro || null;
          try {
            const rr = await responsavelFn(alvoP.unidade_id, alvoP.aluno);
            if (rr && rr.responsavel_nome && !mesmaPessoa(rr.responsavel_nome, alvoP.aluno)) responsavelFinanceiro = rr.responsavel_nome;
          } catch (e) { /* best-effort */ }

          alvoP.categoria = categoria;
          alvoP.competencia = competencia;
          alvoP.parcela = parcela;
          alvoP.composto = composto || alvoP.composto || null;
          alvoP.bloqueiaLancamento = !alvoP.composto && parcela && parcela.multiplas_no_mes && parcela.valor_bate === false;
          alvoP.faturaIndisponivel = canonicaIndisponivel;
          alvoP.bloqueiaFonteIndisponivel = bloqueiaFonteIndisponivel;
          alvoP.responsavelFinanceiro = responsavelFinanceiro;
          alvoP.descricao = descricaoDoComposto(alvoP.composto, alvoP.aluno) || descricaoDaFatura(canonica, alvoP.aluno) || _descricaoLancamento(categoria, competencia, alvoP.aluno, parcela);
          alvoP.ts = agora;

          let texto = 'Atualizei a pendencia com o aluno informado:\n\n' + montarPreview({
            unidadeNome: alvoP.nome, valor: alvoP.valor, forma: alvoP.forma,
            categoria: alvoP.categoria, aluno: alvoP.aluno, competencia: alvoP.competencia,
            parcela: alvoP.parcela, confiancaBaixa, responsavelFinanceiro: alvoP.responsavelFinanceiro,
            formaIncerta: alvoP.formaIncerta, cartaoModalidade: alvoP.cartaoModalidade,
            cartaoParcelas: alvoP.cartaoParcelas, multiplas: alvoP.multiplas,
            alunoViaPagador: null, pagadorNome: null, candidatosAluno: null,
            canonica, duplicata: null, quitacao: alvoP.quitacao, faturaIndisponivel: canonicaIndisponivel,
            composto: alvoP.composto, bloqueiaLancamento: alvoP.bloqueiaLancamento,
          });
          if (dryRun) texto += '\n\n_(modo teste — nada será gravado no caixa)_';
          alvoP.previewId = await sendFn(chatId, texto);
          log({ acao: 'preview_aluno_corrigido', chatId, aluno: alvoP.aluno });
          return { acao: 'preview_aluno_corrigido', aluno: alvoP.aluno };
        }
      }

      const faltando = arrP.filter((x) => !x.valor || !x.forma);
      const curta = txt.split(/\s+/).filter(Boolean).length <= 8;
      if (!event.hasMedia && faltando.length === 1 && curta && !casarPode(txt).pode) {
        const alvoP = faltando[0];
        const vNovo = alvoP.valor ? null : extrairValor(txt, { allowBare: true });
        const fNovo = alvoP.forma ? null : extrairForma(txt, null);
        const cNovo = fNovo === 'cartao' ? extrairCartao(txt) : null;
        if (vNovo || fNovo) {
          if (vNovo) alvoP.valor = vNovo;
          if (fNovo) {
            alvoP.forma = fNovo;
            alvoP.formaIncerta = false;
            if (cNovo) {
              alvoP.cartaoModalidade = cNovo.modalidade || alvoP.cartaoModalidade || null;
              alvoP.cartaoParcelas = cNovo.parcelas || alvoP.cartaoParcelas || null;
            }
          }
          alvoP.ts = agora;
          const falta = !alvoP.valor ? 'valor' : (!alvoP.forma ? 'forma' : null);
          const quem = nomeDoAtor(event);
          if (falta === 'valor') {
            await sendFn(chatId, `Anotei a forma (${alvoP.forma}). Só falta o valor: manda *pode, R$ X*.`);
          } else if (falta === 'forma') {
            await sendFn(chatId, `Anotei ${fmtBRL(alvoP.valor)}. Só me diz a forma: *pode, pix* / *pode, dinheiro* / *pode, cartão*.`);
          } else {
            const formaTxt = alvoP.forma === 'cartao'
              ? `cartão${alvoP.cartaoModalidade ? ' ' + (alvoP.cartaoModalidade === 'credito' ? 'crédito' : 'débito') : ''}${alvoP.cartaoParcelas > 1 ? ' ' + alvoP.cartaoParcelas + 'x' : ''}`
              : alvoP.forma;
            await sendFn(chatId, `Beleza, ${quem}: *${fmtBRL(alvoP.valor)}* em ${formaTxt}. Posso lançar? Responde *pode*.`);
          }
          log({ acao: 'preview_completado', valor: alvoP.valor || null, forma: alvoP.forma || null });
          return { acao: 'preview_completado', valor: alvoP.valor || null, forma: alvoP.forma || null };
        }
      }

      // 1.5b) DIVISAO TARDIA: humano explicou que um comprovante total cobre mais de
      // uma parte/curso. Guarda a divisao e bloqueia o lancamento unico; melhor perguntar
      // do que lançar R$829 como uma parcela so.
      if (!event.hasMedia && txt && !casarPode(txt).pode) {
        const adicional = extrairAdicionalPagamento(txt);
        const comValor = arrP.filter((x) => x.valor && !x.divisao);
        let alvoP = null;
        if (event.quotedMessageId) alvoP = comValor.find((p) => p.previewId === event.quotedMessageId) || null;
        if (!alvoP && comValor.length === 1) alvoP = comValor[0];
        if (!alvoP && /categor(?:ia)?\s+(?:e|é|eh)\s+(?:parcela|passaporte|lojinha|matr[íi]cula)|n[aã]o\s+(?:e|é|eh)\s+(?:parcela|passaporte|lojinha)/i.test(txt)) {
          await sendFn(chatId, 'Recebi a correção, mas não achei um preview ativo para remontar. Reenvia o comprovante/legenda que eu refaço antes de lançar.');
          log({ acao: 'correcao_categoria_sem_alvo', chatId });
          return { acao: 'correcao_categoria_sem_alvo' };
        }
        if (alvoP && /categor(?:ia)?\s+(?:e|é|eh)\s+passaporte|(?:nao|não)\s+(?:e|é|eh)\s+lojinha.*passaporte|passaporte/i.test(txt) && !adicional) {
          alvoP.categoria = 'passaporte';
          alvoP.itemLojinha = null;
          alvoP.composto = null;
          alvoP.divisao = null;
          alvoP.bloqueiaLancamento = false;
          alvoP.bloqueiaFonteIndisponivel = false;
          alvoP.faturaIndisponivel = false;
          alvoP.descricao = _descricaoLancamento('passaporte', alvoP.competencia, alvoP.aluno, alvoP.parcela);
          alvoP.ts = agora;
          let texto = 'Ajustei: a categoria é passaporte. Remontei o preview:\n\n' + montarPreview({
            unidadeNome: alvoP.nome, valor: alvoP.valor, forma: alvoP.forma,
            categoria: 'passaporte', aluno: alvoP.aluno, competencia: alvoP.competencia,
            parcela: alvoP.parcela, confiancaBaixa: false,
            responsavelFinanceiro: alvoP.responsavelFinanceiro, formaIncerta: alvoP.formaIncerta,
            cartaoModalidade: alvoP.cartaoModalidade, cartaoParcelas: alvoP.cartaoParcelas,
            multiplas: false, alunoViaPagador: null, pagadorNome: null, candidatosAluno: null,
            canonica: null, duplicata: null, quitacao: null, faturaIndisponivel: false,
            composto: null, bloqueiaLancamento: false, itemLojinha: null,
          });
          if (dryRun) texto += '\n\n_(modo teste — nada será gravado no caixa)_';
          alvoP.previewId = await sendFn(chatId, texto);
          log({ acao: 'preview_categoria_passaporte_corrigida', chatId });
          return { acao: 'preview_categoria_passaporte_corrigida' };
        }
        if (alvoP && !/n[aã]o\s+(?:e|é|eh)\s+parcela/i.test(txt) && /categor(?:ia)?\s+(?:e|é|eh)\s+parcela|(?:nao|não)\s+(?:e|é|eh)\s+lojinha.*parcela|(?:e|é|eh)\s+mensalidade|\bparcela\b/i.test(txt) && !adicional) {
          let canonica = null;
          let parcela = null;
          let competencia = alvoP.competencia || extrairCompetenciaTexto(txt);
          let confiancaBaixa = false;
          let faturaIndisponivel = false;
          const confirmacaoManual = _confirmacaoManualFatura(txt);
          if (confirmacaoManual) {
            alvoP.aluno = confirmacaoManual.aluno;
            competencia = confirmacaoManual.competencia || competencia;
            parcela = {
              descricao: `Parcela ${competencia || ''}${confirmacaoManual.curso ? ' do curso de ' + confirmacaoManual.curso : ''}`.trim(),
              competencia,
              valor: alvoP.valor,
              valor_bate: true,
              confirmada_pela_equipe: true,
            };
          }
          if (alvoP.aluno) {
            try {
              const c = await canonicaFn(alvoP.unidade_id, alvoP.aluno, alvoP.valor);
              if (c && c.ok) {
                canonica = c;
                if (c.aluno_nome) alvoP.aluno = c.aluno_nome;
                if (c.parcela) {
                  parcela = c.parcela;
                  if (c.parcela.competencia) competencia = c.parcela.competencia;
                }
              } else if (_fonteCanonicaIndisponivel(c)) {
                faturaIndisponivel = true;
              }
            } catch (e) { faturaIndisponivel = true; }
            if (!parcela && !faturaIndisponivel) {
              try {
                const m = await casarFn(alvoP.unidade_id, alvoP.aluno, alvoP.valor, competencia);
                if (m && m.ok) {
                  if (m.aluno_nome) alvoP.aluno = m.aluno_nome;
                  if (m.ambiguo) confiancaBaixa = true;
                  if (m.parcela) {
                    parcela = m.parcela;
                    if (m.parcela.competencia) competencia = m.parcela.competencia;
                  }
                }
              } catch (e) { /* best-effort */ }
            }
          }
          alvoP.categoria = 'parcela';
          alvoP.itemLojinha = null;
          alvoP.parcela = parcela;
          alvoP.composto = null;
          alvoP.divisao = null;
          alvoP.competencia = competencia;
          alvoP.bloqueiaLancamento = !alvoP.composto && parcela && parcela.multiplas_no_mes && parcela.valor_bate === false;
          alvoP.confirmacaoManualFonte = !!(confirmacaoManual && faturaIndisponivel);
          alvoP.bloqueiaFonteIndisponivel = faturaIndisponivel && !alvoP.confirmacaoManualFonte;
          alvoP.faturaIndisponivel = faturaIndisponivel && !alvoP.confirmacaoManualFonte;
          alvoP.descricao = descricaoDaFatura(canonica, alvoP.aluno) || _descricaoLancamento('parcela', competencia, alvoP.aluno, parcela);
          alvoP.ts = agora;
          const abertura = confirmacaoManual
            ? 'Entendi a confirmação da equipe. Remontei o preview com aluno, curso/parcela e competência informados:\n\n'
            : 'Ajustei: a categoria é parcela. Remontei o preview:\n\n';
          let texto = abertura + montarPreview({
            unidadeNome: alvoP.nome, valor: alvoP.valor, forma: alvoP.forma,
            categoria: 'parcela', aluno: alvoP.aluno, competencia,
            parcela, confiancaBaixa,
            responsavelFinanceiro: alvoP.responsavelFinanceiro, formaIncerta: alvoP.formaIncerta,
            cartaoModalidade: alvoP.cartaoModalidade, cartaoParcelas: alvoP.cartaoParcelas,
            multiplas: false, alunoViaPagador: null, pagadorNome: null, candidatosAluno: null,
            canonica, duplicata: null, quitacao: null, faturaIndisponivel: alvoP.faturaIndisponivel,
            composto: null, bloqueiaLancamento: alvoP.bloqueiaLancamento, itemLojinha: null,
          });
          if (dryRun) texto += '\n\n_(modo teste — nada será gravado no caixa)_';
          alvoP.previewId = await sendFn(chatId, texto);
          log({ acao: 'preview_categoria_parcela_corrigida', chatId });
          return { acao: 'preview_categoria_parcela_corrigida' };
        }
        const lojinhaCorrecao = detectarLojinhaProduto(txt);
        if (alvoP && lojinhaCorrecao && /n[aã]o\s+(?:e|é)\s+parcela|(?:e|é)\s+venda|lojinha|produto|corda|palheta|baqueta/i.test(txt)) {
          alvoP.categoria = 'lojinha';
          alvoP.itemLojinha = lojinhaCorrecao.item;
          alvoP.parcela = null;
          alvoP.composto = null;
          alvoP.divisao = null;
          alvoP.bloqueiaLancamento = false;
          alvoP.bloqueiaFonteIndisponivel = false;
          alvoP.faturaIndisponivel = false;
          alvoP.descricao = `Lojinha/Venda - ${lojinhaCorrecao.item || 'Produto'}${alvoP.aluno ? ' - ' + alvoP.aluno : ''}`;
          alvoP.ts = agora;
          let texto = 'Você tem razão: isso é venda de lojinha, não parcela. Remontei o preview:\n\n' + montarPreview({
            unidadeNome: alvoP.nome, valor: alvoP.valor, forma: alvoP.forma,
            categoria: 'lojinha', aluno: alvoP.aluno, competencia: null,
            parcela: null, confiancaBaixa: false,
            responsavelFinanceiro: alvoP.responsavelFinanceiro, formaIncerta: alvoP.formaIncerta,
            cartaoModalidade: alvoP.cartaoModalidade, cartaoParcelas: alvoP.cartaoParcelas,
            multiplas: false, alunoViaPagador: null, pagadorNome: null, candidatosAluno: null,
            canonica: null, duplicata: null, quitacao: null, faturaIndisponivel: false,
            composto: null, bloqueiaLancamento: false, itemLojinha: alvoP.itemLojinha,
          });
          if (dryRun) texto += '\n\n_(modo teste — nada será gravado no caixa)_';
          alvoP.previewId = await sendFn(chatId, texto);
          log({ acao: 'preview_lojinha_corrigido', chatId, item: alvoP.itemLojinha });
          return { acao: 'preview_lojinha_corrigido', item: alvoP.itemLojinha };
        }
        if (alvoP && adicional && alvoP.aluno) {
          const valorOriginal = Number(alvoP.valor || 0);
          const valorNovo = Number((valorOriginal + Number(adicional.valor || 0)).toFixed(2));
          const competencia = alvoP.competencia || extrairCompetenciaTexto(txt);
          try {
            const compMes = await faturasMesFn(alvoP.unidade_id, alvoP.aluno, competencia, valorNovo);
            if (compMes && compMes.ok && Array.isArray(compMes.partes) && compMes.partes.length >= 2) {
              alvoP.valor = valorNovo;
              alvoP.composto = compMes;
              if (compMes.aluno_nome) alvoP.aluno = compMes.aluno_nome;
              if (compMes.competencia) alvoP.competencia = compMes.competencia;
              alvoP.categoria = 'parcela';
              alvoP.parcela = null;
              alvoP.divisao = null;
              alvoP.bloqueiaLancamento = false;
              alvoP.bloqueiaFonteIndisponivel = false;
              alvoP.faturaIndisponivel = false;
              alvoP.descricao = descricaoDoComposto(alvoP.composto, alvoP.aluno) || alvoP.descricao;
              alvoP.ts = agora;
              let texto = `Você tem razão: faltava ${adicional.label} de ${fmtBRL(adicional.valor)}. Remontei pelo previsto do aluno:\n\n` + montarPreview({
                unidadeNome: alvoP.nome, valor: alvoP.valor, forma: alvoP.forma,
                categoria: alvoP.categoria || 'parcela', aluno: alvoP.aluno,
                competencia: alvoP.competencia, parcela: null, confiancaBaixa: false,
                responsavelFinanceiro: alvoP.responsavelFinanceiro, formaIncerta: alvoP.formaIncerta,
                cartaoModalidade: alvoP.cartaoModalidade, cartaoParcelas: alvoP.cartaoParcelas,
                multiplas: false, alunoViaPagador: null, pagadorNome: null, candidatosAluno: null,
                canonica: null, duplicata: null, quitacao: null, faturaIndisponivel: false,
                composto: alvoP.composto, bloqueiaLancamento: false,
              });
              if (dryRun) texto += '\n\n_(modo teste — nada será gravado no caixa)_';
              alvoP.previewId = await sendFn(chatId, texto);
              log({ acao: 'preview_adicional_corrigido', chatId, adicional: adicional.valor, total: valorNovo });
              return { acao: 'preview_adicional_corrigido', adicional: adicional.valor, total: valorNovo };
            }
          } catch (e) { /* best-effort */ }
        }
        if (alvoP) {
          const partes = extrairDivisaoPagamento(txt, alvoP.valor);
          if (partes && partes.length >= 2) {
            alvoP.composto = { ok: true, aluno_nome: alvoP.aluno || null, competencia: alvoP.competencia || extrairCompetenciaTexto(txt), partes };
            alvoP.divisao = null;
            alvoP.bloqueiaLancamento = false;
            alvoP.descricao = descricaoDoComposto(alvoP.composto, alvoP.aluno) || alvoP.descricao;
            alvoP.ts = agora;
            let texto = 'Entendi que esse comprovante cobre mais de um curso/parcela:\n\n' + montarPreview({
              unidadeNome: alvoP.nome, valor: alvoP.valor, forma: alvoP.forma,
              categoria: alvoP.categoria || 'parcela', aluno: alvoP.aluno,
              competencia: alvoP.competencia, parcela: null, confiancaBaixa: false,
              responsavelFinanceiro: alvoP.responsavelFinanceiro, formaIncerta: alvoP.formaIncerta,
              cartaoModalidade: alvoP.cartaoModalidade, cartaoParcelas: alvoP.cartaoParcelas,
              multiplas: false, alunoViaPagador: null, pagadorNome: null, candidatosAluno: null,
              canonica: null, duplicata: null, quitacao: null, faturaIndisponivel: false,
              composto: alvoP.composto, bloqueiaLancamento: false,
            });
            if (dryRun) texto += '\n\n_(modo teste — nada será gravado no caixa)_';
            alvoP.previewId = await sendFn(chatId, texto);
            log({ acao: 'preview_composto_pendente', chatId, partes: partes.length, total: alvoP.valor });
            return { acao: 'preview_composto_pendente', partes: partes.length };
          }
        }
      }
    }

    // 2) "pode" -> lança (só confirmação limpa, ou resposta citando o preview)
    const arrPend = limparVelhos(chatId, agora);
    const respondeuPreview = !!(event.quotedMessageId && arrPend.some((p) => p.previewId === event.quotedMessageId));
    const conf = casarPode(event.body, { respondeuPreview });
      if (conf.pode) {
      const arr = arrPend;
      if (arr.length === 0) return { acao: 'pode_sem_pendencia' };
      let alvo = null;
      if (event.quotedMessageId) alvo = arr.find((p) => p.previewId === event.quotedMessageId) || null;
      if (!alvo) {
        if (arr.length === 1) alvo = arr[0];
        else { await sendFn(chatId, 'Tem mais de um comprovante aguardando — responde *pode* no comprovante certo, por favor.'); return { acao: 'ambiguo' }; }
      }
      if (alvo.tipoOperacao === 'estornar_movimento' || alvo.tipoOperacao === 'corrigir_movimento') {
        if (dryRun) {
          pendentes.set(chatId, arr.filter((p) => p !== alvo));
          await sendFn(chatId, `🧪 (teste) Eu ${alvo.tipoOperacao === 'estornar_movimento' ? 'estornaria' : 'corrigiria'} o lançamento ${alvo.movimentacao_id}.`);
          return { acao: `dryrun_${alvo.tipoOperacao}` };
        }
        let v3Approval = null;
        try {
          v3Approval = await registrarApprovalPublicoV3({ event, alvo, decision: 'approved' });
        } catch (e) {
          await sendFn(chatId, '⚠️ Não executei: não consegui registrar a aprovação V3. Tenta de novo em instantes.');
          log({ acao: 'v3_approval_bloqueou_operacao_movimento', erro: String(e && e.message) });
          return { acao: 'v3_approval_bloqueou_operacao_movimento' };
        }
        if (v3LedgerAtivo) {
          if (!alvo.v3PreviewId || !alvo.v3PreviewHash || !v3Approval || !v3Approval.approval_id) {
            await sendFn(chatId, '⚠️ Não executei: faltou vínculo V3 entre preview e aprovação. Reenvia o comando para gerar um preview novo.');
            log({ acao: 'v3_approval_bloqueou_operacao_movimento', erro: 'vinculo_v3_incompleto' });
            return { acao: 'v3_approval_bloqueou_operacao_movimento' };
          }
        }
        const payloadOperacao = {
          ...(alvo.payloadBase || {}),
          valor: String(alvo.valor || 0),
          forma: alvo.forma || '',
          categoria: alvo.categoria || 'movimento',
          v3_preview_id: alvo.v3PreviewId,
          v3_preview_hash: alvo.v3PreviewHash,
          v3_approval_id: v3Approval && v3Approval.approval_id,
          v3_approval_event_hash: v3Approval && v3Approval.approval_event_hash,
          v3_actor_id_hash: v3Approval && v3Approval.actor_id_hash,
          v3_ledger_required: '1',
        };
        let rOp;
        if (alvo.tipoOperacao === 'estornar_movimento') {
          try { rOp = await estornarMovimentoFn(payloadOperacao); }
          catch (e) { await sendFn(chatId, '⚠️ Deu erro técnico ao estornar. Já registrei o problema.'); log({ acao: 'erro_rpc_estornar_movimento', erro: String(e && e.message) }); return { acao: 'erro_estornar_movimento' }; }
          pendentes.set(chatId, arr.filter((p) => p !== alvo));
          if (rOp && rOp.ok) {
            await sendFn(chatId, `Estornei no caixa: ${fmtBRL(rOp.valor || alvo.valor)}. Não apaguei o original; criei o movimento inverso auditado.`);
            log({ acao: 'movimento_estornado', movimentacao_id: alvo.movimentacao_id, estorno_id: rOp.movimentacao_estorno_id });
            return { acao: 'movimento_estornado', movimentacao_id: alvo.movimentacao_id, movimentacao_estorno_id: rOp.movimentacao_estorno_id };
          }
          await sendFn(chatId, `⚠️ Não consegui estornar: ${rOp && rOp.motivo ? rOp.motivo : 'erro desconhecido'}.`);
          return { acao: 'estorno_recusado', motivo: rOp && rOp.motivo };
        }
        try { rOp = await corrigirMovimentoFn({ ...payloadOperacao, correcoes: alvo.correcoes || {} }); }
        catch (e) { await sendFn(chatId, '⚠️ Deu erro técnico ao corrigir. Já registrei o problema.'); log({ acao: 'erro_rpc_corrigir_movimento', erro: String(e && e.message) }); return { acao: 'erro_corrigir_movimento' }; }
        pendentes.set(chatId, arr.filter((p) => p !== alvo));
        if (rOp && rOp.ok) {
          const depois = rOp.depois || {};
          await sendFn(chatId, `Corrigi no caixa: ${fmtBRL(depois.valor || alvo.valor)} · ${depois.categoria || alvo.categoria || 'lançamento'} · ${depois.forma_pagamento || alvo.forma || ''}.`);
          log({ acao: 'movimento_corrigido', movimentacao_id: alvo.movimentacao_id });
          return { acao: 'movimento_corrigido', movimentacao_id: alvo.movimentacao_id };
        }
        await sendFn(chatId, `⚠️ Não consegui corrigir: ${rOp && rOp.motivo ? rOp.motivo : 'erro desconhecido'}.`);
        return { acao: 'movimento_correcao_recusada', motivo: rOp && rOp.motivo };
      }
      if (alvo.divisao && alvo.divisao.length >= 2) {
        const linhas = alvo.divisao.map((p) => `• ${p.label}: ${fmtBRL(p.valor)}`).join('\n');
        await sendFn(chatId, `⚠️ Não lancei: esse comprovante está marcado como pagamento dividido.\n${linhas}\n\nConfirma/manda cada parte separada para eu lançar sem misturar.`);
        log({ acao: 'bloqueado_divisao_pendente', chatId, partes: alvo.divisao.length });
        return { acao: 'bloqueado_divisao_pendente' };
      }
      if (alvo.bloqueiaLancamento) {
        await sendFn(chatId, '⚠️ Não lancei: o valor diverge e o aluno tem mais de uma parcela/curso possível. Me explica a divisão ou responde no preview certo.');
        log({ acao: 'bloqueado_multiplas_sem_divisao', chatId });
        return { acao: 'bloqueado_multiplas_sem_divisao' };
      }
      if (alvo.bloqueiaFonteIndisponivel && !alvo.confirmacaoManualFonte) {
        await sendFn(chatId, '⚠️ Não lancei: não consegui confirmar a fatura na fonte oficial. Confirma aluno, competência e curso/parcela antes do *pode*.');
        log({ acao: 'bloqueado_fonte_indisponivel', chatId });
        return { acao: 'bloqueado_fonte_indisponivel' };
      }
      const valor = conf.valor || alvo.valor;
      const forma = conf.forma || alvo.forma;
      const cartaoModalidade = conf.cartaoModalidade || alvo.cartaoModalidade || null;
      const cartaoParcelas = conf.cartaoParcelas || alvo.cartaoParcelas || null;
      if (!forma) {
        await sendFn(chatId, 'Falta a forma pra eu lançar certo. Responde: *pode, pix* / *pode, dinheiro* / *pode, cartão*.');
        return { acao: 'sem_forma' };
      }
      if (!valor) { await sendFn(chatId, 'Preciso do valor pra lançar. Manda *pode, R$ X*.'); return { acao: 'sem_valor' }; }
      if (dryRun) {
        pendentes.set(chatId, arr.filter((p) => p !== alvo));
        await sendFn(chatId, `🧪 (teste) Eu lançaria na ${alvo.nome}: ${cap(alvo.categoria || 'parcela')} — ${fmtBRL(valor)} (${forma}). Nada foi gravado.`);
        log({ acao: 'dryrun', valor });
        return { acao: 'dryrun' };
      }
      let idAut = null;
      try { idAut = await identidadeFn(event.senderPhone, alvo.unidade_id); } catch (e) { /* best-effort */ }
      log({ acao: 'identidade_autorizacao', identificado: !!(idAut && idAut.identificado) });
      const autorizadoPor = nomeParaCarimbo(idAut, event);
      const payload = {
        unidade_id: alvo.unidade_id, valor: String(valor), forma, categoria: alvo.categoria || 'parcela',
        aluno: alvo.aluno || null, descricao: alvo.descricao || null, idempotency_key: alvo.idemKey, ator_numero: senderNum, ator_papel: 'grupo',
        chat_id: chatId, grupo_jid: chatId, origem_message_id: alvo.origem, preview_message_id: alvo.previewId,
        cartao_modalidade: cartaoModalidade, cartao_parcelas: cartaoParcelas,
        enviado_por: alvo.enviadoPor || null, autorizado_por: autorizadoPor,
        responsavel_financeiro: alvo.responsavelFinanceiro || null,
      };
      let v3Approval = null;
      try {
        v3Approval = await registrarApprovalPublicoV3({ event, alvo, decision: 'approved' });
      } catch (e) {
        await sendFn(chatId, '⚠️ Não lancei: não consegui registrar a aprovação do preview. Tenta de novo em instantes.');
        log({ acao: 'v3_approval_bloqueou_lancamento', erro: String(e && e.message) });
        return { acao: 'v3_approval_bloqueou_lancamento' };
      }
      if (v3LedgerAtivo) {
        if (!alvo.v3PreviewId || !alvo.v3PreviewHash || !v3Approval || !v3Approval.approval_id) {
          await sendFn(chatId, '⚠️ Não lancei: faltou vínculo V3 entre preview e aprovação. Reenvia o comprovante para gerar um preview novo.');
          log({ acao: 'v3_approval_bloqueou_lancamento', erro: 'vinculo_v3_incompleto' });
          return { acao: 'v3_approval_bloqueou_lancamento' };
        }
        payload.v3_preview_id = alvo.v3PreviewId;
        payload.v3_preview_hash = alvo.v3PreviewHash;
        payload.v3_approval_id = v3Approval.approval_id;
        payload.v3_approval_event_hash = v3Approval.approval_event_hash;
        payload.v3_actor_id_hash = v3Approval.actor_id_hash;
        payload.v3_ledger_required = '1';
      }
      let r;
      const ehSaida = categoriaEhSaida(payload.categoria);
      try { r = await (ehSaida ? lancarSaidaFn(payload) : lancarFn(payload)); }
      catch (e) { await sendFn(chatId, '⚠️ Deu erro técnico ao lançar. Já registrei o problema; tenta de novo em instantes.'); log({ acao: 'erro_rpc', erro: String(e && e.message) }); return { acao: 'erro' }; }
      // remove a pendência alvo
      pendentes.set(chatId, arr.filter((p) => p !== alvo));
      if (r && r.ok && r.ja_lancado) { await sendFn(chatId, 'Esse comprovante já tinha sido lançado ✅.'); return { acao: 'ja_lancado' }; }
      if (r && r.ok) {
        const quem = (alvo.enviadoPor && alvo.enviadoPor !== autorizadoPor)
          ? `${autorizadoPor} autorizou · ${alvo.enviadoPor} enviou`
          : `${autorizadoPor} autorizou`;
        const verbo = ehSaida ? 'Lancei a saída' : 'Lancei';
        const confirmMessageId = await sendFn(chatId, `✅ ${verbo} no caixa da ${alvo.nome}: ${cap(payload.categoria)} — ${fmtBRL(r.valor)} (${r.forma}).\n_${quem} · registrei isso no responsável do lançamento._`);
        lembrarLancado(chatId, {
          confirmMessageId, previewId: alvo.previewId, movimentacao_id: r.movimentacao_id,
          unidade_id: alvo.unidade_id, nome: alvo.nome, valor: Number(r.valor || valor),
          forma: r.forma || forma, categoria: payload.categoria,
          cartaoModalidade, cartaoParcelas,
        });
        log({ acao: ehSaida ? 'saida_lancada' : 'lancado', movimentacao_id: r.movimentacao_id, valor: r.valor });
        return { acao: ehSaida ? 'saida_lancada' : 'lancado', movimentacao_id: r.movimentacao_id };
      }
      const motivos = {
        caixa_nao_aberto: 'o caixa de hoje ainda não está aberto',
        valor_invalido: 'o valor não ficou válido',
        forma_invalida: 'a forma de pagamento não é válida',
        saida_cofre_so_dinheiro: 'saída de cofre precisa ser em dinheiro',
        ator_sem_numero: 'não consegui identificar seu número',
      };
      const msg = motivos[r && r.motivo] || 'não consegui lançar agora';
      // devolve a pendência (pode reabrir caixa e tentar de novo)
      if (r && r.motivo === 'caixa_nao_aberto') { arr.push(alvo); pendentes.set(chatId, arr); }
      await sendFn(chatId, `⚠️ Não lancei: ${msg}.`);
      log({ acao: 'recusado', motivo: r && r.motivo });
      return { acao: 'recusado', motivo: r && r.motivo };
    }
    // Mensagem humana "solta" (nao era pergunta de caixa, nem "pode", nem completou preview):
    // pode ser o NOME DO ALUNO que acompanha um comprovante que chega em bolha separada.
    // Guarda pra proxima midia costurar (igual a Maria). Consumida no uso; janela curta.
    if (!event.hasMedia) {
      const _solto = bodyLimpo(event.body);
      if (_pareceTesteLancarApagar(_solto)) {
        await sendFn(chatId, 'Melhor não testar com lançamento real e apagar depois. Teste seguro é preview/consulta; se algo já foi lançado manualmente, deixa como está e me chama antes de mexer.');
        log({ acao: 'bloqueou_teste_lancar_apagar', chatId });
        return { acao: 'bloqueou_teste_lancar_apagar' };
      }
      if (_solto && /[A-Za-z\u00c0-\u00ff]{3}/.test(_solto) && _solto.length <= 200) {
        if (anexarTextoAoLote(event, _solto, agora)) return { acao: 'lote_texto_anexado' };
        textosRecentes.set(textoIrmaoKey(event), { texto: _solto, ts: agora });
      }
    }
    return { acao: 'nada' };
  }

  // ha comprovante aguardando "pode" nesse grupo? (o fluxo de abrir/fechar consulta isso
  // pra nao roubar a confirmacao do comprovante)
  function temPendencia(chatId, agora = Date.now()) {
    return limparVelhos(chatId, agora).length > 0;
  }

  return { handle, temPendencia, _pendentes: pendentes };
}

function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

module.exports = {
  parseBRMoney, extrairValor, extrairForma, detectarComprovante, casarPode,
  montarPreview, fmtBRL, carregarEnv, lancarRecebimento, lancarSaidaCaixa, corrigirFormaRecebimento, buscarLancamentoParaCorrecao,
  buscarMovimentosCaixa, corrigirMovimentoCaixa, estornarMovimentoCaixa, registrarPreviewV3, registrarApprovalV3, criarHandlerFinanceiro,
  confirmacaoLimpa, classificarMidia, bodyLimpo, nomeDoAtor, buscarResponsavel, mesmaPessoa, pagamentoMultiplo,
  extrairDivisaoPagamento, extrairSomaAditivaPagamento, extrairAdicionalPagamento, detectarLojinhaProduto,
  identificarPessoa, nomeParaCarimbo, ehPerguntaDeCaixa, resumoDoDia, montarResumoCaixa,
  extrairCartao, extrairValorOcr, extrairPagador, identificarPorPagador, nomePlausivel, _alunoRotulado, _alunoFromCaption, _alunoSuspeito,
  _cursoRotulado, _confirmacaoManualFatura,
  casarParcelaCanonica, linhasDaFatura, categoriaDaFatura, descricaoDaFatura, jaLancadoHoje,
  periodoQuitacao, extrairPeriodoMeses,
  extrairCompetenciaTexto, compostoDeFaturas, buscarCompostoFaturasMes, descricaoDoComposto,
  extrairComprovanteVisao, interpretarComprovante, casarParcela,
  ocrLocal,
  extrairCorrecaoForma, extrairLancamentoCitado, extrairComandoMovimento,
  categoriaEhSaida,
};
