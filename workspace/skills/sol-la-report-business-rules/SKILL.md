---
name: sol-la-report-business-rules
description: "Use obrigatoriamente ao responder perguntas operacionais ou técnicas sobre LA Music Report/Sol e dados da escola: inadimplentes, bolsistas, alunos pagantes, alunos ativos, faltas, frequência, evasões, não renovações, aviso prévio, renovações, experimentais, matrículas, professores, unidades, Campo Grande, Barra, Recreio, Kids/School, MRR, ticket, churn, funil, dados_mensais, KPIs, SQL, RPCs, views ou dashboard. Aplica regras canônicas validadas pelo Alf, separa legado de bug e bloqueia alterações perigosas sem SELECT-only e aprovação."
---

# Sol — Regras de Negócio LA Report

Esta skill é a fonte operacional da Sol para regras de negócio do **LA Music Performance Report**.

Use antes de:

- responder perguntas operacionais da equipe sobre alunos, pagamentos, faltas, bolsistas, inadimplentes, matrículas, renovações, evasões, professores ou unidades;
- escrever SQL/RPC/view/migration;
- calcular KPIs;
- alterar dashboard/frontend;
- responder sobre métricas;
- auditar divergências;
- propor correções em `dados_mensais`, `vw_kpis_gestao_mensal`, evasões, ticket, MRR, inadimplência ou funil.

---

## Linguagem natural da equipe

Use esta skill mesmo quando a pessoa não falar “KPI”, “view”, “SQL”, “dashboard” ou “regra de negócio”.

Exemplos que DEVEM ativar a skill:

- “quais são os inadimplentes?”
- “calcula pra mim os bolsistas”
- “quem são as pessoas que estão mais faltando?”
- “quantos pagantes temos?”
- “quantos alunos ativos tem na unidade?”
- “quem está em aviso prévio?”
- “quem não renovou?”
- “quem evadiu?”
- “separa Kids e School”
- “me mostra os alunos da Barra / Recreio / Campo Grande”
- “qual professor teve mais faltas/evasões?”
- “quem fez experimental e não virou matrícula?”
- “lista os alunos trancados”
- “quem está sem parcela?”
- “quais alunos têm segundo curso?”
- “quantas matrículas de banda temos?”

Traduza a pergunta operacional para a regra canônica correta antes de consultar ou responder.

---

## Regra de autoridade

Quando houver conflito:

1. **Regra validada pelo Alf** vence.
2. `references/regras-canonicas.md` é a fonte canônica atual.
3. Banco real deve ser verificado com **SELECT-only**.
4. Código atual é evidência, não verdade absoluta.
5. Documento antigo divergente vira **legado**.
6. Código divergente vira **possível bug**.

Nunca transforme sujeira de banco, fallback antigo ou comportamento legado em regra oficial.

---

## Travas de segurança

Sem aprovação explícita do Alf, é proibido:

- executar migration;
- executar `ALTER`, `CREATE`, `DROP`, `UPDATE`, `DELETE`, `INSERT`;
- rodar backfill;
- criar/substituir view ou RPC;
- ativar cron;
- mexer em produção;
- apagar dados;
- arquivar aluno com `DELETE FROM alunos`.

Quando a tarefa envolver banco, primeiro gerar/rodar apenas **SELECT-only** e revisar resultados.

---

## Referências obrigatórias

Leia conforme a tarefa:

- `references/regras-canonicas.md` — regras validadas e status atual.
- `references/pendencias-bloqueadores.md` — pontos ainda não fechados.
- `references/p8-p11-snapshot.md` — `dados_mensais`, congelamento, audit trail, SELECT-only.
- `references/historico-cg-maio-2026.md` — fechamento validado de Campo Grande/Maio 2026; 470 pagantes é âncora histórica, não bug automático.
- `references/checklist-sql-seguro.md` — checklist antes de qualquer SQL/migration.
- `references/emusys-integracao-acesso.md` — acesso operacional Emusys ↔ Report para auditoria cruzada, endpoints disponíveis, limites e riscos de matching.

Para qualquer alteração que afete métrica, consulte primeiro `regras-canonicas.md`.

Para `dados_mensais`, snapshot, cron, fechamento mensal ou histórico, consulte primeiro `p8-p11-snapshot.md`.

Para qualquer pergunta sobre Campo Grande/Maio 2026, leia também `historico-cg-maio-2026.md` antes de concluir divergência.

---

## Decisões já validadas pelo Alf

Resumo rápido:

- Churn: `evasoes / alunos_pagantes * 100`; transferência interna entre unidades não conta como evasão/churn global.
- Inadimplência: `% cabeças = qtd_inadimplentes / alunos_pagantes * 100`.
- Ticket médio: soma/faturamento de todos os cursos dos alunos pagantes ÷ alunos pagantes por pessoa; segundo curso entra no numerador, mas não duplica o denominador; bolsista integral/parcial fora.
- Canto Coral: usar `cursos.is_coral`; filtro por nome é legado.
- Bolsista parcial: não conta como pagante e não entra no ticket médio.
- Passaporte: não entra no MRR; é receita à parte.
- Conversão professor: só experimentais realizadas pelo professor contam; matrícula sem experimental não entra.
- LTV: `ticket_medio * tempo_permanencia_meses`.
- Kids/School: `idade_atual <= 11` LAMK; `idade_atual >= 12` EMLA.

---

## Pendências abertas

Ainda não fechar como canônico final sem nova validação:

- P8/P11 `dados_mensais`: SELECT-only liberado; migration v3 aprovada só como desenho técnico; produção travada.
- Campo Grande/Maio 2026: fechamento histórico validado em 470 pagantes; não substituir por cálculo vivo atual sem auditoria forense e aprovação explícita.
- Taxa de renovação: confirmar se `aviso_previo` entra no denominador.
- Taxa de conversão geral do funil: `novas / total_leads` vs `novas / leads_com_exp`.

---

## Comportamento esperado da Sol

Quando encontrar divergência:

1. classificar como `validada`, `inferida`, `pendente` ou `legado/bug`;
2. apontar evidência;
3. propor SELECT-only se precisar validar;
4. não corrigir automaticamente;
5. pedir aprovação antes de qualquer alteração destrutiva ou produtiva.

Frase-guia:

> Documento antigo divergente = legado. Código divergente = possível bug. Regra validada pelo Alf = canônica.
