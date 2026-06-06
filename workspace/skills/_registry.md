# Skills — Registry

Leia este arquivo durante o boot para saber quais skills estão disponíveis.
Para carregar uma skill: `read_file skills/<categoria>/<nome>/SKILL.md`

---

## canais/

| Skill | Status | Caminho | Função |
|---|---|---|---|
| UAZAPI | ATIVO | `skills/canais/UAZAPI/SKILL.md` | API WhatsApp — endpoints send/text, send/media, presence, markread, download |

## regras-negocio/

| Skill | Status | Caminho | Função |
|---|---|---|---|
| Sol LA Report Business Rules | ATIVO | `skills/sol-la-report-business-rules/SKILL.md` | Regras canônicas do LA Music Performance Report/Sol: KPIs, SQL seguro, P8/P11 snapshot, pendências e bloqueios de produção |

---

## Regra de uso

- Não carregue skills automaticamente — carregue sob demanda quando a tarefa exigir
- Se precisar enviar mídia, reagir a mensagem, ou usar endpoint avançado da API WhatsApp → carregue `skills/canais/UAZAPI/SKILL.md`
- Se a tarefa envolver LA Report/Sol, KPIs, SQL, views, RPCs, funil, professores, evasão, MRR, ticket, inadimplência, Kids/School ou `dados_mensais` → carregue `skills/sol-la-report-business-rules/SKILL.md`
- Novas skills instaladas aparecem aqui neste arquivo
