// TEMPORAL (rama diag-fyyd): comprueba fyyd desde Vercel.
import search from './podcast-search.js';
export default async function handler(req, res) {
  const out = {};
  try {
    const r = await fetch('https://api.fyyd.de/0.2/search/podcast?title=ciclismo&term=ciclismo&count=5', { headers: { 'User-Agent': 'RadiosViferor/podcasts' }, signal: AbortSignal.timeout(6000) });
    const t = await r.text();
    out.fyydStatus = r.status;
    out.fyydHead = t.slice(0, 400);
  } catch (e) { out.fyydError = String(e.message || e) + ' ' + (e.cause?.code || e.cause?.message || ''); }
  const fake = () => ({ code: 200, b: null, status(c) { this.code = c; return this; }, json(b) { this.b = b; return this; }, setHeader() {} });
  const r2 = fake();
  await search({ url: '/api/podcast-search?q=ciclismo&mode=search&source=fyyd&limit=5', headers: { 'x-forwarded-for': 'diag' } }, r2);
  out.handler = { code: r2.code, source: r2.b?.source, n: r2.b?.items?.length, first: r2.b?.items?.slice(0, 3).map(i => i.title + ' ' + JSON.stringify(i.sources)) };
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send('<pre>' + JSON.stringify(out, null, 1).replace(/</g, '&lt;') + '</pre>');
}
