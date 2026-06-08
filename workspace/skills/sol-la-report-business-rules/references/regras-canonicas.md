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
- 📋 Mesmo `curso_id` duplicado para a mesma pessoa geralmente é duplicata, não segundo curso.
- ✅ Exceção validada pelo Alf em 2026-06-07: quando o aluno faz dois horários/tempos reais do mesmo curso, especialmente aula individual seguida, e paga separadamente por cada tempo, os dois vínculos são legítimos. Ex.: Vitória da Silva Nobre faz dois tempos individuais seguidos e paga R$650 por cada; não arquivar como duplicata automática.

### Total alunos ativos

✅ Regra validada pelo Alf em 2026-06-08:

- Base = **pessoas/alunos únicos**, não matrículas/vínculos.
- Inclui alunos com `status IN ('ativo', 'trancado')`.
- Inclui pagantes, bolsistas integrais, bolsistas parciais e alunos que estão só em banda/projeto.
- Segundo curso e múltiplas matrículas do mesmo aluno **não duplicam** aluno ativo.
- Kids/School deve usar a mesma base de alunos ativos; `Kids + School + Sem classificação` deve fechar com `alunos_ativos`.
- 🚫 `COUNT(*)` sobre linhas de `alunos` para ativos/pagantes é bug quando duplica pessoa por matrícula, segundo curso ou vínculo adicional.

### Matrículas ativas

✅ Regra validada pelo Alf em 2026-06-08:

- Base = **registros/vínculos/matrículas**, não pessoas únicas.
- Inclui curso regular, segundo curso, banda/projeto, coral, bolsistas integrais/parciais e pagantes.
- Pode ser maior que `alunos_ativos`, porque um aluno pode ter mais de uma matrícula/vínculo.

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

- 📋 Evasão = `evasao` + `nao_renovacao` em `movimentacoes_admin`, desde que represente perda real do aluno.
- ✅ Transferência interna entre unidades **não é evasão/churn global da LA Music**.
- ✅ Quando o aluno sai de uma unidade e continua ativo em outra unidade, classificar como transferência interna, não como perda de aluno.
- 📋 Para análise por unidade, transferência pode aparecer como saída operacional da unidade origem e entrada na unidade destino, mas deve ficar separada de evasão/não renovação.
- 📋 Para análise global LA Music, transferência interna não entra no numerador de churn.
- ✅ Aviso prévio não é evasão na competência em que foi avisado.
- ✅ Regra operacional validada pelo Alf em 2026-06-07: quando o aviso prévio é dado em maio, o aluno ainda cumpre/assiste maio, junho e julho; se não houver reversão, a saída real é julho. Portanto, aviso prévio de maio não entra como evasão/churn de maio. Para KPI, usar a competência da saída real/encerramento, não a competência do aviso.
- 📋 Trancamento não é evasão.
- 🚫 Movimentação por nome, sem vínculo confiável por `aluno_id`, `matricula_id` ou `emusys_matricula_id`, não autoriza classificar evasão.
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

## Fideliza+

✅ Regra validada pelo Alf em 2026-06-07:

O programa Fideliza+ é **trimestral**, não mensal.

Recortes oficiais:

- Q1 = Janeiro, Fevereiro, Março.
- Q2 = Abril, Maio, Junho.
- Q3 = Julho, Agosto, Setembro.
- Q4 = Outubro, Novembro, Dezembro.

Implicações:

- O painel deve deixar claro qual trimestre está sendo calculado.
- Não deve parecer que os números do Fideliza+ são KPIs mensais do mês selecionado na página.
- Se a página estiver filtrada em `Mai/2026`, o Fideliza+ de Q2 deve se apresentar como `Q2 — Abr/Mai/Jun`, não como Maio isolado.
- Churn, inadimplência, renovação, reajuste e demais métricas do Fideliza+ devem usar o recorte trimestral correspondente.
- Transferência interna entre unidades não conta como evasão/churn global também no Fideliza+.

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
