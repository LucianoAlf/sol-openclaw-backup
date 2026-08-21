import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const reportsDir = path.join(rootDir, 'reports');
const reportPath = path.join(reportsDir, 'gate-shadow-real-controlled-2026-08-20.json');
const resolverVersion = 'sol-caixa-v3-shadow-real-controlled@2026-08-20.1';

const zeroEffects = {
  db_write_calls: 0,
  mutation_rpc_calls: 0,
  financial_mutations: 0,
  whatsapp_outbound_calls: 0,
  duplicate_outbound_calls: 0,
  restarts: 0,
  external_media_calls: 0
};

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function parseAmountCents(text) {
  const body = normalize(text);
  const matches = [
    ...[...body.matchAll(/r\$\s*(\d+(?:[,.]\d{1,2})?)/g)].map((match) => match[1]),
    ...[...body.matchAll(/\b(\d+(?:[,.]\d{1,2})?)\s*(?:reais|real)\b/g)].map((match) => match[1])
  ].filter((raw) => {
    const n = Number(raw.replace(',', '.'));
    return Number.isFinite(n) && n > 0 && n < 100000;
  });
  if (matches.length === 0) return null;
  return matches.reduce((sum, raw) => sum + Math.round(Number(raw.replace(',', '.')) * 100), 0);
}

function derivePaymentMethod(text) {
  const body = normalize(text);
  if (/\bpix\b/.test(body)) return 'pix';
  if (/\bdinheiro\b/.test(body)) return 'dinheiro';
  if (/cartao.*debito|debito/.test(body)) return 'cartao_debito';
  if (/cartao.*credito|credito/.test(body)) return 'cartao_credito';
  return 'unknown';
}

function deriveCategory(text) {
  const body = normalize(text);
  if (/retirada|direcao|despesa|seguranca/.test(body)) return 'saida_operacional';
  if (/corda|palheta|baqueta|capotraste|afinador|cabo|lojinha/.test(body)) return 'lojinha';
  if (/passaporte/.test(body) && /parcela|mensalidade/.test(body)) return 'composto';
  if (/passaporte/.test(body)) return 'passaporte';
  if (/parcela|mensalidade/.test(body)) return 'parcela';
  return 'unknown';
}

function deriveOperation(category) {
  if (category === 'saida_operacional') return 'saida';
  return 'entrada';
}

function monthCount(text) {
  const body = normalize(text);
  const numeric = [...body.matchAll(/\b(?:0?[1-9]|1[0-2])\/(?:20)?26\b/g)].length;
  const named = [...body.matchAll(/\b(agosto|setembro|outubro|novembro|dezembro)\b/g)].length;
  return Math.max(numeric, named);
}

function callRemoteJson(script) {
  const result = spawnSync('ssh', ['lahq', 'bash -s'], {
    input: script,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  const line = result.stdout.split('\n').find((item) => item.trim().startsWith('{') || item.trim().startsWith('['));
  if (!line) throw new Error(`remote command returned no JSON: ${result.stdout}`);
  return JSON.parse(line);
}

function callRealReadonlyProbe() {
  const sql = `
begin read only;
set role sol_caixa_readonly;
with identity as (
  select jsonb_build_object(
    'current_user', current_user,
    'current_role', current_role,
    'session_user', session_user,
    'role_setting', current_setting('role', true)
  ) as j
),
pf as (
  select public.sol_caixa_readonly_preflight_v1() as j
),
pf2 as (
  select public.sol_caixa_readonly_preflight_v2() as j
)
select jsonb_build_object(
  'identity', (select j from identity),
  'preflight', (select j from pf),
  'preflight_v2', (select j from pf2),
  'privileges', jsonb_build_object(
    'can_select_caixa_movimentacoes', has_table_privilege(current_user, 'public.caixa_movimentacoes', 'SELECT'),
    'can_select_emusys_faturas', has_table_privilege(current_user, 'public.emusys_faturas', 'SELECT'),
    'can_select_sol_caixa_autorizados', has_table_privilege(current_user, 'public.sol_caixa_autorizados', 'SELECT'),
    'can_insert_caixa_movimentacoes', has_table_privilege(current_user, 'public.caixa_movimentacoes', 'INSERT'),
    'can_update_caixa_movimentacoes', has_table_privilege(current_user, 'public.caixa_movimentacoes', 'UPDATE'),
    'can_delete_caixa_movimentacoes', has_table_privilege(current_user, 'public.caixa_movimentacoes', 'DELETE'),
    'can_execute_lancar_recebimento', has_function_privilege(current_user, 'public.sol_caixa_lancar_recebimento(jsonb)', 'EXECUTE'),
    'can_execute_lancar_saida', has_function_privilege(current_user, 'public.sol_caixa_lancar_saida(jsonb)', 'EXECUTE'),
    'can_execute_ingestao', has_function_privilege(current_user, 'public.sol_caixa_ingestao_registrar(jsonb)', 'EXECUTE')
  )
)::text;
rollback;
`;
  return callRemoteJson(`
set -euo pipefail
tmp_sql="$(mktemp)"
trap 'rm -f "$tmp_sql"' EXIT
cat > "$tmp_sql" <<'SQL'
${sql}
SQL
set -a
. /home/sol/.openclaw/secrets/lareport-readonly.env
set +a
PGPASSWORD="$LA_REPORT_READONLY_PASSWORD" psql -X -q -t -A -v ON_ERROR_STOP=1 \\
  -h "$LA_REPORT_READONLY_HOST" \\
  -p "$LA_REPORT_READONLY_PORT" \\
  -U "$LA_REPORT_READONLY_POOLER_USER" \\
  -d "$LA_REPORT_READONLY_DB" \\
  -f "$tmp_sql"
`);
}

function fetchRecentRealSources() {
  return callRemoteJson(`
set -euo pipefail
node <<'NODE'
const fs = require('fs');
function readJsonl(path, max) {
  const lines = fs.existsSync(path) ? fs.readFileSync(path, 'utf8').trim().split(/\\n/).filter(Boolean).slice(-max) : [];
  return lines.flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
}
const observePath = '/home/sol/.hermes/profiles/sol/logs/whatsapp-group-observe.jsonl';
const caixaPath = '/home/sol/.hermes/profiles/sol/caixa-ingestao/caixa.log';
const observed = readJsonl(observePath, 250);
const caixa = readJsonl(caixaPath, 500);
console.log(JSON.stringify({ observed, caixa, observedPath: observePath, caixaPath }));
NODE
`);
}

function groupRouteForEvent(event, groups) {
  const groupMd5 = crypto.createHash('md5').update(String(event.chatId || '')).digest('hex');
  const route = (groups || []).find((item) => item.grupo_jid_md5 === groupMd5);
  return route ? { ...route, chat_id_md5: groupMd5 } : { chat_id_md5: groupMd5, ativo: false };
}

function liveActionsNear(caixa, event) {
  const t = Date.parse(event.ts);
  return (caixa || []).filter((item) => {
    const itemTime = Date.parse(item.ts);
    return Number.isFinite(itemTime) && Math.abs(itemTime - t) <= 45000;
  });
}

function buildShadowCases(observed, caixa, groups) {
  const candidates = observed
    .filter((event) => event.event === 'group_observed')
    .filter((event) => /sol|pg|parcela|pix|dinheiro|retirada|passaporte|lojinha|corda/i.test(event.body || '') || event.hasMedia)
    .slice(-30);

  const seen = new Set();
  const cases = [];
  for (const event of candidates) {
    if (seen.has(event.messageId)) continue;
    seen.add(event.messageId);
    const text = event.body || '';
    const category = deriveCategory(text);
    const operation = deriveOperation(category);
    const amountCents = parseAmountCents(text);
    const paymentMethod = derivePaymentMethod(text);
    const route = groupRouteForEvent(event, groups);
    const actions = liveActionsNear(caixa, event);
    const hasLivePreview = actions.some((item) => item.acao === 'preview_enviado');
    const hasLiveLaunch = actions.some((item) => item.acao === 'lancado');
    const liveIdentity = actions.some((item) => item.acao === 'identidade_envio' || item.acao === 'identidade_autorizacao')
      ? actions.find((item) => item.acao === 'identidade_envio' || item.acao === 'identidade_autorizacao')?.identificado === true
      : null;
    const blocks = [];
    const warnings = [];

    if (!route.ativo) blocks.push('real_financial_route_missing_or_inactive');
    if (event.senderId?.endsWith('@lid')) warnings.push('sender_is_lid_readonly_runner_cannot_map_to_canonical_phone_without_live_identity_evidence');
    if (operation !== 'entrada' || category !== 'parcela') warnings.push('operation_or_category_outside_first_write_allowlist');
    if (amountCents == null && category !== 'unknown') blocks.push('amount_not_detected');
    if (category === 'unknown') blocks.push('category_not_detected');
    if (monthCount(text) > 1) warnings.push('multiple_competencies_detected_requires_v3_compound_preview_ledger_before_write');

    cases.push({
      event_id_sha256: sha256(event.messageId),
      observed_at_utc: event.ts,
      chat_id_md5: route.chat_id_md5,
      sender_id_sha256: sha256(event.senderId),
      sender_name_observed: event.senderName || null,
      media_type: event.mediaType || null,
      has_media: Boolean(event.hasMedia),
      body_sha256: sha256(text),
      body_excerpt_sanitized: text.replace(/\s+/g, ' ').slice(0, 160),
      route: {
        nome_grupo: route.nome_grupo || null,
        unidade_id: route.unidade_id || null,
        ativo: route.ativo === true
      },
      shadow_decision: {
        operation,
        category,
        amount_cents: amountCents,
        payment_method: paymentMethod,
        preview_status: blocks.length ? 'blocked' : 'would_preview_private_shadow_only',
        approval_status: 'none',
        resolver_status: blocks.length ? 'blocked' : 'resolved'
      },
      live_bridge_comparison: {
        actions_seen_near_event: actions.map((item) => item.acao || item.step || 'unknown').slice(0, 12),
        identity_evidence_identified: liveIdentity,
        preview_sent_by_legacy: hasLivePreview,
        financial_write_observed_from_legacy: hasLiveLaunch
      },
      blocks,
      warnings
    });
  }
  return cases;
}

fs.mkdirSync(reportsDir, { recursive: true });
const realProbe = callRealReadonlyProbe();
const realSources = fetchRecentRealSources();
const groups = realProbe.preflight?.financial_groups?.items || [];
const results = buildShadowCases(realSources.observed, realSources.caixa, groups);
const selected = results.filter((item) => item.shadow_decision.resolver_status === 'resolved');
const blocked = results.filter((item) => item.shadow_decision.resolver_status === 'blocked');
const mutationPrivileges = realProbe.preflight_v2?.mutation_privileges || {};
const directSelect = realProbe.preflight_v2?.direct_select_privileges || {};
const authorizationMatrix = realProbe.preflight_v2?.authorization_matrix || {};

const report = {
  schema_version: 'sol_caixa_gate_shadow_real_controlled_report_v1',
  generated_at_utc: new Date().toISOString(),
  mode: 'shadow_real_controlled_readonly_retrospective',
  resolver_version: resolverVersion,
  production_touch: true,
  database_touch: true,
  database_mutation: false,
  financial_mutation: false,
  whatsapp_touch: false,
  whatsapp_outbound: false,
  service_role_used: false,
  restart_performed: false,
  connection: {
    path: 'ssh lahq -> Sol VPS logs + lareport-readonly secret -> psql pooler -> SET ROLE sol_caixa_readonly',
    current_user: realProbe.identity.current_user,
    current_role: realProbe.identity.current_role,
    session_user: realProbe.identity.session_user,
    role_setting: realProbe.identity.role_setting,
    not_used: ['service_role', 'WhatsApp outbound', 'mutation RPC', 'gateway restart']
  },
  real_sources: {
    sources_used: [
      'Sol whatsapp-group-observe.jsonl tail',
      'Sol caixa.log tail',
      'public.sol_caixa_readonly_preflight_v1()',
      'public.sol_caixa_readonly_preflight_v2()'
    ],
    source_files_sha256: {
      observed_path_sha256: sha256(realSources.observedPath),
      caixa_path_sha256: sha256(realSources.caixaPath)
    },
    observed_events_read: realSources.observed.length,
    caixa_events_read: realSources.caixa.length,
    financial_groups: realProbe.preflight.financial_groups,
    least_privilege_v2: {
      direct_select_privileges: directSelect,
      authorization_matrix: authorizationMatrix,
      mutation_privileges: mutationPrivileges
    }
  },
  summary: {
    real_events_evaluated: results.length,
    resolved_private_shadow_only: selected.length,
    blocked_or_manual_review: blocked.length,
    legacy_preview_events_seen: results.filter((item) => item.live_bridge_comparison.preview_sent_by_legacy).length,
    legacy_financial_writes_seen_near_events: results.filter((item) => item.live_bridge_comparison.financial_write_observed_from_legacy).length,
    gate_status: results.length > 0 && selected.length > 0
      ? 'pass_with_warnings_shadow_real_readonly_retrospective'
      : 'blocked_no_usable_real_event'
  },
  invariant_checks: {
    ran_under_sol_caixa_readonly: realProbe.identity.current_role === 'sol_caixa_readonly',
    session_user_is_sol_acesso_restrito: realProbe.identity.session_user === 'sol_acesso_restrito',
    no_service_role_used: true,
    no_mutation_rpc_called: true,
    no_database_writes: true,
    no_financial_mutations_by_runner: true,
    no_whatsapp_outbound_by_runner: true,
    no_restart: true,
    mutating_privileges_denied: mutationPrivileges.can_execute_ingestao === false
      && mutationPrivileges.can_execute_lancar_saida === false
      && mutationPrivileges.can_execute_lancar_recebimento === false,
    direct_select_privileges_denied: Object.values(directSelect).every((value) => value === false),
    explicit_authorization_matrix_present: Number(authorizationMatrix.total_active || 0) > 0,
    legacy_any_member_policy_disabled: (authorizationMatrix.by_unit || []).every((item) => item.legacy_any_member_policy === false)
  },
  side_effect_counters: {
    db_read_calls: 2,
    ...zeroEffects
  },
  warnings: [
    'Retrospective shadow reads already-observed live events; it does not inject, replay or answer WhatsApp.',
    'Some observed sender IDs are WhatsApp LID identifiers; canonical phone validation still depends on live identity evidence or a future LID-to-canonical mapping.',
    'This gate does not authorize public preview or write.'
  ],
  blocked_until_next_gate: {
    preview_public: true,
    write: true,
    live_shadow_inline_processing: true,
    persistent_preview_ledger: true,
    persistent_approval_ledger: true
  },
  results
};

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  ok: true,
  reportPath,
  gate_status: report.summary.gate_status,
  real_events_evaluated: report.summary.real_events_evaluated,
  resolved_private_shadow_only: report.summary.resolved_private_shadow_only,
  blocked_or_manual_review: report.summary.blocked_or_manual_review
}, null, 2));
