# P8/P11 — Snapshot `dados_mensais`

## Status

- ✅ Decisão de negócio: histórico mensal deve ser preservado.
- ✅ Recalcular mês passado não pode sobrescrever sem audit trail.
- ✅ Não executar backfill automático.
- ✅ Migration v3 aprovada como desenho técnico.
- ✅ SELECT-only liberado.
- 🚫 Produção travada até revisão dos resultados e aprovação final.

---

## Problema

`dados_mensais` permite UPSERT por `(unidade_id, ano, mes)`.  
Recalcular um mês passado pode alterar retroativamente o histórico.

O Alf relatou perda/alteração de abril.

---

## Direção aprovada

Implementar, futuramente e só após aprovação:

1. congelamento de snapshot;
2. audit trail/versionamento mínimo antes de overwrite;
3. descongelamento auditado com motivo;
4. frontend bloqueando ou alertando recálculo de mês congelado.

---

## Migration v3

Aprovada apenas como desenho técnico.

Ainda depende de:

- resultado dos SELECTs;
- confirmação da estrutura real;
- confirmação de RLS/perfis;
- definição de meses a congelar;
- staging antes de produção.

---

## SELECT-only obrigatório

Antes de qualquer execução, confirmar:

- `dados_mensais` é tabela ou view;
- colunas reais;
- constraints/índices;
- generated columns;
- definição real de `recalcular_dados_mensais`;
- existência de `snapshot_dados_mensais`;
- cron ativo/inativo;
- dados de abril/maio;
- duplicidades por `(unidade_id, ano, mes)`;
- tamanho da tabela;
- estrutura real de perfis/RLS;
- chamadas frontend de recálculo.

---

## Proibições

Até aprovação final:

- não executar migration;
- não alterar banco;
- não criar tabela;
- não alterar função;
- não ativar cron;
- não executar backfill;
- não mexer em produção.
