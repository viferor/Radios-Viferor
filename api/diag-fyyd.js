// TEMPORAL: qué devuelve fyyd con cada parámetro.
export default async function handler(req, res) {
  const q = String(req.query?.q || 'ciclismo');
  const urls = {
    title: `https://api.fyyd.de/0.2/search/podcast?title=${encodeURIComponent(q)}&count=8`,
    term: `https://api.fyyd.de/0.2/search/podcast?term=${encodeURIComponent(q)}&count=8`,
    both: `https://api.fyyd.de/0.2/search/podcast?title=${encodeURIComponent(q)}&term=${encodeURIComponent(q)}&count=8`,
    titleEs: `https://api.fyyd.de/0.2/search/podcast?title=${encodeURIComponent(q)}&langauge=es&count=8`,
    episodes: `https://api.fyyd.de/0.2/search/episode?title=${encodeURIComponent(q)}&count=5`
  };
  const out = {};
  await Promise.all(Object.entries(urls).map(async ([k, u]) => {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'RadiosViferor/podcasts' }, signal: AbortSignal.timeout(7000) });
      const d = await r.json();
      out[k] = { status: r.status, msg: d.msg, n: (d.data || []).length, titles: (d.data || []).slice(0, 8).map(x => `${x.title} [${x.language || ''}]`) };
    } catch (e) { out[k] = 'error ' + e.message; }
  }));
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
}
