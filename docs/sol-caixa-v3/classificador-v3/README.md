# Classificador V3 — Fase 1 Local

Objetivo: tirar a classificacao financeira do parser antigo sem mexer no write financeiro.

Esta fase e apenas contrato local/draft:

- nao aplica migration em producao;
- nao reinicia bridge/gateway;
- nao cria preview;
- nao cria approval;
- nao chama RPC financeira;
- nao escreve em `caixa_movimentacoes`.

## Pecas

- `001_sol_classificacao_regras_draft.sql`: migration draft da tabela aditiva/versionada.
- `002_sol_caixa_v3_classificar_evento_draft.sql`: facade intent-only em SQL.
- `intent.schema.json`: contrato JSON da intencao.
- `sol-caixa-v3-classificador-fixtures.json`: casos locais dos 3 grupos.
- `gate-classificador-v3-local-runner.mjs`: runner local sem banco/WhatsApp.

## Reprodutibilidade

O runner nao altera arquivos versionados. Por padrao ele grava o report em um
diretorio temporario; para escolher o destino, use `--out /caminho/report.json`.

O gate atual valida apenas o contrato local. A facade SQL, os helpers canonicos
de grupo/unidade/ator e a comparacao com o parser legado real ainda exigem
ambiente controlado antes de qualquer migration.

## Rollout

1. Shadow: classificador novo observa, parser antigo continua autoridade.
2. Comparacao: match/divergencia/ambiguidade/campos faltantes/midia pendente.
3. Canario: classificador vira autoridade apenas em grupos allowlisted.
4. Producao: sem fallback silencioso para mutacao; divergencia vira `manual_review`.

## Regra central

Deterministico encerra a classificacao, nao encerra o gate financeiro. Todo write continua no trilho:

```text
preview V3 -> pode -> approval V3 -> validator -> consumo unico -> RPC financeira
```
