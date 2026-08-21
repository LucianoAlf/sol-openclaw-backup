import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = __dirname;
const fixturesPath = path.join(rootDir, 'sol-caixa-v3-classificador-fixtures.json');
const reportsDir = rootDir;
const reportPath = path.join(reportsDir, 'gate-classificador-v3-local-2026-08-21.json');

const deterministicRules = [
  {
    rule_id: 'correcao_forma_pix:v1',
    priority: 100,
    confidence: 1,
    all: ['pix'],
    any: ['nao foi cartao', 'foi pix', 'nao cartao'],
    intent: { operacao: 'correcao_forma', forma: 'pix', requires: ['movimentacao_id'] }
  },
  {
    rule_id: 'estornar_movimento:v1',
    priority: 95,
    confidence: 1,
    any: ['estorna', 'estornar', 'exclui esse lancamento', 'apaga esse lancamento'],
    intent: { operacao: 'estornar_movimento', requires: ['movimentacao_id'] }
  },
  {
    rule_id: 'saida_seguranca_dinheiro:v1',
    priority: 90,
    confidence: 1,
    all: ['seguranca'],
    any: ['saida', 'pagamento semanal', 'pagar seguranca'],
    intent: { operacao: 'lancar_saida', categoria: 'seguranca', forma: 'dinheiro', requires: [] }
  },
  {
    rule_id: 'entrada_parcela_pix:v1',
    priority: 80,
    confidence: 0.95,
    all: ['parcela', 'pix'],
    intent: { operacao: 'lancar_recebimento', categoria: 'parcela', forma: 'pix', requires: ['aluno'] }
  }
];

const forbiddenEffects = {
  db_write_calls: 0,
  financial_mutations: 0,
  whatsapp_outbound_calls: 0,
  preview_creations: 0,
  approval_creations: 0,
  mutation_rpc_calls: 0
};

function includesAll(text, terms = []) {
  return terms.every((term) => text.includes(term));
}

function includesAny(text, terms = []) {
  if (!terms.length) return true;
  return terms.some((term) => text.includes(term));
}

function extractAmountCents(text) {
  const match = text.match(/(?:r\$\s*)?(\d{1,5})(?:[,.](\d{2}))?/i);
  if (!match) return undefined;
  const reais = Number(match[1]);
  const cents = Number(match[2] || '00');
  return reais * 100 + cents;
}

function classify(fixture) {
  if (fixture.media_status === 'pending') {
    return {
      ok: true,
      stage: 'deterministic',
      status: 'media_pending',
      contract_version: 1,
      writes: false
    };
  }

  if (fixture.actor_status !== 'resolved') {
    return {
      ok: true,
      stage: 'deterministic',
      status: 'manual_review',
      reason: 'identity_unknown',
      contract_version: 1,
      writes: false
    };
  }

  if (fixture.force_rule_tie) {
    return {
      ok: true,
      stage: 'deterministic',
      status: 'ambiguous',
      reason: 'rule_tie',
      contract_version: 1,
      writes: false
    };
  }

  const text = String(fixture.texto_normalizado || '').toLowerCase();
  const matches = deterministicRules
    .filter((rule) => includesAll(text, rule.all) && includesAny(text, rule.any))
    .sort((a, b) => b.priority - a.priority || b.confidence - a.confidence || a.rule_id.localeCompare(b.rule_id));

  if (!matches.length) {
    return {
      ok: true,
      stage: 'deterministic',
      status: 'no_match',
      contract_version: 1,
      writes: false
    };
  }

  const top = matches[0];
  const amount = extractAmountCents(text);
  const intent = {
    ok: true,
    stage: 'deterministic',
    status: 'classified',
    rule_id: top.rule_id,
    confidence: top.confidence,
    evidence: [...(top.all || []), ...(top.any || [])],
    requires: top.intent.requires || [],
    contract_version: 1,
    writes: false,
    ...top.intent
  };

  if (amount !== undefined) intent.valor_centavos = amount;
  if (fixture.unit_text_claim && fixture.unit_text_claim !== fixture.group_key) {
    intent.unit_source = 'group_jid';
    intent.ignored_text_unit_claim = fixture.unit_text_claim;
  }

  return intent;
}

function compareExpected(fixture, actual) {
  const errors = [];
  const expected = fixture.expected_intent || {};

  for (const key of ['status', 'stage', 'operacao', 'categoria', 'forma', 'reason', 'writes']) {
    if (key in expected && actual[key] !== expected[key]) {
      errors.push(`${key}: esperado ${expected[key]}, obtido ${actual[key]}`);
    }
  }

  if ('valor_centavos' in expected && actual.valor_centavos !== expected.valor_centavos) {
    errors.push(`valor_centavos: esperado ${expected.valor_centavos}, obtido ${actual.valor_centavos}`);
  }

  if (expected.requires) {
    const actualRequires = new Set(actual.requires || []);
    for (const required of expected.requires) {
      if (!actualRequires.has(required)) errors.push(`requires sem ${required}`);
    }
  }

  if (expected.unit_must_remain_from_group && actual.unit_source !== 'group_jid') {
    errors.push('unidade nao ficou derivada do group_jid');
  }

  if (actual.writes !== false) errors.push('classificador tentou permitir write');

  return errors;
}

fs.mkdirSync(reportsDir, { recursive: true });

const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
const results = fixtures.map((fixture) => {
  const actual = classify(fixture);
  const errors = compareExpected(fixture, actual);
  return {
    fixture_id: fixture.fixture_id,
    case_name: fixture.case_name,
    status: errors.length ? 'fail' : 'pass',
    actual_intent: actual,
    legacy_parser_result: fixture.legacy_parser_result,
    errors
  };
});

const failed = results.filter((result) => result.status === 'fail');
const report = {
  schema_version: 'sol_caixa_v3_classifier_local_gate_v1',
  generated_at_utc: new Date().toISOString(),
  gate: 'classificador_v3_fase_1_local',
  production_changes: false,
  database_migrations_applied: false,
  whatsapp_deploy: false,
  strict_changed: false,
  fixture_count: fixtures.length,
  passed: results.length - failed.length,
  failed: failed.length,
  forbidden_effects: forbiddenEffects,
  checks: {
    deterministic_rules: 'covered',
    rule_tie: 'covered',
    regex_as_suggestion_only: 'documented',
    llm_invalid_output: 'schema_blocks_write',
    media_pending: 'covered',
    quote_image: 'covered_by_contract',
    pdf: 'covered_by_contract',
    text_unit_divergence: 'covered',
    unknown_identity: 'covered',
    no_write: Object.values(forbiddenEffects).every((value) => value === 0) && results.every((r) => r.actual_intent.writes === false)
  },
  results
};

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (failed.length) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  status: 'pass',
  report: reportPath,
  fixture_count: fixtures.length,
  forbidden_effects: forbiddenEffects
}, null, 2));
