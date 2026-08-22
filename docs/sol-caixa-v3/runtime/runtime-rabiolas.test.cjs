'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'caixa-financeiro.cjs'), 'utf8');

assert.ok(!source.includes('sol_caixa_corrigir_forma_recebimento'), 'RPC legada de correção ainda está no runtime');
assert.ok(!source.includes('/rest/v1/alunos?'), 'runtime ainda lê alunos por REST direto');
assert.ok(!source.includes('/rest/v1/emusys_faturas?'), 'runtime ainda lê emusys_faturas por REST direto');
assert.ok(source.includes("sol_caixa_corrigir_movimento_v1"), 'correção V3 não está no runtime');
assert.ok(source.includes("sol_caixa_resolver_composto_aluno_v1"), 'composto não foi delegado à RPC canônica');
assert.ok(source.includes("correcao_forma_bloqueada_sem_v3"), 'modo sem V3 não falha fechado');

console.log('6/6 guardrails de rabiolas ok');
