const APP_VERSION = window.RV_VERSION?.version || '0';
const APP_BUILD = String(window.RV_VERSION?.build || '0');
const STORAGE_KEY = 'mis_radios_favoritas_v1';
const LOGO_CACHE_KEY = 'radio_espana_logos_v1';
const GLOBAL_SOURCES = {
  'cadena ser': {
    logo: 'https://graph.facebook.com/cadenaser/picture?width=200&height=200',
    options: [
      ['mp3', 'https://playerservices.streamtheworld.com/api/livestream-redirect/CADENASER.mp3'],
      ['aac', 'https://playerservices.streamtheworld.com/api/livestream-redirect/CADENASERAAC.aac']
    ]
  },
  cope: {
    logo: 'https://graph.facebook.com/COPE/picture?width=200&height=200',
    options: [
      ['mp3', 'https://flucast09-h-cloud.flumotion.com/cope/net1.mp3'],
      ['aac', 'https://flucast09-h-cloud.flumotion.com/cope/net1.aac'],
      ['mp3', 'https://flucast31-h-cloud.flumotion.com/cope/net2.mp3']
    ]
  },
  'onda cero': {
    logo: 'https://graph.facebook.com/ondacero/picture?width=200&height=200',
    options: [
      ['aac', 'https://radio-atres-live.ondacero.es/api/livestream-redirect/OCAAC.aac'],
      ['m3u8', 'https://atres-live.ondacero.es/live/ondaceroeventos1/master.m3u8']
    ]
  },
  rne: {
    logo: 'https://graph.facebook.com/radionacionalrne/picture?width=200&height=200',
    options: [['m3u8', 'https://rtvelivestream.rtve.es/rtvesec/rne/rne_r1_main.m3u8']]
  },
  los40: {
    logo: 'https://graph.facebook.com/los40/picture?width=200&height=200',
    options: [
      ['mp3', 'https://playerservices.streamtheworld.com/api/livestream-redirect/Los40.mp3'],
      ['aac', 'https://playerservices.streamtheworld.com/api/livestream-redirect/LOS40AAC.aac']
    ]
  },
  'cadena dial': {
    logo: 'https://graph.facebook.com/cadenadial/picture?width=200&height=200',
    options: [
      ['mp3', 'https://playerservices.streamtheworld.com/api/livestream-redirect/CADENADIAL.mp3'],
      ['aac', 'https://playerservices.streamtheworld.com/api/livestream-redirect/CADENADIALAAC.aac']
    ]
  },
  'rock fm': {
    logo: 'https://graph.facebook.com/RockFM/picture?width=200&height=200',
    options: [['m3u8', 'https://rockfm-cope.flumotion.com/playlist.m3u8']]
  },
  'kiss fm': {
    logo: 'https://graph.facebook.com/kissfm.es/picture?width=200&height=200',
    options: [['mp3', 'https://kissfm.kissfmradio.cires21.com/kissfm.mp3']]
  },
  'europa fm': {
    logo: 'https://graph.facebook.com/tueuropafm/picture?width=200&height=200',
    options: [['aac', 'https://radio-atres-live.ondacero.es/api/livestream-redirect/EFMAAC.aac']]
  },
  'canal sur': {
    logo: 'https://graph.facebook.com/CanalSurRadioAndalucia/picture?width=200&height=200',
    options: [['mp3', 'https://rtva-live-radio.flumotion.com/rtva/csr.mp3']]
  },
  'radio marca': {
    logo: 'https://graph.facebook.com/RadioMARCA/picture?width=200&height=200',
    options: [
      ['mp3', 'https://playerservices.streamtheworld.com/api/livestream-redirect/RADIOMARCA_NACIONAL.mp3'],
      ['aac', 'https://playerservices.streamtheworld.com/api/livestream-redirect/RADIOMARCA_NACIONALAAC.aac']
    ]
  }
};
const TYPE_PATTERNS = {
  musical: [
    'los40',
    'los 40',
    '40 principales',
    'dial',
    'cadena dial',
    'rock fm',
    'kiss fm',
    'europa fm',
    'm80',
    'melodía',
    'melodia',
    'happy fm',
    'radio 3',
    'radio clásica',
    'radio clasica',
    'hit fm',
    'maxima fm',
    'máxima fm',
    'radiolé',
    'radiole',
    'flamenco radio',
    'gaztea',
    'rac 105'
  ],
  informativa: [
    'cadena ser',
    ' ser ',
    'cope',
    'onda cero',
    'rne',
    'radio nacional',
    'radio 1',
    'radio 5',
    'radio exterior',
    'hoy por hoy',
    'hora 25',
    'herrera en cope',
    'más de uno',
    'es la mañana',
    'intereconomía',
    'radio voz',
    'generalista',
    'informativa',
    'noticias'
  ],
  deportiva: [
    'radio marca',
    'marca ',
    'deporte',
    'deportes',
    'esport',
    'tiempo de juego',
    'partido de las 12',
    'al primer toque',
    'taller deportivo',
    'carrusel deportivo',
    'ser deportes',
    'cope deportes',
    'radio deportiva',
    'futbol',
    'fútbol',
    'sport',
    'depor'
  ],
  autonomica: [
    'catalunya ràdio',
    'catalunya radio',
    'rac1',
    'rac 1',
    'radio euskadi',
    'euskadi irratia',
    'gaztea',
    'eitb',
    'radio galega',
    'aragón radio',
    'aragon radio',
    'ib3',
    'onda madrid',
    'à punt',
    'apunt',
    'radio canarias',
    'rtvc',
    'canal sur',
    'rva',
    'radio asturias',
    'rpa',
    'cyl radio',
    'radio la rioja',
    'radio navarra'
  ],
  tematica: [
    'jazz',
    'flamenco',
    'clásica',
    'clasica',
    'cultural',
    'religión',
    'religion',
    'radio maria',
    'chillout',
    'lounge',
    'ibiza',
    'café del mar',
    'cafe del mar',
    'indie',
    'electrónica',
    'electronica',
    'house',
    'techno',
    'reggaeton',
    'latina',
    'tropical',
    'salsa',
    'bachata',
    'rumba'
  ]
};
const NETWORK_PATTERNS = {
  'cadena ser': ['ser', 'cadena ser'],
  cope: ['cope'],
  'onda cero': ['onda cero'],
  rne: ['rne', 'radio nacional', 'rtve', 'radio 1', 'radio 3', 'radio 5'],
  los40: ['los40', 'los 40', '40 principales'],
  'cadena dial': ['dial', 'cadena dial', 'cadenadial'],
  'rock fm': ['rock fm'],
  'kiss fm': ['kiss fm'],
  'europa fm': ['europa fm'],
  'canal sur': ['canal sur', 'rva'],
  'radio marca': ['radio marca', 'marca']
};
let stations = [];
let loadedStations = [];
let catalogPromise = null;
let catalogReady = false;
let favorites = [];
let currentStation = null;
let currentView = 'fav';
let requestSeq = 0;
let hls = null;
let metadataTimer = null;
let programTimer = null;
let logoCache = {};
let currentStreamUrl = '';
let previousVolume = 0.8;
let reconnectTimer = null;
let reconnectAttempts = 0;
let radioWatchdogTimer = null;
let radioWatchdogLastTime = 0;
let radioWatchdogStalls = 0;
let metadataBusy = false;
const favGrid = document.getElementById('favGrid'),
  stationsGrid = document.getElementById('stationsGrid'),
  audio = document.getElementById('audioPlayer'),
  currentNameEl = document.getElementById('currentStationName'),
  statusEl = document.getElementById('playerStatus'),
  nowPlayingEl = document.getElementById('nowPlayingTrack'),
  programNowEl = document.getElementById('programNow'),
  programNextEl = document.getElementById('programNext'),
  favCountEl = document.getElementById('favCount'),
  activeFiltersEl = document.getElementById('activeFilters');
function normalizar(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}
function slug(v) {
  return normalizar(v).replace(/[^a-z0-9]+/g, ' ');
}
function escapeHtml(v) {
  return String(v ?? '').replace(
    /[&<>'"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]
  );
}
function coincide(texto, patrones) {
  const t = normalizar(texto);
  return patrones.some(p => t.includes(normalizar(p)));
}
function networkKey(s) {
  const t = normalizar((s.network || '') + ' ' + (s.name || '') + ' ' + (s.tags || ''));
  for (const [k, ps] of Object.entries(NETWORK_PATTERNS)) if (coincide(t, ps)) return k;
  return '';
}
function detectarCadena(s) {
  const k = networkKey(s);
  const names = {
    'cadena ser': ['chain-ser', 'SER'],
    cope: ['chain-cope', 'COPE'],
    'onda cero': ['chain-ondacero', 'ONDA CERO'],
    rne: ['chain-rne', 'RNE'],
    los40: ['chain-los40', 'LOS40'],
    'cadena dial': ['chain-dial', 'DIAL'],
    'rock fm': ['chain-rockfm', 'ROCK FM'],
    'kiss fm': ['chain-kissfm', 'KISS FM'],
    'europa fm': ['chain-europafm', 'EUROPA FM'],
    'canal sur': ['chain-canalsur', 'CANAL SUR'],
    'radio marca': ['chain-marca', 'MARCA']
  };
  return (
    names[k] || [
      'chain-default',
      (s.name || 'RADIO')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .map(x => x[0])
        .join('')
        .toUpperCase() || 'RADIO'
    ]
  );
}
function logoFor(s) {
  if (s.logo) return s.logo;
  if (s.favicon) return s.favicon;
  const k = networkKey(s);
  return GLOBAL_SOURCES[k]?.logo || '';
}
function construirLogo(s) {
  const [clase, texto] = detectarCadena(s);
  const logo = logoFor(s);
  const safeLogo = logo ? escapeHtml(logo) : '';
  return `<div class="chain-logo ${clase}">${safeLogo ? `<img src="${safeLogo}" alt="Logo ${escapeHtml(s.name)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement&&this.parentElement.classList.add('logo-fallback');this.remove()">` : ''}<span class="logo-fallback-text">${escapeHtml(texto)}</span></div>`;
}
function obtenerFiltros() {
  return {
    network: document.getElementById('selectNetwork').value.trim(),
    location: document.getElementById('selectLocation').value.trim(),
    type: document.getElementById('selectType').value.trim(),
    text: document.getElementById('textSearch').value.trim()
  };
}
function etiquetaSelect(id) {
  const sel = document.getElementById(id);
  return sel?.selectedOptions?.[0]?.textContent?.replace(/^[^\p{L}\p{N}]+/u, '').trim() || '';
}
// Chips de filtros activos; cada uno se puede quitar tocándolo.
function actualizarChips() {
  const f = obtenerFiltros(),
    chips = [];
  const chip = (id, label, value) =>
    `<button type="button" class="chip" data-clear="${id}" aria-label="Quitar filtro ${escapeHtml(label)}"><span class="chip-label">${escapeHtml(label)}:</span> ${escapeHtml(value)} ✕</button>`;
  if (f.text) chips.push(chip('textSearch', 'Texto', f.text));
  if (f.network) chips.push(chip('selectNetwork', 'Cadena', etiquetaSelect('selectNetwork')));
  if (f.location) chips.push(chip('selectLocation', 'Lugar', etiquetaSelect('selectLocation')));
  if (f.type) chips.push(chip('selectType', 'Tipo', etiquetaSelect('selectType')));
  activeFiltersEl.hidden = !chips.length;
  activeFiltersEl.innerHTML = chips.join('');
}
// Cadenas y lugares salen del buscador, así el desplegable y la búsqueda coinciden.
function rellenarSelectoresRadio() {
  if (!window.RVBuscador) return;
  const net = document.getElementById('selectNetwork');
  if (net && net.options.length <= 1)
    net.insertAdjacentHTML('beforeend', RVBuscador.networks.map(([k, label]) => `<option value="${escapeHtml(k)}">${escapeHtml(label)}</option>`).join(''));
  const loc = document.getElementById('selectLocation');
  if (loc && loc.options.length <= 1) {
    const groups = RVBuscador.communities.map(c => {
      const provs = RVBuscador.provinces.filter(([, cc]) => cc === c).map(([p]) => p).sort((a, b) => a.localeCompare(b, 'es'));
      const opts = [`<option value="c:${escapeHtml(c)}">${escapeHtml(c)} (toda)</option>`];
      if (!(provs.length === 1 && provs[0] === c))
        provs.forEach(p => opts.push(`<option value="p:${escapeHtml(p)}">${escapeHtml(p)}</option>`));
      return `<optgroup label="${escapeHtml(c)}">${opts.join('')}</optgroup>`;
    });
    loc.insertAdjacentHTML('beforeend', groups.join(''));
  }
}
function favoriteIdSet() {
  return new Set(favorites.map(stationId).filter(Boolean));
}
function setStatus(t) {
  stationsGrid.innerHTML = `<div class="status-msg">${t}</div>`;
}
// Búsqueda: catálogo principal al instante y, si hay texto, también radio-browser
// (emisoras pequeñas o locales que no están en el catálogo principal).
const RADIO_PAGE = 60;
let radioShown = RADIO_PAGE;
let radioRemote = [];
const radioRemoteCache = new Map();
async function aplicarFiltros() {
  const seq = ++requestSeq;
  const f = obtenerFiltros();
  actualizarChips();
  radioShown = RADIO_PAGE;
  radioRemote = [];
  loadedStations = window.RVBuscador ? RVBuscador.search(stations, f, favoriteIdSet()) : stations.slice();
  renderSearch();
  const q = f.text;
  if (q.length < 3 || !window.RVBuscador) return;
  // radio-browser, sin bloquear los resultados que ya se ven.
  const key = RVBuscador.norm(q);
  let remote = radioRemoteCache.get(key);
  if (!remote) {
    try {
      const r = await fetch('/api/radio-search?q=' + encodeURIComponent(q));
      remote = r.ok ? (await r.json()).stations || [] : [];
      radioRemoteCache.set(key, remote);
    } catch {
      remote = [];
    }
  }
  if (seq !== requestSeq) return;
  const known = new Set(loadedStations.map(x => RVBuscador.prepare(x).compact));
  radioRemote = RVBuscador.search(remote, f, null).filter(x => !known.has(RVBuscador.prepare(x).compact));
  if (radioRemote.length) renderSearch();
}
let aplicarFiltrosTimer = null;
function aplicarFiltrosPronto() {
  clearTimeout(aplicarFiltrosTimer);
  aplicarFiltrosTimer = setTimeout(aplicarFiltros, 250);
}
function renderSearch() {
  const frag = document.createDocumentFragment();
  const f = obtenerFiltros();
  const total = loadedStations.length;
  if (!total && !radioRemote.length) {
    const hayFiltros = f.network || f.location || f.type;
    stationsGrid.innerHTML = `<div class="status-msg">⚠️ No se encontraron emisoras${f.text ? ` para «${escapeHtml(f.text)}»` : ''}.<br><small>${
      hayFiltros ? 'Prueba a quitar algún filtro (toca un filtro amarillo para quitarlo).' : 'Prueba con otra palabra o revisa cómo está escrita.'
    }${!catalogReady ? '<br>El catálogo nacional aún se está cargando…' : ''}</small></div>`;
    return;
  }
  const head = document.createElement('div');
  head.className = 'search-count';
  head.textContent = `${total} emisora${total === 1 ? '' : 's'}${!catalogReady ? ' · cargando catálogo nacional…' : ''}`;
  frag.appendChild(head);
  loadedStations.slice(0, radioShown).forEach((s, i) => frag.appendChild(cardFor(s, i, false)));
  if (total > radioShown) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'search-more';
    more.textContent = `Ver más (${total - radioShown})`;
    more.onclick = () => {
      radioShown += RADIO_PAGE * 2;
      const sc = stationsGrid.scrollTop;
      renderSearch();
      stationsGrid.scrollTop = sc;
    };
    frag.appendChild(more);
  }
  if (radioRemote.length) {
    const h = document.createElement('div');
    h.className = 'search-count search-remote-head';
    h.textContent = `Más emisoras (radio-browser): ${radioRemote.length}`;
    frag.appendChild(h);
    radioRemote.slice(0, 40).forEach((s, i) => frag.appendChild(cardFor(s, total + i, false)));
  }
  stationsGrid.replaceChildren(frag);
}
function stationId(s) {
  return String(s?.uuid || s?.stationuuid || '').trim();
}
function cardFor(s, i, favMode = false) {
  const sid = stationId(s);
  const isFav =
      !!sid &&
      favorites.some(f => {
        const fid = stationId(f);
        return !!fid && fid === sid;
      }),
    isCur =
      currentStation && (currentStation.uuid === s.uuid || currentStation.stationuuid === s.stationuuid);
  const card = document.createElement('div');
  card.className = 'station-card' + (isCur ? ' playing' : '');
  card.dataset.uuid = s.uuid || s.stationuuid;
  card.dataset.index = i;
  card.innerHTML = `${favMode ? `<div class="drag-handle">⋮⋮</div>` : ''}<button class="fav-btn ${isFav ? 'is-fav' : ''}" aria-label="${isFav ? 'Quitar de favoritas' : 'Añadir a favoritas'}">★</button>${construirLogo(s)}<div class="station-name">${escapeHtml(s.name)}</div><div class="station-tag">${escapeHtml(window.RVBuscador ? RVBuscador.placeLabel(s) : s.city || s.state || 'España')}</div>`;
  card.addEventListener('click', () => reproducirRadio(s));
  card.querySelector('.fav-btn').addEventListener('click', e => {
    e.stopPropagation();
    toggleFav(s.uuid || s.stationuuid, card);
  });
  if (favMode) setupFavSortable(card);
  return card;
}
function renderFavoritas() {
  const frag = document.createDocumentFragment();
  if (!favorites.length) {
    favGrid.innerHTML =
      '<div class="status-msg big"><div class="empty-icon">⭐</div><h2>Sin favoritas</h2><p>Pulsa "🔍 Buscar" y añade con ★</p></div>';
    return;
  }
  favorites.forEach((s, i) => frag.appendChild(cardFor(s, i, true)));
  favGrid.replaceChildren(frag);
}
function updatePlayingCards() {
  document
    .querySelectorAll('.station-card')
    .forEach(c =>
      c.classList.toggle(
        'playing',
        !!currentStation &&
          (c.dataset.uuid === currentStation.uuid || c.dataset.uuid === currentStation.stationuuid)
      )
    );
}
function toggleFav(id, card) {
  id = String(id || '').trim();
  if (!id) return;
  const idx = favorites.findIndex(f => stationId(f) === id);
  if (idx >= 0) {
    favorites.splice(idx, 1);
  } else {
    const s =
      stations.find(x => stationId(x) === id) ||
      loadedStations.find(x => stationId(x) === id) ||
      radioRemote.find(x => stationId(x) === id);
    if (s) favorites.push({ ...s });
  }
  saveFavorites();
  const fav = favorites.some(f => (f.uuid || f.stationuuid) === id);
  if (card) {
    card.querySelector('.fav-btn')?.classList.toggle('is-fav', fav);
    card
      .querySelector('.fav-btn')
      ?.setAttribute('aria-label', fav ? 'Quitar de favoritas' : 'Añadir a favoritas');
  }
  if (currentView === 'fav' && !fav) renderFavoritas();
}
function saveFavorites() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
  favCountEl.textContent = favorites.length;
}
function loadFavorites() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || '[]';
    const x = JSON.parse(raw);
    const list = Array.isArray(x) ? x : [];
    const seen = new Set();
    favorites = list.filter(f => {
      const id = stationId(f);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
  } catch {
    favorites = [];
  }
  favCountEl.textContent = favorites.length;
}

function configurarGestoRadiosPodcasts() {
  let sx = 0,
    sy = 0,
    tracking = false;
  const ignorar = el => {
    if (!el) return true;
    return !!el.closest(
      'input,textarea,select,button,a,[contenteditable="true"],.player-bar,.pod-expanded,.dragging,.settings-menu'
    );
  };
  const enMenuPrincipal = () => {
    const fav = document.getElementById('viewFav'),
      pods = document.getElementById('viewPodcasts'),
      search = document.getElementById('viewSearch');
    if (search?.classList.contains('active')) return false;
    if (fav?.classList.contains('active')) return true;
    if (pods?.classList.contains('active')) {
      const screen = window.podcastState?.screen;
      return (
        screen === 'landing' &&
        !document.body.classList.contains('podcast-detail-active') &&
        !document.body.classList.contains('podcast-results-active') &&
        !document.body.classList.contains('podcast-subs-fullscreen')
      );
    }
    return false;
  };
  document.addEventListener(
    'touchstart',
    e => {
      if (e.touches.length !== 1 || ignorar(e.target) || !enMenuPrincipal()) {
        tracking = false;
        return;
      }
      const t = e.touches[0];
      sx = t.clientX;
      sy = t.clientY;
      tracking = true;
    },
    { passive: true }
  );
  document.addEventListener(
    'touchend',
    e => {
      if (!tracking || !e.changedTouches.length) return;
      tracking = false;
      if (!enMenuPrincipal()) return;
      const t = e.changedTouches[0],
        dx = t.clientX - sx,
        dy = t.clientY - sy;
      if (Math.abs(dx) < 65 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
      const pods = document.getElementById('viewPodcasts');
      if (dx < 0) {
        if (pods?.classList.contains('active') && typeof window.switchToRadios === 'function')
          window.switchToRadios();
      } else {
        if (!pods?.classList.contains('active') && typeof window.switchToPodcasts === 'function')
          window.switchToPodcasts();
      }
    },
    { passive: true }
  );
}

function cambiarVista(v) {
  currentView = v;
  if (v === 'fav' || v === 'search') {
    document.body.classList.remove(
      'podcasts-active',
      'podcast-detail-active',
      'podcast-subs-fullscreen',
      'podcast-results-active'
    );
  }
  const fav = document.getElementById('viewFav'),
    search = document.getElementById('viewSearch');
  fav?.classList.toggle('active', v === 'fav');
  search?.classList.toggle('active', v === 'search');
  document.getElementById('btnViewRadios')?.classList.toggle('active', v === 'fav' || v === 'search');
  if (v === 'fav') renderFavoritas();
  else if (loadedStations.length) renderSearch();
  else aplicarFiltros();
}
function fuentesLocales(s) {
  const out = [];
  if (Array.isArray(s.options)) s.options.forEach(o => out.push(o));
  if (s.url_resolved) out.push({ format: 'stream', url: s.url_resolved });
  if (s.url) out.push({ format: 'stream', url: s.url });
  const k = networkKey(s);
  (GLOBAL_SOURCES[k]?.options || []).forEach(([format, url]) => out.push({ format, url }));
  const seen = new Set();
  return out.filter(o => o?.url && /^https?:\/\//i.test(o.url) && !seen.has(o.url) && seen.add(o.url));
}
async function resolveRemote(s) {
  try {
    const p = new URLSearchParams({
      name: s.name,
      state: s.state || '',
      network: s.network || networkKey(s)
    });
    const r = await fetch('/api/resolve?' + p.toString(), { cache: 'no-store' });
    if (!r.ok) return null;
    const d = await r.json();
    return d.station || null;
  } catch {
    return null;
  }
}
function esHls(u) {
  return /\.m3u8(?:$|\?)/i.test(u);
}
function clearHls() {
  if (hls) {
    try {
      hls.destroy();
    } catch {}
    hls = null;
  }
}
// --- Reproducción de radio -------------------------------------------------
// Cada llamada a reproducirRadio abre una «sesión» con un token. Cualquier
// trabajo asíncrono de una sesión anterior (resolver el stream, probar fuentes,
// reconectar) se descarta en cuanto el token deja de ser el actual. Así, si se
// cambia rápido de emisora, la búsqueda anterior no puede «ganar».
const RADIO_MAX_RECONNECTS = 8;
let radioToken = 0;
let radioConnecting = false;
let radioUserPaused = false;
let radioPollingFor = null;
// true solo mientras la radio está sonando de verdad; una pausa con esto a
// false es interna (cambio de fuente, corte detectado) y no del usuario.
let radioWasPlaying = false;
let radioReconnectPending = false;
// --- Interrupciones del sistema ------------------------------------------------
// Una notificación con sonido, una llamada o el asistente de voz hacen que el
// WebView pause el audio. Antes eso se trataba como si lo hubiera pausado el
// usuario: se avisaba a Android, el servicio en primer plano se soltaba y, ya en
// segundo plano, Android no dejaba recuperarlo (la radio acababa cortándose).
// Ahora se distingue: pausa del usuario → en pausa; pausa del sistema → se mantiene
// «sonando» y se reanuda sola cuando termina la interrupción.
window.__rvLastGesture = 0;
['pointerdown', 'keydown'].forEach(t =>
  document.addEventListener(t, () => (window.__rvLastGesture = Date.now()), { capture: true, passive: true })
);
window.rvPausaDelUsuario = function () {
  return !document.hidden && Date.now() - window.__rvLastGesture < 1500;
};
// ¿Se puede volver a sonar? No durante una llamada ni mientras otra app suena.
window.rvPuedeReanudar = function (elapsed) {
  try {
    if (typeof window.Android?.canResumeAudio === 'function') return !!window.Android.canResumeAudio();
  } catch {}
  return elapsed > 5000; // APK antiguo: se espera un poco más
};
const RV_INTERRUPCION_MAX = 15 * 60 * 1000;
let radioInterrupted = 0;
let radioInterruptTimer = null;
function finInterrupcionRadio() {
  radioInterrupted = 0;
  clearInterval(radioInterruptTimer);
  radioInterruptTimer = null;
}
function iniciarInterrupcionRadio() {
  radioInterrupted = Date.now();
  clearRadioWatchdog();
  clearTimeout(reconnectTimer);
  radioReconnectPending = false;
  statusEl.textContent = '⏸ Interrumpida · se reanudará sola';
  clearInterval(radioInterruptTimer);
  radioInterruptTimer = setInterval(() => {
    if (!radioInterrupted || !currentStation) return finInterrupcionRadio();
    if (!audio.paused) return finInterrupcionRadio();
    const t = Date.now() - radioInterrupted;
    if (t > RV_INTERRUPCION_MAX) {
      // Demasiado tiempo: queda en pausa normal.
      finInterrupcionRadio();
      radioUserPaused = true;
      stopRadioPolling();
      statusEl.textContent = '⏸ En pausa';
      saveRadioResume(false);
      window.__radioMediaStarted = false;
      syncRadioAndroidMedia();
      return;
    }
    // Se deja un momento para que el propio WebView reanude; si no lo hace, se
    // reconecta desde cero (en directo, mejor que seguir con un búfer antiguo).
    if (t >= 2500 && window.rvPuedeReanudar(t)) {
      finInterrupcionRadio();
      reproducirRadio(currentStation).catch(() => {});
    }
  }, 1500);
}
// «Activa» = suena, está conectando o espera para reconectar. Mientras lo esté,
// Android mantiene el servicio en primer plano; si se avisara de «pausa» durante
// un corte, en segundo plano ya no se podría volver a arrancar.
// Botón ▶/⏸ propio (sustituye a los controles nativos, inútiles en directo y en
// los que no se puede saber si la pausa la hizo el usuario).
function actualizarBotonRadio() {
  const btn = document.getElementById('btnRadioPlay');
  const live = document.getElementById('radioLiveText');
  const dot = document.querySelector('.radio-live-dot');
  if (!btn) return;
  let icon = '▶',
    label = 'Reproducir',
    txt = currentStation ? 'En pausa' : 'Elige una emisora',
    state = 'off';
  if (currentStation && (radioConnecting || radioReconnectPending)) {
    icon = '⏳';
    label = 'Conectando… (pulsa para parar)';
    txt = 'Conectando…';
    state = 'wait';
  } else if (currentStation && radioInterrupted) {
    icon = '⏸';
    label = 'Pausar';
    txt = 'Interrumpida';
    state = 'wait';
  } else if (currentStation && !audio.paused) {
    icon = '⏸';
    label = 'Pausar';
    txt = 'En directo';
    state = 'live';
  }
  btn.textContent = icon;
  btn.setAttribute('aria-label', label);
  btn.disabled = !currentStation;
  if (live) live.textContent = txt;
  if (dot) dot.dataset.state = state;
}
function pulsarBotonRadio() {
  if (!currentStation) return;
  if (!audio.paused || radioConnecting || radioReconnectPending || radioInterrupted) {
    window.viferorNativeRadioPause();
  } else {
    reanudarRadio();
  }
  actualizarBotonRadio();
}
function radioActiva() {
  return (
    !!currentStation &&
    !radioUserPaused &&
    (!audio.paused || radioConnecting || radioReconnectPending || !!radioInterrupted)
  );
}

function clearRadioWatchdog() {
  clearInterval(radioWatchdogTimer);
  radioWatchdogTimer = null;
  radioWatchdogLastTime = 0;
  radioWatchdogStalls = 0;
}
function startRadioWatchdog(token) {
  clearRadioWatchdog();
  radioWatchdogLastTime = audio.currentTime || 0;
  radioWatchdogTimer = setInterval(() => {
    if (token !== radioToken || !currentStation || audio.paused || audio.ended) return;
    const now = audio.currentTime || 0;
    if (Math.abs(now - radioWatchdogLastTime) < 0.25) {
      radioWatchdogStalls++;
    } else {
      radioWatchdogStalls = 0;
      radioWatchdogLastTime = now;
    }
    if (radioWatchdogStalls >= 3) {
      radioWatchdogStalls = 0;
      radioWasPlaying = false;
      try {
        audio.pause();
      } catch {}
      scheduleRadioReconnect();
    }
  }, 10000);
}
function waitForAudio(token, timeout = 8000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (ok, e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(stale);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('error', onError);
      ok ? resolve() : reject(e || new Error('audio error'));
    };
    const onPlaying = () => finish(true);
    const onError = e => finish(false, e);
    const timer = setTimeout(() => finish(false, new Error('timeout')), timeout);
    // Si mientras tanto se ha elegido otra emisora, se abandona enseguida.
    const stale = setInterval(() => {
      if (token !== radioToken) finish(false, new Error('cancelado'));
    }, 250);
    audio.addEventListener('playing', onPlaying, { once: true });
    audio.addEventListener('error', onError, { once: true });
  });
}
async function intentarFuente(source, token) {
  clearHls();
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  const url = source.url;
  if (esHls(url) && window.Hls && Hls.isSupported()) {
    return new Promise((resolve, reject) => {
      hls = new Hls({ enableWorker: true });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) reject(new Error(data.details || 'HLS fatal error'));
      });
      hls.on(Hls.Events.MANIFEST_PARSED, async () => {
        try {
          const ready = waitForAudio(token, 8000);
          ready.catch(() => {});
          await audio.play();
          await ready;
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      hls.loadSource(url);
      hls.attachMedia(audio);
    });
  }
  audio.src = url;
  audio.load();
  const ready = waitForAudio(token, 8000);
  ready.catch(() => {});
  await audio.play();
  await ready;
}
function saveRadioResume(playing) {
  if (!currentStation) return;
  try {
    const st = {
      type: 'radio',
      station: currentStation,
      streamUrl: currentStreamUrl,
      playing: !!playing,
      at: Date.now()
    };
    localStorage.setItem('radio_resume_state', JSON.stringify(st));
    if (playing) localStorage.setItem('radios_viferor_playback_resume_v1', JSON.stringify(st));
  } catch {}
}
// Canción y programación solo se consultan mientras la radio suena.
function stopRadioPolling() {
  clearInterval(metadataTimer);
  clearInterval(programTimer);
  metadataTimer = null;
  programTimer = null;
  radioPollingFor = null;
}
function startRadioPolling(s, streamUrl) {
  if (radioPollingFor === s && metadataTimer && programTimer) return;
  stopRadioPolling();
  radioPollingFor = s;
  startMetadata(s, streamUrl);
  startProgramGuide(s);
}
// opciones.reconnect = true cuando la llama la reconexión automática: en ese
// caso no se reinicia el contador de intentos (antes se ponía a 0 en cada
// intento, la espera nunca crecía y reintentaba cada 1,5 s para siempre).
async function reproducirRadio(s, opciones = {}) {
  if (!s) return;
  const token = ++radioToken;
  finInterrupcionRadio();
  radioWasPlaying = false;
  radioConnecting = true;
  clearTimeout(reconnectTimer);
  if (!opciones.reconnect) reconnectAttempts = 0;
  radioUserPaused = false;
  clearRadioWatchdog();
  stopRadioPolling();
  const podcastAudio = document.getElementById('podcastAudio');
  if (podcastAudio && !podcastAudio.paused) {
    try {
      podcastAudio.pause();
    } catch {}
  }
  if (radioNow.station !== s) resetRadioNow(s);
  currentStation = s;
  updatePlayingCards();
  currentNameEl.textContent = s.name;
  statusEl.textContent = opciones.reconnect
    ? `Reconectando (${reconnectAttempts}/${RADIO_MAX_RECONNECTS})… ⏳`
    : 'Conectando... ⏳';
  actualizarCancion('🎵 Buscando información…');
  currentStreamUrl = '';
  try {
    let fuentes = Array.isArray(s.options) ? fuentesLocales(s) : [];
    if (!fuentes.length || !s.url) {
      statusEl.textContent = 'Buscando stream... ⏳';
      const remote = await resolveRemote(s);
      if (token !== radioToken) return;
      if (remote) {
        if (remote.logo) s.logo = remote.logo;
        if (remote.web) s.web = remote.web;
        if (remote.epg_id) s.epg_id = remote.epg_id;
        if (remote.stationuuid) s.stationuuid = remote.stationuuid;
        s.options = remote.options || [];
        if (remote.source === 'radio-browser' && remote.name) s.remoteName = remote.name;
      }
      fuentes = fuentesLocales(s);
    }
    if (!fuentes.length) {
      statusEl.textContent = '❌ Sin stream disponible';
      actualizarCancion('🎵 Emisión no disponible');
      return;
    }
    let last = null;
    for (const f of fuentes) {
      if (token !== radioToken) return;
      try {
        statusEl.textContent = `Conectando… ${String(f.format || 'stream').toUpperCase()}`;
        await intentarFuente(f, token);
        if (token !== radioToken) {
          // Llegó tarde: el usuario pausó mientras conectaba.
          if (radioUserPaused) audio.pause();
          return;
        }
        currentStreamUrl = f.url;
        reconnectAttempts = 0;
        radioWasPlaying = true;
        startRadioWatchdog(token);
        try {
          window.Android?.setPlaybackSection?.('radio');
          window.__radioMediaStarted = false;
          window.Android?.startRadioMedia?.(
            s.name || 'Radio',
            nowPlayingEl?.textContent || '🎵 En directo',
            s.logo || '',
            true
          );
        } catch {}
        saveRadioResume(true);
        statusEl.textContent = 'En directo ✅';
        actualizarCancion('🎵 En directo');
        startRadioPolling(s, f.url);
        return;
      } catch (e) {
        last = e;
      }
    }
    if (token !== radioToken) return;
    console.warn('Radio playback failed', s, last);
    statusEl.textContent = '❌ No se pudo reproducir';
    actualizarCancion('🎵 Ninguna fuente disponible');
    radioConnecting = false;
    scheduleRadioReconnect();
  } finally {
    if (token === radioToken) radioConnecting = false;
  }
}
// Deja una emisora lista en el reproductor sin que suene (al abrir la app con
// «Reanudar al abrir» desactivado). Se reanuda con ▶ o tocando el nombre.
function prepararRadio(s) {
  if (!s || currentStation) return;
  currentStation = s;
  updatePlayingCards();
  currentNameEl.textContent = s.name || 'Radio';
  radioUserPaused = true;
  statusEl.textContent = '▶ Toca para reanudar';
  actualizarCancion('🎵 En pausa');
}
window.prepararRadio = prepararRadio;
window.reproducirRadio = reproducirRadio;
// --- Ahora suena ------------------------------------------------------------
// Estado de lo que suena en la radio: canción (artista, título, carátula),
// programa actual y siguientes, y las últimas canciones de la emisora.
const radioNow = { station: null, song: null, program: null, upcoming: [], bitrate: '', history: [], line: '' };
const RADIO_HISTORY_MAX = 15;

function horaCorta(ms) {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}
function resetRadioNow(s) {
  radioNow.station = s;
  radioNow.song = null;
  radioNow.program = null;
  radioNow.upcoming = [];
  radioNow.bitrate = '';
  radioNow.history = [];
  renderRadioNow();
}
// Texto de respaldo de la línea principal (estados: conectando, en pausa…).
function actualizarCancion(t) {
  radioNow.line = t;
  renderRadioNow();
}
function actualizarPrograma(current, next, upcoming) {
  radioNow.program = current || null;
  radioNow.upcoming = Array.isArray(upcoming) && upcoming.length ? upcoming : next ? [next] : [];
  renderRadioNow();
}
function setRadioSong(d) {
  const song = d && d.song ? { artist: d.artist || '', title: d.track || d.song, cover: d.cover || '', text: d.song } : null;
  const prev = radioNow.song;
  if (d?.bitrate) radioNow.bitrate = String(d.bitrate).split(',')[0].trim();
  if (song && (!prev || prev.text !== song.text)) {
    if (!radioNow.history.length || radioNow.history[0].text !== song.text) {
      radioNow.history.unshift({ ...song, at: Date.now() });
      radioNow.history.length = Math.min(radioNow.history.length, RADIO_HISTORY_MAX);
    }
  }
  radioNow.song = song;
  renderRadioNow();
}
function radioImagen() {
  return radioNow.song?.cover || currentStation?.logo || '';
}
// Texto para la notificación y la pantalla de bloqueo.
function radioTextoNotificacion() {
  const s = radioNow.song;
  if (s) return s.artist ? `${s.title} — ${s.artist}` : s.title;
  if (radioNow.program?.title) return '📻 ' + radioNow.program.title;
  return radioNow.line || '🎵 En directo';
}
function renderRadioNow() {
  actualizarBotonRadio();
  const s = radioNow.song,
    p = radioNow.program,
    next = radioNow.upcoming[0];
  // Línea principal: canción, o programa (emisoras habladas), o estado.
  const main = s ? `🎵 ${s.artist ? s.artist + ' — ' : ''}${s.title}` : p?.title && radioNow.line.match(/En directo/) ? `📻 ${p.title}` : radioNow.line || '🎵 En directo';
  if (nowPlayingEl) {
    nowPlayingEl.textContent = main;
    nowPlayingEl.classList.remove('scrolling');
    requestAnimationFrame(() => {
      if (nowPlayingEl.scrollWidth > nowPlayingEl.parentElement.clientWidth) nowPlayingEl.classList.add('scrolling');
    });
  }
  if (programNowEl) {
    const horario = p ? `${horaCorta(p.start)}–${horaCorta(p.end)}` : '';
    // Si la línea principal ya muestra el programa (emisora hablada), aquí van
    // los presentadores y el horario; si suena una canción, el programa completo.
    programNowEl.textContent = !p?.title
      ? '📻 Programa: sin información'
      : main.startsWith('📻')
        ? [p.description, horario].filter(Boolean).join(' · ')
        : `📻 ${p.title}${p.description ? ' · ' + p.description : ''} · ${horario}`;
    programNowEl.title = p?.description || '';
  }
  if (programNextEl) {
    programNextEl.textContent = next?.title ? `Después: ${next.title} · ${horaCorta(next.start)}` : 'Después: —';
  }
  const thumb = document.getElementById('playerThumb');
  if (thumb) {
    const img = radioImagen();
    if (img) {
      if (thumb.dataset.src !== img) {
        thumb.dataset.src = img;
        thumb.innerHTML = `<img src="${escapeHtml(img)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`;
      }
    } else if (thumb.dataset.src !== '') {
      thumb.dataset.src = '';
      thumb.textContent = '📻';
    }
  }
  if (!document.getElementById('radioNowPanel')?.hidden) renderRadioNowPanel();
  syncRadioAndroidMedia();
}
function renderRadioNowPanel() {
  const panel = document.getElementById('radioNowPanel');
  if (!panel) return;
  const st = currentStation;
  const s = radioNow.song,
    p = radioNow.program;
  const img = radioImagen();
  const lugar = st ? [st.city, st.state].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' · ') : '';
  const cadena = st?.network || '';
  const playing = !audio.paused;
  let progreso = 0;
  if (p && Number.isFinite(p.start) && Number.isFinite(p.end) && p.end > p.start)
    progreso = Math.max(0, Math.min(100, ((Date.now() - p.start) / (p.end - p.start)) * 100));
  const busca = s ? encodeURIComponent(`${s.artist} ${s.title}`.trim()) : '';
  panel.querySelector('.rn-body').innerHTML = `
    <div class="rn-art">${img ? `<img src="${escapeHtml(img)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : '<span>📻</span>'}</div>
    <div class="rn-station"><strong>${escapeHtml(st?.name || 'Sin emisora')}</strong><small>${escapeHtml([cadena, lugar].filter(Boolean).join(' · '))}</small></div>
    <div class="rn-status">${escapeHtml(statusEl?.textContent || '')}${radioNow.bitrate ? ` · ${escapeHtml(radioNow.bitrate)} kbps` : ''}</div>
    ${
      s
        ? `<section class="rn-song"><h3>${escapeHtml(s.title)}</h3>${s.artist ? `<p>${escapeHtml(s.artist)}</p>` : ''}
           <div class="rn-links"><a href="https://www.youtube.com/results?search_query=${busca}" target="_blank" rel="noopener">▶ YouTube</a><a href="https://open.spotify.com/search/${busca}" target="_blank" rel="noopener">🎧 Spotify</a></div></section>`
        : `<section class="rn-song rn-song-empty"><p>${escapeHtml(p?.title ? 'Emisión hablada: no hay información de canción.' : radioNow.line || 'Sin información de canción.')}</p></section>`
    }
    <section class="rn-program"><h4>📻 Programa</h4>${
      p
        ? `<strong>${escapeHtml(p.title)}</strong>${p.description ? `<p>${escapeHtml(p.description)}</p>` : ''}
           <div class="rn-time"><span>${horaCorta(p.start)}</span><div class="rn-bar"><i style="width:${progreso.toFixed(1)}%"></i></div><span>${horaCorta(p.end)}</span></div>`
        : '<p class="rn-muted">Sin información de programación para esta emisora.</p>'
    }</section>
    ${
      radioNow.upcoming.length
        ? `<section class="rn-next"><h4>⏭ A continuación</h4><ul>${radioNow.upcoming
            .map(e => `<li><span>${horaCorta(e.start)}</span><div><strong>${escapeHtml(e.title)}</strong>${e.description ? `<small>${escapeHtml(e.description)}</small>` : ''}</div></li>`)
            .join('')}</ul></section>`
        : ''
    }
    ${
      radioNow.history.length
        ? `<section class="rn-history"><h4>🎶 Han sonado</h4><ul>${radioNow.history
            .map(h => `<li><span>${horaCorta(h.at)}</span><div><strong>${escapeHtml(h.title)}</strong>${h.artist ? `<small>${escapeHtml(h.artist)}</small>` : ''}</div></li>`)
            .join('')}</ul></section>`
        : ''
    }`;
  const btn = panel.querySelector('.rn-play');
  if (btn) btn.textContent = playing ? '⏸ Pausar' : '▶ Escuchar';
}
function abrirRadioNow() {
  if (!currentStation) return;
  const panel = document.getElementById('radioNowPanel');
  if (!panel) return;
  panel.hidden = false;
  renderRadioNowPanel();
}
function cerrarRadioNow() {
  const panel = document.getElementById('radioNowPanel');
  if (panel) panel.hidden = true;
}
window.cerrarRadioNow = cerrarRadioNow;

async function startMetadata(s, streamUrl) {
  clearInterval(metadataTimer);
  metadataBusy = false;
  const run = async () => {
    if (metadataBusy || !currentStation || currentStation !== s || radioPollingFor !== s) return;
    metadataBusy = true;
    let d = null;
    try {
      const q = new URLSearchParams({
        url: streamUrl,
        name: s.name || '',
        state: s.state || '',
        stationuuid: s.stationuuid || s.uuid || ''
      });
      // Sin no-store: el CDN cachea la respuesta unos segundos y la comparten todos los oyentes.
      const r = await fetch('/api/metadata?' + q.toString(), { signal: AbortSignal.timeout(9000) });
      if (r.ok) d = await r.json();
    } catch {}
    metadataBusy = false;
    if (radioPollingFor !== s) return;
    setRadioSong(d);
    clearInterval(metadataTimer);
    // Más a menudo si la emisora informa de canciones; menos si es hablada.
    metadataTimer = setInterval(run, d?.song ? 15000 : 30000);
  };
  run();
}
async function startProgramGuide(s) {
  const run = async () => {
    if (radioPollingFor !== s) return;
    try {
      const q = new URLSearchParams({
        name: s.name || '',
        epg_id: s.epg_id || '',
        network: s.network || networkKey(s) || ''
      });
      const r = await fetch('/api/program?' + q.toString());
      if (!r.ok || radioPollingFor !== s) return;
      const d = await r.json();
      actualizarPrograma(d.current, d.next, d.upcoming);
    } catch {}
  };
  run();
  clearInterval(programTimer);
  programTimer = setInterval(run, 60000);
}

function scheduleRadioReconnect() {
  clearTimeout(reconnectTimer);
  radioReconnectPending = false;
  clearRadioWatchdog();
  if (!currentStation || radioUserPaused || radioConnecting) return;
  if (reconnectAttempts >= RADIO_MAX_RECONNECTS) {
    radioReconnectPending = false;
    statusEl.textContent = '⚠️ Sin conexión · toca para reintentar';
    actualizarCancion('🎵 No se pudo reconectar');
    stopRadioPolling();
    return;
  }
  // 2 s, 4 s, 8 s… hasta 60 s entre intentos.
  const delay = Math.min(60000, 2000 * Math.pow(2, reconnectAttempts));
  const token = radioToken;
  statusEl.textContent = `Reconectando en ${Math.round(delay / 1000)} s… ⏳`;
  radioReconnectPending = true;
  reconnectTimer = setTimeout(() => {
    radioReconnectPending = false;
    if (token !== radioToken || !currentStation || !audio.paused || radioUserPaused) return;
    reconnectAttempts++;
    reproducirRadio(currentStation, { reconnect: true }).catch(() => {});
  }, delay);
}
// Envía a Android (notificación, pantalla de bloqueo, widget) lo que suena.
// Con el APK 1.8+ se mandan artista, título, programa y carátula por separado;
// con APKs anteriores, un solo texto y la carátula al cambiar.
let radioAndroidSig = '';
function syncRadioAndroidMedia() {
  try {
    const A = window.Android;
    if (!A || !currentStation || !audio) return;
    const podcastAudio = document.getElementById('podcastAudio');
    if (podcastAudio && !podcastAudio.paused && !podcastAudio.ended) return;
    const playing = radioActiva();
    const station = currentStation.name || 'Radio';
    const s = radioNow.song;
    const program = radioNow.program?.title || '';
    const art = radioImagen();
    const track = radioTextoNotificacion();
    const sig = [station, s?.artist, s?.title, program, art, track, playing].join('|');
    if (sig === radioAndroidSig && window.__radioMediaStarted) return;
    radioAndroidSig = sig;
    if (typeof A.updateRadioNowPlaying === 'function') {
      if (!window.__radioMediaStarted && playing) {
        window.__radioMediaStarted = true;
        window.__podMediaStarted = false;
        A.startRadioMedia?.(station, track, art, true);
      }
      A.updateRadioNowPlaying(station, s?.artist || '', s?.title || '', program, art, playing);
      return;
    }
    const artChanged = window.__radioArtSent !== art;
    if (typeof A.startRadioMedia === 'function' && playing && (!window.__radioMediaStarted || artChanged)) {
      window.__radioMediaStarted = true;
      window.__podMediaStarted = false;
      window.__radioArtSent = art;
      A.startRadioMedia(station, track, art, true);
    } else if (typeof A.updateRadioMedia === 'function') {
      A.updateRadioMedia(station, track, playing);
    }
  } catch {}
}
// Reanudar desde la notificación, el widget o el nombre de la emisora: en
// directo conviene reconectar (si no, suena lo que quedó en el búfer, con
// retraso respecto a la emisión real).
function reanudarRadio() {
  if (!currentStation || radioConnecting) return;
  reproducirRadio(currentStation);
}
window.viferorNativeRadioPlay = () => {
  try {
    reanudarRadio();
  } catch {}
};
window.viferorNativeRadioPause = () => {
  try {
    finInterrupcionRadio();
    radioUserPaused = true;
    clearTimeout(reconnectTimer);
    radioReconnectPending = false;
    radioConnecting = false;
    radioToken++; // cancela una conexión en curso
    stopRadioPolling();
    clearRadioWatchdog();
    if (currentStation) {
      statusEl.textContent = '⏸ En pausa';
      saveRadioResume(false);
    }
    syncRadioAndroidMedia();
    if (audio) audio.pause();
  } catch {}
};
// Reordenar favoritas arrastrando. Se puede empezar desde el asa ⋮⋮ (al instante)
// o manteniendo pulsada la tarjeta (medio segundo). Una copia de la tarjeta sigue
// al dedo, las demás se apartan con animación y la lista se desplaza sola cerca de
// los bordes. Al soltar se guarda el orden.
const favSort = {
  active: false,
  card: null,
  ghost: null,
  offX: 0,
  offY: 0,
  x: 0,
  y: 0,
  raf: 0,
  longTimer: 0,
  startX: 0,
  startY: 0,
  suppressClick: false
};
function favScroller() {
  return favGrid.scrollHeight > favGrid.clientHeight + 2 ? favGrid : document.scrollingElement;
}
function setupFavSortable(card) {
  const handle = card.querySelector('.drag-handle');
  handle?.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    startFavDrag(e, card);
  });
  // Pulsación larga sobre la tarjeta (en táctil).
  card.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || favSort.active || e.target.closest('.fav-btn,.drag-handle')) return;
    clearTimeout(favSort.longTimer);
    favSort.startX = e.clientX;
    favSort.startY = e.clientY;
    favSort.longTimer = setTimeout(() => startFavDrag(e, card), 450);
  });
  const cancelLong = () => clearTimeout(favSort.longTimer);
  card.addEventListener('pointermove', e => {
    if (!favSort.active && Math.hypot(e.clientX - favSort.startX, e.clientY - favSort.startY) > 8) cancelLong();
  });
  card.addEventListener('pointerup', cancelLong);
  card.addEventListener('pointercancel', cancelLong);
  card.addEventListener('contextmenu', e => e.preventDefault());
  // Tras arrastrar, el «clic» al soltar no debe poner la emisora.
  card.addEventListener(
    'click',
    e => {
      if (favSort.suppressClick) {
        e.stopImmediatePropagation();
        e.preventDefault();
        favSort.suppressClick = false;
      }
    },
    true
  );
}
function startFavDrag(e, card) {
  if (favSort.active) return;
  clearTimeout(favSort.longTimer);
  const r = card.getBoundingClientRect();
  const ghost = card.cloneNode(true);
  ghost.classList.add('drag-ghost');
  Object.assign(ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  document.body.appendChild(ghost);
  card.classList.add('drag-placeholder');
  Object.assign(favSort, {
    active: true,
    card,
    ghost,
    offX: e.clientX - r.left,
    offY: e.clientY - r.top,
    x: e.clientX,
    y: e.clientY,
    suppressClick: true
  });
  document.body.classList.add('fav-sorting');
  try {
    navigator.vibrate?.(15);
  } catch {}
  window.addEventListener('pointermove', onFavDragMove, { passive: false });
  window.addEventListener('pointerup', endFavDrag);
  window.addEventListener('pointercancel', endFavDrag);
  favDragLoop();
}
// Mientras se arrastra no debe desplazarse la página con el dedo.
document.addEventListener(
  'touchmove',
  e => {
    if (favSort.active) e.preventDefault();
  },
  { passive: false }
);
function onFavDragMove(e) {
  if (!favSort.active) return;
  e.preventDefault();
  favSort.x = e.clientX;
  favSort.y = e.clientY;
}
function favDragLoop() {
  if (!favSort.active) return;
  const { ghost, x, y, offX, offY } = favSort;
  ghost.style.transform = `translate(${x - offX - parseFloat(ghost.style.left)}px, ${y - offY - parseFloat(ghost.style.top)}px) scale(1.06)`;
  // Desplazamiento automático cerca de los bordes de la lista.
  const sc = favScroller();
  const box = sc === favGrid ? favGrid.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  const edge = 70;
  if (y < box.top + edge) sc.scrollTop -= Math.ceil((box.top + edge - y) / 6);
  else if (y > box.bottom - edge) sc.scrollTop += Math.ceil((y - (box.bottom - edge)) / 6);
  moveFavPlaceholder(x, y);
  favSort.raf = requestAnimationFrame(favDragLoop);
}
function moveFavPlaceholder(x, y) {
  const card = favSort.card;
  const over = document.elementFromPoint(x, y)?.closest('.station-card');
  if (!over || over === card || over.parentElement !== favGrid) return;
  const r = over.getBoundingClientRect();
  const sameRow = y > r.top && y < r.bottom;
  const after = sameRow ? x > r.left + r.width / 2 : y > r.top + r.height / 2;
  const ref = after ? over.nextSibling : over;
  if (ref === card || card.nextSibling === ref) return;
  // Animación FLIP: las tarjetas se deslizan a su nueva posición.
  const cards = [...favGrid.querySelectorAll('.station-card')];
  const before = new Map(cards.map(c => [c, c.getBoundingClientRect()]));
  favGrid.insertBefore(card, ref);
  for (const c of cards) {
    if (c === card) continue;
    const a = before.get(c),
      b = c.getBoundingClientRect();
    const dx = a.left - b.left,
      dy = a.top - b.top;
    if (!dx && !dy) continue;
    c.style.transition = 'none';
    c.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      c.style.transition = 'transform 160ms ease';
      c.style.transform = '';
    });
  }
}
function endFavDrag() {
  if (!favSort.active) return;
  favSort.active = false;
  cancelAnimationFrame(favSort.raf);
  window.removeEventListener('pointermove', onFavDragMove);
  window.removeEventListener('pointerup', endFavDrag);
  window.removeEventListener('pointercancel', endFavDrag);
  document.body.classList.remove('fav-sorting');
  const { card, ghost } = favSort;
  // La copia vuela al hueco y desaparece.
  const r = card.getBoundingClientRect();
  ghost.style.transition = 'transform 140ms ease';
  ghost.style.transform = `translate(${r.left - parseFloat(ghost.style.left)}px, ${r.top - parseFloat(ghost.style.top)}px) scale(1)`;
  setTimeout(() => {
    ghost.remove();
    card.classList.remove('drag-placeholder');
    favGrid.querySelectorAll('.station-card').forEach(c => {
      c.style.transition = '';
      c.style.transform = '';
    });
    const order = [...favGrid.querySelectorAll('.station-card')].map(c => c.dataset.uuid);
    const byId = new Map(favorites.map(f => [String(f.uuid || f.stationuuid), f]));
    const reordered = order.map(id => byId.get(String(id))).filter(Boolean);
    if (reordered.length === favorites.length) {
      favorites = reordered;
      saveFavorites();
    }
    renderFavoritas();
    // El clic que genera soltar llega justo después; luego se permite tocar de nuevo.
    setTimeout(() => (favSort.suppressClick = false), 350);
  }, 150);
}
function exportarFavoritas() {
  if (!favorites.length) {
    alert('No tienes favoritas.');
    return;
  }
  const name = 'mis_radios_' + new Date().toISOString().slice(0, 10) + '.json';
  const content = JSON.stringify(favorites, null, 2);
  if (window.Android && typeof window.Android.saveTextFile === 'function') {
    window.Android.saveTextFile(name, content, 'application/json');
    return;
  }
  if (window.showSaveFilePicker) {
    (async () => {
      try {
        const h = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: 'Copia de radios', accept: { 'application/json': ['.json'] } }]
        });
        const w = await h.createWritable();
        await w.write(content);
        await w.close();
      } catch (e) {
        if (e?.name !== 'AbortError') alert('No se pudo guardar la copia: ' + e.message);
      }
    })();
    return;
  }
  const b = new Blob([content], { type: 'application/json' }),
    a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// Carga una copia de favoritas: valida cada emisora y la añade a las actuales
// sin duplicados (antes sustituía la lista entera sin comprobar nada).
function emisoraValida(x) {
  // Basta con nombre e identificador: si no trae URL, se resuelve al reproducir (/api/resolve).
  return !!x && typeof x === 'object' && !Array.isArray(x) && !!String(x.name || '').trim() && !!stationId(x);
}
function importarFavoritas(ev) {
  const f = ev.target.files?.[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = e => {
    try {
      const d = JSON.parse(e.target.result);
      const lista = Array.isArray(d) ? d : Array.isArray(d?.favorites) ? d.favorites : null;
      if (!lista) throw Error('El archivo no es una copia de emisoras válida');
      const validas = lista.filter(emisoraValida);
      const ids = new Set(favorites.map(stationId));
      let nuevas = 0;
      for (const x of validas) {
        const id = stationId(x);
        if (ids.has(id)) continue;
        ids.add(id);
        favorites.push({ ...x, stationuuid: x.stationuuid || x.uuid });
        nuevas++;
      }
      saveFavorites();
      renderFavoritas();
      const ignoradas = lista.length - validas.length;
      alert(
        `✅ ${nuevas} emisoras añadidas` +
          (validas.length - nuevas ? ` · ${validas.length - nuevas} ya estaban` : '') +
          (ignoradas ? ` · ${ignoradas} no válidas ignoradas` : '')
      );
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };
  r.readAsText(f);
  ev.target.value = '';
}

function exportFullBackup() {
  try {
    const data = { version: APP_VERSION, build: APP_BUILD, createdAt: new Date().toISOString(), storage: {} };
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k != null) data.storage[k] = localStorage.getItem(k);
    }
    const content = JSON.stringify(data, null, 2);
    const name = 'radios_viferor_backup_' + new Date().toISOString().slice(0, 10) + '.json';
    if (window.Android && typeof window.Android.saveTextFile === 'function') {
      window.Android.saveTextFile(name, content, 'application/json');
      return;
    }
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) {
    alert('No se pudo crear el backup: ' + (e?.message || e));
  }
}
function importFullBackupFile(file) {
  const r = new FileReader();
  r.onload = e => {
    try {
      const d = JSON.parse(e.target.result);
      if (
        !d ||
        typeof d !== 'object' ||
        !d.storage ||
        typeof d.storage !== 'object' ||
        Array.isArray(d.storage)
      )
        throw Error('El archivo no es un backup completo válido de Radios Viferor.');
      if (!confirm('⚠️ Restaurar este backup sustituirá los datos actuales de la aplicación. ¿Continuar?'))
        return;
      localStorage.clear();
      Object.entries(d.storage).forEach(([k, v]) => {
        if (typeof k === 'string' && typeof v === 'string') localStorage.setItem(k, v);
      });
      alert('✅ Backup restaurado correctamente. La aplicación se recargará.');
      location.reload();
    } catch (err) {
      alert('❌ No se pudo restaurar el backup: ' + (err?.message || err));
    } finally {
      const f = document.getElementById('fullBackupFile');
      if (f) f.value = '';
    }
  };
  r.readAsText(file);
}
function mergeCatalogs(base, extra) {
  const map = new Map();
  for (const s of [...base, ...extra]) {
    const key =
      s.uuid || s.stationuuid || (normalizar(s.name) + '|' + normalizar(s.state || '')).replace(/\s+/g, ' ');
    const prev = map.get(key);
    map.set(
      key,
      prev
        ? {
            ...prev,
            ...s,
            logo: s.logo || prev.logo,
            options: s.options?.length ? s.options : prev.options,
            url: s.url || prev.url,
            url_resolved: s.url_resolved || prev.url_resolved
          }
        : s
    );
  }
  return [...map.values()].map(s => ({ ...s, stationuuid: s.stationuuid || s.uuid }));
}
function parseTdtDirect(data) {
  const out = [];
  for (const country of data?.countries || []) {
    for (const ambit of country?.ambits || []) {
      const state = ambit?.name || 'España';
      for (const ch of ambit?.channels || []) {
        const options = (Array.isArray(ch?.options) ? ch.options : [])
          .map(o => ({ format: o?.format || 'stream', url: o?.url || '' }))
          .filter(o => /^https?:\/\//i.test(o.url));
        if (!ch?.name || !options.length) continue;
        const id =
          'tdt-' +
          normalizar(ch.name)
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') +
          '-' +
          normalizar(state).replace(/[^a-z0-9]+/g, '-');
        const epg_id = ch.epg_id || '';
        const tdtSlug = ch.slug || ch.id || ch.channel_id || ch.channelId || epg_id.replace(/\.Radio$/i, '');
        out.push({
          ambit: ambit?.name || '',
          uuid: id,
          stationuuid: id,
          name: ch.name,
          state,
          city: '',
          network: '',
          tags: '',
          logo: ch.logo || '',
          web: ch.web || '',
          epg_id,
          tdtSlug,
          options
        });
      }
    }
  }
  return out;
}
async function cargarCatalogoNacional() {
  if (catalogPromise) return catalogPromise;
  catalogPromise = (async () => {
    let nacional = [];
    let apiError = '';
    try {
      const r = await fetch('/api/stations', { cache: 'no-store' });
      if (!r.ok) throw new Error('API HTTP ' + r.status);
      const d = await r.json();
      if (!Array.isArray(d.stations) || d.stations.length < 300)
        throw new Error('API catálogo incompleto: ' + (d.stations?.length || 0));
      nacional = d.stations;
    } catch (e) {
      apiError = e.message || String(e);
      try {
        const r = await fetch('https://www.tdtchannels.com/lists/radio.json', { cache: 'no-store' });
        if (!r.ok) throw new Error('TDT HTTP ' + r.status);
        const d = await r.json();
        nacional = parseTdtDirect(d);
        if (nacional.length < 300) throw new Error('TDT catálogo incompleto: ' + nacional.length);
      } catch (e2) {
        console.warn('Catálogo nacional no disponible', apiError, e2);
      }
    }
    catalogReady = true;
    if (nacional.length) stations = mergeCatalogs(stations, nacional);
    if (currentView === 'search') aplicarFiltros();
  })();
  return catalogPromise;
}
function init() {
  configurarGestoRadiosPodcasts();
  audio.volume = 0.8;
  audio.addEventListener('play', () => {
    const podcastAudio = document.getElementById('podcastAudio');
    if (podcastAudio && !podcastAudio.paused) {
      try {
        podcastAudio.pause();
      } catch {}
    }
    syncRadioAndroidMedia();
  });
  // Vuelve a sonar (también con el ▶ nativo del reproductor): se retoma el
  // sondeo de canción/programa y la vigilancia de cortes.
  audio.addEventListener('playing', () => {
    if (!currentStation || radioConnecting || !audio.currentSrc) return;
    finInterrupcionRadio();
    radioWasPlaying = true;
    radioUserPaused = false;
    clearTimeout(reconnectTimer);
    statusEl.textContent = 'En directo ✅';
    startRadioWatchdog(radioToken);
    startRadioPolling(currentStation, currentStreamUrl || audio.currentSrc);
    saveRadioResume(true);
  });
  audio.addEventListener('pause', () => {
    // Las pausas internas (cambio de fuente, vigilancia de cortes) no cuentan
    // como pausa del usuario: esas sí deben reconectar.
    const internal = radioConnecting || !radioWasPlaying;
    radioWasPlaying = false;
    // Pausa del sistema (notificación, llamada…): no se trata como pausa del usuario.
    if (currentStation && !internal && !radioUserPaused && !window.rvPausaDelUsuario()) {
      iniciarInterrupcionRadio();
      return;
    }
    if (currentStation && !internal) {
      radioUserPaused = true;
      clearTimeout(reconnectTimer);
      radioReconnectPending = false;
      stopRadioPolling();
      clearRadioWatchdog();
      statusEl.textContent = '⏸ En pausa';
      saveRadioResume(false);
    }
    // Solo una pausa del usuario se comunica a Android como «pausado».
    if (currentStation && !internal) {
      try {
        window.Android?.updateRadioMedia?.(
          currentStation.name || 'Radio',
          nowPlayingEl?.textContent || '🎵 En directo',
          false
        );
      } catch {}
      window.__radioMediaStarted = false;
    }
  });
  audio.addEventListener('ended', () => {
    if (currentStation) {
      try {
        window.Android?.stopRadioMedia?.();
      } catch {}
      window.__radioMediaStarted = false;
    }
  });
  const vr = document.getElementById('volumeRange'),
    vb = document.getElementById('btnMute'),
    vv = document.getElementById('volumeValue');
  if (vr) {
    vr.addEventListener('input', () => {
      const v = Math.max(0, Math.min(100, Number(vr.value) || 0));
      audio.volume = v / 100;
      if (v > 0) previousVolume = v / 100;
      if (vb) vb.textContent = v === 0 ? '🔇' : v < 40 ? '🔉' : '🔊';
      if (vv) vv.value = v + '%';
    });
  }
  if (vb)
    vb.addEventListener('click', () => {
      if (audio.volume > 0) {
        previousVolume = audio.volume;
        audio.volume = 0;
        if (vr) vr.value = 0;
        if (vv) vv.value = '0%';
        vb.textContent = '🔇';
      } else {
        audio.volume = previousVolume || 0.8;
        const v = Math.round(audio.volume * 100);
        if (vr) vr.value = v;
        if (vv) vv.value = v + '%';
        vb.textContent = v < 40 ? '🔉' : '🔊';
      }
    });
  rellenarSelectoresRadio();
  stations = (window.RADIO_STATIONS || []).map(s => ({ ...s, stationuuid: s.stationuuid || s.uuid }));
  loadFavorites();
  document.getElementById('btnViewRadios').addEventListener('click', () => cambiarVista('fav'));
  document.getElementById('btnRadioSearch').addEventListener('click', () => cambiarVista('search'));
  document.getElementById('btnBackToRadios').addEventListener('click', () => cambiarVista('fav'));
  document.getElementById('btnExportar').addEventListener('click', exportarFavoritas);
  document.getElementById('fileImportar').addEventListener('change', importarFavoritas);
  const bFullBk = document.getElementById('btnFullBackup');
  if (bFullBk) bFullBk.addEventListener('click', exportFullBackup);
  const bFullRes = document.getElementById('btnFullRestore');
  if (bFullRes) bFullRes.addEventListener('click', () => document.getElementById('fullBackupFile')?.click());
  const fFullBk = document.getElementById('fullBackupFile');
  if (fFullBk)
    fFullBk.addEventListener('change', e => {
      if (e.target.files?.[0]) importFullBackupFile(e.target.files[0]);
    });
  document.getElementById('btnAplicar').addEventListener('click', aplicarFiltros);
  ['selectNetwork', 'selectLocation', 'selectType'].forEach(id =>
    document.getElementById(id).addEventListener('change', aplicarFiltros)
  );
  document.getElementById('textSearch').addEventListener('keydown', e => {
    if (e.key === 'Enter') aplicarFiltros();
  });
  // Busca mientras escribes; los chips de arriba quitan cada filtro.
  document.getElementById('textSearch').addEventListener('input', () => {
    actualizarChips();
    if (currentView === 'search') aplicarFiltrosPronto();
  });
  activeFiltersEl.addEventListener('click', e => {
    const id = e.target.closest('[data-clear]')?.dataset.clear;
    if (!id) return;
    const el = document.getElementById(id);
    if (el) el.value = '';
    aplicarFiltros();
  });
  actualizarChips();
  cambiarVista('fav');
  cargarCatalogoNacional();
  // Tocar el estado la reanuda si está parada; tocar la emisora o lo que suena
  // abre el panel «Ahora suena» (artista, título, programa, historial…).
  document.getElementById('btnRadioPlay')?.addEventListener('click', e => {
    e.stopPropagation();
    pulsarBotonRadio();
  });
  ['play', 'playing', 'pause', 'waiting', 'emptied'].forEach(t => audio.addEventListener(t, actualizarBotonRadio));
  setInterval(actualizarBotonRadio, 2000);
  statusEl?.addEventListener('click', e => {
    if (currentStation && audio.paused) {
      e.stopPropagation();
      reanudarRadio();
    }
  });
  const info = document.getElementById('playerInfo');
  const abrir = () => (currentStation ? abrirRadioNow() : null);
  info?.addEventListener('click', abrir);
  info?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      abrir();
    }
  });
  document.getElementById('playerThumb')?.addEventListener('click', abrir);
  document.getElementById('radioNowClose')?.addEventListener('click', cerrarRadioNow);
  document.getElementById('radioNowPanel')?.addEventListener('click', e => {
    if (e.target.id === 'radioNowPanel') cerrarRadioNow();
  });
  document.getElementById('radioNowPlay')?.addEventListener('click', () => {
    if (!currentStation) return;
    if (audio.paused) reanudarRadio();
    else window.viferorNativeRadioPause();
    setTimeout(renderRadioNowPanel, 300);
  });
  // El panel se refresca solo (barra de progreso del programa).
  setInterval(() => {
    if (!document.getElementById('radioNowPanel')?.hidden) renderRadioNowPanel();
  }, 30000);
}
audio.addEventListener('error', () => {
  if (currentStation && audio.paused && !radioConnecting && !radioUserPaused && !radioInterrupted) scheduleRadioReconnect();
});
window.addEventListener('online', () => {
  // Al recuperar la red se reintenta desde cero, aunque se hubieran agotado los intentos.
  if (currentStation && audio.paused && !radioUserPaused && !radioConnecting && !radioInterrupted) {
    reconnectAttempts = 0;
    scheduleRadioReconnect();
  }
});
function guardarAlSalir() {
  clearRadioWatchdog();
  if (audio && !audio.paused && currentStation) saveRadioResume(true);
}
window.addEventListener('pagehide', guardarAlSalir);
window.addEventListener('beforeunload', guardarAlSalir);
window.addEventListener('error', e => console.error('UI error', e.error || e.message));
window.addEventListener('unhandledrejection', e => console.error('Unhandled rejection', e.reason));
window.addEventListener('load', init);
