# Spec v3 - Sol Caixa dominio canonico

Data: 2026-08-20
Status: Spec v3 / Fase 0 corrigida; Fase 1 local liberada; producao bloqueada
Dono executivo: Alf
Dono tecnico: Alfredo
Escopo: arquitetura nova da Sol para ingestao, preview, aprovacao, escrita e auditoria do caixa operacional

## 0. Decisao desta versao

Esta v3 substitui a v2 como documento de trabalho.

A v2 foi aprovada como direcao arquitetural, mas a revisao da Sol apontou ajustes corretos antes de considerar a Fase 0 fechada. Esta v3 incorpora o que faz sentido:

- evento bruto separado de decisoes derivadas;
- remocao de `approved` do evento bruto;
- preview persistido obrigatorio e criado a partir de resolver revalidado;
- `pode` vinculado a `preview_id` e `approval_id`;
- matriz explicita de autorizacao por unidade e operacao;
- identidade desconhecida salva contexto, mas nao responde nem escreve;
- V2/V3 viva sem `service_role` no bridge;
- fixtures sequenciais para replay, restart, dois previews e concorrencia;
- harness com contadores obrigatorios de zero efeito colateral;
- criterio de unidade baseado somente em mapa canonico de grupo;
- cobertura por rotas financeiras ativas, nao por suposicao de tres unidades;
- criterios de avanco com amostra minima e invariantes, nao apenas "2 dias sem divergencia".

Continua nao aprovado nesta fase:

- migration em producao;
- GRANT/REVOKE em producao;
- restart operacional;
- ativacao de escrita;
- preview V3 real enviado para grupo;
- troca do fluxo vivo;
- desligamento do monolito atual;
- cancelamento, estorno ou correcao ampla;
- fechamento automatico pela V3;
- qualquer alteracao financeira real.

Liberado sem novo pedido de aprovacao:

- inventario;
- contrato local;
- fixtures sanitizadas executaveis;
- harness local;
- resolver read-only;
- testes de privilegio;
- testes de replay/idempotencia;
- relatorio de divergencias local ou em area restrita sem efeito financeiro.

## 1. O que entrou do contraponto da Sol

### Aceito integralmente

1. **"Read-only" estava mal nomeado.**
   A fase local e read-only para o LA Report. Shadow futuro pode persistir relatorio restrito, mas deve ser chamado de "sem efeito financeiro", nao read-only puro.

2. **Evento bruto nao pode conter `approved`.**
   Evento bruto e fato observado. Aprovacao nasce no approval ledger.

3. **Preview nao pode confiar em `resolver_result` livre.**
   O preview deve ser criado por `event_id + resolver_run_id`, ou a RPC deve revalidar tudo no servidor.

4. **Autorizacao precisa de matriz explicita.**
   `autoriza_qualquer_membro=true` encontrado no legado e diagnostico, nao politica automaticamente aprovada para V3.

5. **Identidade desconhecida falha fechado.**
   Regra V3: `save=yes`, `reply=no`, `write=no`.

6. **Bridge V3 nao roda com `service_role`.**
   `service_role` pode existir no legado/diagnostico, mas nao na arquitetura viva nova.

7. **Fixtures v2 ainda eram draft.**
   Casos sequenciais precisam de `setup`, `events`, `expected_final_state` e `expected_effects`.

8. **Harness precisa provar zero efeito colateral.**
   Zero escrita, zero envio WhatsApp, zero mutacao financeira, zero chamada externa nao autorizada.

9. **Recreio nao entra por suposicao.**
   Entra somente se existir rota financeira ativa: JID canonico, unidade canonica, allowlist e politica de autorizacao.

10. **"Dois dias sem divergencia" e criterio fraco sozinho.**
    Fica como complemento, com amostra minima e invariantes.

### Aceito com ajuste

- A Sol pediu separar `write_decision` do evento bruto. Concordo. Mas ainda precisamos guardar decisoes derivadas em um artefato versionado para auditoria e replay. Portanto, a V3 cria `SolCaixaDecisionV1`, que nao e evento bruto e nao tem autoridade de aprovacao.

- A Sol apontou `PUBLIC EXECUTE`/papel restrito como requisito. Concordo para V3 viva. Na Fase 1 local, isso nao bloqueia harness/fixtures/resolver read-only, porque nada escreve e nada recebe grant em producao.

### Nao incorporado agora

- Nao vamos exigir cobertura artificial das tres unidades antes de existir rota financeira canonica para todas.
- Nao vamos liberar correcao ampla, cancelamento ou estorno na primeira escrita.
- Nao vamos trocar a arquitetura inteira em producao enquanto o harness nao existir.

## 2. Modos de operacao

Usar uma unica flag de modo:

```text
SOL_CAIXA_MODE=legacy|shadow_local|shadow_report|preview|write
```

Regras:

- valor ausente ou invalido: `legacy`;
- `legacy`: fluxo atual continua vivo;
- `shadow_local`: roda apenas fixtures/runner local; nao toca LA Report, nao envia WhatsApp;
- `shadow_report`: fluxo V3 observa eventos reais, mas grava apenas relatorio restrito aprovado; nao escreve caixa e nao envia preview V3;
- `preview`: V3 pode gerar preview publico, mas ainda nao escreve caixa;
- `write`: V3 escreve por RPC canonica apos approval ledger e todos os gates;
- kill-switch deve derrubar `preview` e `write` para `legacy` ou `disabled`;
- toda troca de modo precisa registrar auditoria operacional;
- `write` so inicia se todos os gates estiverem verdes.

## 3. Arquitetura alvo

Fluxo canonico:

```text
WhatsApp/Hermes
  -> bridge monta evento bruto, sem decidir dinheiro
  -> evento bruto e registrado/simulado
  -> decisor derivado classifica salvar/responder/candidatar escrita
  -> media state processa OCR/documento
  -> resolver run consulta fontes canonicas
  -> preview persistido e criado/revalidado no servidor
  -> approval ledger recebe "pode" vinculado ao preview
  -> RPC de escrita revalida preview + approval + idempotencia
  -> movimento e escrito
  -> auditoria antes/depois
  -> resposta publica sanitizada
```

Principios:

- bridge nao decide categoria financeira;
- texto do LLM e sugestao, nunca fonte de verdade;
- unidade vem do grupo canonico;
- valor monetario em centavos inteiros ou decimal textual, nunca float JavaScript;
- preview persistido e fonte de verdade entre interpretacao e aprovacao;
- escrita nao aceita payload livre do agente;
- toda escrita e idempotente e auditada;
- mensagem publica nao mostra SQL, RPC, schema, path local, erro tecnico, CPF, Pix completo ou dados bancarios.

## 4. Evento bruto v3

Nome: `SolCaixaEventoBrutoV1`

Evento bruto contem fatos observados. Nao contem aprovacao, autorizacao final ou decisao de escrita como autoridade.

```json
{
  "schema_version": "sol_caixa_evento_bruto_v1",
  "event_id": "uuid",
  "source": {
    "provider": "whatsapp",
    "runtime": "hermes",
    "instance_id": "sol",
    "bridge_version": "string",
    "whatsapp_instance_id": "string"
  },
  "direction": "inbound",
  "event_type": "text|media|quoted_reply|reaction|system",
  "received_at_utc": "timestamptz",
  "business_timezone": "America/Sao_Paulo",
  "chat": {
    "chat_id": "text",
    "grupo_jid": "text",
    "grupo_nome": "text",
    "chat_type": "group|dm",
    "canonical_unit_source": "group_jid_map",
    "unidade_id": "uuid|null",
    "unidade_nome": "text|null"
  },
  "sender": {
    "sender_ref": "sanitized",
    "numero_normalizado_hash": "sha256|null",
    "numero_last4": "text|null",
    "nome_exibicao": "text|null",
    "identity_status": "resolved|unresolved",
    "ator_id": "uuid|null",
    "papel_observado": "text|null"
  },
  "message": {
    "message_id": "text",
    "text_sanitized": "text",
    "quoted_message_id": "text|null",
    "quoted_text_excerpt": "text|null",
    "mention_detected": true,
    "trigger_observed": "mention|window|approval_word|none"
  },
  "media": {
    "has_media": true,
    "artifact_id": "text|null",
    "media_hash": "sha256|null",
    "mime_type": "text|null",
    "size_bytes": "integer|null"
  },
  "idempotency": {
    "message_key": "chat_id:message_id",
    "event_hash": "sha256"
  }
}
```

Regras:

- `unidade_id` deve vir do mapa canonico `grupo_jid -> unidade_id`.
- Se o grupo nao estiver mapeado, o evento pode ser salvo, mas nao pode responder com dado financeiro nem escrever.
- Evento bruto nao possui `approved`.
- Evento bruto nao possui `write_decision=approved`.
- Evento bruto nao autoriza ninguem.
- Evento bruto nao deve salvar caminho local de arquivo; usar `artifact_id`.

## 5. Decisoes derivadas

Nome: `SolCaixaDecisionV1`

Decisoes derivadas sao resultado de regra/skill, auditaveis e reprocessaveis. Elas nao substituem approval ledger.

```json
{
  "schema_version": "sol_caixa_decision_v1",
  "decision_id": "uuid",
  "event_id": "uuid",
  "decision_version": "string",
  "created_at_utc": "timestamptz",
  "ingest_decision": "save|ignore",
  "response_decision": "none|reply",
  "write_candidate": "none|candidate|await_approval",
  "authorization_precheck": "allowed|denied|unknown",
  "conversation_window": "active|closed",
  "reason_codes": ["string"]
}
```

Regras:

- Mensagem sem mencao em standby: `save` se relevante, `reply=none`, `write_candidate=none`.
- Identidade desconhecida: `save`, `reply=none`, `write_candidate=none`, `authorization_precheck=unknown`.
- Mensagem com chamada clara pode responder apenas se grupo e identidade estiverem dentro da politica.
- Decisao derivada pode dizer `await_approval`, mas nunca `approved`.
- A aprovacao real nasce em `SolCaixaApprovalV1`.

## 6. Maquina de estado de midia

Nome: `SolCaixaMediaStateV1`

Estados:

```text
received
downloaded
hash_verified
processing
processed
retrying
manual_review
failed
expired
```

Campos minimos:

```json
{
  "media_id": "uuid",
  "event_id": "uuid",
  "artifact_id": "text",
  "media_hash": "sha256",
  "mime_type": "text",
  "size_bytes": 123,
  "state": "received|downloaded|hash_verified|processing|processed|retrying|manual_review|failed|expired",
  "attempt_count": 0,
  "last_error_code": "text|null",
  "next_retry_at": "timestamptz|null",
  "provider": "text|null",
  "provider_model": "text|null",
  "retention_policy": "restricted_financial_artifact",
  "manual_review_reason": "text|null"
}
```

Regras:

- PDF/documento nao suportado nao fica pendente para sempre: vai para retry, manual review ou failed com mensagem operacional segura.
- HTTP 429/falta de credito gera retry/backoff; nao vaza erro tecnico no grupo.
- Shadow local usa artefato sanitizado.
- Shadow/producao com OCR externo exige decisao previa sobre provedor, custo maximo, retencao e autorizacao de envio de comprovante.
- Relatorio com nomes/valores/divergencias fica fora do Git, com permissao restrita e retencao definida.

## 7. Resolver run

Nome: `SolCaixaResolverRunV1`

O resolver consulta fontes canonicas e produz uma proposta versionada. A proposta nao e verdade final ate ser revalidada pelo preview/escrita.

Entrada:

- `event_id`;
- `media_id` opcional;
- `decision_id`;
- contexto canonico de grupo/unidade;
- texto sanitizado;
- quoted message opcional.

Saida:

```json
{
  "resolver_run_id": "uuid",
  "event_id": "uuid",
  "resolver_version": "string",
  "status": "resolved|ambiguous|blocked|manual_review",
  "operation": "entrada|saida|abrir|fechar|corrigir_forma|manual_review",
  "category": "parcela|passaporte|lojinha|banda|composto|saida_operacional|fechamento|unknown",
  "amount_cents": 66700,
  "payment_method": "pix|dinheiro|cartao_credito|cartao_debito|unknown",
  "components": [
    {
      "type": "parcela|passaporte|lojinha|banda|saida_operacional",
      "canonical_id": "uuid|null",
      "amount_cents": 38700,
      "evidence": ["string"]
    }
  ],
  "blockers": ["string"],
  "evidence_refs": ["artifact_id|table_ref|message_ref"]
}
```

Regras:

- Valor desconhecido: `amount_cents=null`, nao `0`.
- Categoria ambigua: `status=ambiguous` ou `manual_review`; nao cair em fallback legado.
- Fonte canonica indisponivel: `blocked` ou `manual_review`; nao chutar.
- Unidade mencionada no texto nao troca unidade do grupo.
- Legado e comparativo, nao oraculo.

## 8. Preview persistido

Nome: `SolCaixaPreviewV1`

Preview e obrigatorio antes de escrita financeira.

Criacao preferida:

```text
sol_caixa_preview_criar_v1(
  p_event_id uuid,
  p_resolver_run_id uuid
)
```

Se a RPC receber sugestao/payload, ela deve revalidar no servidor antes de persistir.

Campos minimos:

```json
{
  "preview_id": "uuid",
  "event_id": "uuid",
  "resolver_run_id": "uuid",
  "status": "created|awaiting_approval|approved|rejected|expired|written|failed|manual_review",
  "grupo_jid": "text",
  "unidade_id": "uuid",
  "operation": "entrada|saida|abrir|fechar|corrigir_forma",
  "category": "parcela|passaporte|lojinha|banda|composto|saida_operacional|fechamento",
  "amount_cents": 66700,
  "payment_method": "pix|dinheiro|cartao_credito|cartao_debito|unknown",
  "components": [],
  "evidence_refs": [],
  "payload_hash": "sha256",
  "preview_version": "string",
  "expires_at": "timestamptz",
  "public_text_policy": "operational_no_sensitive_data"
}
```

Regras:

- Preview nao pode conter CPF, chave Pix completa, dados bancarios, imagem bruta, OCR completo ou path local.
- Preview expirado nao escreve.
- Preview rejeitado nao escreve.
- Preview `manual_review` nao escreve.
- Preview `written` nao escreve de novo.
- `payload_hash` deve ser usado para detectar replay com payload diferente.

## 9. Approval ledger e regra do "pode"

Nome: `SolCaixaApprovalV1`

Campos minimos:

```json
{
  "approval_id": "uuid",
  "preview_id": "uuid",
  "approval_message_id": "text",
  "approval_event_id": "uuid",
  "grupo_jid": "text",
  "unidade_id": "uuid",
  "approved_by_actor_id": "uuid",
  "approved_by_sender_hash": "sha256",
  "approval_text": "pode",
  "approved_at_utc": "timestamptz",
  "idempotency_key": "sha256",
  "authorization_result": "allowed|denied",
  "status": "accepted|rejected|ambiguous|expired|duplicate"
}
```

Regras:

- Um unico preview pendente no mesmo grupo/unidade: `pode`, `pode Sol`, `Sol pode` podem confirmar.
- Dois ou mais previews pendentes: perguntar qual; nao aprovar "ultimo da memoria".
- `pode` em outro grupo/unidade: rejeitar.
- autor sem identidade resolvida: rejeitar.
- autor de outra unidade/operacao nao permitida: rejeitar.
- aprovacao repetida: nao gera segundo lancamento.
- approval ledger e append-only.

## 10. Matriz de autorizacao v3

Esta matriz precisa ser preenchida antes de qualquer `preview` ou `write` vivo.

| Unidade | Operacao | Politica V3 | Status |
| --- | --- | --- | --- |
| Barra | lancamento simples Pix/dinheiro/parcela | qualquer membro do grupo somente se Alf confirmar a excecao do piloto | pendente de confirmacao |
| Campo Grande | lancamento simples Pix/dinheiro/parcela | nao herda "qualquer membro"; definir papeis/atores | pendente |
| Recreio | lancamento simples Pix/dinheiro/parcela | so entra se rota financeira estiver mapeada com JID/unidade/allowlist | pendente |
| Qualquer | correcao de forma | ator autorizado nominalmente; nova aprovacao | fora da primeira escrita |
| Qualquer | alterar aluno/valor/competencia/unidade | gate maior; fora da primeira escrita | bloqueado |
| Qualquer | cancelamento/estorno | gate maior; fora da V1 write | bloqueado |
| Qualquer | abertura | autorizacao propria | contrato obrigatorio se entrar no escopo |
| Qualquer | fechamento | autorizacao propria + pendencias limpas/confirmacao especifica | contrato obrigatorio se entrar no escopo |

Regra base:

```text
identity_status=unresolved => save=yes, reply=no, write=no
```

## 11. Papel restrito e seguranca de banco

Diagnostico legado:

- escrita atual pode passar por `service_role`;
- existem RPCs pontuais aproveitaveis;
- `sol_acesso_restrito` nao representa ainda a fronteira completa da V3 viva.

Regra V3:

- bridge V3 vivo nao usa `service_role`;
- papel restrito da Sol nao tem SELECT direto em tabelas financeiras;
- papel restrito tem EXECUTE somente nas RPCs aprovadas;
- funcoes de escrita usam `SECURITY DEFINER`, owner controlado e `search_path` fixo;
- `PUBLIC EXECUTE` perigoso precisa estar saneado ou provadamente inalcancavel pelo papel restrito;
- auditoria e append-only;
- payload incompatavel, replay, unidade cruzada e ator invalido falham fechado.

Testes obrigatorios antes de qualquer grant em producao:

- SELECT direto negado;
- INSERT/UPDATE/DELETE direto negado;
- EXECUTE em funcao nao permitida negado;
- unidade cruzada negada;
- ator sem autorizacao negado;
- payload com hash divergente negado;
- mesma idempotency key com payload diferente negada;
- tentativa de escrever sem preview aprovado negada;
- tentativa de escrever com approval expirado negada.

## 12. RPCs canonicas propostas

### Fase local / contrato

Sem migration de producao. Implementar como interfaces/contratos no harness.

### Fase futura com aprovacao explicita

```text
sol_caixa_evento_registrar_v1(...)
sol_caixa_media_registrar_v1(...)
sol_caixa_resolver_recebimento_v1(p_event_id uuid)
sol_caixa_preview_criar_v1(p_event_id uuid, p_resolver_run_id uuid)
sol_caixa_preview_buscar_v1(p_preview_id uuid)
sol_caixa_approval_registrar_v1(p_preview_id uuid, p_approval_event_id uuid)
sol_caixa_lancar_movimento_v1(p_preview_id uuid, p_approval_id uuid, p_idempotency_key text)
sol_caixa_corrigir_forma_v1(p_preview_id uuid, p_approval_id uuid, p_idempotency_key text)
sol_caixa_abrir_v1(p_event_id uuid, p_approval_id uuid)
sol_caixa_fechar_v1(p_event_id uuid, p_approval_id uuid)
sol_caixa_buscar_movimentos_v1(...)
```

Fora da primeira escrita:

- cancelar movimento;
- estornar;
- alterar valor;
- alterar aluno;
- alterar unidade;
- alterar competencia;
- composto complexo;
- lojinha/passaporte/banda em write automatico.

Primeira escrita candidata, depois de gates:

- Pix simples;
- dinheiro simples;
- parcela simples;
- sem alteracao de valor;
- sem alteracao de unidade;
- sem cancelamento;
- sem estorno.

## 13. Fixtures executaveis v3

Schema base:

```json
{
  "fixture_id": "SCX-FX-000",
  "case_name": "string",
  "schema_version": "sol_caixa_fixture_v3",
  "setup": {
    "canonical_groups": [],
    "authorized_actors": [],
    "initial_previews": [],
    "initial_media_states": []
  },
  "events": [
    {
      "event_id": "uuid",
      "group_jid": "text",
      "message_id": "text",
      "quoted_message_id": "text|null",
      "sender_ref": "sanitized",
      "identity_status": "resolved|unresolved",
      "mention_detected": true,
      "conversation_window": "active|closed",
      "message_kind": "text|image|pdf|quoted_reply",
      "text_sanitized": "string",
      "has_media": true,
      "media_kind": "image|pdf|null"
    }
  ],
  "expected_final_state": {
    "event_count": 1,
    "logical_event_count": 1,
    "preview_status": "awaiting_approval|manual_review|blocked|approved|none",
    "approval_status": "none|accepted|rejected|ambiguous|duplicate",
    "resolver_status": "resolved|ambiguous|blocked|manual_review",
    "operation": "entrada|saida|abrir|fechar|corrigir_forma|manual_review",
    "category": "parcela|passaporte|lojinha|banda|composto|saida_operacional|fechamento|unknown",
    "amount_cents": null,
    "payment_method": "pix|dinheiro|cartao_credito|cartao_debito|unknown"
  },
  "expected_effects": {
    "db_write_calls": 0,
    "financial_mutations": 0,
    "whatsapp_outbound_calls": 0,
    "duplicate_outbound_calls": 0,
    "external_media_calls": 0,
    "restarts": 0
  },
  "legacy_comparison": {
    "legacy_result": "unknown|matched|wrong_category|fallback_wrong|technical_leak|not_applicable|matched_after_hotfix",
    "legacy_is_oracle": false
  },
  "evidence_status": "ready|needs_evidence"
}
```

Correcoes obrigatorias sobre a v2:

- `SCX-FX-003`: escolher resultado canonico exato: `banda` ou `composto`; se faltar evidencia, `needs_evidence`.
- `SCX-FX-008`: adicionar operacao `corrigir_forma`.
- `SCX-FX-011`: `pode Sol` precisa de `preview_id`, `quoted_message_id` ou prova de unico preview pendente.
- `SCX-FX-013`, `SCX-FX-017`, `SCX-FX-020`: virar cenarios sequenciais com `setup/events/expected_final_state/expected_effects`.
- `amount_cents` desconhecido deve ser `null`.
- usar nomenclatura unica: `payment_method`, `category`, `operation`, `amount_cents`.
- fixture deve trazer `group_jid`, nao apenas `chat_unit`.

Matriz inicial continua:

- Laura/Recreio/passaporte;
- Perola/CG/parcela + passaporte;
- Vinicius/banda;
- Arthur/Barra/corda/lojinha;
- Pedro/duas mensalidades;
- Davi/fonte indisponivel;
- Seguranca/saida operacional;
- Pix vs cartao debito;
- parcela Recreio;
- fechamento direto;
- `pode Sol`;
- mensagem sem mencao em standby;
- dois previews + `pode`;
- `pode` em outro grupo;
- ator desconhecido;
- unidade no texto divergente;
- restart no meio da midia;
- PDF/documento nao suportado;
- 429/falta de credito OCR;
- duplicate webhook.

## 14. Harness v3

### Harness local

Obrigatorio antes de qualquer shadow real.

- sem escrita no LA Report;
- sem chamada de RPC de mutacao;
- sem envio WhatsApp;
- sem restart;
- eventos, midias e previews em fixture/arquivo temporario;
- banco, se usado, somente leitura;
- relatorios locais fora do Git quando tiverem dados financeiros.

### Shadow sem efeito financeiro

Somente com aprovacao posterior.

- fluxo legado continua vivo;
- V3 roda em paralelo;
- V3 nao envia preview;
- V3 nao escreve caixa;
- V3 nao corrige, cancela, estorna ou fecha;
- V3 pode gerar relatorio restrito de divergencia se aprovado.

Contadores obrigatorios:

```json
{
  "db_write_calls": 0,
  "financial_mutations": 0,
  "whatsapp_outbound_calls": 0,
  "duplicate_outbound_calls": 0,
  "restarts": 0,
  "external_media_calls": 0
}
```

Se qualquer contador sair de zero no modo local/shadow, o gate falha.

## 15. Gates de avanco

### Gate A - contrato local

- todas as fixtures carregam;
- schema rejeita enum inexistente;
- dados sensiveis ausentes;
- `amount_cents=null` quando desconhecido;
- evento bruto nao contem `approved`;
- decisao derivada nao aprova;
- mensagem sem mencao em standby nao responde nem escreve;
- ator desconhecido nao responde nem escreve.

### Gate B - resolver read-only

- resolve com unidade do grupo;
- bloqueia fonte indisponivel;
- nao usa LLM como verdade final;
- trata ambiguidade como `manual_review` ou `blocked`;
- legacy e comparativo, nao oraculo.

### Gate C - preview/approval simulado

- preview tem `preview_id`;
- approval tem `approval_id`;
- payload_hash estavel;
- preview expirado nao escreve;
- `pode` ambiguo bloqueia;
- `pode` em outro grupo rejeita;
- replay nao duplica.

### Gate D - seguranca

- papel restrito especificado;
- service_role fora da arquitetura V3 viva;
- testes de permissao desenhados com papel real;
- sem acesso direto a tabela financeira;
- sem EXECUTE fora da allowlist.

### Gate E - shadow sem efeito financeiro

Requer aprovacao posterior do Alf.

- amostra minima definida;
- cobrir todas as rotas financeiras ativas e mapeadas;
- zero escrita financeira;
- zero envio V3;
- zero duplicidade;
- zero aprovacao cruzada;
- zero troca de unidade;
- zero vazamento tecnico;
- zero divergencia critica em valor/forma para casos simples;
- 100% dos bloqueios com motivo classificavel.

## 16. Abertura e fechamento

Abertura/fechamento nao podem ficar como caso generico do parser.

Se entrarem na V1, precisam de RPC/contrato proprio:

```text
sol_caixa_abrir_v1
sol_caixa_fechar_v1
```

Fechamento deve validar:

- unidade canonica;
- caixa aberto correto;
- pendencias de midia;
- previews aguardando aprovacao;
- lancamentos incompletos;
- ator autorizado;
- resumo final;
- confirmacao especifica;
- auditoria.

Se nao houver contrato completo, abertura/fechamento ficam fora da primeira escrita V3 e o legado continua responsavel.

## 17. Politica de exposicao no grupo

Permitido no grupo, quando politica autorizar:

- primeiro nome ou identificacao minima;
- valor;
- forma;
- categoria;
- status;
- referencia curta do preview;
- orientacao operacional.

Proibido:

- CPF;
- chave Pix completa;
- dados bancarios;
- imagem bruta;
- OCR completo;
- caminho local;
- SQL;
- nome de tabela;
- nome de RPC;
- `public.schema`;
- erro Codex/Hermes;
- stack trace;
- UUID/audit_id sem necessidade operacional.

Sanitizador de saida e camada obrigatoria, nao apenas prompt.

## 18. Criterio de "pronto para Fase 1 local"

Fase 1 local pode comecar quando esta spec for aceita pelo Alf.

Trabalho permitido:

- transformar fixtures v2 em JSON executavel v3;
- criar runner local;
- criar contrato de evento/decision/media/preview/approval;
- rodar fixtures sem LA Report;
- comparar contra expected canonico;
- gerar relatorio local;
- corrigir contrato, nao fluxo vivo.

Nao permitido na Fase 1 local:

- alterar config da Sol;
- restart;
- migration;
- grant/revoke;
- chamada de escrita;
- envio WhatsApp;
- preview real em grupo;
- mudanca no parser legado.

## 19. Proxima entrega

Depois desta spec v3:

1. Converter fixtures para JSON v3.
2. Criar harness local com contadores de efeito colateral.
3. Rodar Gate A.
4. Rodar Gate B com resolver read-only quando contrato estiver estavel.
5. Gerar relatorio de divergencias.
6. Voltar para revisao Alf/Sol antes de qualquer shadow real.

## 20. Resumo executivo

A Sol nao derrubou a arquitetura. Ela apontou onde a V2 ainda deixava porta aberta para repetir o erro do monolito:

- evento bruto com decisao demais;
- preview confiando demais na aplicacao;
- autorizacao herdada demais;
- fixtures ambigues demais;
- harness sem prova objetiva de zero efeito colateral.

A V3 fecha esses pontos.

Decisao final desta spec:

```text
Fase 0 corrigida: aprovada como documento de trabalho.
Fase 1 local: pode comecar.
Shadow em producao: bloqueado ate nova autorizacao.
Preview real em grupo: bloqueado.
Write: bloqueado.
Migration/grants/restart: bloqueados.
```
