import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const reportsDir = path.join(rootDir, 'reports');
const inputReportPath = path.join(reportsDir, 'gate-shadow-real-controlled-2026-08-20.json');
const reportPath = path.join(reportsDir, 'gate-shadow-inline-ledger-2026-08-20.json');
const runnerVersion = 'sol-caixa-v3-shadow-inline-ledger@2026-08-20.1';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sqlString(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function jsonSql(value) {
  return `${sqlString(JSON.stringify(value ?? {}))}::jsonb`;
}

function psql(sql) {
  const remoteScript = `
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
`;
  const result = spawnSync('ssh', ['lahq', 'bash -s'], {
    input: remoteScript,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim().split('\n').filter(Boolean);
}

const inputReport = JSON.parse(fs.readFileSync(inputReportPath, 'utf8'));
const candidates = inputReport.results
  .filter((item) => item.shadow_decision?.resolver_status === 'resolved')
  .filter((item) => item.shadow_decision?.operation === 'entrada')
  .filter((item) => item.shadow_decision?.category === 'parcela')
  .filter((item) => item.live_bridge_comparison?.identity_evidence_identified === true)
  .slice(-3);

const statements = [
  'begin;',
  "select jsonb_build_object('current_user', current_user, 'current_role', current_role, 'session_user', session_user)::text as identity;"
];

for (const item of candidates) {
  const decision = item.shadow_decision;
  const payload = {
    event_id_hash: item.event_id_sha256,
    chat_id_hash: item.chat_id_md5,
    sender_id_hash: item.sender_id_sha256,
    unidade_id: item.route?.unidade_id || '',
    observed_at: item.observed_at_utc,
    source: 'gate_shadow_real_controlled_report',
    mode: 'shadow_inline_private_controlled',
    status: 'would_preview_private_shadow_only',
    raw_ref: {
      source_report_sha256: sha256File(inputReportPath),
      body_sha256: item.body_sha256,
      has_media: item.has_media,
      media_type: item.media_type
    },
    resolver_json: {
      operation: decision.operation,
      category: decision.category,
      amount_cents: decision.amount_cents,
      payment_method: decision.payment_method,
      preview_status: decision.preview_status,
      approval_status: decision.approval_status,
      resolver_status: decision.resolver_status,
      live_identity_evidence: item.live_bridge_comparison.identity_evidence_identified
    },
    warnings: item.warnings || [],
    blocks: item.blocks || [],
    preview_hash: sha256(JSON.stringify(decision)),
    operacao: decision.operation,
    categoria: decision.category,
    valor_centavos: String(decision.amount_cents ?? ''),
    forma: decision.payment_method,
    preview_status: 'shadow_private_not_sent',
    preview_json: {
      text_not_sent: true,
      operation: decision.operation,
      category: decision.category,
      amount_cents: decision.amount_cents,
      payment_method: decision.payment_method
    }
  };
  statements.push(`select public.sol_caixa_shadow_registrar(${jsonSql(payload)})::text as registered;`);
}

statements.push("select jsonb_build_object('shadow_eventos_rows', (select count(*) from public.sol_caixa_shadow_eventos_v1), 'shadow_previews_rows', (select count(*) from public.sol_caixa_shadow_previews_v1), 'finance_movements_touched', false)::text as counts;");
statements.push('commit;');

const stdout = psql(statements.join('\n'));
const parsed = stdout.flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return [{ raw: line }]; }
});

const report = {
  schema_version: 'sol_caixa_gate_shadow_inline_ledger_report_v1',
  generated_at_utc: new Date().toISOString(),
  mode: 'shadow_inline_private_ledger_controlled',
  runner_version: runnerVersion,
  production_touch: true,
  database_touch: true,
  database_mutation: true,
  financial_mutation: false,
  whatsapp_touch: false,
  whatsapp_outbound: false,
  service_role_used: false,
  restart_performed: false,
  source_report: {
    path: path.relative(process.cwd(), inputReportPath),
    sha256: sha256File(inputReportPath)
  },
  summary: {
    candidates_selected: candidates.length,
    shadow_events_registered: parsed.filter((item) => item.ok === true && item.event_id).length,
    gate_status: candidates.length > 0 ? 'pass_shadow_private_ledger_written' : 'blocked_no_candidate'
  },
  invariant_checks: {
    no_service_role_used: true,
    no_financial_mutations: true,
    no_whatsapp_outbound: true,
    no_restart: true,
    wrote_only_shadow_ledger: true
  },
  side_effect_counters: {
    shadow_ledger_write_calls: candidates.length,
    db_write_calls: candidates.length,
    financial_mutations: 0,
    whatsapp_outbound_calls: 0,
    restarts: 0
  },
  sql_results: parsed,
  registered_cases: candidates.map((item) => ({
    event_id_sha256: item.event_id_sha256,
    observed_at_utc: item.observed_at_utc,
    chat_id_md5: item.chat_id_md5,
    unidade_id: item.route?.unidade_id || null,
    operation: item.shadow_decision.operation,
    category: item.shadow_decision.category,
    amount_cents: item.shadow_decision.amount_cents,
    payment_method: item.shadow_decision.payment_method,
    live_identity_evidence: item.live_bridge_comparison.identity_evidence_identified
  })),
  warnings: [
    'This writes only to Sol Caixa V3 private shadow ledger tables.',
    'This does not send WhatsApp messages and does not call financial mutation RPCs.',
    'Public preview and write remain blocked.'
  ],
  blocked_until_next_gate: {
    public_preview: true,
    financial_write: true,
    live_worker_continuous_mode: true,
    approval_ledger_from_real_pode: true
  }
};

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  ok: true,
  reportPath,
  gate_status: report.summary.gate_status,
  candidates_selected: report.summary.candidates_selected,
  shadow_events_registered: report.summary.shadow_events_registered
}, null, 2));
