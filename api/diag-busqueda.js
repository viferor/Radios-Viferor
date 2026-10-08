// TEMPORAL (rama diag-buscadores): resume datos reales para rehacer los buscadores.
import meta from './metadata.js';
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
  if (part === 'epg') {
    const r = await j('https://www.tdtchannels.com/epg/RADIO.json', 12000);
    out.status = r.status || r.error; out.len = r.len;
    const d = r.d; out.type = Array.isArray(d) ? 'array' : typeof d;
    const arr = Array.isArray(d) ? d : (d && typeof d === 'object' ? Object.values(d) : []);
    out.topKeys = d && !Array.isArray(d) ? Object.keys(d).slice(0, 10) : null;
    out.count = arr.length;
    const first = arr[0]; out.firstKeys = first ? Object.keys(first) : null;
    out.firstSample = first ? JSON.stringify(first).slice(0, 700) : r.head;
    const names = arr.slice(0, 400).map(c => c.name || c.channel || c.id || c.title).filter(Boolean);
    out.names = names.filter(n => /ser|cope|onda|nacional|rne|los40|dial|marca|canal sur|kiss|europa|rock|cadena 100|radio 3/i.test(n)).slice(0, 60);
    const x = await j('https://www.ondachannels.com/epg/RADIO.xml.gz', 8000);
    out.xmlgz = { status: x.status || x.error, len: x.len };
  } else if (part === 'np') {
    const streams = {
      SER: 'https://playerservices.streamtheworld.com/api/livestream-redirect/CADENASER.mp3',
      LOS40: 'https://playerservices.streamtheworld.com/api/livestream-redirect/Los40.mp3',
      DIAL: 'https://playerservices.streamtheworld.com/api/livestream-redirect/CADENADIAL.mp3',
      MARCA: 'https://playerservices.streamtheworld.com/api/livestream-redirect/RADIOMARCA_NACIONAL.mp3',
      COPE: 'https://flucast09-h-cloud.flumotion.com/cope/net1.mp3',
      KISS: 'https://kissfm.kissfmradio.cires21.com/kissfm.mp3',
      EUROPA: 'https://radio-atres-live.ondacero.es/api/livestream-redirect/EFMAAC.aac',
      ONDACERO: 'https://radio-atres-live.ondacero.es/api/livestream-redirect/OCAAC.aac',
      CANALSUR: 'https://rtva-live-radio.flumotion.com/rtva/csr.mp3'
    };
    const fake = () => ({ code: 200, body: null, h: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.h[k] = v; } });
    await Promise.all(Object.entries(streams).map(async ([k, u]) => {
      const res = fake();
      try { await meta({ query: { url: u, name: k }, headers: { 'x-forwarded-for': 'diag' + k }, url: '/x' }, res); out[k] = res.body; } catch (e) { out[k] = 'crash ' + e.message; }
    }));
  }
  if (part === 'genres') {
    const ids = ['1301','1321','1303','1488','1304','1483','1511','1512','1487','1305','1310','1489','1314','1437','1533','1324','1545','1318','1309','1502','1320'];
    await Promise.all(ids.map(async id => {
      const t = await j(`https://itunes.apple.com/es/rss/toppodcasts/limit=2/genre=${id}/json`, 7000);
      const e = t.d?.feed?.entry; const first = Array.isArray(e) ? e[0] : e;
      out[id] = first ? `${first.category?.attributes?.label} / ${first.category?.attributes?.term} (${first.category?.attributes?.['im:id']}) — ${first['im:name']?.label}` : 'sin datos ' + (t.status || t.error);
    }));
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send('<pre>' + JSON.stringify(out, null, 1).replace(/</g, '&lt;') + '</pre>');
}
