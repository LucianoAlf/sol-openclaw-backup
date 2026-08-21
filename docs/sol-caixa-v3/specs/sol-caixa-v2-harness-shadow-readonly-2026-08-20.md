# Sol Caixa V2 - harness e shadow read-only

Data: 2026-08-20
Status: plano tecnico / sem implementacao viva

## Objetivo

Validar a V2 da Sol Caixa sem escrever no banco produtivo e sem enviar mensagem real para grupo.

O harness existe para provar:

- evento bruto normalizado;
- decisao separada de salvar/responder/escrever;
- autorizacao deterministica;
- resolucao canonica;
- preview persistido simulado;
- idempotencia/replay;
- comportamento de midia;
- comparacao contra fixture canonica e contra legado.

## Arquivos propostos

```text
sol-caixa-v2/
  fixtures/
    SCX-FX-001-laura-passaporte.json
    SCX-FX-002-perola-composto.json
    ...
  src/
    event_contract.cjs
    authorization.cjs
    media_state.cjs
    resolver_readonly.cjs
    preview_contract.cjs
    idempotency.cjs
    shadow_compare.cjs
  test/
    event_contract.test.cjs
    authorization.test.cjs
    media_state.test.cjs
    preview_contract.test.cjs
    idempotency.test.cjs
    shadow_compare.test.cjs
  reports/
    shadow-YYYY-MM-DD.json
```

## Inputs

- Fixtures sanitizadas: `outputs/sol-caixa-v2-fixtures-sanitizadas-2026-08-20.md`
- Eventos reais sanitizados extraidos dos logs, quando aprovados.
- Banco LA Report somente em leitura para resolver candidatos.
- Resultado legado apenas como comparativo.

## Saidas

Para cada fixture/evento:

```json
{
  "fixture_id": "SCX-FX-002",
  "contract_result": "pass|fail|manual_review",
  "event_decisions": {},
  "authorization_result": {},
  "resolver_result": {},
  "preview_result": {},
  "idempotency_result": {},
  "legacy_result": {},
  "divergence_class": "novo_correto_legado_errado|novo_errado_legado_correto|ambos_certos|ambos_errados|manual_review",
  "evidence": []
}
```

## Gates

### Gate A - contrato local

Obrigatorio antes de qualquer shadow:

- 20 fixtures carregam sem erro;
- valores em centavos;
- nenhuma fixture contem CPF/chave Pix/dado bancario;
- evento sem mencao nao responde nem escreve;
- dois previews + `pode` bloqueia por ambiguidade;
- ator desconhecido bloqueia escrita;
- grupo/unidade divergente bloqueia escrita;
- duplicate webhook vira um evento logico.

### Gate B - resolver read-only

Obrigatorio antes de preview real:

- resolver nao chama RPC de escrita;
- resolver bloqueia fonte indisponivel;
- resolver usa unidade do grupo;
- resolver nao usa valor/categoria do LLM como verdade final;
- resolver devolve `manual_review` quando ambiguidade nao for resolvida.

### Gate C - preview persistido simulado

Obrigatorio antes de qualquer preview em grupo:

- preview recebe `preview_id`;
- payload_hash e estavel;
- expiracao funciona;
- aprovacao repetida nao duplica;
- aprovacao em outro grupo rejeita;
- kill-switch bloqueia escrita mesmo com aprovacao.

### Gate D - shadow local/read-only

Obrigatorio antes de migration:

- rodar contra fixtures `ready`;
- classificar divergencias;
- gerar relatorio;
- zero chamadas de escrita;
- zero envio WhatsApp;
- zero restart.

## Shadow em producao futura

Quando Fase 1 for autorizada, o shadow deve rodar assim:

```text
evento real do grupo
  -> fluxo legado continua vivo
  -> fluxo V2 roda em paralelo read-only
  -> grava apenas relatorio interno de divergencia
  -> nao envia preview V2
  -> nao escreve caixa
```

Critérios minimos para sair do shadow:

- amostra minima definida pelo Alf;
- pelo menos 2 dias operacionais com CG/Recreio/Barra;
- zero divergencia critica em Pix/parcela simples;
- casos `manual_review` com motivo claro;
- nenhuma exposicao de dado sensivel;
- nenhum vazamento tecnico em texto publico;
- kill-switch testado.

## Bloqueios explicitos

Mesmo com harness verde, continuar bloqueado ate nova aprovacao:

- migration de tabelas novas;
- grants/revokes;
- ativacao `SOL_CAIXA_MODE=preview` em grupo;
- `SOL_CAIXA_MODE=write`;
- desligamento do monolito;
- cancelamento/estorno/correcao ampla;
- fechamento automatico pela V2.

