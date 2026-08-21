\set ON_ERROR_STOP on

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'sol_acesso_restrito') then create role sol_acesso_restrito; end if;
end;
$$;

-- Stubs com a assinatura e o retorno JSONB confirmados nos helpers oficiais.
-- Eles reproduzem o contrato, não alegam executar os helpers do LA Report.
create function public.sol_caixa_grupo_operacao_ok(uuid, text, text)
returns jsonb language sql immutable as $$
  select case
    when $2 = 'grupo-malformado@g.us' then '{"ok":true}'::jsonb
    when $1 = '00000000-0000-0000-0000-000000000001' and $2 = 'grupo-ok@g.us'
      then '{"ok":true,"autorizado":true,"motivo":"grupo_financeiro_oficial_autoriza_membros"}'::jsonb
    else '{"ok":true,"autorizado":false,"motivo":"grupo_financeiro_nao_mapeado_ou_inativo"}'::jsonb
  end
$$;

create function public.sol_caixa_ator_operacao_ok(uuid, text, text)
returns jsonb language sql immutable as $$
  select case
    when $2 = 'ator-malformado' then '{"ok":true}'::jsonb
    when $2 = 'ator-negado' then '{"ok":true,"autorizado":false,"motivo":"nao_autorizado_na_matriz"}'::jsonb
    else '{"ok":true,"autorizado":true,"motivo":"grupo_financeiro_autorizado_por_politica_unidade"}'::jsonb
  end
$$;

\ir 001_sol_classificacao_regras_draft.sql
\ir 002_sol_caixa_v3_classificar_evento_draft.sql
\ir 004_sol_caixa_v3_classificador_helper_contract_draft.sql

insert into public.sol_classificacao_regras
  (chave_regra, versao, status, escopo, prioridade, confianca, matcher, intencao, campos_obrigatorios, criado_por)
values
  ('correcao_forma_pix', 1, 'ativa', 'geral', 100, 1,
   '{"all_terms":["pix"],"any_terms":["foi pix","nao foi cartao"]}',
   '{"operacao":"correcao_forma","forma":"pix"}', array['movimentacao_id'], 'phase3-test');

create temporary table phase3_results (caso text primary key, retorno jsonb not null);

insert into phase3_results
select 'official_contract_classified', public.sol_caixa_v3_classificar_evento(
  '{"texto_normalizado":"sol foi pix nao foi cartao","grupo_jid":"grupo-ok@g.us","unidade_id":"00000000-0000-0000-0000-000000000001","actor_phone":"5521999999999","actor_status":"resolved","valor_centavos":"10000"}'::jsonb);
insert into phase3_results
select 'official_contract_group_rejected', public.sol_caixa_v3_classificar_evento(
  '{"texto_normalizado":"sol foi pix nao foi cartao","grupo_jid":"grupo-nao-oficial@g.us","unidade_id":"00000000-0000-0000-0000-000000000001","actor_phone":"5521999999999","actor_status":"resolved"}'::jsonb);
insert into phase3_results
select 'official_contract_actor_rejected', public.sol_caixa_v3_classificar_evento(
  '{"texto_normalizado":"sol foi pix nao foi cartao","grupo_jid":"grupo-ok@g.us","unidade_id":"00000000-0000-0000-0000-000000000001","actor_phone":"ator-negado","actor_status":"resolved"}'::jsonb);
insert into phase3_results
select 'official_contract_malformed_group_fails_closed', public.sol_caixa_v3_classificar_evento(
  '{"texto_normalizado":"sol foi pix nao foi cartao","grupo_jid":"grupo-malformado@g.us","unidade_id":"00000000-0000-0000-0000-000000000001","actor_phone":"5521999999999","actor_status":"resolved"}'::jsonb);

do $$
declare v jsonb;
begin
  select retorno into v from phase3_results where caso = 'official_contract_classified';
  if v->>'status' <> 'classified' then raise exception 'classified failed: %', v; end if;
  select retorno into v from phase3_results where caso = 'official_contract_group_rejected';
  if v->>'reason' <> 'canonical_group_rejected' then raise exception 'group failed: %', v; end if;
  select retorno into v from phase3_results where caso = 'official_contract_actor_rejected';
  if v->>'reason' <> 'canonical_actor_rejected' then raise exception 'actor failed: %', v; end if;
  select retorno into v from phase3_results where caso = 'official_contract_malformed_group_fails_closed';
  if v->>'reason' <> 'canonical_group_rejected' then raise exception 'malformed group failed: %', v; end if;
end;
$$;

select caso, retorno from phase3_results order by caso;
