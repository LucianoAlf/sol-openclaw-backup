# Sol v2 — Matriz de credenciais para rotação

Fonte: inventário sanitizado de archives versionados + processos da VPS, 2026-07-26.
Valores reais não foram copiados para este documento.

---

## Rotação obrigatória / prioridade 1

Credenciais com evidência forte de exposição em repo/archive e/ou argv/process list.

### LA Report / Supabase read-only

- `LA_REPORT_READONLY_PASSWORD`
- conexão Postgres/Pooler do usuário read-only da Sol (`sol_acesso_restrito` / equivalente)
- `LA_REPORT_READONLY_USER`
- `LA_REPORT_READONLY_POOLER_USER` se houver usuário separado

Motivo: conexão Postgres apareceu em argumentos de processo e há nota/secret antigo em backup versionado.

### MCP Hugo / Chatwoot remoto

- token/header do `mcp-hugo` (`Api-Access-Token`)

Motivo: token aparece em argumentos de processo.

### Supabase tokens do ambiente legado Sol/LA-Organizer

- `SUPABASE_SERVICE_ROLE_KEY`
- `LA_REPORT_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY` quando associado ao projeto legado/LA Report
- `SUPABASE_ACCESS_TOKEN` se for o token operacional da Sol/Hermes

Motivo: `.env` antigo dentro dos tarballs versionados cita esses nomes; service role/access token têm impacto alto.

---

## Rotação recomendada / prioridade 2

Credenciais presentes em `.env` legado/tarballs ou secrets atuais, com impacto relevante.

### IA / providers

- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID` não é segredo forte, mas revisar dependências.

### WhatsApp/Chatwoot/WAHA legado

- `UAZAPI_TOKEN`
- `WAHA_API_KEY`
- `CHATWOOT_WEBHOOK_SECRET`
- `CHATWOOT_BOT_TOKEN`
- `CHATWOOT_USER_TOKEN`

Observação: Alf decidiu que Sol v2 não usará UAZAPI, mas tokens antigos devem ser rotacionados/revogados se ainda existirem.

### Segredos internos do app legado

- `WEBHOOK_SECRET`
- `INTERNAL_API_SECRET`
- `DATABASE_URL`

---

## Revisar, mas talvez não rotacionar

- `SUPABASE_URL`
- `LA_REPORT_SUPABASE_URL`
- `UAZAPI_URL`
- `TOM_PHONE`
- `MASTER_PHONE`
- IDs de sessão/número/grupo sem token associado

Motivo: identificadores/URLs não são necessariamente segredo, mas ajudam enumeração e devem ser tratados como informação sensível operacional.

---

## Ordem recomendada

1. Congelar push/sync do repo sujo.
2. Limpar histórico ou criar repo novo sanitizado.
3. Rotacionar service role/access tokens de maior impacto.
4. Rotacionar Postgres read-only/pooler da Sol.
5. Rotacionar token `mcp-hugo`.
6. Rotacionar Chatwoot/WAHA/UAZAPI legados ou revogar se não serão mais usados.
7. Rotacionar OpenAI/Gemini/ElevenLabs se os valores dos tarballs eram reais e ainda ativos.
8. Reiniciar serviços que usam os segredos novos.
9. Validar `ps` sem segredo em argv.
10. Rodar scan final do repo.

---

## Ações que exigem OK explícito

- Revogar/rotacionar credenciais.
- Alterar config MCP/Hermes em produção.
- Reescrever histórico Git ou force-push.
- Apagar archives do repo/histórico.

---

## Decisão do Alf — 2026-07-26

Alf decidiu **não rotacionar credenciais por enquanto**, porque o repo da Sol está restrito a ele e ao Hugo.

Classificação: risco aceito temporariamente pelo dono.

Consequência operacional:

- Não executar rotação automática.
- Não bloquear a reforma da Sol por rotação.
- Continuar saneamento sem rotação:
  - limpar repo/histórico quando aprovado;
  - reforçar `.gitignore`;
  - documentar segredos fora de Git;
  - tirar credenciais de argv/process list quando possível;
  - manter LA Report read-only;
  - não expor valores em chat/documentos.

A recomendação técnica permanece: rotacionar depois, especialmente se o repo for compartilhado, publicado, migrado, ou se alguma credencial aparecer fora do controle Alf/Hugo.
