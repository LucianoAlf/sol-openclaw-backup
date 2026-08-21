import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlFile = 'phase3-official-helper-contract-test.sql';
const name = `sol-classifier-phase3-${process.pid}-${Date.now()}`;
const outputIndex = process.argv.indexOf('--out');
const outputPath = outputIndex >= 0
  ? path.resolve(process.argv[outputIndex + 1] || '')
  : path.join(os.tmpdir(), `sol-caixa-v3-phase3-helper-contract-${Date.now()}.json`);

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

let started = false;
try {
  run('docker', ['run', '--rm', '-d', '--name', name,
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
    '-v', `${dirname}:/workspace:ro`,
    'postgres:16-alpine']);
  started = true;

  let ready = false;
  let consecutiveReady = 0;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    // pg_isready can return success while the socket is being recycled during
    // bootstrap. A real psql round-trip prevents a false-ready result.
    const status = spawnSync('docker', ['exec', name, 'psql', '-U', 'postgres', '-d', 'postgres', '-Atqc', 'select 1'], { encoding: 'utf8' });
    if (status.status === 0) {
      consecutiveReady += 1;
      // postgres' entrypoint has a temporary bootstrap server. Two successful
      // round-trips avoid racing its shutdown before the final server starts.
      if (consecutiveReady >= 2) { ready = true; break; }
    } else {
      consecutiveReady = 0;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  if (!ready) throw new Error('postgres_not_ready');

  const output = run('docker', ['exec', name, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', `/workspace/${sqlFile}`]);
  const report = {
    schema_version: 'sol_caixa_v3_phase3_official_helper_contract_v1',
    status: 'pass',
    environment: 'ephemeral_postgres_16_alpine',
    production_changes: false,
    database_migrations_applied: false,
    financial_mutations: 0,
    whatsapp_outbound: 0,
    helper_contract: {
      group: 'sol_caixa_grupo_operacao_ok(uuid,text,text) returns jsonb',
      actor: 'sol_caixa_ator_operacao_ok(uuid,text,text) returns jsonb',
      source: 'read_only_catalog_inspection_2026_08_21'
    },
    assertions: [
      'classified_with_authorized_jsonb_helpers',
      'group_rejected_before_actor',
      'actor_rejected_after_group',
      'missing_autorizado_fails_closed'
    ],
    psql_output: output.trim()
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: 'pass', report: outputPath, assertions: report.assertions }, null, 2));
} finally {
  if (started) spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
}
