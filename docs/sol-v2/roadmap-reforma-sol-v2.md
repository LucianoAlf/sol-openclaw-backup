# Roadmap — Reforma da Sol v2

Fonte: Alf + Alfredo, 2026-07-26.

Objetivo: colocar a Sol no mesmo padrão operacional de Maria/Fábio, com segurança, identidade viva, runtime confiável, WhatsApp controlado e LA Report read-only como coluna vertebral.

---

## Norte da Sol v2

A Sol v2 tem duas frentes oficiais:

1. **Sol ADM / Gestão / Reports**
   - comunicação com time administrativo e gerentes;
   - relatórios diários, semanais e mensais;
   - lembretes e alertas;
   - perfil do aluno e anamneses;
   - resumo executivo diário das 3 unidades;
   - metas em risco;
   - aviso prévio;
   - turmas vazias/subutilizadas;
   - ocupação de salas;
   - vencimento de documentos;
   - fechamento mensal assistido;
   - inconsistência de dados;
   - checklist operacional.

2. **Sol Relacionamento Administrativo / Cliente**
   - pré-atendimento e informações rápidas;
   - lembretes de pagamento;
   - cobrança de inadimplentes;
   - régua D+1, D+5, D+10, D+15;
   - funcionamento, horários, endereços, estacionamento e primeira aula;
   - apoio à secretaria;
   - handoff para comercial, cobrança, secretaria ou humano responsável.

A primeira missão operacional da Sol v2 é **voltar a disparar o cron de relatórios diários do Administrativo e Comercial no grupo de relatórios**.

A governança de presença permanece como frente operacional estratégica seguinte, integrada ao Fábio e ao LA Report.

---

## Regra de ouro técnica

- LA Report é vantagem estratégica da Sol, mas deve permanecer **read-only** para consulta operacional.
- A Sol não chuta KPI.
- A Sol separa sempre:
  - regra canônica;
  - legado;
  - possível bug;
  - pendência de validação.
- Qualquer escrita, migration, alteração produtiva, envio externo sensível ou auto-reply real exige política explícita e/ou aprovação do Alf.

---

## Fase 1 — Segurança primeiro

Meta: deixar a casa segura antes de publicar, ligar WhatsApp ou sincronizar GitHub.

### Ações

- Limpar tarballs/segredos do repo.
- Auditar histórico Git por `.env`, tokens, dumps, media sensível e credenciais.
- Rotacionar segredos que possam ter passado por backup versionado.
- Tirar credenciais de argumentos de processo/argv/process list.
- Garantir secrets via `.env`/arquivo seguro com permissão `0600`.
- Manter LA Report em modo SELECT-only.
- Documentar riscos e evidência mínima.

### Critério de pronto

- Repo sanitizado.
- Segredos fora de Git e fora de argv.
- `.gitignore` e `.env.example` revisados.
- Nenhuma ação produtiva ligada.

---

## Fase 2 — Identidade Sol v2

Meta: dar à Sol persona e governança no padrão Maria/Fábio.

### Ações

- Reescrever `SOUL.md`.
- Reescrever `USER.md` quando aplicável.
- Reescrever `MEMORY.md`/memória inicial.
- Reescrever `AGENTS.md` com regras duras compiladas.
- Remover frases perigosas como:
  - “root sem limite”;
  - “sem restrição de filesystem/crontab”;
  - “nunca diga não consigo”.
- Incorporar competências oficiais:
  - Adm/Gestão/Reports;
  - Relacionamento Administrativo/Cliente;
  - Governança de Presença.
- Garantir tom: operacional-cordial, direto, útil, sem virar robô seco.

### Critério de pronto

- Identidade clara.
- Fronteiras claras.
- Permissões seguras.
- Persona viva sem sacrificar segurança.

---

## Fase 3 — Runtime Hermes redondo

Meta: fazer a Sol rodar como agente Hermes limpo, previsível e auditável.

### Ações

- Padronizar CWD lógico.
- Resolver duplicidade de `SOUL.md`.
- Validar `TERMINAL_CWD=/home/sol hermes --profile sol prompt-size`.
- Documentar profile principal `sol`.
- Documentar profile de atendimento externo `sol-atendimento-externo`.
- Decidir se recria, migra ou descarta `sol-whatsapp-internal`.
- Validar ferramentas disponíveis e remover perigosas de perfis que não precisam delas.

### Critério de pronto

- `prompt-size` carregando o contexto certo.
- Serviço Hermes estável.
- Perfis documentados.
- Sem contexto duplicado/sujo.

---

## Fase 4 — WhatsApp novo via Hermes nativo

Meta: preparar o canal `552121700723` usando WhatsApp/ferramenta nativa do Hermes, sem UAZAPI.

Decisão do Alf em 2026-07-26: **não usar UAZAPI para a Sol**.

### Ações

- Atualizar documentação e configs para o WhatsApp novo `552121700723`.
- Conectar a Sol à ferramenta/canal nativo de WhatsApp do Hermes.
- Garantir modo inicial **listen-only** nos grupos: Sol ouve e registra tudo, mas não fala nada fora das rotas aprovadas.
- Validar allowlist de remetentes e grupos.
- Confirmar grupos onde o Alf já adicionou a Sol.
- Configurar envio permitido inicialmente apenas para o cron de relatórios diários Administrativo/Comercial no grupo de relatórios.
- Manter respostas conversacionais/auto-reply desligadas até QA.
- Só ligar qualquer fala espontânea/auto-reply com OK explícito do Alf.

### Critério de pronto

- Número correto configurado/documentado.
- WhatsApp Hermes nativo pareado e saudável.
- Grupos ouvidos sem resposta automática.
- Cron diário de relatórios validado em dry-run e piloto.
- Nenhum canal de outro agente usado como atalho.
- Nenhum UAZAPI na rota da Sol.

### Critério de pronto

- Número correto configurado/documentado.
- Nenhum canal de outro agente usado como atalho.
- Testes feitos sem envio real indevido.

---

## Fase 5 — Bridge em produção de verdade

Meta: transformar o `chatwoot-sol-bridge` em serviço de produção, não processo solto.

### Ações

- Criar unidade systemd para `chatwoot-sol-bridge`.
- Definir `Restart=always` e healthcheck.
- Padronizar logs.
- Sanitizar logs para não vazar segredo/dado sensível.
- Documentar start/stop/restart/status.
- Validar reboot recovery.

### Critério de pronto

- Bridge sobe sozinho.
- Healthcheck responde.
- Logs são úteis e seguros.

---

## Fase 6 — LA Report / BI / Relatórios Diários / Governança de Presença

Meta: usar LA Report read-only como coluna vertebral da Sol, começando pela retomada dos relatórios diários Administrativo e Comercial.

### Ações BI gerais

- Garantir skill canônica `sol-la-report-business-rules` carregando.
- Testar consultas SELECT-only.
- Responder métricas com regra validada, sem chute.
- Separar regra canônica, legado, possível bug e pendência.
- Usar evidência mínima antes de alertar gerente/equipe.

### Missão operacional 1 — Cron de relatórios diários Adm/Comercial

- Inventariar cron atual/antigo dos relatórios diários administrativo e comercial.
- Confirmar grupo de relatórios no WhatsApp Hermes.
- Rodar consulta e renderização em dry-run.
- Validar conteúdo com Alf antes do primeiro envio real.
- Ativar agenda diária somente para essa rota aprovada.
- Registrar logs de sucesso/falha e alerta de cron travado.

### Ações de presença

- Validar existência de:
  - `public.fn_presenca_e_forte`;
  - `public.vw_presenca_pendencia`;
  - `governanca.agente_grupos`;
  - `public.bi_messages_lamusic`.
- Reaproveitar JIDs da Lia para cadastrar a Sol nos grupos de equipe por unidade.
- Definir grupo da coordenação para escala de professores com 3+ dias.
- Criar digest diário 8h por unidade.
- Usar tom anti-fadiga: agrupado, claro, sem spam.
- Primeiro dry-run/preview; depois piloto; depois produção.

### Critério de pronto

- Consulta read-only validada.
- Digest de presença aprovado em preview.
- Rotas de grupo confirmadas.
- Nenhuma regra paralela criada.

---

## Fase 7 — Repo padrão Maria/Fábio

Meta: deixar o repo da Sol compreensível, seguro e operável.

### Ações

- Criar/atualizar `README.md`.
- Criar/atualizar `TOOLS.md`.
- Revisar `.env.example`.
- Criar docs de deploy.
- Criar docs de canais.
- Criar docs de governança de presença.
- Criar docs de segurança/segredos.
- Criar backup sanitizado.
- Sincronizar local/GitHub só depois da limpeza.

### Critério de pronto

- Novo operador entende como a Sol vive.
- GitHub não contém segredo.
- Repo reflete o estado real da VPS.

---

## Ordem recomendada

1. Segurança.
2. Identidade/docs.
3. Runtime Hermes.
4. WhatsApp novo via Hermes nativo, sem UAZAPI.
5. Relatórios diários Adm/Comercial em dry-run.
6. Ativação controlada do cron no grupo de relatórios.
7. Bridge/serviço de produção se ainda for necessário para componentes auxiliares.
8. LA Report/BI/presença.
9. QA.
10. Auto-reply somente com aprovação explícita.

---

## Não fazer ainda

- Não ligar `auto_reply`.
- Não enviar mensagem real para aluno/cliente.
- Não commitar/pushar enquanto o repo tiver risco de segredo.
- Não criar regra paralela de presença.
- Não usar canal WhatsApp de outro agente para testar Sol.
- Não usar UAZAPI na Sol v2; decisão do Alf: WhatsApp via Hermes nativo.
- Não executar DDL/DML no LA Report sem aprovação explícita.
