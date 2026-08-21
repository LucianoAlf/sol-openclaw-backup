#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROFILE_DIR = process.env.SOL_PROFILE_DIR || '/home/sol/.hermes/profiles/sol';
const OBSERVE_LOG = process.env.SOL_CAIXA_SHADOW_OBSERVE_LOG || path.join(PROFILE_DIR, 'logs/whatsapp-group-observe.jsonl');
const OFFSET_FILE = process.env.SOL_CAIXA_SHADOW_OFFSET || '/home/sol/.openclaw/workspace/memory/sol-caixa-v3-shadow-worker.offset.json';
const LOG_FILE = process.env.SOL_CAIXA_SHADOW_LOG || '/home/sol/.openclaw/workspace/memory/sol-caixa-v3-shadow-worker.log';
const CAIXA_MODULE = process.env.SOL_CAIXA_MODULE || path.join(PROFILE_DIR, 'caixa-ingestao/caixa-financeiro.cjs');
const ENV_FILE = process.env.SOL_ENV_FILE || path.join(PROFILE_DIR, '.env');
const DB_SECRET_FILE = process.env.SOL_CAIXA_DB_SECRET_FILE || '/home/sol/.openclaw/secrets/lareport-readonly.env';
const SESSION_DIR = process.env.SOL_CAIXA_SESSION_DIR || path.join(PROFILE_DIR, 'whatsapp/session');
const INTERVAL_MS = Number(process.env.SOL_CAIXA_SHADOW_INTERVAL_MS || 2000);
const START_TAIL = Number(process.env.SOL_CAIXA_SHADOW_START_TAIL || 0);
const ONCE = process.argv.includes('--once');
const ONCE_TAIL_ARG = process.argv.find((arg) => arg.startsWith('--once-tail='));
const ONCE_TAIL = ONCE_TAIL_ARG ? Number(ONCE_TAIL_ARG.split('=')[1] || 0) : 0;

function log(event, data = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...data });
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `${line}\n`);
  } catch (_) {}
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function md5(value) {
  return crypto.createHash('md5').update(String(value || '')).digest('hex');
}

function loadEnv(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (process.env[key] == null) process.env[key] = val;
    }
  } catch (err) {
    log('env_load_error', { file, msg: err.message });
  }
}

function financeGroupMap() {
  const grupos = {};
  String(process.env.SOL_CAIXA_FINANCE_GROUPS || '').split(';').forEach((entry) => {
    const p = entry.split('|');
    if (p[0] && p[1]) grupos[p[0].trim()] = { chat_id: p[0].trim(), unidade_id: p[1].trim(), nome: (p[2] || '').trim() || 'Caixa' };
  });
  return grupos;
}

function readOffset() {
  try {
    return JSON.parse(fs.readFileSync(OFFSET_FILE, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeOffset(offset) {
  fs.mkdirSync(path.dirname(OFFSET_FILE), { recursive: true });
  fs.writeFileSync(OFFSET_FILE, `${JSON.stringify({ offset, updated_at: new Date().toISOString() }, null, 2)}\n`);
}

function startOffsetForTail(file, n) {
  if (!n) return fs.existsSync(file) ? fs.statSync(file).size : 0;
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split(/\n/);
  const selected = lines.slice(Math.max(0, lines.length - n - 1)).join('\n');
  return Buffer.byteLength(raw.slice(0, raw.length - selected.length));
}

function readNewLines() {
  if (!fs.existsSync(OBSERVE_LOG)) return { lines: [], nextOffset: 0 };
  const size = fs.statSync(OBSERVE_LOG).size;
  let offset = readOffset()?.offset;
  if (offset == null) offset = startOffsetForTail(OBSERVE_LOG, START_TAIL);
  if (ONCE_TAIL > 0) offset = startOffsetForTail(OBSERVE_LOG, ONCE_TAIL);
  if (offset > size) offset = 0;
  if (offset === size) return { lines: [], nextOffset: size };
  const fd = fs.openSync(OBSERVE_LOG, 'r');
  const buf = Buffer.alloc(size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  const text = buf.toString('utf8');
  const complete = text.endsWith('\n');
  const parts = text.split(/\n/);
  const lines = (complete ? parts : parts.slice(0, -1)).filter(Boolean);
  const nextOffset = complete ? size : size - Buffer.byteLength(parts[parts.length - 1] || '');
  return { lines, nextOffset };
}

function psqlJson(sql) {
  const shell = `
set -euo pipefail
tmp_sql="$(mktemp)"
trap 'rm -f "$tmp_sql"' EXIT
cat > "$tmp_sql"
set -a
. "${DB_SECRET_FILE}"
set +a
PGPASSWORD="$LA_REPORT_READONLY_PASSWORD" psql -X -q -t -A -v ON_ERROR_STOP=1 \\
  -h "$LA_REPORT_READONLY_HOST" \\
  -p "$LA_REPORT_READONLY_PORT" \\
  -U "$LA_REPORT_READONLY_POOLER_USER" \\
  -d "$LA_REPORT_READONLY_DB" \\
  -f "$tmp_sql"
`;
  const res = spawnSync('bash', ['-lc', shell], { input: sql, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (res.status !== 0) throw new Error((res.stderr || res.stdout || '').trim());
  const out = res.stdout.trim();
  if (!out) return null;
  return JSON.parse(out.split('\n').filter(Boolean).at(-1));
}

function sqlString(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function compactResult(result) {
  if (!result || typeof result !== 'object') return result || null;
  const allowed = ['acao', 'previewId', 'movimentacao_id', 'motivo', 'valor', 'forma', 'aluno', 'categoria', 'total', 'partes'];
  const out = {};
  for (const key of allowed) {
    if (result[key] != null) out[key] = result[key];
  }
  return Object.keys(out).length ? out : { acao: result.acao || 'unknown' };
}

const telefonePorRemetente = new Map();
function resolverTelefoneDoRemetente(senderId) {
  const bruto = String(senderId || '');
  if (!bruto) return null;
  if (telefonePorRemetente.has(bruto)) return telefonePorRemetente.get(bruto);

  let telefone = null;
  const id = bruto.replace(/@.*/, '').split(':')[0];
  if (bruto.includes('@lid')) {
    if (/^\d+$/.test(id)) {
      try {
        const conteudo = fs.readFileSync(path.join(SESSION_DIR, `lid-mapping-${id}_reverse.json`), 'utf8');
        const valor = JSON.parse(conteudo);
        if (typeof valor === 'string') {
          const digitos = valor.replace(/\D/g, '');
          if (/^\d{10,15}$/.test(digitos)) telefone = digitos;
        }
      } catch (_) {}
    }
  } else if (/^\d{10,15}$/.test(id)) {
    telefone = id;
  }

  telefonePorRemetente.set(bruto, telefone);
  return telefone;
}

function shouldRegister(result, captured) {
  const acao = result && result.acao;
  if (captured.length > 0) return true;
  return !!acao && !['nada', 'ignorado_fora_grupo', 'dup_ignorada', 'lote_midia_anexada', 'lote_texto_anexado'].includes(acao);
}

let handler = null;
let currentCapture = null;
function getHandler(grupos) {
  if (handler) return handler;
  const mod = require(CAIXA_MODULE);
  handler = mod.criarHandlerFinanceiro({
    grupos,
    dryRun: true,
    sendFn: async (chatId, text) => {
      if (currentCapture) {
        currentCapture.push({ chatIdHash: md5(chatId), text: String(text || '').slice(0, 4000), textSha256: sha256(text) });
      }
      return `shadow-${sha256(`${chatId}:${text}:${Date.now()}`).slice(0, 24)}`;
    },
    lancarFn: async () => ({ ok: true, dry_run: true }),
    lancarSaidaFn: async () => ({ ok: true, dry_run: true }),
    corrigirFormaFn: async () => ({ ok: true, dry_run: true }),
    log: (o) => log('handler_log', { data: o }),
  });
  return handler;
}

async function processEvent(evento) {
  const grupos = financeGroupMap();
  if (!grupos[evento.chatId]) return { skipped: 'not_finance_group' };

  const captured = [];
  const perEventHandler = getHandler(grupos);
  const senderPhone = resolverTelefoneDoRemetente(evento.senderId);
  let result;
  currentCapture = captured;
  try {
    result = await perEventHandler.handle({
      messageId: evento.messageId,
      chatId: evento.chatId,
      senderId: evento.senderId,
      senderName: evento.senderName,
      senderPhone,
      chatName: evento.chatName,
      isGroup: true,
      body: evento.body || '',
      hasMedia: !!evento.hasMedia,
      mediaType: evento.mediaType || '',
      mediaUrls: Array.isArray(evento.mediaUrls) ? evento.mediaUrls : [],
      timestamp: evento.timestamp,
    });
  } finally {
    currentCapture = null;
  }

  if (!shouldRegister(result, captured)) return { skipped: 'not_actionable', result: compactResult(result) };

  const firstPreview = captured[0] || null;
  const payload = {
    event_id_hash: sha256(evento.messageId),
    chat_id_hash: md5(evento.chatId),
    sender_id_hash: sha256(evento.senderId),
    unidade_id: grupos[evento.chatId]?.unidade_id || '',
    observed_at: evento.ts || new Date(Number(evento.timestamp || Date.now()) * 1000).toISOString(),
    source: 'sol_whatsapp_group_observe_jsonl',
    mode: 'shadow_inline_continuous_worker',
    status: captured.length ? 'would_preview_private_shadow_only' : 'observed_action_private_shadow_only',
    raw_ref: {
      body_sha256: sha256(evento.body || ''),
      message_id_sha256: sha256(evento.messageId),
      has_media: !!evento.hasMedia,
      media_type: evento.mediaType || null
    },
    resolver_json: {
      resolver: 'caixa-financeiro.cjs dry_run/no_outbound',
      handler_result: compactResult(result),
      identity: {
        lid_resolved_to_phone: !!senderPhone,
        phone_sha256: senderPhone ? sha256(senderPhone) : null
      },
      captured_messages_count: captured.length,
      captured_message_hashes: captured.map((item) => item.textSha256)
    },
    warnings: ['continuous shadow worker only; no WhatsApp outbound; no financial write'],
    blocks: [],
    preview_hash: sha256(JSON.stringify({ result: compactResult(result), captured })),
    operacao: result?.acao || 'observed',
    categoria: result?.categoria || result?.category || result?.acao || 'unknown',
    valor_centavos: result?.valor != null ? String(Math.round(Number(result.valor) * 100)) : '',
    forma: result?.forma || 'unknown',
    preview_status: 'shadow_private_not_sent',
    preview_json: {
      text_not_sent: true,
      first_text: firstPreview ? firstPreview.text : null,
      captured_count: captured.length,
      handler_result: compactResult(result)
    }
  };

  const sql = `select public.sol_caixa_shadow_registrar(${sqlString(JSON.stringify(payload))}::jsonb)::text;`;
  const registered = psqlJson(sql);
  return { registered, result: compactResult(result), captured: captured.length };
}

async function tick() {
  const { lines, nextOffset } = readNewLines();
  let processed = 0, registered = 0, skipped = 0, errors = 0;
  for (const line of lines) {
    let evento;
    try {
      evento = JSON.parse(line);
      if (evento.event !== 'group_observed') { skipped++; continue; }
      const r = await processEvent(evento);
      processed++;
      if (r.registered?.ok) registered++;
      else skipped++;
      log('processed', { messageIdHash: sha256(evento.messageId).slice(0, 16), status: r.registered?.ok ? 'registered' : 'skipped', detail: r.skipped || r.result?.acao || null });
    } catch (err) {
      errors++;
      log('process_error', { msg: err.message });
    }
  }
  if (errors === 0) writeOffset(nextOffset);
  if (lines.length || ONCE) log('tick', { lines: lines.length, processed, registered, skipped, errors, nextOffset });
}

async function main() {
  loadEnv(ENV_FILE);
  log('start', { observeLog: OBSERVE_LOG, offsetFile: OFFSET_FILE, once: ONCE, onceTail: ONCE_TAIL, startTail: START_TAIL });
  do {
    await tick();
    if (ONCE) break;
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  } while (true);
}

main().catch((err) => {
  log('fatal', { msg: err.message, stack: String(err.stack || '').slice(0, 800) });
  process.exit(1);
});
