# Fase 4.1 — correlação do shadow

## Problema observado

Um comprovante pode chegar como duas mensagens distintas: imagem e legenda.
O parser legado as agrupa por lote do chat, enquanto o shadow inicialmente as
registrava isoladamente. Isso não é divergência financeira.

## Regra de observação

- `lote_texto_anexado` + intenção classificada fica `awaiting_media`;
- mídia posterior do mesmo chat em até cinco minutos é correlacionada por IDs
  de mensagem hasheados;
- `preview_enviado` nessa consolidação vira `legacy_not_normalized`, nunca
  `match` ou divergência financeira;
- sem mídia correlata, o evento continua apenas `awaiting_media`;
- o estado é efêmero no processo e não grava em banco.

## Cobertura ampliada

Uma correção citada de categoria/parcela com competência agora produz a
intenção observacional `correcao_categoria`. Ela continua sem preview,
approval, WhatsApp, RPC ou mudança de autoridade.

## Garantias mantidas

O módulo segue sem rede, banco ou `sendFn`; `writes` é sempre `false`.
Parser legado continua autoridade e `STRICT=0`.
