# Spec — Sol Caixa CRUD Canonico v1

Data: 2026-08-20
Status: planejamento / sem implantacao
Dono executivo: Alf
Dono tecnico: Alfredo
Escopo: caixa operacional da Sol nos grupos financeiros da LA Music

## 1. Decisao de metodo

Nao continuar expandindo o monolito `caixa-financeiro.cjs` por regex/caso solto.

O objetivo e levar a Sol para o padrao que funciona melhor na Maria:

1. bridge monta pacote de contexto;
2. skill/regra de negocio define o contrato;
3. resolver/RPC canonica consulta o banco e devolve candidatos;
4. Sol monta preview conferivel;
5. escrita so por RPC auditada e com `pode` humano autorizado;
6. rollout em shadow antes de substituir o fluxo vivo.

Sem migration, sem restart e sem troca do fluxo vivo nesta fase de planejamento.

## 2. Diagnostico resumido

### O que funcionou e deve ser preservado

- Consulta de caixa do dia via skill `sol-caixa-consulta`.
- Fonte numerica via RPC `sol_caixa_resumo_do_dia`, sem valor inventado pelo LLM.
- Gate humano `pode` antes de escrita.
- Idempotencia/duplicidade como preocupacao real de dominio.
- Carimbo com ator/remetente autorizado.
- Reconhecimento de casos reais ja transformados em testes:
  - Laura/passaporte;
  - Perola/passaporte composto;
  - Vinicius/banda;
  - Arthur/lojinha;
  - Pedro/duas mensalidades;
  - Davi/fonte indisponivel;
  - Seguranca/saida;
  - Pix/cartao;
  - fechamento direto;
  - `pode Sol` / `Sol pode`.

### O que quebrou

- Categoria por keyword/regra espalhada gerou regressao em cadeia:
  - lojinha capturou passaporte;
  - parcela explicita virou lojinha;
  - passaporte/fonte indisponivel caiu em fallback legado;
  - correcao humana caiu no agente generico;
  - erro tecnico vazou no grupo.
- Restart durante caixa derrubou midia em processamento.
- Usuario autorizado no grupo nao bastou; faltava allowlist nominal.
- Bridge ficou decidindo natureza financeira, em vez de apenas organizar contexto.

### Causa raiz

O arquivo de ingestao virou um cerebro de dominio:

- OCR;
- valor;
- forma;
- categoria;
- aluno;
- fatura;
- composto;
- preview;
- correcao;
- confirmacao;
- escrita;
- mensagem publica.

Isso impede raciocinio local, teste limpo e evolucao sem regressao.

## 3. Principios do novo desenho

1. **Bridge nao decide financeiro.**
   Ele so entrega pacote estruturado.

2. **Regex so extrai sinal simples.**
   Pode extrair valor, data, forma, palavras fortes; nao decide regra de negocio final.

3. **Categoria e contrato canonico.**
   `parcela`, `passaporte`, `matricula`, `lojinha`, `banda`, `composto`, `saida_operacional`, `correcao`, `fechamento`.

4. **Fonte oficial vence.**
   Se a fonte canonica estiver indisponivel, a Sol bloqueia ou pede confirmacao; nao cai em legado perigoso.

5. **Preview nao e escrita.**
   Preview mostra evidencia e pergunta. Escrita so depois de confirmacao autorizada.

6. **Escrita so por RPC estreita.**
   Nada de SELECT/INSERT/UPDATE/DELETE cru pela Sol.

7. **Auditoria antes/depois.**
   Toda escrita guarda ator, grupo, mensagem, preview aprovado, payload, retorno, idempotency key e motivo.

8. **Shadow primeiro.**
   Novo fluxo roda comparando com o vivo antes de assumir producao.

## 4. Arquitetura alvo

```text
WhatsApp grupo
  |
  v
Bridge Hermes
  - identifica chat/grupo/unidade
  - identifica remetente/telefone/autorizacao
  - coleta midia/OCR/legenda/mensagem citada
  - cria pacote bruto
  |
  v
sol-caixa-ingestao
  - normaliza pacote
  - gera intencao estruturada
  - chama resolver canonico
  - monta preview
  |
  v
RPCs canonicas de caixa
  - resolver recebimento
  - preview/validacao
  - lancar movimento
  - corrigir movimento
  - cancelar/estornar movimento
  - buscar movimentos
  - abrir/fechar caixa
  |
  v
Banco LA Report
  - tabelas de caixa
  - auditoria
  - idempotencia
```

## 5. Contrato do pacote do bridge

Nome sugerido: `SolCaixaEventoBruto`.

Campos minimos:

```json
{
  "chat_id": "jid do grupo",
  "message_id": "id da mensagem",
  "quoted_message_id": "id citado ou null",
  "unidade_id": "uuid",
  "unidade_nome": "Campo Grande|Recreio|Barra",
  "sender_id": "jid/lid original",
  "sender_phone": "telefone normalizado quando existir",
  "sender_nome": "nome detectado",
  "texto": "legenda/texto humano",
  "ocr_text": "texto extraido da midia",
  "media": [
    {
      "tipo": "image|pdf|audio|unknown",
      "path": "caminho local ou referencia",
      "hash": "fingerprint"
    }
  ],
  "quoted_text": "texto da mensagem citada quando houver",
  "received_at": "timestamp"
}
```

O bridge nao retorna categoria final. No maximo retorna sinais:

```json
{
  "sinais": {
    "tem_valor": true,
    "valores": [417, 40],
    "forma_mencionada": "pix|dinheiro|cartao|unknown",
    "termos": ["passaporte", "parcela", "corda"]
  }
}
```

## 6. Intencao estruturada da skill

Nome sugerido: `SolCaixaIntencao`.

```json
{
  "tipo": "recebimento|saida|correcao|cancelamento|consulta|abertura|fechamento|duvida",
  "categoria": "parcela|passaporte|matricula|lojinha|banda|composto|seguranca|outro",
  "valor_total": 0,
  "forma": "pix|dinheiro|cartao|unknown",
  "cartao_modalidade": "debito|credito|null",
  "cartao_parcelas": null,
  "aluno_nome": null,
  "competencia": null,
  "componentes": [],
  "alvo_citado": null,
  "confianca": "alta|media|baixa",
  "bloqueios": [],
  "perguntas": []
}
```

Regra: intencao baixa ou com bloqueio nao pode virar escrita; so preview/pergunta.

## 7. RPCs canonicas propostas

### 7.1 `sol_caixa_resolver_recebimento_v1`

Funcao: receber intencao/pacote e devolver candidatos canônicos.

Entrada:

- unidade;
- valor total;
- aluno/termos;
- competencia;
- categoria sugerida;
- forma;
- componentes;
- origem da mensagem.

Saida:

- `ok`;
- `status`: `resolvido|ambiguo|bloqueado|fonte_indisponivel|nao_encontrado`;
- aluno canonico;
- faturas/componentes possiveis;
- diferencas de valor;
- categoria canonica;
- perguntas necessarias;
- bloqueios;
- preview_json recomendado.

Nao escreve.

### 7.2 `sol_caixa_lancar_movimento_v1`

Funcao: gravar entrada ou saida de caixa depois de preview aprovado.

Valida:

- caixa aberto;
- ator autorizado para unidade;
- preview aprovado existe;
- idempotency key unica;
- valor > 0;
- categoria permitida;
- forma permitida por tipo;
- sem bloqueio pendente.

Escreve:

- movimento de caixa;
- auditoria antes/depois;
- link para mensagem/preview.

### 7.3 `sol_caixa_corrigir_movimento_v1`

Funcao: corrigir movimento ja lancado com escopo estreito.

Modos permitidos na v1:

- forma de pagamento;
- modalidade/parcelas do cartao;
- categoria;
- descricao;
- aluno/competencia, apenas quando comprovado e com auditoria forte.

Nao permitido sem gate maior:

- alterar valor;
- trocar unidade;
- apagar movimento;
- marcar pagamento real fora do caixa.

### 7.4 `sol_caixa_cancelar_movimento_v1`

Funcao: cancelamento/estorno auditado, nunca delete fisico.

Valida:

- ator autorizado;
- motivo obrigatorio;
- mensagem citada/alvo claro;
- janela operacional ou aprovacao do Alf.

### 7.5 `sol_caixa_buscar_movimentos_v1`

Funcao: busca segura para correcoes.

Filtro:

- unidade;
- data;
- valor;
- categoria;
- aluno;
- message_id/preview_id;
- ultimos N.

Read-only.

### 7.6 `sol_caixa_preview_movimento_v1`

Opcional. Pode ficar dentro do resolver.

Funcao: montar preview padronizado com evidencias, bloqueios e CTA.

## 8. Papel restrito da Sol

Criar ou revisar papel restrito:

- sem SELECT direto em tabelas sensiveis;
- sem INSERT/UPDATE/DELETE direto;
- EXECUTE apenas nas RPCs `sol_caixa_*` aprovadas;
- funcoes `SECURITY DEFINER` com `search_path` explicito;
- grants nominais, sem `PUBLIC EXECUTE` perigoso.

Provas obrigatorias:

- `has_table_privilege` negando acesso direto;
- `has_function_privilege` mostrando so as RPCs autorizadas;
- tentativa de acesso fora do caixa falha;
- tentativa de movimento sem ator/autorizacao falha.

## 9. Matriz de casos reais

Esses casos viram contrato de regressao antes de qualquer troca:

| Caso | Esperado |
|---|---|
| Laura/Recreio/passaporte | passaporte vence lojinha/parcela; preview sem categoria errada |
| Perola/passaporte composto | R$ 387 + R$ 280 = composto Parcela + Passaporte |
| Vinicius/Banda | mensalidade + banda R$ 40 vira composto |
| Arthur/lojinha/corda | lojinha/produto vence busca de fatura |
| Pedro/duas mensalidades | duas faturas/cursos na competencia, nao uma parcela errada |
| Davi/fonte indisponivel | bloqueia, nao usa fallback legado |
| Seguranca/saida | saida operacional dinheiro, preview e `pode` |
| Pix/cartao | forma/modalidade preservada, `foi pix` corrige auditado |
| Parcela/Recreio/Vitoria | legenda `parcela` vence chute de lojinha |
| Fechamento direto | `pode fechar o caixa` chama rota deterministica |
| `pode Sol` | confirma igual `Sol pode`, sem falso positivo |
| Erro tecnico | nunca vaza RPC/Codex/SQL no grupo |

## 10. Fases de entrega

### Fase 0 — Congelamento e inventario

Sem escrever codigo produtivo.

- mapear arquivos vivos;
- mapear RPCs atuais;
- mapear testes existentes;
- mapear casos rejects/regressoes;
- comparar com Maria;
- definir contrato final com Alf.

Saida: spec aprovada.

### Fase 1 — Harness shadow

Criar uma camada que recebe pacote bruto e devolve intencao/preview em modo shadow.

- nao envia WhatsApp;
- nao escreve banco;
- compara com resultado do fluxo atual;
- gera relatorio por caso.

Saida: score por caso real.

### Fase 2 — Resolver read-only

Implementar `sol_caixa_resolver_recebimento_v1`.

- SELECT/RPC read-only;
- retorna candidatos;
- sem escrita;
- testes com massa real e fixtures.

Saida: resolver bate casos reais.

### Fase 3 — Preview novo em paralelo

Sol pode gerar preview novo, mas ainda nao substituir lancamento vivo.

- feature flag;
- grupos piloto;
- sem escrita pelo novo fluxo;
- validacao humana.

Saida: previews melhores que fluxo antigo.

### Fase 4 — Escrita por RPC canonica

Ativar `sol_caixa_lancar_movimento_v1` primeiro para menor risco.

Ordem sugerida:

1. Pix/parcela simples;
2. passaporte;
3. lojinha;
4. composto;
5. saida operacional;
6. correcoes;
7. cancelamento/estorno.

Cada item so entra se a matriz anterior estiver verde.

### Fase 5 — Desligar partes do monolito

Depois de shadow + producao assistida:

- remover rota antiga por categoria;
- manter fallback seguro que pergunta/recusa;
- apagar codigo morto so com backup e aprovacao.

## 11. Gates de aprovacao

Alfredo pode fazer sem pedir a cada passo:

- leitura/auditoria;
- spec;
- testes locais;
- shadow sem escrita;
- fixtures;
- refatoracao local sem deploy;
- relatorio.

Exige OK explicito do Alf:

- migration em producao;
- grant/revoke de papel;
- trocar fluxo vivo do WhatsApp;
- reiniciar durante horario de caixa;
- qualquer escrita/retificacao real de caixa;
- ativar cancelamento/estorno;
- desligar parser antigo.

## 12. Backups e rollback

Antes de qualquer fase com producao:

- backup do profile da Sol;
- backup do arquivo alterado com timestamp;
- commit ou pacote de patch em repo canonico;
- dump ou script rollback da migration;
- kill-switch por env/feature flag:
  - `SOL_CAIXA_INGESTAO_V2=0`;
  - `SOL_CAIXA_V2_SHADOW=1`;
  - `SOL_CAIXA_V2_WRITE=0`.

## 13. Resultado esperado

A Sol deixa de ser "um monte de regex no caixa" e vira dona controlada do dominio Caixa:

- entende comprovante e correcao humana;
- consulta fonte oficial;
- monta preview confiavel;
- so escreve com confirmacao;
- audita tudo;
- nao vaza tecnico;
- evolui por contrato/teste, nao por remendo.

