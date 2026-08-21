import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, 'sol-caixa-v3-classificador-fixtures.json');
const legacyPath = path.resolve(__dirname, '..', 'runtime', 'caixa-financeiro.cjs');
const require = createRequire(import.meta.url);
const legacy = require(legacyPath);
const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const outIndex = process.argv.indexOf('--out');
const outputPath = outIndex >= 0
  ? path.resolve(process.argv[outIndex + 1] || '')
  : path.join(os.tmpdir(), `sol-caixa-v3-phase2-shadow-${Date.now()}.json`);

function norm(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function hasToken(text, term) {
  const normalizedText = ` ${norm(text)} `;
  const normalizedTerm = norm(term);
  return normalizedTerm !== '' && normalizedText.includes(` ${normalizedTerm} `);
}

const rules = [
  { id: 'correcao_forma_pix:v1', priority: 100, all: ['pix'], any: ['nao foi cartao', 'foi pix', 'nao cartao'], operation: 'correcao_forma' },
  { id: 'estornar_movimento:v1', priority: 95, any: ['estorna', 'estornar', 'exclui esse lancamento', 'apaga esse lancamento'], operation: 'estornar_movimento' },
  { id: 'saida_seguranca_dinheiro:v1', priority: 90, all: ['seguranca'], any: ['saida', 'pagamento semanal', 'pagar seguranca'], operation: 'lancar_saida' },
  { id: 'entrada_parcela_pix:v1', priority: 80, all: ['parcela', 'pix'], operation: 'lancar_recebimento' }
];

function deterministicOperation(fixture) {
  if (fixture.media_status === 'pending' || fixture.actor_status !== 'resolved' || fixture.force_rule_tie) return null;
  const matches = rules.filter((rule) =>
    (rule.all || []).every((term) => hasToken(fixture.texto_normalizado, term)) &&
    (!(rule.any || []).length || rule.any.some((term) => hasToken(fixture.texto_normalizado, term)))
  ).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return matches[0]?.operation || null;
}

function legacyOperation(text) {
  const movement = legacy.extrairComandoMovimento(text);
  if (movement?.tipo === 'estornar') return 'estornar_movimento';
  if (movement?.tipo === 'corrigir') return 'correcao_movimento';
  const correction = legacy.extrairCorrecaoForma(text);
  if (correction?.forma) return 'correcao_forma';
  return null;
}

const rows = fixtures.map((fixture) => {
  const deterministic = deterministicOperation(fixture);
  const legacyResult = legacyOperation(fixture.texto_normalizado);
  let comparison_status;
  if (!deterministic) comparison_status = 'not_applicable';
  else if (!legacyResult) comparison_status = 'legacy_not_exposed';
  else comparison_status = deterministic === legacyResult ? 'match' : 'divergencia';
  return {
    fixture_id: fixture.fixture_id,
    deterministic_operation: deterministic,
    legacy_operation_from_runtime_snapshot: legacyResult,
    comparison_status
  };
});

const summary = rows.reduce((acc, row) => {
  acc[row.comparison_status] = (acc[row.comparison_status] || 0) + 1;
  return acc;
}, {});
const report = {
  schema_version: 'sol_caixa_v3_phase2_shadow_legacy_v1',
  production_changes: false,
  database_migrations_applied: false,
  financial_mutations: 0,
  parser_snapshot: {
    path: 'docs/sol-caixa-v3/runtime/caixa-financeiro.cjs',
    sha256: crypto.createHash('sha256').update(fs.readFileSync(legacyPath)).digest('hex')
  },
  fixture_count: fixtures.length,
  summary,
  rows
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: 'pass', report: outputPath, summary }, null, 2));
