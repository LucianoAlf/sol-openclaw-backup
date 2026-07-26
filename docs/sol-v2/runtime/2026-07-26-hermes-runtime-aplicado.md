# Sol v2 — Runtime Hermes aplicado na VPS

Data: 2026-07-26  
Host: `lahq`  
Usuário: `sol`  
Serviço: `hermes-gateway-sol.service`

---

## O que foi aplicado

Identidade Sol v2 aplicada nos pontos de carregamento do Hermes:

- `/home/sol/.hermes/profiles/sol/SOUL.md`
- `/home/sol/.hermes/profiles/sol/AGENTS.md`
- `/home/sol/.hermes/profiles/sol/USER.md`
- `/home/sol/.hermes/profiles/sol/MEMORY.md`
- `/home/sol/.hermes/SOUL.md`
- `/home/sol/AGENTS.md`

Profile externo sincronizado:

- `/home/sol/.hermes/profiles/sol-atendimento-externo/SOUL.md`
- `/home/sol/.hermes/profiles/sol-atendimento-externo/AGENTS.md`
- `/home/sol/.hermes/profiles/sol-atendimento-externo/USER.md`
- `/home/sol/.hermes/profiles/sol-atendimento-externo/MEMORY.md`

---

## Backups criados

Backups de identidade criados antes da aplicação:

- `/home/sol/.hermes/profiles/sol/backups/identity-pre-sol-v2-20260726T134628Z`
- `/home/sol/.hermes/profiles/sol-atendimento-externo/backups/identity-pre-sol-v2-20260726T134946Z`

Backups adicionais do `config.yaml` e service unit foram criados com sufixos timestamped próximos do horário da alteração.

---

## CWD lógico / contexto

`terminal.cwd` configurado no profile principal:

```yaml
terminal:
  cwd: /home/sol
```

Motivo: Hermes carrega `AGENTS.md` pelo CWD lógico.  
Critério validado: `prompt-size` mostra contexto carregado.

Evidência:

```text
Prompt-size breakdown (platform=telegram, model=gpt-5.5)
System prompt total : 25,654 B
context (AGENTS.md/cwd files) : 5,959 B
```

---

## Serviço

Estado pós-ajuste:

```text
ActiveState=active
SubState=running
NRestarts=0
```

Observação: durante restart, systemd registrou `Failed with result 'exit-code'` do processo antigo. Isso é comportamento já esperado no Hermes ao reiniciar; a validação final foi feita pelo estado ativo e `NRestarts=0`.

---

## Validação local

Profile principal respondeu corretamente em teste local antes do preflight WhatsApp:

```text
SOL_V2_OK
SOL_WHATSAPP_PREFLIGHT_OK
```

Profile externo respondeu:

```text
SOL_EXTERNO_V2_OK
```

Depois, um teste de chat local ficou preso porque a Sol começou a se autodiagnosticar; o teste foi interrompido. O serviço precisou ser aguardado/reativado externamente e voltou para `active/running`.

---

## WhatsApp Hermes nativo — estado seguro

Hermes v0.17.0 tem comando nativo:

```bash
hermes whatsapp
```

Esse comando usa bridge Baileys embutido e exige QR code do WhatsApp do número da Sol.

Estado atual:

- `whatsapp: {}` no `config.yaml` ativo.
- `WHATSAPP_ENABLED` intencionalmente **não definido** na `.env`.
- Sessão WhatsApp ainda **não pareada**.
- Sem bridge WhatsApp da Sol ativo.
- Sem envio real.

Pegadinha encontrada:

- `WHATSAPP_ENABLED=false` ainda fez o plugin tentar conectar.
- `whatsapp:` com extras no YAML também conta como plataforma habilitada.
- Portanto, até o QR ser escaneado, deixar:

```yaml
whatsapp: {}
```

e remover/evitar `WHATSAPP_ENABLED`.

Preflight seguro salvo fora do config ativo:

- `/home/sol/.hermes/profiles/sol/whatsapp-preflight-sol-v2.yaml`

Conteúdo esperado para aplicar depois do pareamento e antes de qualquer rota produtiva:

```yaml
whatsapp:
  unauthorized_dm_behavior: ignore
  reply_prefix: ""
  dm_policy: allowlist
  allow_from:
    - "5521981278047"
  group_policy: disabled
  group_allow_from: []
  require_mention: true
  free_response_chats: []
```

---

## Próximo passo recomendado

Fase 4A — Pareamento WhatsApp controlado:

1. Rodar `hermes whatsapp` em TTY como usuário `sol`.
2. Escolher modo bot.
3. Usar o WhatsApp do número `21 2170-0723` / `552121700723` para escanear o QR.
4. Confirmar que `creds.json` foi criado.
5. Antes de reiniciar gateway, aplicar política segura/allowlist.
6. Reiniciar serviço.
7. Validar que a Sol não responde em grupos e não fala com desconhecidos.

Fase 4B — Coleta de grupos:

- Identificar JIDs dos grupos aprovados.
- Manter `group_policy=disabled` até existir lista explícita ou mecanismo de ingestão listen-only.
- Para relatórios diários, preferir envio controlado por cron para grupo aprovado, não auto-reply conversacional.

## Atualização — WhatsApp nativo pareado sem habilitar auto-reply

Data: 2026-07-26

O WhatsApp nativo Hermes da Sol foi pareado com sucesso para o número novo `552121700723` usando o bridge Baileys em modo `--pair-only`, sem executar o wizard completo `hermes whatsapp`.

Evidências de segurança:

- Sessão criada em `/home/sol/.hermes/profiles/sol/whatsapp/session/creds.json`.
- `WHATSAPP_ENABLED` permanece unset em `/home/sol/.hermes/profiles/sol/.env`.
- Config ativo permanece com `whatsapp: {}`.
- `WHATSAPP_MODE=bot`.
- `WHATSAPP_ALLOWED_USERS=5521981278047`.
- `WHATSAPP_GROUP_POLICY=disabled`.
- `hermes-gateway-sol.service` permaneceu ativo/running com `NRestarts=0`.
- QR temporário e script temporário de pareamento foram removidos após o pareamento.

Conclusão: a conta WhatsApp está pareada, mas o canal WhatsApp da Sol ainda NÃO está habilitado no gateway e NÃO há auto-reply ativo.

Próximo passo seguro: aplicar política WhatsApp listen-only/allowlist e validar recepção em ambiente controlado antes de qualquer envio real ou auto-reply em grupo.
