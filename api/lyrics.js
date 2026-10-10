// Letras de canciones desde LRCLIB (https://lrclib.net), base de datos abierta y sin clave.
//
//   GET /api/lyrics?artist=&title=&album=&duration=   → la mejor letra (sincronizada si la hay)
//   GET /api/lyrics?id=123                            → una versión concreta
//   GET /api/lyrics?search=1&artist=&title=           → versiones disponibles para elegir
//
// Respuesta: { found, id, trackName, artistName, albumName, duration, instrumental,
//              synced, plain, source:'lrclib' } o { items:[…] } en la búsqueda.
import { safeFetch, rateLimited, readLimited } from './_lib/net.js';

const BASE = 'https://lrclib.net/api';
const UA = 'RadiosViferor (https://radiosviferor.vercel.app)';
const cache = globalThis.__lyricsCache || (globalThis.__lyricsCache = new Map());
const TTL = 6 * 3600 * 1000;

const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);

// «Canción (feat. X) - Remastered 2011 [Live]» → «Canción»
export function simplifyTitle(t) {
  return clean(t)
    .replace(/\s*[([](feat\.?|ft\.?|with|con)\s[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+(\d{4}\s+)?(remaster(ed)?|live|en directo|mono|stereo|radio edit|single version|versi[oó]n).*$/i, '')
    .replace(/\s*[([](\d{4}\s+)?(remaster(ed)?|live|en directo|mono|stereo|radio edit|single version|bonus track|explicit)[^)\]]*[)\]]/gi, '')
    .trim();
}
const norm = v =>
  clean(v)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

// De varios resultados: mismo artista y título, preferir sincronizada y duración cercana.
export function pickBest(items, { artist = '', title = '', duration = 0 } = {}) {
  const a = norm(artist),
    t = norm(simplifyTitle(title));
  const scored = (items || [])
    .filter(x => x && (x.syncedLyrics || x.plainLyrics || x.instrumental))
    .map(x => {
      const xa = norm(x.artistName),
        xt = norm(simplifyTitle(x.trackName));
      let s = 0;
      if (t && xt === t) s += 40;
      else if (t && (xt.includes(t) || t.includes(xt))) s += 20;
      else s -= 30;
      if (a && (xa === a || xa.includes(a) || a.includes(xa))) s += 30;
      else if (a) s -= 20;
      if (x.syncedLyrics) s += 15;
      if (duration && x.duration) {
        const d = Math.abs(x.duration - duration);
        s += d <= 2 ? 15 : d <= 5 ? 8 : d <= 15 ? 0 : -15;
      }
      return { x, s };
    })
    .sort((p, q) => q.s - p.s);
  return scored[0] && scored[0].s >= 30 ? scored[0].x : null;
}
function shape(x) {
  if (!x) return { found: false };
  return {
    found: true,
    id: x.id,
    trackName: x.trackName || '',
    artistName: x.artistName || '',
    albumName: x.albumName || '',
    duration: Number(x.duration) || 0,
    instrumental: !!x.instrumental,
    synced: x.syncedLyrics || '',
    plain: x.plainLyrics || '',
    source: 'lrclib'
  };
}
async function lrclib(path, params) {
  const u = new URL(BASE + path);
  Object.entries(params || {}).forEach(([k, v]) => v !== '' && v != null && u.searchParams.set(k, String(v)));
  const key = u.toString();
  const c = cache.get(key);
  if (c && Date.now() - c.t < TTL) return c.v;
  const r = await safeFetch(key, { headers: { 'User-Agent': UA, 'Lrclib-Client': UA, Accept: 'application/json' } }, { allowFirstHost: h => h === 'lrclib.net', timeoutMs: 9000 });
  let v = null;
  if (r.status === 404) v = null;
  else if (!r.ok) throw Object.assign(new Error('LRCLIB no responde (' + r.status + ')'), { status: 502 });
  else v = JSON.parse(new TextDecoder().decode(await readLimited(r, 3_000_000)));
  cache.set(key, { t: Date.now(), v });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return v;
}

export default async function handler(req, res) {
  if (rateLimited(req, res, 'lyrics', 90)) return;
  try {
    const u = new URL(req.url, 'http://localhost');
    const q = k => clean(u.searchParams.get(k));
    const id = q('id').replace(/\D/g, '');
    const artist = q('artist'),
      title = q('title'),
      album = q('album');
    const duration = Math.round(Number(q('duration')) || 0);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (id) return res.status(200).json(shape(await lrclib('/get/' + id)));
    if (!title) return res.status(400).json({ error: 'Falta el título' });
    if (u.searchParams.get('search') === '1') {
      const lists = await Promise.all([
        lrclib('/search', { track_name: simplifyTitle(title), artist_name: artist }),
        artist ? lrclib('/search', { q: `${artist} ${simplifyTitle(title)}` }) : null
      ]);
      const seen = new Set();
      const items = lists
        .flat()
        .filter(x => x && !seen.has(x.id) && seen.add(x.id))
        .slice(0, 40)
        .map(x => ({
          id: x.id,
          trackName: x.trackName,
          artistName: x.artistName,
          albumName: x.albumName,
          duration: x.duration,
          instrumental: !!x.instrumental,
          hasSynced: !!x.syncedLyrics,
          hasPlain: !!x.plainLyrics
        }));
      return res.status(200).json({ items });
    }
    // 1) Firma exacta (artista, título, álbum y duración), 2) sin álbum, 3) búsqueda.
    let hit = null;
    if (artist && album && duration) hit = await lrclib('/get', { artist_name: artist, track_name: title, album_name: album, duration });
    if (!hit && artist) {
      const found = await lrclib('/search', { track_name: simplifyTitle(title), artist_name: artist });
      hit = pickBest(found, { artist, title, duration });
    }
    if (!hit) {
      const found = await lrclib('/search', { q: `${artist} ${simplifyTitle(title)}`.trim() });
      hit = pickBest(found, { artist, title, duration });
    }
    return res.status(200).json(shape(hit));
  } catch (e) {
    return res.status(e.status || 502).json({ error: e.message || 'No se pudo buscar la letra' });
  }
}
