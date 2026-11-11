// Artistas parecidos (para la «radio» de una canción).
//
//   GET /api/similar?artist=Nombre  → { artist, artists:[nombres…], via }
//
// Fuente: ListenBrainz (datos abiertos de escuchas; sin clave), buscando antes el
// artista en MusicBrainz. Si falla, se prueba con los «relacionados» de Deezer.
// La app los cruza con la música del móvil; si no hay nada, la radio se hace solo con
// lo que hay en la biblioteca (artista, género, año…).
import { safeFetch, rateLimited, readLimited } from './_lib/net.js';

const UA = 'RadiosViferor/1.0 (https://radiosviferor.vercel.app)';
const LB_ALGO = 'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30';
const cache = globalThis.__similarCache || (globalThis.__similarCache = new Map());
const TTL = 24 * 3600 * 1000;
const norm = v =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

async function getJson(url, host) {
  const r = await safeFetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } }, { allowFirstHost: h => h === host, timeoutMs: 7000 });
  if (!r.ok) throw Object.assign(new Error(host + ' ' + r.status), { status: 502 });
  return JSON.parse(new TextDecoder().decode(await readLimited(r, 2_000_000)) || 'null');
}

async function viaListenBrainz(name) {
  const key = norm(name);
  const q = encodeURIComponent(`artist:"${name.replace(/"/g, '')}"`);
  const mb = await getJson(`https://musicbrainz.org/ws/2/artist/?query=${q}&fmt=json&limit=8`, 'musicbrainz.org');
  const list = mb?.artists || [];
  const hit = list.find(a => norm(a.name) === key && (a.score ?? 100) >= 80) || list.find(a => (a.aliases || []).some(x => norm(x.name) === key)) || (list[0]?.score >= 95 ? list[0] : null);
  if (!hit) return null;
  const d = await getJson(`https://labs.api.listenbrainz.org/similar-artists/json?artist_mbids=${hit.id}&algorithm=${LB_ALGO}`, 'labs.api.listenbrainz.org');
  const rows = (Array.isArray(d) ? d.flat(2) : d?.data || []).filter(x => x && typeof x === 'object' && x.name);
  rows.sort((a, b) => (b.score || 0) - (a.score || 0));
  const self = norm(hit.name);
  const names = [...new Set(rows.map(x => x.name).filter(n => norm(n) !== self))];
  return { artist: hit.name, artists: names.slice(0, 80), via: 'listenbrainz' };
}

async function viaDeezer(name) {
  const key = norm(name);
  const s = await getJson('https://api.deezer.com/search/artist?limit=5&q=' + encodeURIComponent(name), 'api.deezer.com');
  const hit = (s?.data || []).find(a => norm(a.name) === key) || s?.data?.[0];
  if (!hit) return null;
  const rel = await getJson(`https://api.deezer.com/artist/${hit.id}/related`, 'api.deezer.com');
  return { artist: hit.name, artists: (rel?.data || []).map(a => a.name).filter(Boolean).slice(0, 60), via: 'deezer' };
}

export async function similarArtists(name) {
  const key = norm(name);
  if (!key) return { artist: '', artists: [], via: 'none' };
  const c = cache.get(key);
  if (c && Date.now() - c.t < TTL) return c.v;
  let v = null;
  for (const f of [viaListenBrainz, viaDeezer]) {
    try {
      const r = await f(name);
      if (r?.artists?.length) {
        v = r;
        break;
      }
      if (r && !v) v = r;
    } catch {}
  }
  v = v || { artist: '', artists: [], via: 'none' };
  if (v.artists.length || v.artist) cache.set(key, { t: Date.now(), v });
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
    res.setHeader('Cache-Control', v.artists.length ? 'public, max-age=86400, s-maxage=86400' : 'public, max-age=600');
    return res.status(200).json(v);
  } catch (e) {
    return res.status(e.status || 502).json({ error: e.message || 'No se pudieron buscar artistas parecidos' });
  }
}
