# Sol Caixa V3

Fonte versionada do trabalho do Caixa V3 da Sol em 20-21/08/2026.

Este pacote registra o que foi aplicado/testado no runtime da Sol e no banco do LA Report, sem mover a verdade financeira para o banco proprio da Sol.

## Estado atual

- Canario V3 em producao usando o ledger `shadow_*` formalizado como contrato de preview/approval.
- Entrada, saida, correcao de movimento e estorno passam por approval V3 fail-closed no banco.
- Writer de preview financeiro endurecido: preview financeiro precisa nascer com operacao canonica, unidade, valor, forma e categoria.
- `STRICT=1` ainda bloqueado.
- Consumo vivo persistido ainda pendente: falta observar um caso real `preview -> pode -> approval -> consumo -> RPC financeira -> movimento`.
- Abertura/fechamento continuam fora do gate V3 de approval, por decisao de escopo.

## O que esta salvo aqui

- `specs/`: specs e fixtures sanitizadas geradas durante a construcao.
- `reports/`: relatorios dos gates e smokes.
- `harness/`: fixtures e runners usados nos gates.
- `runtime/`: snapshot dos arquivos vivos da LAHQ ligados ao Caixa/WhatsApp.
- `MIGRATIONS_APLICADAS.md`: manifesto das migrations aplicadas no banco LA Report.
- `STATUS-2026-08-21.md`: status honesto do gate.
- `ARCHITECTURE.md`: fronteiras entre repo Sol, banco LA Report e banco proprio da Sol.
- `NEXT-CLASSIFICADOR-V3.md`: proximo passo para tirar o parser velho do caminho.

## Fronteira de dominio

- Codigo da Sol fica neste repositorio.
- Caixa financeiro real continua no banco do LA Report enquanto o sistema financeiro consulta esse banco.
- Banco proprio da Sol deve guardar estado da agente, ingestao, observabilidade e futuramente classificacao, se a arquitetura final decidir isso.
- Migrations/RPCs aplicadas no LA Report precisam ficar manifestadas aqui porque a Sol depende delas em runtime.

## Seguranca

Nao ha tokens neste pacote. Tokens colados em chat devem ser tratados como expostos e rotacionados fora deste repositorio.
