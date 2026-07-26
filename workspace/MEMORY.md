# MEMORY.md — Sol v2

> Memória inicial da Sol v2.  
> Este arquivo deve guardar decisões permanentes, estado operacional e ponteiros para documentação canônica.  
> Não salvar segredos aqui.

---

## Identidade

- Sol v2 é a agente operacional da LA Music para ADM, Gestão, Reports, Relacionamento Administrativo e Governança de Presença.
- Runtime-alvo: Hermes.
- Canal-alvo: WhatsApp nativo/ferramenta nativa do Hermes.
- UAZAPI não deve ser usado na Sol v2.

---

## Decisões permanentes

### 2026-07-26 — Escopo oficial

Alf definiu duas frentes oficiais:

1. **Sol ADM / Gestão / Reports**
2. **Sol Relacionamento Administrativo / Cliente**

A Governança de Presença é frente estratégica integrada ao Fábio.

### 2026-07-26 — Primeira missão operacional

A primeira missão da Sol v2 é voltar a disparar o cron de relatórios diários Administrativo e Comercial no grupo de relatórios.

Essa missão vem antes de auto-reply, atendimento conversacional ou governança de presença completa.

### 2026-07-26 — WhatsApp

- WhatsApp informado pelo Alf: `21 2170-0723`.
- Normalização provável: `552121700723`.
- Decisão: usar WhatsApp nativo/ferramenta nativa do Hermes.
- Não usar UAZAPI.
- Modo inicial: ouvir grupos, não responder.

### 2026-07-26 — Segurança / rotação

Alf decidiu não rotacionar credenciais por enquanto porque o repo é restrito a Alf e Hugo.

Tratamento:

- risco aceito temporariamente;
- não expor valores;
- continuar saneamento sem rotação;
- rotacionar futuramente se repo for compartilhado, migrado, publicado ou sair do controle Alf/Hugo.

---

## Fontes canônicas

- Spec Sol v2: `docs/sol-v2/spec-sol-v2.md`.
- Roadmap: `docs/sol-v2/roadmap-reforma-sol-v2.md`.
- Competências: `docs/sol-v2/competencias-e-expectativas-sol-v2.md`.
- Governança de presença: `docs/sol-v2/2026-07-18-base-presenca-governanca-sol.md`.
- Auditorias de segurança: `docs/sol-v2/security-audits/`.

---

## LA Report / BI

- LA Report é a coluna vertebral da Sol.
- Acesso esperado: read-only / SELECT-only.
- Não executar DDL/DML sem aprovação explícita.
- Não chutar KPI.
- Separar regra canônica, legado, bug e pendência.

---

## Governança de Presença

Fontes:

- `public.fn_presenca_e_forte(respondido_por text)`.
- `public.vw_presenca_pendencia`.
- `governanca.agente_grupos`.
- `public.bi_messages_lamusic` quando aplicável.

Regras:

- Sol e Fábio não divergem.
- Não criar view/regra paralela.
- Digest agrupado.
- Primeiro dry-run/preview.

---

## Estado da reforma

### Fase 1 — Segurança

- Backup bruto restrito criado fora do Git.
- Histórico local sanitizado removendo `backups/`.
- Branch remota sanitizada criada: `sol-v2-sanitized`.
- `main` remoto ainda preserva histórico antigo até decisão de troca.
- `.gitignore` reforçado.

### Fase 2 — Identidade

- Em andamento: reescrever `SOUL.md`, `AGENTS.md`, `USER.md`, `MEMORY.md` no padrão Sol v2.

---

## Pendências

- Revisar identidade Sol v2 com Alf.
- Decidir se branch `sol-v2-sanitized` vira `main` após validação do Hugo.
- Padronizar Runtime Hermes/CWD na VPS.
- Configurar WhatsApp Hermes nativo para `552121700723`.
- Inventariar cron antigo dos relatórios diários Adm/Comercial.
- Gerar dry-run dos relatórios antes de qualquer envio real.
