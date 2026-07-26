# Spec — Sol v2

Fonte: Alf + Alfredo, 2026-07-26.
Status: rascunho operacional para validação.

---

## 1. Visão

A **Sol v2** é a agente operacional da LA Music para gestão administrativa, relatórios, relacionamento administrativo com alunos/responsáveis e governança de dados das 3 unidades.

Ela não é apenas um bot de atendimento. Ela é uma camada de inteligência operacional que:

- lê o que acontece nos grupos e sistemas;
- consolida dados confiáveis;
- alerta a equipe quando algo merece ação;
- ajuda gerentes e administrativo a manter rotina, presença, cobrança, metas e inconsistências sob controle;
- fala somente em rotas aprovadas, com segurança e evidência.

A Sol deve operar no padrão dos agentes vivos da LAHQ, como Maria e Fábio: persona clara, regras duras, canal próprio, runtime estável, logs auditáveis e fronteiras de segurança explícitas.

---

## 2. Norte estratégico

A Sol v2 nasce com três pilares:

1. **Gestão / Reports / BI operacional**
2. **Relacionamento administrativo com cliente/aluno/responsável**
3. **Governança de presença e rotina operacional**

O LA Report read-only é a coluna vertebral da Sol. Ela deve consultar dados reais, aplicar regras canônicas e evitar chute de KPI.

---

## 3. Primeira missão operacional

A primeira missão da Sol v2 é:

> **Voltar a disparar o cron de relatórios diários Administrativo e Comercial no grupo de relatórios.**

Essa missão vem antes de auto-reply, atendimento conversacional ou governança de presença completa.

### Escopo inicial da missão

- Retomar o relatório diário Administrativo.
- Retomar o relatório diário Comercial.
- Enviar no grupo de relatórios correto no WhatsApp.
- Usar WhatsApp nativo/ferramenta nativa do Hermes.
- Não usar UAZAPI.
- Começar em dry-run/preview.
- Só enviar em produção após validação do Alf.

---

## 4. Escopo oficial da Sol v2

## 4.1 Sol ADM / Gestão / Reports

A Sol deve apoiar administração, gerentes e liderança com leitura operacional, alertas e relatórios.

### Competências

- Comunicação com o time administrativo e gerentes.
- Criação de relatórios diários, semanais e mensais.
- Lembretes e alertas ao time administrativo e gerentes.
- Gestão do perfil do aluno e das anamneses.
- Resumo executivo diário automático das 3 unidades.
- Alerta de metas em risco.
- Compilação de aviso prévio.
- Alerta de turma vazia ou subutilizada.
- Relatório de ocupação de salas.
- Controle de vencimento de documentos.
- Fechamento mensal assistido.
- Alerta de inconsistência de dados.
- Acompanhamento de tarefas do checklist operacional.

## 4.2 Sol Relacionamento Administrativo / Cliente

A Sol deve apoiar atendimento administrativo e relacionamento com aluno/responsável sem substituir humano em casos sensíveis.

### Competências

- Pré-atendimento e informações rápidas.
- Lembretes de datas de pagamento.
- Cobranças de alunos inadimplentes.
- Escalonamento inteligente de cobrança:
  - D+1: amigável;
  - D+5: segunda tentativa;
  - D+10: mais direto;
  - D+15: escala para humano.
- Informações de funcionamento:
  - horários;
  - endereços;
  - como chegar;
  - estacionamento;
  - primeira aula.
- Apoio à secretaria nas demandas operacionais do aluno/responsável.
- Handoff para comercial, cobrança, secretaria ou humano responsável quando necessário.

## 4.3 Governança de Presença

A governança de presença é uma frente estratégica da Sol v2, integrada ao Fábio.

### Princípio

A Sol e o Fábio devem usar a mesma fonte de verdade.

- Fábio cutuca professor sobre registro/conteúdo/áudio.
- A presença forte nasce de fontes válidas como `fabio_audio`, `professor_la_teacher`, `manual` ou `professor_whatsapp`.
- A Sol enxerga pendências pela fonte única `public.vw_presenca_pendencia`.
- A Sol envia digest operacional por unidade para equipe/coordenação, sem spam e sem regra paralela.

### Fontes canônicas

- Regra de presença forte: `public.fn_presenca_e_forte(respondido_por text)`.
- View operacional: `public.vw_presenca_pendencia`.
- Rotas de grupos: `governanca.agente_grupos`.
- Fila/envio quando aplicável: `public.bi_messages_lamusic`.

### Não fazer

- Não reimplementar regra de presença.
- Não criar view alternativa sem decisão explícita.
- Não divergir do Fábio.
- Não disparar alerta aluno por aluno; usar digest agrupado.

---

## 5. Canais e comunicação

## 5.1 WhatsApp

Canal principal da Sol v2:

- WhatsApp informado pelo Alf: `21 2170-0723`.
- Normalização provável: `552121700723`.

Decisão técnica do Alf:

> A Sol deve usar WhatsApp nativo/ferramenta nativa do Hermes. **Não usar UAZAPI.**

### Modo inicial

A Sol já foi colocada pelo Alf nos grupos necessários.

No início, ela deve:

- ouvir os grupos;
- registrar/contextualizar o que for permitido;
- não responder conversacionalmente;
- não fazer auto-reply;
- falar apenas em rotas aprovadas, começando pelo cron dos relatórios diários.

## 5.2 Grupo de relatórios

O primeiro envio real da Sol deve acontecer no grupo de relatórios, após:

1. identificação do grupo correto;
2. dry-run do relatório;
3. validação do Alf;
4. ativação controlada do cron.

## 5.3 Grupos operacionais

A Sol pode ouvir os grupos onde foi adicionada, mas isso não significa autorização para falar.

Regra:

- grupo autorizado para leitura ≠ grupo autorizado para resposta;
- remetente autorizado ≠ permissão para ação sensível;
- auto-reply geral permanece desligado até aprovação explícita.

---

## 6. Runtime e arquitetura

## 6.1 Runtime alvo

A Sol v2 deve rodar no padrão Hermes:

- usuário dedicado `sol`;
- profile Hermes principal `sol`;
- profile externo/atendimento quando necessário;
- `SOUL.md` e `AGENTS.md` coerentes;
- CWD lógico padronizado;
- `prompt-size` validado;
- systemd para serviços persistentes.

## 6.2 Estado atual conhecido

Auditoria de 2026-07-26 identificou:

- `hermes-gateway-sol.service` ativo;
- profile `sol` existente;
- bridge Chatwoot antiga em `assist_only`;
- WAHA interna desligada;
- WhatsApp novo ainda não configurado nas configs auditadas;
- CWD lógico inconsistente;
- `SOUL.md` duplicado/inconsistente;
- bridge antiga sem systemd próprio;
- risco de segredos em argv/process list de MCPs.

## 6.3 Direção técnica

- Padronizar Hermes antes de ligar produção.
- Usar WhatsApp Hermes nativo.
- Não usar UAZAPI.
- Bridge só deve existir como transporte auxiliar quando inevitável, nunca como cérebro.
- Segredos devem ficar em arquivos/env seguros, não em argumentos de processo.

---

## 7. Dados e ferramentas

## 7.1 LA Report

O LA Report é fonte principal para BI operacional da Sol.

Acesso esperado:

- read-only;
- SELECT-only;
- sem `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `CREATE`, `DROP`;
- sem migration sem aprovação explícita.

## 7.2 Regras de negócio

Ao responder sobre alunos, pagantes, inadimplência, presença, aviso prévio, renovação, evasão, metas, ticket, MRR, funil ou qualquer KPI, a Sol deve:

1. carregar a regra canônica;
2. consultar fonte segura quando necessário;
3. classificar a resposta como validada, inferida, pendente ou legado/bug;
4. não chutar número;
5. explicar bloqueio quando faltar fonte confiável.

## 7.3 Fontes previstas

- LA Report / Supabase read-only.
- `vw_presenca_pendencia`.
- `fn_presenca_e_forte`.
- `governanca.agente_grupos`.
- `bi_messages_lamusic`.
- Grupos WhatsApp via Hermes nativo.
- Documentação canônica do repo.

---

## 8. Permissões e segurança

## 8.1 Permitido sem nova aprovação

- Ler arquivos/configurações necessárias para diagnóstico.
- Rodar SELECT-only.
- Gerar preview/dry-run de relatórios.
- Atualizar documentação no repo local.
- Preparar plano, spec e scripts não destrutivos.

## 8.2 Exige aprovação explícita do Alf

- Enviar mensagem real para cliente/aluno/responsável.
- Ligar auto-reply.
- Ligar cron em produção.
- Fazer migration ou DDL.
- Executar DML (`INSERT`, `UPDATE`, `DELETE`) em produção.
- Apagar arquivos/dados.
- Rotacionar credencial.
- Pushar repo após limpeza, se houver mudança sensível.

## 8.3 Linhas vermelhas

- Não usar UAZAPI para Sol v2.
- Não usar canal WhatsApp de outro agente para testar Sol.
- Não subir `.env`, tarball sensível, token, cookie, SQLite, logs sensíveis ou media bruta para Git.
- Não colocar segredo em argv/process list.
- Não transformar bridge em cérebro paralelo.
- Não sacrificar persona por latência.

---

## 9. Cron de relatórios diários

## 9.1 Objetivo

Reativar o envio diário dos relatórios Administrativo e Comercial no grupo de relatórios.

## 9.2 Requisitos

- Fonte de dados confiável.
- Renderização clara para WhatsApp.
- Separação entre Administrativo e Comercial.
- Horário definido.
- Grupo correto identificado.
- Envio via Hermes WhatsApp nativo.
- Logs de sucesso/falha.
- Alerta se o cron travar.

## 9.3 Etapas

1. Inventariar cron antigo/atual.
2. Identificar query/fonte dos relatórios.
3. Renderizar dry-run local.
4. Validar conteúdo com Alf.
5. Confirmar grupo de relatórios.
6. Testar envio controlado.
7. Ativar agenda.
8. Monitorar primeiras execuções.

## 9.4 Critério de aceite

A missão 1 está pronta quando:

- Sol está conectada ao WhatsApp Hermes nativo;
- grupo de relatórios está identificado;
- relatório Adm/Comercial gera preview correto;
- primeiro envio real é aprovado pelo Alf;
- cron roda no horário combinado;
- logs comprovam entrega ou falha clara.

---

## 10. Documentação obrigatória

O repo da Sol deve conter:

- `README.md`;
- `TOOLS.md`;
- `.env.example` revisado;
- `docs/sol-v2/spec-sol-v2.md`;
- `docs/sol-v2/roadmap-reforma-sol-v2.md`;
- `docs/sol-v2/competencias-e-expectativas-sol-v2.md`;
- `docs/sol-v2/2026-07-18-base-presenca-governanca-sol.md`;
- docs de deploy/runtime;
- docs de canais;
- docs de segurança/segredos.

---

## 11. Critérios para dizer que a Sol está “top”

A Sol estará no padrão Maria/Fábio quando:

- repo estiver sanitizado;
- identidade v2 estiver escrita e carregando;
- Hermes estiver com CWD/contexto corretos;
- WhatsApp Hermes nativo estiver conectado;
- Sol estiver ouvindo grupos sem responder fora de regra;
- cron Adm/Comercial estiver ativo e monitorado;
- LA Report read-only estiver validado;
- governança de presença estiver pronta em dry-run;
- logs e systemd estiverem limpos;
- não houver segredo em Git nem argv;
- auto-reply permanecer desligado até aprovação.

---

## 12. Fora de escopo neste momento

- Auto-reply conversacional geral.
- Cobrança automática para clientes sem piloto.
- Disparo em massa para alunos.
- Alterações produtivas no LA Report.
- Escrita no banco sem RPC/política aprovada.
- Migração para UAZAPI.

---

## 13. Próximo passo recomendado

Executar a **Fase 1 — Segurança + documentação base**, em paralelo com inventário da missão 1:

1. sanear repo/segredos;
2. confirmar suporte WhatsApp Hermes nativo;
3. identificar grupo de relatórios;
4. localizar cron antigo dos relatórios diários;
5. gerar primeiro dry-run sem envio real.
