// Corrección de auriculares de AutoEq (https://github.com/jaakkopasanen/AutoEq, MIT).
//
//   GET /api/autoeq?q=buds air 7      → { items:[{ name, path, source, rig }] }
//   GET /api/autoeq?path=Regan Cipher/in-ear/realme Buds Air 7 Pro (ANC off)
//                                    → { name, source, preamp, filters:[{type,fc,gain,q}] }
//
// El índice (results/INDEX.md, ~9.000 auriculares) y los ParametricEQ.txt se leen de GitHub.
import { safeFetch, rateLimited, readLimited } from './_lib/net.js';

const RAW = 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/';
const cache = globalThis.__autoeqCache || (globalThis.__autoeqCache = { index: null, at: 0, eq: new Map() });

async function raw(path, max = 3_000_000) {
  const url = RAW + path.split('/').map(encodeURIComponent).join('/');
  const r = await safeFetch(url, { headers: { 'User-Agent': 'RadiosViferor' } }, { allowFirstHost: h => h === 'raw.githubusercontent.com', timeoutMs: 12000, maxRedirects: 0 });
  if (r.status === 404) return null;
  if (!r.ok) throw Object.assign(new Error('GitHub no responde (' + r.status + ')'), { status: 502 });
  return new TextDecoder().decode(await readLimited(r, max));
}

// «- [Nombre](./Fuente/rig/Nombre%20...) by Fuente on Rig»
export function parseIndex(md) {
  const out = [];
  const re = /^- \[(.+?)\]\(\.\/(.+?)\) by (.+?)(?: on (.+))?$/gm;
  let m;
  while ((m = re.exec(md))) {
    let path;
    try {
      path = decodeURIComponent(m[2]);
    } catch {
      path = m[2];
    }
    out.push({ name: m[1], path, source: m[3].trim(), rig: (m[4] || '').trim() });
  }
  return out;
}
const norm = s =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
// Todas las palabras deben aparecer; «air7» encuentra «Air 7».
export function searchIndex(items, q, limit = 40) {
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  return items
    .map(it => {
      const n = norm(it.name),
        squashed = n.replace(/ /g, '');
      if (!words.every(w => n.includes(w) || squashed.includes(w))) return null;
      let s = 0;
      if (n.startsWith(words[0])) s += 3;
      if (words.every(w => n.split(' ').includes(w))) s += 2;
      s -= n.length / 100;
      return { it, s };
    })
    .filter(Boolean)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(x => x.it);
}
// «Filter 1: ON LSC Fc 105 Hz Gain -1.1 dB Q 0.70»
export function parseParametric(txt) {
  const preamp = Number((txt.match(/Preamp:\s*(-?[\d.]+)\s*dB/i) || [])[1] || 0);
  const filters = [];
  const re = /Filter\s+\d+:\s+ON\s+(PK|LSC|HSC|LS|HS|LP|HP)\s+Fc\s+([\d.]+)\s*Hz(?:\s+Gain\s+(-?[\d.]+)\s*dB)?(?:\s+Q\s+([\d.]+))?/gi;
  let m;
  while ((m = re.exec(txt))) {
    const t = m[1].toUpperCase();
    const type = t === 'PK' ? 'peaking' : t.startsWith('LS') ? 'lowshelf' : t.startsWith('HS') ? 'highshelf' : null;
    if (!type) continue;
    filters.push({ type, fc: Number(m[2]), gain: Number(m[3] || 0), q: Number(m[4] || 0.707) });
  }
  return { preamp, filters: filters.slice(0, 20) };
}

export default async function handler(req, res) {
  if (rateLimited(req, res, 'autoeq', 60)) return;
  try {
    const u = new URL(req.url, 'http://localhost');
    const q = String(u.searchParams.get('q') || '').slice(0, 80);
    const path = String(u.searchParams.get('path') || '').slice(0, 300);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    if (!cache.index || Date.now() - cache.at > 86400000) {
      const md = await raw('INDEX.md', 6_000_000);
      if (!md) throw Object.assign(new Error('No se encontró el índice de AutoEq'), { status: 502 });
      cache.index = parseIndex(md);
      cache.at = Date.now();
    }
    if (path) {
      const it = cache.index.find(x => x.path === path);
      if (!it) return res.status(404).json({ error: 'Auriculares no encontrados' });
      if (!cache.eq.has(path)) {
        const base = path.split('/').pop();
        const txt = await raw(`${path}/${base} ParametricEQ.txt`, 50_000);
        if (!txt) return res.status(404).json({ error: 'No hay ecualización paramétrica para estos auriculares' });
        cache.eq.set(path, parseParametric(txt));
      }
      return res.status(200).json({ name: it.name, source: it.source, rig: it.rig, path, ...cache.eq.get(path) });
    }
    if (!q.trim()) return res.status(400).json({ error: 'Escribe el modelo' });
    return res.status(200).json({ items: searchIndex(cache.index, q) });
  } catch (e) {
    return res.status(e.status || 502).json({ error: e.message || 'No se pudo consultar AutoEq' });
  }
}
