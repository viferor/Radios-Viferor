// Cola de reproducción y listas de podcasts (1.16.0).
//
// · Cola: lo que suena después del episodio actual. Se guarda entre sesiones, se
//   reordena arrastrando y tiene opciones (repetir, avance automático, saltar
//   escuchados, seguir con novedades al vaciarse).
// · Listas manuales: episodios que eliges tú, en el orden que quieras.
// · Listas inteligentes: reglas (qué podcasts, sin escuchar, fecha, duración,
//   orden, máximo) que se resuelven al abrirlas o reproducirlas.
// · Reproductor: velocidad y temporizador para dormir.
//
// Usa las funciones globales de podcasts.js (podcastState, epKey, playEpisodeNow,
// savePodcastQueue, podcastFeedUrl…), que se cargan antes.

/* ---------------------------------------------------------------------------
   Utilidades: avisos, menús inferiores, textos
--------------------------------------------------------------------------- */
let podToastTimer = null;
function podToast(msg, { action = '', onAction = null, ms = 2800 } = {}) {
  let t = document.getElementById('podToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'podToast';
    t.className = 'pod-toast';
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    document.body.append(t);
  }
  t.replaceChildren();
  const span = document.createElement('span');
  span.textContent = msg;
  t.append(span);
  if (action && onAction) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action;
    b.onclick = () => {
      t.classList.remove('show');
      onAction();
    };
    t.append(b);
    ms = Math.max(ms, 5000);
  }
  t.classList.add('show');
  clearTimeout(podToastTimer);
  podToastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
window.podToast = podToast;

let podSheetEl = null;
// Cierra el menú inferior abierto. Devuelve true si había uno (para «Atrás»).
function podSheetClose(cancelled = true) {
  if (!podSheetEl) return false;
  const el = podSheetEl;
  podSheetEl = null;
  const cb = cancelled ? el._onClose : null;
  el.remove();
  document.body.classList.remove('pod-sheet-open');
  try {
    cb?.();
  } catch {}
  return true;
}
window.closePodSheet = () => podSheetClose(true);
// Menú inferior: título, opciones [{icon,label,hint,on,danger,disabled}] y/o un
// cuerpo propio (formularios). onClose solo se llama si se cancela.
function podSheet({ title = '', subtitle = '', items = [], body = null, onClose = null, cancel = 'Cancelar' } = {}) {
  podSheetClose(false);
  const wrap = document.createElement('div');
  wrap.className = 'pod-sheet';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  if (title) wrap.setAttribute('aria-label', title);
  const card = document.createElement('div');
  card.className = 'pod-sheet-card';
  if (title || subtitle)
    card.insertAdjacentHTML(
      'beforeend',
      `<div class="pod-sheet-head">${title ? `<strong>${pEsc(title)}</strong>` : ''}${subtitle ? `<small>${pEsc(subtitle)}</small>` : ''}</div>`
    );
  items.filter(Boolean).forEach(it => {
    if (it.sep) {
      card.insertAdjacentHTML('beforeend', '<hr class="pod-sheet-sep">');
      return;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pod-sheet-item' + (it.danger ? ' danger' : '') + (it.on && it.checked ? ' checked' : '');
    b.disabled = !!it.disabled;
    b.innerHTML = `<span class="i" aria-hidden="true">${it.icon || ''}</span><span class="t"><strong>${pEsc(it.label)}</strong>${
      it.hint ? `<small>${pEsc(it.hint)}</small>` : ''
    }</span>${it.checked ? '<span class="ok" aria-hidden="true">✓</span>' : ''}`;
    b.onclick = () => {
      podSheetClose(false);
      it.on?.();
    };
    card.append(b);
  });
  if (body) card.append(body);
  if (cancel) {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'pod-sheet-cancel';
    c.textContent = cancel;
    c.onclick = () => podSheetClose(true);
    card.append(c);
  }
  wrap.append(card);
  wrap.addEventListener('click', e => {
    if (e.target === wrap) podSheetClose(true);
  });
  wrap._onClose = onClose;
  document.body.append(wrap);
  document.body.classList.add('pod-sheet-open');
  podSheetEl = wrap;
  requestAnimationFrame(() => wrap.classList.add('show'));
  return card;
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && podSheetEl) podSheetClose(true);
});

// Pide un texto (nombre de lista). Promesa con el texto o null.
function podPromptText({ title, label = '', value = '', ok = 'Guardar', placeholder = '' }) {
  return new Promise(resolve => {
    let done = false;
    const form = document.createElement('form');
    form.className = 'pod-sheet-form';
    form.innerHTML = `<label><span>${pEsc(label)}</span><input type="text" maxlength="80" autocomplete="off" placeholder="${pEsc(placeholder)}"></label><button type="submit" class="pod-sheet-ok">${pEsc(ok)}</button>`;
    const input = form.querySelector('input');
    input.value = value;
    form.onsubmit = ev => {
      ev.preventDefault();
      const v = input.value.trim();
      if (!v) return input.focus();
      done = true;
      podSheetClose(false);
      resolve(v);
    };
    podSheet({
      title,
      body: form,
      onClose: () => {
        if (!done) resolve(null);
      }
    });
    setTimeout(() => {
      input.focus();
      input.select();
    }, 60);
  });
}

function epDuration(e) {
  return parsePodDuration(e?.duration) || Number(podcastProgress()[String(e?.id)]?.dur || 0);
}
function epRemaining(e) {
  const d = epDuration(e);
  if (!d) return 0;
  if (isEpisodeDone(e?.id)) return d;
  return Math.max(0, d - getEpisodePos(e?.id));
}
// «2 h 15 min» / «45 min». Cadena vacía si no se sabe.
function fmtLong(sec) {
  sec = Math.round(Number(sec) || 0);
  if (sec < 60) return '';
  const h = Math.floor(sec / 3600),
    m = Math.round((sec % 3600) / 60);
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}
function episodesSummary(list) {
  const n = list.length;
  const total = list.reduce((s, e) => s + epRemaining(e), 0);
  const t = fmtLong(total);
  return `${n === 1 ? '1 episodio' : `${n} episodios`}${t ? ` · ${t}` : ''}`;
}
function shortEpDate(v) {
  const d = podcastDateValue(v);
  if (!d) return '';
  try {
    const dt = new Date(d);
    const opts = { day: 'numeric', month: 'short' };
    if (dt.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return dt.toLocaleDateString('es-ES', opts);
  } catch {
    return '';
  }
}
function dedupeEpisodes(list) {
  const seen = new Set();
  return (list || []).filter(e => {
    const k = epKey(e);
    if (!e?.audioUrl || !k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
function plural(n, one, many) {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

/* ---------------------------------------------------------------------------
   Operaciones de cola
--------------------------------------------------------------------------- */
function queueButtonHtml(e) {
  const on = isInQueue(e);
  return `<button class="pod-q ${on ? 'on' : ''}" type="button" data-ep="${pEsc(epKey(e))}" aria-label="${on ? 'Quitar de la cola' : 'Añadir a la cola'}">${on ? '✓ En cola' : '＋ Cola'}</button>`;
}
function refreshQueueButtons() {
  const keys = new Set(podcastState.queue.map(epKey));
  document.querySelectorAll('.pod-q[data-ep]').forEach(b => {
    const on = keys.has(b.dataset.ep);
    b.classList.toggle('on', on);
    b.textContent = on ? '✓ En cola' : '＋ Cola';
    b.setAttribute('aria-label', on ? 'Quitar de la cola' : 'Añadir a la cola');
  });
}
function isCurrentEpisode(e) {
  return !!podcastState.current && epKey(podcastState.current) === epKey(e);
}
function removeFromQueue(e, { toast = true } = {}) {
  const k = epKey(e);
  const before = [...podcastState.queue];
  podcastState.queue = podcastState.queue.filter(x => epKey(x) !== k);
  savePodcastQueue();
  if (toast)
    podToast('Quitado de la cola', {
      action: 'Deshacer',
      onAction: () => {
        podcastState.queue = before;
        savePodcastQueue();
      }
    });
}
function toggleEpisodeInQueue(e) {
  if (isCurrentEpisode(e)) return podToast('Este episodio ya está sonando');
  if (isInQueue(e)) return removeFromQueue(e);
  queueEpisodes([e], 'end');
}
// how: 'replace' (suena ya y sustituye la cola), 'next' o 'end'.
function queueEpisodes(eps, how = 'end', { toast = true } = {}) {
  eps = dedupeEpisodes(eps);
  if (!eps.length) return;
  if (how === 'replace') {
    const before = [...podcastState.queue];
    podcastState.queue = eps.slice(1);
    playEpisodeNow(eps[0]);
    if (toast && before.length)
      podToast('La cola se ha sustituido', {
        action: 'Deshacer',
        onAction: () => {
          podcastState.queue = before;
          savePodcastQueue();
        }
      });
    return;
  }
  let items = eps.filter(e => !isCurrentEpisode(e));
  if (!items.length) return podToast('Ya está sonando');
  if (how === 'next') {
    // A continuación: se adelantan aunque ya estuvieran en la cola.
    const keys = new Set(items.map(epKey));
    podcastState.queue = podcastState.queue.filter(x => !keys.has(epKey(x)));
    podcastState.queue.unshift(...items);
  } else {
    // Al final: los que ya estaban en la cola se quedan en su sitio.
    const have = new Set(podcastState.queue.map(epKey));
    items = items.filter(e => !have.has(epKey(e)));
    if (!items.length) return toast && podToast(eps.length === 1 ? 'Ya estaba en la cola' : 'Ya estaban todos en la cola');
    podcastState.queue.push(...items);
  }
  savePodcastQueue();
  if (!toast) return;
  const what = items.length === 1 ? 'Añadido' : `${items.length} episodios añadidos`;
  if (how === 'next') podToast(`${what} a continuación`);
  else if (items.length === 1)
    podToast(`${what} a la cola (${podcastState.queue.length}.º)`, {
      action: 'Poner el siguiente',
      onAction: () => queueEpisodes(items, 'next')
    });
  else podToast(`${what} al final de la cola`);
}
// Para «Últimos de todas», listas, etc.: si ya hay cola, pregunta qué hacer.
function offerEpisodes(eps, { title = '', onDone = null, onCancel = null } = {}) {
  eps = dedupeEpisodes(eps);
  if (!eps.length) {
    podToast('No hay episodios que reproducir');
    onCancel?.();
    return;
  }
  const apply = how => {
    queueEpisodes(eps, how);
    onDone?.();
  };
  if (!podcastState.queue.length) return apply('replace');
  podSheet({
    title: title || 'Episodios',
    subtitle: `${episodesSummary(eps)} · Ya tienes ${plural(podcastState.queue.length, 'episodio', 'episodios')} en la cola`,
    onClose: onCancel,
    items: [
      { icon: '▶', label: 'Reproducir ahora', hint: 'Sustituye la cola actual', on: () => apply('replace') },
      { icon: '⏭', label: 'Reproducir a continuación', hint: 'Delante de lo que ya tienes', on: () => apply('next') },
      { icon: '➕', label: 'Añadir al final de la cola', on: () => apply('end') },
      { icon: '📃', label: 'Guardar en una lista…', on: () => chooseListFor(eps, { onDone: onCancel }) }
    ]
  });
}
function shuffleQueue() {
  if (podcastState.queue.length < 2) return;
  const before = [...podcastState.queue];
  podcastState.queue = shuffled(podcastState.queue);
  savePodcastQueue();
  podToast('Cola mezclada', {
    action: 'Deshacer',
    onAction: () => {
      podcastState.queue = before;
      savePodcastQueue();
    }
  });
}
function clearQueue() {
  if (!podcastState.queue.length) return;
  const before = [...podcastState.queue];
  podcastState.queue = [];
  savePodcastQueue();
  podToast('Cola vaciada', {
    action: 'Deshacer',
    onAction: () => {
      podcastState.queue = before;
      savePodcastQueue();
    }
  });
}
function removeDoneFromQueue() {
  const before = [...podcastState.queue];
  podcastState.queue = podcastState.queue.filter(e => !isEpisodeDone(e.id));
  const n = before.length - podcastState.queue.length;
  if (!n) return podToast('No hay episodios escuchados en la cola');
  savePodcastQueue();
  podToast(`${plural(n, 'escuchado quitado', 'escuchados quitados')}`, {
    action: 'Deshacer',
    onAction: () => {
      podcastState.queue = before;
      savePodcastQueue();
    }
  });
}
function moveInArray(arr, from, to) {
  const a = [...arr];
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  return a;
}

/* ---------------------------------------------------------------------------
   Listas: almacenamiento y operaciones
--------------------------------------------------------------------------- */
const PODCAST_LISTS_KEY = 'radios_viferor_podcast_playlists_v1';
const SMART_DEFAULTS = {
  source: 'subs', // subs | favs | all | category | pick
  category: '',
  picked: [], // podcasts elegidos: [{title, feedUrl, artwork}]
  state: 'unfinished', // all | unplayed | unfinished | inprogress
  days: 0,
  minMin: 0,
  maxMin: 0,
  perPodcast: 3, // 0 = todos
  order: 'newest', // newest | oldest | random | shortest | longest | podcast | interleave
  limit: 30
};
const SMART_TEMPLATES = [
  { icon: '🆕', name: 'Novedades de la semana', hint: 'Sin escuchar, publicados en los últimos 7 días', rules: { state: 'unplayed', days: 7, perPodcast: 3, order: 'newest' } },
  { icon: '⚡', name: 'Episodios cortos', hint: 'Sin escuchar y de menos de 20 minutos', rules: { state: 'unplayed', maxMin: 20, perPodcast: 2, order: 'shortest' } },
  { icon: '⏯', name: 'A medias', hint: 'Los que empezaste y no terminaste', rules: { state: 'inprogress', perPodcast: 0, order: 'newest', limit: 50 } },
  { icon: '⭐', name: 'Lo nuevo de mis favoritos', hint: 'Últimas dos semanas, alternando podcasts', rules: { source: 'favs', state: 'unplayed', days: 14, perPodcast: 2, order: 'interleave' } },
  { icon: '🔀', name: 'Mezcla sorpresa', hint: 'Sin escuchar, al azar', rules: { state: 'unplayed', perPodcast: 2, order: 'random', limit: 20 } },
  { icon: '🛠', name: 'Personalizada', hint: 'Empieza de cero y elige tus reglas', rules: {} }
];
podcastState.lists = podcastState.lists || [];
function newListId() {
  return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function normalizeList(l) {
  if (!l || typeof l !== 'object' || !l.name) return null;
  const out = {
    id: String(l.id || newListId()),
    name: String(l.name).slice(0, 80),
    type: l.type === 'smart' ? 'smart' : 'manual',
    createdAt: l.createdAt || Date.now(),
    updatedAt: l.updatedAt || Date.now()
  };
  if (out.type === 'smart') out.rules = { ...SMART_DEFAULTS, ...(l.rules || {}) };
  else out.items = dedupeEpisodes(Array.isArray(l.items) ? l.items : []).map(minimalEpisode);
  return out;
}
function loadPodcastLists() {
  try {
    const x = JSON.parse(localStorage.getItem(PODCAST_LISTS_KEY) || '[]');
    podcastState.lists = (Array.isArray(x) ? x : []).map(normalizeList).filter(Boolean);
  } catch {
    podcastState.lists = [];
  }
}
window.loadPodcastLists = loadPodcastLists;
function savePodcastLists() {
  try {
    localStorage.setItem(PODCAST_LISTS_KEY, JSON.stringify(podcastState.lists));
  } catch {
    podToast('⚠️ No se pudo guardar: el almacenamiento está lleno');
  }
  document.dispatchEvent(new CustomEvent('podcasts:lists-changed'));
}
function listById(id) {
  return podcastState.lists.find(l => l.id === id) || null;
}
function manualLists() {
  return podcastState.lists.filter(l => l.type === 'manual');
}
function createManualList(name, items = []) {
  const l = normalizeList({ name, type: 'manual', items });
  podcastState.lists.push(l);
  savePodcastLists();
  return l;
}
function addToList(l, eps) {
  const have = new Set(l.items.map(epKey));
  const add = dedupeEpisodes(eps).filter(e => !have.has(epKey(e)));
  l.items.push(...add.map(minimalEpisode));
  l.updatedAt = Date.now();
  savePodcastLists();
  return { added: add.length, already: eps.length - add.length };
}
// Elegir lista (o crear una) para guardar episodios.
function chooseListFor(eps, { onDone = null } = {}) {
  eps = dedupeEpisodes(eps);
  if (!eps.length) return;
  const save = l => {
    const r = addToList(l, eps);
    podToast(
      r.added
        ? `${plural(r.added, 'episodio añadido', 'episodios añadidos')} a «${l.name}»${r.already ? ` · ${r.already} ya estaban` : ''}`
        : `Ya estaba${eps.length > 1 ? 'n todos' : ''} en «${l.name}»`,
      { action: 'Abrir', onAction: () => renderPodcastList(l.id) }
    );
    onDone?.();
  };
  const createNew = async () => {
    const name = await podPromptText({
      title: 'Nueva lista',
      label: 'Nombre de la lista',
      placeholder: 'Para el coche, para correr…',
      ok: 'Crear y añadir'
    });
    if (name) save(createManualList(name));
    else onDone?.();
  };
  const lists = manualLists();
  if (!lists.length) return createNew();
  podSheet({
    title: 'Añadir a una lista',
    subtitle: episodesSummary(eps),
    onClose: onDone,
    items: [
      { icon: '＋', label: 'Nueva lista…', on: createNew },
      { sep: true },
      ...lists.map(l => {
        const inside = eps.length === 1 && l.items.some(x => epKey(x) === epKey(eps[0]));
        return { icon: '📃', label: l.name, hint: inside ? 'Ya está en esta lista' : plural(l.items.length, 'episodio', 'episodios'), checked: inside, on: () => save(l) };
      })
    ]
  });
}

/* ---------------------------------------------------------------------------
   Listas inteligentes: resolver reglas
--------------------------------------------------------------------------- */
const smartFeedCache = new Map();
const smartListCache = new Map(); // id → { t, sig, eps }
async function fetchFeedEpisodes(p, limit) {
  const feed = podcastFeedUrl(p);
  if (!feed) return [];
  const key = feed + '|' + limit;
  const c = smartFeedCache.get(key);
  if (c && Date.now() - c.t < 10 * 60000) return c.eps;
  const u = new URL('/api/podcast-feed', location.origin);
  u.searchParams.set('url', feed);
  u.searchParams.set('limit', String(limit));
  const r = await fetch(u);
  if (!r.ok) return [];
  const d = await r.json();
  const f = d.feed || {};
  const eps = (d.episodes || [])
    .map(e => ({
      ...normalizePodcastObject(e),
      podcastTitle: repairPodcastText(p.title || f.title || 'Podcast'),
      podcastArt: p.artwork || p.image || f.image || f.artwork || '',
      author: e.author || p.author || f.author || '',
      feedUrl: feed
    }))
    .filter(e => e.audioUrl);
  smartFeedCache.set(key, { t: Date.now(), eps });
  return eps;
}
async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const k = i++;
      try {
        out[k] = await fn(items[k]);
      } catch {
        out[k] = [];
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
function smartSourcePodcasts(r) {
  const uniq = arr => {
    const m = new Map();
    arr.forEach(p => {
      if (p && podcastFeedUrl(p)) m.set(podcastKey(p), subscriptionFor(p) || p);
    });
    return [...m.values()];
  };
  const subs = podcastState.subs || [],
    favs = podcastState.favs || [];
  if (r.source === 'favs') return uniq(favs);
  if (r.source === 'all') return uniq([...subs, ...favs]);
  if (r.source === 'category') return uniq(subs.filter(p => podcastCategoryOf(p) === r.category));
  if (r.source === 'pick') return uniq(r.picked || []);
  return uniq(subs);
}
function smartMatch(e, r, now) {
  const done = isEpisodeDone(e.id),
    pos = getEpisodePos(e.id);
  if (r.state === 'unplayed' && (done || pos > 5)) return false;
  if (r.state === 'unfinished' && done) return false;
  if (r.state === 'inprogress' && (done || pos <= 5)) return false;
  if (r.days > 0) {
    const d = podcastDateValue(e.date);
    if (!d || now - d > r.days * 86400000) return false;
  }
  const dur = parsePodDuration(e.duration);
  if (dur) {
    if (r.minMin > 0 && dur < r.minMin * 60) return false;
    if (r.maxMin > 0 && dur > r.maxMin * 60) return false;
  }
  return true;
}
function orderSmart(groups, r) {
  const all = groups.flat();
  const date = e => podcastDateValue(e.date) || 0,
    dur = e => parsePodDuration(e.duration) || 0;
  const by = fn => [...all].sort(fn);
  switch (r.order) {
    case 'oldest':
      return by((a, b) => date(a) - date(b));
    case 'random':
      return shuffled(all);
    case 'shortest':
      return by((a, b) => (dur(a) || 1e9) - (dur(b) || 1e9));
    case 'longest':
      return by((a, b) => dur(b) - dur(a));
    case 'podcast':
      return by((a, b) => String(a.podcastTitle || '').localeCompare(String(b.podcastTitle || ''), 'es') || date(b) - date(a));
    case 'interleave': {
      const gs = groups.map(g => [...g]).filter(g => g.length).sort((a, b) => date(b[0]) - date(a[0]));
      const out = [];
      while (gs.some(g => g.length)) gs.forEach(g => g.length && out.push(g.shift()));
      return out;
    }
    default:
      return by((a, b) => date(b) - date(a));
  }
}
async function resolveSmartRules(rules, onProgress) {
  const r = { ...SMART_DEFAULTS, ...rules };
  const pods = smartSourcePodcasts(r);
  const per = Number(r.perPodcast) || 0;
  // Se piden más episodios de los que se van a usar porque los filtros descartan.
  const fetchN = Math.min(100, Math.max(15, per ? per * 4 : 40, r.days > 30 || r.state === 'inprogress' ? 40 : 0));
  const now = Date.now();
  let done = 0;
  const groups = await mapLimit(pods, 4, async p => {
    const eps = await fetchFeedEpisodes(p, fetchN);
    onProgress?.(++done, pods.length);
    let g = eps.filter(e => smartMatch(e, r, now)).sort((a, b) => podcastDateValue(b.date) - podcastDateValue(a.date));
    if (per > 0) g = g.slice(0, per);
    return g;
  });
  return dedupeEpisodes(orderSmart(groups.filter(Boolean), r)).slice(0, Number(r.limit) || 30);
}
function smartSig(l) {
  return JSON.stringify(l.rules);
}
async function smartListEpisodes(l, { force = false, onProgress } = {}) {
  const c = smartListCache.get(l.id);
  // Lo escuchado cambia, pero la caché solo dura 5 minutos; «Actualizar» la fuerza.
  if (!force && c && c.sig === smartSig(l) && Date.now() - c.t < 5 * 60000) return c.eps;
  const eps = await resolveSmartRules(l.rules, onProgress);
  smartListCache.set(l.id, { t: Date.now(), sig: smartSig(l), eps });
  return eps;
}
async function listEpisodes(l, opts) {
  return l.type === 'smart' ? smartListEpisodes(l, opts) : l.items;
}
const SMART_LABELS = {
  source: { subs: 'Mis suscripciones', favs: 'Mis favoritos', all: 'Suscripciones y favoritos', category: 'Una categoría', pick: 'Podcasts elegidos' },
  state: { all: 'Todos', unplayed: 'Sin escuchar', unfinished: 'Sin terminar (incluye empezados)', inprogress: 'Solo empezados' },
  order: {
    newest: 'Más recientes primero',
    oldest: 'Más antiguos primero',
    interleave: 'Alternando podcasts',
    podcast: 'Agrupados por podcast',
    shortest: 'Más cortos primero',
    longest: 'Más largos primero',
    random: 'Al azar'
  }
};
function smartSummary(r) {
  r = { ...SMART_DEFAULTS, ...r };
  const parts = [];
  if (r.source === 'category') parts.push(r.category || 'Categoría');
  else if (r.source === 'pick') parts.push(plural((r.picked || []).length, 'podcast', 'podcasts'));
  else parts.push(SMART_LABELS.source[r.source]);
  if (r.state !== 'all') parts.push(SMART_LABELS.state[r.state].replace(/ \(.*\)$/, '').toLowerCase());
  if (r.days) parts.push(r.days === 1 ? 'último día' : `últimos ${r.days} días`);
  if (r.minMin) parts.push(`más de ${r.minMin} min`);
  if (r.maxMin) parts.push(`menos de ${r.maxMin} min`);
  parts.push(SMART_LABELS.order[r.order].toLowerCase());
  return parts.join(' · ');
}

/* ---------------------------------------------------------------------------
   Exportar e importar listas
--------------------------------------------------------------------------- */
async function exportPodcastList(l) {
  const data = { type: 'radios-viferor-playlist', version: 1, exportedAt: new Date().toISOString(), list: l };
  const content = JSON.stringify(data, null, 2);
  const slug = l.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'lista';
  const name = `radios-viferor-lista-${slug}.json`;
  if (window.Android && typeof window.Android.saveTextFile === 'function') {
    window.Android.saveTextFile(name, content, 'application/json');
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function importPodcastListFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = () => {
    const f = input.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        const raw = d?.type === 'radios-viferor-playlist' ? [d.list] : Array.isArray(d?.lists) ? d.lists : d?.name ? [d] : [];
        const got = raw.map(x => normalizeList({ ...x, id: newListId(), createdAt: Date.now() })).filter(Boolean);
        if (!got.length) throw Error('El archivo no contiene ninguna lista de Radios Viferor.');
        got.forEach(l => {
          if (podcastState.lists.some(x => x.name === l.name)) l.name += ' (importada)';
          podcastState.lists.push(l);
        });
        savePodcastLists();
        podToast(got.length === 1 ? `Lista «${got[0].name}» importada` : `${got.length} listas importadas`);
        if (got.length === 1) renderPodcastList(got[0].id);
        else renderPodcastLists(podcastState.screen === 'lists');
      } catch (e) {
        alert('No se pudo importar: ' + (e?.message || e));
      }
    };
    r.readAsText(f);
  };
  input.click();
}

/* ---------------------------------------------------------------------------
   Menús de episodio y de podcast
--------------------------------------------------------------------------- */
function goToPodcastOf(e) {
  const p = subscriptionFor({ feedUrl: e.feedUrl }) || { feedUrl: e.feedUrl, title: e.podcastTitle || 'Podcast', artwork: e.podcastArt || '' };
  if (!podcastFeedUrl(p)) return podToast('No se sabe de qué podcast es');
  loadPodcastEpisodes(p);
}
function toggleEpisodeDone(e) {
  if (isEpisodeDone(e.id)) {
    unmarkEpisodeDone(e.id);
    podToast('Marcado como no escuchado');
  } else {
    markEpisodeDone(e.id);
    if (!isCurrentEpisode(e)) clearEpisodePos(e.id);
    podToast('Marcado como escuchado');
  }
  smartListCache.clear();
  refreshPodcastScreen();
}
// Menú ⋯ de cualquier episodio. extra: opciones propias del sitio (lista, cola…).
function openEpisodeMenu(e, { extra = [], showGo = true } = {}) {
  const cur = isCurrentEpisode(e),
    inQ = isInQueue(e),
    done = isEpisodeDone(e.id);
  const sameShow = podcastState.screen === 'episodes' && podcastFeedUrl(podcastState.episodesPodcast || {}) === e.feedUrl;
  podSheet({
    title: e.title || 'Episodio',
    subtitle: [e.podcastTitle, shortEpDate(e.date), episodeTimeText(e)].filter(Boolean).join(' · '),
    items: [
      !cur && { icon: '▶', label: 'Reproducir ahora', on: () => playEpisodeNow(e) },
      !cur && { icon: '⏭', label: 'Reproducir a continuación', on: () => queueEpisodes([e], 'next') },
      !cur && !inQ && { icon: '➕', label: 'Añadir al final de la cola', on: () => queueEpisodes([e], 'end') },
      !cur && inQ && { icon: '✕', label: 'Quitar de la cola', on: () => removeFromQueue(e) },
      { icon: '📃', label: 'Añadir a una lista…', on: () => chooseListFor([e]) },
      { icon: done ? '↺' : '✓', label: done ? 'Marcar como no escuchado' : 'Marcar como escuchado', on: () => toggleEpisodeDone(e) },
      showGo && !sameShow && e.feedUrl && { icon: '🎙️', label: 'Ir al podcast', on: () => goToPodcastOf(e) },
      ...(extra.length ? [{ sep: true }, ...extra] : [])
    ]
  });
}
// «☰ Cola y listas…» en la cabecera de un podcast.
function openPodcastEpisodesMenu(p, eps) {
  eps = dedupeEpisodes(eps);
  const newest = [...eps].sort((a, b) => podcastDateValue(b.date) - podcastDateValue(a.date));
  const unplayed = newest.filter(e => !isEpisodeDone(e.id));
  const oldestFirst = [...unplayed].reverse();
  const MAX = 200;
  const n = Math.min(unplayed.length, MAX);
  const cap = list => list.slice(0, MAX);
  podSheet({
    title: p.title || 'Podcast',
    subtitle: `${plural(eps.length, 'episodio', 'episodios')} · ${unplayed.length} sin escuchar`,
    items: [
      { icon: '▶', label: 'Escuchar desde el primero sin escuchar', hint: 'Del más antiguo al más nuevo · sustituye la cola', disabled: !n, on: () => offerEpisodes(cap(oldestFirst), { title: p.title }) },
      { icon: '⏭', label: `Sin escuchar a continuación (${n})`, hint: 'Del más antiguo al más nuevo', disabled: !n, on: () => queueEpisodes(cap(oldestFirst), 'next') },
      { icon: '➕', label: `Sin escuchar al final de la cola (${n})`, hint: 'Del más antiguo al más nuevo', disabled: !n, on: () => queueEpisodes(cap(oldestFirst), 'end') },
      { icon: '🆕', label: 'Los 5 más recientes a la cola', hint: 'Sin escuchar, el más nuevo primero', disabled: !n, on: () => queueEpisodes(unplayed.slice(0, 5), 'end') },
      { sep: true },
      { icon: '📃', label: 'Guardar los sin escuchar en una lista…', disabled: !n, on: () => chooseListFor(cap(oldestFirst)) },
      {
        icon: '✨',
        label: 'Crear lista inteligente con este podcast',
        hint: 'Se actualiza sola con cada episodio nuevo',
        on: () =>
          openSmartEditor(null, {
            name: p.title || 'Podcast',
            rules: { source: 'pick', picked: [{ title: p.title, feedUrl: podcastFeedUrl(p), artwork: p.artwork || p.image || '' }], state: 'unplayed', perPodcast: 0, order: 'oldest', limit: 50 }
          })
      }
    ]
  });
}
window.openPodcastEpisodesMenu = openPodcastEpisodesMenu;

/* ---------------------------------------------------------------------------
   Filas de episodio y arrastrar para ordenar
--------------------------------------------------------------------------- */
function epRow(e, { num = null, handle = false, current = false, onPlay = null, onMenu = null, onRemove = null } = {}) {
  const row = document.createElement('div');
  row.className = 'pod-qrow' + (current ? ' is-current' : '') + (isEpisodeDone(e.id) ? ' is-done' : '');
  const art = e.image || e.podcastArt || '';
  const t = episodeTimeText(e);
  const date = shortEpDate(e.date);
  row.innerHTML = `${handle ? '<button class="pod-qhandle" type="button" aria-label="Arrastrar para cambiar el orden" title="Arrastra para cambiar el orden">⠿</button>' : ''}${
    num != null ? `<span class="qnum">${num}</span>` : ''
  }<span class="pod-qart" aria-hidden="true"><span>🎙️</span>${art ? `<img src="${pEsc(art)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}</span><div class="pod-qinfo"><strong>${pEsc(
    e.title || 'Episodio'
  )}</strong><small>${pEsc(e.podcastTitle || e.author || '')}${date ? ` · ${pEsc(date)}` : ''}</small>${t ? `<small class="pod-ep-time">${pEsc(t)}</small>` : ''}</div><div class="pod-qbtns">${
    onPlay ? `<button class="pod-qplay" type="button" aria-label="${current ? 'Reproducir o pausar' : 'Reproducir ahora'}">${current && !$p('podcastAudio')?.paused ? '⏸' : '▶'}</button>` : ''
  }${onRemove ? '<button class="pod-qdel" type="button" aria-label="Quitar">✕</button>' : ''}${onMenu ? '<button class="pod-qmenu" type="button" aria-label="Más opciones">⋯</button>' : ''}</div>`;
  if (onPlay) row.querySelector('.pod-qplay').onclick = onPlay;
  if (onRemove) row.querySelector('.pod-qdel').onclick = onRemove;
  if (onMenu) row.querySelector('.pod-qmenu').onclick = onMenu;
  row.querySelector('.pod-qinfo').onclick = onMenu || onPlay;
  return row;
}
let podDragging = false;
// Reordenar arrastrando el asa ⠿ (dedo o ratón); desplaza la pantalla cerca de los bordes.
function makeSortable(list, onMove) {
  list.addEventListener('pointerdown', ev => {
    const h = ev.target.closest('.pod-qhandle');
    if (!h || !list.contains(h) || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    const row = h.closest('.pod-qrow');
    const rows = [...list.children].filter(r => r.classList.contains('pod-qrow'));
    const from = rows.indexOf(row);
    if (from < 0) return;
    ev.preventDefault();
    const scroller = $p('podcastContent');
    const rects = rows.map(r => r.getBoundingClientRect());
    const gap = rows.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 5;
    const shift = rects[from].height + gap;
    const startY = ev.clientY,
      startScroll = scroller.scrollTop;
    let to = from,
      lastY = ev.clientY,
      raf = 0;
    podDragging = true;
    row.classList.add('dragging');
    list.classList.add('sorting');
    try {
      h.setPointerCapture(ev.pointerId);
    } catch {}
    const update = () => {
      const dy = lastY - startY + (scroller.scrollTop - startScroll);
      row.style.transform = `translateY(${dy}px)`;
      const center = rects[from].top + rects[from].height / 2 + dy;
      let t = from;
      for (let i = from + 1; i < rows.length; i++) if (center > rects[i].top + rects[i].height / 2) t = i;
      for (let i = from - 1; i >= 0; i--) if (center < rects[i].top + rects[i].height / 2) t = i;
      to = t;
      rows.forEach((r, i) => {
        if (i === from) return;
        let y = 0;
        if (from < to && i > from && i <= to) y = -shift;
        else if (from > to && i < from && i >= to) y = shift;
        r.style.transform = y ? `translateY(${y}px)` : '';
      });
    };
    const tick = () => {
      const b = scroller.getBoundingClientRect();
      const edge = 70;
      let v = 0;
      if (lastY < b.top + edge) v = -Math.ceil((b.top + edge - lastY) / 5);
      else if (lastY > b.bottom - edge) v = Math.ceil((lastY - (b.bottom - edge)) / 5);
      if (v) {
        const before = scroller.scrollTop;
        scroller.scrollTop += v;
        if (scroller.scrollTop !== before) update();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const move = e => {
      lastY = e.clientY;
      update();
    };
    const end = () => {
      cancelAnimationFrame(raf);
      h.removeEventListener('pointermove', move);
      h.removeEventListener('pointerup', end);
      h.removeEventListener('pointercancel', end);
      rows.forEach(r => (r.style.transform = ''));
      row.classList.remove('dragging');
      list.classList.remove('sorting');
      podDragging = false;
      if (to !== from) onMove(from, to);
    };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
  });
}

/* ---------------------------------------------------------------------------
   Pantalla: Cola
--------------------------------------------------------------------------- */
let podHistoryOpen = false,
  podOptsOpen = false;
function screenHead(title, count, sub = '') {
  const h = document.createElement('div');
  h.className = 'pod-section-title pod-detail-head pod-list-head';
  h.innerHTML = `<button class="pod-back-btn" type="button">← Volver</button><div class="pod-detail-title"><h2>${title}${count != null ? ` <span>${count}</span>` : ''}</h2>${sub ? `<p class="pod-list-sub">${pEsc(sub)}</p>` : ''}</div>`;
  h.querySelector('.pod-back-btn').onclick = backFromPodcast;
  return h;
}
function actionBar(buttons) {
  const bar = document.createElement('div');
  bar.className = 'pod-list-actions';
  buttons.filter(Boolean).forEach(([label, fn, cls = '', disabled = false]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.disabled = disabled;
    b.onclick = fn;
    bar.append(b);
  });
  return bar;
}
function queueItemMenu(e, i) {
  openEpisodeMenu(e, {
    extra: [
      i > 0 && { icon: '⤒', label: 'Subir al principio', on: () => moveQueueItem(i, 0) },
      i < podcastState.queue.length - 1 && { icon: '⤓', label: 'Bajar al final', on: () => moveQueueItem(i, podcastState.queue.length - 1) }
    ].filter(Boolean)
  });
}
function moveQueueItem(from, to) {
  podcastState.queue = moveInArray(podcastState.queue, from, to);
  savePodcastQueue();
}
function renderPodcastQueue(fromHistory = false) {
  if (!podcastsViewActive()) switchToPodcasts();
  if (!fromHistory) pushPodcastState('queue');
  podcastState.screen = 'queue';
  setPodcastLayout(true);
  const root = $p('podcastContent');
  const sc = fromHistory ? root.scrollTop : 0;
  root.replaceChildren();
  const q = podcastState.queue;
  const opts = podcastQueueOptions();
  root.append(screenHead('☰ Cola', q.length, q.length ? `Queda ${fmtLong(q.reduce((s, e) => s + epRemaining(e), 0)) || 'poco'} por escuchar` : ''));

  const cur = podcastState.current;
  if (cur) {
    root.insertAdjacentHTML('beforeend', '<h3 class="pod-list-h">Sonando ahora</h3>');
    root.append(epRow(cur, { current: true, onPlay: togglePodcastPlay, onMenu: () => openEpisodeMenu(cur) }));
  }

  // Opciones de reproducción
  // Plegadas, con un resumen de cómo está configurada la reproducción.
  const sum = [
    { off: 'Sin repetir', one: '🔂 Repite el episodio', all: '🔁 Repite la cola' }[opts.repeat],
    opts.autoNext ? 'avance automático' : 'se para al terminar cada episodio',
    opts.skipDone && 'salta escuchados',
    opts.whenEmpty === 'latest' && 'sigue con novedades'
  ]
    .filter(Boolean)
    .join(' · ');
  const det = document.createElement('details');
  det.className = 'pod-q-opts-wrap';
  det.open = podOptsOpen;
  det.ontoggle = () => (podOptsOpen = det.open);
  det.innerHTML = `<summary>⚙️ Opciones <small>${pEsc(sum)}</small></summary>`;
  const box = document.createElement('div');
  box.className = 'pod-q-opts';
  box.innerHTML = `<label><span>Repetir</span><select data-k="repeat"><option value="off">No</option><option value="one">Este episodio</option><option value="all">Toda la cola</option></select></label><label><span>Al acabar la cola</span><select data-k="whenEmpty"><option value="stop">Parar</option><option value="latest">Seguir con novedades</option></select></label><label class="chk"><input type="checkbox" data-k="autoNext"><span>Pasar al siguiente solo</span></label><label class="chk"><input type="checkbox" data-k="skipDone"><span>Saltar los ya escuchados</span></label>`;
  box.querySelectorAll('[data-k]').forEach(el => {
    const k = el.dataset.k;
    if (el.type === 'checkbox') {
      el.checked = !!opts[k];
      el.onchange = () => setPodcastQueueOption(k, el.checked);
    } else {
      el.value = opts[k];
      el.onchange = () => setPodcastQueueOption(k, el.value);
    }
  });
  det.append(box);
  root.append(det);

  root.append(
    actionBar([
      ['🔀 Mezclar', shuffleQueue, '', q.length < 2],
      ['💾 Guardar como lista', saveQueueAsList, '', !q.length && !cur],
      ['🧹 Quitar escuchados', removeDoneFromQueue, '', !q.length],
      ['🗑 Vaciar', clearQueue, 'danger', !q.length]
    ])
  );

  root.insertAdjacentHTML('beforeend', `<h3 class="pod-list-h">A continuación${q.length ? ` <small>arrastra ⠿ para ordenar</small>` : ''}</h3>`);
  if (!q.length) {
    const empty = document.createElement('div');
    empty.className = 'pod-empty pod-empty-small';
    empty.innerHTML =
      '<p>La cola está vacía. Usa <b>＋ Cola</b> o <b>⋯</b> en cualquier episodio, o llénala de golpe:</p><div class="pod-empty-actions"><button type="button" data-a="latest">🆕 Últimos de todas</button><button type="button" data-a="lists">📃 Mis listas</button></div>';
    empty.querySelector('[data-a="latest"]').onclick = () => playAll('latest');
    empty.querySelector('[data-a="lists"]').onclick = () => renderPodcastLists();
    root.append(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'pod-queue pod-qlist';
    q.forEach((e, i) =>
      list.append(
        epRow(e, {
          num: i + 1,
          handle: true,
          onPlay: () => playEpisodeNow(e),
          onRemove: () => removeFromQueue(e),
          onMenu: () => queueItemMenu(e, i)
        })
      )
    );
    makeSortable(list, moveQueueItem);
    root.append(list);
  }

  // Historial: lo último que ha sonado (sirve también para «⏮ Anterior»).
  const hist = [...podcastState.history].reverse().filter(e => !cur || epKey(e) !== epKey(cur)).slice(0, 20);
  if (hist.length) {
    const d = document.createElement('details');
    d.className = 'pod-history';
    d.open = podHistoryOpen;
    d.ontoggle = () => (podHistoryOpen = d.open);
    d.innerHTML = `<summary>🕘 Escuchado hace poco <span>${hist.length}</span></summary>`;
    const list = document.createElement('div');
    list.className = 'pod-queue';
    hist.forEach(e => list.append(epRow(e, { onPlay: () => playEpisodeNow(e), onMenu: () => openEpisodeMenu(e) })));
    d.append(list);
    root.append(d);
  }
  root.scrollTop = sc;
}
async function saveQueueAsList() {
  const eps = dedupeEpisodes([podcastState.current, ...podcastState.queue].filter(Boolean));
  if (!eps.length) return;
  const name = await podPromptText({
    title: 'Guardar la cola como lista',
    label: 'Nombre de la lista',
    value: 'Cola del ' + new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }),
    ok: 'Guardar'
  });
  if (!name) return;
  const l = createManualList(name, eps);
  podToast(`Lista «${l.name}» creada con ${plural(eps.length, 'episodio', 'episodios')}`, { action: 'Abrir', onAction: () => renderPodcastList(l.id) });
}

/* ---------------------------------------------------------------------------
   Pantalla: Listas
--------------------------------------------------------------------------- */
async function newManualListFlow() {
  const name = await podPromptText({ title: 'Nueva lista', label: 'Nombre de la lista', placeholder: 'Para el coche, para correr…', ok: 'Crear' });
  if (!name) return;
  const l = createManualList(name);
  renderPodcastList(l.id);
  podToast('Añade episodios con ⋯ → «Añadir a una lista…»');
}
function newSmartListFlow() {
  podSheet({
    title: 'Nueva lista inteligente',
    subtitle: 'Se rellena sola según tus reglas. Elige un punto de partida:',
    items: SMART_TEMPLATES.map(t => ({
      icon: t.icon,
      label: t.name,
      hint: t.hint,
      on: () => openSmartEditor(null, { name: t.name === 'Personalizada' ? '' : t.name, rules: t.rules })
    }))
  });
}
function listMeta(l) {
  if (l.type === 'smart') return '✨ ' + smartSummary(l.rules);
  return l.items.length ? episodesSummary(l.items) : 'Vacía';
}
function renderPodcastLists(fromHistory = false) {
  if (!podcastsViewActive()) switchToPodcasts();
  if (!fromHistory) pushPodcastState('lists');
  podcastState.screen = 'lists';
  setPodcastLayout(true);
  const root = $p('podcastContent');
  const sc = fromHistory ? root.scrollTop : 0;
  root.replaceChildren();
  root.append(screenHead('📃 Listas de reproducción', podcastState.lists.length));
  root.append(
    actionBar([
      ['＋ Nueva lista', newManualListFlow, 'primary'],
      ['✨ Lista inteligente', newSmartListFlow],
      ['📥 Importar', importPodcastListFile]
    ])
  );
  const grid = document.createElement('div');
  grid.className = 'pod-lists';
  // La cola siempre arriba.
  const qc = document.createElement('div');
  qc.className = 'pod-list-card is-queue';
  const q = podcastState.queue;
  qc.innerHTML = `<button class="pod-list-open" type="button"><span class="ic">☰</span><span class="tx"><strong>Cola</strong><small>${q.length ? pEsc(episodesSummary(q)) : 'Vacía'}${q[0] ? ` · Siguiente: ${pEsc(q[0].title || '')}` : ''}</small></span></button>`;
  qc.querySelector('.pod-list-open').onclick = () => renderPodcastQueue();
  grid.append(qc);
  podcastState.lists.forEach(l => grid.append(listCard(l)));
  root.append(grid);
  if (!podcastState.lists.length)
    root.insertAdjacentHTML(
      'beforeend',
      '<div class="pod-empty pod-empty-small"><p>Aún no tienes listas. <b>Una lista normal</b> guarda los episodios que tú eliges y en el orden que quieras. <b>Una lista inteligente</b> se llena sola con reglas: «lo nuevo de la semana», «episodios de menos de 20 minutos», «solo estos podcasts»…</p></div>'
    );
  root.scrollTop = sc;
}
function listCard(l) {
  const c = document.createElement('div');
  c.className = 'pod-list-card';
  c.innerHTML = `<button class="pod-list-open" type="button"><span class="ic">${l.type === 'smart' ? '✨' : '📃'}</span><span class="tx"><strong>${pEsc(l.name)}</strong><small>${pEsc(listMeta(l))}</small></span></button><button class="pod-list-play" type="button" aria-label="Reproducir ${pEsc(l.name)}">▶</button><button class="pod-list-more" type="button" aria-label="Más opciones">⋯</button>`;
  c.querySelector('.pod-list-open').onclick = () => renderPodcastList(l.id);
  c.querySelector('.pod-list-play').onclick = () => playList(l, 'replace');
  c.querySelector('.pod-list-more').onclick = () => listMenu(l);
  return c;
}
async function playList(l, how = 'replace', { shuffle = false } = {}) {
  let eps;
  try {
    if (l.type === 'smart') podToast('Preparando la lista…', { ms: 8000 });
    eps = await listEpisodes(l);
  } catch {
    eps = [];
  }
  eps = dedupeEpisodes(eps);
  if (!eps.length) return podToast(l.type === 'smart' ? 'Ahora mismo ningún episodio cumple las reglas' : 'La lista está vacía');
  if (shuffle) eps = shuffled(eps);
  if (how === 'ask') return offerEpisodes(eps, { title: l.name });
  queueEpisodes(eps, how);
}
function listMenu(l, { inside = false } = {}) {
  const manual = l.type === 'manual';
  podSheet({
    title: l.name,
    subtitle: listMeta(l),
    items: [
      { icon: '▶', label: 'Reproducir', hint: 'Sustituye la cola', on: () => playList(l, 'replace') },
      { icon: '🔀', label: 'Reproducir en orden aleatorio', on: () => playList(l, 'replace', { shuffle: true }) },
      { icon: '⏭', label: 'Reproducir a continuación', on: () => playList(l, 'next') },
      { icon: '➕', label: 'Añadir al final de la cola', on: () => playList(l, 'end') },
      { sep: true },
      { icon: '✏️', label: 'Cambiar el nombre', on: () => renameList(l) },
      !manual && { icon: '⚙️', label: 'Editar las reglas', on: () => openSmartEditor(l) },
      { icon: '📄', label: 'Duplicar', on: () => duplicateList(l) },
      !manual && { icon: '📌', label: 'Convertir en lista normal', hint: 'Fija los episodios de ahora y deja de actualizarse', on: () => freezeSmartList(l) },
      manual && l.items.length > 1 && { icon: '⇅', label: 'Ordenar…', on: () => sortListMenu(l) },
      manual && l.items.some(e => isEpisodeDone(e.id)) && { icon: '🧹', label: 'Quitar los ya escuchados', on: () => removeDoneFromList(l) },
      { icon: '📤', label: 'Exportar (archivo)', on: () => exportPodcastList(l) },
      { icon: '🗑', label: 'Borrar la lista', danger: true, on: () => deleteList(l, inside) }
    ]
  });
}
async function renameList(l) {
  const name = await podPromptText({ title: 'Cambiar el nombre', label: 'Nombre de la lista', value: l.name });
  if (!name) return;
  l.name = name;
  l.updatedAt = Date.now();
  savePodcastLists();
}
function duplicateList(l) {
  const c = normalizeList({ ...JSON.parse(JSON.stringify(l)), id: newListId(), name: l.name + ' (copia)', createdAt: Date.now() });
  podcastState.lists.splice(podcastState.lists.indexOf(l) + 1, 0, c);
  savePodcastLists();
  podToast(`Creada «${c.name}»`, { action: 'Abrir', onAction: () => renderPodcastList(c.id) });
}
async function freezeSmartList(l) {
  let eps = [];
  try {
    eps = await smartListEpisodes(l);
  } catch {}
  const c = createManualList(l.name + ' (fija)', eps);
  podToast(`Creada «${c.name}» con ${plural(eps.length, 'episodio', 'episodios')}`);
  renderPodcastList(c.id);
}
function deleteList(l, inside) {
  const idx = podcastState.lists.indexOf(l);
  if (idx < 0) return;
  podcastState.lists.splice(idx, 1);
  smartListCache.delete(l.id);
  savePodcastLists();
  podToast(`Lista «${l.name}» borrada`, {
    action: 'Deshacer',
    onAction: () => {
      podcastState.lists.splice(Math.min(idx, podcastState.lists.length), 0, l);
      savePodcastLists();
    }
  });
  if (inside) backFromPodcast();
}
function removeDoneFromList(l) {
  const before = [...l.items];
  l.items = l.items.filter(e => !isEpisodeDone(e.id));
  l.updatedAt = Date.now();
  savePodcastLists();
  podToast(`${plural(before.length - l.items.length, 'quitado', 'quitados')}`, {
    action: 'Deshacer',
    onAction: () => {
      l.items = before;
      savePodcastLists();
    }
  });
}
function sortListMenu(l) {
  const date = e => podcastDateValue(e.date) || 0,
    dur = e => epDuration(e) || 0;
  const apply = fn => {
    const before = [...l.items];
    l.items = fn([...l.items]);
    l.updatedAt = Date.now();
    savePodcastLists();
    podToast('Lista ordenada', {
      action: 'Deshacer',
      onAction: () => {
        l.items = before;
        savePodcastLists();
      }
    });
  };
  podSheet({
    title: 'Ordenar «' + l.name + '»',
    items: [
      { icon: '🆕', label: 'Más recientes primero', on: () => apply(a => a.sort((x, y) => date(y) - date(x))) },
      { icon: '📜', label: 'Más antiguos primero', on: () => apply(a => a.sort((x, y) => date(x) - date(y))) },
      { icon: '🎙️', label: 'Por podcast', on: () => apply(a => a.sort((x, y) => String(x.podcastTitle || '').localeCompare(String(y.podcastTitle || ''), 'es') || date(x) - date(y))) },
      { icon: '⚡', label: 'Más cortos primero', on: () => apply(a => a.sort((x, y) => (dur(x) || 1e9) - (dur(y) || 1e9))) },
      { icon: '🔀', label: 'Al azar', on: () => apply(a => shuffled(a)) },
      { icon: '↕', label: 'Invertir el orden', on: () => apply(a => a.reverse()) }
    ]
  });
}

/* ---------------------------------------------------------------------------
   Pantalla: una lista
--------------------------------------------------------------------------- */
async function renderPodcastList(id, fromHistory = false, { force = false } = {}) {
  const l = listById(id);
  if (!l) return renderPodcastLists(fromHistory);
  if (!podcastsViewActive()) switchToPodcasts();
  if (!fromHistory) pushPodcastState('list:' + id);
  podcastState.screen = 'list:' + id;
  const token = podcastNavToken;
  setPodcastLayout(true);
  const root = $p('podcastContent');
  const sc = fromHistory ? root.scrollTop : 0;
  const smart = l.type === 'smart';
  const draw = eps => {
    root.replaceChildren();
    root.append(screenHead(`${smart ? '✨' : '📃'} ${pEsc(l.name)}`, null, eps ? episodesSummary(eps) : ''));
    if (smart) root.insertAdjacentHTML('beforeend', `<p class="pod-list-rules">${pEsc(smartSummary(l.rules))}</p>`);
    const has = !!eps?.length;
    root.append(
      actionBar([
        ['▶ Reproducir', () => playList(l, 'replace'), 'primary', !has],
        ['🔀 Aleatorio', () => playList(l, 'replace', { shuffle: true }), '', !has],
        ['⏭ A continuación', () => playList(l, 'next'), '', !has],
        ['➕ A la cola', () => playList(l, 'end'), '', !has],
        smart && ['⚙️ Reglas', () => openSmartEditor(l)],
        smart && ['🔄 Actualizar', () => renderPodcastList(id, true, { force: true })],
        ['⋯ Más', () => listMenu(l, { inside: true })]
      ])
    );
  };
  if (smart) {
    draw(null);
    const loading = document.createElement('div');
    loading.className = 'pod-loading';
    loading.textContent = 'Buscando episodios que cumplan las reglas…';
    root.append(loading);
    let eps = [];
    try {
      eps = await smartListEpisodes(l, {
        force,
        onProgress: (n, total) => (loading.textContent = `Revisando podcasts… ${n} de ${total}`)
      });
    } catch {}
    // Si mientras tanto te has ido a otra pantalla, no se pinta nada.
    if (token !== podcastNavToken && !fromHistory) return;
    if (podcastState.screen !== 'list:' + id) return;
    draw(eps);
    if (!eps.length) {
      root.insertAdjacentHTML(
        'beforeend',
        `<div class="pod-empty pod-empty-small"><p>Ahora mismo ningún episodio cumple estas reglas.${smartSourcePodcasts(l.rules).length ? ' Prueba a ampliar las fechas o la duración.' : ' No hay podcasts en el origen elegido.'}</p></div>`
      );
    } else {
      const list = document.createElement('div');
      list.className = 'pod-queue';
      eps.forEach((e, i) =>
        list.append(
          epRow(e, {
            num: i + 1,
            current: isCurrentEpisode(e),
            onPlay: () => (isCurrentEpisode(e) ? togglePodcastPlay() : queueEpisodes(eps.slice(i), 'replace')),
            onMenu: () => openEpisodeMenu(e)
          })
        )
      );
      root.append(list);
    }
  } else {
    draw(l.items);
    if (!l.items.length) {
      root.insertAdjacentHTML(
        'beforeend',
        '<div class="pod-empty pod-empty-small"><p>La lista está vacía. Abre un podcast y usa <b>⋯ → Añadir a una lista…</b> en cualquier episodio, o <b>☰ Cola y listas…</b> para añadir varios de golpe. También puedes guardar tu cola entera desde la pantalla Cola.</p></div>'
      );
    } else {
      root.insertAdjacentHTML('beforeend', '<h3 class="pod-list-h"><small>Arrastra ⠿ para cambiar el orden · ▶ empieza desde ese episodio</small></h3>');
      const list = document.createElement('div');
      list.className = 'pod-queue pod-qlist';
      l.items.forEach((e, i) =>
        list.append(
          epRow(e, {
            num: i + 1,
            handle: true,
            current: isCurrentEpisode(e),
            onPlay: () => (isCurrentEpisode(e) ? togglePodcastPlay() : queueEpisodes(l.items.slice(i), 'replace')),
            onRemove: () => removeFromList(l, i),
            onMenu: () =>
              openEpisodeMenu(e, {
                extra: [
                  i > 0 && { icon: '⤒', label: 'Subir al principio', on: () => moveListItem(l, i, 0) },
                  i < l.items.length - 1 && { icon: '⤓', label: 'Bajar al final', on: () => moveListItem(l, i, l.items.length - 1) },
                  { icon: '✕', label: 'Quitar de esta lista', on: () => removeFromList(l, i) }
                ].filter(Boolean)
              })
          })
        )
      );
      makeSortable(list, (from, to) => moveListItem(l, from, to));
      root.append(list);
    }
  }
  root.scrollTop = sc;
}
function moveListItem(l, from, to) {
  l.items = moveInArray(l.items, from, to);
  l.updatedAt = Date.now();
  savePodcastLists();
}
function removeFromList(l, i) {
  const before = [...l.items];
  const [e] = l.items.splice(i, 1);
  l.updatedAt = Date.now();
  savePodcastLists();
  podToast(`Quitado de «${l.name}»`, {
    action: 'Deshacer',
    onAction: () => {
      l.items = before;
      savePodcastLists();
    }
  });
  return e;
}

/* ---------------------------------------------------------------------------
   Editor de listas inteligentes
--------------------------------------------------------------------------- */
function selectHtml(k, options, value) {
  return `<select data-k="${k}">${options.map(([v, t]) => `<option value="${pEsc(v)}"${String(v) === String(value) ? ' selected' : ''}>${pEsc(t)}</option>`).join('')}</select>`;
}
function openSmartEditor(list, preset = {}) {
  const editing = !!list;
  const r = { ...SMART_DEFAULTS, ...(editing ? list.rules : preset.rules || {}) };
  const name = editing ? list.name : preset.name || '';
  const subs = podcastState.subs || [];
  const cats = [...new Set(subs.map(podcastCategoryOf))].sort((a, b) => a.localeCompare(b, 'es'));
  // Podcasts que se pueden elegir: suscripciones, favoritos y los ya elegidos.
  const pickMap = new Map();
  [...(r.picked || []), ...subs, ...(podcastState.favs || [])].forEach(p => {
    if (p && podcastFeedUrl(p) && !pickMap.has(podcastKey(p))) pickMap.set(podcastKey(p), p);
  });
  const pickable = [...pickMap.values()].sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'es'));
  const picked = new Set((r.picked || []).map(podcastKey));
  const form = document.createElement('form');
  form.className = 'pod-sheet-form pod-smart-form';
  form.innerHTML = `
    <label><span>Nombre</span><input type="text" data-k="name" maxlength="80" placeholder="Por ejemplo: Novedades para el coche" autocomplete="off"></label>
    <label><span>Podcasts</span>${selectHtml('source', Object.entries(SMART_LABELS.source), r.source)}</label>
    <label class="if-category"><span>Categoría</span>${cats.length ? selectHtml('category', cats.map(c => [c, c]), r.category || cats[0]) : '<em>Tus suscripciones no tienen categorías.</em>'}</label>
    <fieldset class="if-pick"><legend>Elige los podcasts <small data-pick-count></small></legend><input type="search" class="pod-pick-filter" placeholder="Filtrar…" aria-label="Filtrar podcasts"><div class="pod-pick-list">${
      pickable.length
        ? pickable
            .map(
              p =>
                `<label><input type="checkbox" value="${pEsc(podcastKey(p))}"${picked.has(podcastKey(p)) ? ' checked' : ''}><span>${pEsc(p.title || 'Podcast')}</span></label>`
            )
            .join('')
        : '<em>Suscríbete o marca favoritos para poder elegirlos.</em>'
    }</div></fieldset>
    <label><span>Episodios</span>${selectHtml('state', Object.entries(SMART_LABELS.state), r.state)}</label>
    <label><span>Publicados</span>${selectHtml('days', [[0, 'Cuando sea'], [1, 'Último día'], [3, 'Últimos 3 días'], [7, 'Última semana'], [14, 'Últimas 2 semanas'], [30, 'Último mes'], [90, 'Últimos 3 meses'], [365, 'Último año']], r.days)}</label>
    <div class="pod-smart-row"><label><span>Duración mínima</span>${selectHtml('minMin', [[0, 'Cualquiera'], [5, '5 min'], [10, '10 min'], [20, '20 min'], [30, '30 min'], [45, '45 min'], [60, '1 h']], r.minMin)}</label><label><span>Duración máxima</span>${selectHtml('maxMin', [[0, 'Cualquiera'], [10, '10 min'], [15, '15 min'], [20, '20 min'], [30, '30 min'], [45, '45 min'], [60, '1 h'], [90, '1 h 30'], [120, '2 h']], r.maxMin)}</label></div>
    <div class="pod-smart-row"><label><span>Por cada podcast</span>${selectHtml('perPodcast', [[1, 'El último'], [2, 'Hasta 2'], [3, 'Hasta 3'], [5, 'Hasta 5'], [10, 'Hasta 10'], [0, 'Todos']], r.perPodcast)}</label><label><span>Máximo en total</span>${selectHtml('limit', [[10, '10'], [20, '20'], [30, '30'], [50, '50'], [100, '100']], r.limit)}</label></div>
    <label><span>Orden</span>${selectHtml('order', Object.entries(SMART_LABELS.order), r.order)}</label>
    <p class="pod-smart-note">La duración solo se puede filtrar si el podcast la indica; los que no la tienen se incluyen.</p>
    <button type="submit" class="pod-sheet-ok">${editing ? 'Guardar cambios' : 'Crear lista'}</button>`;
  const $f = k => form.querySelector(`[data-k="${k}"]`);
  $f('name').value = name;
  const sync = () => {
    const src = $f('source').value;
    form.querySelector('.if-category').hidden = src !== 'category';
    form.querySelector('.if-pick').hidden = src !== 'pick';
    const n = form.querySelectorAll('.if-pick input[type=checkbox]:checked').length;
    form.querySelector('[data-pick-count]').textContent = n ? `(${n})` : '';
  };
  form.addEventListener('change', sync);
  form.querySelector('.pod-pick-filter').addEventListener('input', ev => {
    const t = normalizar(ev.target.value || '');
    form.querySelectorAll('.pod-pick-list label').forEach(lb => (lb.hidden = !!t && !normalizar(lb.textContent).includes(t)));
  });
  sync();
  form.onsubmit = ev => {
    ev.preventDefault();
    const nm = $f('name').value.trim();
    if (!nm) {
      $f('name').focus();
      return;
    }
    const src = $f('source').value;
    const pickedKeys = [...form.querySelectorAll('.if-pick input[type=checkbox]:checked')].map(c => c.value);
    if (src === 'pick' && !pickedKeys.length) {
      podToast('Elige al menos un podcast');
      return;
    }
    const rules = {
      source: src,
      category: $f('category')?.value || '',
      picked: src === 'pick' ? pickedKeys.map(k => pickMap.get(k)).filter(Boolean).map(p => ({ title: p.title, feedUrl: podcastFeedUrl(p), artwork: p.artwork || p.image || '' })) : [],
      state: $f('state').value,
      days: Number($f('days').value),
      minMin: Number($f('minMin').value),
      maxMin: Number($f('maxMin').value),
      perPodcast: Number($f('perPodcast').value),
      limit: Number($f('limit').value),
      order: $f('order').value
    };
    if (rules.minMin && rules.maxMin && rules.minMin >= rules.maxMin) {
      podToast('La duración mínima debe ser menor que la máxima');
      return;
    }
    let l = list;
    if (editing) {
      l.name = nm;
      l.rules = rules;
      l.updatedAt = Date.now();
    } else {
      l = normalizeList({ name: nm, type: 'smart', rules });
      podcastState.lists.push(l);
    }
    smartListCache.delete(l.id);
    podSheetClose(false);
    savePodcastLists();
    if (podcastState.screen === 'list:' + l.id) renderPodcastList(l.id, true, { force: true });
    else renderPodcastList(l.id);
  };
  podSheet({ title: editing ? 'Editar lista inteligente' : 'Nueva lista inteligente', body: form });
  if (!name) setTimeout(() => $f('name').focus(), 60);
}

/* ---------------------------------------------------------------------------
   Portada: accesos a la cola y a las listas
--------------------------------------------------------------------------- */
function buildListsStrip() {
  const sec = document.createElement('section');
  sec.className = 'pod-lists-strip';
  const q = podcastState.queue;
  sec.innerHTML = `<h2 class="pod-home-h">☰ Cola y listas <span>${podcastState.lists.length}</span></h2><div class="pod-chips"></div>`;
  const chips = sec.querySelector('.pod-chips');
  const chip = (html, fn, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pod-chip ' + cls;
    b.innerHTML = html;
    b.onclick = fn;
    chips.append(b);
  };
  chip(`<strong>☰ Cola</strong><small>${q.length ? plural(q.length, 'episodio', 'episodios') : 'vacía'}</small>`, () => renderPodcastQueue(), 'is-queue');
  podcastState.lists.forEach(l =>
    chip(
      `<strong>${l.type === 'smart' ? '✨' : '📃'} ${pEsc(l.name)}</strong><small>${l.type === 'smart' ? 'inteligente' : plural(l.items.length, 'episodio', 'episodios')}</small>`,
      () => renderPodcastList(l.id)
    )
  );
  chip('<strong>＋ Nueva</strong><small>lista</small>', () =>
    podSheet({
      title: 'Nueva lista',
      items: [
        { icon: '📃', label: 'Lista normal', hint: 'Tú eliges los episodios y su orden', on: newManualListFlow },
        { icon: '✨', label: 'Lista inteligente', hint: 'Se rellena sola con reglas', on: newSmartListFlow },
        { icon: '📥', label: 'Importar desde un archivo', on: importPodcastListFile }
      ]
    })
  , 'is-new');
  return sec;
}
window.renderPodcastListsStrip = root => root.append(buildListsStrip());
function refreshListsStrip() {
  const old = document.querySelector('#podcastContent .pod-lists-strip');
  if (old) old.replaceWith(buildListsStrip());
}

/* ---------------------------------------------------------------------------
   Reproductor ampliado: cola, velocidad y temporizador
--------------------------------------------------------------------------- */
const POD_SPEEDS = [0.75, 0.9, 1, 1.1, 1.2, 1.3, 1.5, 1.75, 2, 2.5];
function speedLabel(v) {
  return String(v).replace('.', ',') + '×';
}
function openSpeedMenu() {
  const cur = podcastSpeed();
  podSheet({
    title: 'Velocidad de reproducción',
    subtitle: 'Se aplica a todos los episodios',
    items: POD_SPEEDS.map(v => ({
      icon: v < 1 ? '🐢' : v === 1 ? '•' : '🐇',
      label: speedLabel(v) + (v === 1 ? ' (normal)' : ''),
      checked: v === cur,
      on: () => {
        try {
          localStorage.setItem(POD_SPEED_KEY, String(v));
        } catch {}
        applyPodcastSpeed();
        updatePlayerExtras();
      }
    }))
  });
}
let podSleep = { until: 0, end: false, timer: null };
function setSleepTimer(min) {
  clearInterval(podSleep.timer);
  podSleep = { until: 0, end: false, timer: null };
  if (min === 'end') podSleep.end = true;
  else if (min > 0) {
    podSleep.until = Date.now() + min * 60000;
    podSleep.timer = setInterval(() => {
      if (Date.now() >= podSleep.until) {
        const a = $p('podcastAudio');
        setSleepTimer(0);
        if (a && !a.paused) {
          window.viferorNativePodcastPause?.();
          podToast('🌙 Temporizador: reproducción en pausa');
        }
      }
      updatePlayerExtras();
    }, 1000);
  }
  updatePlayerExtras();
}
window.podcastSleepAtEnd = () => {
  if (!podSleep.end) return false;
  setSleepTimer(0);
  podToast('🌙 Temporizador: fin del episodio');
  return true;
};
function openSleepMenu() {
  const active = podSleep.until || podSleep.end;
  podSheet({
    title: '🌙 Temporizador para dormir',
    subtitle: active ? (podSleep.end ? 'Se parará al terminar el episodio' : `Se parará en ${fmtPodTime((podSleep.until - Date.now()) / 1000)}`) : 'Pausa la reproducción pasado un tiempo',
    items: [
      active && { icon: '✕', label: 'Desactivar', on: () => setSleepTimer(0) },
      podSleep.until && { icon: '＋', label: 'Añadir 10 minutos', on: () => setSleepTimer(Math.ceil((podSleep.until - Date.now()) / 60000) + 10) },
      { icon: '⏹', label: 'Al terminar el episodio', checked: podSleep.end, on: () => setSleepTimer('end') },
      ...[5, 10, 15, 30, 45, 60, 90].map(m => ({ icon: '⏱', label: m < 60 ? `${m} minutos` : m === 60 ? '1 hora' : '1 hora y media', on: () => setSleepTimer(m) }))
    ]
  });
}
function updatePlayerExtras() {
  const q = podcastState.queue;
  if ($p('podExpQueueCount')) $p('podExpQueueCount').textContent = q.length;
  if ($p('podExpSpeed')) {
    const v = podcastSpeed();
    $p('podExpSpeed').textContent = speedLabel(v);
    $p('podExpSpeed').classList.toggle('on', v !== 1);
  }
  const sl = $p('podExpSleep');
  if (sl) {
    sl.classList.toggle('on', !!(podSleep.until || podSleep.end));
    sl.textContent = podSleep.end ? '🌙 Fin del episodio' : podSleep.until ? '🌙 ' + fmtPodTime((podSleep.until - Date.now()) / 1000) : '🌙 Temporizador';
  }
  const up = $p('podUpNext');
  if (up) {
    up.hidden = !q.length;
    up.textContent = q.length ? `A continuación: ${q[0].title || 'Episodio'}${q[0].podcastTitle ? ' — ' + q[0].podcastTitle : ''}` : '';
  }
}

/* ---------------------------------------------------------------------------
   Refrescos
--------------------------------------------------------------------------- */
function refreshPodcastScreen() {
  const s = podcastState.screen || '';
  if (!podcastsViewActive()) return;
  const root = $p('podcastContent');
  const sc = root?.scrollTop || 0;
  if (s === 'queue') renderPodcastQueue(true);
  else if (s === 'lists') renderPodcastLists(true);
  else if (s.startsWith('list:')) renderPodcastList(s.slice(5), true);
  else if (s === 'episodes' && podcastState.episodesPodcast) renderEpisodesView(podcastState.episodesPodcast, podcastState.episodes || []);
  else return;
  if (root) root.scrollTop = sc;
}
document.addEventListener('podcasts:queue-changed', () => {
  refreshQueueButtons();
  updatePlayerExtras();
  if (podDragging) return;
  const s = podcastState.screen || '';
  if (podcastsViewActive() && (s === 'queue' || s === 'lists')) refreshPodcastScreen();
  else if (s === 'landing') refreshListsStrip();
});
document.addEventListener('podcasts:lists-changed', () => {
  if (podDragging) return;
  const s = podcastState.screen || '';
  if (s === 'lists' || s.startsWith('list:')) refreshPodcastScreen();
  else if (s === 'landing') refreshListsStrip();
});

function initPodcastLists() {
  if (!podcastState.lists.length) loadPodcastLists();
  $p('podExpQueue')?.addEventListener('click', () => {
    closePodcastExpanded();
    renderPodcastQueue();
  });
  $p('podExpSpeed')?.addEventListener('click', openSpeedMenu);
  $p('podExpSleep')?.addEventListener('click', openSleepMenu);
  // El ▶/⏸ de «Sonando ahora» en la cola sigue al reproductor.
  const a = $p('podcastAudio');
  ['play', 'pause'].forEach(ev =>
    a?.addEventListener(ev, () => {
      const b = document.querySelector('#podcastContent .pod-qrow.is-current .pod-qplay');
      if (b) b.textContent = a.paused ? '▶' : '⏸';
    })
  );
  updatePlayerExtras();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPodcastLists);
else initPodcastLists();
