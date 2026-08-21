import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { extname } from 'node:path';

const PROMPT_VISAO = [
  'Descreva objetivamente esta imagem enviada em um grupo de trabalho de uma escola de música.',
  'Se houver texto legível (print de sistema, comprovante, planilha, conversa), transcreva o texto.',
  'Seja direto, no máximo 3 frases. Não invente informação que não está visível.',
].join(' ');

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif',
};

const TAMANHO_MAXIMO_PADRAO_BYTES = 20 * 1024 * 1024; // 20 MB

const PADRAO_CHAVE_GENERICA = /sk-[A-Za-z0-9_-]{8,}/g;

// Remove a apiKey configurada (match exato) e qualquer sequência com cara de
// chave da OpenAI (match genérico) de um texto, para nunca vazar segredo em
// mensagens de erro/motivo que acabam persistidas no banco.
function sanitizarSegredo(texto, apiKey) {
  let s = String(texto);
  if (apiKey) {
    s = s.split(apiKey).join('[REDACTED]');
  }
  s = s.replace(PADRAO_CHAVE_GENERICA, '[REDACTED]');
  return s;
}

export function criarMidia({
  apiKey, modeloAudio, modeloVisao, idioma = 'pt',
  fetchImpl = fetch, lerArquivo = readFileSync,
  tamanhoMaximoBytes = TAMANHO_MAXIMO_PADRAO_BYTES,
}) {
  async function transcrever(caminho, buf) {
    const form = new FormData();
    form.append('file', new Blob([buf]), caminho.split('/').pop());
    form.append('model', modeloAudio);
    form.append('language', idioma);
    const resp = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!resp.ok) throw new Error(`http_${resp.status}: ${String(await resp.text()).slice(0, 200)}`);
    const j = await resp.json();
    return { texto: (j.text || '').trim(), modelo: modeloAudio };
  }

  async function descrever(caminho, buf) {
    const mime = MIME[extname(caminho).toLowerCase()] || 'image/jpeg';
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
    const resp = await fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modeloVisao,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: PROMPT_VISAO },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
          ],
        }],
        max_tokens: 300,
      }),
    });
    if (!resp.ok) throw new Error(`http_${resp.status}: ${String(await resp.text()).slice(0, 200)}`);
    const j = await resp.json();
    return { texto: (j.choices?.[0]?.message?.content || '').trim(), modelo: modeloVisao };
  }

  async function extrairPdf(caminho) {
    return new Promise((resolve, reject) => {
      execFile('/usr/bin/pdftotext', ['-layout', '-enc', 'UTF-8', caminho, '-'], {
        timeout: 15000,
        maxBuffer: 512 * 1024,
      }, (err, stdout, stderr) => {
        if (err) {
          const msg = stderr ? `${err.message}: ${stderr}` : err.message;
          reject(new Error(msg));
          return;
        }
        resolve({ texto: String(stdout || '').trim(), modelo: 'pdftotext' });
      });
    });
  }

  async function processar(evento) {
    if (!evento?.hasMedia) return null;
    const tipo = evento.mediaType || 'media';
    const caminho = (evento.mediaUrls || [])[0];
    const pendente = (motivo) => ({ status: 'pendente', texto: null, modelo: null, tipo, motivo: sanitizarSegredo(motivo, apiKey) });

    if (!caminho) return pendente('sem_path_de_midia');
    const ext = extname(caminho).toLowerCase();
    const isPdf = tipo === 'document' && ext === '.pdf';
    if (tipo !== 'audio' && tipo !== 'image' && !isPdf) return pendente(`tipo_nao_suportado:${tipo}`);

    let buf;
    try {
      buf = lerArquivo(caminho);
    } catch (err) {
      return pendente(`arquivo_indisponivel:${err.message}`);
    }
    if (!buf || buf.length === 0) return pendente('arquivo_vazio');
    if (buf.length > tamanhoMaximoBytes) return pendente(`arquivo_muito_grande:${buf.length}`);

    try {
      const r = isPdf ? await extrairPdf(caminho, buf) : (tipo === 'audio' ? await transcrever(caminho, buf) : await descrever(caminho, buf));
      if (!r.texto) return pendente('resposta_vazia');
      return { status: 'ok', texto: r.texto, modelo: r.modelo, tipo };
    } catch (err) {
      return pendente(err.message);
    }
  }

  return { processar };
}
