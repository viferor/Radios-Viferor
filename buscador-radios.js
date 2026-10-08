// Buscador de emisoras de Radios Viferor.
//
// - Geografía: cada emisora se asigna a provincias (por su campo de provincia o por
//   localidades de su nombre: «SER Calatayud» → Zaragoza) y a una comunidad. Las
//   emisoras autonómicas sin provincia («Canal Sur Radio») aparecen en todas las
//   provincias de su comunidad.
// - Cadena y tipo: por palabras completas y por el identificador de guía de
//   TDTChannels (S_… = SER, OC_… = Onda Cero), no por trozos de texto.
// - Texto: por palabras en cualquier orden, sin acentos, con prefijos y tolerando
//   una errata; los resultados se ordenan por relevancia.
(function () {
  'use strict';

  function norm(v) {
    return String(v ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[·'’]/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  // --- Comunidades ----------------------------------------------------------
  const COMMUNITIES = {
    Andalucía: ['andalucia', 'andalusia'],
    Aragón: ['aragon'],
    Asturias: ['asturias', 'principado de asturias', 'p de asturias'],
    Baleares: ['illes balears', 'islas baleares', 'balearic islands', 'baleares', 'balears'],
    Canarias: ['canarias', 'canary islands', 'islas canarias'],
    Cantabria: ['cantabria'],
    'Castilla-La Mancha': ['castilla la mancha', 'castile la mancha'],
    'Castilla y León': ['castilla y leon', 'castile and leon', 'castilla leon'],
    Cataluña: ['cataluna', 'catalunya', 'catalonia'],
    Ceuta: ['ceuta'],
    'Comunidad Valenciana': [
      'c valenciana',
      'comunidad valenciana',
      'comunitat valenciana',
      'valencian community',
      'pais valencia'
    ],
    Extremadura: ['extremadura'],
    Galicia: ['galicia'],
    'La Rioja': ['la rioja', 'rioja'],
    Madrid: ['c de madrid', 'comunidad de madrid', 'community of madrid'],
    Melilla: ['melilla'],
    Murcia: ['r de murcia', 'region de murcia', 'region of murcia'],
    Navarra: ['c foral de navarra', 'navarra', 'navarre', 'nafarroa'],
    'País Vasco': ['pais vasco', 'euskadi', 'basque country']
  };

  // --- Provincias: comunidad y localidades que aparecen en nombres de emisoras --
  const PROVINCES = [
    ['Almería', 'Andalucía', ['almeria', 'el ejido', 'roquetas']],
    ['Cádiz', 'Andalucía', ['cadiz', 'jerez', 'algeciras', 'campo de gibraltar', 'la linea', 'san fernando', 'el puerto de santa maria', 'chiclana', 'sanlucar']],
    ['Córdoba', 'Andalucía', ['cordoba', 'lucena', 'puente genil', 'cabra', 'montilla', 'palma del rio', 'priego', 'pozoblanco', 'baena']],
    ['Granada', 'Andalucía', ['granada', 'motril', 'baza', 'guadix', 'loja']],
    ['Huelva', 'Andalucía', ['huelva', 'lepe']],
    ['Jaén', 'Andalucía', ['jaen', 'linares', 'ubeda', 'andujar', 'martos']],
    ['Málaga', 'Andalucía', ['malaga', 'marbella', 'costa del sol', 'antequera', 'ronda', 'axarquia', 'velez malaga', 'fuengirola', 'estepona']],
    ['Sevilla', 'Andalucía', ['sevilla', 'dos hermanas', 'ecija', 'utrera', 'osuna', 'carmona']],
    ['Huesca', 'Aragón', ['huesca', 'barbastro', 'monzon', 'jaca', 'fraga']],
    ['Teruel', 'Aragón', ['teruel', 'alcaniz']],
    ['Zaragoza', 'Aragón', ['zaragoza', 'calatayud', 'cinco villas', 'ejea', 'tarazona', 'caspe']],
    ['Asturias', 'Asturias', ['asturias', 'oviedo', 'gijon', 'aviles', 'cangas del narcea', 'langreo', 'mieres']],
    ['Baleares', 'Baleares', ['mallorca', 'menorca', 'ibiza', 'eivissa', 'formentera', 'palma de mallorca', 'pitiuses']],
    ['Las Palmas', 'Canarias', ['las palmas', 'gran canaria', 'lanzarote', 'fuerteventura']],
    ['S.C. Tenerife', 'Canarias', ['tenerife', 'santa cruz de tenerife', 'la palma', 'la gomera', 'el hierro']],
    ['Cantabria', 'Cantabria', ['cantabria', 'santander', 'torrelavega', 'castro urdiales', 'ason', 'laredo']],
    ['Albacete', 'Castilla-La Mancha', ['albacete', 'hellin', 'almansa', 'villarrobledo']],
    ['Ciudad Real', 'Castilla-La Mancha', ['ciudad real', 'puertollano', 'alcazar', 'valdepenas', 'tomelloso', 'manzanares']],
    ['Cuenca', 'Castilla-La Mancha', ['cuenca', 'motilla']],
    ['Guadalajara', 'Castilla-La Mancha', ['guadalajara']],
    ['Toledo', 'Castilla-La Mancha', ['toledo', 'talavera']],
    ['Ávila', 'Castilla y León', ['avila']],
    ['Burgos', 'Castilla y León', ['burgos', 'aranda', 'miranda']],
    ['León', 'Castilla y León', ['leon', 'bierzo', 'ponferrada', 'astorga']],
    ['Palencia', 'Castilla y León', ['palencia']],
    ['Salamanca', 'Castilla y León', ['salamanca', 'bejar']],
    ['Segovia', 'Castilla y León', ['segovia']],
    ['Soria', 'Castilla y León', ['soria']],
    ['Valladolid', 'Castilla y León', ['valladolid', 'medina del campo', 'medina', 'penafiel']],
    ['Zamora', 'Castilla y León', ['zamora', 'benavente']],
    ['Barcelona', 'Cataluña', ['barcelona', 'manresa', 'terrassa', 'sabadell', 'mataro', 'granollers', 'vic', 'badalona', 'hospitalet', 'igualada', 'sant cugat']],
    ['Girona', 'Cataluña', ['girona', 'gerona', 'figueres', 'olot', 'costa brava']],
    ['Lleida', 'Cataluña', ['lleida', 'lerida']],
    ['Tarragona', 'Cataluña', ['tarragona', 'reus', 'ebre', 'tortosa']],
    ['Ceuta', 'Ceuta', ['ceuta']],
    ['Alicante', 'Comunidad Valenciana', ['alicante', 'alacant', 'elche', 'elx', 'alcoy', 'alcoi', 'denia', 'elda', 'benidorm', 'orihuela', 'torrevieja', 'villena']],
    ['Castellón', 'Comunidad Valenciana', ['castellon', 'castello', 'vinaros']],
    ['Valencia', 'Comunidad Valenciana', ['valencia', 'gandia', 'xativa', 'sagunto', 'alzira']],
    ['Badajoz', 'Extremadura', ['badajoz', 'merida', 'tierra de barros', 'vegas altas', 'don benito', 'zafra', 'almendralejo']],
    ['Cáceres', 'Extremadura', ['caceres', 'plasencia', 'norte de extremadura', 'navalmoral']],
    ['A Coruña', 'Galicia', ['a coruna', 'la coruna', 'coruna', 'santiago', 'ferrol']],
    ['Lugo', 'Galicia', ['lugo']],
    ['Ourense', 'Galicia', ['ourense', 'orense']],
    ['Pontevedra', 'Galicia', ['pontevedra', 'vigo', 'arosa', 'baixo mino', 'vilagarcia']],
    ['La Rioja', 'La Rioja', ['logrono', 'calahorra', 'haro', 'arnedo']],
    ['Madrid', 'Madrid', ['madrid', 'henares', 'alcala de henares', 'getafe', 'mostoles', 'fuenlabrada', 'leganes', 'alcorcon', 'villalba']],
    ['Melilla', 'Melilla', ['melilla']],
    ['Murcia', 'Murcia', ['murcia', 'cartagena', 'lorca', 'arco norte', 'espuna', 'jumilla', 'yecla']],
    ['Navarra', 'Navarra', ['pamplona', 'tudela', 'estella', 'tafalla']],
    ['Álava', 'País Vasco', ['alava', 'araba', 'vitoria', 'gasteiz']],
    ['Gipuzkoa', 'País Vasco', ['gipuzkoa', 'guipuzcoa', 'san sebastian', 'donostia', 'eibar', 'irun']],
    ['Bizkaia', 'País Vasco', ['bizkaia', 'vizcaya', 'bilbao', 'biscay']]
  ];
  const PROVINCE_COMMUNITY = new Map(PROVINCES.map(([p, c]) => [p, c]));
  // Alias → provincia, de más largo a más corto (así «palma del rio» gana a «palma»).
  const PROVINCE_ALIASES = [];
  for (const [p, , aliases] of PROVINCES) {
    PROVINCE_ALIASES.push([norm(p), p]);
    for (const a of aliases) PROVINCE_ALIASES.push([a, p]);
  }
  PROVINCE_ALIASES.sort((a, b) => b[0].length - a[0].length);
  const COMMUNITY_ALIASES = [];
  for (const [c, aliases] of Object.entries(COMMUNITIES)) {
    COMMUNITY_ALIASES.push([norm(c), c]);
    for (const a of aliases) COMMUNITY_ALIASES.push([a, c]);
  }
  COMMUNITY_ALIASES.sort((a, b) => b[0].length - a[0].length);

  function communityOf(text) {
    const t = ' ' + norm(text) + ' ';
    for (const [a, c] of COMMUNITY_ALIASES) if (t.includes(' ' + a + ' ')) return c;
    return '';
  }
  function provincesIn(text) {
    // Se quitan antes los nombres de comunidades (que «Castilla y León» no cuente como León).
    let t = ' ' + norm(text) + ' ';
    for (const [a] of COMMUNITY_ALIASES) {
      if (a.length > 6 || a === 'rioja') t = t.split(' ' + a + ' ').join('  ');
    }
    const out = new Set();
    for (const [a, p] of PROVINCE_ALIASES) {
      const k = ' ' + a + ' ';
      if (t.includes(k)) {
        out.add(p);
        t = t.split(k).join('  ');
      }
    }
    return out;
  }

  // --- Cadenas ----------------------------------------------------------------
  const NETWORKS = [
    ['cadena ser', 'Cadena SER', /\b(cadena ser|ser)\b/, /^(s_|cadenas\.)/i, ['ser', 'cadena']],
    ['cope', 'COPE', /\bcope\b/, /^cope/i, ['cope']],
    ['onda cero', 'Onda Cero', /\bonda cero\b/, /^(oc_|ondacero)/i, ['onda', 'cero']],
    ['rne', 'RNE', /\b(rne|radio nacional|radio exterior|radio 3|radio 5|radio clasica|radio 4)\b/, /^(rne|radio4rne)/i, ['rne', 'nacional']],
    ['los40', 'LOS40', /\b(los ?40|els ?40|40 principales)\b/, /^los40/i, ['los40', '40', 'principales']],
    ['cadena dial', 'Cadena Dial', /\bdial\b/, /^cadenadial/i, ['dial']],
    ['cadena 100', 'Cadena 100', /\bcadena 100\b/, /^cadena100/i, ['cadena100', '100']],
    ['rock fm', 'Rock FM', /\brock ?fm\b/, /^rockfm/i, ['rockfm', 'rock']],
    ['kiss fm', 'Kiss FM', /\bkiss ?fm\b/, /^kissfm/i, ['kissfm', 'kiss']],
    ['europa fm', 'Europa FM', /\beuropa ?fm\b/, /^europafm/i, ['europafm', 'europa']],
    ['megastar', 'MegaStar FM', /\bmega ?star\b/, /^megastar/i, ['megastar']],
    ['radiole', 'Radiolé', /\bradiole\b/, /^radiole/i, ['radiole']],
    ['esradio', 'esRadio', /\besradio\b/, /^esradio/i, ['esradio']],
    ['radio marca', 'Radio Marca', /\b(radio marca|marca)\b/, /^marca/i, ['marca']],
    ['canal sur', 'Canal Sur', /\b(canal sur|flamenco radio|radio andalucia informacion)\b/, /^canalsur/i, ['canalsur', 'canal', 'sur']]
  ];
  const NETWORK_LABEL = Object.fromEntries(NETWORKS.map(n => [n[0], n[1]]));
  function networkOf(s, nameN) {
    const epg = String(s.epg_id || '');
    const net = norm(s.network);
    for (const [key, , re, epgRe] of NETWORKS) {
      if (net && (net === key || re.test(net))) return key;
      if (epg && epgRe.test(epg)) return key;
      if (re.test(nameN)) return key;
    }
    return '';
  }

  // --- Tipos ------------------------------------------------------------------
  const AUTONOMICAS =
    /\b(canal sur|catalunya radio|catalunya musica|catalunya informacio|3cat|icat|ib3|a punt|aragon radio|cmm|canal extremadura|radio galega|son galicia|euskadi irratia|radio euskadi|radio vitoria|gaztea|eitb|rpa|canarias radio|onda madrid|onda regional|rtvce|7 rm)\b/;
  const TYPE_RULES = {
    informativa: {
      nets: ['cadena ser', 'cope', 'onda cero', 'esradio'],
      re: /\b(radio nacional|radio 5|noticias|informacion|informacio|3catinfo|generalista|rac 1|rac1|canal sur radio|catalunya radio|radio euskadi|radio galega|onda madrid|aragon radio|a punt radio|ib3 radio|canarias radio|cmm radio|canal extremadura radio|rpa)\b/,
      ambit: /populares/
    },
    musical: {
      nets: ['los40', 'cadena dial', 'cadena 100', 'rock fm', 'kiss fm', 'europa fm', 'megastar', 'radiole'],
      re: /\b(radio 3|musica|music|hits?|dance|rock|pop|flamenco|jazz|clasica|classic|oldies|latina|latino|reggaeton|techno|chill|lounge|ibiza|80s|90s|melodia|loca fm|hit fm|maxima|gaztea|son galicia|rac 105)\b/,
      ambit: /musicales/
    },
    deportiva: {
      nets: ['radio marca'],
      re: /\b(deporte|deportes|deportiva|sport|sports|esports|futbol|fc radio|cf radio|betis|osasuna|sevilla fc|valencia cf|ud almeria)\b/,
      ambit: /deportivas/
    },
    autonomica: { nets: ['canal sur'], re: AUTONOMICAS, ambit: null },
    tematica: {
      nets: [],
      re: /\b(infantil|ninos|babyradio|antenita|cuentos|nanas|religion|catolica|radio maria|esperanza|evangelica|clasica|cultura|cultural|flamenco|jazz|poesia)\b/,
      ambit: /infantiles/
    }
  };
  function typesOf(nameN, tagsN, net, ambitN) {
    const out = new Set();
    for (const [type, r] of Object.entries(TYPE_RULES)) {
      if ((net && r.nets.includes(net)) || r.re.test(nameN) || (tagsN && r.re.test(tagsN)) || (r.ambit && r.ambit.test(ambitN)))
        out.add(type);
    }
    // RNE: Radio 3 y Clásica son musicales; Radio Nacional y Radio 5, informativas.
    if (net === 'rne' && !out.has('musical')) out.add('informativa');
    return out;
  }

  const NATIONAL_AMBITS = /^(populares|musicales|deportivas|infantiles|internacional)$/;

  // --- Preparación del catálogo -------------------------------------------
  function prepare(s) {
    if (s.__rv && s.__rv.v === 2) return s.__rv;
    const nameN = norm(s.name);
    const ambitN = norm(s.ambit || s.__ambit || '');
    const net = networkOf(s, nameN);
    let community = s.community || '';
    const stateN = norm(s.state);
    const provs = provincesIn([s.name, s.city].join(' '));
    // El campo «state» puede traer una provincia (catálogo local, radio-browser) o una comunidad.
    if (stateN) {
      const fromState = provincesIn(s.state);
      const commState = communityOf(s.state);
      if (fromState.size && !commState) fromState.forEach(p => provs.add(p));
      if (!community && commState) community = commState;
    }
    if (!community && ambitN && !NATIONAL_AMBITS.test(ambitN)) community = communityOf(ambitN);
    if (!community && provs.size === 1) community = PROVINCE_COMMUNITY.get([...provs][0]) || '';
    let scope = 'nacional';
    if (provs.size) scope = 'local';
    else if (community) scope = 'autonomica';
    else if (ambitN && !NATIONAL_AMBITS.test(ambitN)) scope = 'autonomica';
    const tagsN = norm(s.tags);
    const types = typesOf(nameN, tagsN, net, ambitN);
    if (scope === 'autonomica' && AUTONOMICAS.test(nameN)) types.add('autonomica');
    // Palabras buscables con su peso (el nombre pesa más).
    const words = new Map();
    const add = (text, w) => {
      for (const t of norm(text).split(' ')) if (t && (!words.has(t) || words.get(t) < w)) words.set(t, w);
    };
    add(s.name, 3);
    add(nameN.replace(/\s+/g, ''), 3);
    if (net) {
      add(NETWORK_LABEL[net], 2);
      for (const syn of NETWORKS.find(n => n[0] === net)[4]) add(syn, 2);
    }
    add(s.city, 1.5);
    provs.forEach(p => add(p, 1.5));
    add(community, 1);
    add(s.tags, 0.6);
    types.forEach(t => add(t, 0.4));
    // Orden de las nacionales cuando no hay texto: generalistas, musicales, deportivas…
    const rank = /populares/.test(ambitN) ? 0 : /musicales/.test(ambitN) ? 1 : /deportivas/.test(ambitN) ? 2 : /infantiles/.test(ambitN) ? 4 : 3;
    const freq = String(s.freq || '').replace(',', '.').trim();
    s.__rv = { v: 2, nameN, compact: nameN.replace(/\s+/g, ''), net, community, provinces: provs, scope, types, words, rank, freq };
    return s.__rv;
  }

  // --- Coincidencia de texto ----------------------------------------------------
  const STOP = new Set(['de', 'la', 'el', 'las', 'los', 'del', 'y', 'en', 'en']);
  const OPTIONAL = new Set(['radio', 'fm', 'emisora', 'emisoras', 'cadena', 'am']);
  function lev1(a, b, max) {
    // Distancia de edición acotada (para tolerar una o dos erratas).
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const prev = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      let diag = prev[0];
      prev[0] = i;
      let best = prev[0];
      for (let j = 1; j <= b.length; j++) {
        const tmp = prev[j];
        prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
        diag = tmp;
        if (prev[j] < best) best = prev[j];
      }
      if (best > max) return max + 1;
    }
    return prev[b.length];
  }
  function tokenScore(tok, words) {
    let best = 0;
    const isNum = /^\d+$/.test(tok);
    for (const [w, weight] of words) {
      let sc = 0;
      if (w === tok) sc = 3;
      else if (!isNum && tok.length >= 2 && w.startsWith(tok)) sc = 2;
      else if (!isNum && tok.length >= 4 && w.length >= 4) {
        const max = tok.length >= 7 ? 2 : 1;
        if (lev1(tok, w.slice(0, Math.max(tok.length, Math.min(w.length, tok.length + 1))), max) <= max || lev1(tok, w, max) <= max) sc = 1;
      }
      if (sc) best = Math.max(best, sc * weight);
      if (best >= 9) break;
    }
    return best;
  }
  function textScore(rv, qN, qRaw) {
    if (!qN) return 1;
    // Frecuencia («93.2», «93,2», «93.2 fm»): se compara completa.
    const fm = String(qRaw || '').trim().toLowerCase().replace(/\s*(fm|mhz)$/, '').replace(',', '.');
    if (/^\d{2,3}(\.\d{1,2})?$/.test(fm) && fm.includes('.')) return rv.freq && rv.freq === fm ? 50 : 0;
    let toks = qN.split(' ').filter(t => t && !STOP.has(t));
    if (!toks.length) toks = qN.split(' ').filter(Boolean);
    const required = toks.filter(t => !OPTIONAL.has(t));
    const optional = toks.filter(t => OPTIONAL.has(t));
    const reqs = required.length ? required : optional;
    let total = 0;
    for (const t of reqs) {
      const sc = tokenScore(t, rv.words);
      if (!sc) {
        // «los40», «rockfm»: la consulta pegada también vale contra el nombre compacto.
        if (t.length >= 3 && rv.compact.includes(t)) total += 4;
        else return 0;
      } else total += sc;
    }
    for (const t of optional) if (reqs !== optional) total += tokenScore(t, rv.words) * 0.3;
    const qc = qN.replace(/\s+/g, '');
    if (rv.nameN === qN || rv.compact === qc) total += 40;
    else if (rv.nameN.startsWith(qN) || rv.compact.startsWith(qc)) total += 15;
    else if (rv.compact.includes(qc) && qc.length >= 3) total += 6;
    return total;
  }

  // --- Filtros -------------------------------------------------------------------
  // location: '' | 'p:<Provincia>' | 'c:<Comunidad>'
  function locationOk(rv, location) {
    if (!location) return true;
    const [kind, value] = [location.slice(0, 2), location.slice(2)];
    if (kind === 'p:') {
      if (rv.provinces.has(value)) return true;
      return !rv.provinces.size && rv.scope === 'autonomica' && rv.community === PROVINCE_COMMUNITY.get(value);
    }
    if (kind === 'c:') {
      if (rv.community === value) return rv.scope !== 'nacional';
      for (const p of rv.provinces) if (PROVINCE_COMMUNITY.get(p) === value) return true;
      return false;
    }
    return true;
  }
  const SCOPE_ORDER = { local: 0, autonomica: 1, nacional: 2 };

  function search(stations, f, favoriteIds) {
    const qN = norm(f.text);
    const out = [];
    for (const s of stations) {
      const rv = prepare(s);
      if (f.network && rv.net !== f.network) continue;
      if (f.type && !rv.types.has(f.type)) continue;
      if (!locationOk(rv, f.location)) continue;
      const sc = textScore(rv, qN, f.text);
      if (!sc) continue;
      let score = sc;
      if (favoriteIds && favoriteIds.has(String(s.uuid || s.stationuuid))) score += 3;
      if (s.logo) score += 0.5;
      if (Array.isArray(s.options) && s.options.length) score += 0.5;
      out.push({ s, rv, score });
    }
    out.sort((a, b) => {
      if (qN && b.score !== a.score) return b.score - a.score;
      // Sin texto: primero lo más cercano (local → autonómica → nacional) si hay
      // filtro de lugar; si no, las nacionales primero.
      const sa = SCOPE_ORDER[a.rv.scope],
        sb = SCOPE_ORDER[b.rv.scope];
      if (sa !== sb) return f.location ? sa - sb : sb - sa;
      if (a.rv.rank !== b.rv.rank) return a.rv.rank - b.rv.rank;
      if (b.score !== a.score) return b.score - a.score;
      return String(a.s.name).localeCompare(String(b.s.name), 'es', { sensitivity: 'base' });
    });
    return dedupe(out).map(x => x.s);
  }

  // Misma emisora en el catálogo local y en el nacional: se queda una, con los datos
  // de las dos (logo y guía del nacional, URL del local).
  function dedupe(list) {
    const seen = new Map();
    const out = [];
    for (const x of list) {
      const k = x.rv.compact + '|' + ([...x.rv.provinces].sort().join(',') || x.rv.community);
      const prev = seen.get(k);
      if (!prev) {
        seen.set(k, x);
        out.push(x);
        continue;
      }
      const a = prev.s,
        b = x.s;
      if (!a.logo && b.logo) a.logo = b.logo;
      if (!a.epg_id && b.epg_id) a.epg_id = b.epg_id;
      if (!a.url && b.url) a.url = b.url;
      if (b.options?.length) {
        const urls = new Set((a.options || []).map(o => o.url));
        a.options = [...(a.options || []), ...b.options.filter(o => o?.url && !urls.has(o.url))];
      }
    }
    return out;
  }

  // Texto corto de dónde es una emisora (para la tarjeta).
  function placeLabel(s) {
    const rv = prepare(s);
    if (s.city) return s.city;
    if (rv.provinces.size) return [...rv.provinces].join(', ');
    if (rv.community) return rv.community;
    return 'España';
  }

  window.RVBuscador = {
    norm,
    prepare,
    search,
    placeLabel,
    networks: NETWORKS.map(n => [n[0], n[1]]),
    provinces: PROVINCES.map(([p, c]) => [p, c]),
    communities: Object.keys(COMMUNITIES).sort((a, b) => a.localeCompare(b, 'es')),
    provinceCommunity: p => PROVINCE_COMMUNITY.get(p) || ''
  };
})();
