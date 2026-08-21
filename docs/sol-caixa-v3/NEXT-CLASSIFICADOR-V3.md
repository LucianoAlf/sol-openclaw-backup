# Proximo Passo — Classificador V3

Objetivo: tirar a inteligencia financeira do parser antigo/monolito sem mexer ainda no write financeiro.

## Ordem aprovada

```text
1. Deterministico
2. Regex como sugestao
3. LLM + skill quando necessario
4. Preview V3
5. Pode
6. Approval V3
7. Validator/consumo unico
8. RPC financeira
```

## Peca faltante

`public.sol_classificacao_regras` ainda nao existe como camada ativa.

## Contrato da tabela

Campos esperados:

- `codigo`;
- `escopo`: `fluxo` ou `geral`;
- `ativo`;
- `prioridade`;
- `confianca`;
- `palavra_chave` ou padrao normalizado;
- `operacao`;
- `categoria`;
- `forma`;
- `campos_obrigatorios`;
- `versao`;
- `vigencia`;
- `created_at`;
- `updated_at`.

## Facade intent-only

Criar:

```text
sol_caixa_v3_classificar_evento(jsonb)
```

Responsabilidades:

- receber texto normalizado e contexto;
- aplicar regras deterministicas;
- devolver intencao estruturada;
- sinalizar ambiguidade;
- nunca chamar RPC financeira;
- nunca criar approval;
- nunca escrever em `caixa_movimentacoes`.

Estados:

```text
observed
classified
previewed
awaiting_approval
approved
consumed
executed
ambiguous
missing_evidence
media_pending
manual_review
rejected
unsupported
```

## Exemplos de intencao

```json
{
  "stage": "deterministic",
  "rule_code": "forma_pix",
  "operacao": "correcao_forma",
  "forma": "pix",
  "confidence": 1,
  "evidence": ["foi pix"],
  "requires": ["movimentacao_id"]
}
```

```json
{
  "stage": "deterministic",
  "rule_code": "saida_seguranca_dinheiro",
  "operacao": "saida",
  "categoria": "seguranca",
  "forma": "dinheiro",
  "confidence": 0.95,
  "requires": ["valor_centavos"]
}
```

## Rollout correto

1. Criar tabela e facade.
2. Rodar classificador novo em shadow.
3. Comparar intencao nova contra parser antigo.
4. Registrar divergencias.
5. Promover para canario.
6. Manter parser antigo como fallback controlado.
7. Apos casos reais, aposentar o parser velho como autoridade.

## Nao fazer

- Regra deterministica nao escreve.
- Regex nao decide verdade; sugere.
- LLM nao escolhe unidade.
- LLM nao chama RPC financeira.
- Nao ligar `STRICT=1` ate caso vivo com consumo real.

## Fase 1 local — 2026-08-21

Artefatos criados em `classificador-v3/`:

- migration draft `001_sol_classificacao_regras_draft.sql`;
- facade intent-only `002_sol_caixa_v3_classificar_evento_draft.sql`;
- schema JSON de intencao `intent.schema.json`;
- fixtures locais dos 3 grupos `sol-caixa-v3-classificador-fixtures.json`;
- runner local `gate-classificador-v3-local-runner.mjs`;
- report `gate-classificador-v3-local-2026-08-21.json`.

Resultado do gate local:

```text
fixture_count: 8
passed: 8
failed: 0
database_migrations_applied: false
whatsapp_deploy: false
strict_changed: false
financial_mutations: 0
```

Proximo passo: revisar o contrato e, se aprovado, aplicar a migration em ambiente controlado para rodar shadow comparison contra o parser antigo.
