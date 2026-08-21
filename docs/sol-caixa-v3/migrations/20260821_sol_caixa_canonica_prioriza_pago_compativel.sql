-- Um comprovante que já baixou no Emusys deve casar com a fatura paga de mesmo
-- valor antes de uma fatura aberta, porém de outro valor. Sem isso, um Pix de
-- R$360 poderia ser associado a uma taxa futura de R$20.
create or replace function public.sol_caixa_parcela_canonica(
  p_unidade_id uuid,
  p_aluno text,
  p_valor numeric default null,
  p_as_of date default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_as_of date := coalesce(p_as_of, (now() at time zone 'America/Sao_Paulo')::date);
  v_in text := unaccent(lower(coalesce(p_aluno,'')));
  v_alu record; v_sim numeric;
  v_env jsonb; v_itens jsonb; v_esc jsonb; v_motivo text;
  v_status_env text;
begin
  if length(btrim(v_in)) < 2 then return jsonb_build_object('ok', false, 'motivo','sem_nome'); end if;
  select a.id, a.nome, a.emusys_student_id, a.responsavel_nome,
         word_similarity(v_in, unaccent(lower(a.nome_normalizado)))::numeric sim
    into v_alu
  from alunos a
  where a.unidade_id = p_unidade_id and a.nome_normalizado is not null
    and (a.status ilike 'ativo%' or a.status is null)
  order by word_similarity(v_in, unaccent(lower(a.nome_normalizado))) desc limit 1;
  if v_alu.id is null or coalesce(v_alu.sim,0) < 0.45 then
    return jsonb_build_object('ok', false, 'motivo','aluno_nao_encontrado');
  end if;
  v_env := public.get_faturas_alunos_financeiro_v1(
    p_unidade_id, extract(year from v_as_of)::int, extract(month from v_as_of)::int,
    'janela_3', 'todas', v_as_of);
  v_status_env := v_env->>'status';
  if v_status_env is null or v_status_env not in ('ok','partial') then
    return jsonb_build_object('ok', false, 'motivo','fonte_indisponivel',
      'aluno_nome', v_alu.nome, 'status_fonte', v_status_env);
  end if;
  select coalesce(jsonb_agg(x order by (x->>'data_vencimento')::date), '[]'::jsonb) into v_itens
  from jsonb_array_elements(coalesce(v_env->'items','[]'::jsonb)) x
  where x->>'emusys_student_id' = v_alu.emusys_student_id
    and coalesce(x->>'status','') <> 'cancelada';
  if jsonb_array_length(v_itens) = 0 then
    return jsonb_build_object('ok', false, 'motivo','sem_fatura_na_janela',
      'aluno_nome', v_alu.nome, 'responsavel_nome', v_alu.responsavel_nome);
  end if;
  -- 1) aberta vencida: mantém prioridade para cobrança atrasada.
  select x into v_esc from jsonb_array_elements(v_itens) x
   where x->>'status' = 'aberta' and coalesce((x->'cobranca'->>'d0')::boolean,false)
   order by (x->>'data_vencimento')::date limit 1;
  if v_esc is not null then v_motivo := 'atrasada'; end if;
  -- 2) paga exatamente no valor do comprovante: antes de aberta incompatível.
  if v_esc is null and p_valor is not null then
    select x into v_esc from jsonb_array_elements(v_itens) x
     where x->>'status' = 'paga'
       and abs(coalesce((x->'valores'->>'valor_pago')::numeric, -1) - p_valor) < 0.01
       and coalesce((x->>'data_pagamento')::date, v_as_of) >= v_as_of - 7
     order by (x->>'data_vencimento')::date desc limit 1;
    if v_esc is not null then v_motivo := 'ja_consta_paga'; end if;
  end if;
  -- 3) aberta do mês vigente.
  if v_esc is null then
    select x into v_esc from jsonb_array_elements(v_itens) x
     where x->>'status' = 'aberta'
       and date_trunc('month', (x->>'data_vencimento')::date) = date_trunc('month', v_as_of)
     order by (x->>'data_vencimento')::date limit 1;
    if v_esc is not null then v_motivo := 'do_mes_a_vencer'; end if;
  end if;
  if v_esc is null then
    select x into v_esc from jsonb_array_elements(v_itens) x
     where x->>'status' = 'aberta' order by (x->>'data_vencimento')::date limit 1;
    if v_esc is not null then v_motivo := 'aberta_mais_antiga'; end if;
  end if;
  if v_esc is null then
    select x into v_esc from jsonb_array_elements(v_itens) x order by (x->>'data_vencimento')::date desc limit 1;
    v_motivo := 'ultima_da_janela';
  end if;
  return jsonb_build_object(
    'ok', true, 'aluno_nome', v_alu.nome, 'confianca_nome', round(v_alu.sim,2),
    'responsavel_nome', v_alu.responsavel_nome, 'motivo_escolha', v_motivo,
    'fonte_status', v_status_env, 'total_faturas_janela', jsonb_array_length(v_itens),
    'fatura', jsonb_build_object(
      'canonical_fatura_id', v_esc->>'canonical_fatura_id', 'emusys_fatura_id', v_esc->>'emusys_fatura_id',
      'tipo_fatura', v_esc->>'tipo_fatura', 'descricao', v_esc->>'descricao',
      'numero_parcela', v_esc->'numero_parcela', 'total_parcelas_contrato', v_esc->'total_parcelas_contrato',
      'competencia', v_esc->>'competencia', 'data_vencimento', v_esc->>'data_vencimento',
      'status', v_esc->>'status', 'data_pagamento', v_esc->>'data_pagamento',
      'vencida', coalesce((v_esc->'cobranca'->>'d0')::boolean,false),
      'dias_atraso', case when coalesce((v_esc->'cobranca'->>'d0')::boolean,false) then greatest(0, v_as_of - (v_esc->>'data_vencimento')::date) else 0 end,
      'forma_pagamento', v_esc->'forma_pagamento',
      'valor_da_parcela', (v_esc->'valores'->>'valor_com_desconto')::numeric,
      'valor_sem_desconto_condicional', (v_esc->'valores'->>'valor_sem_desconto_condicional')::numeric,
      'valor_hoje', (v_esc->'valores'->>'valor_hoje')::numeric,
      'valor_pago', (v_esc->'valores'->>'valor_pago')::numeric
    ));
end;
$$;
