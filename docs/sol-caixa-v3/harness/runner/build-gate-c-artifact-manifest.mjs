import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const manifestPath = path.join(rootDir, 'reports', 'gate-c-artifact-manifest-2026-08-20.json');

const artifact = 'sol-caixa-v3-harness-gate-c-2026-08-20';
const files = [
  'README.md',
  'fixtures/sol-caixa-v3-fixtures.json',
  'reports/gate-a-report-2026-08-20.json',
  'reports/gate-a-run-2026-08-20.stderr.txt',
  'reports/gate-a-run-2026-08-20.stdout.txt',
  'reports/gate-b-artifact-manifest-2026-08-20.json',
  'reports/gate-b-report-2026-08-20.json',
  'reports/gate-b-run-2026-08-20.stderr.txt',
  'reports/gate-b-run-2026-08-20.stdout.txt',
  'reports/gate-c-report-2026-08-20.json',
  'reports/gate-c-run-2026-08-20.stderr.txt',
  'reports/gate-c-run-2026-08-20.stdout.txt',
  'runner/gate-a-runner.mjs',
  'runner/gate-b-runner.mjs',
  'runner/gate-c-runner.mjs'
];

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const manifest = {
  schema_version: 'sol_caixa_gate_c_artifact_manifest_v1',
  generated_at_utc: new Date().toISOString(),
  artifact,
  scope: 'local_fixture_store_only',
  production_touch: false,
  whatsapp_touch: false,
  database_touch: false,
  service_role_used: false,
  commands_executed: [
    'node outputs/sol-caixa-v3-harness/runner/gate-a-runner.mjs',
    'node outputs/sol-caixa-v3-harness/runner/gate-b-runner.mjs',
    'node outputs/sol-caixa-v3-harness/runner/gate-c-runner.mjs'
  ],
  command_outputs: {
    gate_a_stdout: 'reports/gate-a-run-2026-08-20.stdout.txt',
    gate_a_stderr: 'reports/gate-a-run-2026-08-20.stderr.txt',
    gate_b_stdout: 'reports/gate-b-run-2026-08-20.stdout.txt',
    gate_b_stderr: 'reports/gate-b-run-2026-08-20.stderr.txt',
    gate_c_stdout: 'reports/gate-c-run-2026-08-20.stdout.txt',
    gate_c_stderr: 'reports/gate-c-run-2026-08-20.stderr.txt'
  },
  files: files.map((relativePath) => {
    const filePath = path.join(rootDir, relativePath);
    const stat = fs.statSync(filePath);
    return {
      path: relativePath,
      bytes: stat.size,
      sha256: sha256File(filePath)
    };
  })
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Manifesto Gate C criado: ${manifestPath}`);
