# Sol Caixa V3 - Fase 1 local / Gate A, Gate B e Gate C

Data: 2026-08-20
Status: Gate A, Gate B e Gate C executados localmente

## Escopo

Este diretorio contem apenas contrato local da V3.

Nao toca:

- banco LA Report;
- WhatsApp;
- parser/bridge vivo da Sol;
- config;
- migration;
- grants;
- dados financeiros reais.

## Arquivos

```text
fixtures/sol-caixa-v3-fixtures.json
runner/gate-a-runner.mjs
runner/gate-b-runner.mjs
runner/gate-c-runner.mjs
reports/gate-a-report-2026-08-20.json
reports/gate-b-report-2026-08-20.json
reports/gate-c-report-2026-08-20.json
```

## Como rodar

```bash
node outputs/sol-caixa-v3-harness/runner/gate-a-runner.mjs
node outputs/sol-caixa-v3-harness/runner/gate-b-runner.mjs
node outputs/sol-caixa-v3-harness/runner/gate-c-runner.mjs
```

## Resultado atual

```text
Gate A PASS
20 fixtures carregadas
0 falhas
9 avisos needs_evidence
efeitos colaterais zero
```

```text
Gate B PASS_WITH_WARNINGS
20 fixtures no contrato local
10 evidence_ready
10 needs_evidence
20 fixture_expected_matches
0 divergencias contra expected das fixtures
efeitos colaterais zero
```

```text
Gate C PASS_WITH_WARNINGS
20 fixtures no contrato local
10 previews simulados
3 aprovacoes simuladas
expiracao, outro grupo, ambiguidade, replay e concorrencia testados
efeitos colaterais zero
```

## O que o Gate A valida

- schema V3 das fixtures;
- enums canonicos;
- evento bruto sem `approved` e sem decisoes derivadas;
- decisao derivada sem aprovacao;
- `amount_cents` inteiro ou `null`;
- mensagem sem mencao em standby nao responde nem escreve;
- identidade desconhecida nao responde nem escreve;
- dois previews + `pode` vira ambiguidade;
- duplicate webhook vira um evento logico;
- legado nao e oraculo;
- contadores de efeito colateral todos zero.

## O que o Gate B valida

- resolver local/read-only sobre fixtures;
- unidade derivada de `group_jid`;
- rota financeira inativa vira `manual_review`/`blocked`;
- fonte indisponivel bloqueia ou vai para revisao manual;
- legado usado somente como comparacao;
- `fixture_expected_matches` separado de validacao canonica real.

## O que o Gate C valida

- preview simulado sem persistir no LA Report;
- approval ledger simulado;
- aprovacao aceita com um preview no mesmo grupo;
- aprovacao ambigua com dois previews;
- aprovacao em outro grupo rejeitada;
- preview expirado rejeita aprovacao;
- duplicate webhook vira um evento logico;
- concorrencia/idempotencia: duas aprovacoes do mesmo preview geram uma aceita e uma duplicada ignorada;
- contadores de efeito colateral todos zero.

## Proximo passo

Gate B real/read-only contra LA Report, somente com autorizacao explicita: papel real identificado, sem `service_role`, sem RPC de mutacao, sem persistir evento/preview/midia e sem envio WhatsApp.
