-- Draft local. Facade intent-only: nao escreve preview, approval ou caixa.

create or replace function public.sol_caixa_v3_classificar_evento(p_evento jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_texto text;
  v_media_status text;
  v_grupo_jid text;
  v_unidade_id uuid;
  v_actor_status text;
  v_top record;
  v_tie_count integer;
begin
  v_texto := lower(trim(coalesce(p_evento->>'texto_normalizado', '')));
  v_media_status := coalesce(p_evento->>'media_status', 'ready');
  v_grupo_jid := nullif(p_evento->>'grupo_jid', '');
  v_unidade_id := nullif(p_evento->>'unidade_id', '')::uuid;
  v_actor_status := coalesce(p_evento->>'actor_status', 'resolved');

  if v_media_status = 'pending' then
    return jsonb_build_object(
      'ok', true,
      'stage', 'deterministic',
      'status', 'media_pending',
      'contract_version', 1,
      'writes', false
    );
  end if;

  if v_actor_status <> 'resolved' then
    return jsonb_build_object(
      'ok', true,
      'stage', 'deterministic',
      'status', 'manual_review',
      'reason', 'identity_unknown',
      'contract_version', 1,
      'writes', false
    );
  end if;

  with regras as (
    select r.*
    from public.sol_classificacao_regras r
    where r.status = 'ativa'
      and r.escopo in ('fluxo', 'geral')
      and (r.escopo_grupo_jid is null or r.escopo_grupo_jid = v_grupo_jid)
      and (r.escopo_unidade_id is null or r.escopo_unidade_id = v_unidade_id)
      and (
        not (r.matcher ? 'all_terms')
        or (
          select bool_and(v_texto like '%' || lower(value) || '%')
          from jsonb_array_elements_text(r.matcher->'all_terms') as terms(value)
        )
      )
      and (
        not (r.matcher ? 'any_terms')
        or exists (
          select 1
          from jsonb_array_elements_text(r.matcher->'any_terms') as terms(value)
          where v_texto like '%' || lower(value) || '%'
        )
      )
      and (
        not (r.matcher ? 'none_terms')
        or not exists (
          select 1
          from jsonb_array_elements_text(r.matcher->'none_terms') as terms(value)
          where v_texto like '%' || lower(value) || '%'
        )
      )
  ),
  ordenadas as (
    select *
    from regras
    order by prioridade desc, confianca desc, chave_regra asc, versao desc
  )
  select * into v_top from ordenadas limit 1;

  if v_top.id is null then
    return jsonb_build_object(
      'ok', true,
      'stage', 'deterministic',
      'status', 'no_match',
      'contract_version', 1,
      'writes', false
    );
  end if;

  select count(*) into v_tie_count
  from public.sol_classificacao_regras r
  where r.status = 'ativa'
    and r.prioridade = v_top.prioridade
    and r.confianca = v_top.confianca
    and r.id <> v_top.id
    and r.escopo in ('fluxo', 'geral')
    and (r.escopo_grupo_jid is null or r.escopo_grupo_jid = v_grupo_jid)
    and (r.escopo_unidade_id is null or r.escopo_unidade_id = v_unidade_id);

  if v_tie_count > 0 then
    return jsonb_build_object(
      'ok', true,
      'stage', 'deterministic',
      'status', 'ambiguous',
      'reason', 'rule_tie',
      'rule_id', v_top.chave_regra || ':v' || v_top.versao,
      'contract_version', 1,
      'writes', false
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'stage', 'deterministic',
    'status', 'classified',
    'rule_id', v_top.chave_regra || ':v' || v_top.versao,
    'operacao', v_top.intencao->>'operacao',
    'categoria', v_top.intencao->>'categoria',
    'forma', v_top.intencao->>'forma',
    'confidence', v_top.confianca,
    'evidence', coalesce(v_top.matcher->'evidence', '[]'::jsonb),
    'requires', to_jsonb(v_top.campos_obrigatorios),
    'contract_version', v_top.versao_contrato,
    'writes', false
  );
end;
$$;

revoke all on function public.sol_caixa_v3_classificar_evento(jsonb) from public, anon, authenticated;
grant execute on function public.sol_caixa_v3_classificar_evento(jsonb) to sol_acesso_restrito;
