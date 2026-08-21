# Sol Caixa V2 - fixtures sanitizadas

Data: 2026-08-20
Status: draft inicial / sem execucao de shadow
Objetivo: transformar os casos reais que quebraram/funcionaram em contrato testavel.

## Regras das fixtures

- Sem CPF, chave Pix, dados bancarios, imagem bruta ou OCR completo.
- Nomes podem ficar no primeiro nome quando ja foram usados como referencia operacional, mas sem
  documento/telefone.
- Valor, unidade, categoria e forma podem aparecer porque sao o comportamento testado.
- `legacy_result` e apenas comparativo. O oraculo e `expected_*`.
- Nenhuma fixture executa escrita. Tudo aqui e read-only/contrato.

## Schema minimo de cada fixture

```json
{
  "fixture_id": "string",
  "case_name": "string",
  "input_event": {
    "chat_unit": "Barra|Campo Grande|Recreio",
    "message_kind": "text|image|pdf|quoted_reply",
    "text_sanitized": "string",
    "has_media": true,
    "media_kind": "image|pdf|null",
    "sender_role": "authorized|unknown|wrong_unit",
    "quoted_preview": true
  },
  "expected_decisions": {
    "ingest": "save|ignore",
    "reply": "none|reply",
    "write": "none|await_approval|approved|blocked",
    "authorization": "allowed|denied|unknown"
  },
  "expected_resolver": {
    "operation": "entrada|saida|abrir|fechar|manual_review",
    "category": "parcela|passaporte|lojinha|banda|composto|saida_operacional|fechamento",
    "amount_cents": 0,
    "payment_method": "pix|dinheiro|cartao|unknown",
    "components": []
  },
  "expected_preview": {
    "status": "awaiting_approval|manual_review|blocked",
    "must_persist": true,
    "public_text_policy": "operational_no_sensitive_data"
  },
  "expected_write_guard": "never_in_fixture",
  "legacy_result": "unknown|matched|wrong_category|fallback_wrong|technical_leak|not_applicable",
  "evidence_status": "ready|needs_evidence"
}
```

## Matriz inicial

| ID | Caso | Entrada sanitizada | Esperado canonico | Regressao que protege | Status |
| --- | --- | --- | --- | --- | --- |
| `SCX-FX-001` | Laura/Recreio/passaporte | PDF/legenda de passaporte promocional no Recreio | `entrada/passaporte`, nao lojinha, preview aguardando `pode` | lojinha capturando passaporte | ready |
| `SCX-FX-002` | Perola/CG/parcela+passaporte | `parcela 08/2026 R$387 + passaporte R$280` | `entrada/composto`, total R$667, componentes parcela+passaporte | parser pegar so primeira parcela | ready |
| `SCX-FX-003` | Vinicius/banda adicional | comprovante/legenda com banda/adicional | `entrada/banda` ou `composto` conforme previsto canonico | banda cair em parcela | ready |
| `SCX-FX-004` | Arthur/Barra/corda | venda de corda de violao R$60 | `entrada/lojinha`, item corda, sem buscar fatura/parcela | parcela forçada por aluno conhecido | ready |
| `SCX-FX-005` | Pedro/duas mensalidades | dois cursos/mensalidades no mesmo comprovante | `entrada/composto`, dois componentes, total somado | uma mensalidade sumir | ready |
| `SCX-FX-006` | Davi/fonte indisponivel | recebimento com fonte oficial indisponivel/divergente | `blocked/manual_review`, sem fallback legado | lancar por chute quando fonte falha | ready |
| `SCX-FX-007` | Seguranca/saida | pagamento semanal seguranca R$100 dinheiro | `saida/saida_operacional`, ambiente cofre, forma dinheiro | saida cair no agente ou virar entrada | ready |
| `SCX-FX-008` | Pix vs cartao debito | comprovante/legenda indicam Pix, preview antigo cartao | correcao de forma exige alvo persistido e auditoria | forma errada sem correcao segura | ready |
| `SCX-FX-009` | Parcela Recreio virou lojinha | legenda explicita parcela/mensalidade Recreio | `entrada/parcela`, legenda clara vence chute | parcela virar lojinha | ready |
| `SCX-FX-010` | Fechamento direto | `Sol, pode fechar o caixa` | rota `fechar`, exige autorizacao e pendencias limpas | cair no LLM/erro tecnico | ready |
| `SCX-FX-011` | `pode Sol` | resposta `pode Sol` a preview unico | confirma preview unico, sem ambiguidade | aceitar so `Sol pode` | ready |
| `SCX-FX-012` | Mensagem sem mencao em standby | texto comum financeiro/noise sem chamada | salvar se relevante, nao responder, nunca escrever | grupo responder sem chamada | ready |
| `SCX-FX-013` | Dois previews + `pode` | dois previews pendentes no mesmo grupo | bloquear e perguntar qual | aprovar "ultimo da memoria" | needs_evidence |
| `SCX-FX-014` | `pode` em outro grupo | aprovacao vem de grupo diferente | rejeitar por grupo/unidade divergente | aprovacao cruzada | needs_evidence |
| `SCX-FX-015` | Ator desconhecido | sender sem `quem_eh` resolvido | salva contexto; write denied | governanca null executando acao | needs_evidence |
| `SCX-FX-016` | Unidade no texto diverge | grupo Barra, texto fala Recreio | unidade = grupo canonico; texto nao troca | LLM trocar unidade | needs_evidence |
| `SCX-FX-017` | Restart no meio da midia | midia recebida antes do OCR; processo reinicia | retomar por media state/artifact, sem duplicar | comprovante perdido no restart | needs_evidence |
| `SCX-FX-018` | PDF/documento nao suportado | PDF sem parser/unsupported | retry/manual_review; mensagem segura | pendencia eterna ou erro tecnico | needs_evidence |
| `SCX-FX-019` | 429/falta credito OCR | provedor retorna 429 | retry/backoff, depois manual_review | erro tecnico em grupo | needs_evidence |
| `SCX-FX-020` | Duplicate webhook | mesmo `chat_id/message_id` duas vezes | um evento logico; segunda chamada idempotente | lancamento duplicado | needs_evidence |

## Fixture exemplo - Perola/composto

```json
{
  "fixture_id": "SCX-FX-002",
  "case_name": "Perola CG parcela + passaporte",
  "input_event": {
    "chat_unit": "Campo Grande",
    "message_kind": "image",
    "text_sanitized": "PG pix parcela 08/2026 R$387,00 + PG dif. passaporte R$280,00 aluna P. - Kids CG",
    "has_media": true,
    "media_kind": "image",
    "sender_role": "authorized",
    "quoted_preview": false
  },
  "expected_decisions": {
    "ingest": "save",
    "reply": "reply",
    "write": "await_approval",
    "authorization": "allowed"
  },
  "expected_resolver": {
    "operation": "entrada",
    "category": "composto",
    "amount_cents": 66700,
    "payment_method": "pix",
    "components": [
      { "type": "parcela", "amount_cents": 38700 },
      { "type": "passaporte", "amount_cents": 28000 }
    ]
  },
  "expected_preview": {
    "status": "awaiting_approval",
    "must_persist": true,
    "public_text_policy": "operational_no_sensitive_data"
  },
  "expected_write_guard": "never_in_fixture",
  "legacy_result": "matched_after_hotfix",
  "evidence_status": "ready"
}
```

## Proximo passo do harness

Criar um runner local que leia esta matriz e valide:

1. decisao de evento;
2. resolucao canonica;
3. preview persistido simulado;
4. autorizacao simulada;
5. idempotencia/replay;
6. divergencia contra legado quando houver resultado legado disponivel.

O runner nao chama RPC de escrita e nao envia WhatsApp.

