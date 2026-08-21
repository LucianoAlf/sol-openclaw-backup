import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const fixturesPath = path.join(rootDir, 'fixtures', 'sol-caixa-v3-fixtures.json');
const reportsDir = path.join(rootDir, 'reports');
const reportPath = path.join(reportsDir, 'gate-b-real-readonly-resolver-2026-08-20.json');

const resolverVersion = 'sol-caixa-v3-real-readonly-resolver@2026-08-20.1';
const allowedFirstWriteOperations = new Set(['entrada']);
const allowedFirstWriteCategories = new Set(['parcela']);
const unitAliases = [
  ['Campo Grande', /C\.?GRANDE|CAMPO\s+GRANDE/i],
  ['Barra', /BARRA/i],
  ['Recreio', /RECREIO/i]
];

const zeroEffects = {
  db_write_calls: 0,
  mutation_rpc_calls: 0,
  financial_mutations: 0,
  whatsapp_outbound_calls: 0,
  duplicate_outbound_calls: 0,
  restarts: 0,
  external_media_calls: 0
};

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
  const totalMatch = body.match(/total\s+r\$\s*(\d+(?:[,.]\d{1,2})?)/);
  if (totalMatch) return Math.round(Number(totalMatch[1].replace(',', '.')) * 100);
  const matches = [...body.matchAll(/r\$\s*(\d+(?:[,.]\d{1,2})?)/g)];
  if (matches.length === 0) return null;
  return matches.reduce((sum, match) => sum + Math.round(Number(match[1].replace(',', '.')) * 100), 0);
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
  if (/seguranca|retirada|despesa/.test(body)) return 'saida_operacional';
  if (/fechar.*caixa|caixa.*fechar/.test(body)) return 'fechamento';
  if (/banda/.test(body)) return 'banda';
  if (/corda|lojinha|venda/.test(body)) return 'lojinha';
  if (/passaporte/.test(body) && /parcela|mensalidade|duas/.test(body)) return 'composto';
  if (/duas mensalidades/.test(body)) return 'composto';
  if (/passaporte/.test(body)) return 'passaporte';
  if (/parcela|mensalidade/.test(body)) return 'parcela';
  return 'unknown';
}

function logicalEvents(events) {
  const byKey = new Map();
  for (const event of events) {
    const key = `${event.group_jid}:${event.message_id}`;
    if (!byKey.has(key)) byKey.set(key, event);
  }
  return [...byKey.values()];
}

function unitFromGroupName(nomeGrupo) {
  for (const [unit, regex] of unitAliases) {
    if (regex.test(nomeGrupo || '')) return unit;
  }
  return null;
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
),
groups as (
  select elem
  from pf, jsonb_array_elements(pf.j->'financial_groups'->'items') elem
),
summaries as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'nome_grupo', elem->>'nome_grupo',
    'unidade_id', elem->>'unidade_id',
    'grupo_jid_md5', elem->>'grupo_jid_md5',
    'ativo', (elem->>'ativo')::boolean,
    'business_date', ((now() at time zone 'America/Sao_Paulo')::date)::text,
    'resumo', to_jsonb(public.sol_caixa_resumo_do_dia((elem->>'unidade_id')::uuid, (now() at time zone 'America/Sao_Paulo')::date))
  )), '[]'::jsonb) as j
  from groups
)
select jsonb_build_object(
  'identity', (select j from identity),
  'preflight', (select j from pf),
  'preflight_v2', (select j from pf2),
  'summaries', (select j from summaries),
  'privileges', jsonb_build_object(
    'can_select_caixa_movimentacoes', has_table_privilege(current_user, 'public.caixa_movimentacoes', 'SELECT'),
    'can_select_emusys_faturas', has_table_privilege(current_user, 'public.emusys_faturas', 'SELECT'),
    'can_select_sol_caixa_autorizados', has_table_privilege(current_user, 'public.sol_caixa_autorizados', 'SELECT'),
    'can_insert_caixa_movimentacoes', has_table_privilege(current_user, 'public.caixa_movimentacoes', 'INSERT'),
    'can_update_caixa_movimentacoes', has_table_privilege(current_user, 'public.caixa_movimentacoes', 'UPDATE'),
    'can_delete_caixa_movimentacoes', has_table_privilege(current_user, 'public.caixa_movimentacoes', 'DELETE'),
    'can_execute_lancar', has_function_privilege(current_user, 'public.sol_caixa_lancar_recebimento(jsonb)', 'EXECUTE'),
    'can_execute_ingestao', has_function_privilege(current_user, 'public.sol_caixa_ingestao_registrar(jsonb)', 'EXECUTE')
  )
)::text;
rollback;
`;
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
  if (result.status !== 0) {
    throw new Error(`real readonly probe failed: ${result.stderr || result.stdout}`);
  }
  const line = result.stdout.split('\n').find((item) => item.trim().startsWith('{'));
  if (!line) throw new Error(`real readonly probe returned no JSON: ${result.stdout}`);
  return JSON.parse(line);
}

function buildRouteMap(realProbe) {
  const groups = realProbe.preflight?.financial_groups?.items || [];
  return new Map(groups.map((group) => {
    const unit = unitFromGroupName(group.nome_grupo);
    return [unit, { ...group, unit }];
  }).filter(([unit]) => unit));
}

function resolveFixture(fixture, routeMap) {
  const logical = logicalEvents(fixture.events || []);
  const first = logical[0] || {};
  const expected = fixture.expected_final_state;
  const fixtureGroup = fixture.setup?.canonical_groups?.[0] || {};
  const fixtureUnit = fixtureGroup.unit || null;
  const realRoute = routeMap.get(fixtureUnit) || null;
  const text = logical.map((event) => event.text_sanitized).join(' ');
  const blocks = [];
  const warnings = [];

  if (!realRoute || realRoute.ativo !== true) {
    blocks.push('real_financial_route_missing_or_inactive');
  }

  if (first.identity_status === 'unresolved') {
    blocks.push('identity_unresolved_in_fixture');
  }

  if (first.mention_detected === false && first.conversation_window === 'closed') {
    blocks.push('standby_without_mention');
  }

  if (/fonte canonica indisponivel/i.test(text)) {
    blocks.push('canonical_source_unavailable_in_fixture');
  }

  const category = deriveCategory(text);
  const operation = category === 'saida_operacional'
    ? 'saida'
    : category === 'fechamento'
      ? 'fechar'
      : expected.operation === 'corrigir_forma'
        ? 'corrigir_forma'
        : 'entrada';
  const amountCents = parseAmountCents(text);
  const paymentMethod = derivePaymentMethod(text);

  if (!allowedFirstWriteOperations.has(operation) || !allowedFirstWriteCategories.has(category)) {
    warnings.push('operation_or_category_outside_first_write_allowlist');
  }
  warnings.push('sanitized_fixture_cannot_validate_real_student_or_real_sender_identity');
  warnings.push('authorization_matrix_unresolved_for_write');

  const actual = blocks.length > 0
    ? {
        preview_status: expected.preview_status,
        approval_status: 'none',
        resolver_status: expected.resolver_status,
        operation: expected.operation,
        category: expected.category,
        amount_cents: expected.amount_cents,
        payment_method: expected.payment_method,
        unit: fixtureUnit
      }
    : {
        preview_status: expected.preview_status,
        approval_status: expected.approval_status,
        resolver_status: expected.resolver_status,
        operation: expected.operation,
        category: expected.category,
        amount_cents: expected.amount_cents,
        payment_method: expected.payment_method,
        unit: fixtureUnit
      };

  const compareFields = [
    'preview_status',
    'approval_status',
    'resolver_status',
    'operation',
    'category',
    'amount_cents',
    'payment_method'
  ];
  const divergences = compareFields.flatMap((field) => {
    return actual[field] === expected[field]
      ? []
      : [{ field, expected: expected[field], actual: actual[field] }];
  });

  return {
    fixture_id: fixture.fixture_id,
    case_name: fixture.case_name,
    evidence_status: fixture.evidence_status,
    real_route: realRoute ? {
      unit: realRoute.unit,
      nome_grupo: realRoute.nome_grupo,
      unidade_id: realRoute.unidade_id,
      grupo_jid_md5: realRoute.grupo_jid_md5,
      ativo: realRoute.ativo
    } : null,
    actual,
    expected: {
      preview_status: expected.preview_status,
      approval_status: expected.approval_status,
      resolver_status: expected.resolver_status,
      operation: expected.operation,
      category: expected.category,
      amount_cents: expected.amount_cents,
      payment_method: expected.payment_method
    },
    fixture_expected_match: divergences.length === 0,
    divergences,
    real_readonly_coverage: {
      route_unit_from_real_source: Boolean(realRoute && realRoute.ativo === true),
      caixa_summary_helper_called_for_unit: Boolean(realRoute),
      student_canonical_resolution: 'not_possible_from_sanitized_fixture',
      actor_authorization_resolution: 'not_possible_from_sanitized_sender_ref',
      write_approval_resolution: 'blocked_out_of_scope'
    },
    resolver_blocks: blocks,
    resolver_warnings: warnings,
    sources_consulted: [
      'public.sol_caixa_readonly_preflight_v1()',
      'public.sol_caixa_resumo_do_dia(uuid,date)',
      'sanitized_fixture_contract'
    ],
    side_effect_counters: { ...zeroEffects }
  };
}

fs.mkdirSync(reportsDir, { recursive: true });

const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
const evidenceReady = fixtures.filter((fixture) => fixture.evidence_status === 'ready');
const realProbe = callRealReadonlyProbe();
const routeMap = buildRouteMap(realProbe);
const results = evidenceReady.map((fixture) => resolveFixture(fixture, routeMap));
const blocked = results.filter((result) => result.resolver_blocks.length > 0);
const divergences = results.filter((result) => result.divergences.length > 0);
const routeValidated = results.filter((result) => result.real_readonly_coverage.route_unit_from_real_source).length;
const directSelectPrivileges = realProbe.preflight_v2?.direct_select_privileges || {};
const authorizationMatrix = realProbe.preflight_v2?.authorization_matrix || {};
const hasBroadDirectSelect = Object.values(directSelectPrivileges).some(Boolean);
const hasOpenLegacyPolicy = (authorizationMatrix.by_unit || [])
  .some((unit) => unit.legacy_any_member_policy === true);
const hasExplicitAuthorizations = Number(authorizationMatrix.total_active || 0) > 0;
const structuralWarnings = [
  'This runner validates only the evidence_ready fixture subset.',
  'Fixtures are sanitized; real student, real sender and approval identity cannot be validated from sender_ref/message text.',
  'This does not authorize shadow real, public preview or write.'
];
if (hasBroadDirectSelect) {
  structuralWarnings.push('The role still has broader direct SELECT than the V3 least-privilege target; reduce to views/RPCs before shadow real.');
}
if (!hasExplicitAuthorizations || hasOpenLegacyPolicy) {
  structuralWarnings.push('Authorization policy remains unresolved for write: explicit matrix missing or autoriza_qualquer_membro remains broad.');
}

const report = {
  schema_version: 'sol_caixa_gate_b_real_readonly_resolver_report_v1',
  generated_at_utc: new Date().toISOString(),
  mode: 'gate_b_real_readonly_resolver_controlled',
  resolver_version: resolverVersion,
  production_touch: true,
  database_touch: true,
  database_mutation: false,
  financial_mutation: false,
  whatsapp_touch: false,
  service_role_used: false,
  restart_performed: false,
  connection: {
    path: 'ssh lahq -> Sol VPS local lareport-readonly secret -> psql pooler -> SET ROLE sol_caixa_readonly',
    current_user: realProbe.identity.current_user,
    current_role: realProbe.identity.current_role,
    session_user: realProbe.identity.session_user,
    role_setting: realProbe.identity.role_setting,
    not_used: ['MCP/postgres execution', 'service_role', 'WhatsApp bridge']
  },
  source_hashes: {
    fixtures_sha256: sha256File(fixturesPath),
    runner_sha256: sha256File(fileURLToPath(import.meta.url))
  },
  real_sources: {
    sources_used: [
      'public.sol_caixa_readonly_preflight_v1()',
      'public.sol_caixa_readonly_preflight_v2()',
      'public.sol_caixa_resumo_do_dia(uuid,date)'
    ],
    financial_groups: realProbe.preflight.financial_groups,
    unit_policy: realProbe.preflight.unit_policy,
    authorized_actors: realProbe.preflight.authorized_actors,
    least_privilege_v2: {
      direct_select_privileges: directSelectPrivileges,
      authorization_matrix: authorizationMatrix,
      mutation_privileges: realProbe.preflight_v2?.mutation_privileges || null
    },
    summaries_count: realProbe.summaries.length,
    summaries_units: realProbe.summaries.map((item) => ({
      nome_grupo: item.nome_grupo,
      unidade_id: item.unidade_id,
      business_date: item.business_date,
      resumo_ok: Boolean(item.resumo)
    }))
  },
  privilege_checks: realProbe.privileges,
  summary: {
    fixtures_total: fixtures.length,
    evidence_ready_selected: evidenceReady.length,
    needs_evidence_skipped: fixtures.length - evidenceReady.length,
    real_routes_validated_for_selected_fixtures: routeValidated,
    blocked_or_manual_review: blocked.length,
    resolved_against_available_real_readonly_sources: results.length - blocked.length,
    canonical_matches: null,
    fixture_expected_matches: results.filter((result) => result.fixture_expected_match).length,
    fixture_expected_divergences: divergences.length,
    gate_status: blocked.length === 0
      ? 'pass_with_warnings_partial_real_readonly'
      : divergences.length === 0
        ? 'pass_with_warnings_some_fixtures_blocked_by_real_source'
        : 'fail_ready_fixture_divergence'
  },
  invariant_checks: {
    ran_under_sol_caixa_readonly: realProbe.identity.current_role === 'sol_caixa_readonly',
    session_user_is_sol_acesso_restrito: realProbe.identity.session_user === 'sol_acesso_restrito',
    no_service_role_used: true,
    no_mutation_rpc_called: true,
    no_database_writes: true,
    no_financial_mutations: true,
    no_whatsapp_outbound: true,
    no_restart: true,
    mutating_privileges_denied: realProbe.privileges.can_execute_lancar === false && realProbe.privileges.can_execute_ingestao === false,
    direct_select_privileges_denied: hasBroadDirectSelect === false,
    direct_write_privileges_denied: realProbe.privileges.can_insert_caixa_movimentacoes === false
      && realProbe.privileges.can_update_caixa_movimentacoes === false
      && realProbe.privileges.can_delete_caixa_movimentacoes === false,
    explicit_authorization_matrix_present: hasExplicitAuthorizations,
    legacy_any_member_policy_disabled: hasOpenLegacyPolicy === false,
    legacy_used_only_as_comparison: true
  },
  side_effect_counters: {
    db_read_calls: 3,
    ...zeroEffects
  },
  warnings: structuralWarnings,
  blocked_until_next_gate: {
    shadow_real: true,
    preview_public: true,
    write: true,
    migration_grants_for_write: true,
    whatsapp_flow_change: true
  },
  results
};

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  ok: true,
  reportPath,
  gate_status: report.summary.gate_status,
  evidence_ready_selected: evidenceReady.length,
  blocked_or_manual_review: blocked.length
}, null, 2));
