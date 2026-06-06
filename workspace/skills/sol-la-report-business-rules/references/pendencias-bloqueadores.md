# Pendências e Bloqueadores — LA Report / Sol

## Bloqueadores atuais

### P8/P11 — Snapshot `dados_mensais`

Status:

- ✅ Migration v3 aprovada como desenho técnico.
- ✅ SELECT-only liberado.
- 🚫 Produção travada.

Proibido ainda:

- migration;
- ALTER/CREATE/UPDATE/DELETE/INSERT;
- backfill;
- cron;
- produção.

Próximo passo: rodar `verificacao-p8-p11-select-only.md`, revisar resultado e só depois decidir staging/migration.

---

## Pendências de regra

### Taxa de renovação

❓ Confirmar se `aviso_previo` entra no denominador.

Não tratar como regra fechada.

### Taxa de conversão geral do funil

❓ Confirmar denominador:

- `novas / total_leads`; ou
- `novas / leads_com_exp`.

Não alterar dashboard/funil sem validação.

---

## Pendências técnicas importantes

- Padronizar `cursos.is_coral` e remover filtro por nome.
- Padronizar Kids/School por `idade_atual` onde hoje usa `classificacao`.
- Corrigir fonte de data de experimental para data realizada, não `data_contato`.
- Remover `evasoes_v2` como fonte viva.
- Corrigir qualquer `COUNT(*)` usado para alunos ativos/pagantes quando deveria ser pessoa.
