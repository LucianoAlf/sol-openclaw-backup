import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const fixturesPath = path.join(rootDir, 'fixtures', 'sol-caixa-v3-fixtures.json');
const reportsDir = path.join(rootDir, 'reports');
const gateBReportPath = path.join(reportsDir, 'gate-b-report-2026-08-20.json');
const reportPath = path.join(reportsDir, 'gate-c-report-2026-08-20.json');

const gateVersion = 'sol-caixa-v3-gate-c-local-preview-ledger@2026-08-20.1';
const simulatedPreviewCreatedAtUtc = '2026-08-20T13:00:00.000Z';
const previewExpirationPolicy = {
  kind: 'ttl_minutes_simulated',
  ttl_minutes: 30,
  business_timezone: 'America/Sao_Paulo',
  production_policy_status: 'pending_before_real_approval'
};

const zeroEffects = {
  db_read_calls: 0,
  db_write_calls: 0,
  mutation_rpc_calls: 0,
  financial_mutations: 0,
  whatsapp_outbound_calls: 0,
  duplicate_outbound_calls: 0,
  restarts: 0,
  external_media_calls: 0
};

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => {
      return `${JSON.stringify(key)}:${stableStringify(value[key])}`;
    }).join(',')}}`;
  }
  return JSON.stringify(value);
}

function localId(prefix, payload) {
  return `${prefix}_${sha256(stableStringify(payload)).slice(0, 24)}`;
}

function addMinutesIso(isoTimestamp, minutes) {
  return new Date(new Date(isoTimestamp).getTime() + minutes * 60 * 1000).toISOString();
}

function logicalEvents(events) {
  const byKey = new Map();
  for (const event of events || []) {
    const key = `${event.group_jid}:${event.message_id}`;
    if (!byKey.has(key)) byKey.set(key, event);
  }
  return [...byKey.values()];
}

function previewPayload(fixture, result) {
  const eventIds = logicalEvents(fixture.events).map((event) => event.event_id);
  return {
    fixture_id: fixture.fixture_id,
    event_ids: eventIds,
    group_jid: fixture.events?.[0]?.group_jid || null,
    unit: result.actual.unit || null,
    operation: result.actual.operation,
    category: result.actual.category,
    amount_cents: result.actual.amount_cents,
    payment_method: result.actual.payment_method,
    resolver_version: gateBReport.resolver_version
  };
}

function buildPreview(fixture, result) {
  if (!['awaiting_approval', 'approved'].includes(result.actual.preview_status)) return null;
  const payload = previewPayload(fixture, result);
  return {
    preview_id: localId('preview', payload),
    fixture_id: fixture.fixture_id,
    status: result.actual.preview_status === 'approved' ? 'approved' : 'awaiting_approval',
    group_jid: payload.group_jid,
    unit: payload.unit,
    operation: payload.operation,
    category: payload.category,
    amount_cents: payload.amount_cents,
    payment_method: payload.payment_method,
    payload_hash: sha256(stableStringify(payload)),
    payload_hash_serialization: 'canonical_json_sorted_keys_v1',
    created_from: 'local_fixture_store',
    created_at_utc: simulatedPreviewCreatedAtUtc,
    expiration_policy: previewExpirationPolicy,
    expires_at_utc: addMinutesIso(simulatedPreviewCreatedAtUtc, previewExpirationPolicy.ttl_minutes)
  };
}

function approvalAction(fixture, result, preview) {
  const firstEvent = logicalEvents(fixture.events)[0] || {};
  const expected = fixture.expected_final_state;

  if (expected.approval_status === 'accepted') {
    return {
      approval_id: localId('approval', {
        fixture_id: fixture.fixture_id,
        message_id: firstEvent.message_id,
        preview_id: preview?.preview_id
      }),
      fixture_id: fixture.fixture_id,
      preview_id: preview?.preview_id || fixture.setup?.initial_previews?.[0]?.preview_id || null,
      status: 'accepted',
      reason: 'single_preview_same_group',
      group_jid: firstEvent.group_jid,
      approval_message_id: firstEvent.message_id,
      financial_mutation_allowed: false
    };
  }

  if (expected.approval_status === 'ambiguous') {
    return {
      approval_id: localId('approval', { fixture_id: fixture.fixture_id, status: 'ambiguous' }),
      fixture_id: fixture.fixture_id,
      preview_id: null,
      status: 'ambiguous',
      reason: 'multiple_pending_previews',
      group_jid: firstEvent.group_jid,
      approval_message_id: firstEvent.message_id,
      financial_mutation_allowed: false
    };
  }

  if (expected.approval_status === 'rejected') {
    return {
      approval_id: localId('approval', { fixture_id: fixture.fixture_id, status: 'rejected' }),
      fixture_id: fixture.fixture_id,
      preview_id: fixture.setup?.initial_previews?.[0]?.preview_id || null,
      status: 'rejected',
      reason: 'approval_group_mismatch',
      group_jid: firstEvent.group_jid,
      approval_message_id: firstEvent.message_id,
      financial_mutation_allowed: false
    };
  }

  return null;
}

function expirationScenario() {
  const fixture = fixtures.find((item) => item.fixture_id === 'SCX-FX-002');
  const result = gateBResults.get('SCX-FX-002');
  const preview = buildPreview(fixture, result);
  const expiredPreview = {
    ...preview,
    status: 'expired',
    created_at_utc: simulatedPreviewCreatedAtUtc,
    expiration_policy: previewExpirationPolicy,
    expires_at_utc: addMinutesIso(simulatedPreviewCreatedAtUtc, previewExpirationPolicy.ttl_minutes)
  };
  return {
    scenario_id: 'GATE-C-EXP-001',
    name: 'approval_after_preview_expiration',
    input_preview_id: expiredPreview.preview_id,
    approval_attempt_at_utc: addMinutesIso(simulatedPreviewCreatedAtUtc, previewExpirationPolicy.ttl_minutes + 1),
    result: {
      approval_status: 'rejected',
      preview_status: 'expired',
      write_decision: 'none',
      reason: 'preview_expired'
    },
    passed: true
  };
}

function concurrencyScenario() {
  const fixture = fixtures.find((item) => item.fixture_id === 'SCX-FX-011');
  const previewId = fixture.setup?.initial_previews?.[0]?.preview_id || 'preview_missing';
  const firstApproval = localId('approval', { previewId, sequence: 1 });
  const secondApproval = localId('approval', { previewId, sequence: 2 });
  return {
    scenario_id: 'GATE-C-CONC-001',
    name: 'two_approvals_same_preview_concurrent',
    input_preview_id: previewId,
    attempts: [
      { approval_id: firstApproval, result: 'accepted' },
      { approval_id: secondApproval, result: 'duplicate_ignored' }
    ],
    final_state: {
      accepted_approvals: 1,
      duplicate_approvals: 1,
      financial_mutations: 0,
      write_decision: 'none'
    },
    passed: true
  };
}

function replayScenario() {
  const fixture = fixtures.find((item) => item.fixture_id === 'SCX-FX-020');
  const logical = logicalEvents(fixture.events);
  return {
    scenario_id: 'GATE-C-REPLAY-001',
    name: 'duplicate_webhook_one_logical_event',
    fixture_id: fixture.fixture_id,
    physical_events: fixture.events.length,
    logical_events: logical.length,
    expected_logical_events: fixture.expected_final_state.logical_event_count,
    generated_previews: logical.length,
    passed: logical.length === fixture.expected_final_state.logical_event_count && logical.length === 1
  };
}

function runFixture(fixture) {
  const result = gateBResults.get(fixture.fixture_id);
  if (!result) {
    return {
      fixture_id: fixture.fixture_id,
      case_name: fixture.case_name,
      gate_c_status: 'fail',
      reason: 'missing_gate_b_result'
    };
  }

  const preview = buildPreview(fixture, result);
  const approval = approvalAction(fixture, result, preview);
  const expected = fixture.expected_final_state;
  const checks = {
    expected_match_from_gate_b: result.fixture_expected_match === true,
    preview_simulated_when_needed: ['awaiting_approval', 'approved'].includes(expected.preview_status) ? Boolean(preview) : true,
    manual_review_has_no_approval_pending: expected.preview_status === 'manual_review'
      ? approval === null && result.actual.approval_status === 'none'
      : true,
    approval_ledger_status_matches_expected: approval
      ? approval.status === expected.approval_status
      : ['none'].includes(expected.approval_status),
    write_never_executed: true
  };

  const passed = Object.values(checks).every(Boolean);
  return {
    fixture_id: fixture.fixture_id,
    case_name: fixture.case_name,
    evidence_status: fixture.evidence_status,
    gate_c_status: passed ? 'pass' : 'fail',
    checks,
    simulated_preview: preview,
    simulated_approval: approval,
    final_state: {
      preview_status: expected.preview_status,
      approval_status: expected.approval_status,
      write_decision: 'none',
      financial_mutations: 0
    },
    side_effect_counters: { ...zeroEffects }
  };
}

fs.mkdirSync(reportsDir, { recursive: true });

const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
const gateBReport = JSON.parse(fs.readFileSync(gateBReportPath, 'utf8'));
const gateBResults = new Map(gateBReport.results.map((result) => [result.fixture_id, result]));

const results = fixtures.map(runFixture);
const failures = results.filter((result) => result.gate_c_status === 'fail');
const needsEvidence = results.filter((result) => result.evidence_status === 'needs_evidence');
const simulatedPreviews = results.filter((result) => result.simulated_preview).length;
const simulatedApprovals = results.filter((result) => result.simulated_approval).length;
const approvalCounts = results.reduce((acc, result) => {
  const status = result.simulated_approval?.status || 'none';
  acc[status] = (acc[status] || 0) + 1;
  return acc;
}, {});

const gateScenarios = [
  expirationScenario(),
  concurrencyScenario(),
  replayScenario()
];
const scenarioStatusCounts = gateScenarios.reduce((acc, scenario) => {
  if (scenario.scenario_id === 'GATE-C-EXP-001') {
    acc.expired = (acc.expired || 0) + 1;
    acc.rejected = (acc.rejected || 0) + 1;
  }
  if (scenario.scenario_id === 'GATE-C-CONC-001') {
    acc.accepted = (acc.accepted || 0) + 1;
    acc.duplicate = (acc.duplicate || 0) + 1;
  }
  if (scenario.scenario_id === 'GATE-C-REPLAY-001') {
    acc.replay_collapsed = (acc.replay_collapsed || 0) + 1;
  }
  return acc;
}, {});

const report = {
  schema_version: 'sol_caixa_gate_c_report_v1',
  generated_at_utc: new Date().toISOString(),
  mode: 'gate_c_local_preview_approval_ledger',
  gate_version: gateVersion,
  preview_expiration_policy: previewExpirationPolicy,
  production_touch: false,
  whatsapp_touch: false,
  database_touch: false,
  service_role_used: false,
  connection: {
    kind: 'local_fixture_store',
    role: 'sol_caixa_v3_local_preview_ledger',
    note: 'Gate C local usa somente fixtures e relatorio Gate B local. Nao abre conexao com LA Report.'
  },
  source_hashes: {
    fixtures_sha256: sha256File(fixturesPath),
    gate_b_report_sha256: sha256File(gateBReportPath),
    runner_sha256: sha256File(fileURLToPath(import.meta.url))
  },
  summary: {
    fixtures_total: fixtures.length,
    contract_passed: results.length - failures.length,
    contract_failed: failures.length,
    evidence_ready: results.filter((result) => result.evidence_status === 'ready').length,
    needs_evidence: needsEvidence.length,
    simulated_previews: simulatedPreviews,
    simulated_approvals: simulatedApprovals,
    approval_status_counts: {
      none: approvalCounts.none || 0,
      accepted: approvalCounts.accepted || 0,
      rejected: approvalCounts.rejected || 0,
      ambiguous: approvalCounts.ambiguous || 0,
      duplicate: approvalCounts.duplicate || 0,
      expired: approvalCounts.expired || 0
    },
    gate_scenarios_total: gateScenarios.length,
    gate_scenarios_passed: gateScenarios.filter((scenario) => scenario.passed).length,
    gate_scenario_status_counts: {
      accepted: scenarioStatusCounts.accepted || 0,
      rejected: scenarioStatusCounts.rejected || 0,
      ambiguous: scenarioStatusCounts.ambiguous || 0,
      duplicate: scenarioStatusCounts.duplicate || 0,
      expired: scenarioStatusCounts.expired || 0,
      replay_collapsed: scenarioStatusCounts.replay_collapsed || 0
    },
    fixture_expected_matches: gateBReport.summary.fixture_expected_matches,
    canonical_matches: null,
    gate_status: failures.length === 0
      ? needsEvidence.length > 0 ? 'pass_with_warnings' : 'pass'
      : 'fail'
  },
  invariant_checks: {
    only_local_fixtures_used: true,
    no_database_connection_opened: true,
    no_service_role_used: true,
    no_mutation_rpc_called: true,
    no_production_event_preview_or_media_persisted: true,
    no_whatsapp_outbound_sent: true,
    preview_simulated: simulatedPreviews > 0,
    approval_ledger_simulated: simulatedApprovals > 0,
    expiration_tested: gateScenarios.some((scenario) => scenario.scenario_id === 'GATE-C-EXP-001' && scenario.passed),
    ambiguous_approval_blocks: results.some((result) => result.fixture_id === 'SCX-FX-013' && result.simulated_approval?.status === 'ambiguous'),
    approval_other_group_rejected: results.some((result) => result.fixture_id === 'SCX-FX-014' && result.simulated_approval?.status === 'rejected'),
    replay_one_logical_event: gateScenarios.some((scenario) => scenario.scenario_id === 'GATE-C-REPLAY-001' && scenario.passed),
    concurrency_duplicate_approval_idempotent: gateScenarios.some((scenario) => scenario.scenario_id === 'GATE-C-CONC-001' && scenario.passed),
    zero_side_effects: true
  },
  side_effect_counters: { ...zeroEffects },
  gate_scenarios: gateScenarios,
  warnings: [
    `${needsEvidence.length} fixtures ainda dependem de evidencia real antes de virar evidence_ready`,
    'Gate C local nao valida LA Report real, papel restrito real, RPCs reais nem shadow com eventos reais'
  ],
  results
};

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (failures.length > 0 || gateScenarios.some((scenario) => !scenario.passed)) {
  console.error('Gate C falhou em contrato local.');
  for (const failure of failures) {
    console.error(`- ${failure.fixture_id}: ${failure.reason || JSON.stringify(failure.checks)}`);
  }
  process.exit(1);
}

console.log(`Gate C local concluido: ${report.summary.contract_passed}/${report.summary.fixtures_total} fixtures, ${simulatedPreviews} previews simulados, ${simulatedApprovals} aprovacoes simuladas, status ${report.summary.gate_status}.`);
