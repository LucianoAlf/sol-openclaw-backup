# Emusys ↔ LA Music Report — Acesso operacional para auditoria cruzada

## Status

✅ Validado pelo Alfredo em 2026-06-08/09.

Este arquivo documenta o acesso operacional que o Alfredo pode usar para auditorias cruzadas entre **Emusys** e **LA Music Report/Sol**.

Não registrar tokens, secrets ou credenciais neste arquivo.

---

## O que o Alfredo consegue acessar

Com os tokens já disponíveis no ambiente seguro (`.env`), o Alfredo consegue consultar a API do Emusys em modo leitura para validar dados contra o Supabase do Performance Report.

Endpoints Emusys testados com sucesso:

```text
GET /v1/professores
GET /v1/aulas/
```

Base API:

```text
https://api.emusys.com.br/v1
```

Variáveis esperadas no ambiente:

```text
EMUSYS_BASE_URL
EMUSYS_TOKEN
LAREPORT_SUPABASE_URL
LAREPORT_SUPABASE_SERVICE_ROLE
```

⚠️ Nunca imprimir token em resposta, log público, markdown, memória ou commit.

---

## Teste live já realizado

### `GET /v1/professores`

Resultado validado:

- HTTP `200`
- resposta contém lista de professores;
- amostra estrutural: `id`, `nome`.

### `GET /v1/aulas/`

Resultado validado:

- HTTP `200`
- resposta paginada em `items`;
- campos observados incluem:
  - `id`
  - `nr_da_aula`
  - `tipo`
  - `categoria`
  - `turma_nome`
  - `curso_id`
  - `curso_nome`
  - `cancelada`
  - `data_hora_inicio`
  - `data_hora_fim`
  - `professores`
  - `alunos`

---

## Limitações confirmadas do Emusys

### `/v1/aulas/` não retorna `professor_id`

Quando a aula traz professores, os campos observados foram:

```text
nome
telefone
email
presenca
horario_presenca
```

Não veio `id`/`professor_id` dentro de `aula.professores`.

Implicação:

- `sync-presenca-emusys` precisa fazer matching de professor por nome.
- Matching por nome é evidência operacional, não chave perfeita.
- Em aulas tipo turma, `professores` pode vir vazio.

### `emusys_id` de professor é por unidade

Não tratar `emusys_id` como global sem cruzar unidade.

---

## Arquitetura validada

### Entrada — Emusys dispara webhook, nós gravamos Supabase

- Leads: Emusys → n8n `EB0LibpOJCLhKp7M` → `upsert_lead`.
- Experimentais: Emusys → n8n `Fucq0bQwF4oeuWnv` / subfluxos → `leads` / `lead_experimentais`.
- Matrículas: Emusys → n8n `WF_Matricula_Funcional` (`ZzuR9slRx8UqXg9N`) → edge `processar-matricula-emusys` → `alunos` / `movimentacoes_admin` / `alunos_historico`.

### Saída — Performance Report consulta Emusys

Chamadas diretas do nosso sistema ao Emusys confirmadas:

```text
GET /v1/aulas/       → sync-presenca-emusys
GET /v1/professores  → sync-professores-emusys
```

### Upstream — Mila SDR

Mila SDR é produto upstream:

- cadastra lead/experimental no Emusys;
- Emusys dispara webhook;
- quem grava no Supabase do Performance Report é o webhook/edge, não a Mila diretamente.

---

## Como usar em auditoria cruzada

Para bater Emusys vs Report, trabalhar sempre em modo leitura:

1. Consultar Emusys API (`GET /v1/aulas/` ou `GET /v1/professores`).
2. Consultar Supabase LA Report via SELECT-only:
   - `aulas_emusys`
   - `aluno_presenca`
   - `leads`
   - `lead_experimentais`
   - `alunos`
   - `professores`
   - `professores_unidades`
   - `emusys_sync_log`
   - `leads_automacao_log`
   - `automacao_log`
3. Cruzar por:
   - unidade;
   - data/hora;
   - nome normalizado;
   - telefone normalizado quando disponível;
   - curso;
   - professor por nome/emusys_id quando possível.
4. Classificar divergência como:
   - dado ausente no Emusys;
   - dado ausente no Report;
   - falha de webhook;
   - falha de sync;
   - limitação de matching;
   - sujeira operacional;
   - bug provável.

Sem autorização explícita do Alf, auditoria deve ser **SELECT-only** e leitura Emusys apenas.

---

## Risco específico — Experimentais

O fluxo de experimentais exige cuidado.

No `sync-presenca-emusys` existem dois caminhos:

### 1. `reconciliarExperimentaisOrfas`

Usa presença individual do aluno:

```ts
const presente = aluno.presenca === 'presente';
const novoStatus = presente ? 'experimental_realizada' : 'experimental_faltou';
```

Este caminho é mais confiável para distinguir realizada vs faltou.

### 2. `confirmarExperimentais`

Pode promover experimental agendada para `experimental_realizada` ao encontrar uma aula experimental por data/professor/unidade/categoria.

Risco: pode não validar presença individual do aluno antes de promover.

Implicação:

- Ao auditar funil/experimentais/conversão, não confiar cegamente apenas em `leads.experimental_realizada`.
- Conferir `lead_experimentais`, `aulas_emusys`, payload/sync de `/aulas/` e logs.

---

## Artefato de validação

Auditoria técnica salva em:

```text
outputs/la-report-emusys-integration-test/validacao_mapa_integracao_emusys_2026-06-08.md
```

---

## Regra operacional

Quando Alf pedir auditoria Emusys ↔ Report:

- usar esta referência;
- não pedir credencial se as variáveis já existirem no ambiente;
- não expor secrets;
- fazer leitura Emusys + SELECT-only Supabase;
- só propor correção depois de classificar a causa;
- nunca fazer backfill/migration/UPDATE/DELETE/INSERT sem aprovação explícita.
