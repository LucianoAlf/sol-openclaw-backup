# Inventário — Relatórios diários Administrativo/Comercial Sol v2

Data: 2026-07-26
Escopo: diagnóstico SELECT-only / arquivo-only. Nenhum cron foi ativado, nenhum DML/DDL foi executado e nenhuma mensagem real foi enviada.

## Resumo executivo

A retomada dos relatórios diários não é simplesmente “ligar cron”. O cron administrativo do LA Report está ativo e gerando fila. O problema atual está na etapa de envio WhatsApp, que ainda depende do pipeline legado WAHA/UAZAPI do LA Report.

Pela decisão Sol v2, a retomada correta deve migrar o envio para WhatsApp nativo Hermes da Sol, no número novo `552121700723`, após QR pairing e política listen-only/allowlist aprovada.

## Evidências principais

### 1. Scheduler OpenClaw/Hermes da Sol

Jobs atuais encontrados no scheduler interno da Sol:

- `sol-brain-supabase-keepalive`
- `Heartbeat — Aluno em risco silencioso`
- `Sol — Monitor Emusys × LA Report Barra para Arthur`
- `LA Report — Auditoria diária de crons`
- `LA Report — Auditoria de conversas (caixa de entrada)`

Não há job OpenClaw/Hermes atual chamado Relatório Diário Administrativo ou Relatório Diário Comercial.

### 2. pg_cron do LA Report

Crons relevantes no banco LA Report:

- `relatorio-diario-20h` — seg–sex, 20h BRT (`0 23 * * 1-5` UTC), ativo e com última execução `succeeded`.
- `relatorio-diario-sabado-16h` — sábado, 16h BRT (`0 19 * * 6` UTC), ativo e com última execução `succeeded`.
- `processar-mensagens-agendadas` — a cada minuto, ativo e com últimas execuções `succeeded`.
- `warm-enviar-mensagem-admin` — a cada 5 minutos, ativo.

Observação de segurança: os comandos pg_cron usam `net.http_post` para Edge Functions com bearer embutido no SQL. O valor não foi exposto neste documento, mas isso permanece como débito de hardening futuro.

### 3. Relatório Administrativo

Pipeline atual identificado no LA Report:

`pg_cron` → Edge Function `relatorio-admin-whatsapp` com `modo=cron` → tabela `fila_relatorios_whatsapp` → Edge Function `processar-mensagens-agendadas` → WhatsApp via WAHA/UAZAPI.

Estado da fila:

- Total histórico em `fila_relatorios_whatsapp`: 130.
- Enviadas: 76.
- Erro: 54.
- Último envio bem-sucedido: 2026-07-07.
- A partir de 2026-07-08: falha contínua, 3 mensagens/dia, uma por unidade.
- Erro atual registrado: `destravado: preso em enviando`.
- Tentativas recentes: 8 por item.

Dry-run seguro executado em 2026-07-26 via `modo=dry_run` da Edge Function:

- Barra: sucesso, 1856 caracteres.
- Campo Grande: sucesso, 3098 caracteres.
- Recreio: sucesso, 3443 caracteres.

Arquivos locais de preview:

- `/root/.openclaw/workspace/outputs/sol-v2/relatorios-dry-run-2026-07-26/barra.md`
- `/root/.openclaw/workspace/outputs/sol-v2/relatorios-dry-run-2026-07-26/campo-grande.md`
- `/root/.openclaw/workspace/outputs/sol-v2/relatorios-dry-run-2026-07-26/recreio.md`
- `/root/.openclaw/workspace/outputs/sol-v2/relatorios-dry-run-2026-07-26/summary.json`

Conclusão: a geração do Administrativo está funcional; o envio legado está quebrado.

### 4. Destinatários

A tabela `whatsapp_destinatarios_relatorio` possui destinatários ativos para:

- `relatorio_admin`: Barra, Campo Grande, Recreio.
- `relatorio_comercial`: Barra, Campo Grande, Recreio.
- `relatorio_coordenacao`: Coordenação Pedagógica.

Os JIDs foram consultados apenas para validação e não foram expostos aqui.

### 5. Caixa WhatsApp atual

`whatsapp_caixas` possui uma caixa ativa chamada `Sol`, com:

- `funcao = sistema`
- `provedor = waha`
- sessão legada, não correspondente ao número novo `552121700723`.

Também existem caixas ativas de Mila/Lia via UAZAPI.

Conclusão: o pipeline atual depende de canal legado/terceiro. Não deve ser reativado como atalho da Sol v2.

### 6. Relatório Comercial

Resultado do inventário:

- A tabela possui destinatários `relatorio_comercial` para as 3 unidades.
- A tabela `unidades` possui flag `relatorio_comercial_diario_cron_ativo`.
- Estado das flags:
  - Barra: `true`
  - Campo Grande: `false`
  - Recreio: `false`
- A fila `fila_relatorios_whatsapp` não possui nenhuma mensagem comercial histórica: 130 administrativos, 0 comerciais.
- Não foi encontrada Edge Function específica de relatório comercial diário.
- O código atual de `relatorio-admin-whatsapp` busca somente destinatários `tipo = relatorio_admin` e unidades com `relatorio_diario_cron_ativo = true`.

RPCs comerciais canônicas disponíveis para base do relatório:

- `get_kpis_comercial_canonicos_v2(p_unidade_id, p_ano, p_mes, p_periodo, p_data)`
- `get_dados_comercial_ia(p_unidade_id, p_ano, p_mes)`
- `get_experimentais_comercial_diagnostico_v2(...)`

Consulta SELECT-only em 2026-07-26 confirmou que `get_kpis_comercial_canonicos_v2` retorna dados diários/mensais por unidade.

Conclusão: o Comercial ainda não está implementado como pipeline diário real. Existe configuração parcial, mas não geração/envio.

## Diagnóstico

1. Administrativo:
   - geração: OK;
   - cron do LA Report: OK;
   - fila: OK até entrar em envio;
   - envio WhatsApp legado: quebrado desde 2026-07-08;
   - retomada correta: migrar envio para Hermes WhatsApp nativo da Sol.

2. Comercial:
   - base canônica de KPI existe;
   - destinatários existem;
   - flags existem;
   - geração diária/enfileiramento/envio ainda não existem no código atual;
   - precisa de implementação/dry-run antes de produção.

## Próximo plano seguro

### Fase A — WhatsApp Sol v2 nativo

Pré-requisitos:

- parear QR do número `552121700723` no Hermes;
- manter grupos em modo ouvir/listen-only inicialmente;
- coletar/validar JIDs dos grupos de relatórios;
- manter allowlist inicial restrita ao Alf e grupos aprovados.

### Fase B — Adaptador de envio Hermes-native

Criar um adaptador seguro para a Sol enviar relatórios usando WhatsApp nativo Hermes, sem UAZAPI.

Regras:

- não usar caixa WhatsApp de Mila, Lia ou Sol legado como atalho;
- não religar envio WAHA/UAZAPI para Sol v2;
- dry-run antes de qualquer envio real;
- envio real só com aprovação explícita.

### Fase C — Administrativo em dry-run operacional

Opções seguras:

1. Ler fila/gerar relatório e postar preview local/Telegram interno para validação.
2. Depois de aprovado, enviar via Hermes nativo para grupos de relatório.
3. Só então decidir se o pg_cron antigo continua gerando fila ou se a Sol assume geração+envio ponta a ponta.

### Fase D — Comercial em dry-run

Montar template do relatório comercial diário com base em `get_kpis_comercial_canonicos_v2`, marcando campos ainda diagnósticos quando aplicável.

Não ativar Campo Grande/Recreio nem enviar grupo antes de validação de formato e regra.

## Bloqueios / aprovações necessárias

- QR pairing do WhatsApp `552121700723`.
- Aprovação explícita para qualquer envio real em grupo.
- Aprovação explícita para ativar cron em produção.
- Aprovação explícita para qualquer DML/DDL no LA Report.
- Decisão sobre formato final do relatório comercial diário.

## Débitos de segurança anotados

- Bearer em comandos `pg_cron` do LA Report.
- Pipeline legado de envio usa WAHA/UAZAPI.
- Erro da fila sobrescreve causa original com `destravado: preso em enviando`, dificultando auditoria.
- Possível drift entre código local e Edge Function deployada, pois a tabela possui campos `tentativas`/`ultima_tentativa_em` usados em produção mas não encontrados no arquivo local `processar-mensagens-agendadas/index.ts`.
