'use strict';
/*
 * Sol Caixa Fatia 2 — abertura/fechamento de caixa por preview.
 * Reproduz o TEXTO do fechamento diário byte-a-byte igual ao LA Report
 * (padrão existente — não pode mudar). Geradores + RPCs + roteamento.
 */
const fs = require('fs');
const https = require('https');

const ENV_CANDIDATES = ['/opt/LA-Organizer/.env', '/home/sol/.openclaw/gateway.systemd.env'];
function _env() {
  const out = {};
  for (const p of ENV_CANDIDATES) {
    let t; try { t = fs.readFileSync(p, 'utf8'); } catch (e) { continue; }
    for (const raw of t.split('\n')) {
      const l = raw.trim();
      if (!l || l.startsWith('#') || !l.includes('=')) continue;
      const i = l.indexOf('=');
      out[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return out;
}
function chamarRpc(nome, args) {
  return new Promise((resolve, reject) => {
    const e = _env();
    const url = (e.LA_REPORT_SUPABASE_URL || e.SUPABASE_URL || 'https://ouqwbbermlzqqvtqwlul.supabase.co').replace(/\/+$/, '');
    const key = e.LA_REPORT_SERVICE_ROLE_KEY || e.SUPABASE_SERVICE_ROLE_KEY || e.SUPABASE_SERVICE_KEY;
    if (!key) return reject(new Error('missing supabase key'));
    const body = JSON.stringify(args || {});
    const u = new URL(`${url}/rest/v1/rpc/${nome}`);
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => { try { resolve(d ? JSON.parse(d) : null); } catch (err) { reject(new Error('resp invalida ' + res.statusCode)); } }); });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout rpc ' + nome)));
    req.write(body); req.end();
  });
}

// afirmativo p/ abrir/fechar (evita "pode ser" = talvez).
// Fix 17/08/2026: "Vou ver isso, Fefe" / "Isso mesmo, Rose" NAO abrem nem fecham caixa.
// So conta se a mensagem INTEIRA e a confirmacao, ou se ela CITA o preview.
const { confirmacaoLimpa } = require('./caixa-financeiro.cjs');
const TOK_ABF_FORTE = '(pode|pode\\s+sim|pode\\s+abrir|pode\\s+fechar|abre|abrir|fecha|fechar|confirmo|confirmado|autorizo|autorizado)';
const TOK_ABF_REPLY = '(pode|pode\\s+sim|pode\\s+abrir|pode\\s+fechar|abre|abrir|fecha|fechar|confirmo|confirmado|autorizo|autorizado|sim|ok|blz|beleza|isso|isso\\s+mesmo|manda)';
function afirmativo(text, { respondeuPreview = false } = {}) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/\bpode\s+ser\b/i.test(t)) return false;
  return confirmacaoLimpa(t, respondeuPreview ? TOK_ABF_REPLY : TOK_ABF_FORTE);
}

function negativoFechamento(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return /^(?:n[aã]o|nao|não)$/i.test(t)
    || /\b(?:n[aã]o|nao)\s+(?:fecha|feche|fechar|dispara|manda|faz|confirma)\b/i.test(t)
    || /\b(?:n[aã]o|nao)\s+(?:e|é|eh)\s+p(?:ra|ara)\s+fechar\b/i.test(t)
    || /\b(?:ainda\s+)?(?:n[aã]o|nao)\s+(?:fecha|feche|fechar)\s+o\s+caixa\b/i.test(t);
}

// R$ no formato BR (milhar '.', decimal ','), sem depender de ICU/locale.
function brl(v) {
  const parts = Number(v || 0).toFixed(2).split('.');
  const intG = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return 'R$ ' + intG + ',' + parts[1];
}
function _cap(s) {
  s = String(s || '');
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function hojeBrtIso() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date());
}

function pedidoDiretoFechar(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/\bpode\s+ser\b/i.test(t)) return false;
  return /\b(?:sol[,!\s]*)?(?:pode\s+)?fechar\s+o\s+caixa\b/i.test(t)
    || /\b(?:fecha|feche)\s+o\s+caixa\b/i.test(t)
    || /\b(?:sol[,!\s]*)?(?:vamos|vamo|bora)\s+fechar\s+o\s+caixa\b/i.test(t);
}

// Espelha o *FECHAMENTO DE CAIXA* do LA Report.
// d = { unidadeNome, data (DD/MM/YYYY), saldoInicial, cofreEntradas[], cofreSaidas[],
//       vendasPorForma{dinheiro,pix,cartao,cheque,transferencia}, detalhes[], saldoFinal, conferidoPor }
function montarTextoFechamento(d) {
  const U = String(d.unidadeNome || '').toUpperCase();
  const vf = d.vendasPorForma || {};
  const L = [];
  L.push(`*FECHAMENTO DE CAIXA DE ${U}*`);
  L.push(`📆 ${d.data}`);
  L.push('');
  L.push(`💰 *Caixa Cofre Dinheiro - ${U}*`);
  L.push('');
  L.push(`Saldo inicial: *${brl(d.saldoInicial)}*`);
  L.push('');
  L.push('🟢 *Entrada do dia:*');
  if (d.cofreEntradas && d.cofreEntradas.length) {
    d.cofreEntradas.forEach((e) => L.push(`- ${brl(e.valor)} - ${e.descricao || ''}`));
  } else { L.push('- R$ 0,00 -'); }
  L.push('');
  L.push('🔴 *Saida do dia:*');
  if (d.cofreSaidas && d.cofreSaidas.length) {
    d.cofreSaidas.forEach((e) => L.push(`- ${brl(e.valor)} - ${e.descricao || ''}`));
  } else { L.push('- R$ 0,00 -'); }
  L.push('');
  L.push('🧾 *Vendas / Caixa Diario:*');
  L.push(`- Dinheiro: ${brl(vf.dinheiro || 0)}`);
  L.push(`- Pix: ${brl(vf.pix || 0)}`);
  L.push(`- Cartao: ${brl(vf.cartao || 0)}`);
  L.push(`- Cheque: ${brl(vf.cheque || 0)}`);
  L.push(`- Transferencia: ${brl(vf.transferencia || 0)}`);
  L.push('');
  L.push('📋 *Detalhes dos recebimentos:*');
  (d.detalhes || []).forEach((x) => {
    let ln = `- ${_cap(x.forma)} - ${brl(x.valor)} - `;
    if (x.cartaoInfo) ln += `${x.cartaoInfo} - `;
    ln += (x.descricao || '');
    L.push(ln);
  });
  L.push('');
  L.push(`✅ *Saldo final caixa dia ${d.data}:* ${brl(d.saldoFinal)}`);
  L.push('');
  L.push(`Conferido por: *${d.conferidoPor || ''}*`);
  L.push('_Gerado pelo LA Report_');
  return L.join('\n');
}

// Abertura (novo; espelha o estilo). d = { unidadeNome, data, saldoInicial }
function montarTextoAbertura(d) {
  const U = String(d.unidadeNome || '').toUpperCase();
  return [
    `🔓 *ABERTURA DE CAIXA DE ${U}*`,
    `📆 ${d.data}`,
    '',
    `💰 *Caixa Cofre Dinheiro - ${U}*`,
    `Saldo inicial: *${brl(d.saldoInicial)}* _(carry-over do fechamento anterior)_`,
    '',
    'Posso abrir? Responde *pode* que eu abro. ✅',
  ].join('\n');
}

// BRIDGE: se há abertura/fechamento aguardando e a msg é afirmativa, executa.
// Retorna true = tratou (não passa pro fluxo de comprovante); false = não é isso.
// "pode" TARDIO (preview velho) pede reconfirmacao antes de abrir/fechar caixa.
const JANELA_CONFIRMA_MIN = 120;
const _reconfirmando = new Set();   // chatId:pendenciaId ja avisados

async function tratarConfirmacao(event, { sendFn, log = () => {}, rpcFn = chamarRpc, temComprovantePendente = null }) {
  const chatId = event.chatId;
  if (event.hasMedia) return false;                 // mídia = comprovante
  const querNegarFechamento = negativoFechamento(event.body)
    && (/\bFECHAMENTO DE CAIXA\b/i.test(String(event.quotedBody || event.quotedPreview || ''))
      || /\bfechar\s+o\s+caixa\b/i.test(String(event.body || '')));
  if (!querNegarFechamento && !afirmativo(event.body)) return false; // pré-filtro barato
  let pend;
  try { pend = await rpcFn('sol_caixa_pendencia_aguardando', { p_chat_id: chatId }); } catch (e) { return false; }
  if (!pend || !pend.tipo) return false;            // nada aguardando -> deixa pro comprovante
  // com a pendência em mãos dá pra saber se a msg respondeu o preview (afrouxa o gate)
  const respondeuPreview = !!(event.quotedMessageId && pend.preview_message_id
    && event.quotedMessageId === pend.preview_message_id);
  // GUARDA 1: citou OUTRA mensagem (ex.: o preview do comprovante) -> não é abrir/fechar.
  if (event.quotedMessageId && !respondeuPreview) {
    log({ acao: 'abf_ignorado_quote_de_outro', tipo: pend.tipo });
    return false;
  }
  if (querNegarFechamento && pend.tipo === 'fechar') {
    let conf = event.senderName || String(event.senderId || '').replace(/@.*/, '').replace(/\D/g, '');
    try {
      const fin = require('./caixa-financeiro.cjs');
      const ident = await fin.identificarPessoa(event.senderPhone, pend.unidade_id);
      conf = fin.nomeParaCarimbo(ident, event);
    } catch (e) { /* best-effort */ }
    await rpcFn('sol_caixa_pendencia_resolver', { p_id: pend.id, p_status: 'cancelado', p_por: conf }).catch(() => {});
    await sendFn(chatId, 'Beleza, não vou fechar o caixa agora. Quando estiver tudo certo, manda *Sol, vamos fechar o caixa agora* que eu trago o demonstrativo de novo.');
    log({ acao: 'fechamento_cancelado_por_operador', tipo: pend.tipo });
    return true;
  }
  // GUARDA 2: sem citação, comprovante aguardando tem prioridade sobre abrir/fechar.
  if (!respondeuPreview && typeof temComprovantePendente === 'function') {
    let ocupado = false;
    try { ocupado = !!temComprovantePendente(chatId); } catch (e) { ocupado = false; }
    if (ocupado) {
      log({ acao: 'abf_cedeu_para_comprovante', tipo: pend.tipo });
      return false;
    }
  }
  if (!afirmativo(event.body, { respondeuPreview })) return false;
  // preview velho + confirmacao que nao citou o preview -> confirma de novo, uma vez.
  const idade = Number(pend.idade_min);
  const marca = chatId + ':' + pend.id;
  if (!respondeuPreview && isFinite(idade) && idade > JANELA_CONFIRMA_MIN && !_reconfirmando.has(marca)) {
    _reconfirmando.add(marca);
    const oque = pend.tipo === 'fechar' ? 'FECHAR' : 'ABRIR';
    await sendFn(chatId, `Só confirmando (esse pedido é de ${Math.floor(idade / 60)}h atrás): você quer que eu *${oque}* o caixa de hoje? Responde *pode ${oque === 'FECHAR' ? 'fechar' : 'abrir'}*.`);
    log({ acao: 'reconfirma_pedida', tipo: pend.tipo, idade_min: idade });
    return true;
  }
  const senderNum = String(event.senderId || '').replace(/@.*/, '').replace(/\D/g, '');
  // S0: "Conferido por: Tutu" (pushName) vira o nome do cadastro.
  let conf = event.senderName || senderNum;
  try {
    const fin = require('./caixa-financeiro.cjs');
    const ident = await fin.identificarPessoa(event.senderPhone, pend.unidade_id);
    conf = fin.nomeParaCarimbo(ident, event);
    log({ acao: 'identidade_abf', identificado: !!(ident && ident.identificado) });
  } catch (e) { /* best-effort: mantém o pushName */ }
  const base = { unidade_id: pend.unidade_id, data: pend.data, ator_numero: senderNum, ator_papel: 'grupo', conferido_por: conf, chat_id: chatId };

  if (pend.tipo === 'abrir') {
    let r;
    try { r = await rpcFn('sol_caixa_abrir', { p_payload: base }); }
    catch (e) { await sendFn(chatId, '⚠️ Deu erro técnico ao abrir. Tenta de novo em instantes.'); return true; }
    await rpcFn('sol_caixa_pendencia_resolver', { p_id: pend.id, p_status: (r && r.ok) ? 'confirmado' : 'aguardando', p_por: conf }).catch(() => {});
    if (r && r.ok && r.ja_aberto) {
      // o caixa já tinha sido aberto no app: NUNCA imprimir brl(undefined) = R$ 0,00.
      let saldo = null;
      try { const d = await rpcFn('sol_caixa_dados_abertura', { p_unidade_id: pend.unidade_id }); if (d) saldo = d.saldoInicial; } catch (e) {}
      const txt = (saldo === null || saldo === undefined)
        ? '✅ O caixa de hoje já estava aberto — não precisei abrir de novo.'
        : `✅ O caixa de hoje já estava aberto (saldo inicial ${brl(saldo)}) — não precisei abrir de novo.`;
      await sendFn(chatId, txt);
      log({ acao: 'ja_aberto', caixa: r.caixa_diario_id });
    }
    else if (r && r.ok) { await sendFn(chatId, `✅ Caixa aberto! Saldo inicial: ${brl(r.saldo_inicial)}. Bom dia de trabalho 💪`); log({ acao: 'aberto', caixa: r.caixa_diario_id }); }
    else { const m = ({ caixa_ja_existe_hoje: 'o caixa de hoje já existe', ator_nao_autorizado: 'você não está autorizado' })[r && r.motivo] || 'não consegui abrir'; await sendFn(chatId, `⚠️ Não abri: ${m}.`); }
    return true;
  }

  if (pend.tipo === 'fechar') {
    let r;
    try { r = await rpcFn('sol_caixa_fechar', { p_payload: base }); }
    catch (e) { await sendFn(chatId, '⚠️ Deu erro técnico ao fechar. Tenta de novo.'); return true; }
    await rpcFn('sol_caixa_pendencia_resolver', { p_id: pend.id, p_status: (r && r.ok) ? 'confirmado' : 'aguardando', p_por: conf }).catch(() => {});
    if (r && r.ok) {
      let texto = '✅ Caixa fechado.';
      try { const dados = await rpcFn('sol_caixa_dados_fechamento', { p_caixa_diario_id: r.caixa_diario_id }); if (dados) texto = montarTextoFechamento(dados); } catch (e) {}
      await sendFn(chatId, texto); log({ acao: 'fechado', caixa: r.caixa_diario_id });
    } else { const m = ({ caixa_nao_aberto: 'o caixa não está aberto', ator_nao_autorizado: 'você não está autorizado' })[r && r.motivo] || 'não consegui fechar'; await sendFn(chatId, `⚠️ Não fechei: ${m}.`); }
    return true;
  }
  return false;
}

async function tratarPedidoDiretoFechamento(event, { grupo, sendFn, log = () => {}, rpcFn = chamarRpc }) {
  const chatId = event.chatId;
  if (event.hasMedia) return false;
  if (!grupo || !grupo.unidade_id) return false;
  if (!pedidoDiretoFechar(event.body)) return false;

  const senderNum = String(event.senderPhone || event.senderId || '').replace(/@.*/, '').replace(/\D/g, '');
  let conf = event.senderName || senderNum;
  try {
    const fin = require('./caixa-financeiro.cjs');
    const ident = await fin.identificarPessoa(event.senderPhone, grupo.unidade_id);
    conf = fin.nomeParaCarimbo(ident, event);
    log({ acao: 'identidade_abf_direto', identificado: !!(ident && ident.identificado) });
  } catch (e) { /* best-effort: mantém o pushName */ }

  let d;
  try {
    d = await rpcFn('sol_caixa_dados_abertura', { p_unidade_id: grupo.unidade_id });
  } catch (e) {
    await sendFn(chatId, '⚠️ Não consegui buscar o caixa agora. Tenta de novo em instantes.');
    log({ acao: 'fechamento_preview_erro_abertura', erro: String(e.message || e).slice(0, 200) });
    return true;
  }
  if (!d || !d.ja_aberto || !d.caixa_id_aberto) {
    await sendFn(chatId, '⚠️ Não fechei: o caixa não está aberto.');
    log({ acao: 'fechamento_preview_recusado', motivo: 'caixa_nao_aberto' });
    return true;
  }
  let dados;
  try {
    dados = await rpcFn('sol_caixa_dados_fechamento', { p_caixa_diario_id: d.caixa_id_aberto });
  } catch (e) {
    await sendFn(chatId, '⚠️ Não consegui montar o demonstrativo agora. Tenta de novo em instantes.');
    log({ acao: 'fechamento_preview_erro_dados', erro: String(e.message || e).slice(0, 200) });
    return true;
  }
  const texto = montarTextoFechamento(dados) + '\n\n*Posso fechar agora?* Se estiver tudo certo, responde *pode* que eu fecho. Se ainda não for pra fechar, responde *não*.';
  const previewId = await sendFn(chatId, texto);
  await rpcFn('sol_caixa_pendencia_criar', { p_payload: { unidade_id: grupo.unidade_id, chat_id: chatId, tipo: 'fechar', preview_message_id: previewId } }).catch(() => {});
  log({ acao: 'fechamento_preview_direto_enviado', previewId });
  return true;
}

// CRON: posta preview de abertura + cria pendência (só se o caixa ainda não existe hoje)
async function postarAbertura(grupo, { sendFn }) {
  const d = await chamarRpc('sol_caixa_dados_abertura', { p_unidade_id: grupo.unidade_id });
  if (!d) return { skip: 'sem_dados' };
  if (d.ja_existe) return { skip: d.ja_aberto ? 'ja_aberto' : 'ja_existe' };
  const texto = montarTextoAbertura({ unidadeNome: d.unidadeNome, data: d.data, saldoInicial: d.saldoInicial });
  const previewId = await sendFn(grupo.chat_id, texto);
  await chamarRpc('sol_caixa_pendencia_criar', { p_payload: { unidade_id: grupo.unidade_id, chat_id: grupo.chat_id, tipo: 'abrir', preview_message_id: previewId } });
  return { ok: true, previewId };
}

// CRON: posta preview de fechamento (texto oficial) + cria pendência (só se há caixa aberto)
async function postarFechamento(grupo, { sendFn }) {
  const d = await chamarRpc('sol_caixa_dados_abertura', { p_unidade_id: grupo.unidade_id });
  if (!d || !d.ja_aberto || !d.caixa_id_aberto) return { skip: 'caixa_nao_aberto' };
  const dados = await chamarRpc('sol_caixa_dados_fechamento', { p_caixa_diario_id: d.caixa_id_aberto });
  const corpo = montarTextoFechamento(dados);
  const texto = corpo + '\n\n*Posso fechar?* Se estiver tudo certo, responde *pode* que eu fecho. ✅';
  const previewId = await sendFn(grupo.chat_id, texto);
  await chamarRpc('sol_caixa_pendencia_criar', { p_payload: { unidade_id: grupo.unidade_id, chat_id: grupo.chat_id, tipo: 'fechar', preview_message_id: previewId } });
  return { ok: true, previewId };
}

module.exports = {
  JANELA_CONFIRMA_MIN, brl, montarTextoFechamento, montarTextoAbertura,
  afirmativo, negativoFechamento, pedidoDiretoFechar, chamarRpc, tratarConfirmacao,
  tratarPedidoDiretoFechamento, postarAbertura, postarFechamento,
};
