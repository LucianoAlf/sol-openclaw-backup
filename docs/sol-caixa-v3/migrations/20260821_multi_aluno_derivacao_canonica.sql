-- Multi-aluno sem alocação explícita só é elegível quando cada aluno tem
-- exatamente uma fatura canônica paga na data do comprovante e a soma fecha.
-- A função não divide valores; ela apenas recupera o que já está no Emusys.
create or replace function public.sol_caixa_resolver_multi_aluno_v1(
  p_unidade_id uuid,
  p_itens jsonb,
  p_valor_total numeric,
  p_as_of date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_as_of date := coalesce(p_as_of, (now() at time zone 'America/Sao_Paulo')::date);
  v_item jsonb;
  v_env jsonb;
  v_itens jsonb;
  v_candidatos jsonb;
  v_esc jsonb;
  v_resultados jsonb := '[]'::jsonb;
  v_ordem integer := 0;
  v_nome text;
  v_categoria text;
  v_competencia text;
  v_valor numeric;
  v_valor_hoje numeric;
  v_competencia_fatura text;
  v_soma numeric := 0;
  v_status_env text;
  v_alu record;
begin
  if p_unidade_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'unidade_invalida');
  end if;
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens) < 2 then
    return jsonb_build_object('ok', false, 'motivo', 'multi_aluno_exige_dois_itens');
  end if;
  if p_valor_total is null or p_valor_total <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'valor_total_invalido');
  end if;

  for v_item in select value from jsonb_array_elements(p_itens) loop
    v_ordem := v_ordem + 1;
    v_nome := nullif(trim(coalesce(v_item->>'aluno_nome', '')), '');
    v_categoria := lower(coalesce(nullif(v_item->>'categoria', ''), 'parcela'));
    v_competencia := nullif(trim(coalesce(v_item->>'competencia', '')), '');
    v_valor := nullif(v_item->>'valor', '')::numeric;
    if v_nome is null then
      return jsonb_build_object('ok', false, 'motivo', 'item_sem_aluno', 'ordem', v_ordem);
    end if;
    if v_categoria not in ('parcela','passaporte','matricula','lojinha','venda','outro') then
      return jsonb_build_object('ok', false, 'motivo', 'categoria_item_invalida', 'ordem', v_ordem);
    end if;

    select a.id, a.nome, a.emusys_student_id, a.responsavel_nome,
           word_similarity(unaccent(lower(v_nome)), unaccent(lower(a.nome_normalizado)))::numeric as sim
      into v_alu
      from public.alunos a
     where a.unidade_id = p_unidade_id
       and a.nome_normalizado is not null
       and (a.status ilike 'ativo%' or a.status is null)
     order by word_similarity(unaccent(lower(v_nome)), unaccent(lower(a.nome_normalizado))) desc
     limit 1;
    if v_alu.id is null or coalesce(v_alu.sim, 0) < 0.45 then
      return jsonb_build_object('ok', false, 'motivo', 'aluno_nao_encontrado', 'ordem', v_ordem);
    end if;

    v_env := public.get_faturas_alunos_financeiro_v1(
      p_unidade_id, extract(year from v_as_of)::int, extract(month from v_as_of)::int,
      'janela_3', 'todas', v_as_of
    );
    v_status_env := v_env->>'status';
    if v_status_env is null or v_status_env not in ('ok','partial') then
      return jsonb_build_object('ok', false, 'motivo', 'fonte_indisponivel', 'ordem', v_ordem,
        'aluno_nome', v_alu.nome, 'status_fonte', v_status_env);
    end if;

    select coalesce(jsonb_agg(x order by (x->>'data_vencimento')::date), '[]'::jsonb)
      into v_itens
      from jsonb_array_elements(coalesce(v_env->'items','[]'::jsonb)) x
     where x->>'emusys_student_id' = v_alu.emusys_student_id
       and coalesce(x->>'status','') <> 'cancelada'
       and (
         (v_categoria in ('passaporte','matricula') and coalesce(x->>'tipo_fatura','') in ('passaporte_taxa_matricula','matricula'))
         or (v_categoria = 'parcela' and coalesce(x->>'tipo_fatura','') = 'parcela')
         or (v_categoria not in ('passaporte','matricula','parcela'))
       );
    if jsonb_array_length(v_itens) = 0 then
      return jsonb_build_object('ok', false, 'motivo', 'sem_fatura_da_categoria', 'ordem', v_ordem,
        'aluno_nome', v_alu.nome);
    end if;

    if v_valor is null then
      -- Derivação automática é deliberadamente estreita: só fatura paga no
      -- mesmo dia do comprovante, uma única candidata por aluno.
      select coalesce(jsonb_agg(x), '[]'::jsonb) into v_candidatos
        from jsonb_array_elements(v_itens) x
       where x->>'status' = 'paga'
         and nullif(x->>'data_pagamento','')::date = v_as_of;
      if jsonb_array_length(v_candidatos) <> 1 then
        return jsonb_build_object('ok', false, 'motivo', 'alocacao_nao_derivavel', 'ordem', v_ordem,
          'aluno_nome', v_alu.nome, 'candidatas', jsonb_array_length(v_candidatos));
      end if;
      select value into v_esc from jsonb_array_elements(v_candidatos) limit 1;
      v_valor := coalesce(nullif(v_esc->'valores'->>'valor_pago','')::numeric,
                           nullif(v_esc->'valores'->>'valor_hoje','')::numeric,
                           nullif(v_esc->'valores'->>'valor_com_desconto','')::numeric);
    else
      select x into v_esc
        from jsonb_array_elements(v_itens) x
       where abs(coalesce(
          case when x->>'status' = 'paga' then nullif(x->'valores'->>'valor_pago','')::numeric end,
          nullif(x->'valores'->>'valor_hoje','')::numeric,
          nullif(x->'valores'->>'valor_com_desconto','')::numeric
       ) - v_valor) < 0.01
       order by case when x->>'status' = 'paga' and nullif(x->>'data_pagamento','')::date = v_as_of then 0
                     when x->>'status' = 'paga' then 1 else 2 end,
                (x->>'data_vencimento')::date desc
       limit 1;
    end if;
    if v_esc is null or v_valor is null or v_valor <= 0 then
      return jsonb_build_object('ok', false, 'motivo', 'item_nao_validado', 'ordem', v_ordem,
        'aluno_nome', v_alu.nome);
    end if;

    v_competencia_fatura := case when nullif(v_esc->>'competencia','') is null then null
      else to_char((v_esc->>'competencia')::date, 'MM/YYYY') end;
    if v_competencia is not null and v_competencia_fatura is not null and v_competencia <> v_competencia_fatura then
      return jsonb_build_object('ok', false, 'motivo', 'competencia_item_divergente', 'ordem', v_ordem);
    end if;
    v_soma := v_soma + v_valor;
    v_resultados := v_resultados || jsonb_build_array(jsonb_build_object(
      'ordem', v_ordem,
      'aluno_nome', v_alu.nome,
      'responsavel_financeiro', v_alu.responsavel_nome,
      'valor', v_valor,
      'categoria', v_categoria,
      'competencia', coalesce(v_competencia_fatura, v_competencia),
      'canonical_fatura_id', v_esc->>'canonical_fatura_id',
      'descricao', v_esc->>'descricao',
      'fatura', jsonb_build_object(
        'canonical_fatura_id', v_esc->>'canonical_fatura_id',
        'descricao', v_esc->>'descricao',
        'tipo_fatura', v_esc->>'tipo_fatura',
        'competencia', v_esc->>'competencia',
        'status', v_esc->>'status',
        'data_pagamento', v_esc->>'data_pagamento',
        'forma_pagamento', v_esc->'forma_pagamento',
        'valor_pago', v_esc->'valores'->>'valor_pago',
        'valor_hoje', v_esc->'valores'->>'valor_hoje'
      )
    ));
  end loop;

  if abs(v_soma - p_valor_total) > 0.01 then
    return jsonb_build_object('ok', false, 'motivo', 'soma_itens_divergente',
      'soma_itens', v_soma, 'valor_total', p_valor_total);
  end if;
  return jsonb_build_object('ok', true, 'itens', v_resultados,
    'soma_itens', v_soma, 'valor_total', p_valor_total);
end;
$function$;
