-- Caixa V3 — recebimento de um único comprovante alocado a vários alunos.
-- O lote é uma unidade atômica: ou todos os itens entram, ou nenhum entra.

create table if not exists public.sol_caixa_lotes_v1 (
  id uuid primary key default gen_random_uuid(),
  unidade_id uuid not null references public.unidades(id),
  caixa_diario_id uuid not null references public.caixas_diarios(id),
  preview_id uuid not null references public.sol_caixa_shadow_previews_v1(id),
  approval_id uuid not null references public.sol_caixa_shadow_approvals_v1(id),
  idempotency_key text not null unique,
  valor_total numeric not null check (valor_total > 0),
  forma_pagamento text not null,
  categoria text not null,
  ator_numero text,
  payload jsonb not null,
  status text not null default 'lancado' check (status in ('lancado','recusado')),
  criado_em timestamptz not null default now()
);

create table if not exists public.sol_caixa_lote_itens_v1 (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references public.sol_caixa_lotes_v1(id) on delete restrict,
  ordem smallint not null check (ordem > 0),
  aluno_nome text not null,
  responsavel_financeiro text,
  competencia text,
  categoria text not null,
  valor numeric not null check (valor > 0),
  canonical_fatura_id text,
  movimentacao_id uuid not null references public.caixa_movimentacoes(id),
  item_json jsonb not null,
  criado_em timestamptz not null default now(),
  unique (lote_id, ordem),
  unique (movimentacao_id)
);

alter table public.sol_caixa_lotes_v1 enable row level security;
alter table public.sol_caixa_lote_itens_v1 enable row level security;

create or replace function public.sol_caixa_resolver_multi_aluno_v1(
  p_unidade_id uuid,
  p_itens jsonb,
  p_valor_total numeric,
  p_as_of date default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_canonica jsonb;
  v_fatura jsonb;
  v_resultados jsonb := '[]'::jsonb;
  v_ordem integer := 0;
  v_nome text;
  v_categoria text;
  v_competencia text;
  v_valor numeric;
  v_valor_hoje numeric;
  v_competencia_fatura text;
  v_soma numeric := 0;
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

  for v_item in select value from jsonb_array_elements(p_itens)
  loop
    v_ordem := v_ordem + 1;
    v_nome := nullif(trim(coalesce(v_item->>'aluno_nome', '')), '');
    v_categoria := lower(coalesce(nullif(v_item->>'categoria', ''), 'parcela'));
    v_competencia := nullif(trim(coalesce(v_item->>'competencia', '')), '');
    v_valor := nullif(v_item->>'valor', '')::numeric;
    if v_nome is null or v_valor is null or v_valor <= 0 then
      return jsonb_build_object('ok', false, 'motivo', 'item_incompleto', 'ordem', v_ordem);
    end if;
    if v_categoria not in ('parcela','passaporte','matricula','lojinha','venda','outro') then
      return jsonb_build_object('ok', false, 'motivo', 'categoria_item_invalida', 'ordem', v_ordem);
    end if;

    v_canonica := public.sol_caixa_parcela_canonica(p_unidade_id, v_nome, v_valor, p_as_of);
    if not coalesce((v_canonica->>'ok')::boolean, false) then
      return jsonb_build_object(
        'ok', false,
        'motivo', 'item_nao_validado',
        'ordem', v_ordem,
        'detalhe', coalesce(v_canonica->>'motivo', 'fatura_nao_confirmada')
      );
    end if;

    v_fatura := coalesce(v_canonica->'fatura', '{}'::jsonb);
    v_valor_hoje := coalesce(
      nullif(v_fatura->>'valor_hoje', '')::numeric,
      nullif(v_fatura->>'valor_da_parcela', '')::numeric
    );
    if v_valor_hoje is null or abs(v_valor_hoje - v_valor) > 0.01 then
      return jsonb_build_object(
        'ok', false,
        'motivo', 'valor_item_divergente',
        'ordem', v_ordem,
        'valor_informado', v_valor,
        'valor_hoje', v_valor_hoje
      );
    end if;

    if v_categoria = 'passaporte'
       and coalesce(v_fatura->>'tipo_fatura','') not in ('passaporte_taxa_matricula','matricula') then
      return jsonb_build_object('ok', false, 'motivo', 'fatura_categoria_divergente', 'ordem', v_ordem);
    end if;
    if v_categoria = 'parcela' and coalesce(v_fatura->>'tipo_fatura','') <> 'parcela' then
      return jsonb_build_object('ok', false, 'motivo', 'fatura_categoria_divergente', 'ordem', v_ordem);
    end if;

    v_competencia_fatura := case
      when nullif(v_fatura->>'competencia','') is null then null
      else to_char((v_fatura->>'competencia')::date, 'MM/YYYY')
    end;
    if v_competencia is not null and v_competencia_fatura is not null and v_competencia <> v_competencia_fatura then
      return jsonb_build_object('ok', false, 'motivo', 'competencia_item_divergente', 'ordem', v_ordem);
    end if;

    v_soma := v_soma + v_valor;
    v_resultados := v_resultados || jsonb_build_array(jsonb_build_object(
      'ordem', v_ordem,
      'aluno_nome', v_canonica->>'aluno_nome',
      'responsavel_financeiro', v_canonica->>'responsavel_nome',
      'valor', v_valor,
      'categoria', v_categoria,
      'competencia', coalesce(v_competencia_fatura, v_competencia),
      'canonical_fatura_id', v_fatura->>'canonical_fatura_id',
      'descricao', v_fatura->>'descricao',
      'fatura', v_fatura
    ));
  end loop;

  if abs(v_soma - p_valor_total) > 0.01 then
    return jsonb_build_object('ok', false, 'motivo', 'soma_itens_divergente', 'soma_itens', v_soma, 'valor_total', p_valor_total);
  end if;
  return jsonb_build_object('ok', true, 'itens', v_resultados, 'soma_itens', v_soma, 'valor_total', p_valor_total);
end;
$$;

create or replace function public.sol_caixa_lancar_recebimento_lote_v1(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_unidade uuid := nullif(p_payload->>'unidade_id','')::uuid;
  v_data date := coalesce(nullif(p_payload->>'data','')::date, (now() at time zone 'America/Sao_Paulo')::date);
  v_total numeric := nullif(p_payload->>'valor','')::numeric;
  v_forma text := lower(coalesce(p_payload->>'forma',''));
  v_categoria text := lower(coalesce(nullif(p_payload->>'categoria',''), 'parcela'));
  v_num text := regexp_replace(coalesce(p_payload->>'ator_numero',''),'\\D','','g');
  v_papel text := p_payload->>'ator_papel';
  v_key text := nullif(p_payload->>'idempotency_key','');
  v_caixa uuid;
  v_lote uuid;
  v_preview public.sol_caixa_shadow_previews_v1%rowtype;
  v_v3 jsonb;
  v_resolver jsonb;
  v_item jsonb;
  v_mov uuid;
  v_movs jsonb := '[]'::jsonb;
  v_ordem integer := 0;
  v_resp text;
  v_motivo text;
begin
  if v_key is null then
    return jsonb_build_object('ok', false, 'motivo', 'idempotency_key_obrigatoria');
  end if;
  select id into v_lote from public.sol_caixa_lotes_v1 where idempotency_key = v_key;
  if v_lote is not null then
    select coalesce(jsonb_agg(jsonb_build_object('movimentacao_id', movimentacao_id, 'aluno_nome', aluno_nome, 'valor', valor) order by ordem), '[]'::jsonb)
      into v_movs from public.sol_caixa_lote_itens_v1 where lote_id = v_lote;
    return jsonb_build_object('ok', true, 'ja_lancado', true, 'lote_id', v_lote, 'movimentacoes', v_movs);
  end if;
  if v_unidade is null then v_motivo := 'unidade_invalida';
  elsif v_total is null or v_total <= 0 then v_motivo := 'valor_invalido';
  elsif v_forma not in ('dinheiro','pix','cartao','cheque','transferencia','outro') then v_motivo := 'forma_invalida';
  elsif jsonb_typeof(p_payload->'itens') is distinct from 'array' or jsonb_array_length(p_payload->'itens') < 2 then v_motivo := 'multi_aluno_exige_dois_itens';
  end if;
  if v_motivo is null then
    select id into v_caixa from public.caixas_diarios where unidade_id = v_unidade and data_caixa = v_data and status = 'aberto' order by aberto_em desc limit 1;
    if v_caixa is null then v_motivo := 'caixa_nao_aberto'; end if;
  end if;
  if v_motivo is null then
    select * into v_preview from public.sol_caixa_shadow_previews_v1 where id = nullif(p_payload->>'v3_preview_id','')::uuid for update;
    if v_preview.id is null then v_motivo := 'preview_v3_nao_encontrado';
    elsif coalesce(v_preview.preview_json #>> '{pending,tipoOperacao}', '') <> 'lancar_recebimento_lote' then v_motivo := 'preview_nao_e_lote_multi_aluno';
    elsif coalesce(v_preview.preview_json #> '{pending,itens}', 'null'::jsonb) is distinct from coalesce(p_payload->'itens', 'null'::jsonb) then v_motivo := 'itens_divergentes_do_preview_v3';
    end if;
  end if;
  if v_motivo is null then
    v_resolver := public.sol_caixa_resolver_multi_aluno_v1(v_unidade, p_payload->'itens', v_total, v_data);
    if not coalesce((v_resolver->>'ok')::boolean, false) then v_motivo := coalesce(v_resolver->>'motivo', 'itens_nao_validados'); end if;
  end if;
  if v_motivo is null then
    v_v3 := public.sol_caixa_v3_validar_approval_v1(p_payload, 'lancar_recebimento');
    if not coalesce((v_v3->>'ok')::boolean, false) then v_motivo := coalesce(v_v3->>'motivo', 'approval_v3_invalido'); end if;
  end if;
  if v_motivo is not null then
    insert into public.sol_caixa_lancamento_auditoria (ator_numero, ator_papel, chat_id, origem_message_id, preview_message_id, idempotency_key, unidade_id, data_caixa, payload, resultado, motivo)
    values (v_num, v_papel, p_payload->>'chat_id', p_payload->>'origem_message_id', p_payload->>'preview_message_id', v_key, v_unidade, v_data, p_payload, 'recusado', v_motivo);
    return jsonb_build_object('ok', false, 'motivo', v_motivo);
  end if;

  insert into public.sol_caixa_lotes_v1 (unidade_id, caixa_diario_id, preview_id, approval_id, idempotency_key, valor_total, forma_pagamento, categoria, ator_numero, payload)
  values (v_unidade, v_caixa, nullif(p_payload->>'v3_preview_id','')::uuid, nullif(p_payload->>'v3_approval_id','')::uuid, v_key, v_total, v_forma, v_categoria, v_num, p_payload)
  returning id into v_lote;
  v_resp := coalesce(nullif(p_payload->>'autorizado_por',''), 'Sol (agente)') || ' · via Sol';
  for v_item in select value from jsonb_array_elements(v_resolver->'itens')
  loop
    v_ordem := v_ordem + 1;
    insert into public.caixa_movimentacoes (caixa_diario_id, unidade_id, data_movimento, ambiente, tipo, forma_pagamento, categoria, descricao, valor, criado_por, responsavel, cartao_modalidade, cartao_parcelas)
    values (
      v_caixa, v_unidade, v_data, 'venda', 'entrada', v_forma,
      coalesce(v_item->>'categoria', v_categoria),
      coalesce(nullif(v_item->>'descricao',''), initcap(coalesce(v_item->>'categoria', v_categoria)) || ' - ' || (v_item->>'aluno_nome')),
      (v_item->>'valor')::numeric, concat_ws(':', 'sol-agente', v_papel, v_num), v_resp,
      nullif(p_payload->>'cartao_modalidade',''), nullif(p_payload->>'cartao_parcelas','')::int
    ) returning id into v_mov;
    insert into public.sol_caixa_lote_itens_v1 (lote_id, ordem, aluno_nome, responsavel_financeiro, competencia, categoria, valor, canonical_fatura_id, movimentacao_id, item_json)
    values (v_lote, v_ordem, v_item->>'aluno_nome', nullif(v_item->>'responsavel_financeiro',''), nullif(v_item->>'competencia',''), v_item->>'categoria', (v_item->>'valor')::numeric, nullif(v_item->>'canonical_fatura_id',''), v_mov, v_item);
    insert into public.sol_caixa_lancamento_auditoria (ator_numero, ator_papel, chat_id, origem_message_id, preview_message_id, idempotency_key, unidade_id, data_caixa, payload, resultado, motivo, movimentacao_id, caixa_diario_id)
    values (v_num, v_papel, p_payload->>'chat_id', p_payload->>'origem_message_id', p_payload->>'preview_message_id', v_key || ':' || v_ordem, v_unidade, v_data, p_payload || jsonb_build_object('item_lote', v_item), 'lancado_lote', null, v_mov, v_caixa);
    v_movs := v_movs || jsonb_build_array(jsonb_build_object('movimentacao_id', v_mov, 'aluno_nome', v_item->>'aluno_nome', 'valor', (v_item->>'valor')::numeric));
  end loop;
  update public.sol_caixa_ingestao_recebimentos set status = 'lancado', movimentacao_id = (v_movs->0->>'movimentacao_id')::uuid, lancado_em = now(), lancado_por = v_num, valor_extraido = v_total, forma_extraida = v_forma, categoria_extraida = v_categoria, preview_message_id = coalesce(preview_message_id, p_payload->>'preview_message_id'), atualizado_em = now() where idempotency_key = v_key;
  return jsonb_build_object('ok', true, 'lote_id', v_lote, 'valor', v_total, 'forma', v_forma, 'movimentacoes', v_movs);
end;
$$;

revoke all on function public.sol_caixa_resolver_multi_aluno_v1(uuid, jsonb, numeric, date) from public, anon, authenticated;
revoke all on function public.sol_caixa_lancar_recebimento_lote_v1(jsonb) from public, anon, authenticated;
grant execute on function public.sol_caixa_resolver_multi_aluno_v1(uuid, jsonb, numeric, date) to service_role, sol_acesso_restrito;
grant execute on function public.sol_caixa_lancar_recebimento_lote_v1(jsonb) to service_role, sol_acesso_restrito;
