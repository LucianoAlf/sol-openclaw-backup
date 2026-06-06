# Checklist SQL Seguro — LA Report / Sol

Antes de qualquer SQL:

## 1. Classificar a ação

- SELECT-only?
- Documental?
- Frontend fallback?
- View/RPC/function?
- Migration?
- Backfill?
- Produção?

Se não for SELECT-only/documental, precisa aprovação explícita.

---

## 2. Verificar fonte da regra

- A regra foi validada pelo Alf?
- Está em `regras-canonicas.md`?
- É inferência do código?
- É documento antigo?
- É comportamento legado?

Documento antigo divergente = legado.  
Código divergente = possível bug.

---

## 3. Para métricas de alunos

Checar:

- pessoa vs matrícula;
- `COUNT(DISTINCT nome)` vs `COUNT(*)`;
- segundo curso;
- banda/projeto;
- coral;
- bolsistas;
- valor zero;
- passaporte;
- unidade.

---

## 4. Para evasões/churn

Checar:

- usar `movimentacoes_admin`;
- incluir `evasao` + `nao_renovacao`;
- excluir aviso prévio;
- excluir trancamento;
- deduplicar por pessoa/unidade/mês;
- não usar `evasoes_v2` como fonte viva.

---

## 5. Para financeiro

Checar:

- MRR não inclui passaporte;
- ticket médio é por pessoa;
- inadimplência é percentual de pessoas/cabeças;
- bolsista parcial não entra em pagantes/ticket;
- `sem_parcela` tratado corretamente.

---

## 6. Para produção

Antes de qualquer execução real:

- SELECT-only rodado;
- resultados revisados;
- diff gerado;
- staging testado;
- rollback planejado;
- aprovação explícita do Alf.

Sem isso, não executar.
