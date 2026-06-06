# Regras Canônicas — LA Music Performance Report

## Status

Este arquivo resume as regras validadas para Sol e outros agentes.

Classificação:

- ✅ Validada pelo Alf
- 📋 Inferida do código atual
- ❓ Pendente de validação
- 🚫 Legado / não usar / possível bug

---

## Pessoa, matrícula e alunos

- 📋 `alunos` armazena matrículas, não pessoas.
- 📋 Identidade operacional: `LOWER(TRIM(nome)) + unidade_id`.
- 📋 Nome sozinho pode colidir; dois nomes iguais na mesma unidade exigem checagem humana.
- 📋 Segundo curso = matrícula adicional de outro curso.
- 📋 Mesmo `curso_id` duplicado para a mesma pessoa = duplicata, não segundo curso.

### Total alunos ativos

- 📋 Base = pessoas, não matrículas.
- 📋 Inclui `ativo` + `trancado`.
- 📋 Exclui `is_segundo_curso = true`.
- 🚫 `COUNT(*)` para ativos/pagantes é possível bug.

### Matrículas ativas

- 📋 Base = registros.
- 📋 Inclui primeiro curso, segundo curso, banda e coral.

---

## Pagantes, MRR e ticket

### Pagantes

✅ Regra validada pelo Alf em 2026-06-06:

- `alunos_pagantes` é por pessoa/aluno, não por matrícula/curso;
- bolsista integral não conta como pagante;
- bolsista parcial não conta como pagante;
- segundo curso não duplica a pessoa no denominador;
- aluno com múltiplos cursos continua contando como **1 aluno pagante**, se for pagante.

### Ticket médio

✅ Regra canônica validada pelo Alf em 2026-06-06:

```text
Ticket médio = faturamento total dos cursos dos alunos pagantes / alunos pagantes
```

Interpretação operacional:

- Numerador: somar o valor/faturamento de **todos os cursos** do aluno pagante, incluindo segundo curso.
- Denominador: contar cada aluno/pessoa pagante **uma única vez**.
- Excluir bolsistas integrais e bolsistas parciais do numerador e do denominador.
- Não calcular ticket médio como `AVG(valor_parcela)` por matrícula/linha, porque isso duplica aluno com múltiplos cursos e distorce o KPI.

Exemplo: se um aluno pagante tem 4 cursos de R$380 + R$355 + R$367 + R$127, o numerador recebe R$1.229 e o denominador recebe 1 pessoa.

### MRR

✅ Passaporte não entra no MRR.  
MRR = recorrência de parcelas/mensalidades.  
Passaporte = receita à parte.

---

## Evasão, churn e renovação

### Evasão

- 📋 Evasão = `evasao` + `nao_renovacao` em `movimentacoes_admin`.
- 📋 Aviso prévio não é evasão.
- 📋 Trancamento não é evasão.
- 🚫 Não usar `evasoes_v2` como fonte viva.

### Churn

✅ Fórmula canônica:

```sql
evasoes / alunos_pagantes * 100
```

### Taxa de renovação

❓ Ainda pendente:

- código atual: `renovacoes / (renovacoes + nao_renovacoes)`;
- possível canônico: `renovacoes / (renovacoes + nao_renovacoes + aviso_previo)`.

Não alterar sem validação do Alf.

---

## Kids / School

✅ Fonte canônica: `idade_atual`.

- LAMK/Kids: `idade_atual <= 11`.
- EMLA/School: `idade_atual >= 12`.

❓ Qualquer uso de `classificacao` textual deve ser tratado como possível fonte desatualizada até alinhamento.

---

## Canto coral e banda

### Banda

- 📋 Canônico operacional: `cursos.is_projeto_banda = true`.
- 🚫 Filtros por nome como `ILIKE '%banda%'` ou `ILIKE '%power kids%'` são legado temporário.

### Canto Coral

✅ Regra validada: criar/usar `cursos.is_coral`.

🚫 Filtro por nome (`ILIKE '%canto coral%'`) é legado frágil e deve ser substituído.

---

## Aulas experimentais e funil

- 📋 A experimental conta quando é realizada, não quando é agendada.
- 📋 `experimentais_realizadas`: status `experimental_realizada` ou `matriculado`.
- 📋 `experimentais_agendadas`: inclui `experimental_agendada`, `experimental_realizada`, `matriculado`.
- ❓ Banco usando `data_contato` em vez de `data_experimental_realizada` é pendência/possível bug.

### Conversão geral do funil

❓ Pendente:

- `novas / total_leads`; ou
- `novas / leads_com_exp`.

Não fechar sem validação.

---

## Professores

### Carteira professor

- 📋 Conta alunos com `professor_atual_id` e `status = 'ativo'`.
- 📋 Inclui segundo curso como matrícula.
- 📋 Não inclui banda.
- 📋 Não inclui `trancado`.

### Conversão professor

✅ Fórmula canônica:

```sql
matriculas_pos_experimental / experimentais_realizadas * 100
```

✅ Apenas matrículas originadas de experimental realizada por aquele professor entram no numerador.

🚫 Cálculo que permite taxa >100% por matrícula sem experimental é bug/legado.

---

## LTV / permanência

✅ Fórmula LTV:

```sql
ticket_medio * tempo_permanencia_meses
```

📋 Regra “saiu de tudo”: só conta quando aluno encerra todas as matrículas.

📋 Excluir passagens menores que 4 meses.

---

## Arquivamento

📋 Arquivamento técnico: mover para `alunos_arquivados` e remover de `alunos`.

🚫 Ação destrutiva. Nunca executar sem autorização explícita do Alf.
