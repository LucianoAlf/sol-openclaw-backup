# Spec v2 auditada - Sol Caixa dominio canonico

Data: 2026-08-20
Status: Fase 0 / Fase 1 read-only aprovadas; producao bloqueada
Dono executivo: Alf
Dono tecnico: Alfredo
Escopo: arquitetura nova da Sol para caixa operacional nos grupos financeiros

## 0. Decisao desta versao

Esta v2 substitui a spec v1 como documento de trabalho.

A v1 serviu como direcao. Esta v2 incorpora:

- auditoria real do padrao Maria;
- auditoria read-only do banco LA Report/Sol Caixa;
- contraponto da Sol no Telegram;
- incidentes reais de regressao da Sol;
- contrato de evento, preview, autorizacao, midia e idempotencia;
- fixtures sanitizadas obrigatorias;
- fase de shadow read-only antes de qualquer escrita.

Nao esta aprovado nesta fase:

- migration em producao;
- GRANT/REVOKE em producao;
- restart operacional;
- ativacao de escrita;
- envio real de preview novo para grupo;
- desligamento do parser atual;
- cancelamento, estorno ou correcao ampla;
- qualquer alteracao financeira real.

## 1. Referencia Maria auditada

Arquivos auditados:

- `audits/folha-pagamento-la/Docs/security/maria-whatsapp-db-contract-20260625.md`
- `audits/folha-pagamento-la/supabase/migrations/20260625_maria_whatsapp_security_model.sql`
- `audits/folha-pagamento-la/supabase/migrations/20260628_6_maria_contas_dar_baixa_owner_full.sql`
- `audits/folha-pagamento-la/supabase/migrations/20260725_maria_comprovantes_contas_pagar.sql`
- `audits/folha-pagamento-la/supabase/migrations/20260725_2_maria_comprovantes_hardening.sql`
- `tmp/maria-audit/bridge.js`

Padroes da Maria que a Sol deve copiar:

1. **Identidade entra em toda RPC operacional.**
   Maria recebe `p_ator_numero`, `p_papel`, `p_canal`, `p_texto_original`, `p_motivo`.

2. **Ator e papel sao validados no banco.**
   `maria_assert_actor(...)` confere sender contra `maria_whatsapp_atores`, por hash de telefone,
   e valida papel permitido para a operacao.

3. **Mutacao e estreita.**
   Uma RPC corrige valor; outra vencimento; outra status; outra plano; outra comprovante.
   A Maria nao recebe CRUD generico.

4. **Toda escrita tem auditoria antes/depois.**
   `maria_audit_insert(...)` registra ator, papel, canal, tabela, entidade, operacao, antes,
   depois, motivo e texto original.

5. **Comprovante e evidencia.**
   `financeiro_documentos` guarda hash, storage/ref, MIME, tamanho, metadata e status.
   Delete/truncate sao bloqueados; rejeicao passa por RPC auditada.

6. **Confirmacao humana vira acao pendente vinculada.**
   A bridge da Maria persiste propostas pendentes, usa idempotency key, aceita confirmacao citada
   e bloqueia quando a proposta nao pertence ao grupo.

7. **Mensagem publica nao expõe detalhe tecnico.**
   Maria tem sanitizacao para evitar UUID, audit_id, caminho local e detalhes internos no WhatsApp.

Conclusao: a Sol nao precisa copiar codigo da Maria. Precisa copiar o modelo:

```text
bridge identifica e empacota
  -> regra/skill gera intencao
  -> RPC estreita resolve/valida
  -> preview persistido
  -> confirmacao vinculada
  -> RPC estreita escreve
  -> auditoria antes/depois
```

## 2. Banco Sol Caixa auditado

Consulta read-only feita no LA Report.

Tabelas relevantes existentes:

- `caixas_diarios`
- `caixa_movimentacoes`
- `caixa_financeiro_grupos_whatsapp`
- `sol_caixa_ingestao_recebimentos`
- `sol_caixa_lancamento_auditoria`
- `sol_caixa_autorizados`
- `sol_caixa_unidade_policy`
- `sol_caixa_abertura_pendente`

RPCs existentes relevantes:

- `sol_caixa_abrir(p_payload jsonb)`
- `sol_caixa_fechar(p_payload jsonb)`
- `sol_caixa_lancar_recebimento(p_payload jsonb)`
- `sol_caixa_lancar_saida(p_payload jsonb)`
- `sol_caixa_corrigir_forma_recebimento(p_payload jsonb)`
- `sol_caixa_buscar_lancamento_para_correcao(p_payload jsonb)`
- `sol_caixa_ingestao_registrar(p_payload jsonb)`
- `sol_caixa_quem_e(p_telefone, p_unidade_id)`
- `sol_caixa_resumo_do_dia(p_unidade_id, p_data)`
- `sol_caixa_casar_parcela(...)`
- `sol_caixa_parcela_canonica(...)`
- `sol_caixa_pendencia_*`

Achados:

- A Sol ja tem varias RPCs pontuais e auditadas parcialmente.
- A maioria das RPCs de escrita recebe `p_payload jsonb`, nao argumentos canonicos.
- `sol_caixa_ingestao_recebimentos` existe, mas ainda mistura inbox, preview parcial e status de
  lancamento. Nao e preview canonico persistido.
- `sol_caixa_lancamento_auditoria` existe, mas nao substitui preview/approval ledger.
- Nos ultimos 14 dias, `sol_caixa_ingestao_recebimentos` tinha 179 registros `recebido` e 34
  `ignorado/midia_nao_financeira`.
- Nos ultimos 14 dias, auditoria tinha resultados como `lancado`, `aberto`, `fechado`,
  `fechar_recusado`, `saida_recusada`.
- `sol_caixa_autorizados` estava vazio.
- `sol_caixa_unidade_policy` tinha 3 unidades com `autoriza_qualquer_membro=true`.
- `sol_acesso_restrito` tem SELECT em tabelas do caixa e EXECUTE somente em algumas RPCs de consulta
  (`sol_caixa_quem_e`, `sol_caixa_resumo_do_dia`), enquanto escrita roda via `service_role`.

Conclusao: a base atual e aproveitavel, mas nao e suficiente para V2. O buraco principal nao e
falta de RPC; e falta de contrato canonico entre evento, preview, aprovacao e escrita.

## 3. Problemas que a V2 precisa resolver

1. Preview nao pode ser opcional.
2. `pode` precisa apontar para um alvo exato.
3. Autorizacao precisa ser deterministica por pessoa/unidade/operacao.
4. Salvar, responder e escrever sao decisoes separadas.
5. Unidade deve vir do mapa canonico `grupo_jid -> unidade_id`.
6. Midia precisa ter estado, retry, hash e revisao manual.
7. RPC de escrita nao pode confiar em campo vindo do LLM/bridge.
8. Abertura e fechamento precisam de contrato proprio ou sair da V1.
9. Correcao/cancelamento/estorno ficam fora da primeira escrita.
10. Shadow nao compara somente com legado; compara com fixture canonica.
11. Flags precisam falhar fechadas.
12. WhatsApp nao pode expor dado sensivel nem detalhe tecnico.

## 4. Contrato de evento bruto

Todo evento financeiro candidato deve virar um envelope versionado antes de qualquer decisao.

Nome proposto: `SolCaixaEventoBrutoV1`.

Campos obrigatorios:

```json
{
  "schema_version": "sol_caixa_evento_bruto_v1",
  "event_id": "uuid",
  "source": {
    "provider": "whatsapp",
    "runtime": "hermes",
    "instance_id": "sol",
    "bridge_version": "string"
  },
  "direction": "inbound",
  "event_type": "text|media|quoted_reply|reaction|system",
  "received_at": "timestamptz",
  "received_at_tz": "America/Sao_Paulo",
  "chat": {
    "chat_id": "text",
    "grupo_jid": "text",
    "grupo_nome": "text",
    "unidade_id": "uuid",
    "unidade_nome": "text",
    "unit_source": "canonical_group_map"
  },
  "sender": {
    "numero_raw": "text",
    "numero_normalizado_hash": "sha256",
    "numero_last4": "text",
    "nome_exibicao": "text",
    "quem_eh": "resolved|unresolved",
    "ator_id": "uuid|null",
    "papel": "text|null"
  },
  "message": {
    "message_id": "text",
    "text": "text",
    "quoted_message_id": "text|null",
    "quoted_text_excerpt": "text|null"
  },
  "media": {
    "has_media": true,
    "artifact_id": "text|null",
    "media_hash": "sha256|null",
    "mime_type": "text|null",
    "size_bytes": "integer|null",
    "provider_model": "text|null"
  },
  "decisions": {
    "ingest_decision": "save|ignore",
    "mention_detected": true,
    "conversation_window": "active|closed",
    "response_decision": "none|reply",
    "write_decision": "none|await_approval|approved",
    "authorization_decision": "allowed|denied|unknown",
    "trigger": "mention|window|approval|none"
  },
  "idempotency": {
    "message_key": "chat_id:message_id",
    "event_hash": "sha256"
  }
}
```

Regras:

- Mensagem comum sem mencao em standby: salva se for relevante, nao responde, nao escreve.
- `grupo_jid -> unidade_id` vem de mapa canonico no servidor, nunca de texto.
- `quem_eh=unresolved` pode registrar inbox, mas nao aprova, nao corrige, nao fecha e nao lanca.
- Caminho local de arquivo nao entra no contrato publico; usar `artifact_id` opaco.

## 5. Maquina de estado de midia

Nome proposto: `sol_caixa_media_artifacts`.

Estados:

- `received`
- `downloaded`
- `hash_verified`
- `processing`
- `processed`
- `retrying`
- `manual_review`
- `failed`

Campos minimos:

- `artifact_id`
- `event_id`
- `chat_id`
- `message_id`
- `media_hash`
- `mime_type`
- `size_bytes`
- `provider`
- `model`
- `attempt_count`
- `last_error_code`
- `last_error_message_sanitized`
- `next_retry_at`
- `processed_payload`
- `manual_review_reason`
- `retention_until`
- `created_at`
- `updated_at`

Regras:

- PDF/documento nao fica pendente para sempre.
- HTTP 429 ou falta de credito vira retry/backoff e depois manual review.
- Erro tecnico nunca aparece cru no grupo.
- Restart depois de receber midia deve retomar pelo estado persistido, sem duplicar.

## 6. Preview persistido obrigatorio

Nome proposto: `sol_caixa_previews`.

Estados:

- `created`
- `awaiting_approval`
- `approved`
- `rejected`
- `expired`
- `written`
- `failed`
- `manual_review`

Campos minimos:

- `preview_id`
- `schema_version`
- `event_id`
- `grupo_jid`
- `unidade_id`
- `message_id`
- `approval_message_id`
- `approved_by`
- `approved_at`
- `expires_at`
- `operation`: `entrada|saida|abrir|fechar|corrigir_forma|manual_review`
- `categoria`
- `forma_pagamento`
- `valor_centavos`
- `moeda`
- `aluno_ref`
- `componentes_json`
- `evidencias_json`
- `payload_hash`
- `preview_version`
- `status`
- `idempotency_key`
- `created_at`
- `updated_at`

Regras:

- Preview sem persistencia nao existe.
- Um `pode` so confirma um preview se o alvo for unico e nao ambiguo.
- Dois ou mais previews pendentes no mesmo grupo exigem pergunta de desambiguacao.
- Preview expirado bloqueia escrita.
- Aprovacao repetida nao gera segundo lancamento.
- Aprovacao em outro grupo/unidade e rejeitada.

## 7. Contrato de aprovacao

Nome proposto: `sol_caixa_approvals`.

Campos minimos:

- `approval_id`
- `preview_id`
- `approval_message_id`
- `approval_chat_id`
- `approval_sender_hash`
- `approval_sender_last4`
- `approval_sender_name`
- `authorization_decision`
- `authorization_reason`
- `approved_operation`
- `approved_value_centavos`
- `approved_payload_hash`
- `created_at`

Regra de ouro:

`pode` nunca significa "aprove a ultima coisa que a Sol lembra". Significa "aprove este
`preview_id` nesta unidade, neste grupo, com este valor, esta operacao, esta forma e este autor".

## 8. Autorizacao

A v2 precisa trocar autorizacao generica por matriz explicita.

Fontes atuais:

- `sol_caixa_quem_e(p_telefone, p_unidade_id)` identifica colaborador/permissao.
- `sol_caixa_unidade_policy.autoriza_qualquer_membro` hoje esta true para 3 unidades.
- `sol_caixa_autorizados` esta vazio.

Decisao proposta:

- Fase 0 registra a matriz real sem mudar o banco.
- V2 define operacoes separadas:
  - `consultar`
  - `preview`
  - `aprovar_lancamento`
  - `corrigir_forma`
  - `cancelar`
  - `estornar`
  - `abrir_caixa`
  - `fechar_caixa`
- `qualquer_membro_do_grupo` pode continuar como politica temporaria onde Alf ja aprovou, mas deve
  aparecer explicitamente como risco aceito por unidade e operacao.
- Identidade desconhecida: `save=yes`, `reply=maybe`, `write=no`.

## 9. RPCs canonicas V2

Primeira leva read-only / preview:

- `sol_caixa_evento_registrar_v1(p_evento jsonb)`
- `sol_caixa_media_registrar_v1(p_media jsonb)`
- `sol_caixa_resolver_recebimento_v1(p_event_id uuid)`
- `sol_caixa_preview_criar_v1(p_event_id uuid, p_resolver_result jsonb)`
- `sol_caixa_preview_buscar_pendente_v1(p_chat_id text, p_message_id text default null)`

Primeira leva de escrita futura, ainda bloqueada:

- `sol_caixa_lancar_movimento_v1(p_preview_id uuid, p_approval_id uuid, p_idempotency_key text)`
- `sol_caixa_abrir_v1(p_preview_id uuid, p_approval_id uuid, p_idempotency_key text)`
- `sol_caixa_fechar_v1(p_preview_id uuid, p_approval_id uuid, p_idempotency_key text)`

Fora da primeira escrita:

- `sol_caixa_corrigir_movimento_v1`
- `sol_caixa_cancelar_movimento_v1`
- `sol_caixa_estornar_movimento_v1`

Regra das RPCs de escrita:

- Recebem `preview_id`, `approval_id`, `idempotency_key`, `approval_message_id`.
- Releem o preview persistido dentro da transacao.
- Revalidam status, expiracao, grupo, unidade, ator, payload_hash, valor e operacao.
- Nao aceitam valor/categoria/unidade/aluno como verdade vindos do LLM.
- Usam valor em centavos inteiros ou decimal textual, nunca float JS.
- Registram auditoria antes/depois.

## 10. Modo e kill-switch

Usar uma flag unica:

```text
SOL_CAIXA_MODE=legacy|shadow|preview|write
```

Regras:

- valor ausente/invalido -> `legacy` ou `disabled`, nunca `write`;
- `shadow` nunca chama RPC de escrita;
- `preview` pode montar preview interno/sandbox, mas nao envia para grupo sem gate explicito;
- `write` so funciona com todas as pre-condicoes aprovadas;
- kill-switch deve impedir escrita mesmo com mensagem, aprovacao e retry concorrente;
- toda troca de modo precisa gerar auditoria.

## 11. Escopo de primeira escrita futura

Quando chegar a hora de escrever, a primeira janela deve ser estreita:

- Pix simples;
- dinheiro simples;
- parcela simples;
- valor igual ao preview;
- unidade derivada do grupo;
- sem alteracao de aluno;
- sem alteracao de competencia;
- sem alteracao de unidade;
- sem cancelamento;
- sem estorno;
- sem composto;
- sem lojinha;
- sem passaporte;
- sem saida operacional.

O resto entra depois, uma fatia por vez.

## 12. Fixtures sanitizadas obrigatorias

Criar fixtures sem dados sensiveis, com nomes mascarados quando necessario.

Fixtures de casos reais:

1. Laura / Recreio / passaporte promocional.
2. Perola / Campo Grande / parcela + passaporte composto.
3. Vinicius / banda adicional.
4. Arthur / Barra / lojinha / corda.
5. Pedro / duas mensalidades / dois cursos.
6. Davi / fonte indisponivel / sem fallback legado.
7. Seguranca / saida operacional em dinheiro.
8. Pix vs cartao debito / correcao de forma.
9. Parcela Recreio que virou lojinha.
10. Fechamento direto `Sol, pode fechar o caixa`.
11. `pode Sol` e `Sol pode`.
12. Mensagem comum sem mencao em standby.
13. Dois previews simultaneos + `pode`.
14. `pode` em outro grupo.
15. Autor sem identidade resolvida.
16. Unidade no texto diferente da unidade do grupo.
17. Restart apos receber midia antes do OCR.
18. PDF/documento nao suportado.
19. HTTP 429/falta de credito no provedor.
20. Duplicate webhook / retry / idempotency.

Cada fixture deve ter:

- evento bruto sanitizado;
- expected event decisions;
- expected resolver result;
- expected preview;
- expected public reply;
- expected write decision;
- legacy result, quando existir, apenas como referencia de divergencia.

## 13. Shadow read-only

Shadow so comeca depois de:

- contrato de evento fechado;
- fixtures sanitizadas criadas;
- harness local passando;
- resolver read-only implementado/testado;
- autorizacao simulada passando;
- idempotencia/replay passando.

Comparacoes do shadow:

1. novo resultado vs fixture canonica esperada;
2. novo resultado vs legado;
3. divergencia classificada:
   - `novo_correto_legado_errado`
   - `novo_errado_legado_correto`
   - `ambos_errados`
   - `ambos_certos`
   - `manual_review`

Legado nao e oraculo.

## 14. Checklist de Fase 0

Pode fazer agora, sem nova aprovacao:

- inventario de Maria;
- inventario de Sol/banco/RPCs;
- contrato de evento;
- contrato de preview;
- contrato de midia;
- contrato de autorizacao;
- contrato de idempotencia;
- fixtures sanitizadas;
- harness local;
- shadow local/read-only;
- testes de replay;
- testes de privilegio read-only;
- relatorio de divergencias.

Tem que parar antes de:

- migration;
- grant/revoke;
- restart;
- escrita;
- preview real em grupo;
- troca de fluxo vivo;
- desligar monolito;
- retificar dado financeiro antigo;
- cancelar/estornar.

## 15. Proximo artefato

Depois desta spec, o proximo arquivo deve ser:

`outputs/sol-caixa-v2-fixtures-sanitizadas-2026-08-20.md`

Conteudo esperado:

- uma tabela com os 20 casos;
- payload de entrada sanitizado;
- resultado esperado;
- status da fixture: `draft|ready|needs_evidence`;
- fonte: memoria, teste local, auditoria DB ou print do Alf.

So depois disso vem o harness.

