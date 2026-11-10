// Cliente de IA multi-proveedor (API compatible con OpenAI). Por defecto Google Gemini (plan gratuito).
// Si un proveedor se queda sin cupo (429) y hay otro configurado, prueba con el siguiente.

const PROVIDERS = {
  gemini: {
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    key: () => process.env.GEMINI_API_KEY,
    model: 'gemini-3.5-flash-lite',
    vision: true,
  },
  groq: {
    base: 'https://api.groq.com/openai/v1',
    key: () => process.env.GROQ_API_KEY,
    model: 'openai/gpt-oss-120b',
    vision: false,
  },
  openrouter: {
    base: 'https://openrouter.ai/api/v1',
    // Elegí un modelo gratuito (terminan en ":free") en https://openrouter.ai/models y cargalo en OPENROUTER_MODEL
    key: () => process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_MODEL,
    get model() { return process.env.OPENROUTER_MODEL; },
    vision: true,
  },
};

/** Proveedores con clave cargada, empezando por AI_PROVIDER */
export function activeProviders() {
  const order = [process.env.AI_PROVIDER, 'gemini', 'groq', 'openrouter']
    .filter((p, i, a) => p && PROVIDERS[p] && a.indexOf(p) === i);
  return order.filter((p) => PROVIDERS[p].key()).map((name, i) => ({
    name,
    ...PROVIDERS[name],
    // AI_MODEL / AI_BASE_URL aplican sólo al proveedor principal (AI_BASE_URL sirve p. ej. para Ollama local)
    base: i === 0 && process.env.AI_BASE_URL ? process.env.AI_BASE_URL.replace(/\/$/, '') : PROVIDERS[name].base,
    model: i === 0 && process.env.AI_MODEL ? process.env.AI_MODEL : PROVIDERS[name].model,
  }));
}

export const aiEnabled = () => activeProviders().length > 0;
export const aiDescription = () => {
  const p = activeProviders();
  return p.length ? p.map((x) => `${x.name}:${x.model}`).join(' → ') : null;
};

export class AIError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

async function callProvider(p, body) {
  const res = await fetch(`${p.base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.name === 'openrouter' ? process.env.OPENROUTER_API_KEY : p.key()}` },
    body: JSON.stringify({ ...body, model: p.model }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || json?.[0]?.error?.message || `HTTP ${res.status}`;
    throw new AIError(`${p.name}: ${msg}`, res.status);
  }
  return json;
}

/**
 * Chat completion con herramientas. `needsVision` evita proveedores sin soporte de imágenes.
 * Devuelve { message, provider }.
 */
export async function chat(body, { needsVision = false, preferred } = {}) {
  let list = activeProviders();
  if (preferred) list = [...list.filter((p) => p.name === preferred), ...list.filter((p) => p.name !== preferred)];
  if (needsVision) list = list.filter((p) => p.vision);
  if (!list.length) {
    throw new AIError(needsVision
      ? 'Ningún proveedor de IA configurado reconoce imágenes (usá GEMINI_API_KEY).'
      : 'Falta configurar la IA (GEMINI_API_KEY).', 503);
  }
  let lastErr;
  for (const p of list) {
    try {
      const json = await callProvider(p, body);
      const message = json.choices?.[0]?.message;
      if (!message) throw new AIError(`${p.name}: respuesta vacía`, 502);
      return { message, provider: p.name };
    } catch (e) {
      lastErr = e;
      // Con cupo agotado o caída del servicio probamos el siguiente proveedor
      if (![429, 500, 502, 503, 504].includes(e.status)) throw e;
      console.warn(`[ia] ${p.name} falló (${e.status}), probando siguiente…`);
    }
  }
  throw lastErr;
}

/** Descarga una imagen y la devuelve como data URI (los proveedores no siempre aceptan URLs remotas) */
export async function imageDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo leer la imagen (${res.status})`);
  const type = res.headers.get('content-type') || 'image/jpeg';
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 6 * 1024 * 1024) throw new Error('La imagen es demasiado grande');
  return `data:${type};base64,${buf.toString('base64')}`;
}

/**
 * Transcribe audio (notas de voz). Usa Whisper de Groq si hay GROQ_API_KEY (gratis, muy rápido);
 * si no, Gemini (acepta ogg, mp3, wav, aac, flac).
 */
export async function transcribe(buffer, mime = 'audio/ogg') {
  if (process.env.GROQ_API_KEY) {
    const ext = mime.includes('ogg') ? 'ogg' : mime.includes('webm') ? 'webm' : mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : mime.includes('wav') ? 'wav' : 'mp3';
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mime }), `audio.${ext}`);
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', 'es');
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }, body: form,
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.text) return json.text.trim();
    console.warn('[transcribir] groq falló', res.status, json?.error?.message);
  }
  if (process.env.GEMINI_API_KEY) {
    const model = process.env.AI_AUDIO_MODEL || 'gemini-3.5-flash-lite';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mime.split(';')[0], data: Buffer.from(buffer).toString('base64') } },
            { text: 'Transcribí este audio en español (Argentina). Respondé únicamente con la transcripción literal, sin comentarios.' },
          ],
        }],
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new AIError('No se pudo transcribir el audio: ' + (json?.error?.message || res.status), res.status);
    const text = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
    if (text) return text;
    throw new AIError('No se entendió el audio', 422);
  }
  throw new AIError('Para procesar audios configurá GEMINI_API_KEY (o GROQ_API_KEY).', 503);
}
