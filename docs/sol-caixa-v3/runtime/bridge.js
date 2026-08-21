#!/usr/bin/env node
/**
 * Hermes Agent WhatsApp Bridge
 *
 * Standalone Node.js process that connects to WhatsApp via Baileys
 * and exposes HTTP endpoints for the Python gateway adapter.
 *
 * Endpoints (matches gateway/platforms/whatsapp.py expectations):
 *   GET  /messages       - Long-poll for new incoming messages
 *   POST /send           - Send a message { chatId, message, replyTo? }
 *   POST /edit           - Edit a sent message { chatId, messageId, message }
 *   POST /send-media     - Send media natively { chatId, filePath, mediaType?, caption?, fileName? }
 *   POST /typing         - Send typing indicator { chatId }
 *   GET  /chat/:id       - Get chat info
 *   GET  /health         - Health check
 *
 * Usage:
 *   node bridge.js --port 3000 --session ~/.hermes/whatsapp/session
 */

import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, fetchLatestWaWebVersion, downloadMediaMessage } from '@whiskeysockets/baileys';
import express from 'express';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import path from 'path';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { randomBytes, createHash } from 'crypto';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import qrcode from 'qrcode-terminal';
import { matchesAllowedUser, parseAllowedUsers } from './allowlist.js';
import { registerReportSingleMessageRoute } from './report-single-message.js';

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const WHATSAPP_DEBUG =
  typeof process !== 'undefined' &&
  process.env &&
  typeof process.env.WHATSAPP_DEBUG === 'string' &&
  ['1', 'true', 'yes', 'on'].includes(process.env.WHATSAPP_DEBUG.toLowerCase());

const PORT = parseInt(getArg('port', '3000'), 10);
const SESSION_DIR = getArg('session', path.join(process.env.HOME || '~', '.hermes', 'whatsapp', 'session'));
// Cache directories: the Python gateway passes the profile-aware paths via
// env (HERMES_HOME-aware, new cache/ layout).  Fall back to the legacy
// hardcoded locations for bridges launched outside the gateway.
const IMAGE_CACHE_DIR = process.env.HERMES_IMAGE_CACHE_DIR
  || path.join(process.env.HOME || '~', '.hermes', 'image_cache');
const DOCUMENT_CACHE_DIR = process.env.HERMES_DOCUMENT_CACHE_DIR
  || path.join(process.env.HOME || '~', '.hermes', 'document_cache');
const AUDIO_CACHE_DIR = process.env.HERMES_AUDIO_CACHE_DIR
  || path.join(process.env.HOME || '~', '.hermes', 'audio_cache');

// Self-hash of this script file.  Reported in /health so the Python gateway
// can detect a running bridge that predates the current bridge.js and
// restart it instead of silently reusing stale code (stale-bridge trap:
// `hermes update` updates bridge.js on disk but a long-lived bridge process
// keeps serving the old behavior forever).
let SCRIPT_HASH = '';
try {
  SCRIPT_HASH = createHash('sha256')
    .update(readFileSync(fileURLToPath(import.meta.url)))
    .digest('hex')
    .slice(0, 16);
} catch {}
const PAIR_ONLY = args.includes('--pair-only');
const WHATSAPP_MODE = getArg('mode', process.env.WHATSAPP_MODE || 'self-chat'); // "bot" or "self-chat"
const ALLOWED_USERS = parseAllowedUsers(process.env.WHATSAPP_ALLOWED_USERS || '');
const DEFAULT_REPLY_PREFIX = '⚕ *Hermes Agent*\n────────────\n';
const REPLY_PREFIX = process.env.WHATSAPP_REPLY_PREFIX === undefined
  ? DEFAULT_REPLY_PREFIX
  : process.env.WHATSAPP_REPLY_PREFIX.replace(/\\n/g, '\n');
const MAX_MESSAGE_LENGTH = parseInt(process.env.WHATSAPP_MAX_MESSAGE_LENGTH || '4096', 10);
const CHUNK_DELAY_MS = parseInt(process.env.WHATSAPP_CHUNK_DELAY_MS || '300', 10);
// Per-call timeout for sock.sendMessage(). Baileys occasionally hangs forever
// when uploading media to WhatsApp servers (and, less often, on text sends),
// which pins the bridge's HTTP handler until the upstream aiohttp timeout
// fires. Fail fast instead so the gateway can surface a real error and retry.
const SEND_TIMEOUT_MS = parseInt(process.env.WHATSAPP_SEND_TIMEOUT_MS || '60000', 10);


// LAHQ/Sol safety patch: group listen-only mode.
// Groups can be observed locally for warm-up/context, but are never queued to
// the Hermes agent and outbound group sends are blocked when enabled.
const WHATSAPP_GROUP_POLICY = String(process.env.WHATSAPP_GROUP_POLICY || 'disabled').toLowerCase().replace(/_/g, '-');
const WHATSAPP_GROUP_LISTEN_ONLY = ['listen-only', 'observe', 'observe-only', 'read-only', 'silent', 'disabled'].includes(WHATSAPP_GROUP_POLICY);
const WHATSAPP_ALLOWED_GROUPS = new Set(
  String(process.env.WHATSAPP_ALLOWED_GROUPS || '')
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean)
);
const WHATSAPP_GROUP_OBSERVE_LOG = process.env.WHATSAPP_GROUP_OBSERVE_LOG
  || path.join(process.env.HERMES_HOME || path.dirname(SESSION_DIR), 'logs', 'whatsapp-group-observe.jsonl');
const WHATSAPP_DM_OBSERVE_LOG = process.env.WHATSAPP_DM_OBSERVE_LOG
  || path.join(process.env.HERMES_HOME || path.dirname(SESSION_DIR), 'logs', 'whatsapp-dm-observe.jsonl');
const RECENT_OBSERVED_MESSAGES_MAX = parseInt(process.env.WHATSAPP_RECENT_OBSERVED_MESSAGES_MAX || '500', 10);
const recentObservedMessages = new Map();

function isGroupChatId(chatId) {
  return String(chatId || '').endsWith('@g.us');
}

function isAllowedGroupChatId(chatId) {
  return WHATSAPP_ALLOWED_GROUPS.has(String(chatId || ''));
}

function blockGroupSendIfNeeded(chatId, res) {
  if (isGroupChatId(chatId) && WHATSAPP_GROUP_LISTEN_ONLY && !isAllowedGroupChatId(chatId)) {
    try {
      console.log(JSON.stringify({ event: 'group_send_blocked_by_policy', policy: WHATSAPP_GROUP_POLICY, chatId }));
    } catch {}
    res.status(403).json({ error: 'group_send_blocked_by_policy', policy: WHATSAPP_GROUP_POLICY });
    return true;
  }
  if (isGroupChatId(chatId) && WHATSAPP_GROUP_LISTEN_ONLY && isAllowedGroupChatId(chatId)) {
    try {
      console.log(JSON.stringify({ event: 'group_send_allowed_by_allowlist', policy: WHATSAPP_GROUP_POLICY, chatId }));
    } catch {}
  }
  return false;
}

function rememberObservedMessage(event) {
  const messageId = String(event?.messageId || '');
  if (!messageId) return;
  recentObservedMessages.set(messageId, {
    messageId,
    chatId: event.chatId,
    senderId: event.senderId,
    senderName: event.senderName,
    body: String(event.body || ''),
    hasMedia: !!event.hasMedia,
    mediaType: event.mediaType || '',
    mediaUrls: Array.isArray(event.mediaUrls) ? event.mediaUrls.slice(0, 5) : [],
    timestamp: event.timestamp,
  });
  while (recentObservedMessages.size > RECENT_OBSERVED_MESSAGES_MAX) {
    recentObservedMessages.delete(recentObservedMessages.keys().next().value);
  }
}

function readRecentJsonLines(filePath, maxLines = 800) {
  try {
    if (!existsSync(filePath)) return [];
    const txt = readFileSync(filePath, 'utf8');
    const lines = txt.trim().split(/\n+/).filter(Boolean);
    return lines.slice(-maxLines).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function findObservedMessageById(messageId, chatId) {
  const wanted = String(messageId || '');
  if (!wanted) return null;

  const cached = recentObservedMessages.get(wanted);
  if (cached && (!chatId || cached.chatId === chatId)) return cached;

  const logs = [
    ...readRecentJsonLines(WHATSAPP_GROUP_OBSERVE_LOG),
    ...readRecentJsonLines(WHATSAPP_DM_OBSERVE_LOG),
  ];
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const row = logs[i];
    if (String(row?.messageId || '') !== wanted) continue;
    if (chatId && row.chatId && row.chatId !== chatId) continue;
    return {
      messageId: row.messageId,
      chatId: row.chatId,
      senderId: row.senderId,
      senderName: row.senderName,
      body: String(row.body || ''),
      hasMedia: !!row.hasMedia,
      mediaType: row.mediaType || '',
      mediaUrls: Array.isArray(row.mediaUrls) ? row.mediaUrls.filter(Boolean).slice(0, 5) : [],
      timestamp: row.timestamp,
    };
  }
  return null;
}

function quotedActionCanReuseMedia(body = '') {
  return /\b(isso|essa|esse|este|esta|aqui|lan[cç]a|lan[cç]ar|registra|registrar|salva|salvar|cria|criar|paguei|pago|comprovante|pode)\b/i.test(String(body || ''))
    || /\bsol\b/i.test(String(body || ''));
}

function observeGroupMessage(event, reason = 'group_listen_only') {
  try {
    rememberObservedMessage(event);
    mkdirSync(path.dirname(WHATSAPP_GROUP_OBSERVE_LOG), { recursive: true });
    appendFileSync(WHATSAPP_GROUP_OBSERVE_LOG, JSON.stringify({
      ts: new Date().toISOString(),
      event: 'group_observed',
      reason,
      policy: WHATSAPP_GROUP_POLICY,
      messageId: event.messageId,
      chatId: event.chatId,
      senderId: event.senderId,
      senderName: event.senderName,
      chatName: event.chatName,
      mediaUrls: event.mediaUrls || [],
      body: String(event.body || '').slice(0, 4000),
      hasMedia: event.hasMedia,
      mediaType: event.mediaType,
      quotedMessageId: event.quotedMessageId || null,
      quotedResolved: !!event.quotedResolved,
      quotedPreview: event.quotedPreview || '',
      timestamp: event.timestamp,
    }) + '\n');
    console.log(JSON.stringify({
      event: 'group_observed',
      policy: WHATSAPP_GROUP_POLICY,
      chatId: event.chatId,
      senderId: event.senderId,
      messageId: event.messageId,
      hasMedia: event.hasMedia,
      mediaType: event.mediaType,
    }));
  } catch (err) {
    console.error('[bridge] Failed to observe group message:', err.message);
  }
}

// Mensagem direta aceita: registra com conteudo, para o ingestor persistir.
// Conversa privada da equipe com a Sol nao pode viver so na sessao do Hermes.
function observeDirectMessage(event, reason = 'dm_accepted') {
  try {
    rememberObservedMessage(event);
    mkdirSync(path.dirname(WHATSAPP_DM_OBSERVE_LOG), { recursive: true });
    appendFileSync(WHATSAPP_DM_OBSERVE_LOG, JSON.stringify({
      ts: new Date().toISOString(),
      event: 'dm_observed',
      reason,
      messageId: event.messageId,
      chatId: event.chatId,
      senderId: event.senderId,
      senderName: event.senderName,
      mediaUrls: event.mediaUrls || [],
      body: String(event.body || '').slice(0, 4000),
      hasMedia: event.hasMedia,
      mediaType: event.mediaType,
      quotedMessageId: event.quotedMessageId || null,
      quotedResolved: !!event.quotedResolved,
      quotedPreview: event.quotedPreview || '',
      timestamp: event.timestamp,
    }) + '\n');
  } catch (err) {
    console.error('[bridge] Failed to observe DM:', err.message);
  }
}

// Tentativa de contato de numero fora da allowlist. Registra so o metadado --
// quem e quando -- sem o conteudo: quem nao esta autorizado a falar com a Sol
// tambem nao deve ter a mensagem guardada. Antes disso, uma tentativa de
// estranho nao deixava rastro nenhum em lugar nenhum.
function observeRejectedDirectMessage({ chatId, senderId }) {
  try {
    mkdirSync(path.dirname(WHATSAPP_DM_OBSERVE_LOG), { recursive: true });
    appendFileSync(WHATSAPP_DM_OBSERVE_LOG, JSON.stringify({
      ts: new Date().toISOString(),
      event: 'dm_rejected',
      reason: 'allowlist_mismatch',
      chatId,
      senderId,
    }) + '\n');
  } catch (err) {
    console.error('[bridge] Failed to observe rejected DM:', err.message);
  }
}

// O WhatsApp entrega o remetente como LID (identidade privada, ex:
// 72864136978660@lid), nao como telefone. O agente recebia esse LID como
// identidade e nao tinha como consultar o quem_eh da governanca, que e por
// telefone -- resultado: ficava em "modo seguro" e ainda gastava varias
// rodadas de LLM tentando descobrir quem falava. O proprio Baileys mantem o
// mapa LID->telefone no diretorio da sessao; e o mesmo caminho que o
// sol-group-ingest ja usa para resolver autor.
const telefonePorRemetente = new Map();
function resolverTelefoneDoRemetente(senderId) {
  const bruto = String(senderId || '');
  if (!bruto) return null;
  if (telefonePorRemetente.has(bruto)) return telefonePorRemetente.get(bruto);

  let telefone = null;
  const id = bruto.replace(/@.*/, '');
  if (bruto.endsWith('@lid')) {
    // So digitos antes de virar caminho de arquivo: senderId vem de fora e
    // nao pode montar path (../).
    if (/^\d+$/.test(id)) {
      try {
        const conteudo = readFileSync(path.join(SESSION_DIR, `lid-mapping-${id}_reverse.json`), 'utf8');
        const valor = JSON.parse(conteudo);
        const digitos = String(valor).replace(/\D/g, '');
        if (digitos) telefone = digitos;
      } catch {
        // Sem mapeamento local: segue null. Nao e erro -- o agente cai na
        // regra de nao tratar dado sem identificar quem fala.
      }
    }
  } else if (/^\d{10,15}$/.test(id)) {
    telefone = id;
  }

  telefonePorRemetente.set(bruto, telefone);
  return telefone;
}

// --- Engajamento em grupo: mencao + janela de conversa -----------------------
//
// Modelo copiado da bridge da Lia (uazapi-bridge), que ja roda ha semanas: a
// Sol responde quando e chamada e, a partir dai, fica "na conversa" por alguns
// minutos sem exigir que repitam o nome dela a cada frase. Quem encerra
// ("obrigado", "pode sair") fecha a janela na hora.
//
// Por que aqui e nao no AGENTS.md: sem esse filtro, TODA mensagem dos grupos
// autorizados viraria uma chamada de LLM so pra decidir "isso e comigo?" --
// caro, lento e desnecessario.
const GRUPO_JANELA_ATIVA_MS = parseInt(process.env.WHATSAPP_GROUP_ACTIVE_WINDOW_MS || '480000', 10); // 8 min
const GRUPOS_QUE_RESPONDEM = new Set(
  String(process.env.WHATSAPP_GROUP_RESPONSE_CHAT_IDS || '')
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean)
);
const grupoAtivoAte = new Map();

function normalizarTexto(valor = '') {
  return String(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// "sol" e palavra comum em portugues ("tomar sol", "sol forte"), diferente de
// "lia". Por isso NAO basta a palavra solta: exige vocativo (pontuacao),
// saudacao explicita ou inicio de mensagem. Mencao real do WhatsApp (@) e
// tratada a parte, em mencionaSol().
function pareceChamarSol(texto = '') {
  const n = normalizarTexto(texto);
  return /^sol\s*$/.test(n)
    || /(^|[^a-z0-9])@sol\b/.test(n)
    || /(^|[^a-z0-9])sol\s*[,!?:]/.test(n)
    || /^sol\s+(me|nos|voce|vc|pode|poderia|consegue|ve|olha|manda|traz|qual|quais|quanto|quantos|quando|como|onde|porque|por que|preciso|faz|faca|ajuda|verifica|confere|checa|lista|mostra|tem|para|responde|responder|ta|tá|esta|está)\b/.test(n)
    || /^pode\s*(?:[,!?:]|\s+ai)?\s+sol\b/.test(n)
    || /(^|[^a-z0-9])(oi|ola|opa|bom dia|boa tarde|boa noite|fala|e ai|ei)\s+sol\b/.test(n);
}

function mencionaSol(texto, mentionedIds, identidadesProprias) {
  for (const id of mentionedIds || []) {
    const so = String(id || '').replace(/@.*/, '');
    if (so && identidadesProprias.has(so)) return true;
  }
  return pareceChamarSol(texto);
}

function encerraTurnoDaSol(texto = '') {
  const n = normalizarTexto(texto);
  return /(obrigad[ao]|valeu|vlw|tchau|ate mais|ate logo|resolvido|ta resolvido|nao precisa|nao sera necessario|nao e mais necessario|pode sair|pode ir|encerrar|encerra|dispensad[ao])/.test(n);
}

function decidirEngajamentoNoGrupo({ chatId, texto, mentionedIds, identidadesProprias, agora = Date.now() }) {
  if (!GRUPOS_QUE_RESPONDEM.has(chatId)) {
    grupoAtivoAte.delete(chatId);
    return { responder: false, motivo: 'grupo_so_registra' };
  }
  if (encerraTurnoDaSol(texto)) {
    grupoAtivoAte.delete(chatId);
    return { responder: false, motivo: 'turno_encerrado' };
  }
  if (mencionaSol(texto, mentionedIds, identidadesProprias)) {
    grupoAtivoAte.set(chatId, agora + GRUPO_JANELA_ATIVA_MS);
    return { responder: true, motivo: 'chamada' };
  }
  if ((grupoAtivoAte.get(chatId) || 0) > agora) {
    grupoAtivoAte.set(chatId, agora + GRUPO_JANELA_ATIVA_MS);
    return { responder: true, motivo: 'janela_ativa' };
  }
  grupoAtivoAte.delete(chatId);
  return { responder: false, motivo: 'standby' };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sendWithTimeout(chatId, payload, timeoutMs = SEND_TIMEOUT_MS) {
  typingStop(chatId);
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`sendMessage timed out after ${timeoutMs / 1000}s`)),
      timeoutMs,
    );
  });
  return Promise.race([sock.sendMessage(chatId, payload), timeoutPromise])
    .finally(() => clearTimeout(timer));
}

const TECHNICAL_LEAK_RE = /Iteration budget exhausted|Codex response remained incomplete|\bCodex\b|\bRPC\b|public\.[a-z0-9_]+|\bsol_caixa_[a-z0-9_]+\b|\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b|mcp_stdio|tool_call|stack trace/i;

function humanizeTechnicalLeak(line) {
  const text = String(line || '');
  if (/public\.sol_caixa_resumo_do_dia|\bsol_caixa_resumo_do_dia\b/i.test(text)) {
    return 'Para corrigir essa divergência certinho, preciso consultar os dados detalhados do caixa. Vou pedir ao Alfredo ajustar essa leitura interna.';
  }
  if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(text)) {
    return 'Tive uma falha interna nessa operação. Vou tratar pelo fluxo do caixa e te aviso.';
  }
  if (/\bRPC\b|public\.[a-z0-9_]+|\bsol_caixa_[a-z0-9_]+\b/i.test(text)) {
    return text
      .replace(/`?public\.[a-z0-9_]+`?/gi, 'consulta interna')
      .replace(/`?sol_caixa_[a-z0-9_]+`?/gi, 'rotina interna do caixa')
      .replace(/\bRPC\b/gi, 'rotina interna')
      .replace(/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/gi, 'operação interna')
      .replace(/\brotina interna\s+rotina interna do caixa\b/gi, 'rotina interna do caixa')
      .replace(/\brotina\s+rotina interna do caixa\b/gi, 'rotina interna do caixa')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return '';
}

function sanitizeOutgoingMessage(message) {
  const original = String(message || '');
  const lines = original.split('\n');
  const sanitizedLines = [];

  for (const line of lines) {
    if (!TECHNICAL_LEAK_RE.test(line)) {
      sanitizedLines.push(line);
      continue;
    }
    const human = humanizeTechnicalLeak(line);
    if (human) sanitizedLines.push(human);
  }

  const texto = sanitizedLines.join('\n').trim();
  if (!texto && TECHNICAL_LEAK_RE.test(original)) {
    return 'Não consegui concluir essa resposta agora. Vou tratar pelo fluxo operacional e te aviso.';
  }
  return texto || original;
}

function formatOutgoingMessage(message) {
  message = sanitizeOutgoingMessage(message);
  // In bot mode, messages come from a different number so the prefix is
  // redundant — the sender identity is already clear.  Only prepend in
  // self-chat mode where bot and user share the same number.
  if (WHATSAPP_MODE !== 'self-chat') return message;
  return REPLY_PREFIX ? `${REPLY_PREFIX}${message}` : message;
}

function splitLongMessage(message, maxLength = MAX_MESSAGE_LENGTH) {
  const text = String(message || '');
  if (!text) return [];
  if (!Number.isFinite(maxLength) || maxLength < 1 || text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt < Math.floor(maxLength / 2)) {
      splitAt = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitAt < 1) splitAt = maxLength;

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function trackSentMessageId(sent) {
  if (sent?.key?.id) {
    recentlySentIds.add(sent.key.id);
    if (recentlySentIds.size > MAX_RECENT_IDS) {
      recentlySentIds.delete(recentlySentIds.values().next().value);
    }
  }
}

function normalizeWhatsAppId(value) {
  if (!value) return '';
  return String(value).replace(':', '@');
}

function getMessageContent(msg) {
  const content = msg?.message || {};
  if (content.ephemeralMessage?.message) return content.ephemeralMessage.message;
  if (content.viewOnceMessage?.message) return content.viewOnceMessage.message;
  if (content.viewOnceMessageV2?.message) return content.viewOnceMessageV2.message;
  if (content.documentWithCaptionMessage?.message) return content.documentWithCaptionMessage.message;
  if (content.templateMessage?.hydratedTemplate) return content.templateMessage.hydratedTemplate;
  if (content.buttonsMessage) return content.buttonsMessage;
  if (content.listMessage) return content.listMessage;
  return content;
}

function getContextInfo(messageContent) {
  if (!messageContent || typeof messageContent !== 'object') return {};
  for (const value of Object.values(messageContent)) {
    if (value && typeof value === 'object' && value.contextInfo) {
      return value.contextInfo;
    }
  }
  return {};
}

function getPlainTextFromMessageContent(messageContent) {
  const content = messageContent || {};
  return content.conversation
    || content.extendedTextMessage?.text
    || content.imageMessage?.caption
    || content.documentMessage?.caption
    || content.documentWithCaptionMessage?.message?.documentMessage?.caption
    || content.videoMessage?.caption
    || '';
}

mkdirSync(SESSION_DIR, { recursive: true });

// Build LID → phone reverse map from session files (lid-mapping-{phone}.json)
function buildLidMap() {
  const map = {};
  try {
    for (const f of readdirSync(SESSION_DIR)) {
      const m = f.match(/^lid-mapping-(\d+)\.json$/);
      if (!m) continue;
      const phone = m[1];
      const lid = JSON.parse(readFileSync(path.join(SESSION_DIR, f), 'utf8'));
      if (lid) map[String(lid)] = phone;
    }
  } catch {}
  return map;
}
let lidToPhone = buildLidMap();

const logger = pino({ level: 'warn' });

// Message queue for polling
const messageQueue = [];
const MAX_QUEUE_SIZE = 100;

// Track recently sent message IDs to prevent echo-back loops with media
const recentlySentIds = new Set();
const MAX_RECENT_IDS = 50;

let sock = null;

// TYPING (18/08, paridade com a Maria): "escrevendo..." enquanto a Sol processa.
// composing expira ~10s no WhatsApp -> refresher a cada 8s; TTL de seguranca 180s.
// Parada: chokepoint em sendWithTimeout (toda mensagem de saida passa la).
const typingTimers = new Map();
function typingStart(chatId) {
  if (!sock || typingTimers.has(chatId)) return;
  const send = () => { try { const p = sock && sock.sendPresenceUpdate('composing', chatId); if (p && p.catch) p.catch(() => {}); } catch (e) {} };
  send();
  const t = { until: Date.now() + 180000 };
  t.iv = setInterval(() => { if (Date.now() > t.until) return typingStop(chatId); send(); }, 8000);
  typingTimers.set(chatId, t);
}
function typingStop(chatId) {
  const t = typingTimers.get(chatId);
  if (t) { clearInterval(t.iv); typingTimers.delete(chatId); }
  try { const p = sock && sock.sendPresenceUpdate('paused', chatId); if (p && p.catch) p.catch(() => {}); } catch (e) {}
}
let connectionState = 'disconnected';

async function startSocket() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestWaWebVersion();
  console.log('WAVERSION:' + version.join('.'));

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ['Hermes Agent', 'Chrome', '120.0'],
    syncFullHistory: false,
    markOnlineOnConnect: false,
    // Required for Baileys 7.x: without this, incoming messages that need
    // E2EE session re-establishment are silently dropped (msg.message === null)
    getMessage: async (key) => {
      // We don't maintain a message store, so return a placeholder.
      // This is enough for Baileys to complete the retry handshake.
      return { conversation: '' };
    },
  });

  sock.ev.on('creds.update', () => { saveCreds(); lidToPhone = buildLidMap(); });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📱 Scan this QR code with WhatsApp on your phone:\n');
      console.log(`QRDATA:${qr}`);
      qrcode.generate(qr, { small: true });
      console.log('\nWaiting for scan...\n');
    }

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      connectionState = 'disconnected';

      if (reason === DisconnectReason.loggedOut) {
        console.log('❌ Logged out. Delete session and restart to re-authenticate.');
        process.exit(1);
      } else {
        // 515 = restart requested (common after pairing). Always reconnect.
        if (reason === 515) {
          console.log('↻ WhatsApp requested restart (code 515). Reconnecting...');
        } else {
          console.log(`⚠️  Connection closed (reason: ${reason}). Reconnecting in 3s...`);
        }
        setTimeout(startSocket, reason === 515 ? 1000 : 3000);
      }
    } else if (connection === 'open') {
      connectionState = 'connected';
      console.log('✅ WhatsApp connected!');
      if (PAIR_ONLY) {
        console.log('✅ Pairing complete. Credentials saved.');
        // Give Baileys a moment to flush creds, then exit cleanly
        setTimeout(() => process.exit(0), 2000);
      }
    }
  });

// ---- Sol Caixa (Fatia 1 - caminho A; bridge e ESM: import() + appendFileSync) ----
const CAIXA_LOG = '/home/sol/.hermes/profiles/sol/caixa-ingestao/caixa.log';
const SOL_CAIXA_LIVE = process.env.SOL_CAIXA_LIVE === '1';
const FINANCE_GROUPS = new Set(
  String(process.env.SOL_CAIXA_FINANCE_GROUPS || '')
    .split(';').map(function (x) { return (x.split('|')[0] || '').trim(); }).filter(Boolean)
);
function financeGroupMap() {
  const grupos = {};
  String(process.env.SOL_CAIXA_FINANCE_GROUPS || '').split(';').forEach(function (g) {
    const p = g.split('|');
    if (p[0] && p[1]) grupos[p[0].trim()] = { chat_id: p[0].trim(), unidade_id: p[1].trim(), nome: (p[2] || '').trim() || 'Caixa' };
  });
  return grupos;
}
function _caixaLog(o) {
  try { appendFileSync(CAIXA_LOG, JSON.stringify(Object.assign({ ts: new Date().toISOString() }, o)) + '\n'); } catch (e) {}
}
let _caixaHandler = null;
const SOL_CAIXA_CLASSIFICADOR_V3_SHADOW = process.env.SOL_CAIXA_CLASSIFICADOR_V3_SHADOW === '1';
let _classificadorV3Shadow = null;
async function classificadorV3Shadow() {
  if (!SOL_CAIXA_CLASSIFICADOR_V3_SHADOW) return null;
  if (_classificadorV3Shadow) return _classificadorV3Shadow;
  try {
    _classificadorV3Shadow = await import('file:///home/sol/.hermes/profiles/sol/caixa-ingestao/classificador-v3-shadow.cjs');
  } catch (e) {
    _caixaLog({ step: 'classificador_v3_shadow_load_erro', msg: e.message });
    _classificadorV3Shadow = null;
  }
  return _classificadorV3Shadow;
}
async function financeHandler() {
  if (!SOL_CAIXA_LIVE) return null;
  if (_caixaHandler) return _caixaHandler;
  try {
    const mod = (await import('file:///home/sol/.hermes/profiles/sol/caixa-ingestao/caixa-financeiro.cjs')).default;
    const grupos = financeGroupMap();
    _caixaHandler = mod.criarHandlerFinanceiro({
      grupos: grupos,
      sendFn: async function (chatId, text) {
        const sent = await sendWithTimeout(chatId, { text: text });
        const id = sent && sent.key && sent.key.id;
        if (id) recentlySentIds.add(id);
        return id;
      },
      log: function (o) { _caixaLog(o); },
    });
    _caixaLog({ step: 'init', grupos: Object.keys(grupos) });
  } catch (e) {
    _caixaLog({ step: 'init_erro', msg: e.message, stack: String(e.stack || '').slice(0, 400) });
    _caixaHandler = null;
  }
  return _caixaHandler;
}

let _caixaAbf = null;
async function caixaAbf() {
  if (_caixaAbf) return _caixaAbf;
  try {
    _caixaAbf = (await import('file:///home/sol/.hermes/profiles/sol/caixa-ingestao/caixa-abertura-fechamento.cjs')).default;
  } catch (e) {
    _caixaLog({ step: 'abf_load_erro', msg: e.message });
    _caixaAbf = null;
  }
  return _caixaAbf;
}

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // In self-chat mode, your own messages commonly arrive as 'append' rather
    // than 'notify'. Accept both and filter agent echo-backs below.
    if (type !== 'notify' && type !== 'append') return;

    const botIds = Array.from(new Set([
      normalizeWhatsAppId(sock.user?.id),
      normalizeWhatsAppId(sock.user?.lid),
    ].filter(Boolean)));

    for (const msg of messages) {
      if (!msg.message) continue;

      const chatId = msg.key.remoteJid;
      if (WHATSAPP_DEBUG) {
        try {
          console.log(JSON.stringify({
            event: 'upsert', type,
            fromMe: !!msg.key.fromMe, chatId,
            senderId: msg.key.participant || chatId,
            messageKeys: Object.keys(msg.message || {}),
          }));
        } catch {}
      }
      const senderId = msg.key.participant || chatId;
      const isGroup = chatId.endsWith('@g.us');
      const senderNumber = senderId.replace(/@.*/, '');

      // Handle fromMe messages based on mode
      if (msg.key.fromMe) {
        if (isGroup || chatId.includes('status')) continue;

        if (WHATSAPP_MODE === 'bot') {
          // Bot mode: separate number. ALL fromMe are echo-backs of our own replies — skip.
          continue;
        }

        // Self-chat mode: only allow messages in the user's own self-chat
        // WhatsApp now uses LID (Linked Identity Device) format: 67427329167522@lid
        // AND classic format: 34652029134@s.whatsapp.net
        // sock.user has both: { id: "number:10@s.whatsapp.net", lid: "lid_number:10@lid" }
        const myNumber = (sock.user?.id || '').replace(/:.*@/, '@').replace(/@.*/, '');
        const myLid = (sock.user?.lid || '').replace(/:.*@/, '@').replace(/@.*/, '');
        const chatNumber = chatId.replace(/@.*/, '');
        const isSelfChat = (myNumber && chatNumber === myNumber) || (myLid && chatNumber === myLid);
        if (!isSelfChat) continue;
      }

      // Handle !fromMe messages (from other people) based on mode.
      // Self-chat mode only responds to the user's own messages to
      // themselves — stranger DMs / group pings must never reach the
      // Python gateway, otherwise a pairing-code reply fires in response
      // to arbitrary incoming messages (#8389).
      // Preenchida abaixo: remetente de GRUPO fora da allowlist. A mensagem
      // ainda e observada (persistida); so nao vai pro agente.
      let remetenteNaoAutorizado = false;
      if (!msg.key.fromMe) {
        if (WHATSAPP_MODE === 'self-chat') {
          try {
            console.log(JSON.stringify({
              event: 'ignored',
              reason: 'self_chat_mode_rejects_non_self',
              chatId,
              senderId,
            }));
          } catch {}
          continue;
        }
        if (!matchesAllowedUser(senderId, ALLOWED_USERS, SESSION_DIR)) {
          try {
            console.log(JSON.stringify({
              event: 'ignored',
              reason: 'allowlist_mismatch',
              chatId,
              senderId,
            }));
          } catch {}
          // DM de numero nao autorizado: descarta aqui mesmo (so o metadado
          // fica registrado). Em GRUPO nao da pra descartar: o grupo e
          // autorizado mesmo quando quem fala nao esta na governanca, e a
          // mensagem precisa ser observada/persistida. Marca e segue -- o
          // bloco de observacao decide nao enfileirar pro agente.
          if (!isGroup) {
            observeRejectedDirectMessage({ chatId, senderId });
            continue;
          }
          // 18/08 (ordem do Alf): em GRUPO autorizado qualquer membro conversa — a fronteira
          // e o allowlist de GRUPOS. (Mayra caia aqui: LID sem reverse-map.) DM segue estrita.
          // Reverter: WHATSAPP_GROUP_STRICT_USERS=1 no .env.
          remetenteNaoAutorizado = (process.env.WHATSAPP_GROUP_STRICT_USERS === '1');
        }
      }

      const messageContent = getMessageContent(msg);
      const contextInfo = getContextInfo(messageContent);
      const mentionedIds = Array.from(new Set((contextInfo?.mentionedJid || []).map(normalizeWhatsAppId).filter(Boolean)));
      const quotedMessageId = contextInfo?.stanzaId || null;
      const quotedParticipant = normalizeWhatsAppId(contextInfo?.participant || '') || null;
      const quotedRemoteJid = normalizeWhatsAppId(contextInfo?.remoteJid || '') || null;
      const hasQuotedMessage = !!contextInfo?.quotedMessage;
      const quotedBody = hasQuotedMessage ? getPlainTextFromMessageContent(getMessageContent({ message: contextInfo.quotedMessage })) : '';
      let quotedResolved = false;
      let quotedPreview = quotedBody ? quotedBody.slice(0, 500) : '';

      // Extract message body
      let body = '';
      let hasMedia = false;
      let mediaType = '';
      const mediaUrls = [];

      if (messageContent.conversation) {
        body = messageContent.conversation;
      } else if (messageContent.extendedTextMessage?.text) {
        body = messageContent.extendedTextMessage.text;
      } else if (messageContent.imageMessage) {
        body = messageContent.imageMessage.caption || '';
        hasMedia = true;
        mediaType = 'image';
        try {
          const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
          const mime = messageContent.imageMessage.mimetype || 'image/jpeg';
          const extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
          const ext = extMap[mime] || '.jpg';
          mkdirSync(IMAGE_CACHE_DIR, { recursive: true });
          const filePath = path.join(IMAGE_CACHE_DIR, `img_${randomBytes(6).toString('hex')}${ext}`);
          writeFileSync(filePath, buf);
          mediaUrls.push(filePath);
        } catch (err) {
          console.error('[bridge] Failed to download image:', err.message);
        }
      } else if (messageContent.videoMessage) {
        body = messageContent.videoMessage.caption || '';
        hasMedia = true;
        mediaType = 'video';
        try {
          const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
          const mime = messageContent.videoMessage.mimetype || 'video/mp4';
          const ext = mime.includes('mp4') ? '.mp4' : '.mkv';
          mkdirSync(DOCUMENT_CACHE_DIR, { recursive: true });
          const filePath = path.join(DOCUMENT_CACHE_DIR, `vid_${randomBytes(6).toString('hex')}${ext}`);
          writeFileSync(filePath, buf);
          mediaUrls.push(filePath);
        } catch (err) {
          console.error('[bridge] Failed to download video:', err.message);
        }
      } else if (messageContent.audioMessage || messageContent.pttMessage) {
        hasMedia = true;
        mediaType = messageContent.pttMessage ? 'ptt' : 'audio';
        try {
          const audioMsg = messageContent.pttMessage || messageContent.audioMessage;
          const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
          const mime = audioMsg.mimetype || 'audio/ogg';
          const ext = mime.includes('ogg') ? '.ogg' : mime.includes('mp4') ? '.m4a' : '.ogg';
          mkdirSync(AUDIO_CACHE_DIR, { recursive: true });
          const filePath = path.join(AUDIO_CACHE_DIR, `aud_${randomBytes(6).toString('hex')}${ext}`);
          writeFileSync(filePath, buf);
          mediaUrls.push(filePath);
        } catch (err) {
          console.error('[bridge] Failed to download audio:', err.message);
        }
      } else if (messageContent.documentMessage) {
        body = messageContent.documentMessage.caption || '';
        hasMedia = true;
        mediaType = 'document';
        const fileName = messageContent.documentMessage.fileName || 'document';
        try {
          const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
          mkdirSync(DOCUMENT_CACHE_DIR, { recursive: true });
          const safeFileName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
          const filePath = path.join(DOCUMENT_CACHE_DIR, `doc_${randomBytes(6).toString('hex')}_${safeFileName}`);
          writeFileSync(filePath, buf);
          mediaUrls.push(filePath);
        } catch (err) {
          console.error('[bridge] Failed to download document:', err.message);
        }
      }

      // MARCACAO (espelha a Maria: resolveQuotedInfo + looksLikeQuotedParcelSaveRequest):
      // se a msg CITA um comprovante (midia) e o texto pede lancar OU chama "Sol", trata a midia
      // CITADA como a desta msg. Baileys ja embute a citada em contextInfo.quotedMessage (sem /message/find).
      if (!hasMedia && hasQuotedMessage && contextInfo && contextInfo.quotedMessage) {
        const _q = contextInfo.quotedMessage;
        const _qImg = _q.imageMessage || (_q.viewOnceMessage && _q.viewOnceMessage.message && _q.viewOnceMessage.message.imageMessage);
        const _qDoc = _q.documentMessage || (_q.documentWithCaptionMessage && _q.documentWithCaptionMessage.message && _q.documentWithCaptionMessage.message.documentMessage);
        const _pedeAcao = /\b(lan[cç]a|lan[cç]ar|registra|registrar|salva|salvar|cria|criar|paguei|pago|comprovante)\b/i.test(body) || /\bsol\b/i.test(body);
        if ((_qImg || _qDoc) && _pedeAcao) {
          try {
            const _qForDl = { key: { remoteJid: quotedRemoteJid || chatId, id: quotedMessageId, participant: quotedParticipant || undefined, fromMe: false }, message: _q };
            const _buf = await downloadMediaMessage(_qForDl, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
            let _fp = '';
            let _cap = '';
            if (_qImg) {
              const _mime = _qImg.mimetype || 'image/jpeg';
              const _ext = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' })[_mime] || '.jpg';
              mkdirSync(IMAGE_CACHE_DIR, { recursive: true });
              _fp = path.join(IMAGE_CACHE_DIR, `img_${randomBytes(6).toString('hex')}${_ext}`);
              _cap = _qImg.caption || '';
              mediaType = 'image';
            } else {
              const _fn = _qDoc.fileName || 'document';
              mkdirSync(DOCUMENT_CACHE_DIR, { recursive: true });
              const _safe = path.basename(_fn).replace(/[^a-zA-Z0-9._-]/g, '_');
              _fp = path.join(DOCUMENT_CACHE_DIR, `doc_${randomBytes(6).toString('hex')}_${_safe}`);
              _cap = _qDoc.caption || '';
              mediaType = 'document';
            }
            writeFileSync(_fp, _buf);
            mediaUrls.push(_fp);
            hasMedia = true;
            quotedResolved = true;
            quotedPreview = (_cap || quotedBody || '').slice(0, 500);
            if (_cap) { body = body ? `${body}\n${_cap}` : _cap; }
            try { console.log(JSON.stringify({ event: 'quoted_media_resolved', chatId, mediaType, quotedMessageId })); } catch (_ee) {}
          } catch (_e) {
            console.error('[bridge] Failed to download quoted media:', _e.message);
          }
        }
      }

      // Algumas respostas do WhatsApp chegam apenas com contextInfo.stanzaId,
      // sem contextInfo.quotedMessage. Nesse caso, se a mensagem citada foi
      // observada recentemente pelo proprio bridge, reaproveita a midia/caption
      // original. Isso cobre "Sol, isso aqui" ou "pode lançar" respondendo um
      // comprovante antigo, sem depender de visão nova nem de gambiarra no parser.
      if (!hasMedia && quotedMessageId && quotedActionCanReuseMedia(body)) {
        const observed = findObservedMessageById(quotedMessageId, quotedRemoteJid || chatId);
        if (observed?.hasMedia && observed.mediaUrls?.length) {
          for (const url of observed.mediaUrls) {
            if (url && existsSync(url)) mediaUrls.push(url);
          }
          if (mediaUrls.length) {
            hasMedia = true;
            mediaType = observed.mediaType || 'image';
            quotedResolved = true;
            quotedPreview = String(observed.body || '').slice(0, 500);
            if (observed.body) {
              body = body ? `${body}\n${observed.body}` : observed.body;
            }
            try {
              console.log(JSON.stringify({
                event: 'quoted_media_resolved_from_observe_log',
                chatId,
                mediaType,
                quotedMessageId,
                mediaCount: mediaUrls.length,
              }));
            } catch {}
          }
        } else if (observed) {
          quotedPreview = String(observed.body || '').slice(0, 500);
        }
      }

      // For media without caption, use a placeholder so the API message is never empty
      if (hasMedia && !body) {
        body = `[${mediaType} received]`;
      }

      // Ignore Hermes' own reply messages in self-chat mode to avoid loops.
      if (msg.key.fromMe && ((REPLY_PREFIX && body.startsWith(REPLY_PREFIX)) || recentlySentIds.has(msg.key.id))) {
        if (WHATSAPP_DEBUG) {
          try { console.log(JSON.stringify({ event: 'ignored', reason: 'agent_echo', chatId, messageId: msg.key.id })); } catch {}
        }
        continue;
      }

      // Skip empty messages
      if (!body && !hasMedia) {
        if (WHATSAPP_DEBUG) {
          try { 
            console.log(JSON.stringify({ event: 'ignored', reason: 'empty', chatId, messageKeys: Object.keys(msg.message || {}) })); 
          } catch (err) {
            console.error('Failed to log empty message event:', err);
          }
        }
        continue;
      }

      const event = {
        messageId: msg.key.id,
        chatId,
        senderId,
        senderName: msg.pushName || senderNumber,
        senderPhone: resolverTelefoneDoRemetente(senderId),
        chatName: isGroup ? (chatId.split('@')[0]) : (msg.pushName || senderNumber),
        isGroup,
        body,
        hasMedia,
        mediaType,
        mediaUrls,
        mentionedIds,
        quotedMessageId,
        quotedParticipant,
        quotedRemoteJid,
        hasQuotedMessage,
        quotedResolved,
        quotedPreview,
        quotedBody,
        botIds,
        timestamp: msg.messageTimestamp,
      };

      if (isGroup) {
        // Observa (persiste) SEMPRE, antes de qualquer decisao de resposta.
        observeGroupMessage(event);
        if (SOL_CAIXA_LIVE && FINANCE_GROUPS.has(chatId)) {
          try {
            _caixaLog({ step: 'msg', chatId: chatId, hasMedia: event.hasMedia, mediaType: event.mediaType });
            if (event.hasMedia) typingStart(chatId);
            const _abf = await caixaAbf();
            if (_abf) {
              const _sf = async (cid, txt) => {
                const s2 = await sendWithTimeout(cid, { text: txt });
                const id = s2 && s2.key && s2.key.id; if (id) recentlySentIds.add(id);
                // S2: quando ELA fala no grupo, abre a janela de conversa -- o time responde sem @.
                grupoAtivoAte.set(cid, Date.now() + GRUPO_JANELA_ATIVA_MS);
                return id;
              };
              const _grupoCaixa = financeGroupMap()[chatId];
              const _direto = await _abf.tratarPedidoDiretoFechamento(event, { grupo: _grupoCaixa, sendFn: _sf, log: _caixaLog });
              if (_direto) { typingStop(chatId); _caixaLog({ step: 'abf_fechamento_direto' }); continue; }
              const _fhPrio = await financeHandler();
              const _tratou = await _abf.tratarConfirmacao(event, { sendFn: _sf, log: _caixaLog,
                temComprovantePendente: (cid) => !!(_fhPrio && _fhPrio.temPendencia && _fhPrio.temPendencia(cid)) });
              if (_tratou) { _caixaLog({ step: 'abf_tratou' }); continue; }
            }
            const _fh = await financeHandler();
            let _tratouCaixa = true;
            if (_fh) {
              const _grupoCaixa = financeGroupMap()[chatId];
              const _shadow = await classificadorV3Shadow();
              let _shadowClassificacao = null;
              if (_shadow) {
                try { _shadowClassificacao = _shadow.classificar({ event, grupo: _grupoCaixa }); }
                catch (e) { _caixaLog({ step: 'classificador_v3_shadow_erro', msg: e.message }); }
              }
              const _r = await _fh.handle(event);
              _caixaLog({ step: 'result', r: _r });
              if (_shadow && _shadowClassificacao) {
                try { _shadow.registrar({ log: _caixaLog, event, grupo: _grupoCaixa, classificacao: _shadowClassificacao, legado: _r }); }
                catch (e) { _caixaLog({ step: 'classificador_v3_shadow_erro', msg: e.message }); }
              }
              // S2: se nao era assunto de caixa, a mensagem segue pro engajamento (LLM).
              _tratouCaixa = !(_r && (_r.acao === 'nada' || _r.acao === 'ignorado_fora_grupo'));
            }
            if (_tratouCaixa) { typingStop(chatId); continue; }   // dinheiro e deterministico: nunca vai pro LLM
          } catch (e) {
            _caixaLog({ step: 'erro', msg: e.message, stack: String(e.stack || '').slice(0, 400) });
            typingStop(chatId);
            continue;
          }
        }
        if (WHATSAPP_GROUP_LISTEN_ONLY || remetenteNaoAutorizado) continue;

        const identidadesProprias = new Set(
          [(sock.user?.id || ''), (sock.user?.lid || '')]
            .map(v => String(v).replace(/:.*@/, '@').replace(/@.*/, ''))
            .filter(Boolean)
        );
        const decisao = decidirEngajamentoNoGrupo({
          chatId, texto: body, mentionedIds, identidadesProprias,
        });
        try {
          console.log(JSON.stringify({
            event: 'group_engagement_decision', chatId,
            motivo: decisao.motivo, responder: decisao.responder,
          }));
        } catch {}
        if (!decisao.responder) continue;
      } else {
        observeDirectMessage(event);
      }

      // O modelo so enxerga o TEXTO da mensagem — senderId/chatId nao chegam
      // como metadado utilizavel. Sem o telefone aqui, ele nao tem como chamar
      // governanca.quem_eh e cai em "modo seguro" (foi o que aconteceu com a
      // Sol em 2026-07-27; a bridge da Lia ja fazia isso desde 2026-07-01).
      // Injetado DEPOIS da observacao, para o texto persistido ficar limpo.
      if (event.senderPhone) {
        event.body = `[telefone_remetente: ${event.senderPhone}]\n${event.body || ''}`;
      }

      typingStart(chatId);
      messageQueue.push(event);
      if (messageQueue.length > MAX_QUEUE_SIZE) {
        messageQueue.shift();
      }
    }
  });
}

// HTTP server
const app = express();
app.use(express.json());

// Host-header validation — defends against DNS rebinding.
// The bridge binds loopback-only (127.0.0.1) but a victim browser on
// the same machine could be tricked into fetching from an attacker
// hostname that TTL-flips to 127.0.0.1. Reject any request whose Host
// header doesn't resolve to a loopback alias.
// See GHSA-ppp5-vxwm-4cf7.
const _ACCEPTED_HOST_VALUES = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  '::1',
]);

app.use((req, res, next) => {
  const raw = (req.headers.host || '').trim();
  if (!raw) {
    return res.status(400).json({ error: 'Missing Host header' });
  }
  // Strip port suffix: "localhost:3000" → "localhost"
  const hostOnly = (raw.includes(':')
    ? raw.substring(0, raw.lastIndexOf(':'))
    : raw
  ).replace(/^\[|\]$/g, '').toLowerCase();
  if (!_ACCEPTED_HOST_VALUES.has(hostOnly)) {
    return res.status(400).json({
      error: 'Invalid Host header. Bridge accepts loopback hosts only.',
    });
  }
  next();
});

// Poll for new messages (long-poll style)
app.get('/messages', (req, res) => {
  const msgs = messageQueue.splice(0, messageQueue.length);
  res.json(msgs);
});

// Send a message
app.post('/send', async (req, res) => {
  if (!sock || connectionState !== 'connected') {
    return res.status(503).json({ error: 'Not connected to WhatsApp' });
  }

  const { chatId, message, replyTo } = req.body;
  if (!chatId || !message) {
    return res.status(400).json({ error: 'chatId and message are required' });
  }
  if (blockGroupSendIfNeeded(chatId, res)) return;

  try {
    const chunks = splitLongMessage(formatOutgoingMessage(message));
    const messageIds = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const sent = await sendWithTimeout(chatId, { text: chunks[i] });
      trackSentMessageId(sent);
      if (sent?.key?.id) messageIds.push(sent.key.id);
      if (chunks.length > 1 && i < chunks.length - 1) {
        await sleep(CHUNK_DELAY_MS);
      }
    }

    res.json({
      success: true,
      messageId: messageIds[messageIds.length - 1],
      messageIds,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
registerReportSingleMessageRoute({
  app,
  getSocket: () => sock,
  getConnectionState: () => connectionState,
  formatOutgoingMessage,
  sendWithTimeout,
  trackSentMessageId,
  isAllowedGroupChatId,
});

// Edit a previously sent message
app.post('/edit', async (req, res) => {
  if (!sock || connectionState !== 'connected') {
    return res.status(503).json({ error: 'Not connected to WhatsApp' });
  }

  const { chatId, messageId, message } = req.body;
  if (!chatId || !messageId || !message) {
    return res.status(400).json({ error: 'chatId, messageId, and message are required' });
  }
  if (blockGroupSendIfNeeded(chatId, res)) return;

  try {
    const key = { id: messageId, fromMe: true, remoteJid: chatId };
    const chunks = splitLongMessage(formatOutgoingMessage(message));
    const messageIds = [];

    await sendWithTimeout(chatId, { text: chunks[0], edit: key });
    if (chunks.length > 1) {
      for (let i = 1; i < chunks.length; i += 1) {
        const sent = await sendWithTimeout(chatId, { text: chunks[i] });
        trackSentMessageId(sent);
        if (sent?.key?.id) messageIds.push(sent.key.id);
        if (i < chunks.length - 1) {
          await sleep(CHUNK_DELAY_MS);
        }
      }
    }

    res.json({ success: true, messageIds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// MIME type map and media type inference for /send-media
const MIME_MAP = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
  mkv: 'video/x-matroska', '3gp': 'video/3gpp',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function inferMediaType(ext) {
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'avi', 'mkv', '3gp'].includes(ext)) return 'video';
  if (['ogg', 'opus', 'mp3', 'wav', 'm4a'].includes(ext)) return 'audio';
  return 'document';
}

// Send media (image, video, document) natively
app.post('/send-media', async (req, res) => {
  if (!sock || connectionState !== 'connected') {
    return res.status(503).json({ error: 'Not connected to WhatsApp' });
  }

  const { chatId, filePath, mediaType, caption, fileName } = req.body;
  if (!chatId || !filePath) {
    return res.status(400).json({ error: 'chatId and filePath are required' });
  }
  if (blockGroupSendIfNeeded(chatId, res)) return;

  try {
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: `File not found: ${filePath}` });
    }

    const buffer = readFileSync(filePath);
    const ext = filePath.toLowerCase().split('.').pop();
    const type = mediaType || inferMediaType(ext);
    let msgPayload;

    switch (type) {
      case 'image':
        msgPayload = { image: buffer, caption: caption || undefined, mimetype: MIME_MAP[ext] || 'image/jpeg' };
        break;
      case 'video':
        msgPayload = { video: buffer, caption: caption || undefined, mimetype: MIME_MAP[ext] || 'video/mp4' };
        break;
      case 'audio': {
        // WhatsApp only renders a native voice bubble (ptt) when the file is ogg/opus.
        // If the caller passes mp3, wav, m4a etc. (e.g. from Edge TTS / NeuTTS),
        // silently convert to ogg/opus via ffmpeg so ptt is always honoured.
        let audioBuffer = buffer;
        let audioExt = ext;
        const needsConversion = !['ogg', 'opus'].includes(ext);
        let tmpPath = null;
        if (needsConversion) {
          tmpPath = path.join(tmpdir(), `hermes_voice_${randomBytes(6).toString('hex')}.ogg`);
          try {
            execSync(
              `ffmpeg -y -i ${JSON.stringify(filePath)} -ar 48000 -ac 1 -c:a libopus ${JSON.stringify(tmpPath)}`,
              { timeout: 30000, stdio: 'pipe' }
            );
            audioBuffer = readFileSync(tmpPath);
            audioExt = 'ogg';
          } catch (convErr) {
            // ffmpeg not available or conversion failed — fall back to original format
            console.warn('[bridge] ffmpeg conversion failed, sending as file attachment:', convErr.message);
          } finally {
            try { if (tmpPath && existsSync(tmpPath)) unlinkSync(tmpPath); } catch (_) {}
          }
        }
        const audioMime = (audioExt === 'ogg' || audioExt === 'opus') ? 'audio/ogg; codecs=opus' : 'audio/mpeg';
        msgPayload = { audio: audioBuffer, mimetype: audioMime, ptt: audioExt === 'ogg' || audioExt === 'opus' };
        break;
      }
      case 'document':
      default:
        msgPayload = {
          document: buffer,
          fileName: fileName || path.basename(filePath),
          caption: caption || undefined,
          mimetype: MIME_MAP[ext] || 'application/octet-stream',
        };
        break;
    }

    const sent = await sendWithTimeout(chatId, msgPayload);

    trackSentMessageId(sent);

    res.json({ success: true, messageId: sent?.key?.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Typing indicator
app.post('/typing', async (req, res) => {
  if (!sock || connectionState !== 'connected') {
    return res.status(503).json({ error: 'Not connected' });
  }

  const { chatId } = req.body;
  if (!chatId) return res.status(400).json({ error: 'chatId required' });
  if (blockGroupSendIfNeeded(chatId, res)) return;

  try {
    await sock.sendPresenceUpdate('composing', chatId);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

// Chat info
app.get('/chat/:id', async (req, res) => {
  const chatId = req.params.id;
  const isGroup = chatId.endsWith('@g.us');

  if (isGroup && sock) {
    try {
      const metadata = await sock.groupMetadata(chatId);
      return res.json({
        name: metadata.subject,
        isGroup: true,
        participants: metadata.participants.map(p => p.id),
      });
    } catch {
      // Fall through to default
    }
  }

  res.json({
    name: chatId.replace(/@.*/, ''),
    isGroup,
    participants: [],
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: connectionState,
    queueLength: messageQueue.length,
    uptime: process.uptime(),
    scriptHash: SCRIPT_HASH,
  });
});

// Start
if (PAIR_ONLY) {
  // Pair-only mode: just connect, show QR, save creds, exit. No HTTP server.
  console.log('📱 WhatsApp pairing mode');
  console.log(`📁 Session: ${SESSION_DIR}`);
  console.log();
  startSocket();
} else {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`🌉 WhatsApp bridge listening on port ${PORT} (mode: ${WHATSAPP_MODE})`);
    console.log(`📁 Session stored in: ${SESSION_DIR}`);
    if (ALLOWED_USERS.size > 0) {
      console.log(`🔒 Allowed users: ${Array.from(ALLOWED_USERS).join(', ')}`);
    } else if (WHATSAPP_MODE === 'self-chat') {
      console.log(`🔒 Self-chat mode — only your own messages to yourself are processed.`);
    } else {
      console.log(`🔒 No WHATSAPP_ALLOWED_USERS set — incoming messages are rejected.`);
      console.log(`   Set WHATSAPP_ALLOWED_USERS=<phone> to authorize specific users,`);
      console.log(`   or WHATSAPP_ALLOWED_USERS=* for an explicit open bot.`);
    }
    console.log();
    startSocket();
  });
}
