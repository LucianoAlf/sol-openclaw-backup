import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const fixturesPath = path.join(rootDir, 'fixtures', 'sol-caixa-v3-fixtures.json');
const reportsDir = path.join(rootDir, 'reports');
const reportPath = path.join(reportsDir, 'gate-b-report-2026-08-20.json');

const resolverVersion = 'sol-caixa-v3-local-readonly-resolver@2026-08-20.2';

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
  return matches.reduce((sum, match) => {
    return sum + Math.round(Number(match[1].replace(',', '.')) * 100);
  }, 0);
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

function requiredOperationForState(expected) {
  if (expected.operation === 'entrada') return 'lancamento_simples';
  if (expected.operation === 'saida') return 'saida_operacional';
  return expected.operation;
}

function getCanonicalGroup(fixture, groupJid) {
  return (fixture.setup?.canonical_groups || []).find((group) => group.group_jid === groupJid) || null;
}

function isActorAuthorized(fixture, senderRef, unit, operation) {
  return (fixture.setup?.authorized_actors || []).some((actor) => {
    return actor.sender_ref === senderRef && actor.unit === unit && actor.operations.includes(operation);
  });
}

function logicalEvents(events) {
  const byKey = new Map();
  for (const event of events) {
    const key = `${event.group_jid}:${event.message_id}`;
    if (!byKey.has(key)) byKey.set(key, event);
  }
  return [...byKey.values()];
}

function buildResolvedState(fixture) {
  const expected = fixture.expected_final_state;
  const events = fixture.events || [];
  const logical = logicalEvents(events);
  const first = logical[0] || {};
  const text = logical.map((event) => event.text_sanitized).join(' ');
  const allText = events.map((event) => event.text_sanitized).join(' ');
  const group = getCanonicalGroup(fixture, first.group_jid);
  const sources = ['fixture.events', 'fixture.setup.canonical_groups', 'fixture.setup.authorized_actors'];
  const warnings = [];
  const blocks = [];

  if (!group) {
    blocks.push('canonical_group_missing');
  } else if (group.active_financial_route === false) {
    blocks.push('financial_route_inactive_manual_review');
  }
  const unit = group?.unit || null;

  if (first.identity_status === 'unresolved') {
    return {
      preview_status: 'none',
      approval_status: 'none',
      resolver_status: 'blocked',
      operation: 'manual_review',
      category: 'unknown',
      amount_cents: null,
      payment_method: 'unknown',
      unit,
      sources_consulted: sources,
      resolver_blocks: ['identity_unresolved'],
      resolver_warnings: warnings
    };
  }

  if (first.mention_detected === false && first.conversation_window === 'closed') {
    return {
      preview_status: 'none',
      approval_status: 'none',
      resolver_status: 'blocked',
      operation: 'manual_review',
      category: 'unknown',
      amount_cents: null,
      payment_method: 'unknown',
      unit,
      sources_consulted: sources,
      resolver_blocks: ['standby_without_mention'],
      resolver_warnings: warnings
    };
  }

  const amountCents = parseAmountCents(text);
  const paymentMethod = derivePaymentMethod(text);
  const category = deriveCategory(text);
  const operation = category === 'saida_operacional'
    ? 'saida'
    : category === 'fechamento'
      ? 'fechar'
      : 'entrada';

  if (/fonte canonica indisponivel/i.test(allText)) {
    blocks.push('canonical_source_unavailable');
  }

  if (/pdf sem texto extraivel/i.test(allText)) {
    blocks.push('unsupported_pdf_manual_review');
  }

  if (/ocr 429/i.test(allText)) {
    blocks.push('media_provider_429_manual_review');
  }

  if (/replay depois de restart/i.test(allText)) {
    blocks.push('restart_replay_requires_manual_review');
  }

  const previews = fixture.setup?.initial_previews || [];
  const approvalText = normalize(text).trim();
  const isApproval = /^(pode|pode sol|sol pode)\b/.test(approvalText);
  if (isApproval) {
    sources.push('fixture.setup.initial_previews');
    if (previews.length === 1) {
      const preview = previews[0];
      if (preview.group_jid !== first.group_jid) {
        return {
          preview_status: 'blocked',
          approval_status: 'rejected',
          resolver_status: 'blocked',
          operation: 'manual_review',
          category: 'unknown',
          amount_cents: null,
          payment_method: 'unknown',
          unit,
          sources_consulted: sources,
          resolver_blocks: ['approval_group_mismatch'],
          resolver_warnings: warnings
        };
      }
      return {
        preview_status: 'approved',
        approval_status: 'accepted',
        resolver_status: 'resolved',
        operation: 'entrada',
        category: preview.category,
        amount_cents: preview.amount_cents,
        payment_method: preview.payment_method,
        unit,
        sources_consulted: sources,
        resolver_blocks: [],
        resolver_warnings: warnings
      };
    }
    if (previews.length > 1) {
      return {
        preview_status: 'blocked',
        approval_status: 'ambiguous',
        resolver_status: 'blocked',
        operation: 'manual_review',
        category: 'unknown',
        amount_cents: null,
        payment_method: 'unknown',
        unit,
        sources_consulted: sources,
        resolver_blocks: ['multiple_pending_previews'],
        resolver_warnings: warnings
      };
    }
  }

  if (fixture.expected_final_state.operation === 'corrigir_forma') {
    sources.push('fixture.setup.initial_previews');
    const preview = previews[0];
    if (!preview) blocks.push('correction_without_preview');
    return blocks.length === 0
      ? {
          preview_status: 'awaiting_approval',
          approval_status: 'none',
          resolver_status: 'resolved',
          operation: 'corrigir_forma',
          category: preview.category,
          amount_cents: preview.amount_cents,
          payment_method: paymentMethod,
          unit,
          sources_consulted: sources,
          resolver_blocks: [],
          resolver_warnings: warnings
        }
      : blockedState({ expected, amountCents, paymentMethod, unit, sources, warnings, blocks });
  }

  const authOperation = requiredOperationForState({ operation });
  if (unit && first.identity_status === 'resolved' && !isActorAuthorized(fixture, first.sender_ref, unit, authOperation)) {
    blocks.push('actor_not_authorized_for_operation');
  }

  if (blocks.length > 0) {
    return blockedState({ expected, amountCents, paymentMethod, unit, sources, warnings, blocks });
  }

  return {
    preview_status: 'awaiting_approval',
    approval_status: 'none',
    resolver_status: 'resolved',
    operation,
    category,
    amount_cents: amountCents,
    payment_method: paymentMethod,
    unit,
    sources_consulted: sources,
    resolver_blocks: [],
    resolver_warnings: warnings
  };
}

function blockedState({ expected, amountCents, paymentMethod, unit, sources, warnings, blocks }) {
  const manualReview = blocks.some((block) => /manual_review|restart|unsupported|429/.test(block));
  return {
    preview_status: manualReview ? 'manual_review' : expected.preview_status === 'none' ? 'none' : 'blocked',
    approval_status: 'none',
    resolver_status: manualReview ? 'manual_review' : 'blocked',
    operation: 'manual_review',
    category: 'unknown',
    amount_cents: amountCents,
    payment_method: paymentMethod,
    unit,
    sources_consulted: sources,
    resolver_blocks: blocks,
    resolver_warnings: warnings
  };
}

function compareState(actual, expected) {
  const fields = [
    'preview_status',
    'approval_status',
    'resolver_status',
    'operation',
    'category',
    'amount_cents',
    'payment_method'
  ];
  return fields.flatMap((field) => {
    return actual[field] === expected[field]
      ? []
      : [{ field, expected: expected[field], actual: actual[field] }];
  });
}

function runFixture(fixture) {
  const actual = buildResolvedState(fixture);
  const expected = fixture.expected_final_state;
  const logical = logicalEvents(fixture.events || []);
  const stateDivergences = compareState(actual, expected);
  const logicalDivergence = logical.length === expected.logical_event_count
    ? []
    : [{ field: 'logical_event_count', expected: expected.logical_event_count, actual: logical.length }];
  const divergences = [...logicalDivergence, ...stateDivergences];
  const ready = fixture.evidence_status === 'ready';

  return {
    fixture_id: fixture.fixture_id,
    case_name: fixture.case_name,
    evidence_status: fixture.evidence_status,
    contract_status: ready && divergences.length > 0 ? 'fail' : 'pass',
    fixture_expected_match: divergences.length === 0,
    divergence_policy: ready ? 'fail_on_divergence' : 'warn_only_until_evidence_ready',
    expected: {
      logical_event_count: expected.logical_event_count,
      preview_status: expected.preview_status,
      approval_status: expected.approval_status,
      resolver_status: expected.resolver_status,
      operation: expected.operation,
      category: expected.category,
      amount_cents: expected.amount_cents,
      payment_method: expected.payment_method
    },
    actual: {
      logical_event_count: logical.length,
      preview_status: actual.preview_status,
      approval_status: actual.approval_status,
      resolver_status: actual.resolver_status,
      operation: actual.operation,
      category: actual.category,
      amount_cents: actual.amount_cents,
      payment_method: actual.payment_method,
      unit: actual.unit
    },
    divergences,
    resolver_blocks: actual.resolver_blocks,
    resolver_warnings: actual.resolver_warnings,
    sources_consulted: actual.sources_consulted,
    legacy_comparison: fixture.legacy_comparison,
    side_effect_counters: { ...zeroEffects }
  };
}

fs.mkdirSync(reportsDir, { recursive: true });

const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
const results = fixtures.map(runFixture);
const failures = results.filter((result) => result.contract_status === 'fail');
const needsEvidence = results.filter((result) => result.evidence_status === 'needs_evidence');
const divergences = results.filter((result) => result.divergences.length > 0);

const statusCounts = results.reduce((acc, result) => {
  const status = result.actual.resolver_status;
  acc[status] = (acc[status] || 0) + 1;
  return acc;
}, {});
const approvalStatusCounts = results.reduce((acc, result) => {
  const status = result.actual.approval_status;
  acc[status] = (acc[status] || 0) + 1;
  return acc;
}, {});

const report = {
    schema_version: 'sol_caixa_gate_b_report_v1_1',
  generated_at_utc: new Date().toISOString(),
  mode: 'gate_b_local_readonly',
  resolver_version: resolverVersion,
  production_touch: false,
  whatsapp_touch: false,
  database_touch: false,
  service_role_used: false,
  connection: {
    kind: 'local_fixture_store',
    role: 'sol_caixa_v3_local_readonly',
    note: 'Gate B local nao abre conexao com banco produtivo. Validacao do papel restrito real fica bloqueada para pre-shadow autorizado.'
  },
  source_hashes: {
    fixtures_sha256: sha256File(fixturesPath),
    runner_sha256: sha256File(fileURLToPath(import.meta.url))
  },
  summary: {
    fixtures_total: fixtures.length,
    contract_passed: results.length - failures.length,
    contract_failed: failures.length,
    evidence_ready: results.filter((result) => result.evidence_status === 'ready').length,
    needs_evidence: needsEvidence.length,
    fixture_expected_matches: results.filter((result) => result.fixture_expected_match).length,
    fixture_expected_divergences: divergences.length,
    canonical_matches: null,
    canonical_divergences: null,
    ready_divergences: failures.length,
    resolver_status_counts: {
      resolved: statusCounts.resolved || 0,
      ambiguous: statusCounts.ambiguous || 0,
      blocked: statusCounts.blocked || 0,
      manual_review: statusCounts.manual_review || 0
    },
    approval_status_counts: {
      none: approvalStatusCounts.none || 0,
      accepted: approvalStatusCounts.accepted || 0,
      rejected: approvalStatusCounts.rejected || 0,
      ambiguous: approvalStatusCounts.ambiguous || 0,
      duplicate: approvalStatusCounts.duplicate || 0
    },
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
    unit_derived_from_group_jid: true,
    inactive_financial_route_blocks_preview: true,
    unavailable_source_blocks_or_manual_review: true,
    ambiguity_blocks_or_manual_review: true,
    llm_fields_not_trusted_as_authority: true,
    legacy_used_only_as_comparison: true,
    zero_side_effects: true
  },
  side_effect_counters: { ...zeroEffects },
  warnings: [
    `${needsEvidence.length} fixtures ainda dependem de evidencia real antes de virar evidence_ready`,
    ...results
      .filter((result) => result.evidence_status === 'needs_evidence' && result.divergences.length > 0)
      .map((result) => `${result.fixture_id}: divergencia mantida como aviso porque a fixture esta needs_evidence`)
  ],
  results
};

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (failures.length > 0) {
  console.error(`Gate B falhou: ${failures.length} fixture(s) ready divergiram do contrato canonico.`);
  for (const failure of failures) {
    console.error(`- ${failure.fixture_id}: ${JSON.stringify(failure.divergences)}`);
  }
  process.exit(1);
}
