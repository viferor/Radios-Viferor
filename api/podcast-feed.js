const cache = globalThis.__podcastFeedCache || (globalThis.__podcastFeedCache = new Map());
const HTML_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '\"',
  apos: "'",
  nbsp: '\u00A0',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
  laquo: '\u00AB',
  raquo: '\u00BB',
  ldquo: '\u201C',
  rdquo: '\u201D',
  lsquo: '\u2018',
  rsquo: '\u2019',
  iexcl: '\u00A1',
  iquest: '\u00BF',
  copy: '\u00A9',
  reg: '\u00AE',
  trade: '\u2122',
  euro: '\u20AC',
  pound: '\u00A3',
  yen: '\u00A5',
  cent: '\u00A2',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  ntilde: 'ñ',
  Ntilde: 'Ñ',
  uuml: 'ü',
  Uuml: 'Ü',
  ccedil: 'ç',
  Ccedil: 'Ç',
  ordf: 'ª',
  ordm: 'º'
};
function repairMojibake(s) {
  let out = String(s || '');
  const bad = v => (v.match(/[ÃÂâð]|�/g) || []).length;
  for (let i = 0; i < 2; i++) {
    if (!bad(out)) break;
    try {
      const bytes = Uint8Array.from(out, c => c.charCodeAt(0) & 255);
      const fixed = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      if (bad(fixed) < bad(out)) out = fixed;
      else break;
    } catch {
      break;
    }
  }
  return out;
}
function decodeEntities(s) {
  return repairMojibake(String(s || '')).replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);?/gi, (m, k) => {
    if (/^#x/i.test(k)) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (/^#/i.test(k)) return String.fromCodePoint(parseInt(k.slice(1), 10));
    return Object.prototype.hasOwnProperty.call(HTML_ENTITIES, k) ? HTML_ENTITIES[k] : m;
  });
}
function strip(s) {
  return decodeEntities(
    String(s || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i');
  const m = block.match(re);
  return m ? strip(m[1]) : '';
}
function attr(block, name) {
  const re = new RegExp(`${name}=["']([^"']*)["']`, 'i');
  const m = block.match(re);
  return m ? m[1] : '';
}
function firstUrl(block) {
  let m = block.match(/<enclosure\b[^>]*\burl=["']([^"']+)["'][^>]*>/i);
  if (m) return decodeEntities(m[1]);
  m = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i);
  return m ? decodeEntities(m[1]) : '';
}
function parse(xml, feedUrl) {
  const channel = (xml.match(/<channel\b[^>]*>([\s\S]*?)<\/channel>/i) || [])[1] || xml;
  const title = tag(channel, 'title');
  const desc = tag(channel, 'description') || tag(channel, 'summary');
  const image =
    (channel.match(/<itunes:image\b[^>]*href=["']([^"']+)["'][^>]*>/i) || [])[1] ||
    ((channel.match(/<image\b[^>]*>[\s\S]*?<\/image>/i) || [])[0]
      ? tag((channel.match(/<image\b[^>]*>[\s\S]*?<\/image>/i) || [])[0], 'url')
      : '');
  const author = tag(channel, 'itunes:author') || tag(channel, 'author');
  let blocks = [...(channel.match(/<item\b[\s\S]*?<\/item>/gi) || [])];
  if (!blocks.length) blocks = [...(xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [])];
  const episodes = blocks
    .map((b, i) => ({
      id: tag(b, 'guid') || tag(b, 'dc:identifier') || `${feedUrl}#${i}`,
      title: tag(b, 'title') || 'Episodio',
      description: tag(b, 'description') || tag(b, 'content:encoded') || tag(b, 'summary'),
      date:
        tag(b, 'pubDate') ||
        tag(b, 'published') ||
        tag(b, 'updated') ||
        tag(b, 'dc:date') ||
        tag(b, 'itunes:releaseDate') ||
        tag(b, 'releaseDate'),
      audioUrl: firstUrl(b),
      duration: tag(b, 'itunes:duration'),
      pageUrl: tag(b, 'link'),
      image: (b.match(/<itunes:image\b[^>]*href=["']([^"']+)["'][^>]*>/i) || [])[1] || image,
      episodeNumber: tag(b, 'itunes:episode'),
      season: tag(b, 'itunes:season'),
      explicit: tag(b, 'itunes:explicit')
    }))
    .filter(e => e.audioUrl);
  return { feed: { title, description: desc, author, image, feedUrl }, episodes };
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=600');
  try {
    const u = new URL(req.url, 'http://localhost');
    const feedUrl = u.searchParams.get('url');
    if (!feedUrl || !/^https?:\/\//i.test(feedUrl))
      return res.status(400).json({ error: 'Feed URL no válida' });
    const cached = cache.get(feedUrl);
    if (cached && Date.now() - cached.t < 180000) return res.status(200).json(cached.data);
    const headers = {
      'User-Agent': 'Radios-Viferor/1.4.65 Podcast RSS Reader',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
    };
    const candidates = [feedUrl];
    // Culips cambió/ha tenido problemas con su antigua URL de feed en esl.culips.com.
    // Conservamos la suscripción del usuario y probamos su feed público alternativo.
    if (/(^|\.)esl\.culips\.com$/i.test(new URL(feedUrl).hostname))
      candidates.push('https://culips.libsyn.com/rss');
    let r = null,
      lastErr = null;
    for (let attempt = 0; attempt < 2 && !r; attempt++) {
      for (const candidate of candidates) {
        try {
          const rr = await fetch(candidate, { headers });
          if (rr.ok) {
            r = rr;
            break;
          }
          lastErr = new Error('Feed HTTP ' + rr.status);
        } catch (e) {
          lastErr = e;
        }
      }
      if (!r && attempt === 0) await new Promise(resolve => setTimeout(resolve, 350));
    }
    if (!r) throw lastErr || new Error('No se pudo leer el feed');
    const buf = await r.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const head = new TextDecoder('ascii', { fatal: false }).decode(bytes.slice(0, 1200));
    const declared = (head.match(/<\?xml[^>]*encoding=[\"']([^\"']+)[\"']/i) || [])[1] || '';
    const contentType = r.headers.get('content-type') || '';
    const headerCharset = (contentType.match(/charset\s*=\s*([\w.-]+)/i) || [])[1] || '';
    const charset = (declared || headerCharset || 'utf-8').trim();
    function decodeBytes(enc) {
      try {
        return new TextDecoder(enc, { fatal: false }).decode(bytes);
      } catch {
        return null;
      }
    }
    let xml = decodeBytes(charset) || decodeBytes('utf-8') || '';
    // Algunos servidores declaran ISO-8859-1/Windows-1252 aunque realmente envían UTF-8.
    // Si UTF-8 es válido y contiene caracteres no ASCII, preferimos esa interpretación.
    if (!/^utf-?8$/i.test(charset)) {
      try {
        const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (utf8 && /[\u0080-\uFFFF]/.test(utf8)) xml = utf8;
      } catch {}
    }
    if (xml.length < 100) throw new Error('Feed vacío');
    const data = parse(xml, feedUrl);
    if (!data.feed.title && !data.episodes.length) throw new Error('No se ha podido interpretar el feed');
    cache.set(feedUrl, { t: Date.now(), data });
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: 'No se pudo leer el podcast', detail: e.message });
  }
}
