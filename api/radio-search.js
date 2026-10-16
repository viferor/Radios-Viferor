// Búsqueda de emisoras españolas por nombre en radio-browser.info: complementa al
// catálogo principal (TDTChannels + catálogo local) con emisoras pequeñas o locales
// que no están en él. Uso: /api/radio-search?q=texto
import { rateLimited } from './_lib/net.js';

const MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info'
];

async function query(base, params) {
  const r = await fetch(`${base}/json/stations/search?${params}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'RadiosViferor/1.8' },
    signal: AbortSignal.timeout(5000)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

export default async function handler(req, res) {
  if (rateLimited(req, res, 'radio-search', 120)) return;
  const q = String(req.query?.q || '').trim().slice(0, 80);
  if (q.length < 2) return res.status(400).json({ error: 'Escribe al menos 2 letras' });
  // radio-browser busca el texto tal cual dentro del nombre: se usa la palabra más
  // significativa (la más larga), con y sin acentos, y la web filtra el resto.
  const OPTIONAL = new Set(['radio', 'fm', 'emisora', 'cadena', 'de', 'la', 'el', 'los', 'las', 'del']);
  const words = q.split(/\s+/).filter(w => w && !OPTIONAL.has(w.toLowerCase()));
  const main = (words.length ? words : [q]).sort((a, b) => b.length - a.length)[0];
  const plain = main.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const terms = [...new Set([main, plain])];
  const paramsFor = name =>
    new URLSearchParams({ name, countrycode: 'ES', hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: '80' });
  for (const base of MIRRORS) {
    try {
      const lists = await Promise.all(terms.map(t => query(base, paramsFor(t))));
      const seen = new Set();
      const data = lists.flat().filter(x => x?.stationuuid && !seen.has(x.stationuuid) && seen.add(x.stationuuid));
      const stations = (Array.isArray(data) ? data : [])
        .filter(x => x?.name && (x.url_resolved || x.url))
        .map(x => ({
          uuid: x.stationuuid,
          stationuuid: x.stationuuid,
          name: String(x.name).trim(),
          state: x.state || '',
          city: '',
          network: '',
          tags: x.tags || '',
          logo: x.favicon || '',
          web: x.homepage || '',
          url: x.url || '',
          url_resolved: x.url_resolved || '',
          options: x.url_resolved ? [{ format: (x.codec || 'stream').toLowerCase(), url: x.url_resolved }] : [],
          source: 'radio-browser'
        }));
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json({ stations });
    } catch {}
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(502).json({ error: 'radio-browser no disponible', stations: [] });
}
