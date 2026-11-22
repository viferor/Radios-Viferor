// Traducción de letras, línea a línea, con el traductor de Google (sin clave).
//
//   POST /api/translate  { lines: ["…", "…"], to: "es" }
//   → { lang: "en", lines: ["…", "…"] }   (mismo número de líneas; las vacías siguen vacías)
import { safeFetch, rateLimited, readLimited } from './_lib/net.js';
import { readJson } from './_lib/body.js';

const GT = 'https://translate.googleapis.com/translate_a/single';
const MAX_CHARS = 9000;

// Respuesta de Google: [[["traducción","original",…],…], null, "en", …]
export function parseGoogle(data) {
  const segs = Array.isArray(data?.[0]) ? data[0] : [];
  const text = segs.map(s => (Array.isArray(s) && typeof s[0] === 'string' ? s[0] : '')).join('');
  return { text, lang: typeof data?.[2] === 'string' ? data[2] : '' };
}

async function google(text, to) {
  const u = new URL(GT);
  u.searchParams.set('client', 'gtx');
  u.searchParams.set('sl', 'auto');
  u.searchParams.set('tl', to);
  u.searchParams.set('dt', 't');
  const r = await safeFetch(
    u.toString(),
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': 'Mozilla/5.0' }, body: 'q=' + encodeURIComponent(text) },
    { allowFirstHost: h => h === 'translate.googleapis.com', timeoutMs: 12000, maxRedirects: 0 }
  );
  if (!r.ok) throw Object.assign(new Error('El traductor no responde (' + r.status + ')'), { status: 502 });
  return parseGoogle(JSON.parse(new TextDecoder().decode(await readLimited(r, 2_000_000))));
}

// Traduce las líneas no vacías de una vez (separadas por saltos de línea) y las
// vuelve a colocar en su sitio. Si Google junta o parte líneas, se hace por tandas.
export async function translateLines(lines, to = 'es', tr = google) {
  const idx = [],
    src = [];
  lines.forEach((l, i) => {
    const s = String(l ?? '').trim();
    if (s) {
      idx.push(i);
      src.push(s);
    }
  });
  const out = lines.map(() => '');
  if (!src.length) return { lang: '', lines: out };
  const first = await tr(src.join('\n'), to);
  let parts = first.text.split('\n');
  if (parts.length !== src.length) {
    parts = [];
    for (let i = 0; i < src.length; i += 6) {
      const batch = src.slice(i, i + 6);
      const res = await Promise.all(batch.map(s => tr(s, to).then(r => r.text.replace(/\n/g, ' '))));
      parts.push(...res);
    }
  }
  idx.forEach((i, k) => (out[i] = (parts[k] || '').trim()));
  return { lang: first.lang, lines: out };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });
  if (rateLimited(req, res, 'translate', 40)) return;
  try {
    const body = await readJson(req);
    const lines = Array.isArray(body.lines) ? body.lines.slice(0, 400).map(x => String(x ?? '').slice(0, 500)) : [];
    const to = /^[a-z]{2}(-[A-Z]{2})?$/.test(body.to || '') ? body.to : 'es';
    if (lines.join('\n').length > MAX_CHARS) return res.status(413).json({ error: 'La letra es demasiado larga para traducirla' });
    return res.status(200).json(await translateLines(lines, to));
  } catch (e) {
    return res.status(e.status || 502).json({ error: e.message || 'No se pudo traducir' });
  }
}
