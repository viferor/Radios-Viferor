const TDT_URL = 'https://www.tdtchannels.com/lists/radio.json';
const RB_URLS = [
  'https://de1.api.radio-browser.info/json/stations/bycountrycodeexact/ES?hidebroken=true&limit=10000&order=name',
  'https://nl1.api.radio-browser.info/json/stations/bycountrycodeexact/ES?hidebroken=true&limit=10000&order=name'
];
let cache = { at: 0, stations: [] };
const TTL = 10 * 60 * 1000;
function norm(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}
function cleanOptions(options) {
  return (Array.isArray(options) ? options : [])
    .map(o => ({ format: o?.format || 'stream', url: o?.url || '' }))
    .filter(o => /^https?:\/\//i.test(o.url));
}
function stateFromAmbit(name) {
  const n = norm(name);
  const map = [
    ['madrid', 'Madrid'],
    ['andalucia', 'Andalucía'],
    ['cataluna', 'Cataluña'],
    ['comunidad valenciana', 'Valencia'],
    ['galicia', 'Galicia'],
    ['pais vasco', 'País Vasco'],
    ['euskadi', 'País Vasco'],
    ['navarra', 'Navarra'],
    ['aragon', 'Aragón'],
    ['asturias', 'Asturias'],
    ['cantabria', 'Cantabria'],
    ['castilla y leon', 'Castilla y León'],
    ['castilla-la mancha', 'Castilla-La Mancha'],
    ['extremadura', 'Extremadura'],
    ['murcia', 'Murcia'],
    ['canarias', 'Canarias'],
    ['baleares', 'Baleares'],
    ['la rioja', 'La Rioja'],
    ['ceuta', 'Ceuta'],
    ['melilla', 'Melilla']
  ];
  for (const [k, v] of map) if (n.includes(k)) return v;
  return name || 'España';
}
function fromTdt(data) {
  const out = [];
  for (const country of data?.countries || []) {
    for (const ambit of country?.ambits || []) {
      const state = stateFromAmbit(ambit?.name);
      for (const ch of ambit?.channels || []) {
        const options = cleanOptions(ch.options);
        if (!ch?.name || !options.length) continue;
        const id =
          'tdt-' +
          norm(ch.name)
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') +
          '-' +
          norm(state)
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
        out.push({
          uuid: id,
          stationuuid: id,
          name: ch.name,
          state,
          city: '',
          network: '',
          tags: '',
          logo: ch.logo || '',
          web: ch.web || '',
          // Ámbito original de TDTChannels («Populares», «Musicales», «Andalucía»…) e
          // identificador de guía: el buscador y la programación los usan.
          ambit: ambit?.name || '',
          epg_id: ch.epg_id || '',
          options
        });
      }
    }
  }
  return out;
}
function fromRadioBrowser(data) {
  return (Array.isArray(data) ? data : [])
    .filter(x => x?.name)
    .map(x => ({
      uuid: x.stationuuid,
      stationuuid: x.stationuuid,
      name: x.name,
      state: x.state || 'España',
      city: x.state || '',
      network: '',
      tags: x.tags || '',
      logo: x.favicon || '',
      web: x.homepage || '',
      url: x.url || '',
      url_resolved: x.url_resolved || '',
      options: x.url_resolved ? [{ format: x.codec || 'stream', url: x.url_resolved }] : []
    }));
}
function merge(all) {
  const m = new Map();
  for (const s of all) {
    const key = norm(s.name) + '|' + norm(s.state || '');
    const prev = m.get(key);
    if (!prev) {
      m.set(key, s);
      continue;
    }
    m.set(key, {
      ...prev,
      ...s,
      logo: s.logo || prev.logo || '',
      web: s.web || prev.web || '',
      url: s.url || prev.url || '',
      url_resolved: s.url_resolved || prev.url_resolved || '',
      options: s.options?.length ? s.options : prev.options || []
    });
  }
  return [...m.values()];
}
async function fetchJson(url, ms = 8000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}
export default async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (Date.now() - cache.at < TTL && cache.stations.length)
    return res
      .status(200)
      .json({ version: '1.2.0', source: 'tdtchannels+radio-browser', stations: cache.stations });
  try {
    const tdt = fromTdt(await fetchJson(TDT_URL));
    if (tdt.length < 300) throw new Error('TDT catálogo incompleto: ' + tdt.length);
    cache = { at: Date.now(), stations: tdt };
    return res.status(200).json({ version: '1.2.0', source: 'tdtchannels', stations: tdt });
  } catch (e) {
    try {
      for (const u of RB_URLS) {
        const rb = fromRadioBrowser(await fetchJson(u));
        if (rb.length >= 300) {
          cache = { at: Date.now(), stations: rb };
          return res.status(200).json({ version: '1.2.0', source: 'radio-browser', stations: rb });
        }
      }
    } catch {}
    return res
      .status(502)
      .json({ error: 'No se pudo cargar el catálogo nacional', detail: String(e.message || e) });
  }
};
