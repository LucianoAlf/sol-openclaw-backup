# HEARTBEAT.md

## Verificação de saúde diária
<!-- cron: 0 9 * * 1-6 -->
Verificar se há alunos com 3+ faltas consecutivas nos últimos 7 dias e enviar relatório para o mestre.

## Inadimplência diária
<!-- cron: 0 9 * * * -->
Consulte no Supabase os alunos com status_pagamento='atrasado' ou status_pagamento='inadimplente' e dias_atraso >= 5.
Para cada um, monte a mensagem que seria enviada ao aluno (cobrança gentil).
Envie UM relatório consolidado para o Telegram do master com:
- Total de alunos detectados
- Lista: nome, valor, dias atraso, professor
- Exemplo da mensagem que seria mandada
NÃO envie nada para os alunos quando HEARTBEAT_DRY_RUN=true.

## Alunos sumidos
<!-- cron: 0 10 * * 1 -->
Consulte no Supabase os alunos ativos sem presença/aula registrada há 14+ dias.
Para cada um, monte a mensagem que seria enviada ao aluno.
Envie UM relatório consolidado para o Telegram do master com total, lista de alunos e exemplo da mensagem.
NÃO envie nada para os alunos quando HEARTBEAT_DRY_RUN=true.

## Renovações próximas
<!-- cron: 0 11 * * 1 -->
Consulte no Supabase os alunos ativos com contrato terminando nos próximos 30 dias.
Para cada um, monte a mensagem que seria enviada ao aluno sobre renovação.
Envie UM relatório consolidado para o Telegram do master com total, lista de alunos e exemplo da mensagem.
NÃO envie nada para os alunos quando HEARTBEAT_DRY_RUN=true.

## Aniversariantes do dia
<!-- cron: 0 8 * * * -->
Consulte no Supabase os alunos ativos que fazem aniversário hoje (D-0).
Para cada um, monte a mensagem que seria enviada ao aluno.
Envie UM relatório consolidado para o Telegram do master com total, lista de alunos e exemplo da mensagem.
NÃO envie nada para os alunos quando HEARTBEAT_DRY_RUN=true.
