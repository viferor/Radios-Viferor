// Utilidades de red compartidas por las funciones de /api.
// Vercel no publica como endpoint los archivos que empiezan por «_».
//
// Objetivo: que /api/metadata, /api/podcast-feed y /api/podcast-audio no puedan
// usarse como proxy abierto hacia la red interna (SSRF) ni como proxy genérico.
import dns from 'node:dns';
import net from 'node:net';

// ---------------------------------------------------------------------------
// Direcciones que nunca se consultan: bucle local, redes privadas, enlace
// local (incluye 169.254.169.254, metadatos de la nube), CGNAT, multicast…
function ipv4Private(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}
function ipv6Private(ip) {
  const x = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (x === '::' || x === '::1') return true;
  const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Private(mapped[1]);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x) || x.startsWith('64:ff9b:') || x.startsWith('2001:db8:');
}
export function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) return ipv4Private(ip);
  if (v === 6) return ipv6Private(ip);
  return true;
}

// Comprueba la forma de la URL (sin consultar DNS).
export function parsePublicUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal'))
    return null;
  if (net.isIP(host) && isPrivateIp(host)) return null;
  // Nombres sin punto (máquinas de la red interna).
  if (!net.isIP(host) && !host.includes('.')) return null;
  return u;
}

// Resuelve el nombre y rechaza la URL si alguna IP es privada.
export async function assertPublicUrl(raw) {
  const u = parsePublicUrl(raw);
  if (!u) throw new HttpError(400, 'URL no permitida');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!net.isIP(host)) {
    let addrs;
    try {
      addrs = await dns.promises.lookup(host, { all: true, verbatim: true });
    } catch {
      throw new HttpError(502, 'No se pudo resolver el servidor');
    }
    if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new HttpError(400, 'URL no permitida');
  }
  return u;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// fetch que sigue las redirecciones a mano y valida cada salto.
// opts.allowFirstHost(host) restringe solo el primer destino (lista blanca).
export async function safeFetch(raw, init = {}, { maxRedirects = 5, allowFirstHost = null, timeoutMs = 0 } = {}) {
  let url = await assertPublicUrl(raw);
  if (allowFirstHost && !allowFirstHost(url.hostname.toLowerCase())) throw new HttpError(400, 'Fuente no permitida');
  const ctl = timeoutMs ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  const signal = init.signal || ctl?.signal;
  try {
    for (let hop = 0; ; hop++) {
      const r = await fetch(url, { ...init, signal, redirect: 'manual' });
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        try {
          await r.body?.cancel();
        } catch {}
        if (hop >= maxRedirects) throw new HttpError(502, 'Demasiadas redirecciones');
        url = await assertPublicUrl(new URL(r.headers.get('location'), url).toString());
        continue;
      }
      r.finalUrl = url.toString();
      return r;
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Lee el cuerpo con un tope de tamaño (evita feeds de cientos de MB).
export async function readLimited(r, maxBytes) {
  const len = Number(r.headers.get('content-length') || 0);
  if (len && len > maxBytes) throw new HttpError(413, 'Respuesta demasiado grande');
  if (!r.body) return new Uint8Array(0);
  const reader = r.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) throw new HttpError(413, 'Respuesta demasiado grande');
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Límite de peticiones por IP (en memoria de cada instancia: no es perfecto,
// pero frena el abuso de una sola máquina).
const buckets = globalThis.__rvRateBuckets || (globalThis.__rvRateBuckets = new Map());
export function clientIp(req) {
  const xf = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || String(req.headers?.['x-real-ip'] || req.socket?.remoteAddress || 'desconocida');
}
export function rateLimited(req, res, name, maxPerMinute) {
  const now = Date.now();
  const key = name + '|' + clientIp(req);
  let b = buckets.get(key);
  if (!b || now - b.start >= 60000) {
    b = { start: now, count: 0 };
    buckets.set(key, b);
  }
  b.count++;
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now - v.start >= 60000) buckets.delete(k);
  }
  if (b.count > maxPerMinute) {
    res.setHeader('Retry-After', String(Math.ceil((b.start + 60000 - now) / 1000)));
    res.status(429).json({ error: 'Demasiadas peticiones, prueba en un momento' });
    return true;
  }
  return false;
}
