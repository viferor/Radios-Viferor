// TEMPORAL: diagnóstico de red en Vercel. Se elimina en el siguiente commit.
import dns from 'node:dns';
import { isPrivateIp, safeFetch, parsePublicUrl } from './_lib/net.js';
export default async function handler(req, res) {
  const out = {};
  for (const h of ['playerservices.streamtheworld.com', 'feeds.npr.org']) {
    try {
      const a = await dns.promises.lookup(h, { all: true, verbatim: true });
      out[h] = a.map(x => [x.address, x.family, isPrivateIp(x.address)]);
    } catch (e) {
      out[h] = 'lookup error: ' + e.message;
    }
  }
  out.parse = !!parsePublicUrl('https://feeds.npr.org/510289/podcast.xml');
  try {
    const r = await safeFetch('https://feeds.npr.org/510289/podcast.xml', {}, { timeoutMs: 8000 });
    out.fetch = [r.status, r.finalUrl];
    try { await r.body?.cancel(); } catch {}
  } catch (e) {
    out.fetch = 'error: ' + (e.status || '') + ' ' + e.message + ' ' + (e.cause?.message || '');
  }
  out.xff = req.headers['x-forwarded-for'];
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
}
