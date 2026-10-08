// TEMPORAL: diagnóstico de red en Vercel. Se elimina en el siguiente commit.
import feed from './podcast-feed.js';
import meta from './metadata.js';
function fakeRes() {
  return { code: 200, h: {}, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.h[k] = v; }, write() {}, end() {} };
}
async function run(fn, url, query) {
  const r = fakeRes();
  try {
    await fn({ url, query, headers: { 'x-forwarded-for': 'diag-' + Math.random() }, on() {} }, r);
  } catch (e) {
    return { crash: String(e && e.stack || e).slice(0, 400) };
  }
  const b = r.body ? JSON.stringify(r.body).slice(0, 300) : null;
  return { code: r.code, body: b };
}
export default async function handler(req, res) {
  const out = {};
  const fu = 'https://feeds.npr.org/510289/podcast.xml';
  out.feedMeta = await run(feed, '/api/podcast-feed?meta=1&url=' + encodeURIComponent(fu), { url: fu, meta: '1' });
  const su = 'https://playerservices.streamtheworld.com/api/livestream-redirect/CADENASER.mp3';
  out.meta = await run(meta, '/api/metadata?url=' + encodeURIComponent(su), { url: su, name: 'Cadena SER' });
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send('<pre>' + JSON.stringify(out, null, 1).replace(/</g, '&lt;') + '</pre>');
}
