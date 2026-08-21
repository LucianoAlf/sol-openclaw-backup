import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const fixturesPath = path.join(rootDir, 'fixtures', 'sol-caixa-v3-fixtures.json');
const reportsDir = path.join(rootDir, 'reports');
const reportPath = path.join(reportsDir, 'gate-a-report-2026-08-20.json');

const enums = {
  schema_version: new Set(['sol_caixa_fixture_v3']),
  identity_status: new Set(['resolved', 'unresolved']),
  conversation_window: new Set(['active', 'closed']),
  message_kind: new Set(['text', 'image', 'pdf', 'quoted_reply']),
  media_kind: new Set(['image', 'pdf', null]),
  ingest_decision: new Set(['save', 'ignore']),
  response_decision: new Set(['none', 'reply']),
  write_candidate: new Set(['none', 'candidate', 'await_approval']),
  authorization_precheck: new Set(['allowed', 'denied', 'unknown']),
  preview_status: new Set(['awaiting_approval', 'manual_review', 'blocked', 'approved', 'none']),
  approval_status: new Set(['none', 'accepted', 'rejected', 'ambiguous', 'duplicate']),
  resolver_status: new Set(['resolved', 'ambiguous', 'blocked', 'manual_review']),
  operation: new Set(['entrada', 'saida', 'abrir', 'fechar', 'corrigir_forma', 'manual_review']),
  category: new Set(['parcela', 'passaporte', 'lojinha', 'banda', 'composto', 'saida_operacional', 'fechamento', 'unknown']),
  payment_method: new Set(['pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'unknown']),
  legacy_result: new Set(['unknown', 'matched', 'wrong_category', 'fallback_wrong', 'technical_leak', 'not_applicable', 'matched_after_hotfix']),
  evidence_status: new Set(['ready', 'needs_evidence'])
};

const requiredEffectKeys = [
  'db_write_calls',
  'financial_mutations',
  'whatsapp_outbound_calls',
  'duplicate_outbound_calls',
  'external_media_calls',
  'restarts'
];

const forbiddenSensitivePatterns = [
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/, // CPF-like
  /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/, // CNPJ-like
  /\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bRPC\b|public\./i,
  /chave pix/i,
  /\/home\/|\/root\/|\.env/i
];

function fail(errors, message) {
  errors.push(message);
}

function isUuidLike(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function assertEnum(errors, name, value, set, context) {
  if (!set.has(value)) {
    fail(errors, `${context}: ${name} invalido: ${String(value)}`);
  }
}

function assertNumberOrNull(errors, name, value, context) {
  if (value !== null && (!Number.isInteger(value) || value < 0)) {
    fail(errors, `${context}: ${name} deve ser inteiro >= 0 ou null`);
  }
}

function validateFixture(fixture) {
  const errors = [];
  const warnings = [];
  const context = fixture.fixture_id || 'fixture-sem-id';

  if (!/^SCX-FX-\d{3}$/.test(fixture.fixture_id || '')) {
    fail(errors, `${context}: fixture_id invalido`);
  }
  assertEnum(errors, 'schema_version', fixture.schema_version, enums.schema_version, context);

  if (!fixture.setup || typeof fixture.setup !== 'object') {
    fail(errors, `${context}: setup ausente`);
  } else {
    for (const key of ['canonical_groups', 'authorized_actors', 'initial_previews', 'initial_media_states']) {
      if (!Array.isArray(fixture.setup[key])) {
        fail(errors, `${context}: setup.${key} deve ser array`);
      }
    }
  }

  if (!Array.isArray(fixture.events) || fixture.events.length === 0) {
    fail(errors, `${context}: events deve ter pelo menos 1 evento`);
  } else {
    const logicalKeys = new Set();
    for (const [index, event] of fixture.events.entries()) {
      const eventCtx = `${context}.events[${index}]`;
      if (!isUuidLike(event.event_id)) fail(errors, `${eventCtx}: event_id deve ser uuid`);
      if (typeof event.group_jid !== 'string' || !event.group_jid.endsWith('@g.us')) fail(errors, `${eventCtx}: group_jid invalido`);
      if (typeof event.message_id !== 'string' || event.message_id.length === 0) fail(errors, `${eventCtx}: message_id obrigatorio`);
      if (event.quoted_message_id !== null && typeof event.quoted_message_id !== 'string') fail(errors, `${eventCtx}: quoted_message_id deve ser string ou null`);
      if (typeof event.sender_ref !== 'string' || event.sender_ref.length === 0) fail(errors, `${eventCtx}: sender_ref obrigatorio`);
      assertEnum(errors, 'identity_status', event.identity_status, enums.identity_status, eventCtx);
      if (typeof event.mention_detected !== 'boolean') fail(errors, `${eventCtx}: mention_detected deve ser boolean`);
      assertEnum(errors, 'conversation_window', event.conversation_window, enums.conversation_window, eventCtx);
      assertEnum(errors, 'message_kind', event.message_kind, enums.message_kind, eventCtx);
      if (typeof event.text_sanitized !== 'string') fail(errors, `${eventCtx}: text_sanitized obrigatorio`);
      if (typeof event.has_media !== 'boolean') fail(errors, `${eventCtx}: has_media deve ser boolean`);
      assertEnum(errors, 'media_kind', event.media_kind, enums.media_kind, eventCtx);
      if (event.has_media && event.media_kind === null) fail(errors, `${eventCtx}: evento com midia precisa media_kind`);
      if (!event.has_media && event.media_kind !== null) fail(errors, `${eventCtx}: evento sem midia deve ter media_kind null`);
      for (const pattern of forbiddenSensitivePatterns) {
        if (pattern.test(event.text_sanitized)) fail(errors, `${eventCtx}: texto contem padrao sensivel/tecnico proibido`);
      }
      if ('approved' in event || 'write_decision' in event || 'authorization_decision' in event || 'response_decision' in event) {
        fail(errors, `${eventCtx}: evento bruto nao pode conter decisoes derivadas`);
      }
      logicalKeys.add(`${event.group_jid}:${event.message_id}`);
    }

    const expectedLogical = fixture.expected_final_state?.logical_event_count;
    if (Number.isInteger(expectedLogical) && logicalKeys.size !== expectedLogical) {
      fail(errors, `${context}: logical_event_count esperado ${expectedLogical}, obtido ${logicalKeys.size}`);
    }
  }

  const decision = fixture.expected_decision;
  if (!decision || typeof decision !== 'object') {
    fail(errors, `${context}: expected_decision ausente`);
  } else {
    assertEnum(errors, 'ingest_decision', decision.ingest_decision, enums.ingest_decision, context);
    assertEnum(errors, 'response_decision', decision.response_decision, enums.response_decision, context);
    assertEnum(errors, 'write_candidate', decision.write_candidate, enums.write_candidate, context);
    assertEnum(errors, 'authorization_precheck', decision.authorization_precheck, enums.authorization_precheck, context);
    if ('approved' in decision || decision.write_candidate === 'approved') {
      fail(errors, `${context}: decisao derivada nao pode aprovar`);
    }
  }

  const expected = fixture.expected_final_state;
  if (!expected || typeof expected !== 'object') {
    fail(errors, `${context}: expected_final_state ausente`);
  } else {
    if (!Number.isInteger(expected.event_count) || expected.event_count < 1) fail(errors, `${context}: event_count invalido`);
    if (!Number.isInteger(expected.logical_event_count) || expected.logical_event_count < 1) fail(errors, `${context}: logical_event_count invalido`);
    assertEnum(errors, 'preview_status', expected.preview_status, enums.preview_status, context);
    assertEnum(errors, 'approval_status', expected.approval_status, enums.approval_status, context);
    assertEnum(errors, 'resolver_status', expected.resolver_status, enums.resolver_status, context);
    assertEnum(errors, 'operation', expected.operation, enums.operation, context);
    assertEnum(errors, 'category', expected.category, enums.category, context);
    assertNumberOrNull(errors, 'amount_cents', expected.amount_cents, context);
    assertEnum(errors, 'payment_method', expected.payment_method, enums.payment_method, context);
  }

  const effects = fixture.expected_effects;
  if (!effects || typeof effects !== 'object') {
    fail(errors, `${context}: expected_effects ausente`);
  } else {
    for (const key of requiredEffectKeys) {
      if (effects[key] !== 0) fail(errors, `${context}: expected_effects.${key} deve ser 0 no Gate A`);
    }
  }

  const legacy = fixture.legacy_comparison;
  if (!legacy || typeof legacy !== 'object') {
    fail(errors, `${context}: legacy_comparison ausente`);
  } else {
    assertEnum(errors, 'legacy_result', legacy.legacy_result, enums.legacy_result, context);
    if (legacy.legacy_is_oracle !== false) fail(errors, `${context}: legacy_is_oracle precisa ser false`);
  }

  assertEnum(errors, 'evidence_status', fixture.evidence_status, enums.evidence_status, context);

  const events = fixture.events || [];
  const firstEvent = events[0] || {};
  if (firstEvent.mention_detected === false && firstEvent.conversation_window === 'closed') {
    if (fixture.expected_decision?.response_decision !== 'none') fail(errors, `${context}: mensagem sem mencao em standby nao pode responder`);
    if (fixture.expected_decision?.write_candidate !== 'none') fail(errors, `${context}: mensagem sem mencao em standby nao pode escrever`);
  }

  if (firstEvent.identity_status === 'unresolved') {
    if (fixture.expected_decision?.response_decision !== 'none') fail(errors, `${context}: identidade desconhecida nao pode responder`);
    if (fixture.expected_decision?.write_candidate !== 'none') fail(errors, `${context}: identidade desconhecida nao pode escrever`);
    if (fixture.expected_decision?.authorization_precheck !== 'unknown') fail(errors, `${context}: identidade desconhecida deve ter authorization_precheck unknown`);
  }

  if (fixture.fixture_id === 'SCX-FX-013' && fixture.expected_final_state?.approval_status !== 'ambiguous') {
    fail(errors, `${context}: dois previews + pode precisa ser ambiguous`);
  }

  if (fixture.fixture_id === 'SCX-FX-020' && fixture.expected_final_state?.logical_event_count !== 1) {
    fail(errors, `${context}: duplicate webhook precisa virar 1 evento logico`);
  }

  if (fixture.fixture_id === 'SCX-FX-011') {
    const hasTarget = (fixture.setup?.initial_previews || []).length === 1 || Boolean(firstEvent.quoted_message_id);
    if (!hasTarget) fail(errors, `${context}: pode Sol precisa de preview unico ou quoted_message_id`);
  }

  if (fixture.evidence_status === 'needs_evidence') {
    warnings.push(`${context}: fixture depende de evidencia real antes de virar ready`);
  }

  return {
    fixture_id: fixture.fixture_id,
    case_name: fixture.case_name,
    status: errors.length === 0 ? 'pass' : 'fail',
    errors,
    warnings
  };
}

fs.mkdirSync(reportsDir, { recursive: true });

const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
const results = fixtures.map(validateFixture);
const failed = results.filter((result) => result.status === 'fail');
const warnings = results.flatMap((result) => result.warnings);
const needsEvidence = fixtures.filter((fixture) => fixture.evidence_status === 'needs_evidence').length;
const evidenceReady = fixtures.length - needsEvidence;

const report = {
  schema_version: 'sol_caixa_gate_a_report_v1',
  generated_at_utc: new Date().toISOString(),
  mode: 'shadow_local',
  production_touch: false,
  whatsapp_touch: false,
  database_touch: false,
  summary: {
    fixtures_total: fixtures.length,
    fixtures_passed: results.length - failed.length,
    fixtures_failed: failed.length,
    contract_passed: results.length - failed.length,
    evidence_ready: evidenceReady,
    needs_evidence: needsEvidence,
    warnings_total: warnings.length,
    gate_status: failed.length === 0
      ? warnings.length > 0 ? 'pass_with_warnings' : 'pass'
      : 'fail'
  },
  side_effect_counters: {
    db_write_calls: 0,
    financial_mutations: 0,
    whatsapp_outbound_calls: 0,
    duplicate_outbound_calls: 0,
    restarts: 0,
    external_media_calls: 0
  },
  checks: {
    schema_enums: failed.length === 0,
    event_raw_without_approval: failed.length === 0,
    derived_decision_without_approval: failed.length === 0,
    unknown_identity_no_reply_no_write: failed.length === 0,
    no_mention_standby_no_reply_no_write: failed.length === 0,
    duplicate_webhook_one_logical_event: failed.length === 0,
    legacy_not_oracle: failed.length === 0,
    zero_side_effects: true
  },
  warnings,
  results
};

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (failed.length > 0) {
  console.error(`Gate A falhou: ${failed.length} fixture(s) com erro.`);
  for (const result of failed) {
    console.error(`- ${result.fixture_id}: ${result.errors.join('; ')}`);
  }
  process.exit(1);
}

console.log(`Gate A PASS: ${fixtures.length} fixtures carregadas, ${warnings.length} aviso(s), efeitos colaterais zero.`);
console.log(`Relatorio: ${reportPath}`);
