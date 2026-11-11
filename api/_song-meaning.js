// Significado de una canción (qué quiso transmitir el autor), explicado por una IA.
//
//   GET  /api/song-meaning?info=1   → { server: { gemini, anthropic } }  (claves configuradas)
//   POST /api/song-meaning  { title, artist, album, year, lyrics, albumArtist?, genre?, file? }
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
Te paso los datos de una canción y, si la tengo, su letra. Explica su significado con este formato (Markdown sencillo, sin tablas):

### En pocas palabras
Dos o tres frases con la idea central.

### Qué quiso transmitir el autor
Lo que se sabe por entrevistas, declaraciones o el contexto de la obra. Distingue con claridad lo documentado de tu interpretación ("según contó…", "parece que…"). Si no conoces declaraciones del autor sobre esta canción, dilo y no inventes ninguna, ni citas, ni fechas.

### Temas e imágenes
Los temas principales y las metáforas o imágenes más importantes, explicadas.

### Contexto
Álbum, época, circunstancias o recepción, solo si lo sabes con seguridad.

Reglas: no copies la letra; como mucho menciona fragmentos muy breves (menos de 8 palabras). Si no te paso la letra, explica la canción a partir del título, el artista y lo que sepas de ella (sin reconstruir ni citar la letra). Si la canción no te suena: con letra, basa el análisis en ella y avísalo al principio; sin letra, dilo claramente en dos o tres frases, cuenta solo lo que sepas con seguridad del artista o del álbum y no inventes nada. Entre 250 y 450 palabras.`;

export function buildUserPrompt({ title, artist, album, year, lyrics, albumArtist, genre, file }) {
  const meta = [
    `Título: ${title}`,
    artist && `Artista: ${artist}`,
    albumArtist && albumArtist !== artist && `Artista del álbum: ${albumArtist}`,
    album && `Álbum: ${album}`,
    year && `Año: ${year}`,
    genre && `Género: ${genre}`,
    // Sin etiquetas buenas, el nombre del archivo suele traer «Artista - Título».
    file && `Nombre del archivo: ${file}`
  ]
    .filter(Boolean)
    .join('\n');
  const text = String(lyrics || '').trim().slice(0, 4000);
  if (!text)
    return `${meta}\n\nNo tengo la letra de esta canción: explícala por su título, su artista y lo que se sepa de ella. Si el título o el artista parecen incompletos o mal escritos, usa también el álbum y el nombre del archivo para reconocerla.`;
  return `${meta}\n\nLetra (para tu análisis, no la reproduzcas):\n"""\n${text}\n"""`;
}

async function callGemini(key, prompt, model = GEMINI_MODEL) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
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
  if (!r.ok) throw Object.assign(new Error(apiError('Gemini', r.status, d?.error?.message)), { status: r.status === 429 ? 429 : 502, upstream: r.status });
  const c = d.candidates?.[0];
  const text = (c?.content?.parts || []).map(p => p.text || '').join('').trim();
  if (!text) throw Object.assign(new Error(c?.finishReason === 'RECITATION' ? 'Gemini no ha querido responder (contenido protegido). Prueba a regenerar.' : 'Gemini no ha devuelto respuesta'), { status: 502 });
  return { text, provider: 'gemini', model };
}

// Modelos «flash» que tu clave puede usar (para cuando el principal está saturado).
const modelCache = globalThis.__geminiModels || (globalThis.__geminiModels = new Map());
async function listGeminiFlash(key) {
  const ck = key.slice(-8);
  const c = modelCache.get(ck);
  if (c && Date.now() - c.t < 3600000) return c.v;
  let v = [];
  try {
    const r = await safeFetch(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
      { headers: { 'x-goog-api-key': key } },
      { allowFirstHost: h => h === 'generativelanguage.googleapis.com', timeoutMs: 8000, maxRedirects: 0 }
    );
    const d = JSON.parse(new TextDecoder().decode(await readLimited(r, 2_000_000)) || '{}');
    v = pickFlashModels(d.models || []);
  } catch {}
  modelCache.set(ck, { t: Date.now(), v });
  return v;
}
// De la lista de Google: los que generan texto, «flash», sin variantes de imagen, voz, etc.;
// los más nuevos primero (y las versiones «lite» después de las normales).
export function pickFlashModels(models) {
  const ver = n => (n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0';
  return models
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => String(m.name || '').replace(/^models\//, ''))
    .filter(n => /^gemini-.*flash/.test(n) && !/(image|tts|audio|live|embedding|vision|preview-\d{2}-\d{2}-exp|learnlm)/i.test(n))
    .sort((a, b) => Number(ver(b)) - Number(ver(a)) || /lite/.test(a) - /lite/.test(b) || a.length - b.length)
    .slice(0, 6);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 503/500 (saturado): un reintento y luego otros modelos. 404: modelo inexistente → siguiente.
// 429: cuota de ese modelo agotada → siguiente. 401/403 (clave mala): se para.
export async function geminiWithFallback(key, prompt, { call = callGemini, list = listGeminiFlash, extra = (process.env.GEMINI_FALLBACK_MODELS || '').split(','), deadline = Date.now() + 50000 } = {}) {
  const tried = new Set();
  let last = null;
  const queue = [GEMINI_MODEL, ...extra.map(x => x.trim()).filter(Boolean)];
  let listed = false;
  while (Date.now() < deadline) {
    if (!queue.length && !listed) {
      listed = true;
      queue.push(...(await list(key)));
    }
    const model = queue.shift();
    if (!model) break;
    if (tried.has(model)) continue;
    tried.add(model);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await call(key, prompt, model);
      } catch (e) {
        last = e;
        const up = e.upstream || 0;
        if (up === 401 || up === 403 || up === 400) throw e;
        if ((up === 503 || up === 500 || up === 504) && attempt === 0) {
          await sleep(1500);
          continue;
        }
        break; // 404, 429 o sigue saturado → siguiente modelo
      }
    }
  }
  if (last?.upstream === 503 || last?.upstream === 500) last.message = 'Gemini está saturado ahora mismo. Prueba otra vez en un par de minutos.';
  throw last || new Error('Gemini no ha respondido');
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
    const s200 = v => String(v || '').slice(0, 200).trim();
    const prompt = buildUserPrompt({ title, artist: s200(b.artist), album: s200(b.album), year: Number(b.year) || '', lyrics: String(b.lyrics || ''), albumArtist: s200(b.albumArtist), genre: s200(b.genre), file: s200(b.file) });
    let out;
    if (ch.provider === 'gemini') {
      try {
        out = await geminiWithFallback(ch.key, prompt);
      } catch (e) {
        // Si también hay clave de Claude en Vercel, se usa como último recurso.
        if (process.env.ANTHROPIC_API_KEY && ![400, 401, 403].includes(e.upstream)) out = await callAnthropic(process.env.ANTHROPIC_API_KEY, prompt);
        else throw e;
      }
    } else out = await callAnthropic(ch.key, prompt);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(e.status || 502).json({ error: e.message || 'No se pudo obtener el significado' });
  }
}
