# Fase 2 — ambiente controlado

Esta fase endurece o contrato, mas ainda nao e migration produtiva.

## Mudancas propostas

- matcher de termo por token normalizado, nao `LIKE '%termo%'`;
- contexto canônico validado no banco pelos helpers atuais:
  - `sol_caixa_grupo_operacao_ok(unidade_id, grupo_jid, operacao)`;
  - `sol_caixa_ator_operacao_ok(unidade_id, actor_phone, operacao)`;
- sem grupo/ator canônico, a facade devolve `manual_review`;
- facade continua sem preview, approval, consumo ou RPC financeira.

## Gate SQL controlado

Executar em transacao com `ROLLBACK`, nunca como migration:

1. confirmar que os dois helpers canônicos existem com a assinatura documentada;
2. aplicar `001`, `002` e `003` dentro da transacao;
3. inserir somente regras de fixture;
4. testar: match, empate, termo contido em outra palavra, grupo errado e ator errado;
5. consultar a facade e confirmar que nenhuma tabela financeira, preview ou approval foi escrita;
6. `ROLLBACK`.

O gate falha fechado se os helpers canônicos nao existirem ou tiverem assinatura diferente.

## Shadow do parser legado

O comparador deve ler o snapshot versionado de `runtime/caixa-financeiro.cjs`, registrar o SHA desse snapshot e marcar cada caso como:

- `match`;
- `divergencia`;
- `legacy_not_exposed` (quando a funcao exportada nao representa o caminho inteiro);
- `manual_review`.

Nao e permitido transformar `legacy_not_exposed` em `match` por fixture manual.
