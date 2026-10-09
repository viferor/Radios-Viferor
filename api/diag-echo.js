// TEMPORAL: muestra cómo llega la petición a la función.
import search from './podcast-search.js';
export default async function handler(req, res) {
  const fake = () => ({ code: 200, b: null, status(c) { this.code = c; return this; }, json(b) { this.b = b; return this; }, setHeader() {} });
  const r2 = fake();
  await search({ url: req.url.replace('/api/diag-echo', '/api/podcast-search'), query: req.query, headers: { 'x-forwarded-for': 'diag' + Math.random() } }, r2);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ url: req.url, query: req.query, source: r2.b?.source, ids: (r2.b?.items || []).slice(0, 5).map(i => i.id + ' ' + JSON.stringify(i.sources)) });
}
