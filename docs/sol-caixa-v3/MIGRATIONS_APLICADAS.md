# Manifesto de Migrations Aplicadas — Caixa V3

Banco alvo: LA Report.

Este arquivo registra as migrations relevantes aplicadas durante o trabalho do Caixa V3. O SQL exato deve ser recuperado do historico de migrations do Supabase/LA Report quando for consolidado no repositorio canonico do LA Report. Este repositorio da Sol guarda o manifesto porque o runtime da Sol depende dessas RPCs/tabelas.

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

## Observacao

Este manifesto nao substitui o repositorio/migration history do LA Report. Ele existe para que a Sol tenha rastreabilidade do que seu runtime espera encontrar no banco.
