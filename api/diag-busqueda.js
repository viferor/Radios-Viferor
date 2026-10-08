// TEMPORAL (rama diag-buscadores): resume datos reales para rehacer los buscadores.
async function j(url, ms = 9000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal, headers: { accept: 'application/json', 'user-agent': 'RadiosViferor/diag' } }); const txt = await r.text(); let d = null; try { d = JSON.parse(txt); } catch {} return { status: r.status, d, len: txt.length, head: txt.slice(0, 300) }; }
  catch (e) { return { error: String(e.message || e) }; } finally { clearTimeout(t); }
}
export default async function handler(req, res) {
  const part = String(req.query?.p || 'tdt');
  const out = {};
  if (part === 'tdt') {
    const r = await j('https://www.tdtchannels.com/lists/radio.json');
    const d = r.d; out.status = r.status;
    out.countries = (d?.countries || []).map(c => ({ name: c.name, ambits: (c.ambits || []).map(a => `${a.name} (${(a.channels || []).length})`) }));
    const sp = (d?.countries || []).find(c => /spain|españa/i.test(c.name));
    out.sampleByAmbit = {};
    for (const a of sp?.ambits || []) out.sampleByAmbit[a.name] = (a.channels || []).slice(0, 12).map(c => c.name + (c.epg_id ? ' [' + c.epg_id + ']' : ''));
    out.channelKeys = Object.keys((sp?.ambits?.[0]?.channels?.[0]) || {});
  } else if (part === 'rb') {
    const r = await j('https://de1.api.radio-browser.info/json/stations/bycountrycodeexact/ES?hidebroken=true&limit=10000&order=name', 15000);
    const a = Array.isArray(r.d) ? r.d : []; out.count = a.length; out.status = r.status || r.error;
    const st = {}; a.forEach(x => { const k = x.state || '(vacío)'; st[k] = (st[k] || 0) + 1; });
    out.states = Object.entries(st).sort((x, y) => y[1] - x[1]).slice(0, 70);
    out.sample = a.filter(x => /cordoba|córdoba|ser |cope|los40|dial/i.test(x.name)).slice(0, 40).map(x => `${x.name} | ${x.state} | ${x.tags?.slice(0, 40)}`);
  } else if (part === 'apple1') {
    const [top, mod, top2, top3] = await Promise.all([
      j('https://itunes.apple.com/es/rss/toppodcasts/limit=5/genre=1545/json'),
      j('https://rss.applemarketingtools.com/api/v2/es/podcasts/top/5/podcasts.json'),
      j('https://itunes.apple.com/es/rss/toppodcasts/limit=200/json'),
      j('https://itunes.apple.com/es/rss/toppodcasts/limit=200/genre=1487/json')
    ]);
    out.legacyTop = { status: top.status || top.error, keys: Object.keys(top.d?.feed || {}), first: top.d?.feed?.entry?.[0] ? { name: top.d.feed.entry[0]['im:name']?.label, id: top.d.feed.entry[0].id?.attributes?.['im:id'], cat: top.d.feed.entry[0].category?.attributes } : top.head };
    out.modernTop = { status: mod.status || mod.error, first: mod.d?.feed?.results?.[0] ? { name: mod.d.feed.results[0].name, id: mod.d.feed.results[0].id, genres: mod.d.feed.results[0].genres } : mod.head };
    out.legacyTopAll = { status: top2.status || top2.error, count: top2.d?.feed?.entry?.length };
    out.legacyTopHistoria = { status: top3.status || top3.error, count: top3.d?.feed?.entry?.length, first: top3.d?.feed?.entry?.slice(0, 3).map(e => e['im:name']?.label) };
  } else if (part === 'apple2') {
    const [s1, s2, s3, s4] = await Promise.all([
      j('https://itunes.apple.com/search?term=historia&country=ES&media=podcast&entity=podcast&limit=50'),
      j('https://itunes.apple.com/search?term=historia&country=ES&media=podcast&entity=podcast&limit=50&genreId=1545'),
      j('https://itunes.apple.com/search?term=ser&country=ES&media=podcast&entity=podcast&attribute=artistTerm&limit=5'),
      j('https://itunes.apple.com/lookup?id=1458203451,1513766929&entity=podcast')
    ]);
    out.searchNoGenre = { count: s1.d?.resultCount, rows: s1.d?.results?.slice(0, 4).map(x => [x.collectionName, x.primaryGenreName, (x.genreIds || []).join('/'), x.country, x.trackCount]), keys: Object.keys(s1.d?.results?.[0] || {}) };
    out.searchGenreParam = { count: s2.d?.resultCount, rows: s2.d?.results?.slice(0, 3).map(x => [x.collectionName, x.primaryGenreName]) };
    out.artistTerm = s3.d?.results?.map(x => [x.collectionName, x.artistName]);
    out.lookupMulti = s4.d?.results?.map(x => [x.collectionName, !!x.feedUrl]) || s4.head;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send('<pre>' + JSON.stringify(out, null, 1).replace(/</g, '&lt;') + '</pre>');
}
