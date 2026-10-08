const PODCASTS_KEY = 'radios_viferor_podcasts_v1';
const PODCAST_QUEUE_KEY = 'radios_viferor_podcast_queue_v1';
const PODCAST_RESUME_KEY = 'radios_viferor_podcast_resume_v3';
const PLAYBACK_RESUME_KEY = 'radios_viferor_playback_resume_v1';
const PODCAST_PLAY_COUNTS_KEY = 'radios_viferor_podcast_play_counts_v1';
let podcastClosing = false;
let podcastPauseTimer = null;
const podcastState = {
  subs: [],
  episodes: [],
  queue: [],
  history: [],
  current: null,
  search: [],
  loading: false,
  mode: 'subs',
  screen: 'home'
};
let podcastNavToken = 0;
window.podcastState = podcastState;
const podcastGenres = [
  'Todas',
  'Arte',
  'Negocios',
  'Comedia',
  'Educación',
  'Ficción',
  'Gobierno',
  'Salud',
  'Historia',
  'Niños y familia',
  'Música',
  'Noticias',
  'Religión y espiritualidad',
  'Ciencia',
  'Sociedad y cultura',
  'Deportes',
  'Tecnología',
  'TV y cine',
  'Ocio'
];
const $p = id => document.getElementById(id);
function repairPodcastText(v) {
  let out = String(v ?? '');
  const bad = s => (s.match(/[ÃÂâð]|�/g) || []).length;
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
const PODCAST_HTML_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '\"',
  apos: "'",
  nbsp: '\u00A0',
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
  iexcl: '¡',
  iquest: '¿',
  ordf: 'ª',
  ordm: 'º',
  laquo: '«',
  raquo: '»',
  ndash: '–',
  mdash: '—',
  hellip: '…'
};
function decodePodcastEntities(v) {
  let out = String(v ?? '');
  for (let pass = 0; pass < 3; pass++) {
    const next = out.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);?/gi, (m, k) => {
      try {
        if (/^#x/i.test(k)) return String.fromCodePoint(parseInt(k.slice(2), 16));
        if (/^#/i.test(k)) return String.fromCodePoint(parseInt(k.slice(1), 10));
      } catch {}
      return Object.prototype.hasOwnProperty.call(PODCAST_HTML_ENTITIES, k) ? PODCAST_HTML_ENTITIES[k] : m;
    });
    if (next === out) break;
    out = next;
  }
  return out;
}
function podcastText(v) {
  return decodePodcastEntities(repairPodcastText(v));
}
function normalizePodcastObject(p) {
  if (!p || typeof p !== 'object') return p;
  for (const k of [
    'title',
    'author',
    'artist',
    'description',
    'genre',
    'date',
    'webUrl',
    'htmlUrl',
    'feedUrl',
    'xmlUrl',
    'rssUrl',
    'feed',
    'url'
  ]) {
    if (typeof p[k] === 'string') p[k] = podcastText(p[k]);
  }
  return p;
}
function pEsc(v) {
  return escapeHtml(podcastText(v || ''));
}
function loadPodcastSubs() {
  try {
    const x = JSON.parse(localStorage.getItem(PODCASTS_KEY) || '[]');
    podcastState.subs = Array.isArray(x) ? x.map(normalizePodcastObject) : [];
    localStorage.setItem(PODCASTS_KEY, JSON.stringify(podcastState.subs));
  } catch {
    podcastState.subs = [];
  }
}
function savePodcastSubs() {
  podcastState.subs = podcastState.subs.map(normalizePodcastObject);
  const json = JSON.stringify(podcastState.subs);
  localStorage.setItem(PODCASTS_KEY, json);
  try {
    if (window.Android && typeof window.Android.syncPodcastSubscriptions === 'function')
      window.Android.syncPodcastSubscriptions(json);
  } catch {}
}
function getPodcastPlayCounts() {
  try {
    const x = JSON.parse(localStorage.getItem(PODCAST_PLAY_COUNTS_KEY) || '{}');
    return x && typeof x === 'object' ? x : {};
  } catch {
    return {};
  }
}
function getPodcastPlayCount(p) {
  const counts = getPodcastPlayCounts();
  return Number(counts[podcastKey(p)] || 0);
}
function registerPodcastPlay(p) {
  if (!p) return;
  try {
    const counts = getPodcastPlayCounts(),
      k = podcastKey(p);
    counts[k] = Number(counts[k] || 0) + 1;
    localStorage.setItem(PODCAST_PLAY_COUNTS_KEY, JSON.stringify(counts));
  } catch {}
}
function podcastDateValue(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') {
    const n = v > 0 && v < 1e12 ? v * 1000 : v;
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  const s = String(v).trim();
  if (!s) return 0;
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) {
    const t = n < 1e12 ? n * 1000 : n;
    return t > 0 ? t : 0;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) && t > 0 ? t : 0;
}
function podcastActivityInfo(v) {
  const t = podcastDateValue(v);
  if (!t) return null;
  const days = Math.max(0, (Date.now() - t) / 86400000);
  let label,
    cls,
    old = false;
  if (days < 90) {
    label = '🟢 Último episodio reciente';
    cls = 'pod-active';
  } else if (days < 365) {
    label = '🟡 Último episodio hace más de 3 meses';
    cls = 'pod-activity-months';
  } else {
    label = '🔴 Último episodio hace más de 1 año';
    cls = 'pod-inactive-1';
    old = true;
  }
  const date = new Date(t).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return { label, cls, date, old };
}
function podcastActivityStatus(p) {
  const latest = getPodcastLatestDate(p);
  if (latest) {
    const info = podcastActivityInfo(latest);
    if (info) return info;
  }
  const checked =
    Number(p?.latestEpisodeCheckedAt || 0) > 0 || !!podcastActivityCache.get(podcastActivityKey(p));
  if (checked)
    return {
      label: '⚪ No se ha podido comprobar la antigüedad',
      cls: 'pod-activity-unknown',
      date: '',
      old: false
    };
  return { label: '⚪ Comprobando antigüedad…', cls: 'pod-activity-pending', date: '', old: false };
}
const podcastActivityCache = new Map();
function podcastActivityKey(p) {
  return podcastKey(p);
}
// Metadatos ligeros de cada feed (fecha del último episodio, portada, autor).
// Usa /api/podcast-feed?meta=1, que no devuelve la lista de episodios, con un
// máximo de 4 peticiones simultáneas y sin repetir peticiones en curso.
const podcastMetaInFlight = new Map();
let podcastMetaActive = 0;
const podcastMetaWaiters = [];
async function podcastMetaSlot(fn) {
  if (podcastMetaActive >= 4) await new Promise(r => podcastMetaWaiters.push(r));
  podcastMetaActive++;
  try {
    return await fn();
  } finally {
    podcastMetaActive--;
    podcastMetaWaiters.shift()?.();
  }
}
function fetchPodcastMeta(p) {
  const feed = podcastFeedUrl(p);
  if (!feed) return Promise.resolve(null);
  const key = podcastActivityKey(p);
  if (podcastMetaInFlight.has(key)) return podcastMetaInFlight.get(key);
  const job = podcastMetaSlot(async () => {
    try {
      const u = new URL('/api/podcast-feed', location.origin);
      u.searchParams.set('url', feed);
      u.searchParams.set('meta', '1');
      const r = await fetch(u);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const latest = podcastDateValue(d.latest?.date) || 0;
      podcastActivityCache.set(key, { t: Date.now(), latest });
      return { latest, feed: d.feed || {} };
    } catch {
      podcastActivityCache.set(key, { t: Date.now(), latest: 0 });
      return null;
    } finally {
      podcastMetaInFlight.delete(key);
    }
  });
  podcastMetaInFlight.set(key, job);
  return job;
}
async function refreshPodcastActivity(items, { rerender = null, maxAge = 86400000 } = {}) {
  const now = Date.now();
  const pending = items.filter(p => {
    if (!podcastFeedUrl(p)) return false;
    const cached = podcastActivityCache.get(podcastActivityKey(p));
    if (cached && Number.isFinite(cached.t) && now - cached.t <= maxAge) return false;
    // Lo comprobado hace poco y guardado en la suscripción también vale.
    const checked = Number(p.latestEpisodeCheckedAt || 0);
    if (checked && now - checked <= maxAge && (p.artwork || p.image)) return false;
    return true;
  });
  if (!pending.length) return false;
  let changed = false;
  await Promise.all(
    pending.map(async p => {
      const x = await fetchPodcastMeta(p);
      const i = podcastState.subs.findIndex(s => podcastKey(s) === podcastKey(p));
      const targets = i >= 0 && podcastState.subs[i] !== p ? [p, podcastState.subs[i]] : [p];
      for (const cur of targets) {
        cur.latestEpisodeCheckedAt = Date.now();
        if (!x) continue;
        if (x.latest) {
          const iso = new Date(x.latest).toISOString();
          if (cur.latestEpisodeAt !== iso) {
            cur.latestEpisodeAt = iso;
            changed = true;
          }
        }
        const img = x.feed.image || x.feed.artwork || '';
        if (img && !(cur.artwork || cur.image)) {
          cur.artwork = img;
          cur.image = img;
          changed = true;
        }
        if (x.feed.author && !cur.author) {
          cur.author = x.feed.author;
          changed = true;
        }
        if (x.feed.description && !cur.description) {
          cur.description = x.feed.description;
          changed = true;
        }
      }
    })
  );
  savePodcastSubs();
  if (typeof rerender === 'function') rerender();
  return changed;
}
function getPodcastLatestDate(p) {
  const ownFields = [
    p?.latestEpisodeAt,
    p?.latestEpisodeDate,
    p?.lastEpisodeDate,
    p?.lastEpisodePublishedAt,
    p?.lastEpisodeAt,
    p?.pubDate,
    p?.published,
    p?.updated,
    p?.date
  ];
  for (const v of ownFields) {
    const t = podcastDateValue(v);
    if (t) return t;
  }
  const cached = podcastActivityCache.get(podcastActivityKey(p));
  return podcastDateValue(cached?.latest) || 0;
}
function getSortedPodcastSubs() {
  const arr = [...podcastState.subs],
    mode = $p('podMineSort')?.value || 'name';
  return arr.sort((a, b) => {
    if (mode === 'listened') {
      const d = getPodcastPlayCount(b) - getPodcastPlayCount(a);
      if (d) return d;
    } else if (mode === 'recent') {
      const d = getPodcastLatestDate(b) - getPodcastLatestDate(a);
      if (d) return d;
      if (d === 0) {
        const db = podcastDateValue(b.subscribedAt),
          da = podcastDateValue(a.subscribedAt);
        if ((db || da) && db !== da) return db - da;
      }
    } else if (mode === 'oldest') {
      const d = getPodcastLatestDate(a) - getPodcastLatestDate(b);
      if (d) return d;
      if (d === 0) {
        const da = podcastDateValue(a.subscribedAt),
          db = podcastDateValue(b.subscribedAt);
        if ((da || db) && da !== db) return da - db;
      }
    } else if (mode === 'name-desc') {
      const d = String(b.title || '').localeCompare(String(a.title || ''), 'es', { sensitivity: 'base' });
      if (d) return d;
    } else {
      const d = String(a.title || '').localeCompare(String(b.title || ''), 'es', { sensitivity: 'base' });
      if (d) return d;
    }
    return String(a.author || '').localeCompare(String(b.author || ''), 'es', { sensitivity: 'base' });
  });
}
function refreshPodcastLatestDates() {
  return refreshPodcastActivity(podcastState.subs, { maxAge: 600000 });
}

// --- Progreso de episodios -------------------------------------------------
// Antes se guardaba una clave pod_pos_<id> y otra pod_done_<id> por episodio,
// sin límite. Ahora hay dos objetos con tope y se migran las claves antiguas.
const PODCAST_PROGRESS_KEY = 'radios_viferor_podcast_progress_v1';
const PODCAST_DONE_KEY = 'radios_viferor_podcast_done_v1';
const PODCAST_PROGRESS_MAX = 300;
const PODCAST_DONE_MAX = 3000;
let podcastProgressCache = null;
let podcastDoneCache = null;
let podcastProgressDirty = false;
let podcastProgressLastWrite = 0;
function readJsonObject(key) {
  try {
    const x = JSON.parse(localStorage.getItem(key) || '{}');
    return x && typeof x === 'object' && !Array.isArray(x) ? x : {};
  } catch {
    return {};
  }
}
function podcastProgress() {
  if (!podcastProgressCache) podcastProgressCache = readJsonObject(PODCAST_PROGRESS_KEY);
  return podcastProgressCache;
}
function podcastDone() {
  if (!podcastDoneCache) podcastDoneCache = readJsonObject(PODCAST_DONE_KEY);
  return podcastDoneCache;
}
function trimByTime(obj, max, timeOf) {
  const keys = Object.keys(obj);
  if (keys.length <= max) return obj;
  keys
    .sort((a, b) => timeOf(obj[b]) - timeOf(obj[a]))
    .slice(max)
    .forEach(k => delete obj[k]);
  return obj;
}
function flushPodcastProgress(force = false) {
  if (!podcastProgressDirty) return;
  const now = Date.now();
  if (!force && now - podcastProgressLastWrite < 5000) return;
  podcastProgressLastWrite = now;
  podcastProgressDirty = false;
  try {
    trimByTime(podcastProgress(), PODCAST_PROGRESS_MAX, v => Number(v?.t || 0));
    localStorage.setItem(PODCAST_PROGRESS_KEY, JSON.stringify(podcastProgress()));
  } catch {}
}
function minimalEpisode(e) {
  if (!e) return null;
  const out = {};
  for (const k of ['id', 'title', 'audioUrl', 'podcastTitle', 'podcastArt', 'author', 'feedUrl', 'date', 'image'])
    if (e[k]) out[k] = e[k];
  return out;
}
function getEpisodePos(id) {
  return Number(podcastProgress()[String(id)]?.pos || 0);
}
function setEpisodePos(e, pos, duration, force = false) {
  if (!e?.id || !Number.isFinite(pos)) return;
  const id = String(e.id);
  const store = podcastProgress();
  const prev = store[id];
  const p = Math.floor(pos);
  if (p <= 5) {
    // Al principio del episodio no merece la pena guardar nada.
    if (prev && force) {
      delete store[id];
      podcastProgressDirty = true;
    }
  } else {
    store[id] = {
      pos: p,
      dur: Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : prev?.dur || 0,
      t: Date.now(),
      ep: prev?.ep || minimalEpisode(e)
    };
    podcastProgressDirty = true;
  }
  flushPodcastProgress(force);
}
function clearEpisodePos(id) {
  const store = podcastProgress();
  if (store[String(id)]) {
    delete store[String(id)];
    podcastProgressDirty = true;
    flushPodcastProgress(true);
  }
}
function markEpisodeDone(id) {
  if (!id) return;
  const done = podcastDone();
  done[String(id)] = Date.now();
  trimByTime(done, PODCAST_DONE_MAX, v => Number(v || 0));
  try {
    localStorage.setItem(PODCAST_DONE_KEY, JSON.stringify(done));
  } catch {}
}
function isEpisodeDone(id) {
  return !!podcastDone()[String(id)];
}
function inProgressEpisodes() {
  const store = podcastProgress();
  return Object.values(store)
    .filter(x => x?.ep?.audioUrl && !isEpisodeDone(x.ep.id))
    .sort((a, b) => Number(b.t || 0) - Number(a.t || 0))
    .map(x => x.ep);
}
function migrateLegacyPodcastProgress() {
  try {
    const legacy = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('pod_pos_') || k.startsWith('pod_done_'))) legacy.push(k);
    }
    if (!legacy.length) return;
    const store = podcastProgress(),
      done = podcastDone(),
      now = Date.now();
    legacy.forEach(k => {
      const v = localStorage.getItem(k);
      if (k.startsWith('pod_done_')) done[k.slice(9)] = now;
      else if (Number(v) > 5 && !store[k.slice(8)]) store[k.slice(8)] = { pos: Number(v), dur: 0, t: now - 1, ep: null };
      localStorage.removeItem(k);
    });
    trimByTime(done, PODCAST_DONE_MAX, v => Number(v || 0));
    localStorage.setItem(PODCAST_DONE_KEY, JSON.stringify(done));
    podcastProgressDirty = true;
    flushPodcastProgress(true);
  } catch {}
}
// ---------------------------------------------------------------------------

function savePodcastQueue() {
  localStorage.setItem(PODCAST_QUEUE_KEY, JSON.stringify(podcastState.queue));
}
function savePodcastResume(forcePlaying = null) {
  try {
    const a = $p('podcastAudio');
    if (podcastState.current && a) {
      const playing = forcePlaying === null ? !a.paused && !a.ended : !!forcePlaying;
      const pos = Number.isFinite(a.currentTime) ? Number(a.currentTime) : 0;
      const state = { type: 'podcast', episode: podcastState.current, pos, playing, at: Date.now() };
      localStorage.setItem(PODCAST_RESUME_KEY, JSON.stringify(state));
      setEpisodePos(podcastState.current, pos, a.duration, !playing || podcastClosing);
      if (playing || podcastClosing)
        localStorage.setItem(
          PLAYBACK_RESUME_KEY,
          JSON.stringify({ ...state, playing: true, at: Date.now() })
        );
    }
  } catch {}
}
function podcastFeedUrl(p) {
  return String(p?.feedUrl || p?.xmlUrl || p?.rssUrl || p?.feed || p?.url || '').trim();
}
function podcastKey(p) {
  const feed = podcastFeedUrl(p).toLowerCase();
  if (feed) return feed;
  const id = String(p?.id || '').trim();
  if (id) return 'id:' + id;
  return 'title:' + normalizar(p?.title || '');
}
function isSubscribed(p) {
  const k = podcastKey(p);
  return podcastState.subs.some(s => podcastKey(s) === k);
}
function setPodcastLayout(detail) {
  document.body.classList.add('podcasts-active');
  document.body.classList.toggle('podcast-detail-active', !!detail);
  document.body.classList.remove('podcast-subs-fullscreen');
}
function pushPodcastState(screen, replace = false) {
  podcastNavToken++;
  const st = { ...(history.state || {}), podcastScreen: screen };
  if (replace) history.replaceState(st, '');
  else history.pushState(st, '');
  podcastState.screen = screen;
}
function backFromPodcast() {
  if (
    podcastState.screen === 'subs' ||
    podcastState.screen === 'search' ||
    podcastState.screen === 'episodes' ||
    podcastState.screen.startsWith('queue')
  ) {
    if (history.state?.podcastScreen) {
      history.back();
    } else {
      renderPodcastLanding(true);
    }
    return;
  }
  switchToRadios();
}
function renderPodcastLanding(fromHistory = false) {
  if (!fromHistory) pushPodcastState('landing');
  podcastState.screen = 'landing';
  setPodcastLayout(false);
  document.body.classList.remove('podcast-results-active');
  document.body.classList.remove('podcast-subs-fullscreen');
  const root = $p('podcastContent');
  root.replaceChildren();
  const intro = document.createElement('div');
  intro.className = 'pod-landing';
  intro.innerHTML =
    '<div class="pod-landing-hero"><div class="pod-landing-icon">🎙️</div><div><h2>Podcasts</h2><p>Gestiona tus suscripciones, descubre nuevos podcasts y escucha episodios de todas ellas.</p></div></div>';
  root.append(intro);
}
function renderPodcastHome(fromHistory = false) {
  if (!fromHistory) pushPodcastState('subs');
  podcastState.screen = 'subs';
  setPodcastLayout(true);
  document.body.classList.remove('podcast-results-active');
  document.body.classList.add('podcast-subs-fullscreen');
  const root = $p('podcastContent');
  root.replaceChildren();
  const title = document.createElement('div');
  title.className = 'pod-section-title pod-subs-head';
  title.innerHTML =
    '<button class="pod-back-btn" id="podBack" type="button">← Volver</button><div class="pod-detail-title"><h2>Mis podcasts</h2><span>' +
    podcastState.subs.length +
    ' suscripciones</span></div><div class="pod-subs-controls"><label class="pod-mine-sort"><span>Ordenar por</span><select id="podMineSort" aria-label="Ordenar mis podcasts"><option value="name">Nombre A-Z</option><option value="name-desc">Nombre Z-A</option><option value="listened">Más escuchados</option><option value="recent">Más recientes</option><option value="oldest">Más antiguos</option></select></label><div class="pod-modes pod-modes-inline"><button id="podLatestAll" type="button">🆕 Últimos de todas</button><button id="podMixRandom" type="button">🔀 Mezclar todas</button><button id="podContinue" type="button">▶️ Continuar</button><button id="podPopular" type="button">🔥 Populares</button></div></div>';
  root.append(title);
  $p('podBack').onclick = backFromPodcast;
  if ($p('podMineCount')) $p('podMineCount').textContent = podcastState.subs.length + ' suscripciones';
  const sort = $p('podMineSort');
  if (sort) {
    sort.value = localStorage.getItem('radios_viferor_podcast_mine_sort') || 'name';
    sort.onchange = () => {
      localStorage.setItem('radios_viferor_podcast_mine_sort', sort.value);
      renderPodcastHome(true);
    };
  }
  if (!podcastState.subs.length) {
    root.insertAdjacentHTML(
      'beforeend',
      '<div class="pod-empty"><div>🎙️</div><h3>Aún no tienes suscripciones</h3><p>Importa tu OPML o descubre podcasts nuevos.</p></div>'
    );
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'pod-grid pod-subs-grid';
  getSortedPodcastSubs().forEach(p => grid.appendChild(podcastCard(p)));
  root.append(grid);
  const keepScroll = root.scrollTop;
  const byDate = sort && (sort.value === 'recent' || sort.value === 'oldest');
  refreshPodcastActivity(podcastState.subs, {
    maxAge: byDate ? 600000 : 86400000,
    rerender: () => {
      if (podcastState.screen === 'subs') {
        const sc = $p('podcastContent')?.scrollTop || keepScroll;
        renderPodcastHome(true);
        if ($p('podcastContent')) $p('podcastContent').scrollTop = sc;
      }
    }
  });
}
function refreshPodcastSubscriptionUI() {
  if ($p('podMineCount')) $p('podMineCount').textContent = `${podcastState.subs.length} suscripciones`;
  document.querySelectorAll('.pod-sub[data-podcast-key]').forEach(btn => {
    const k = btn.getAttribute('data-podcast-key') || '';
    const sub = podcastState.subs.some(s => podcastKey(s) === k);
    btn.classList.toggle('on', sub);
    btn.textContent = sub ? '✓ Suscrito · Quitar' : '＋ Suscribirse';
  });
  document.dispatchEvent(
    new CustomEvent('podcasts:subscriptions-changed', { detail: { count: podcastState.subs.length } })
  );
}
function togglePodcast(p) {
  const k = podcastKey(p);
  if (isSubscribed(p)) podcastState.subs = podcastState.subs.filter(s => podcastKey(s) !== k);
  else
    podcastState.subs.push({ ...normalizePodcastObject({ ...p }), subscribedAt: new Date().toISOString() });
  savePodcastSubs();
  refreshPodcastSubscriptionUI();
  if (podcastState.screen === 'subs') renderPodcastHome(true);
  else if (podcastState.screen === 'search')
    renderPodcastResults(podcastState.search, '🔎 Resultados de búsqueda', true);
  else if (podcastState.screen === 'landing') renderPodcastLanding(true);
}
function sharePodcast(p) {
  if (!p) return;
  const title = String(p.title || 'Podcast');
  const url = String(p.webUrl || p.htmlUrl || p.link || podcastFeedUrl(p) || '');
  if (!url) {
    alert('Este podcast no tiene un enlace para compartir.');
    return;
  }
  try {
    if (window.Android && typeof window.Android.sharePodcast === 'function') {
      window.Android.sharePodcast(title, url);
      return;
    }
  } catch (e) {}
  if (navigator.share) {
    navigator.share({ title, text: `${title} — Radios Viferor`, url }).catch(() => {});
    return;
  }
  try {
    navigator.clipboard
      .writeText(url)
      .then(() => alert('Enlace del podcast copiado.'))
      .catch(() => alert(url));
  } catch {
    alert(url);
  }
}
function podcastCard(p, episode = false) {
  const d = document.createElement('article');
  d.className = 'pod-card';
  const img = p.artwork || p.image || '';
  const activity = !episode ? podcastActivityStatus(p) : null;
  const subscribed = !episode && isSubscribed(p);
  d.innerHTML = `<div class="pod-art">${img ? `<img src="${pEsc(img)}" alt="" loading="lazy" decoding="async">` : '🎙️'}</div><div class="pod-body"><h3>${!episode && activity ? `<span class="pod-activity-dot ${activity.cls}" title="${pEsc(activity.date ? `Último episodio: ${activity.date}` : activity.label)}" aria-label="${pEsc(activity.label)}"></span>` : ''}${pEsc(p.title || 'Sin título')}</h3><div class="pod-meta">${pEsc(p.author || p.artist || '')} ${p.genre ? `· ${pEsc(p.genre)}` : ''}</div>${activity ? `<div class="pod-activity ${activity.cls}" title="${pEsc(activity.date ? `Último episodio: ${activity.date}` : activity.label)}">${activity.label}${activity.date ? ` · Último episodio: ${pEsc(activity.date)}` : ''}</div>` : ''}${episode ? `<div class="pod-desc">${pEsc((p.description || '').slice(0, 180))}</div><div class="pod-date">${pEsc(p.date || '')}</div>` : `<div class="pod-desc">${pEsc((p.description || '').slice(0, 150))}</div>`}<div class="pod-actions">${episode ? `<button class="pod-play" type="button">▶ Escuchar</button>` : `<button class="pod-sub ${subscribed ? 'on' : ''}" data-podcast-key="${pEsc(podcastKey(p))}" type="button">${subscribed ? '✓ Suscrito · Quitar' : '＋ Suscribirse'}</button><button class="pod-open" type="button">Episodios</button>${subscribed ? `<button class="pod-share" type="button" aria-label="Compartir podcast">↗ Compartir</button>` : ''}`}</div></div>`;
  if (episode) d.querySelector('.pod-play').onclick = () => playPodcastEpisode(p);
  else {
    d.querySelector('.pod-sub').onclick = () => togglePodcast(p);
    d.querySelector('.pod-open').onclick = () => loadPodcastEpisodes(p);
    const share = d.querySelector('.pod-share');
    if (share) share.onclick = () => sharePodcast(p);
  }
  return d;
}

async function searchPodcasts() {
  const requestToken = podcastNavToken;
  const q = $p('podSearchText').value.trim(),
    genre = $p('podGenre').value,
    country = $p('podCountry').value || 'ES',
    language = $p('podLanguage')?.value || '',
    mode = $p('podSort').value;
  const root = $p('podcastContent');
  document.body.classList.remove('podcast-subs-fullscreen');
  document.body.classList.add('podcast-results-active');
  root.scrollTop = 0;
  root.innerHTML = '<div class="pod-loading">Buscando podcasts…</div>';
  try {
    const u = new URL('/api/podcast-search', location.origin);
    u.searchParams.set('mode', mode === 'popular' ? 'popular' : 'search');
    u.searchParams.set('q', q);
    u.searchParams.set('genre', genre);
    u.searchParams.set('country', country);
    u.searchParams.set('language', language);
    u.searchParams.set('limit', '80');
    const r = await fetch(u);
    const d = await r.json();
    if (!r.ok) throw Error(d.error || 'Error');
    if (
      requestToken !== podcastNavToken ||
      !document.getElementById('viewPodcasts')?.classList.contains('active')
    )
      return;
    podcastState.search = (d.items || []).map(normalizePodcastObject);
    pushPodcastState('search');
    renderPodcastResults(
      podcastState.search,
      mode === 'popular'
        ? genre
          ? `🔥 Más populares · ${genre}`
          : '🔥 Más populares'
        : genre
          ? `🔎 ${genre}`
          : '🔎 Resultados de búsqueda',
      true
    );
  } catch (e) {
    if (
      requestToken !== podcastNavToken ||
      !document.getElementById('viewPodcasts')?.classList.contains('active')
    )
      return;
    root.innerHTML = `<div class="pod-empty"><div>⚠️</div><h3>No se pudo buscar</h3><p>${pEsc(e.message)}</p><button id="podBackError" type="button">← Volver</button></div>`;
    $p('podBackError').onclick = backFromPodcast;
  }
}
function renderPodcastResults(items, title, fromHistory = false) {
  if (!fromHistory) pushPodcastState('search');
  podcastState.screen = 'search';
  setPodcastLayout(true);
  document.body.classList.add('podcast-results-active');
  const root = $p('podcastContent');
  root.replaceChildren();
  root.scrollTop = 0;
  const h = document.createElement('div');
  h.className = 'pod-section-title pod-detail-head';
  h.innerHTML = `<button class="pod-back-btn" id="podBack" type="button">← Volver</button><h2>${pEsc(title)} <span>${items.length}</span></h2>`;
  root.append(h);
  $p('podBack').onclick = backFromPodcast;
  const grid = document.createElement('div');
  grid.className = 'pod-grid pod-results-grid';
  if (items.length) {
    items.forEach(p => grid.appendChild(podcastCard(p)));
  } else {
    const empty = document.createElement('div');
    empty.className = 'pod-empty pod-search-empty';
    empty.innerHTML =
      '<div>🔎</div><h3>No se encontraron podcasts</h3><p>Prueba otro texto, categoría, país u orden.</p>';
    root.append(empty);
    return;
  }
  root.append(grid);
  refreshPodcastActivity(items, {
    rerender: () => {
      if (podcastState.screen === 'search' && podcastState.search === items) {
        const sc = $p('podcastContent')?.scrollTop || 0;
        renderPodcastResults(items, title, true);
        if ($p('podcastContent')) $p('podcastContent').scrollTop = sc;
      }
    }
  });
}
async function loadPodcastEpisodes(p) {
  pushPodcastState('episodes');
  podcastState.screen = 'episodes';
  setPodcastLayout(true);
  const root = $p('podcastContent');
  root.innerHTML = '<div class="pod-loading">Cargando episodios…</div>';
  try {
    const feedUrl = podcastFeedUrl(p);
    if (!feedUrl) throw Error('Este podcast no tiene una URL RSS válida');
    const u = new URL('/api/podcast-feed', location.origin);
    u.searchParams.set('url', feedUrl);
    const r = await fetch(u, { cache: 'no-store' });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || d.detail || 'Error al leer el feed');
    const feed = normalizePodcastObject(d.feed || {});
    const eps = Array.isArray(d.episodes)
      ? d.episodes
          .map(e => ({
            ...normalizePodcastObject(e),
            podcastTitle: repairPodcastText(p.title || feed.title || 'Podcast'),
            podcastArt: p.artwork || p.image || feed.image || feed.artwork || '',
            author: e.author || p.author || feed.author || '',
            feedUrl
          }))
          .filter(e => e.audioUrl)
      : [];
    podcastState.episodes = eps;
    const latestEpisode = eps
      .map(e => podcastDateValue(e.date))
      .filter(Boolean)
      .reduce((a, b) => Math.max(a, b), 0);
    if (latestEpisode) {
      p.latestEpisodeAt = new Date(latestEpisode).toISOString();
      p.latestEpisodeCheckedAt = Date.now();
      try {
        savePodcastSubs();
      } catch {}
    }
    const h = document.createElement('div');
    h.className = 'pod-section-title pod-detail-head';
    h.innerHTML = `<button class="pod-back-btn" id="podBack" type="button">← Volver</button><div class="pod-detail-title"><h2>${pEsc(p.title || feed.title || 'Podcast')}</h2><span>${eps.length} episodios</span></div>`;
    root.replaceChildren(h);
    $p('podBack').onclick = backFromPodcast;
    if (!eps.length) {
      const empty = document.createElement('div');
      empty.className = 'pod-empty';
      empty.innerHTML =
        '<div>🎙️</div><h3>No hay episodios disponibles</h3><p>El feed se ha leído correctamente, pero no contiene episodios con audio reproducible.</p>';
      root.append(empty);
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'pod-episodes';
    eps.forEach(e => grid.appendChild(podcastCard(e, true)));
    root.append(grid);
  } catch (e) {
    root.innerHTML = `<div class="pod-empty"><div>⚠️</div><h3>No se pudieron cargar los episodios</h3><p>${pEsc(e.message)}</p><button id="podBack" class="pod-back-btn" type="button">← Volver</button></div>`;
    $p('podBack').onclick = backFromPodcast;
  }
}
async function fetchSubEpisodes(limitEach = 8) {
  const all = [];
  for (let i = 0; i < podcastState.subs.length; i += 5) {
    const batch = podcastState.subs.slice(i, i + 5).map(async p => {
      try {
        const u = new URL('/api/podcast-feed', location.origin);
        u.searchParams.set('url', podcastFeedUrl(p));
        u.searchParams.set('limit', String(limitEach));
        const r = await fetch(u);
        if (!r.ok) return [];
        const d = await r.json();
        return (d.episodes || [])
          .slice(0, limitEach)
          .map(e => ({
            ...e,
            podcastTitle: p.title,
            podcastArt: p.artwork || d.feed.image,
            author: p.author || d.feed.author,
            feedUrl: podcastFeedUrl(p)
          }));
      } catch {
        return [];
      }
    });
    const rows = await Promise.all(batch);
    rows.forEach(a => all.push(...a));
  }
  return all;
}
function shuffled(list) {
  // Fisher-Yates: barajado uniforme (sort con Math.random no lo es).
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
async function playAll(mode) {
  pushPodcastState(
    mode === 'random' ? 'queue-random' : mode === 'continue' ? 'queue-continue' : 'queue-latest'
  );
  podcastState.screen = 'queue';
  setPodcastLayout(true);
  const root = $p('podcastContent');
  // «Continuar» usa los episodios que dejaste a medias (no hace falta red).
  const resumable = mode === 'continue' ? inProgressEpisodes() : [];
  let q;
  if (resumable.length) {
    q = resumable;
  } else {
    root.innerHTML = '<div class="pod-loading">Preparando una cola con todas tus suscripciones…</div>';
    const eps = await fetchSubEpisodes(10);
    if (!eps.length) {
      root.innerHTML =
        '<div class="pod-empty"><div>🎙️</div><h3>No hay episodios disponibles</h3><p>Comprueba tus suscripciones o la conexión.</p><button id="podBack" class="pod-back-btn" type="button">← Volver</button></div>';
      $p('podBack').onclick = backFromPodcast;
      return;
    }
    if (mode === 'random') q = shuffled(eps);
    else if (mode === 'continue')
      q = eps
        .filter(e => !isEpisodeDone(e.id))
        .sort((a, b) => podcastDateValue(b.date) - podcastDateValue(a.date));
    else q = [...eps].sort((a, b) => podcastDateValue(b.date) - podcastDateValue(a.date));
  }
  podcastState.queue = q;
  savePodcastQueue();
  playPodcastQueue();
  renderPodcastQueue(mode, true);
}
// Hosts cuyo audio se sirve a través de /api/podcast-audio (Radio MARCA y
// otros de Omny/Triton). Debe coincidir con la lista de api/podcast-audio.js.
const PODCAST_PROXY_HOSTS = /(^|\.)omny\.fm$|(^|\.)omnycontent\.com$|(^|\.)tritondigital\.com$/i;
function podcastAudioSource(raw) {
  let src = String(raw || '').replace(/&amp;/gi, '&');
  if (!src) return '';
  try {
    if (podcastAudioNeedsProxy(src)) {
      const proxy = new URL('/api/podcast-audio', location.origin);
      proxy.searchParams.set('url', src);
      proxy.searchParams.set('stream', '1');
      return proxy.toString();
    }
  } catch {}
  return src;
}
function podcastAudioNeedsProxy(raw) {
  try {
    const host = new URL(String(raw || ''), location.href).hostname.toLowerCase();
    return PODCAST_PROXY_HOSTS.test(host);
  } catch {
    return false;
  }
}
function playPodcastEpisode(e) {
  pushPodcastState('queue-episode');
  podcastState.screen = 'queue';
  setPodcastLayout(true);
  podcastState.queue = [e, ...podcastState.queue.filter(x => x.id !== e.id)];
  savePodcastQueue();
  playPodcastQueue();
  renderPodcastQueue('episode', true);
}
async function playPodcastQueue() {
  const radioAudio = document.getElementById('audioPlayer');
  if (radioAudio && !radioAudio.paused) {
    try {
      radioAudio.pause();
    } catch {}
  }
  const e = podcastState.queue[0];
  if (!e) return;
  podcastClosing = false;
  clearTimeout(podcastPauseTimer);
  const previousKey = podcastKey(podcastState.current || {}),
    nextKey = podcastKey(e);
  if (previousKey !== nextKey) registerPodcastPlay(e);
  podcastState.current = e;
  window.__podMediaStarted = false;
  const a = $p('podcastAudio');
  try {
    let rawSrc = String(e.audioUrl || '').replace(/&amp;/gi, '&');
    let src = podcastAudioSource(rawSrc);
    if (!src) throw new Error('El episodio no tiene URL de audio');
    let retriedDirect = false;
    const applyResume = () => {
      const saved = getEpisodePos(e.id);
      if (saved > 5 && saved < Math.max(0, a.duration - 10)) a.currentTime = saved;
      updatePodcastPlayerUI();
    };
    a.src = src;
    a.load();
    a.onloadedmetadata = applyResume;
    a.onerror = () => {
      try {
        window.logError?.('PODCAST_AUDIO', 'MEDIA_ERROR ' + (a.error?.code || 'unknown') + ' | ' + src);
      } catch {}
      if ($p('podcastNowSub'))
        $p('podcastNowSub').textContent = (e.podcastTitle || e.author || '') + ' · Error de audio';
    };
    a.onstalled = () => {
      try {
        window.logError?.('PODCAST_AUDIO', 'MEDIA_STALLED | ' + src);
      } catch {}
    };
    a.onabort = () => {
      try {
        window.logError?.('PODCAST_AUDIO', 'MEDIA_ABORT | ' + src);
      } catch {}
    };
    a.onemptied = () => {
      try {
        window.logError?.('PODCAST_AUDIO', 'MEDIA_EMPTIED | ' + src);
      } catch {}
    };
    a.onplay = () => {
      try {
        syncPodcastAndroidMedia();
        savePodcastResume(true);
      } catch {}
    };
    a.onpause = () => {
      try {
        syncPodcastAndroidMedia();
        savePodcastResume(false);
      } catch {}
    };
    a.ontimeupdate = () => {
      updatePodcastPlayerUI();
    };
    try {
      await a.play();
    } catch (firstErr) {
      if (podcastAudioNeedsProxy(rawSrc) && !retriedDirect) {
        retriedDirect = true;
        try {
          window.logError?.('PODCAST_AUDIO', 'PROXY_FALLBACK_DIRECT | ' + rawSrc);
        } catch {}
        a.src = rawSrc;
        a.load();
        await a.play();
      } else throw firstErr;
    }
    savePodcastResume();
  } catch (err) {
    try {
      window.logError?.('PODCAST_AUDIO', 'PLAY_ERROR ' + (err?.message || err));
    } catch {}
  }
  $p('podcastNow').textContent = e.title;
  $p('podcastNowSub').textContent = e.podcastTitle || e.author || '';
  const art = $p('podExpandedArt');
  if (art) art.innerHTML = e.podcastArt ? `<img src="${pEsc(e.podcastArt)}" alt="">` : '🎙️';
  $p('podExpandedTitle').textContent = e.title;
  $p('podExpandedSub').textContent = e.podcastTitle || e.author || '';
  updatePodcastPlayerUI();
}
function nextPodcast() {
  if (podcastState.queue.length) {
    const current = podcastState.queue.shift();
    if (current) podcastState.history.push(current);
  }
  savePodcastQueue();
  playPodcastQueue();
  if (podcastState.screen === 'queue') renderPodcastQueue('latest', true);
}
function renderPodcastQueue(mode, fromHistory = false) {
  if (!fromHistory)
    pushPodcastState(
      mode === 'random' ? 'queue-random' : mode === 'continue' ? 'queue-continue' : 'queue-latest'
    );
  podcastState.screen = 'queue';
  setPodcastLayout(true);
  const root = $p('podcastContent');
  root.replaceChildren();
  const h = document.createElement('div');
  h.className = 'pod-section-title pod-detail-head';
  h.innerHTML = `<button class="pod-back-btn" id="podBack" type="button">← Volver</button><h2>${mode === 'random' ? '🔀 Mezcla de todas tus suscripciones' : mode === 'continue' ? '▶️ Continuar escuchando' : mode === 'episode' ? '▶️ Reproduciendo' : '🆕 Últimos episodios'} <span>${podcastState.queue.length}</span></h2>`;
  root.append(h);
  $p('podBack').onclick = backFromPodcast;
  const list = document.createElement('div');
  list.className = 'pod-queue';
  podcastState.queue.slice(0, 60).forEach((e, i) => {
    const row = document.createElement('div');
    row.className = 'pod-queue-row';
    row.innerHTML = `<span class="qnum">${i + 1}</span><div><strong>${pEsc(e.title)}</strong><small>${pEsc(e.podcastTitle || '')}</small></div><button type="button">▶</button>`;
    row.querySelector('button').onclick = () => {
      podcastState.queue = [e, ...podcastState.queue.filter(x => x.id !== e.id)];
      playPodcastQueue();
    };
    list.append(row);
  });
  root.append(list);
}
async function exportPodcastOPML() {
  if (!podcastState.subs.length) {
    alert('No tienes suscripciones.');
    return;
  }
  const esc = v =>
    String(v || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  const body = podcastState.subs
    .map(
      p =>
        `<outline text="${esc(p.title)}" title="${esc(p.title)}" type="rss" xmlUrl="${esc(p.feedUrl)}"${p.webUrl ? ` htmlUrl="${esc(p.webUrl)}"` : ''} />`
    )
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>Radios Viferor Podcasts</title></head><body>\n${body}\n</body></opml>`;
  const name = 'radios-viferor-podcasts-' + new Date().toISOString().slice(0, 10) + '.opml';
  if (window.Android && typeof window.Android.saveTextFile === 'function') {
    window.Android.saveTextFile(name, xml, 'text/x-opml');
    return;
  }
  if (window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({
        suggestedName: name,
        types: [
          { description: 'Suscripciones OPML', accept: { 'text/x-opml': ['.opml'], 'text/xml': ['.xml'] } }
        ]
      });
      const w = await h.createWritable();
      await w.write(xml);
      await w.close();
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([xml], { type: 'text/x-opml' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function hydratePodcastArtwork(items) {
  const pending = items.filter(p => podcastFeedUrl(p) && !(p.artwork || p.image));
  if (!pending.length) return Promise.resolve(false);
  // maxAge 0: se consulta aunque haya caché, porque falta la portada.
  return refreshPodcastActivity(pending, {
    maxAge: 0,
    rerender: () => {
      if (podcastState.screen === 'subs') renderPodcastHome(true);
    }
  });
}

function importPodcastOPML(ev) {
  const f = ev.target.files?.[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const doc = new DOMParser().parseFromString(r.result, 'text/xml');
      if (doc.querySelector('parsererror')) throw Error('OPML/XML no válido');
      const found = [...doc.querySelectorAll('outline')]
        .map(o => ({
          title: o.getAttribute('title') || o.getAttribute('text') || 'Podcast',
          feedUrl: o.getAttribute('xmlUrl') || o.getAttribute('xmlurl') || '',
          webUrl: o.getAttribute('htmlUrl') || o.getAttribute('htmlurl') || ''
        }))
        .filter(p => p.feedUrl && /^https?:\/\//i.test(p.feedUrl));
      const map = new Map(podcastState.subs.map(p => [podcastKey(p), p]));
      found.forEach(p => {
        const k = podcastKey(p);
        if (!map.has(k)) map.set(k, p);
      });
      podcastState.subs = [...map.values()];
      savePodcastSubs();
      renderPodcastHome(true);
      alert(`✅ ${found.length} suscripciones encontradas. Total: ${podcastState.subs.length}`);
      hydratePodcastArtwork(podcastState.subs);
    } catch (e) {
      alert('Error al importar OPML: ' + e.message);
    } finally {
      ev.target.value = '';
    }
  };
  r.readAsText(f);
}
function switchToPodcasts() {
  const fav = document.getElementById('viewFav'),
    search = document.getElementById('viewSearch'),
    pods = document.getElementById('viewPodcasts'),
    btn = $p('btnViewPodcasts');
  fav?.classList.remove('active');
  search?.classList.remove('active');
  pods?.classList.add('active');
  document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  renderPodcastLanding(false);
}
function switchToRadios() {
  document.body.classList.remove(
    'podcasts-active',
    'podcast-detail-active',
    'podcast-subs-fullscreen',
    'podcast-results-active'
  );
  const pods = document.getElementById('viewPodcasts'),
    search = document.getElementById('viewSearch'),
    fav = document.getElementById('viewFav'),
    btn = $p('btnViewRadios');
  pods?.classList.remove('active');
  search?.classList.remove('active');
  fav?.classList.add('active');
  document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  if (typeof renderFavoritas === 'function') renderFavoritas();
}
function restorePodcastHistory(st) {
  const pods = document.getElementById('viewPodcasts');
  if (!pods?.classList.contains('active')) {
    switchToPodcasts();
  }
  const s = st?.podcastScreen || 'landing';
  if (s === 'landing') renderPodcastLanding(true);
  else if (s === 'subs') renderPodcastHome(true);
  else if (s === 'search') renderPodcastResults(podcastState.search, '🔎 Resultados de búsqueda', true);
  else if (s === 'episodes' && podcastState.episodes.length) {
    const e = podcastState.episodes;
    setPodcastLayout(true);
    const root = $p('podcastContent');
    root.replaceChildren();
    const h = document.createElement('div');
    h.className = 'pod-section-title pod-detail-head';
    h.innerHTML = `<button class="pod-back-btn" id="podBack" type="button">← Volver</button><div class="pod-detail-title"><h2>${pEsc(e[0]?.podcastTitle || 'Podcast')}</h2><span>${e.length} episodios</span></div>`;
    root.append(h);
    $p('podBack').onclick = backFromPodcast;
    const grid = document.createElement('div');
    grid.className = 'pod-episodes';
    e.forEach(x =>
      grid.appendChild(
        podcastCard(
          {
            title: x.title,
            author: x.author,
            image: x.image || x.podcastArt,
            date: x.date,
            description: x.description,
            audioUrl: x.audioUrl,
            id: x.id
          },
          true
        )
      )
    );
    root.append(grid);
  } else if (s.startsWith('queue'))
    renderPodcastQueue(
      s === 'queue-random' ? 'random' : s === 'queue-continue' ? 'continue' : 'latest',
      true
    );
  else renderPodcastLanding(true);
}
function fmtPodTime(v) {
  if (!Number.isFinite(v) || v < 0) return '0:00';
  const m = Math.floor(v / 60),
    sec = Math.floor(v % 60);
  return m + ':' + String(sec).padStart(2, '0');
}
function updatePodcastPlayerUI() {
  const a = $p('podcastAudio');
  if (!a) return;
  const cur = Number.isFinite(a.currentTime) ? a.currentTime : 0,
    dur = Number.isFinite(a.duration) ? a.duration : 0;
  const pr = $p('podProgressRange');
  if (pr) {
    pr.max = dur || 100;
    pr.value = Math.min(cur, dur || 100);
  }
  if ($p('podCurrentTime')) $p('podCurrentTime').textContent = fmtPodTime(cur);
  if ($p('podDuration')) $p('podDuration').textContent = fmtPodTime(dur);
  const playing = !a.paused;
  if ($p('podPlayPause')) $p('podPlayPause').textContent = playing ? '⏸' : '▶';
  if ($p('podExpPlay')) $p('podExpPlay').textContent = playing ? '⏸' : '▶';
}
function syncPodcastAndroidMedia(force = false) {
  try {
    const a = $p('podcastAudio');
    const e = podcastState.current;
    if (!a || !e || !window.Android) return;
    const radioAudio = document.getElementById('audioPlayer');
    if ((radioAudio && !radioAudio.paused && !radioAudio.ended) || window.__radioMediaStarted) return;
    const d = Number.isFinite(a.duration) ? a.duration : 0;
    const pos = Number.isFinite(a.currentTime) ? a.currentTime : 0;
    const playing = !a.paused && !a.ended;
    if (force || !window.__podMediaStarted) {
      if (typeof window.Android.startPodcastMedia === 'function') {
        window.__podMediaStarted = true;
        window.Android.startPodcastMedia(
          e.title || 'Podcast',
          e.podcastTitle || e.author || 'Radios Viferor',
          e.podcastArt || e.image || '',
          d,
          pos,
          playing
        );
      }
    } else if (typeof window.Android.updatePodcastMedia === 'function') {
      window.Android.updatePodcastMedia(d, pos, playing);
    }
  } catch {}
}
window.viferorNativePodcastPlay = () => {
  const a = $p('podcastAudio');
  if (a) a.play().catch(() => {});
};
window.viferorNativePodcastPause = () => {
  const a = $p('podcastAudio');
  if (a) a.pause();
};
window.viferorNativePodcastSeek = delta => {
  seekPodcast(Number(delta) || 0);
};
window.viferorNativePodcastSetPosition = ms => {
  const a = $p('podcastAudio');
  if (a && Number.isFinite(a.duration))
    a.currentTime = Math.max(0, Math.min(a.duration, (Number(ms) || 0) / 1000));
  updatePodcastPlayerUI();
  savePodcastResume();
};
window.viferorNativePodcastNext = () => nextPodcast();
window.viferorNativePodcastPrevious = () => previousPodcast();
function seekPodcast(delta) {
  const a = $p('podcastAudio');
  if (a && Number.isFinite(a.currentTime))
    a.currentTime = Math.max(0, Math.min(a.duration || Infinity, a.currentTime + delta));
  updatePodcastPlayerUI();
}
function setPodcastVolume(v) {
  const a = $p('podcastAudio');
  if (!a) return;
  v = Math.max(0, Math.min(100, Number(v) || 0));
  a.volume = v / 100;
  if (v > 0) window._podPrevVol = v / 100;
  const icon = v === 0 ? '🔇' : v < 40 ? '🔉' : '🔊';
  ['podMute', 'podExpMute'].forEach(id => {
    if ($p(id)) $p(id).textContent = icon;
  });
  ['podVolumeRange', 'podExpVolume'].forEach(id => {
    if ($p(id)) $p(id).value = v;
  });
  ['podVolumeValue', 'podExpVolumeValue'].forEach(id => {
    if ($p(id)) $p(id).value = v + '%';
  });
}
function togglePodcastMute() {
  const a = $p('podcastAudio');
  if (!a) return;
  if (a.volume > 0) {
    window._podPrevVol = a.volume;
    setPodcastVolume(0);
  } else setPodcastVolume(Math.round((window._podPrevVol || 0.8) * 100));
}
function togglePodcastPlay() {
  const a = $p('podcastAudio');
  if (!a || !podcastState.current) return;
  if (a.paused) a.play().catch(() => {});
  else a.pause();
  savePodcastResume();
  updatePodcastPlayerUI();
}
function openPodcastExpanded() {
  const x = $p('podExpanded');
  if (x) x.hidden = false;
  updatePodcastPlayerUI();
}
function closePodcastExpanded() {
  const x = $p('podExpanded');
  if (x) x.hidden = true;
}
function previousPodcast() {
  if (podcastState.history.length) {
    const prev = podcastState.history.pop();
    if (prev) {
      podcastState.queue = [prev, ...podcastState.queue.filter(x => x.id !== prev.id)];
      playPodcastQueue();
      renderPodcastQueue('episode', true);
    }
  } else if (podcastState.queue.length > 1) {
    podcastState.queue.push(podcastState.queue.shift());
    playPodcastQueue();
  }
}
window.handleAndroidBack = function () {
  try {
    // Ajustes o menús abiertos: Atrás los cierra.
    const settings = document.getElementById('settingsMenu');
    if (settings && !settings.hidden) {
      settings.hidden = true;
      return true;
    }
    const modal = document.querySelector('.error-modal:not([hidden]), .update-modal:not([hidden])');
    if (modal) {
      modal.hidden = true;
      return true;
    }
    const expanded = document.getElementById('podExpanded');
    if (expanded && !expanded.hidden && typeof closePodcastExpanded === 'function') {
      closePodcastExpanded();
      return true;
    }
    const pods = document.getElementById('viewPodcasts');
    const search = document.getElementById('viewSearch');
    if (search?.classList.contains('active')) {
      if (typeof cambiarVista === 'function') cambiarVista('fav');
      return true;
    }
    if (pods?.classList.contains('active')) {
      backFromPodcast();
      return true;
    }
    // Pantalla principal de Radios: false → Android manda la app a segundo plano
    // (no se cierra; la radio sigue sonando).
    return false;
  } catch (e) {
    console.warn('Android back handler', e);
    return true;
  }
};

window.openPodcastFromNotification = async function (url) {
  try {
    switchToPodcasts();
    // La notificación nativa envía la URL del feed de la suscripción.
    const wanted = String(url || '').trim().toLowerCase();
    const sub = podcastState.subs.find(p => podcastKey(p) === wanted);
    if (sub) {
      await loadPodcastEpisodes(sub);
      return;
    }
    if (/^https?:\/\//i.test(wanted)) {
      await loadPodcastEpisodes({ feedUrl: String(url).trim(), title: 'Podcast' });
      return;
    }
    renderPodcastLanding(false);
  } catch (e) {
    console.warn('Podcast notification', e);
  }
};

function retryPodcastAutoplay(a, tries = 0) {
  if (!a) return;
  a.play()
    .then(() => savePodcastResume())
    .catch(() => {
      if (tries < 4) setTimeout(() => retryPodcastAutoplay(a, tries + 1), 700);
    });
}

function restoreLastPlayback() {
  try {
    const now = Date.now(),
      maxAge = 86400000;
    const radio = JSON.parse(localStorage.getItem('radio_resume_state') || 'null');
    const pod = JSON.parse(localStorage.getItem(PODCAST_RESUME_KEY) || 'null');
    const states = [];
    if (radio && radio.station && radio.playing !== false && now - Number(radio.at || 0) < maxAge)
      states.push({ ...radio, type: 'radio' });
    if (pod && pod.episode && pod.playing !== false && now - Number(pod.at || 0) < maxAge)
      states.push({ ...pod, type: 'podcast' });
    const last = JSON.parse(localStorage.getItem(PLAYBACK_RESUME_KEY) || 'null');
    if (last && last.type && last.playing !== false && now - Number(last.at || 0) < maxAge) states.push(last);
    states.sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
    const chosen = states[0];
    if (!chosen) return;
    // Por defecto solo se deja preparado (sin sonar); con «Reanudar al abrir»
    // activado en Ajustes, se reanuda automáticamente.
    let autoplay = false;
    try {
      autoplay = localStorage.getItem('radios_viferor_autoresume') === '1';
    } catch {}
    if (chosen.type === 'podcast' && chosen.episode) {
      podcastState.current = chosen.episode;
      podcastState.queue = [chosen.episode, ...podcastState.queue.filter(x => x.id !== chosen.episode.id)];
      const a = $p('podcastAudio');
      if (!a) return;
      const savedPos = Math.max(Number(chosen.pos) || 0, getEpisodePos(chosen.episode.id));
      a.preload = 'metadata';
      a.src = podcastAudioSource(chosen.episode.audioUrl);
      a.onloadedmetadata = () => {
        if (savedPos > 0) a.currentTime = Math.min(savedPos, Math.max(0, a.duration || savedPos));
        updatePodcastPlayerUI();
        if (autoplay) retryPodcastAutoplay(a);
      };
      $p('podcastNow').textContent = chosen.episode.title || 'Sin episodio';
      $p('podcastNowSub').textContent = chosen.episode.podcastTitle || chosen.episode.author || '';
    } else if (chosen.type === 'radio' && chosen.station) {
      if (autoplay && typeof window.reproducirRadio === 'function')
        setTimeout(() => window.reproducirRadio(chosen.station), 900);
      else if (typeof window.prepararRadio === 'function') window.prepararRadio(chosen.station);
    }
  } catch {}
}

function initPodcasts() {
  migrateLegacyPodcastProgress();
  loadPodcastSubs();
  try {
    if (window.Android && typeof window.Android.syncPodcastSubscriptions === 'function')
      window.Android.syncPodcastSubscriptions(JSON.stringify(podcastState.subs));
  } catch {}
  if ($p('podMineCount')) $p('podMineCount').textContent = `${podcastState.subs.length} suscripciones`;
  const g = $p('podGenre');
  if (g) g.innerHTML = podcastGenres.map(x => `<option>${x}</option>`).join('');
  if ($p('podLanguage'))
    $p('podLanguage').value = localStorage.getItem('radios_viferor_podcast_language') || '';
  if ($p('podLanguage'))
    $p('podLanguage').addEventListener('change', e =>
      localStorage.setItem('radios_viferor_podcast_language', e.target.value || '')
    );
  const togglePodcastMineMenu = (force = null) => {
    const m = $p('podMineMenu'),
      b = $p('podMine');
    if (!m || !b) return;
    const open = force === null ? m.hidden : !!force;
    m.hidden = !open;
    b.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  const openPodcastSearchDrawer = () => {
    const d = $p('podSearchDrawer');
    if (d) d.hidden = false;
    togglePodcastMineMenu(false);
    $p('podSearchText')?.focus();
  };
  const closePodcastSearchDrawer = () => {
    const d = $p('podSearchDrawer');
    if (d) d.hidden = true;
  };
  $p('podSearchBtn').onclick = () => {
    closePodcastSearchDrawer();
    searchPodcasts();
  };
  $p('podSearchText').addEventListener('keydown', e => {
    if (e.key === 'Enter') $p('podSearchBtn').click();
  });
  const pf = $p('podcastFile');
  if (pf) pf.addEventListener('change', importPodcastOPML);
  $p('podMine').onclick = e => {
    e.preventDefault();
    e.stopPropagation();
    togglePodcastMineMenu();
  };
  $p('podMineOpen').onclick = () => {
    togglePodcastMineMenu(false);
    pushPodcastState('subs');
    renderPodcastHome(true);
  };
  $p('podMineSearch').onclick = openPodcastSearchDrawer;
  $p('podMineImport').onclick = () => {
    $p('podcastFile')?.click();
    togglePodcastMineMenu(false);
  };
  $p('podSearchOpen').onclick = openPodcastSearchDrawer;
  $p('podSearchClose').onclick = closePodcastSearchDrawer;
  document.addEventListener('click', e => {
    if (!e.target.closest('.pod-mine-wrap')) togglePodcastMineMenu(false);
  });
  $p('btnViewPodcasts').onclick = switchToPodcasts;
  $p('btnViewRadios').onclick = switchToRadios;
  window.addEventListener('popstate', () => {
    if (history.state?.podcastScreen) restorePodcastHistory(history.state);
    else switchToRadios();
  });
  const pa = $p('podcastAudio');
  window._podPrevVol = 0.8;
  pa.volume = 0.8;
  pa.addEventListener('play', () => {
    const radioAudio = $p('audioPlayer');
    if (radioAudio && !radioAudio.paused) {
      try {
        radioAudio.pause();
      } catch {}
    }
    window.__radioMediaStarted = false;
    try {
      window.Android?.setPlaybackSection?.('podcast');
    } catch {}
    syncPodcastAndroidMedia(true);
    updatePodcastPlayerUI();
  });
  let lastResumeSave = 0,
    lastAndroidMediaSync = 0;
  pa.addEventListener('timeupdate', () => {
    const now = Date.now();
    // La sesión multimedia de Android extrapola la posición; basta con sincronizar cada 5 s.
    if (now - lastAndroidMediaSync >= 5000) {
      lastAndroidMediaSync = now;
      syncPodcastAndroidMedia(false);
    }
    if (podcastState.current && Number.isFinite(pa.currentTime)) {
      setEpisodePos(podcastState.current, pa.currentTime, pa.duration);
      if (now - lastResumeSave >= 5000) {
        lastResumeSave = now;
        savePodcastResume(true);
      }
    }
    updatePodcastPlayerUI();
  });
  pa.addEventListener('loadedmetadata', () => {
    syncPodcastAndroidMedia(false);
    updatePodcastPlayerUI();
  });
  pa.addEventListener('pause', () => {
    flushPodcastProgress(true);
    syncPodcastAndroidMedia(true);
    updatePodcastPlayerUI();
  });
  pa.addEventListener('ended', () => {
    try {
      window.Android?.stopPodcastMedia?.();
    } catch {}
    window.__podMediaStarted = false;
    if (podcastState.current) {
      markEpisodeDone(podcastState.current.id);
      clearEpisodePos(podcastState.current.id);
    }
    nextPodcast();
  });
  ['podBack15', 'podExpBack15'].forEach(id => {
    if ($p(id)) $p(id).onclick = () => seekPodcast(-15);
  });
  ['podForward15', 'podExpForward15'].forEach(id => {
    if ($p(id)) $p(id).onclick = () => seekPodcast(30);
  });
  ['podPrev', 'podExpPrev'].forEach(id => {
    if ($p(id)) $p(id).onclick = previousPodcast;
  });
  ['podNext', 'podExpNext'].forEach(id => {
    if ($p(id)) $p(id).onclick = nextPodcast;
  });
  ['podPlayPause', 'podExpPlay'].forEach(id => {
    if ($p(id)) $p(id).onclick = togglePodcastPlay;
  });
  ['podMute', 'podExpMute'].forEach(id => {
    if ($p(id)) $p(id).onclick = togglePodcastMute;
  });
  ['podVolumeRange', 'podExpVolume'].forEach(id => {
    if ($p(id)) $p(id).addEventListener('input', e => setPodcastVolume(e.target.value));
  });
  if ($p('podProgressRange'))
    $p('podProgressRange').addEventListener('input', e => {
      if (Number.isFinite(pa.duration)) pa.currentTime = Number(e.target.value);
      updatePodcastPlayerUI();
    });
  if ($p('podcastMiniOpen')) {
    const open = () => openPodcastExpanded();
    $p('podcastMiniOpen').onclick = open;
    $p('podcastMiniOpen').onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') open();
    };
  }
  if ($p('podExpandedClose')) $p('podExpandedClose').onclick = closePodcastExpanded;
  if ($p('podExpanded'))
    $p('podExpanded').addEventListener('click', e => {
      if (e.target.id === 'podExpanded') closePodcastExpanded();
    });
  const savePodcastOnHidden = () => {
    if (document.visibilityState === 'hidden') {
      flushPodcastProgress(true);
      // Solo cuenta como «cerrando» si estaba sonando; si no, no se reanuda.
      podcastClosing = !pa.paused;
      if (!pa.paused) savePodcastResume(true);
    } else {
      podcastClosing = false;
    }
  };
  document.addEventListener('visibilitychange', savePodcastOnHidden);
  window.addEventListener('pagehide', () => {
    podcastClosing = true;
    savePodcastResume(true);
  });
  window.addEventListener('beforeunload', () => {
    podcastClosing = true;
    savePodcastResume(true);
  });
  pa.addEventListener('pause', () => {
    savePodcastResume();
    clearTimeout(podcastPauseTimer);
    if (!podcastClosing)
      podcastPauseTimer = setTimeout(() => {
        if (!podcastClosing) localStorage.removeItem(PLAYBACK_RESUME_KEY);
      }, 1200);
  });
  pa.addEventListener('seeked', savePodcastResume);
  try {
    restoreLastPlayback();
  } catch {}
  renderPodcastLanding(true);
  hydratePodcastArtwork(podcastState.subs);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPodcasts);
else initPodcasts();

window.exportPodcastOPML = exportPodcastOPML;
