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
import crypto from 'node:crypto';
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
    const langs = await Promise.all(batch.map(it => (it.language ? it.language : feedLanguage(it.feedUrl, deadline))));
    batch.forEach((it, k) => {
      const l = langs[k];
      // Idioma desconocido: se acepta solo si el país de la tienda habla ese idioma.
      const ok = l ? langMatches(l, wanted) : STORE_LANG[it.storefront] === wanted;
      if (ok) out.push({ ...it, language: l || wanted });
    });
  }
  return out.slice(0, limit);
}

// --- Otros catálogos (búsqueda con texto) -------------------------------------
// fyyd: abierto, sin clave. Podcast Index: clave gratuita (api.podcastindex.org) en
// las variables de entorno de Vercel PODCASTINDEX_KEY y PODCASTINDEX_SECRET.
const PI_KEY = process.env.PODCASTINDEX_KEY || '';
const PI_SECRET = process.env.PODCASTINDEX_SECRET || '';
export function availableSources() {
  return ['apple', 'fyyd', ...(PI_KEY && PI_SECRET ? ['podcastindex'] : [])];
}
// Nombres de categoría en inglés (Podcast Index usa los de Apple en inglés).
const GENRE_EN = {
  Arte: ['arts', 'books', 'design', 'fashion', 'food', 'performing', 'visual'],
  Negocios: ['business', 'careers', 'entrepreneurship', 'investing', 'management', 'marketing'],
  Comedia: ['comedy', 'improv', 'stand-up'],
  'Crímenes reales': ['true crime'],
  Educación: ['education', 'courses', 'how to', 'language', 'learning', 'self-improvement'],
  Ficción: ['fiction', 'drama', 'science fiction', 'comedy fiction'],
  Gobierno: ['government'],
  Salud: ['health', 'fitness', 'alternative', 'medicine', 'mental', 'nutrition', 'sexuality'],
  Historia: ['history'],
  'Niños y familia': ['kids', 'family', 'parenting', 'pets', 'stories for kids'],
  Música: ['music'],
  Noticias: ['news', 'politics', 'daily news', 'business news', 'tech news', 'sports news', 'entertainment news'],
  'Religión y espiritualidad': ['religion', 'spirituality', 'christianity', 'buddhism', 'islam', 'judaism', 'hinduism'],
  Ciencia: ['science', 'astronomy', 'chemistry', 'earth', 'life', 'mathematics', 'natural', 'nature', 'physics', 'social sciences'],
  'Sociedad y cultura': ['society', 'culture', 'documentary', 'personal journals', 'philosophy', 'places', 'travel', 'relationships'],
  Deportes: ['sports', 'football', 'soccer', 'basketball', 'baseball', 'cricket', 'golf', 'hockey', 'rugby', 'running', 'tennis', 'wrestling', 'fantasy', 'swimming', 'wilderness', 'volleyball'],
  Tecnología: ['technology'],
  'TV y cine': ['tv', 'film', 'after shows', 'reviews'],
  Ocio: ['leisure', 'animation', 'manga', 'automotive', 'aviation', 'crafts', 'games', 'hobbies', 'home', 'garden', 'video games']
};
function genreOkByNames(names, genre) {
  if (!GENRES[genre]) return true;
  const want = GENRE_EN[genre] || [];
  const ns = names.map(n => String(n).toLowerCase());
  return ns.some(n => want.some(w => n.includes(w)));
}
function shortLang(l) {
  return norm(l).split(' ')[0];
}
async function searchFyyd(term, language) {
  // Solo por título: con «term» (que se combina con OR) fyyd devuelve resultados sin
  // relación con lo buscado.
  const p = new URLSearchParams({ title: term, count: '50' });
  if (language) p.set('langauge', language); // así, con la errata de su API
  const d = await getJson('https://api.fyyd.de/0.2/search/podcast?' + p, 5000);
  return (Array.isArray(d?.data) ? d.data : [])
    .filter(x => x?.title && x?.xmlURL)
    .map((x, i) => ({
      id: 'fyyd:' + x.id,
      title: clean(x.title),
      author: clean(x.author || x.subtitle || ''),
      artwork: x.imgURL || x.layoutImageURL || x.thumbImageURL || '',
      feedUrl: clean(x.xmlURL),
      webUrl: clean(x.htmlURL || x.url_fyyd),
      description: clean(x.description).slice(0, 600),
      genre: '',
      genres: [],
      genreIds: [],
      episodeCount: Number(x.episode_count || 0),
      latestEpisodeAt: x.lastpub || '',
      language: shortLang(x.language),
      pos: i,
      source: 'fyyd'
    }));
}
async function searchPodcastIndex(term) {
  if (!PI_KEY || !PI_SECRET) return [];
  const now = String(Math.floor(Date.now() / 1000));
  const auth = crypto.createHash('sha1').update(PI_KEY + PI_SECRET + now).digest('hex');
  const r = await fetch('https://api.podcastindex.org/api/1.0/search/byterm?' + new URLSearchParams({ q: term, max: '60' }), {
    headers: { 'User-Agent': 'RadiosViferor/1.14', 'X-Auth-Key': PI_KEY, 'X-Auth-Date': now, Authorization: auth },
    signal: AbortSignal.timeout(5000)
  });
  if (!r.ok) throw new Error('Podcast Index HTTP ' + r.status);
  const d = await r.json();
  return (Array.isArray(d?.feeds) ? d.feeds : [])
    .filter(x => x?.title && x?.url && !x.dead)
    .map((x, i) => {
      const cats = x.categories && typeof x.categories === 'object' ? Object.values(x.categories) : [];
      return {
        id: 'pi:' + x.id,
        title: clean(x.title),
        author: clean(x.author || x.ownerName || ''),
        artwork: x.artwork || x.image || '',
        feedUrl: clean(x.url),
        webUrl: clean(x.link),
        description: clean(x.description).slice(0, 600),
        genre: cats[0] || '',
        genres: cats,
        genreIds: [],
        episodeCount: Number(x.episodeCount || 0),
        latestEpisodeAt: x.newestItemPubdate ? new Date(x.newestItemPubdate * 1000).toISOString() : '',
        language: shortLang(x.language),
        pos: i,
        source: 'podcastindex'
      };
    });
}
function feedKey(u) {
  return String(u || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
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
    if (u.searchParams.get('info') === '1') return res.status(200).json({ sources: availableSources() });
    let source = clean(u.searchParams.get('source') || 'all').toLowerCase();
    if (!['all', 'apple', 'fyyd', 'podcastindex'].includes(source)) source = 'all';
    if (source === 'podcastindex' && !availableSources().includes('podcastindex'))
      return res.status(200).json({ items: [], error: 'Podcast Index no está configurado', sources: availableSources() });
    let stores = country === 'ALL' ? ALL_STORES : ALL_STORES.includes(country) ? [country] : ['ES'];
    // Con idioma y «todos los países», solo las tiendas de ese idioma (si las hay).
    if (country === 'ALL' && language) {
      const same = stores.filter(s => STORE_LANG[s] === language);
      if (same.length) stores = same;
    }
    // Las populares solo existen en Apple.
    if (mode === 'popular') source = 'apple';
    const key = [mode, source, norm(term), genre, stores.join(','), language, limit].join('|');
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
      const useApple = source === 'all' || source === 'apple';
      const useFyyd = source === 'all' || source === 'fyyd';
      const usePI = (source === 'all' || source === 'podcastindex') && availableSources().includes('podcastindex');
      const appleLists = useApple
        ? Promise.all(
            stores.map(async s => {
              try {
                const p = new URLSearchParams({ term, country: s, media: 'podcast', entity: 'podcast', limit: '200' });
                const d = await getJson('https://itunes.apple.com/search?' + p);
                return (d.results || []).map((x, i) => ({ ...mapItem(x, s), pos: i, source: 'apple' }));
              } catch {
                return [];
              }
            })
          )
        : Promise.resolve([]);
      const [apple, fyyd, pi] = await Promise.all([
        appleLists,
        useFyyd ? searchFyyd(term, language).catch(() => []) : [],
        usePI ? searchPodcastIndex(term).catch(() => []) : []
      ]);
      // Fusión: el mismo podcast (mismo feed, o mismo título y autor) en varios
      // catálogos cuenta una vez, con los datos combinados (Apple primero).
      const merged = new Map();
      const keyOf = it => feedKey(it.feedUrl) || 't:' + norm(it.title) + '|' + norm(it.author);
      for (const it of [...apple.flat(), ...pi, ...fyyd]) {
        if (!it.title || !it.feedUrl) continue;
        const okGenre = it.source === 'apple' ? genreOk(it, genre) : it.source === 'podcastindex' ? genreOkByNames(it.genres, genre) : !GENRES[genre];
        const k = keyOf(it);
        const prev = merged.get(k);
        if (prev) {
          prev.sources.add(it.source);
          prev.pos = Math.min(prev.pos, it.pos);
          for (const f of ['artwork', 'author', 'description', 'language', 'latestEpisodeAt', 'webUrl'])
            if (!prev[f] && it[f]) prev[f] = it[f];
          prev.episodeCount = Math.max(prev.episodeCount || 0, it.episodeCount || 0);
          prev.okGenre = prev.okGenre || okGenre;
        } else merged.set(k, { ...it, sources: new Set([it.source]), okGenre });
      }
      items = [...merged.values()]
        .filter(it => it.okGenre)
        // Relevancia del texto + posición en su catálogo (refleja popularidad) +
        // trayectoria (número de episodios) + aparecer en varios catálogos.
        .map(it => ({
          it,
          s:
            Math.min(relevance(it, term), 90) * 0.6 +
            Math.max(0, 40 - it.pos * 0.4) +
            Math.min(20, Math.log2((it.episodeCount || 0) + 1) * 2.2) +
            (it.sources.size - 1) * 6
        }))
        .filter(o => relevance(o.it, term) > 0 || o.it.source === 'apple')
        .sort((a, b) => b.s - a.s)
        .map(o => {
          const { sources, okGenre, ...rest } = o.it;
          return { ...rest, sources: [...sources] };
        });
    }
    // Apple a veces tiene el mismo podcast con dos identificadores (o dos URLs de
    // feed): se deja solo el primero (el mejor situado) por título + autor y por feed.
    {
      const seenTA = new Set(),
        seenFeed = new Set();
      items = items.filter(it => {
        const ta = norm(it.title) + '|' + norm(it.author);
        const fd = String(it.feedUrl || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
        if (seenTA.has(ta) || (fd && seenFeed.has(fd))) return false;
        seenTA.add(ta);
        if (fd) seenFeed.add(fd);
        return true;
      });
    }
    items = await filterLanguage(items, language, limit, deadline);
    const data = {
      items: items.map(({ pos, stores: _s, ...rest }) => ({ ...rest, sources: rest.sources || ['apple'] })),
      sources: availableSources(),
      source,
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
