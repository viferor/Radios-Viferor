// Significado de una canción (qué quiso transmitir el autor), explicado por una IA.
//
//   GET  /api/song-meaning?info=1   → { server: { gemini, anthropic } }  (claves configuradas)
//   POST /api/song-meaning  { title, artist, album, year, lyrics }
//        → { text, provider, model }
//
// Claves (por orden): variables de entorno de Vercel GEMINI_API_KEY (gratis en Google
// AI Studio) o ANTHROPIC_API_KEY; si no hay, la que el usuario guardó en su dispositivo
// (cabeceras X-AI-Provider y X-AI-Key). Modelos: GEMINI_MODEL / ANTHROPIC_MODEL.
import { safeFetch, rateLimited, readLimited } from './_lib/net.js';
import { readJson } from './_lib/body.js';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';

export const SYSTEM_PROMPT = `Eres un periodista musical que explica canciones en español de España, con un tono cercano y claro.
Te paso los datos de una canción y su letra. Explica su significado con este formato (Markdown sencillo, sin tablas):

### En pocas palabras
Dos o tres frases con la idea central.

### Qué quiso transmitir el autor
Lo que se sabe por entrevistas, declaraciones o el contexto de la obra. Distingue con claridad lo documentado de tu interpretación ("según contó…", "parece que…"). Si no conoces declaraciones del autor sobre esta canción, dilo y no inventes ninguna, ni citas, ni fechas.

### Temas e imágenes
Los temas principales y las metáforas o imágenes más importantes, explicadas.

### Contexto
Álbum, época, circunstancias o recepción, solo si lo sabes con seguridad.

Reglas: no copies la letra; como mucho menciona fragmentos muy breves (menos de 8 palabras). Si la canción no te suena, basa el análisis solo en la letra y avísalo al principio. Entre 250 y 450 palabras.`;

export function buildUserPrompt({ title, artist, album, year, lyrics }) {
  const meta = [`Título: ${title}`, artist && `Artista: ${artist}`, album && `Álbum: ${album}`, year && `Año: ${year}`].filter(Boolean).join('\n');
  const text = String(lyrics || '').slice(0, 4000);
  return `${meta}\n\nLetra (para tu análisis, no la reproduzcas):\n"""\n${text || '(sin letra disponible)'}\n"""`;
}

async function callGemini(key, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const r = await safeFetch(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 2048 }
      })
    },
    { allowFirstHost: h => h === 'generativelanguage.googleapis.com', timeoutMs: 45000, maxRedirects: 0 }
  );
  const d = JSON.parse(new TextDecoder().decode(await readLimited(r, 2_000_000)) || '{}');
  if (!r.ok) throw Object.assign(new Error(apiError('Gemini', r.status, d?.error?.message)), { status: r.status === 429 ? 429 : 502 });
  const c = d.candidates?.[0];
  const text = (c?.content?.parts || []).map(p => p.text || '').join('').trim();
  if (!text) throw Object.assign(new Error(c?.finishReason === 'RECITATION' ? 'Gemini no ha querido responder (contenido protegido). Prueba a regenerar.' : 'Gemini no ha devuelto respuesta'), { status: 502 });
  return { text, provider: 'gemini', model: GEMINI_MODEL };
}

async function callAnthropic(key, prompt) {
  const r = await safeFetch(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 1500, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: prompt }] })
    },
    { allowFirstHost: h => h === 'api.anthropic.com', timeoutMs: 45000, maxRedirects: 0 }
  );
  const d = JSON.parse(new TextDecoder().decode(await readLimited(r, 2_000_000)) || '{}');
  if (!r.ok) throw Object.assign(new Error(apiError('Claude', r.status, d?.error?.message)), { status: r.status === 429 ? 429 : 502 });
  const text = (d.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();
  if (!text) throw Object.assign(new Error('Claude no ha devuelto respuesta'), { status: 502 });
  return { text, provider: 'anthropic', model: ANTHROPIC_MODEL };
}

function apiError(name, status, msg) {
  if (status === 401 || status === 403) return `La clave de ${name} no es válida o no tiene permiso`;
  if (status === 429) return `${name}: has llegado al límite de consultas. Prueba más tarde`;
  return `${name} ha fallado (${status})${msg ? ': ' + String(msg).slice(0, 160) : ''}`;
}

// Qué proveedor y clave usar: primero las del servidor, luego la del dispositivo.
export function chooseProvider(env, headers) {
  if (env.GEMINI_API_KEY) return { provider: 'gemini', key: env.GEMINI_API_KEY };
  if (env.ANTHROPIC_API_KEY) return { provider: 'anthropic', key: env.ANTHROPIC_API_KEY };
  const p = String(headers['x-ai-provider'] || '').toLowerCase();
  const k = String(headers['x-ai-key'] || '').trim();
  if (k && /^[\w\-.]{20,300}$/.test(k) && (p === 'gemini' || p === 'anthropic')) return { provider: p, key: k };
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const u = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && u.searchParams.get('info') === '1')
    return res.status(200).json({ server: { gemini: !!process.env.GEMINI_API_KEY, anthropic: !!process.env.ANTHROPIC_API_KEY }, models: { gemini: GEMINI_MODEL, anthropic: ANTHROPIC_MODEL } });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });
  if (rateLimited(req, res, 'song-meaning', 15)) return;
  try {
    const ch = chooseProvider(process.env, req.headers || {});
    if (!ch) return res.status(501).json({ error: 'no-key' });
    const b = await readJson(req);
    const title = String(b.title || '').slice(0, 200).trim();
    if (!title) return res.status(400).json({ error: 'Falta el título' });
    const prompt = buildUserPrompt({ title, artist: String(b.artist || '').slice(0, 200), album: String(b.album || '').slice(0, 200), year: Number(b.year) || '', lyrics: String(b.lyrics || '') });
    const out = ch.provider === 'gemini' ? await callGemini(ch.key, prompt) : await callAnthropic(ch.key, prompt);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(e.status || 502).json({ error: e.message || 'No se pudo obtener el significado' });
  }
}
