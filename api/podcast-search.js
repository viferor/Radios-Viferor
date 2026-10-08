// Búsqueda y populares de podcasts (catálogo de Apple Podcasts).
//
// Parámetros: q, genre (nombre en español; «Todas» = sin filtro), country (ES, US, GB,
// MX, AR o ALL), language ('' o es/en/fr/de/it/pt/ca), mode (search | popular), limit.
//
// - Sin texto (o «Más populares»): ranking real de Apple por país y categoría
//   (rss/toppodcasts, formato feed.entry) completado con /lookup para obtener el feed.
// - Con texto: búsqueda de Apple, filtro estricto por categoría (Apple ignora el
//   parámetro de categoría en las búsquedas) y orden por relevancia.
// - Idioma: Apple no lo da; se lee la etiqueta <language> del principio del feed.
import { safeFetch, rateLimited } from './_lib/net.js';

const cache = globalThis.__podcastSearchCache || (globalThis.__podcastSearchCache = new Map());
const langCache = globalThis.__podcastLangCache || (globalThis.__podcastLangCache = new Map());

export const GENRES = {
  Todas: '',
  Arte: '1301',
  Negocios: '1321',
  Comedia: '1303',
  'Crímenes reales': '1488',
  Educación: '1304',
  Ficción: '1483',
  Gobierno: '1511',
  Salud: '1512',
  Historia: '1487',
  'Niños y familia': '1305',
  Música: '1310',
  Noticias: '1489',
  'Religión y espiritualidad': '1314',
  Ciencia: '1533',
  'Sociedad y cultura': '1324',
  Deportes: '1545',
  Tecnología: '1318',
  'TV y cine': '1309',
  Ocio: '1502'
};
// Comprobado contra Apple: Religión es 1314 (1437 no existe y devolvía Deportes) y
// Ocio es 1502 (1320 es «Lugares y viajes»).
const GENRE_EXTRA_IDS = {};
const STORE_LANG = { ES: 'es', MX: 'es', AR: 'es', US: 'en', GB: 'en' };
const ALL_STORES = ['ES', 'MX', 'AR', 'US', 'GB'];
const LANG_OK = {
  es: ['es', 'spa', 'spanish', 'espanol', 'castellano'],
  en: ['en', 'eng', 'english'],
  fr: ['fr', 'fra', 'fre', 'french', 'francais'],
  de: ['de', 'deu', 'ger', 'german', 'deutsch'],
  it: ['it', 'ita', 'italian', 'italiano'],
  pt: ['pt', 'por', 'portuguese', 'portugues'],
  ca: ['ca', 'cat', 'catalan', 'catala']
};
const TIME_BUDGET_MS = 7500;

function clean(x) {
  return String(x ?? '').trim();
}
function norm(v) {
  return clean(v)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
async function getJson(url, ms = 6000) {
  const r = await fetch(url, { headers: { 'User-Agent': 'RadiosViferor/podcasts' }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

function mapItem(x, store) {
  const gs = Array.isArray(x.genres)
    ? x.genres.map(g => clean(typeof g === 'string' ? g : g?.name || '')).filter(Boolean)
    : [];
  return {
    id: String(x.collectionId || x.trackId || ''),
    title: clean(x.collectionName || x.trackName),
    author: clean(x.artistName),
    artwork: x.artworkUrl600 || x.artworkUrl100 || '',
    feedUrl: clean(x.feedUrl),
    webUrl: clean(x.collectionViewUrl || x.trackViewUrl),
    genre: clean(x.primaryGenreName || gs[0] || ''),
    genres: gs,
    genreIds: Array.isArray(x.genreIds) ? x.genreIds.map(String) : [],
    episodeCount: Number(x.trackCount || 0),
    releaseDate: x.releaseDate || '',
    latestEpisodeAt: x.releaseDate || '',
    storefront: store
  };
}

function genreOk(item, genre) {
  const gid = GENRES[genre];
  if (!gid) return true;
  const ids = [gid, ...(GENRE_EXTRA_IDS[genre] || [])];
  return item.genreIds.some(id => ids.includes(id));
}

// Relevancia respecto al texto buscado.
function relevance(item, q) {
  const qn = norm(q);
  if (!qn) return 0;
  const title = norm(item.title),
    author = norm(item.author);
  const toks = qn.split(' ').filter(t => t.length > 1 || /\d/.test(t));
  let s = 0;
  if (title === qn) s += 100;
  else if (title.startsWith(qn)) s += 60;
  else if (title.includes(qn)) s += 40;
  if (author === qn) s += 50;
  else if (author.includes(qn)) s += 25;
  const tw = new Set(title.split(' ')),
    aw = new Set(author.split(' '));
  let inTitle = 0;
  for (const t of toks) {
    if (tw.has(t)) (s += 12), inTitle++;
    else if ([...tw].some(w => w.startsWith(t))) (s += 7), inTitle++;
    else if (aw.has(t) || [...aw].some(w => w.startsWith(t))) s += 6;
  }
  if (toks.length && inTitle === toks.length) s += 15;
  return s;
}

// --- Idioma del feed (primeros KB) --------------------------------------------
async function feedLanguage(feedUrl, deadline) {
  const url = clean(feedUrl);
  if (!url) return '';
  const hit = langCache.get(url);
  if (hit && Date.now() - hit.t < 7 * 86400000) return hit.lang;
  const left = deadline - Date.now();
  if (left < 400) return null; // sin tiempo: desconocido
  let lang = '';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Math.min(3000, left));
  try {
    const r = await safeFetch(url, { headers: { 'User-Agent': 'RadiosViferor/podcasts', Range: 'bytes=0-24575' }, signal: ctl.signal });
    if (r.ok || r.status === 206) {
      const reader = r.body.getReader();
      let text = '';
      const dec = new TextDecoder('utf-8', { fatal: false });
      while (text.length < 24576) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
        const m = text.match(/<(?:language|dc:language)\s*>\s*([^<\s]+)\s*</i);
        if (m) {
          lang = norm(m[1]).split(' ')[0];
          break;
        }
        if (/<item[\s>]/i.test(text)) break; // la etiqueta va antes del primer episodio
      }
      try {
        await reader.cancel();
      } catch {}
    }
  } catch {
    clearTimeout(timer);
    return null;
  }
  clearTimeout(timer);
  langCache.set(url, { t: Date.now(), lang });
  if (langCache.size > 5000) langCache.delete(langCache.keys().next().value);
  return lang;
}
function langMatches(lang, wanted) {
  const ok = LANG_OK[wanted] || [wanted];
  return ok.some(a => lang === a || lang.startsWith(a + ' ') || lang.startsWith(a + '-'));
}
// Filtra por idioma manteniendo el orden; para cuando ya hay `limit` resultados.
async function filterLanguage(items, wanted, limit, deadline) {
  if (!wanted) return items.slice(0, limit);
  const out = [];
  const CONC = 12;
  for (let i = 0; i < items.length && out.length < limit && Date.now() < deadline; i += CONC) {
    const batch = items.slice(i, i + CONC);
    const langs = await Promise.all(batch.map(it => feedLanguage(it.feedUrl, deadline)));
    batch.forEach((it, k) => {
      const l = langs[k];
      // Idioma desconocido: se acepta solo si el país de la tienda habla ese idioma.
      const ok = l ? langMatches(l, wanted) : STORE_LANG[it.storefront] === wanted;
      if (ok) out.push({ ...it, language: l || wanted });
    });
  }
  return out.slice(0, limit);
}

// --- Rankings (populares) --------------------------------------------------
async function topChart(store, gid) {
  const url = `https://itunes.apple.com/${store.toLowerCase()}/rss/toppodcasts/limit=100${gid ? `/genre=${gid}` : ''}/json`;
  const d = await getJson(url);
  const entries = Array.isArray(d?.feed?.entry) ? d.feed.entry : d?.feed?.entry ? [d.feed.entry] : [];
  return entries.map((e, i) => ({ id: String(e?.id?.attributes?.['im:id'] || ''), rank: i, store })).filter(x => x.id);
}
async function lookup(ids, store) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    try {
      const d = await getJson(`https://itunes.apple.com/lookup?id=${chunk.join(',')}&entity=podcast&country=${store}`);
      for (const x of d.results || []) if (x.collectionId) out.set(String(x.collectionId), x);
    } catch {}
  }
  return out;
}

export default async function handler(req, res) {
  if (rateLimited(req, res, 'podcast-search', 120)) return;
  const started = Date.now();
  const deadline = started + TIME_BUDGET_MS;
  try {
    const u = new URL(req.url, 'http://localhost');
    const term = clean(u.searchParams.get('q')).slice(0, 100);
    let mode = u.searchParams.get('mode') === 'popular' ? 'popular' : 'search';
    if (!term) mode = 'popular'; // sin texto: navegar por categoría = sus populares
    const country = clean(u.searchParams.get('country') || 'ES').toUpperCase();
    const language = clean(u.searchParams.get('language')).toLowerCase();
    let genre = clean(u.searchParams.get('genre'));
    if (!(genre in GENRES)) genre = 'Todas';
    const limit = Math.min(100, Math.max(1, Number(u.searchParams.get('limit') || 60)));
    let stores = country === 'ALL' ? ALL_STORES : ALL_STORES.includes(country) ? [country] : ['ES'];
    // Con idioma y «todos los países», solo las tiendas de ese idioma (si las hay).
    if (country === 'ALL' && language) {
      const same = stores.filter(s => STORE_LANG[s] === language);
      if (same.length) stores = same;
    }
    const key = [mode, norm(term), genre, stores.join(','), language, limit].join('|');
    const cached = cache.get(key);
    if (cached && Date.now() - cached.t < 1800000) {
      res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
      return res.status(200).json(cached.data);
    }

    let items = [];
    if (mode === 'popular') {
      const gid = GENRES[genre] || '';
      const charts = await Promise.all(stores.map(s => topChart(s, gid).catch(() => [])));
      // Mezcla por puesto: 1.º de cada país, luego 2.º… sin repetir.
      const merged = [],
        seen = new Set();
      for (let r = 0; r < 100; r++)
        for (const c of charts) {
          const e = c[r];
          if (e && !seen.has(e.id)) seen.add(e.id), merged.push(e);
        }
      // Detalles (URL del feed, portada…) consultados en la tienda de cada ranking.
      const details = new Map();
      await Promise.all(
        stores.map(async st => {
          const m = await lookup(merged.filter(e => e.store === st).map(e => e.id), st);
          m.forEach((v, k) => details.set(k, v));
        })
      );
      items = merged
        .map(e => (details.get(e.id) ? { ...mapItem(details.get(e.id), e.store), rank: e.rank + 1 } : null))
        .filter(x => x && x.feedUrl && genreOk(x, genre));
      if (term) {
        items = items
          .map(x => ({ x, s: relevance(x, term) }))
          .filter(o => o.s > 0)
          .sort((a, b) => b.s - a.s)
          .map(o => o.x);
      }
    } else {
      const lists = await Promise.all(
        stores.map(async s => {
          try {
            const p = new URLSearchParams({ term, country: s, media: 'podcast', entity: 'podcast', limit: '200' });
            const d = await getJson('https://itunes.apple.com/search?' + p);
            return (d.results || []).map((x, i) => ({ ...mapItem(x, s), pos: i }));
          } catch {
            return [];
          }
        })
      );
      const byId = new Map();
      for (const it of lists.flat()) {
        if (!it.title || !it.feedUrl || !genreOk(it, genre)) continue;
        const prev = byId.get(it.id);
        if (prev) {
          prev.stores++;
          prev.pos = Math.min(prev.pos, it.pos);
        } else byId.set(it.id, { ...it, stores: 1 });
      }
      items = [...byId.values()]
        .map(it => ({ it, s: relevance(it, term) + Math.max(0, 20 - it.pos / 5) + (it.stores - 1) * 5 }))
        .sort((a, b) => b.s - a.s)
        .map(o => o.it);
    }
    items = await filterLanguage(items, language, limit, deadline);
    const data = {
      items: items.map(({ pos, stores: _s, ...rest }) => rest),
      mode,
      query: term,
      genre,
      country,
      language,
      partial: Date.now() >= deadline
    };
    // Si se agotó el tiempo del filtro de idioma, no se guarda en caché (resultado parcial).
    if (!data.partial) {
      cache.set(key, { t: Date.now(), data });
      if (cache.size > 300) cache.delete(cache.keys().next().value);
    }
    res.setHeader('Cache-Control', data.partial ? 'no-store' : 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json(data);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'No se pudo consultar el catálogo de podcasts', detail: e.message });
  }
}
