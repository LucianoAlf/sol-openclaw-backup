# Arquitetura — Sol Caixa V3

## Fluxo de escrita financeira

```text
WhatsApp
-> normalizacao/enriquecimento
-> grupo/unidade/ator canonicos
-> classificacao/intencao
-> preview V3 persistido
-> "pode"
-> approval V3 persistido
-> validator V3 no banco
-> consumo unico
-> RPC financeira
-> caixa_movimentacoes
```

## Regra dura

Classificacao nao escreve. Parser, regra deterministica, regex e LLM so podem gerar intencao ou preview.

Quem escreve e somente o trilho:

```text
preview persistido
-> approval persistido
-> validator fail-closed
-> consumo unico
-> RPC financeira
```

## Repositorio Sol x banco LA Report

O repositorio da Sol guarda:

- bridge;
- ingestao WhatsApp;
- midia/PDF/OCR;
- worker shadow/V3;
- harness;
- specs;
- testes;
- manifesto das migrations.

O banco LA Report guarda a verdade financeira atual:

- `caixa_movimentacoes`;
- RPCs financeiras;
- ledger V3 reaproveitando `sol_caixa_shadow_*`;
- consumo unico de approvals;
- autorizacao de grupo/ator.

O banco proprio da Sol pode guardar, em fase futura:

- estado operacional da agente;
- observabilidade;
- eventos brutos de ingestao;
- classificacao e regras deterministicas;
- comparacao shadow do parser novo contra parser antigo.

Nao migrar `caixa_movimentacoes` para outro banco sem plano explicito de migracao, dupla escrita, reconciliacao e rollback.

## Ledger V3

O nome fisico atual ainda usa `shadow_*`, mas o contrato foi formalizado para write financeiro:

- `sol_caixa_shadow_previews_v1`;
- `sol_caixa_shadow_approvals_v1`;
- `sol_caixa_shadow_registrar(jsonb)`;
- `sol_caixa_shadow_registrar_approval(jsonb)`;
- `sol_caixa_v3_approval_consumos_v1`;
- `sol_caixa_v3_validar_approval_v1`.

Decisao: criar tabela nova nao e obrigatorio so por nome. O obrigatorio e que a mutacao financeira nao passe sem approval valido.

## Escopo fail-closed atual

Incluido:

- entrada;
- saida;
- correcao de movimento;
- estorno.

Fora por enquanto:

- abertura;
- fechamento.
