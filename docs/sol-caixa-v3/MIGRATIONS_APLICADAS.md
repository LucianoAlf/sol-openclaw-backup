# Manifesto de Migrations Aplicadas — Caixa V3

Banco alvo: LA Report.

Este arquivo registra as migrations relevantes aplicadas durante o trabalho do Caixa V3. O SQL canônico nasce no repositório **LA Report** (`supabase/migrations/`); este manifesto é apenas o espelho de dependências do runtime da Sol. Nunca reaplicar pelo runtime da Sol uma migration já versionada/aplicada pelo LA Report.

## Caixa base e operacao

- `20260815170841` — `sol_caixa_ingestao_fatia0`
- `20260815174440` — `sol_caixa_lancar_recebimento_fatia1`
- `20260815180146` — `sol_caixa_policy_qualquer_membro`
- `20260815211530` — `sol_caixa_abrir_fechar_fatia2`
- `20260815211952` — `sol_caixa_pendencia_abrir_fechar`
- `20260815212110` — `sol_caixa_dados_abertura`
- `20260815212204` — `sol_caixa_dados_abertura_add_caixa_id`
- `20260815220046` — `sol_caixa_casar_parcela`
- `20260815220218` — `sol_caixa_casar_parcela_v2_multiplas`
- `20260817191842` — `sol_caixa_responsavel_aluno`
- `20260817191920` — `sol_caixa_lancar_recebimento_v2_carimbo`
- `20260817192508` — `sol_caixa_responsavel_aluno_fix_cast`
- `20260817202928` — `sol_caixa_aluno_por_responsavel`
- `20260817203030` — `sol_caixa_identificar_por_pagador`
- `20260817203115` — `sol_caixa_identificar_por_pagador_v2`
- `20260817203159` — `sol_caixa_identificar_por_pagador_v3`
- `20260817212935` — `sol_caixa_parcela_canonica`
- `20260817214219` — `sol_caixa_ja_lancado_hoje`
- `20260817233914` — `sol_caixa_resumo_do_dia`
- `20260818155800` — `grant_rpcs_canonicas_sol_acesso_restrito`
- `20260818170700` — `sol_custo_seguranca_v1_wrapper`
- `20260819211930` — `sol_caixa_corrigir_forma_recebimento`
- `20260819214146` — `sol_caixa_buscar_lancamento_para_correcao`
- `20260819230337` — `sol_caixa_lancar_saida_rpc`

## V3 gates, ledger, autorizacao e hardening

- `20260820180646` — `sol_caixa_readonly_role_gate_b_real_20260820`
- `20260820180838` — `sol_caixa_readonly_gate_b_usuario_select_20260820`
- `20260820180938` — `sol_caixa_readonly_preflight_function_20260820`
- `20260820204455` — `add_mayra_rose_governanca_agente_usuarios_v2`
- `20260820213643` — `sol_caixa_v3_least_privilege_autorizacao_20260820`
- `20260820215433` — `sol_caixa_v3_shadow_ledger_20260820`
- `20260820221111` — `sol_caixa_v3_shadow_approval_rpc_20260820`
- `20260820224331` — `sol_caixa_group_members_authorized_policy`
- `20260820224437` — `fix_sol_caixa_preflight_v3_role_none`
- `20260820224745` — `grant_sol_caixa_rpc_tools_to_restricted_runtime`
- `20260820230346` — `sol_caixa_movimento_edicao_estorno_v1`
- `20260820230454` — `sol_caixa_movimento_edicao_estorno_v1_harden_grants_auth`
- `20260820235025` — `sol_caixa_hardening_auditoria_idempotencia_20260820`
- `20260821002630` — `sol_caixa_v3_approval_acl_hardening`
- `20260821014456` — `sol_caixa_v3_fail_closed_approval_guard_20260821`
- `20260821015504` — `sol_caixa_v3_consumos_revoke_cross_agent_select_20260821`
- `20260821093045` — `sol_caixa_v3_validator_operacao_campos_grupo_ator`
- `20260821093700` — `sol_caixa_v3_guard_corrigir_estornar_movimento`
- `20260821094101` — `sol_caixa_v3_disable_legacy_corrigir_forma_rpc_for_sol`
- `20260821094848` — `harden_sol_caixa_shadow_preview_writer_v3`

## LA Report canônico — 22/08/2026

As cinco migrations abaixo já estão aplicadas no banco e versionadas no LA Report. Referência de código: `origin/main` do LA Report, PRs #191, #193, #194 e #195.

- `20260822120000` — `sol_caixa_destrava_canonicas_via_wrappers_jwt` (PR #191): `parcela_canonica`, `resolver_multi_aluno_v1` e `inadimplentes` passam pelos wrappers canônicos, eliminando o 42501 por claim ausente.
- `20260822121500` — `sol_caixa_casar_parcela_date_aware` (PR #191): valor de parcela passa a respeitar pontualidade, desconto condicional e atraso.
- `20260822151500` — `caixa_movimentacoes_vinculo_aluno_fatura_e_grants_sol` (PR #193): adiciona os vínculos estruturados `aluno_id`/`fatura_id` e os preenche nos lançamentos permitidos.
- `20260822170000` — `reverte_grants_que_desfaziam_fail_closed_v3_sol` (PR #194): restaura o fail-closed do V3; a correção legada de forma não volta a ser executável pela Sol.
- `20260822180000` — `sol_caixa_multi_aluno_snapshot_v2_merged` (PR #195): preview resolve uma vez; o `pode` valida o mesmo snapshot de fatura/valor/competência sem reescolha.

### Regra de substituição

- A draft local `20260821_multi_aluno_derivacao_canonica.sql` foi absorvida e **não deve ser aplicada**. Ela é histórica; a fonte correta é `20260822180000_sol_caixa_multi_aluno_snapshot_v2_merged.sql` no LA Report.
- Migrations futuras de `sol_caixa_*` nascem no LA Report; este arquivo recebe somente o espelho com versão, nome, PR e dependência do runtime.

## Observacao

Este manifesto nao substitui o repositorio/migration history do LA Report. Ele existe para que a Sol tenha rastreabilidade do que seu runtime espera encontrar no banco.
