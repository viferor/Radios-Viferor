import { safeFetch, rateLimited, HttpError } from './_lib/net.js';

// Solo se sirven a través de este proxy los audios de Omny/Triton (Radio MARCA y
// similares), que fallan al reproducirse directamente en el WebView. Debe
// coincidir con PODCAST_PROXY_HOSTS de podcasts.js.
const ALLOWED = /(^|\.)omny\.fm$|(^|\.)omnycontent\.com$|(^|\.)tritondigital\.com$/i;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (rateLimited(req, res, 'audio', 600)) return;
  try {
    const u = new URL(req.url, 'http://localhost');
    let audioUrl = u.searchParams.get('url');
    if (audioUrl) audioUrl = audioUrl.replace(/&amp;/gi, '&');
    if (!audioUrl || !/^https?:\/\//i.test(audioUrl))
      return res.status(400).json({ error: 'URL de audio no válida' });
    const target = new URL(audioUrl);
    const host = target.hostname.toLowerCase();
    const allowed = ALLOWED.test(host);
    if (!allowed) return res.status(400).json({ error: 'Fuente de audio no permitida' });
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Radios-Viferor',
      Accept: 'audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/*,*/*;q=0.8'
    };
    const range = req.headers?.range || req.headers?.Range;
    if (range) headers.Range = range;
    // El primer destino debe estar en la lista; las redirecciones (rastreadores de
    // audiencia, CDN) pueden ir a otro dominio, pero nunca a direcciones internas.
    const r = await safeFetch(audioUrl, { method: 'GET', headers }, { allowFirstHost: h => ALLOWED.test(h), maxRedirects: 8 });
    const ct0 = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const looksAudio = /\.(mp3|m4a|mp4|aac|ogg|opus|wav)(?:$|[?#])/i.test(target.pathname + target.search);
    const audioTypes =
      /^audio\//i.test(ct0) ||
      ct0 === 'application/octet-stream' ||
      ct0 === 'binary/octet-stream' ||
      ct0 === 'video/mp4';
    if (!r.ok && r.status !== 206) return res.status(502).json({ error: 'Audio HTTP ' + r.status });
    if (!audioTypes && !looksAudio) {
      return res
        .status(502)
        .json({ error: 'La fuente no devolvió audio', contentType: ct0 || 'unknown', status: r.status });
    }
    let ct = audioTypes
      ? ct0
      : /\.m4a|\.mp4/i.test(target.pathname)
        ? 'audio/mp4'
        : /\.ogg|\.opus/i.test(target.pathname)
          ? 'audio/ogg'
          : 'audio/mpeg';
    if (ct === 'video/mp4') ct = 'audio/mp4';
    res.status(r.status);
    res.setHeader('Content-Type', ct);
    res.setHeader('Accept-Ranges', r.headers.get('accept-ranges') || 'bytes');
    const cl = r.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);
    const cr = r.headers.get('content-range');
    if (cr) res.setHeader('Content-Range', cr);
    const et = r.headers.get('etag');
    if (et) res.setHeader('ETag', et);
    if (!r.body) {
      res.end();
      return;
    }
    if (typeof r.body.pipe === 'function') {
      r.body.pipe(res);
      return;
    }
    const reader = r.body.getReader();
    // Si el reproductor corta (cambio de episodio, salto), se deja de descargar.
    req.on?.('close', () => {
      try {
        reader.cancel();
      } catch {}
    });
    try {
      while (true) {
        const x = await reader.read();
        if (x.done) break;
        if (x.value && x.value.length) res.write(Buffer.from(x.value));
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }
    res.end();
  } catch (e) {
    try {
      res.status(e instanceof HttpError ? e.status : 502).json({ error: 'No se pudo reproducir el audio', detail: String(e?.message || e) });
    } catch {}
  }
}
