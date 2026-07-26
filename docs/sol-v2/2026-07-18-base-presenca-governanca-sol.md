# Governança de presença da Sol — base + execução

_2026-07-18 · handoff Alf → Hugo · **fonte única compartilhada com o Fábio**_

## TL;DR

A Sol vai postar, nos grupos de equipe das 3 unidades, os **alunos que ficaram sem presença real** (chamada de verdade, não o default do Emusys) do dia anterior. Tudo que ela precisa:

1. **A fonte** → view `public.vw_presenca_pendencia` (já no ar).
2. **A rota** → `governanca.agente_grupos` (falta cadastrar a Sol nos grupos de unidade — ver §4).
3. **A régua** → função `public.fn_presenca_e_forte` (a MESMA que o Fábio usa → nunca divergem).

Não precisa reimplementar "o que é presença" nem criar view nova. **Não** existe `alerta_config` (era plano da migração 003); a config de grupo vive em `agente_grupos`.

---

## 1. A regra (o coração)

"Presença real" = **fonte forte**, numa função única: `public.fn_presenca_e_forte(respondido_por text) → boolean`.
- **FORTE** (conta): `professor_la_teacher`, `fabio_audio`, `manual`, `professor_whatsapp`.
- **FRACA** (não conta): `emusys`, `sistema`, `null` — o default do Emusys.

A view já aplica isso + a regra de ouro: só aula **encerrada**, **roster conciliado**, **janela 45d**, **âncora do slot** (não conta 2×).

## 2. A view `public.vw_presenca_pendencia`

Grão = 1 linha por `(aula, aluno)` sem presença forte. Colunas: `unidade_id, unidade_nome, professor_id, professor_nome, aula_id, tipo, curso_nome, turma_nome, hora, data_aula, data_hora_inicio/fim, aluno_id, aluno_nome, aluno_primeiro_nome, justificada, dias_em_atraso`. Backend-only (revogada de anon/authenticated → consuma via **service_role**).

## 3. Queries prontas

**Sol — "sem presença ontem por unidade" (digest diário):**
```sql
select unidade_nome,
       count(distinct aluno_id) as alunos,
       count(distinct aula_id)  as aulas,
       jsonb_agg(distinct jsonb_build_object('prof', professor_nome, 'aluno', aluno_primeiro_nome)) as detalhe
from public.vw_presenca_pendencia
where data_aula = current_date - 1
  and not justificada
group by unidade_nome
order by alunos desc;
```
Referência real (17/07): **Recreio 71 · Campo Grande 42 · Barra 39**.

**Escala pra coordenação (professor parado 3+ dias):**
```sql
select professor_nome, unidade_nome,
       count(distinct aluno_id) as alunos, max(dias_em_atraso) as pior_atraso
from public.vw_presenca_pendencia
where dias_em_atraso >= 3 and not justificada
group by professor_nome, unidade_nome
order by pior_atraso desc;
```
Hoje isso pega **~1.105 alunos** (o backlog que a governança vai apertar).

---

## 4. Rota do grupo — o que FALTA configurar

`governanca.agente_grupos` (colunas: `agente, grupo_jid, nome_grupo, escopo, gatilho, ativo, allow_any_participant, modo, notas`).

**Situação hoje:**
- Os grupos de **equipe por unidade** já existem — a **Lia** posta neles: `agente='lia'`, `nome_grupo='LA MUSIC | {Barra,Campo Grande,Recreio} (equipe)'`. **Os `grupo_jid` estão lá, é só reaproveitar.**
- A **Sol** só tem hoje: `LA REPORT - AUDITORIA EQUIPE` e `Sucesso do aluno`. **Ela ainda não tem rota pros grupos de unidade.**

**Ação:** cadastrar a Sol nos 3 grupos de equipe (JIDs vindos das linhas da Lia), com um escopo/gatilho próprio pra governança de presença. Ex.:
```sql
insert into governanca.agente_grupos (agente, grupo_jid, nome_grupo, escopo, gatilho, ativo)
select 'sol', grupo_jid, nome_grupo, 'governanca_presenca', 'digest_diario', true
from governanca.agente_grupos
where agente='lia' and nome_grupo ilike 'LA MUSIC | % (equipe)';
```
(revisa nome/escopo/gatilho conforme o padrão de vocês). **A escala 3d → grupo da coordenação** precisa de 1 rota extra (o grupo da coordenação ainda não está mapeado aqui — definir com o Alf).

## 5. Dispatch e schedule (o que já existe)

- **Fila da Sol:** `public.bi_messages_lamusic` (ela é agente; `reset-sol-stuck-messages` já cuida de travados). É por aí que ela envia.
- **Crons de referência:** `alertas-diarios` (11h), `relatorio-diario-20h`. Um **digest diário de manhã (8h)** casa com a regra anti-fadiga do contrato.
- **Envio WhatsApp:** skill `whatsapp-notificacoes` (UAZAPI).

## 6. Tom e anti-fadiga (obrigatório — `docs/contrato-de-alerta-v1.md`)

Sol = **operacional-cordial, direto ao ponto**. Digest agrupado (não 1 alerta por aluno), janela 08h–20h, sem jargão/nº de modelo. Sugestão de mensagem:

> ☀️ Bom dia, equipe **Recreio**! Fechamento de ontem (17/07): **71 alunos** ficaram sem presença lançada em 64 aulas.
> Lembrando: o professor tem **3 dias** pra lançar — e **gravando o áudio pro Fábio, a presença sai automática**. Depois disso, a gente escala aqui na coordenação.
> Por professor: *Rafa* (Ukulele 16h) — Pedro, Ana; *Marina* (Canto 10h) — João… [lista]
> Qualquer aula já dada, é só mandar o áudio. 🎶

## 7. Tabelas-base (proveniência)

`aluno_presenca` · `aulas_emusys` (sync do Emusys pelos crons `sync-presenca-*`) · `aula_alunos_emusys` (roster) · `unidades` · `aluno_presenca_administrativo` (justificadas).

## Referências
- View: `supabase/migrations/013-vw-presenca-pendencia.sql`
- Regra: `supabase/migrations/012-selo-honesto-presenca.sql` (`fn_presenca_e_forte`)
- Contrato de tom/SLA: `docs/contrato-de-alerta-v1.md`
- Estratégia/KPIs: `docs/presenca-estrategia-e-papeis.md` (a Sol ataca o KPI de **Registro**)
