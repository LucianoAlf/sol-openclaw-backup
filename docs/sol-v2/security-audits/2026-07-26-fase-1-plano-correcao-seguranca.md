# Sol v2 — Fase 1 Segurança: Plano de correção

Fonte: auditoria Alfredo, 2026-07-26.
Status: plano de execução. **Nada destrutivo foi executado ainda.**

---

## Veredito

A Fase 1 confirma dois bloqueios antes de qualquer WhatsApp/cron/auto-reply:

1. **Repo com archives versionados contendo arquivos sensíveis.**
2. **Credenciais aparecendo em argumentos de processo na VPS.**

A Sol pode continuar em diagnóstico e documentação, mas não deve ser considerada “pronta para produção limpa” antes desses pontos.

---

## Bloqueio 1 — Archives versionados no repo

Arquivos versionados encontrados:

- `backups/2026-05-26/sol-adm-20260526T225356Z.tar.gz`
- `backups/2026-05-27/sol-adm-20260527T210001Z.tar.gz`
- `backups/2026-05-28/sol-adm-20260528T210001Z.tar.gz`
- `backups/2026-05-29/sol-adm-20260529T210001Z.tar.gz`
- `backups/2026-05-30/sol-adm-20260530T210001Z.tar.gz`
- `backups/2026-05-31/sol-adm-20260531T210001Z.tar.gz`
- `backups/2026-06-01/sol-adm-20260601T210001Z.tar.gz`
- `backups/2026-06-02/sol-adm-20260602T210001Z.tar.gz`
- `backups/2026-06-03/sol-adm-20260603T210001Z.tar.gz`
- `backups/2026-06-04/sol-adm-20260604T210001Z.tar.gz`
- `backups/2026-06-05/sol-adm-20260605T210001Z.tar.gz`

Padrões sensíveis detectados dentro dos archives:

- `LA-Organizer/.env`
- `workspace/memory/lareport-readonly-secret-note.txt`
- arquivos com `auth`, `credentials`, `tokens` no nome/caminho

### Risco

Mesmo removendo os arquivos do working tree, o histórico Git continua contendo o conteúdo antigo. Isso exige limpeza de histórico ou criação de repo novo sanitizado.

### Correção recomendada

1. Congelar push enquanto o repo estiver sujo.
2. Criar backup local bruto fora do Git, com permissão restrita, só para recuperação técnica.
3. Remover archives do histórico Git usando `git filter-repo` ou BFG.
4. Adicionar regras fortes ao `.gitignore`:
   - `backups/**/*.tar.gz`
   - `*.tar.gz`
   - `*.tgz`
   - `*.zip`
   - `.env`
   - `.env.*`
   - `*.sqlite*`
   - logs sensíveis/media inbound.
5. Rodar novo scan pós-limpeza.
6. Rotacionar segredos potencialmente afetados.
7. Só então sincronizar GitHub.

### Exige aprovação explícita

- Reescrever histórico Git.
- Apagar/remover archives versionados.
- Rotacionar credenciais.
- Force-push ou recriar repo remoto.

---

## Bloqueio 2 — Segredos em argumentos de processo

Foram detectados padrões sensíveis em `argv/process list`, com valores mascarados no relatório:

- MCP Postgres com URL de conexão em linha de comando.
- MCP remoto `mcp-hugo` com header/token em linha de comando.

### Risco

Qualquer usuário/processo com permissão para listar processos pode ver a linha de comando completa. Isso expõe segredos operacionais.

### Correção recomendada

1. Inventariar onde esses MCPs são definidos no config Hermes da Sol.
2. Trocar credenciais inline por arquivo/env seguro quando o MCP suportar.
3. Quando a ferramenta não suportar secret por arquivo/env, criar wrapper local que leia secret de arquivo `0600` e minimize exposição.
4. Reiniciar Hermes da Sol após alteração.
5. Validar `ps` pós-restart sem credenciais visíveis.
6. Rotacionar tokens/credenciais que já ficaram expostos.

### Exige aprovação explícita

- Alterar config de MCP em produção.
- Reiniciar serviço Hermes se houver risco de interrupção.
- Rotacionar tokens.

---

## Alertas menores

Arquivos com nomes sensíveis versionados diretamente exigem revisão manual:

- `.env.example` — esperado, mas revisar para não conter valor real.
- `src/session.ts` — revisar para garantir que não contém segredo fixo.
- `workspace/memory/session-master.json` — revisar se contém IDs/tokens/sessões sensíveis.

WhatsApp novo da Sol ainda não aparece no repo:

- `552121700723`: 0 ocorrência no repo auditado.
- `2170-0723`: 0 ocorrência no repo auditado.

---

## Sequência de execução segura

### Parte A — sem alteração destrutiva

1. Revisar `.env.example`, `src/session.ts`, `workspace/memory/session-master.json`.
2. Criar documentação de segurança/segredos.
3. Preparar `.gitignore` reforçado.
4. Preparar scripts de scan sanitizado.
5. Preparar patch de config MCP sem aplicar.

### Parte B — exige OK do Alf

1. Remover archives do histórico.
2. Rotacionar segredos expostos.
3. Ajustar MCPs para não vazar em argv.
4. Reiniciar Hermes da Sol.
5. Sincronizar GitHub/repo sanitizado.

---

## Status

- [x] Inventário inicial do repo.
- [x] Inventário inicial de processos.
- [x] Plano de correção gerado.
- [ ] Aprovação para limpeza destrutiva/histórico Git.
- [ ] Aprovação para rotação de credenciais.
- [ ] Execução da limpeza.
- [ ] Validação pós-limpeza.

---

## Decisão posterior do Alf — sem rotação por enquanto

Em 2026-07-26, Alf decidiu não rotacionar credenciais agora, pois o repo da Sol está restrito a Alf e Hugo.

Plano ajustado:

- seguir a reforma sem rotação;
- tratar rotação como pendência recomendada, não bloqueante;
- continuar com mitigação segura: repo sanitizado, `.gitignore`, documentação, remoção de segredo de argv quando possível e sem expor valores.
