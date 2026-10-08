import { safeFetch, rateLimited, HttpError } from './_lib/net.js';
const TIMEOUT_MS = 7000;
const RB_MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info'
];
function clean(v) {
  return String(v || '')
    .replace(/\0/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function decodeLatin1(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  try {
    return decodeURIComponent(escape(s));
  } catch {
    return s;
  }
}
function parseIcy(buf) {
  const text = decodeLatin1(buf);
  // Admite apóstrofos dentro del título (p. ej. «Guns N' Roses - Sweet Child O' Mine»).
  const m =
    text.match(/StreamTitle='([\s\S]*?)';(?=\s*(?:Stream\w+=|$|\0))/i) ||
    text.match(/StreamTitle='([^']*)';/i) ||
    text.match(/StreamTitle="([^"]*)";/i);
  return clean(m?.[1] || '');
}

function normText(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
// Textos que las emisoras envían en lugar de una canción.
const JUNK = /\b(publicidad|anuncio|anuncios|advert|commercial|cuña|cunas|jingle|promo|separador|indicativo|en directo|live|unknown|desconocido)\b/i;
// Separa «Artista - Título». Devuelve null si el texto no parece una canción
// (vacío, el nombre de la emisora, publicidad…).
export function parseSong(raw, ...stationNames) {
  let s = clean(raw).replace(/^["'«]+|["'»]+$/g, '');
  if (!s || s.length < 3 || /^[-\s.]+$/.test(s) || JUNK.test(s)) return null;
  const n = normText(s);
  for (const st of stationNames) {
    const sn = normText(st);
    if (sn && (n === sn || n.replace(/\s/g, '') === sn.replace(/\s/g, ''))) return null;
  }
  const parts = s.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) {
    const artist = clean(parts[0]),
      title = clean(parts.slice(1).join(' - '));
    if (artist && title && !stationNames.some(st => normText(st) && normText(artist) === normText(st)))
      return { artist, title, text: `${artist} - ${title}` };
    if (title) return { artist: '', title, text: title };
  }
  return { artist: '', title: s, text: s };
}

// Carátula de la canción (iTunes). Caché en memoria para no repetir búsquedas.
const covers = globalThis.__rvCovers || (globalThis.__rvCovers = new Map());
async function coverFor(artist, title) {
  if (!artist || !title) return '';
  const k = normText(artist + ' ' + title);
  const hit = covers.get(k);
  if (hit && Date.now() - hit.t < 86400000) return hit.url;
  let url = '';
  try {
    const q = new URLSearchParams({ term: `${artist} ${title}`, media: 'music', entity: 'song', limit: '5', country: 'ES' });
    const r = await fetch('https://itunes.apple.com/search?' + q, { signal: AbortSignal.timeout(2500) });
    if (r.ok) {
      const d = await r.json();
      const na = normText(artist);
      const best =
        (d.results || []).find(x => normText(x.artistName).includes(na.split(' ')[0] || na)) || (d.results || [])[0];
      if (best?.artworkUrl100) url = best.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.');
    }
  } catch {}
  covers.set(k, { t: Date.now(), url });
  if (covers.size > 800) covers.delete(covers.keys().next().value);
  return url;
}
async function radioBrowserSong(name, state, stationuuid, url) {
  for (const base of RB_MIRRORS) {
    try {
      if (stationuuid) {
        const r = await fetch(`${base}/json/stations/byuuid/${encodeURIComponent(stationuuid)}`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(3500)
        });
        if (r.ok) {
          const a = await r.json();
          const x = a?.[0];
          if (x?.songtitle) return { song: clean(x.songtitle), stationuuid: x.stationuuid || stationuuid };
        }
      }
    } catch {}
    try {
      const q = new URLSearchParams({
        countrycode: 'ES',
        countrycodeexact: 'true',
        hidebroken: 'true',
        limit: '20'
      });
      if (name) q.set('name', name);
      if (state) q.set('state', state);
      if (url) q.set('url', url);
      const r = await fetch(`${base}/json/stations/search?${q}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4500)
      });
      if (!r.ok) continue;
      const a = await r.json();
      const nl = String(name || '')
        .toLowerCase()
        .trim();
      const exact =
        a.find(
          x =>
            nl &&
            String(x.name || '')
              .toLowerCase()
              .trim() === nl
        ) ||
        a.find(x => stationuuid && x.stationuuid === stationuuid) ||
        a[0];
      if (exact?.songtitle)
        return { song: clean(exact.songtitle), stationuuid: exact.stationuuid || stationuuid || '' };
    } catch {}
  }
  return null;
}
export default async function handler(req, res) {
  if (rateLimited(req, res, 'metadata', 90)) return;
  const url = String(req.query?.url || '');
  const name = String(req.query?.name || '').trim();
  const state = String(req.query?.state || '').trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'URL no válida' });
  // El CDN guarda la respuesta 15 s por URL: todos los oyentes de una emisora
  // comparten una sola conexión al stream en lugar de abrir una cada uno.
  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let reader = null;
  try {
    // safeFetch valida la URL y cada redirección (no se permiten direcciones internas).
    const r = await safeFetch(url, {
      headers: { 'Icy-MetaData': '1', 'User-Agent': 'RadiosViferor/metadata' },
      signal: ctl.signal
    });
    const headers = {};
    for (const [k, v] of r.headers) headers[k.toLowerCase()] = v;
    const metaInt = Number(headers['icy-metaint'] || 0);
    const out = {
      song: '',
      title: clean(headers['icy-name'] || ''),
      bitrate: clean(headers['icy-br'] || '')
    };
    if (r.body) reader = r.body.getReader();
    if (metaInt > 0 && metaInt < 262144 && reader) {
      // Se lee hasta el byte de longitud y después el bloque de metadatos completo
      // (antes se cortaba si el bloque no había llegado entero).
      let data = new Uint8Array(0);
      let target = metaInt + 1;
      while (data.length < target) {
        const { value, done } = await reader.read();
        if (done) break;
        const merged = new Uint8Array(data.length + value.length);
        merged.set(data);
        merged.set(value, data.length);
        data = merged;
        if (data.length > metaInt && target === metaInt + 1) target = metaInt + 1 + data[metaInt] * 16;
      }
      if (data.length > metaInt) {
        const end = Math.min(data.length, metaInt + 1 + data[metaInt] * 16);
        out.song = parseIcy(data.slice(metaInt + 1, end));
      }
    }
    clearTimeout(timer);
    if (!out.song) {
      const rb = await radioBrowserSong(name, state, req.query?.stationuuid || '', url);
      if (rb) {
        out.song = rb.song;
        out.stationuuid = rb.stationuuid;
        out.source = 'radio-browser';
      }
    }
    // Artista, título y carátula por separado (la web y la notificación los muestran aparte).
    const song = parseSong(out.song, name, out.title);
    if (song) {
      out.song = song.text;
      out.artist = song.artist;
      out.track = song.title;
      out.cover = await coverFor(song.artist, song.title);
    } else {
      out.song = '';
    }
    return res.status(200).json(out);
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof HttpError && e.status === 400) return res.status(400).json({ error: e.message });
    return res.status(200).json({ song: '', error: e.name === 'AbortError' ? 'timeout' : 'metadata_unavailable' });
  } finally {
    // Cerrar siempre la conexión al stream (antes quedaba abierta si no había ICY).
    try {
      await reader?.cancel();
    } catch {}
    try {
      ctl.abort();
    } catch {}
  }
}
