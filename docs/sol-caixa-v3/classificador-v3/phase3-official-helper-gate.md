# Fase 3 — Contrato dos helpers canônicos

## Objetivo

Fechar localmente a assinatura real dos helpers do Caixa antes de qualquer
migration controlada:

```text
sol_caixa_grupo_operacao_ok(uuid,text,text) returns jsonb
sol_caixa_ator_operacao_ok(uuid,text,text) returns jsonb
```

O retorno relevante é `autorizado`. Ausência, `false` ou formato inesperado
sempre viram `manual_review` — nunca classificação autorizada.

## O que este gate prova

- a facade compila contra helpers que retornam `jsonb`, não `boolean`;
- o grupo oficial é validado antes do ator;
- grupo negado, ator negado e retorno sem `autorizado` falham fechados;
- nenhuma migration de produção, preview, approval, RPC financeira ou WhatsApp
  é chamado.

## O que este gate não prova

Os helpers são stubs de contrato em PostgreSQL efêmero. A próxima etapa ainda
precisa de uma branch/controlado do Supabase com os **helpers oficiais** e as
políticas reais já migradas. Não executar os testes de fixture no LA Report
produtivo.

## Reprodução

```bash
node phase3-official-helper-contract-runner.mjs
```

O runner usa `postgres:16-alpine`, destrói o container ao finalizar e grava o
report em diretório temporário por padrão.

## Ordem do rollout

1. Fase 3 local: contrato JSONB dos helpers — este artefato.
2. Ambiente controlado Supabase: helpers oficiais, sem dados produtivos.
3. Shadow no bridge real: classificador novo observa; parser antigo continua
   autoridade.
4. Só depois: pedido de migration controlada.
