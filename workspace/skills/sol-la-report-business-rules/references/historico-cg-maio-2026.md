# Histórico validado — Campo Grande Maio/2026

## Status

- ✅ Fechamento administrativo/alunos validado pelo Alf em 2026-06-01.
- ✅ Usar como âncora histórica para responder sobre CG/Maio/2026.
- 🚫 Não substituir por cálculo vivo atual sem auditoria forense e aprovação explícita.

## Números validados CG/Maio/2026

Fechamento validado após saneamentos manuais:

- alunos_ativos: **496**
- alunos_pagantes: **470**
- matriculas_ativas: **561**
- matriculas_banda: **41**
- matriculas_2_curso operacional: **27**
- novas_matriculas: **23**
- evasoes: **13**
- churn_rate: **2,77%**

## Por que 470 não deve ser tratado automaticamente como bug

O número 470 foi validado após auditoria nominal e correções operacionais feitas pelo Alf.

A queda anterior 475 → 470 foi explicada por cinco inconsistências corrigidas:

1. Bruna Damasceno — duplicidade/linha zerada removida, restou pagante real.
2. Miguel Gomes — professor/bolsista, corrigido para Bolsista Integral.
3. Matheus Reis — estagiário/bolsista integral, corrigido.
4. Carlos Eduardo — permuta/parceria, bolsista integral nos dois cursos, corrigido.
5. Marcos Saturnino — professor/bolsista/inativo/sujeira operacional, corrigido.

Pendências conhecidas na época:

- Ana Clara Lima Santos Pinto e Anna Clara de Souza Iorio Sales tinham faturas removidas/movidas pela Gabi.
- Sofia Elaile e Sofia Lauermann eram novas/passaporte, com recorrência começando em junho.

## Regra interpretativa importante

Para CG/Maio/2026, `valor_parcela > 0` isolado NÃO era regra suficiente para derrubar pagante histórico.

A decisão registrada na época foi:

- pagante contratual ≠ pagante financeiro da competência;
- `valor_parcela = 0` ou nulo é alerta financeiro/auditoria, não exclusão automática sem contexto;
- Sol deve separar ativo operacional, pagante contratual, pagante financeiro da competência, bolsista/permutado/professor/estagiário e sujeira operacional.

## Cron legado e contaminação posterior

Foi identificada contaminação por cron legado `snapshot_dados_mensais_mensal`, chamando `snapshot_dados_mensais`.

Fonte confiável aceita depois: `audit_log`/old_record antes da sobrescrita do cron às 03:00 de 01/06/2026, com:

- 496 / 470 / 561 / 41 / 27 / 23 / 13 / 2,77

Cálculos vivos posteriores chegaram a números como 475 ativos / 445 pagantes / 538 matrículas e foram considerados inadequados para restaurar Maio, porque recalculavam mês fechado usando estado operacional vivo/sujo.

## Como Sol deve responder quando perguntarem sobre CG/Maio/2026

Se a pergunta for “o cálculo de pagantes de Campo Grande em maio está certo?”:

Resposta correta:

- O fechamento histórico validado é **470 pagantes**.
- Não tratar 470 como bug automaticamente.
- Se uma query atual retornar 441/445/466, classificar como **recalculo vivo divergente / regra financeira mais restritiva / possível uso de estado atual**, não como verdade histórica.
- Antes de qualquer P8/P11 ou v3 em produção, manter SELECT-only e preservar audit trail.

Frase-guia:

> Para CG/Maio/2026, 470 é o fechamento validado pelo Alf para alunos/pagantes contratuais após auditoria nominal. Cálculo vivo atual com 441/445 não substitui histórico fechado sem auditoria forense e aprovação explícita.
