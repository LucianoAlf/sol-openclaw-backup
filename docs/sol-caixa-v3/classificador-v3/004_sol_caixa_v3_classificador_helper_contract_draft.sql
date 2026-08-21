-- Draft Fase 3: contrato real dos helpers canônicos do Caixa.
-- Não aplicar em produção. Depende de 001 + 002.
--
-- Assinaturas confirmadas por leitura do banco vivo em 2026-08-21:
--   sol_caixa_grupo_operacao_ok(uuid,text,text) returns jsonb
--   sol_caixa_ator_operacao_ok(uuid,text,text) returns jsonb
--
-- A facade continua intent-only: não cria preview, approval ou movimento.

create or replace function public.sol_caixa_v3_match_token(
  p_texto text,
  p_termo text
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  with normalizado as (
    select
      trim(regexp_replace(
        translate(lower(coalesce(p_texto, '')),
          'áàâãäéèêëíìîïóòôõöúùûüç',
          'aaaaaeeeeiiiiooooouuuuc'),
        '[^[:alnum:]]+', ' ', 'g')) as texto,
      trim(regexp_replace(
        translate(lower(coalesce(p_termo, '')),
          'áàâãäéèêëíìîïóòôõöúùûüç',
          'aaaaaeeeeiiiiooooouuuuc'),
        '[^[:alnum:]]+', ' ', 'g')) as termo
  )
  select termo <> ''
     and position(' ' || termo || ' ' in ' ' || texto || ' ') > 0
  from normalizado;
$$;

create or replace function public.sol_caixa_v3_classificar_evento(p_evento jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_texto text := coalesce(p_evento->>'texto_normalizado', '');
  v_media_status text := coalesce(p_evento->>'media_status', 'ready');
  v_grupo_jid text := nullif(p_evento->>'grupo_jid', '');
  v_unidade_id uuid := nullif(p_evento->>'unidade_id', '')::uuid;
  v_actor text := nullif(p_evento->>'actor_phone', '');
  v_actor_status text := coalesce(p_evento->>'actor_status', 'resolved');
  v_valor_centavos integer;
  v_top_id uuid;
  v_top_chave text;
  v_top_versao integer;
  v_top_confianca numeric;
  v_top_intencao jsonb;
  v_top_matcher jsonb;
  v_top_campos_obrigatorios text[];
  v_top_versao_contrato integer;
  v_tie_count integer := 0;
  v_operacao text;
  v_grupo_auth jsonb;
  v_ator_auth jsonb;
begin
  if coalesce(p_evento->>'valor_centavos', '') ~ '^[1-9][0-9]*$' then
    v_valor_centavos := (p_evento->>'valor_centavos')::integer;
  end if;

  if v_media_status = 'pending' then
    return jsonb_build_object('ok', true, 'stage', 'deterministic',
      'status', 'media_pending', 'contract_version', 1, 'writes', false);
  end if;

  if v_actor_status <> 'resolved' or v_actor is null then
    return jsonb_build_object('ok', true, 'stage', 'deterministic',
      'status', 'manual_review', 'reason', 'identity_unknown',
      'contract_version', 1, 'writes', false);
  end if;

  if v_grupo_jid is null or v_unidade_id is null then
    return jsonb_build_object('ok', true, 'stage', 'deterministic',
      'status', 'manual_review', 'reason', 'canonical_context_required',
      'contract_version', 1, 'writes', false);
  end if;

  with regras as (
    select r.*
    from public.sol_classificacao_regras r
    where r.status = 'ativa'
      and r.escopo in ('fluxo', 'geral')
      and (r.escopo_grupo_jid is null or r.escopo_grupo_jid = v_grupo_jid)
      and (r.escopo_unidade_id is null or r.escopo_unidade_id = v_unidade_id)
      and (not (r.matcher ? 'all_terms') or coalesce((
        select bool_and(public.sol_caixa_v3_match_token(v_texto, terms.value))
        from jsonb_array_elements_text(r.matcher->'all_terms') as terms(value)
      ), true))
      and (not (r.matcher ? 'any_terms') or exists (
        select 1
        from jsonb_array_elements_text(r.matcher->'any_terms') as terms(value)
        where public.sol_caixa_v3_match_token(v_texto, terms.value)
      ))
      and (not (r.matcher ? 'none_terms') or not exists (
        select 1
        from jsonb_array_elements_text(r.matcher->'none_terms') as terms(value)
        where public.sol_caixa_v3_match_token(v_texto, terms.value)
      ))
  ), ordenadas as (
    select r.*, dense_rank() over (order by r.prioridade desc, r.confianca desc) as faixa
    from regras r
  )
  select id, chave_regra, versao, confianca, intencao, matcher,
         campos_obrigatorios, versao_contrato, count(*) over ()
    into v_top_id, v_top_chave, v_top_versao, v_top_confianca,
         v_top_intencao, v_top_matcher, v_top_campos_obrigatorios,
         v_top_versao_contrato, v_tie_count
  from ordenadas
  where faixa = 1
  order by chave_regra asc, versao desc
  limit 1;

  if v_top_id is null then
    return jsonb_build_object('ok', true, 'stage', 'deterministic',
      'status', 'no_match', 'contract_version', 1, 'writes', false);
  end if;

  if v_tie_count > 1 then
    return jsonb_build_object('ok', true, 'stage', 'deterministic',
      'status', 'ambiguous', 'reason', 'rule_tie',
      'rule_id', v_top_chave || ':v' || v_top_versao,
      'contract_version', 1, 'writes', false);
  end if;

  v_operacao := nullif(v_top_intencao->>'operacao', '');
  if v_operacao is null then
    return jsonb_build_object('ok', true, 'stage', 'deterministic',
      'status', 'manual_review', 'reason', 'rule_operation_missing',
      'contract_version', 1, 'writes', false);
  end if;

  -- O helper de ator pode aceitar qualquer membro pela política da unidade;
  -- portanto o grupo oficial precisa ser validado primeiro e separadamente.
  v_grupo_auth := public.sol_caixa_grupo_operacao_ok(v_unidade_id, v_grupo_jid, v_operacao);
  if coalesce((v_grupo_auth->>'autorizado')::boolean, false) is not true then
    return jsonb_build_object('ok', true, 'stage', 'deterministic',
      'status', 'manual_review', 'reason', 'canonical_group_rejected',
      'contract_version', 1, 'writes', false);
  end if;

  v_ator_auth := public.sol_caixa_ator_operacao_ok(v_unidade_id, v_actor, v_operacao);
  if coalesce((v_ator_auth->>'autorizado')::boolean, false) is not true then
    return jsonb_build_object('ok', true, 'stage', 'deterministic',
      'status', 'manual_review', 'reason', 'canonical_actor_rejected',
      'contract_version', 1, 'writes', false);
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true, 'stage', 'deterministic', 'status', 'classified',
    'rule_id', v_top_chave || ':v' || v_top_versao,
    'operacao', v_operacao,
    'categoria', v_top_intencao->>'categoria',
    'forma', v_top_intencao->>'forma',
    'cartao_modalidade', v_top_intencao->>'cartao_modalidade',
    'valor_centavos', v_valor_centavos,
    'confidence', v_top_confianca,
    'evidence', coalesce(v_top_matcher->'evidence', '[]'::jsonb),
    'requires', to_jsonb(v_top_campos_obrigatorios),
    'unit_source', 'group_jid',
    'contract_version', v_top_versao_contrato,
    'writes', false
  ));
end;
$$;

revoke all on function public.sol_caixa_v3_match_token(text,text) from public, anon, authenticated;
revoke all on function public.sol_caixa_v3_classificar_evento(jsonb) from public, anon, authenticated;
grant execute on function public.sol_caixa_v3_classificar_evento(jsonb) to sol_acesso_restrito;
