const TDT_URL = 'https://www.tdtchannels.com/lists/radio.json';
const RB_MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info'
];
let tdtCache = null;
let tdtCacheAt = 0;

async function timedFetch(url, ms = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function norm(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function flattenTdt(root) {
  const out = [];
  for (const country of root?.countries || []) {
    if (norm(country.name) !== 'spain') continue;
    for (const ambit of country.ambits || []) {
      for (const ch of ambit.channels || []) {
        const options = (ch.options || [])
          .filter(o => o && o.url)
          .map(o => ({ format: o.format || 'stream', url: o.url }));
        if (options.length)
          out.push({
            name: ch.name,
            logo: ch.logo || '',
            epg_id: ch.epg_id || '',
            web: ch.web || '',
            options
          });
      }
    }
  }
  return out;
}
async function getTdt() {
  if (tdtCache && Date.now() - tdtCacheAt < 10 * 60 * 1000) return tdtCache;
  const root = await timedFetch(TDT_URL, 9000);
  tdtCache = flattenTdt(root);
  tdtCacheAt = Date.now();
  return tdtCache;
}
function score(target, candidate, state, network) {
  const a = norm(target),
    b = norm(candidate.name);
  let s = 0;
  if (a === b) s += 100;
  if (a && b.includes(a)) s += 35;
  if (a && a.includes(b)) s += 20;
  const n = norm(network);
  if (n && b.includes(n)) s += 25;
  return s;
}
async function radioBrowser(name, state, network) {
  for (const base of RB_MIRRORS) {
    try {
      const params = new URLSearchParams({
        countrycode: 'ES',
        countrycodeexact: 'true',
        hidebroken: 'true',
        limit: '30',
        order: 'clickcount',
        reverse: 'true'
      });
      if (name) params.set('name', name);
      if (state) params.set('state', state);
      const data = await timedFetch(`${base}/json/stations/search?${params}`, 5000);
      const arr = Array.isArray(data) ? data : [];
      const ranked = arr
        .map(x => ({ ...x, _score: score(name, x, state, network) }))
        .sort((a, b) => b._score - a._score);
      const good =
        ranked.find(x => (x.url_resolved || x.url) && x._score >= 35) ||
        ranked.find(x => x.url_resolved || x.url);
      if (good)
        return {
          name: good.name,
          logo: good.favicon || '',
          web: good.homepage || '',
          stationuuid: good.stationuuid || '',
          options: [{ format: (good.codec || 'stream').toLowerCase(), url: good.url_resolved || good.url }],
          source: 'radio-browser'
        };
    } catch (_) {}
  }
  return null;
}
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
  const q = req.query || {};
  const name = String(q.name || '').trim();
  const state = String(q.state || '').trim();
  const network = String(q.network || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    try {
      const tdt = await getTdt();
      const ranked = tdt
        .map(x => ({ ...x, _score: score(name, x, state, network) }))
        .sort((a, b) => b._score - a._score);
      const exact = ranked.find(x => x._score >= 100) || ranked.find(x => x._score >= 60);
      if (exact) return res.status(200).json({ station: { ...exact, source: 'tdtchannels' } });
    } catch (_) {}
    const rb = await radioBrowser(name, state, network);
    if (rb) return res.status(200).json({ station: rb });
    return res.status(404).json({ station: null });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
};
