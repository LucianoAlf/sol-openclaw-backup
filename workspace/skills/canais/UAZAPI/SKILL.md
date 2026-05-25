# Skill: UAZAPI — API WhatsApp

Base URL: `https://lamusic.uazapi.com`
Header obrigatório: `token: <instance_token>`

---

## POST /send/text — Enviar texto

```json
{
  "number": "5521999999999",
  "text": "Olá! Como posso ajudar?"
}
```

- `number`: telefone sem `@`, apenas dígitos com DDI (ex: `5521964171223`)
- `text`: mensagem de texto

---

## POST /send/media — Enviar mídia

```json
{
  "number": "5521999999999",
  "type": "image",
  "file": "https://url-da-imagem.jpg",
  "text": "Legenda opcional"
}
```

Tipos: `image`, `video`, `document`, `audio`, `myaudio`, `ptt` (voz), `sticker`

Para áudio de voz gravado: `type: "ptt"`, `file: "URL ou base64 do OGG/MP3"`

---

## POST /message/download — Baixar mídia recebida

```json
{
  "id": "ID_DA_MENSAGEM",
  "transcribe": true,
  "generate_mp3": true,
  "return_link": true
}
```

- `transcribe: true`: transcreve áudio para texto (usa OpenAI Whisper da instância)
- `return_link: true`: retorna URL pública do arquivo
- Resposta inclui `link` (URL) e `transcription` (texto se solicitado)

---

## POST /chat/check — Verificar se número está no WhatsApp

```json
{
  "numbers": ["5521999999999"]
}
```

Resposta: array com `{ query, jid, isInWhatsapp, name }`

---

## POST /chat/find — Buscar chats

```json
{
  "wa_name": "Hugo",
  "limit": 10
}
```

Filtros disponíveis: `wa_name`, `wa_chatid`, `wa_isGroup`, `wa_label`, `wa_unreadCount`, etc.

---

## POST /message/react — Reagir a mensagem

```json
{
  "id": "ID_DA_MENSAGEM",
  "emoji": "✅"
}
```

---

## POST /message/markread — Marcar como lida

```json
{
  "id": "ID_DA_MENSAGEM"
}
```

---

## Notas importantes

- Sempre enviar `number` sem `@s.whatsapp.net` — apenas os dígitos
- Instância: `c4e1a3c9-c22a-4b34-b2fb-d92737b7b6fc` (salvo em config)
- A tool `send_whatsapp` já abstrai o `/send/text` — usar ela para respostas normais
- Usar `/send/media` diretamente quando precisar enviar arquivo, imagem ou áudio

