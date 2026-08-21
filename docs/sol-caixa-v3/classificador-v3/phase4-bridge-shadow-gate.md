# Fase 4 — Shadow no bridge real

## Escopo

O classificador roda apenas como espelho no bridge da Sol. O parser legado
continua sendo a única autoridade para preview, approval, WhatsApp e RPC.

O módulo:

- não importa credenciais;
- não acessa banco;
- não chama `sendFn`;
- não cria preview ou approval;
- não chama RPC financeira;
- registra somente hashes do evento, intenção estruturada e ação do legado.

## Ativação

Permanece desligado por padrão. A única flag é:

```text
SOL_CAIXA_CLASSIFICADOR_V3_SHADOW=1
```

Mesmo ligada, a flag não muda a decisão, não bloqueia o parser legado e não
gera saída no WhatsApp. Erro no shadow é isolado e vira apenas log local.

## Cobertura inicial

As quatro regras espelhadas são as regras determinísticas já versionadas na
Fase 1: correção PIX, estorno, saída segurança e entrada/parcela PIX. Mídia e
identidade não resolvida ficam fail-closed (`media_pending`/`manual_review`).

Essa fase não substitui a futura facade SQL nem autoriza migration ou `STRICT=1`.
