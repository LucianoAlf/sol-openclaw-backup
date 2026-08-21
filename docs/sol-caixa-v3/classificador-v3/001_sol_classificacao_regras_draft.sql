-- Draft local. Nao aplicar em producao sem revisao.
-- Objetivo: contrato versionado de regras deterministicas intent-only.

begin;

create table if not exists public.sol_classificacao_regras (
  id uuid primary key default gen_random_uuid(),
  chave_regra text not null,
  versao integer not null,
  status text not null default 'rascunho',
  escopo text not null,
  escopo_unidade_id uuid null,
  escopo_grupo_jid text null,
  prioridade integer not null default 0,
  confianca numeric(4,3) not null default 1,
  matcher jsonb not null,
  intencao jsonb not null,
  campos_obrigatorios text[] not null default array[]::text[],
  versao_contrato integer not null default 1,
  criado_por text not null,
  criado_em timestamptz not null default now(),
  ativado_em timestamptz null,
  encerrado_em timestamptz null,
  revogado_em timestamptz null,
  constraint sol_classificacao_regras_status_chk
    check (status in ('rascunho', 'ativa', 'encerrada', 'revogada')),
  constraint sol_classificacao_regras_escopo_chk
    check (escopo in ('fluxo', 'geral')),
  constraint sol_classificacao_regras_confianca_chk
    check (confianca >= 0 and confianca <= 1),
  constraint sol_classificacao_regras_versao_chk
    check (versao > 0),
  constraint sol_classificacao_regras_matcher_obj_chk
    check (jsonb_typeof(matcher) = 'object'),
  constraint sol_classificacao_regras_intencao_obj_chk
    check (jsonb_typeof(intencao) = 'object'),
  constraint sol_classificacao_regras_chave_versao_uk
    unique (chave_regra, versao)
);

create index if not exists sol_classificacao_regras_ativas_idx
  on public.sol_classificacao_regras (escopo, status, prioridade desc, confianca desc, chave_regra, versao desc)
  where status = 'ativa';

create or replace function public.sol_classificacao_regras_bloquear_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'sol_classificacao_regras_sem_delete_fisico'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_sol_classificacao_regras_sem_delete on public.sol_classificacao_regras;
create trigger trg_sol_classificacao_regras_sem_delete
before delete on public.sol_classificacao_regras
for each row execute function public.sol_classificacao_regras_bloquear_delete();

alter table public.sol_classificacao_regras enable row level security;

revoke all on public.sol_classificacao_regras from public, anon, authenticated;
-- Runtime nao le a tabela diretamente. A unica superficie de leitura e a
-- facade SECURITY DEFINER, depois de validar o contexto canonico do evento.
revoke all on public.sol_classificacao_regras from sol_acesso_restrito;

commit;
