// Programa actual y siguientes de una emisora, a partir de la guía (EPG) de radio
// de TDTChannels. La guía antigua (tdtchannels.com/epg/RADIO.xml[.gz]) devuelve 404;
// la actual es RADIO.json (y RADIO.xml.gz en ondachannels.com como respaldo).
//
// Parámetros: epg_id, name, network. Las emisoras locales (p. ej. «SER Córdoba»)
// no tienen guía propia: se usa la de su cadena.
import zlib from 'node:zlib';

const JSON_URL = 'https://www.tdtchannels.com/epg/RADIO.json';
const XML_URL = 'https://www.ondachannels.com/epg/RADIO.xml.gz';
const TTL = 15 * 60 * 1000;
let cache = globalThis.__rvEpg || (globalThis.__rvEpg = { at: 0, byChannel: new Map(), loading: null });

function norm(v) {
  return String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function key(id) {
  return String(id || '').toLowerCase().replace(/\.radio$/, '').replace(/[^a-z0-9]/g, '');
}
function clean(v) {
  return String(v ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchWithTimeout(url, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      headers: { 'User-Agent': 'RadiosViferor/epg', Accept: 'application/json,application/xml,application/gzip,*/*' }
    });
    if (!r.ok) throw new Error('EPG HTTP ' + r.status);
    return r;
  } finally {
    clearTimeout(t);
  }
}

function fromJson(arr) {
  const map = new Map();
  for (const ch of Array.isArray(arr) ? arr : []) {
    const events = (ch.events || [])
      .map(e => ({
        title: clean(e.t),
        description: clean(e.d),
        start: Number(e.hi) * 1000,
        end: Number(e.hf) * 1000
      }))
      .filter(e => e.title && Number.isFinite(e.start) && Number.isFinite(e.end))
      .sort((a, b) => a.start - b.start);
    if (ch.name && events.length) map.set(key(ch.name), { channel: ch.name, events });
  }
  return map;
}
function parseXmlDate(v) {
  const m = String(v || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?/);
  if (!m) return NaN;
  const tz = m[7] ? m[7].slice(0, 3) + ':' + m[7].slice(3) : 'Z';
  return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${tz}`);
}
function fromXml(xml) {
  const map = new Map();
  const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const a = m[1],
      body = m[2];
    const channel = (a.match(/\bchannel=["']([^"']+)["']/i) || [])[1] || '';
    const title = clean((body.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i) || [])[1]);
    if (!channel || !title) continue;
    const ev = {
      title,
      description: clean((body.match(/<desc(?:\s[^>]*)?>([\s\S]*?)<\/desc>/i) || [])[1]),
      start: parseXmlDate((a.match(/\bstart=["']([^"']+)["']/i) || [])[1]),
      end: parseXmlDate((a.match(/\bstop=["']([^"']+)["']/i) || [])[1])
    };
    if (!Number.isFinite(ev.start) || !Number.isFinite(ev.end)) continue;
    const k = key(channel);
    if (!map.has(k)) map.set(k, { channel, events: [] });
    map.get(k).events.push(ev);
  }
  for (const v of map.values()) v.events.sort((x, y) => x.start - y.start);
  return map;
}

async function load() {
  if (cache.byChannel.size && Date.now() - cache.at < TTL) return cache.byChannel;
  if (cache.loading) return cache.loading;
  cache.loading = (async () => {
    let map = null;
    try {
      const r = await fetchWithTimeout(JSON_URL, 8000);
      map = fromJson(await r.json());
    } catch {}
    if (!map || map.size < 10) {
      try {
        const r = await fetchWithTimeout(XML_URL, 8000);
        let b = Buffer.from(await r.arrayBuffer());
        try {
          b = zlib.gunzipSync(b);
        } catch {}
        map = fromXml(b.toString('utf8'));
      } catch {}
    }
    if (map && map.size) {
      cache.byChannel = map;
      cache.at = Date.now();
    }
    if (!cache.byChannel.size) throw new Error('Guía de programación no disponible');
    return cache.byChannel;
  })();
  try {
    return await cache.loading;
  } finally {
    cache.loading = null;
  }
}

// Guía de cada cadena (identificadores de TDTChannels).
const NETWORK_EPG = {
  'cadena ser': 'CadenaS',
  cope: 'COPE',
  'onda cero': 'OndaCero',
  rne: 'RNE',
  'radio nacional': 'RNE',
  los40: 'Los40',
  'cadena dial': 'CadenaDial',
  'rock fm': 'RockFM',
  'kiss fm': 'KissFm',
  'europa fm': 'EuropaFM',
  'canal sur': 'CanalSur',
  'radio marca': 'Marca',
  esradio: 'esRadio',
  'cadena 100': 'Cadena100',
  megastar: 'MegaStar',
  'onda madrid': 'OndaMadrid'
};
// Reglas por nombre de emisora, de la más específica a la más general.
const NAME_RULES = [
  [/\blos ?40 classic\b/, 'Los40Classic'],
  [/\blos ?40 urban\b/, 'Los40Urban'],
  [/\blos ?40 dance\b/, 'Los40Dance'],
  [/\b(los ?40|40 principales)\b/, 'Los40'],
  [/\bradio clasica\b/, 'RNEClasica'],
  [/\bradio 3\b/, 'RNE3'],
  [/\bradio 5\b/, 'RNE5'],
  [/\bradio 4\b/, 'Radio4RNE'],
  [/\b(radio nacional|rne)\b/, 'RNE'],
  [/\bcadena dial\b|\bdial\b/, 'CadenaDial'],
  [/\bcadena 100\b/, 'Cadena100'],
  [/\brock ?fm\b/, 'RockFM'],
  [/\bkiss ?fm\b/, 'KissFm'],
  [/\beuropa ?fm\b/, 'EuropaFM'],
  [/\bmegastar\b/, 'MegaStar'],
  [/\bonda cero\b/, 'OndaCero'],
  [/\besradio\b/, 'esRadio'],
  [/\bradio marca\b|\bmarca\b/, 'Marca'],
  [/\bcanal sur\b/, 'CanalSur'],
  [/\bonda madrid\b/, 'OndaMadrid'],
  [/\bcope\b/, 'COPE'],
  [/\b(cadena )?ser\b/, 'CadenaS']
];
function candidates(epgId, name, network) {
  const out = [];
  if (epgId) {
    out.push(epgId);
    // Desconexiones locales sin guía propia: S_Zaragoza → SER, OC_Pamplona → Onda Cero.
    if (/^s_/i.test(epgId)) out.push('CadenaS');
    if (/^oc_/i.test(epgId)) out.push('OndaCero');
  }
  const n = norm(name);
  for (const [re, id] of NAME_RULES) if (re.test(n)) out.push(id);
  const net = norm(network);
  if (NETWORK_EPG[net]) out.push(NETWORK_EPG[net]);
  return out;
}

export default async function handler(req, res) {
  try {
    const epg = String(req.query?.epg_id || '').trim(),
      name = String(req.query?.name || '').trim(),
      network = String(req.query?.network || '').trim();
    if (!epg && !name) return res.status(400).json({ error: 'Falta epg_id o name' });
    const map = await load();
    let found = null;
    for (const c of candidates(epg, name, network)) {
      found = map.get(key(c));
      if (found) break;
    }
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    if (!found) return res.status(200).json({ current: null, next: null, upcoming: [], channel: null });
    const now = Date.now();
    const current = found.events.find(e => e.start <= now && e.end > now) || null;
    const upcoming = found.events.filter(e => e.start > now).slice(0, 4);
    return res.status(200).json({
      channel: found.channel,
      current,
      next: upcoming[0] || null,
      upcoming,
      source: 'tdtchannels-epg'
    });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ current: null, next: null, upcoming: [], error: e.message || 'epg_unavailable' });
  }
}
