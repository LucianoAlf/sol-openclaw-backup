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

## Fase 2 controlada

Os artefatos `003_*` e `phase2-*` introduzem matcher por token e preveem a
validacao com os helpers oficiais de grupo e ator. Eles foram executados em
PostgreSQL efemero com stubs de mesma assinatura; isto prova a SQL, mas nao
substitui a execucao futura contra os helpers oficiais. O comparador do parser
usa o snapshot versionado e marca cobertura ausente como `legacy_not_exposed`,
nunca como equivalencia.

## Fase 3 — contrato dos helpers oficiais

O catálogo do LA Report confirmou que os dois helpers canônicos retornam
`jsonb`, não `boolean`. O artefato `004_*` e o runner `phase3-*` validam esse
contrato em PostgreSQL efêmero e falham fechados quando `autorizado` está
ausente ou falso. Isso ainda não substitui executar os **helpers oficiais** em
uma branch/controlado Supabase.

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
