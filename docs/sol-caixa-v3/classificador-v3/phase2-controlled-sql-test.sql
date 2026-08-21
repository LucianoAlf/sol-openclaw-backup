\set ON_ERROR_STOP on

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'sol_acesso_restrito') then create role sol_acesso_restrito; end if;
end;
$$;

-- Stubs isolados: mesmos contratos dos helpers do Caixa. Em ambiente controlado
-- real, estes stubs nao existem; entram os helpers oficiais ja aplicados.
create function public.sol_caixa_grupo_operacao_ok(uuid, text, text)
returns boolean language sql immutable as $$ select $2 <> 'grupo-bloqueado@g.us' $$;
create function public.sol_caixa_ator_operacao_ok(uuid, text, text)
returns boolean language sql immutable as $$ select $2 <> 'ator-bloqueado' $$;

\ir 001_sol_classificacao_regras_draft.sql
\ir 002_sol_caixa_v3_classificar_evento_draft.sql
\ir 003_sol_caixa_v3_classificador_controlled_draft.sql

insert into public.sol_classificacao_regras
  (chave_regra, versao, status, escopo, prioridade, confianca, matcher, intencao, campos_obrigatorios, criado_por)
values
  ('correcao_forma_pix', 1, 'ativa', 'geral', 100, 1,
   '{"all_terms":["pix"],"any_terms":["foi pix","nao foi cartao"]}',
   '{"operacao":"correcao_forma","forma":"pix"}', array['movimentacao_id'], 'phase2-test'),
  ('saida_seguranca', 1, 'ativa', 'geral', 90, 1,
   '{"all_terms":["seguranca"],"any_terms":["saida"]}',
   '{"operacao":"lancar_saida","categoria":"seguranca","forma":"dinheiro"}', array[]::text[], 'phase2-test');

create temporary table phase2_results (caso text primary key, retorno jsonb not null);

insert into phase2_results
select 'classified_canonical', public.sol_caixa_v3_classificar_evento(
  '{"texto_normalizado":"sol foi pix nao foi cartao","grupo_jid":"grupo-ok@g.us","unidade_id":"00000000-0000-0000-0000-000000000001","actor_phone":"5521999999999","actor_status":"resolved","valor_centavos":"10000"}'::jsonb);
insert into phase2_results
select 'substring_blocked', public.sol_caixa_v3_classificar_evento(
  '{"texto_normalizado":"sol saida inseguranca 100","grupo_jid":"grupo-ok@g.us","unidade_id":"00000000-0000-0000-0000-000000000001","actor_phone":"5521999999999","actor_status":"resolved","valor_centavos":"10000"}'::jsonb);
insert into phase2_results
select 'group_rejected', public.sol_caixa_v3_classificar_evento(
  '{"texto_normalizado":"sol foi pix nao foi cartao","grupo_jid":"grupo-bloqueado@g.us","unidade_id":"00000000-0000-0000-0000-000000000001","actor_phone":"5521999999999","actor_status":"resolved"}'::jsonb);
insert into phase2_results
select 'actor_rejected', public.sol_caixa_v3_classificar_evento(
  '{"texto_normalizado":"sol foi pix nao foi cartao","grupo_jid":"grupo-ok@g.us","unidade_id":"00000000-0000-0000-0000-000000000001","actor_phone":"ator-bloqueado","actor_status":"resolved"}'::jsonb);

insert into public.sol_classificacao_regras
  (chave_regra, versao, status, escopo, prioridade, confianca, matcher, intencao, campos_obrigatorios, criado_por)
values
  ('correcao_forma_pix_empate', 1, 'ativa', 'geral', 100, 1,
   '{"all_terms":["pix"],"any_terms":["foi pix"]}',
   '{"operacao":"correcao_forma","forma":"pix"}', array['movimentacao_id'], 'phase2-test');
insert into phase2_results
select 'tie_ambiguous', public.sol_caixa_v3_classificar_evento(
  '{"texto_normalizado":"sol foi pix nao foi cartao","grupo_jid":"grupo-ok@g.us","unidade_id":"00000000-0000-0000-0000-000000000001","actor_phone":"5521999999999","actor_status":"resolved"}'::jsonb);

do $$
declare v jsonb;
begin
  select retorno into v from phase2_results where caso = 'classified_canonical';
  if v->>'status' <> 'classified' or v->>'operacao' <> 'correcao_forma' then
    raise exception 'phase2 classified_canonical failed: %', v;
  end if;
  select retorno into v from phase2_results where caso = 'substring_blocked';
  if v->>'status' <> 'no_match' then
    raise exception 'phase2 substring_blocked failed: %', v;
  end if;
  select retorno into v from phase2_results where caso = 'group_rejected';
  if v->>'reason' <> 'canonical_context_rejected' then
    raise exception 'phase2 group_rejected failed: %', v;
  end if;
  select retorno into v from phase2_results where caso = 'actor_rejected';
  if v->>'reason' <> 'canonical_context_rejected' then
    raise exception 'phase2 actor_rejected failed: %', v;
  end if;
  select retorno into v from phase2_results where caso = 'tie_ambiguous';
  if v->>'status' <> 'ambiguous' then
    raise exception 'phase2 tie_ambiguous failed: %', v;
  end if;
end;
$$;

select caso, retorno from phase2_results order by caso;
