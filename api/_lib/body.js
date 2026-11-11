// Cuerpo JSON de una petición POST (Vercel a veces ya lo da leído en req.body).
export async function readJson(req, maxBytes = 200_000) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > maxBytes) throw Object.assign(new Error('Demasiado texto'), { status: 413 });
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
