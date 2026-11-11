// Publicar en LRCLIB una letra que has sincronizado o escrito tú.
//
//   POST /api/lyrics-publish  { step:'challenge' }                → { prefix, target }
//   POST /api/lyrics-publish  { step:'publish', token, trackName, artistName, albumName,
//                               duration, plainLyrics, syncedLyrics } → { ok:true }
//
// LRCLIB pide antes resolver un reto (prueba de trabajo): el dispositivo busca un número
// tal que SHA-256(prefijo + número) < objetivo, y lo envía como «prefijo:número».
import { safeFetch, rateLimited, readLimited } from './_lib/net.js';
import { readJson } from './_lib/body.js';

const BASE = 'https://lrclib.net/api';
const UA = 'RadiosViferor (https://radiosviferor.vercel.app)';
const str = (v, n) => String(v ?? '').trim().slice(0, n);

async function post(path, body, headers = {}) {
  const r = await safeFetch(
    BASE + path,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Lrclib-Client': UA, ...headers }, body: body ? JSON.stringify(body) : undefined },
    { allowFirstHost: h => h === 'lrclib.net', timeoutMs: 15000, maxRedirects: 0 }
  );
  const text = new TextDecoder().decode(await readLimited(r, 200_000));
  let d = {};
  try {
    d = JSON.parse(text || '{}');
  } catch {}
  return { r, d };
}

export function validatePublish(b) {
  const out = {
    trackName: str(b.trackName, 300),
    artistName: str(b.artistName, 300),
    albumName: str(b.albumName, 300),
    duration: Math.round(Number(b.duration) || 0),
    plainLyrics: str(b.plainLyrics, 20000) || null,
    syncedLyrics: str(b.syncedLyrics, 30000) || null
  };
  if (!out.trackName || !out.artistName) return { error: 'Faltan el título o el artista' };
  if (!out.duration || out.duration < 10 || out.duration > 7200) return { error: 'Hace falta la duración de la canción' };
  if (!out.plainLyrics && !out.syncedLyrics) return { error: 'No hay letra que publicar' };
  if (out.syncedLyrics && !/\[\d{1,3}:\d{2}[.:]\d{1,3}\]/.test(out.syncedLyrics)) return { error: 'La letra sincronizada no tiene tiempos válidos' };
  return { data: out };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });
  if (rateLimited(req, res, 'lyrics-publish', 12)) return;
  try {
    const b = await readJson(req, 80_000);
    if (b.step === 'challenge') {
      const { r, d } = await post('/request-challenge');
      if (!r.ok || !d.prefix || !d.target) return res.status(502).json({ error: 'LRCLIB no ha dado el reto (' + r.status + ')' });
      return res.status(200).json({ prefix: d.prefix, target: d.target });
    }
    if (b.step === 'publish') {
      const token = str(b.token, 300);
      if (!/^[^:\s]+:\d+$/.test(token)) return res.status(400).json({ error: 'Token no válido' });
      const v = validatePublish(b);
      if (v.error) return res.status(400).json({ error: v.error });
      const { r, d } = await post('/publish', v.data, { 'X-Publish-Token': token });
      if (r.status === 201 || r.ok) return res.status(200).json({ ok: true });
      return res.status(r.status === 400 ? 400 : 502).json({ error: d.message || d.name || `LRCLIB ha rechazado la letra (${r.status})` });
    }
    return res.status(400).json({ error: 'Paso desconocido' });
  } catch (e) {
    return res.status(e.status || 502).json({ error: e.message || 'No se pudo publicar' });
  }
}
