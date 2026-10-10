// Artistas parecidos (para la «radio» de una canción), desde la API pública de Deezer.
//
//   GET /api/similar?artist=Nombre  → { artist, artists:[nombres…] }
//
// La app los cruza con la música del móvil; si esto falla, la radio se hace solo con
// lo que hay en la biblioteca (artista, género, año…).
import { safeFetch, rateLimited, readLimited } from './_lib/net.js';

const cache = globalThis.__similarCache || (globalThis.__similarCache = new Map());
const TTL = 24 * 3600 * 1000;
const norm = v =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

async function deezer(path) {
  const r = await safeFetch('https://api.deezer.com' + path, { headers: { Accept: 'application/json' } }, { allowFirstHost: h => h === 'api.deezer.com', timeoutMs: 6000 });
  if (!r.ok) throw Object.assign(new Error('Deezer no responde (' + r.status + ')'), { status: 502 });
  const d = JSON.parse(new TextDecoder().decode(await readLimited(r, 1_000_000)) || '{}');
  if (d.error) throw Object.assign(new Error('Deezer: ' + (d.error.message || 'error')), { status: 502 });
  return d;
}

export async function similarArtists(name) {
  const key = norm(name);
  if (!key) return { artist: '', artists: [] };
  const c = cache.get(key);
  if (c && Date.now() - c.t < TTL) return c.v;
  const s = await deezer('/search/artist?limit=5&q=' + encodeURIComponent(name));
  const list = s.data || [];
  const hit = list.find(a => norm(a.name) === key) || list[0];
  let v = { artist: '', artists: [] };
  if (hit) {
    const rel = await deezer(`/artist/${hit.id}/related?limit=60`);
    v = { artist: hit.name, artists: (rel.data || []).map(a => a.name).filter(Boolean).slice(0, 60) };
  }
  cache.set(key, { t: Date.now(), v });
  if (cache.size > 3000) cache.delete(cache.keys().next().value);
  return v;
}

export default async function handler(req, res) {
  if (rateLimited(req, res, 'similar', 60)) return;
  try {
    const u = new URL(req.url, 'http://localhost');
    const artist = String(u.searchParams.get('artist') || '').replace(/\s+/g, ' ').trim().slice(0, 150);
    if (!artist) return res.status(400).json({ error: 'Falta el artista' });
    const v = await similarArtists(artist);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    return res.status(200).json(v);
  } catch (e) {
    return res.status(e.status || 502).json({ error: e.message || 'No se pudieron buscar artistas parecidos' });
  }
}
