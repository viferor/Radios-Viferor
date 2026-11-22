/* ===========================================================================
   Podcasts al estilo AntennaPod (1.40.0)
   ---------------------------------------------------------------------------
   Barra inferior con cinco secciones (Inicio · Cola · Novedades · Suscripciones
   · Más), filas de episodio con portada, fecha, barra de progreso y botón ▶, y
   el reproductor ampliado con ☆ zᶻ ↗ ⋮, «Notas del programa», velocidad, −10,
   +30 y siguiente.

   No cambia cómo se reproduce nada: usa las funciones de podcasts.js y
   podcast-listas.js (cola, listas, progreso, menús…). Lo que hace es sustituir
   las pantallas: renderPodcastLanding, renderPodcastHome, renderPodcastQueue,
   renderEpisodesView… son funciones globales de esos archivos y aquí se les
   asigna una versión nueva (las llamadas internas las buscan por su nombre
   global, así que usan la nueva).

   Datos nuevos (localStorage, entran en el backup completo):
   - radios_viferor_podcast_ep_favs_v1      episodios favoritos (☆ del reproductor)
   - radios_viferor_podcast_inbox_seen_v1   «Marcar todo como visto» en Novedades
   - radios_viferor_podcast_inbox_hidden_v1 episodios quitados de Novedades
   - radios_viferor_podcast_inbox_cache_v1  caché de los últimos episodios (se puede perder)
   - radios_viferor_podcast_listen_time_v1  tiempo escuchado por podcast (Estadísticas)
=========================================================================== */
(function () {
  'use strict';

  const EP_FAVS_KEY = 'radios_viferor_podcast_ep_favs_v1';
  const INBOX_SEEN_KEY = 'radios_viferor_podcast_inbox_seen_v1';
  const INBOX_HIDDEN_KEY = 'radios_viferor_podcast_inbox_hidden_v1';
  const INBOX_CACHE_KEY = 'radios_viferor_podcast_inbox_cache_v1';
  const LISTEN_KEY = 'radios_viferor_podcast_listen_time_v1';
  const POOL_MAX_AGE = 20 * 60000; // los últimos episodios de las suscripciones valen 20 min
  const POOL_PER_FEED = 15;
  const POOL_MAX = 600;
  const INBOX_MAX = 300;

  // Pantallas de la barra inferior y de «Más».
  const TABS = ['landing', 'queue', 'novedades', 'subs'];
  const MORE_SCREENS = ['allEpisodes', 'history', 'favorites', 'stats'];

  /* -------------------------------------------------------------------------
     Iconos (Material, trazos propios en SVG)
  ------------------------------------------------------------------------- */
  const P = {
    home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
    queue: 'M3 10h11v2H3zm0-4h11v2H3zm0 8h7v2H3zm13-1v8l6-4z',
    inbox: 'M19 3H4.99C3.88 3 3 3.9 3 5v14c0 1.1.88 2 1.99 2H19c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 12h-4c0 1.66-1.35 3-3 3s-3-1.34-3-3H4.99V5H19v10z',
    grid: 'M3 3v8h8V3H3zm6 6H5V5h4v4zm-6 4v8h8v-8H3zm6 6H5v-4h4v4zm4-16v8h8V3h-8zm6 6h-4V5h4v4zm-6 4v8h8v-8h-8zm6 6h-4v-4h4v4z',
    more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
    search: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    arrow: 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z',
    shuffle: 'M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z',
    filter: 'M4.25 5.61C6.27 8.2 10 13 10 13v6c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-6s3.72-4.8 5.74-7.39A.998.998 0 0018.95 4H5.04c-.83 0-1.3.95-.79 1.61z',
    down: 'M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z',
    star: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
    starOff: 'M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z',
    share: 'M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z',
    speed: 'M20.38 8.57l-1.23 1.85a8 8 0 01-.22 7.58H5.07A8 8 0 0115.58 6.85l1.85-1.23A10 10 0 003.35 19a2 2 0 001.72 1h13.85a2 2 0 001.74-1 10 10 0 00-.27-10.44zm-9.79 6.84a2 2 0 002.83 0l5.66-8.49-8.49 5.66a2 2 0 000 2.83z',
    rew: 'M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z',
    ffw: 'M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z',
    skip: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
    info: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z',
    add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
    play: 'M8 5v14l11-7z',
    pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
    history: 'M13 3a9 9 0 00-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0013 21a9 9 0 000-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
    rss: 'M6.18 15.64a2.18 2.18 0 010 4.36 2.18 2.18 0 010-4.36M4 4.44A15.56 15.56 0 0119.56 20h-2.83A12.73 12.73 0 004 7.27V4.44m0 5.66a9.9 9.9 0 019.9 9.9h-2.83A7.07 7.07 0 004 12.93V10.1z',
    stats: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 10h2v7H7zm4-3h2v10h-2zm4 6h2v4h-2z',
    lists: 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z',
    gear: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
    check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'
  };
  const ico = (name, cls = '') => `<svg class="pn-svg ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[name]}"/></svg>`;
  window.pnIcon = ico;

  /* -------------------------------------------------------------------------
     Utilidades
  ------------------------------------------------------------------------- */
  const lsJson = (k, def) => {
    try {
      const v = JSON.parse(localStorage.getItem(k) || 'null');
      return v == null ? def : v;
    } catch {
      return def;
    }
  };
  const lsPut = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
      return true;
    } catch {
      return false;
    }
  };
  const audio = () => $p('podcastAudio');
  const content = () => $p('podcastContent');
  // «01:56:51» como en AntennaPod.
  function hms(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(sec / 3600),
      m = Math.floor((sec % 3600) / 60),
      s = sec % 60;
    return [h, m, s].map(x => String(x).padStart(2, '0')).join(':');
  }
  function mb(bytes) {
    const n = Number(bytes) || 0;
    if (n < 200000) return '';
    const v = n / 1048576;
    return (v < 10 ? v.toFixed(1).replace('.', ',') : String(Math.round(v))) + ' MB';
  }
  // «18 horas 29 minutos» (encabezado de la cola).
  function longLeft(sec) {
    sec = Math.round(Number(sec) || 0);
    const h = Math.floor(sec / 3600),
      m = Math.round((sec % 3600) / 60);
    const parts = [];
    if (h) parts.push(h === 1 ? '1 hora' : `${h} horas`);
    if (m || !h) parts.push(m === 1 ? '1 minuto' : `${m} minutos`);
    return parts.join(' ');
  }
  const badgeText = n => (n > 999 ? '999+' : String(n));
  function hueOf(t) {
    return [...String(t || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  }
  function artHtml(src, title, cls = 'pn-art') {
    return `<span class="${cls}" style="--ph:${hueOf(title)}" aria-hidden="true"><span class="pn-art-ph">${pEsc(podcastInitials(title))}</span>${
      src ? `<img src="${pEsc(src)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''
    }</span>`;
  }
  const epArt = e => e?.image || e?.podcastArt || '';
  function el(tag, cls, html) {
    const x = document.createElement(tag);
    if (cls) x.className = cls;
    if (html != null) x.innerHTML = html;
    return x;
  }
  function isPlayingEp(e) {
    const a = audio();
    return isCurrentEpisode(e) && a && !a.paused;
  }
  // Posición y duración de un episodio (el que suena, en directo).
  function posDur(e) {
    const a = audio();
    if (isCurrentEpisode(e) && a) {
      const d = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : epDuration(e);
      return { pos: Number(a.currentTime) || getEpisodePos(e.id), dur: d };
    }
    return { pos: isEpisodeDone(e.id) ? 0 : getEpisodePos(e.id), dur: epDuration(e) };
  }

  /* -------------------------------------------------------------------------
     Episodios favoritos (☆ del reproductor y del menú del episodio)
  ------------------------------------------------------------------------- */
  let epFavs = null;
  function loadEpFavs() {
    if (!epFavs) epFavs = (lsJson(EP_FAVS_KEY, []) || []).filter(e => e && e.audioUrl);
    return epFavs;
  }
  function isEpFav(e) {
    const k = epKey(e);
    return !!k && loadEpFavs().some(x => epKey(x) === k);
  }
  function toggleEpFav(e) {
    if (!e?.audioUrl) return;
    const k = epKey(e);
    if (isEpFav(e)) {
      epFavs = loadEpFavs().filter(x => epKey(x) !== k);
      podToast('Quitado de favoritos');
    } else {
      epFavs = [{ ...minimalEpisode(e), favAt: Date.now() }, ...loadEpFavs()];
      podToast('⭐ Añadido a favoritos');
    }
    lsPut(EP_FAVS_KEY, epFavs);
    syncExpandedExtras();
    if (podcastState.screen === 'favorites') refreshMine();
  }

  /* -------------------------------------------------------------------------
     Últimos episodios de las suscripciones (Novedades, Sorpréndete, Episodios)
  ------------------------------------------------------------------------- */
  let pool = null; // { t, eps }
  let poolLoading = null;
  function slimEp(e) {
    const m = minimalEpisode(e) || {};
    if (e.size) m.size = e.size;
    if (e.pageUrl) m.pageUrl = e.pageUrl;
    return m;
  }
  function readPoolCache() {
    if (pool) return pool;
    const c = lsJson(INBOX_CACHE_KEY, null);
    if (c && Array.isArray(c.eps)) pool = { t: Number(c.t) || 0, eps: c.eps.filter(e => e && e.audioUrl) };
    return pool;
  }
  function poolFresh() {
    const p = readPoolCache();
    return !!p && Date.now() - p.t < POOL_MAX_AGE;
  }
  async function loadPool(force = false) {
    if (!force && poolFresh()) return pool.eps;
    if (poolLoading) return poolLoading;
    poolLoading = (async () => {
      const subs = podcastState.subs.filter(p => podcastFeedUrl(p));
      if (force) smartFeedCache.clear();
      const rows = await mapLimit(subs, 5, p => fetchFeedEpisodes(p, POOL_PER_FEED));
      const all = dedupeEpisodes(rows.flat().filter(Boolean)).sort((a, b) => podcastDateValue(b.date) - podcastDateValue(a.date));
      if (!all.length && readPoolCache()?.eps?.length) return pool.eps; // sin red: se queda lo de antes
      pool = { t: Date.now(), eps: all.slice(0, POOL_MAX) };
      // Copia ligera (sin descripciones): al abrir la app la portada sale al momento.
      if (!lsPut(INBOX_CACHE_KEY, { t: pool.t, eps: pool.eps.map(slimEp) })) {
        try {
          localStorage.removeItem(INBOX_CACHE_KEY);
        } catch {}
      }
      updateBadge();
      return pool.eps;
    })();
    try {
      return await poolLoading;
    } finally {
      poolLoading = null;
    }
  }
  function inboxHidden() {
    return new Set(lsJson(INBOX_HIDDEN_KEY, []) || []);
  }
  function hideFromInbox(e) {
    const arr = (lsJson(INBOX_HIDDEN_KEY, []) || []).filter(k => k !== epKey(e));
    arr.unshift(epKey(e));
    lsPut(INBOX_HIDDEN_KEY, arr.slice(0, 3000));
    updateBadge();
    if (podcastState.screen === 'novedades') refreshMine();
  }
  // Novedades: episodios de tus suscripciones que aún no has tocado (ni escuchados, ni
  // empezados, ni en la cola), del más nuevo al más antiguo.
  function inboxEpisodes() {
    const p = readPoolCache();
    if (!p) return null;
    const seen = Number(localStorage.getItem(INBOX_SEEN_KEY) || 0);
    const hidden = inboxHidden();
    const subs = new Set(podcastState.subs.map(s => podcastFeedUrl(s)));
    return p.eps
      .filter(e => {
        if (!subs.has(e.feedUrl)) return false;
        if (seen && podcastDateValue(e.date) <= seen) return false;
        if (hidden.has(epKey(e)) || isEpisodeDone(e.id) || getEpisodePos(e.id) > 5) return false;
        if (isInQueue(e) || isCurrentEpisode(e)) return false;
        return true;
      })
      .slice(0, INBOX_MAX);
  }
  function inboxCount() {
    const list = inboxEpisodes();
    if (list) return list.length;
    return podcastState.subs.reduce((s, p) => s + (Number(p.newCount) || 0), 0);
  }
  function markInboxSeen() {
    try {
      localStorage.setItem(INBOX_SEEN_KEY, String(Date.now()));
    } catch {}
    let changed = false;
    podcastState.subs.forEach(s => {
      if (s.newCount) {
        s.newCount = 0;
        changed = true;
      }
      s.lastOpenedAt = Date.now();
    });
    savePodcastSubs();
    if (changed) refreshPodcastSubscriptionUI();
    updateBadge();
    podToast('Novedades marcadas como vistas');
    if (podcastState.screen === 'novedades' || podcastState.screen === 'landing') refreshMine();
  }
  function updateBadge() {
    const b = $p('pnInboxBadge');
    if (!b) return;
    const n = inboxCount();
    b.hidden = !n;
    b.textContent = badgeText(n);
  }

  /* -------------------------------------------------------------------------
     Tiempo escuchado (Estadísticas)
  ------------------------------------------------------------------------- */
  let listen = null,
    listenDirty = false,
    lastTick = 0;
  function listenStore() {
    if (!listen) listen = lsJson(LISTEN_KEY, {}) || {};
    return listen;
  }
  function flushListen() {
    if (listenDirty) lsPut(LISTEN_KEY, listenStore());
    listenDirty = false;
  }
  function trackListen() {
    const a = audio(),
      e = podcastState.current;
    const now = Date.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;
    if (!a || !e || a.paused || dt <= 0 || dt > 5) return;
    const k = podcastKey(e) || e.feedUrl || '?';
    const s = listenStore();
    const x = s[k] || (s[k] = { s: 0 });
    x.s = Math.round((Number(x.s) || 0) + dt);
    x.t = e.podcastTitle || x.t || '';
    x.a = e.podcastArt || x.a || '';
    listenDirty = true;
  }

  /* -------------------------------------------------------------------------
     Piezas comunes: encabezado y filas de episodio
  ------------------------------------------------------------------------- */
  // Encabezado: (← ) Título grande · 🔍 · ⋮, y un subtítulo opcional.
  function head(title, { sub = '', back = false, onMore = null, extra = [] } = {}) {
    const h = el('div', 'pn-head');
    h.innerHTML = `<div class="pn-head-row">${back ? `<button class="pn-ico pn-back" type="button" aria-label="Volver">${ico('back')}</button>` : ''}<h2>${pEsc(title)}</h2>${extra
      .map((x, i) => `<button class="pn-ico" data-x="${i}" type="button" aria-label="${pEsc(x.label)}">${ico(x.icon)}</button>`)
      .join('')}<button class="pn-ico pn-search" type="button" aria-label="Buscar o añadir podcasts">${ico('search')}</button>${
      onMore ? `<button class="pn-ico pn-more" type="button" aria-label="Más opciones">${ico('more')}</button>` : ''
    }</div>${sub ? `<p class="pn-head-sub">${pEsc(sub)}</p>` : ''}`;
    h.querySelector('.pn-back')?.addEventListener('click', backFromPodcast);
    h.querySelector('.pn-search').onclick = () => window.openPodcastSearchDrawer?.();
    if (onMore) h.querySelector('.pn-more').onclick = onMore;
    extra.forEach((x, i) => (h.querySelector(`[data-x="${i}"]`).onclick = x.on));
    return h;
  }
  function timeLine(e) {
    const { pos, dur } = posDur(e);
    if (pos > 5 && dur > 0) {
      const pct = Math.min(100, (pos / dur) * 100).toFixed(1);
      return `<span class="pn-t">${hms(pos)}</span><i class="pn-bar"><b style="width:${pct}%"></b></i><span class="pn-t">-${hms(dur - pos)}</span>`;
    }
    if (isEpisodeDone(e.id)) return `<span class="pn-t pn-done">${ico('check')} Escuchado${dur ? ` · ${hms(dur)}` : ''}</span>`;
    return dur ? `<span class="pn-t">${hms(dur)}</span>` : '';
  }
  function playBtnHtml(e) {
    const on = isPlayingEp(e);
    return `<button class="pn-play${on ? ' on' : ''}" type="button" data-ep="${pEsc(epKey(e))}" aria-label="${on ? 'Pausar' : 'Reproducir'}">${ico(on ? 'pause' : 'play')}</button>`;
  }
  function playOrToggle(e) {
    if (isCurrentEpisode(e)) togglePodcastPlay();
    else playEpisodeNow(e);
  }
  // Fila de episodio: (⠿) portada · «17 jun · 112 MB» · título · progreso · ▶
  function row(e, { handle = false, onMenu = null, showPodcast = false } = {}) {
    const r = el('div', 'pod-qrow pn-row' + (isCurrentEpisode(e) ? ' is-current' : '') + (isEpisodeDone(e.id) ? ' is-done' : ''));
    r.dataset.ep = epKey(e);
    const meta = [shortEpDate(e.date), mb(e.size), showPodcast ? e.podcastTitle : ''].filter(Boolean).join(' · ');
    r.innerHTML = `${handle ? '<button class="pod-qhandle pn-handle" type="button" aria-label="Arrastrar para cambiar el orden">⠿</button>' : ''}${artHtml(
      epArt(e),
      e.podcastTitle || e.title
    )}<div class="pn-info"><small class="pn-meta">${pEsc(meta)}${isEpFav(e) ? ' <span class="pn-star">★</span>' : ''}</small><strong>${pEsc(
      e.title || 'Episodio'
    )}</strong><div class="pn-time">${timeLine(e)}</div></div>${playBtnHtml(e)}`;
    r.querySelector('.pn-play').onclick = ev => {
      ev.stopPropagation();
      playOrToggle(e);
    };
    const open = onMenu || (() => openEpisodeMenu(e));
    r.querySelector('.pn-info').onclick = open;
    r.querySelector('.pn-art').onclick = open;
    return r;
  }
  function rowsList(eps, opts = {}) {
    const list = el('div', 'pn-list');
    // Por tandas: los feeds largos (cientos de episodios) no bloquean la pantalla.
    const first = eps.slice(0, 60);
    first.forEach((e, i) => list.append(row(e, typeof opts === 'function' ? opts(e, i) : opts)));
    let i = first.length;
    const more = () => {
      if (!list.isConnected || i >= eps.length) return;
      const end = Math.min(eps.length, i + 80);
      for (; i < end; i++) list.append(row(eps[i], typeof opts === 'function' ? opts(eps[i], i) : opts));
      if (i < eps.length) setTimeout(more, 30);
    };
    if (i < eps.length) setTimeout(more, 60);
    return list;
  }
  function emptyBox(icon, title, text, actions = []) {
    const d = el('div', 'pn-empty', `<div class="pn-empty-i">${icon}</div><h3>${pEsc(title)}</h3>${text ? `<p>${pEsc(text)}</p>` : ''}`);
    if (actions.length) {
      const a = el('div', 'pn-empty-actions');
      actions.forEach(([label, fn]) => {
        const b = el('button', '', pEsc(label));
        b.type = 'button';
        b.onclick = fn;
        a.append(b);
      });
      d.append(a);
    }
    return d;
  }
  // Sección de la portada: «Título  (pastilla)  Enlace →»
  function section(title, { link = '', onLink = null, pill = '', icon = '', onIcon = null } = {}) {
    const s = el('section', 'pn-sec');
    s.innerHTML = `<div class="pn-sec-head"><h3>${pEsc(title)}</h3>${icon ? `<button class="pn-ico pn-sec-ico" type="button" aria-label="Otra vez">${ico(icon)}</button>` : ''}${
      pill ? `<span class="pn-pill">${pEsc(pill)}</span>` : ''
    }${link || onLink ? `<button class="pn-link" type="button">${pEsc(link)}${ico('arrow')}</button>` : ''}</div>`;
    if (onLink) s.querySelector('.pn-link').onclick = onLink;
    if (onIcon) s.querySelector('.pn-sec-ico').onclick = onIcon;
    return s;
  }
  // Tarjeta de carrusel (Continúa escuchando, Sorpréndete).
  function card(e) {
    const b = el('div', 'pn-card');
    const { pos, dur } = posDur(e);
    const pct = pos > 5 && dur ? Math.min(100, (pos / dur) * 100) : 0;
    const when = shortEpDate(e.date);
    b.dataset.ep = epKey(e);
    b.innerHTML = `<div class="pn-card-art">${artHtml(epArt(e), e.podcastTitle || e.title, 'pn-art pn-art-big')}${playBtnHtml(e)}${
      pct ? `<i class="pn-card-bar"><b style="width:${pct.toFixed(1)}%"></b></i>` : ''
    }</div><strong>${pEsc(e.title || 'Episodio')}</strong><small>${pEsc(when || e.podcastTitle || '')}</small>`;
    b.querySelector('.pn-play').onclick = ev => {
      ev.stopPropagation();
      playOrToggle(e);
    };
    b.onclick = () => openEpisodeMenu(e);
    return b;
  }
  function carousel(nodes) {
    const c = el('div', 'pn-carousel');
    nodes.forEach(n => c.append(n));
    return c;
  }
  function subTile(p) {
    const t = podcastTile(subscriptionFor(p) || p);
    t.classList.add('pn-tile');
    return t;
  }

  /* -------------------------------------------------------------------------
     Navegación
  ------------------------------------------------------------------------- */
  function go(screen, mode, render) {
    // mode: 'push' (nueva pantalla), 'replace' (cambio de pestaña) o 'none' (desde el historial).
    // Al abrir la app se pinta Inicio sin cambiar de pestaña ('none'); desde otro sitio
    // (p. ej. «☰ Cola» del reproductor estando en Radios) sí se pasa a Podcasts.
    if (mode !== 'none' && !podcastsViewActive()) switchToPodcasts(true);
    if (document.body.classList.contains('pod-adding')) closeAddPodcast();
    if (mode === 'push') pushPodcastState(screen);
    else if (mode === 'replace') pushPodcastState(screen, true);
    podcastState.screen = screen;
    const detail = !TABS.includes(screen);
    setPodcastLayout(detail);
    document.body.classList.remove('podcast-results-active', 'podcast-subs-fullscreen');
    const root = content();
    const sc = mode === 'none' ? root.scrollTop : 0;
    root.replaceChildren();
    render(root);
    root.scrollTop = sc;
    syncNav();
  }
  // Toque en la barra inferior.
  function tab(target) {
    if (target === 'more') return moreMenu();
    const cur = podcastState.screen;
    window.closePodSheet?.();
    if (cur === target && podcastsViewActive() && !document.body.classList.contains('pod-adding')) {
      content().scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    // Entre pestañas no se acumula historial: Atrás vuelve a Inicio (como en AntennaPod).
    const mode = cur && cur !== 'landing' && TABS.includes(cur) ? 'replace' : target === 'landing' ? 'replace' : 'push';
    SCREENS[target](mode);
  }
  function syncNav() {
    const s = podcastState.screen || '';
    const active = TABS.includes(s) ? s : MORE_SCREENS.includes(s) || s === 'lists' || s.startsWith('list:') ? 'more' : '';
    document.body.classList.toggle('pn-on-subs', s === 'subs');
    document.querySelectorAll('#pnNav [data-tab]').forEach(b => {
      const on = b.dataset.tab === active;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    updateBadge();
  }
  function refreshMine() {
    const s = podcastState.screen;
    if (!podcastsViewActive() || !SCREENS[s]) return;
    SCREENS[s]('none');
  }

  /* -------------------------------------------------------------------------
     Inicio
  ------------------------------------------------------------------------- */
  let surprise = null; // los episodios de «Sorpréndete» se mantienen hasta pulsar 🔀
  function pickSurprise(force = false) {
    const eps = (readPoolCache()?.eps || []).filter(e => !isEpisodeDone(e.id));
    if (!force && surprise && surprise.length) return surprise;
    surprise = shuffled(eps).slice(0, 8);
    return surprise;
  }
  function renderHome(mode) {
    go('landing', mode, root => {
      root.append(head('Inicio', { onMore: homeMenu }));
      if (!podcastState.subs.length && !podcastState.current && !podcastState.queue.length) {
        root.append(
          emptyBox('🎙️', 'Aún no tienes podcasts', 'Busca podcasts o importa tu lista (OPML) para empezar.', [
            ['＋ Añadir podcast', () => window.openPodcastSearchDrawer?.()],
            ['📥 Importar OPML', () => $p('podcastFile')?.click()]
          ])
        );
        return;
      }
      // Continúa escuchando: lo que suena y lo que dejaste a medias.
      const cont = dedupeEpisodes([podcastState.current, ...inProgressEpisodes()].filter(Boolean)).slice(0, 12);
      const s1 = section('Continúa escuchando', { link: 'Cola', onLink: () => tab('queue') });
      if (cont.length) s1.append(carousel(cont.map(card)));
      else if (podcastState.queue.length) s1.append(carousel(podcastState.queue.slice(0, 8).map(card)));
      else s1.append(el('p', 'pn-hint', 'Cuando empieces un episodio aparecerá aquí.'));
      root.append(s1);

      // Echa un ojo a las novedades
      const inbox = inboxEpisodes();
      const n = inboxCount();
      const s2 = section('Echa un ojo a las novedades', { pill: n ? badgeText(n) : '', onLink: () => tab('novedades') });
      s2.classList.add('pn-sec-inbox');
      if (inbox && inbox.length) s2.append(rowsList(inbox.slice(0, 3)));
      else if (inbox) s2.append(el('p', 'pn-hint', 'No hay episodios nuevos. ¡Estás al día!'));
      else s2.append(el('p', 'pn-hint pn-loading-line', 'Buscando episodios nuevos…'));
      root.append(s2);

      // Sorpréndete: episodios al azar de tus suscripciones.
      const sur = readPoolCache() ? pickSurprise() : [];
      if (sur.length) {
        const s3 = section('Sorpréndete', { link: 'Episodios', onLink: () => SCREENS.allEpisodes('push'), icon: 'shuffle', onIcon: () => {
          pickSurprise(true);
          const c = root.querySelector('.pn-sec-surprise .pn-carousel');
          if (c) c.replaceWith(carousel(surprise.map(card)));
        } });
        s3.classList.add('pn-sec-surprise');
        s3.append(carousel(sur.map(card)));
        root.append(s3);
      }

      // Vuelve a tus clásicos: lo que más escuchas.
      if (podcastState.subs.length) {
        const classics = [...podcastState.subs]
          .map(p => ({ p, n: getPodcastPlayCount(p) + (Number(listenStore()[podcastKey(p)]?.s) || 0) / 1800 }))
          .sort((a, b) => b.n - a.n || getPodcastLatestDate(b.p) - getPodcastLatestDate(a.p))
          .slice(0, 12)
          .map(x => x.p);
        const s4 = section('Vuelve a tus clásicos', { link: 'Suscripciones', onLink: () => tab('subs') });
        s4.append(carousel(classics.map(subTile)));
        root.append(s4);
      }

      // Cola y listas (en lugar de «Gestionar las descargas»: aquí no se descarga nada).
      window.renderPodcastListsStrip?.(root);

      if (!poolFresh()) {
        loadPool().then(() => {
          if (podcastState.screen === 'landing' && podcastsViewActive()) renderHome('none');
        }, () => {});
      }
    });
  }
  function homeMenu() {
    podSheet({
      title: 'Inicio',
      items: [
        { icon: '🔄', label: 'Buscar episodios nuevos', on: () => refreshPool() },
        { icon: '✓', label: 'Marcar todas las novedades como vistas', on: markInboxSeen },
        { icon: ico('gear'), label: 'Ajustes de podcasts', on: settingsMenu }
      ]
    });
  }
  async function refreshPool() {
    podToast('Buscando episodios nuevos…');
    await loadPool(true);
    podToast('Novedades al día');
    refreshMine();
  }

  /* -------------------------------------------------------------------------
     Cola
  ------------------------------------------------------------------------- */
  function renderQueue(mode) {
    go('queue', mode, root => {
      const cur = podcastState.current;
      const q = podcastState.queue;
      const all = cur ? [cur, ...q.filter(e => epKey(e) !== epKey(cur))] : q;
      const left = all.reduce((s, e) => {
        const { pos, dur } = posDur(e);
        return s + Math.max(0, dur - pos);
      }, 0);
      const sub = all.length ? `${plural(all.length, 'episodio', 'episodios')}${left > 60 ? ` • quedan ${longLeft(left)}` : ''}` : '';
      root.append(head('Cola', { sub, onMore: queueMenu }));
      if (!all.length) {
        root.append(
          emptyBox('☰', 'La cola está vacía', 'Añade episodios desde su menú (toca un episodio) o llénala de golpe.', [
            ['🆕 Últimos de todas', () => playAll('latest')],
            ['📃 Mis listas', () => renderPodcastLists()]
          ])
        );
        return;
      }
      const list = el('div', 'pn-list pod-qlist');
      if (cur) list.append(row(cur, { onMenu: () => openEpisodeMenu(cur) }));
      const off = cur ? 1 : 0;
      q.forEach((e, i) => {
        if (cur && epKey(e) === epKey(cur)) return;
        list.append(row(e, { handle: true, onMenu: () => queueItemMenu(e, i) }));
      });
      // El que suena no se mueve: arrastrar solo reordena la cola.
      makeSortable(list, (from, to) => {
        const f = from - off,
          t = Math.max(0, to - off);
        if (f < 0) return refreshMine();
        moveQueueItem(f, t);
      });
      root.append(list);
    });
  }
  function queueMenu() {
    const q = podcastState.queue;
    const o = podcastQueueOptions();
    podSheet({
      title: 'Cola',
      subtitle: q.length ? episodesSummary(q) : 'Vacía',
      items: [
        { icon: '🔀', label: 'Mezclar', disabled: q.length < 2, on: shuffleQueue },
        { icon: '💾', label: 'Guardar como lista', disabled: !q.length && !podcastState.current, on: saveQueueAsList },
        { icon: '🧹', label: 'Quitar los escuchados', disabled: !q.length, on: removeDoneFromQueue },
        { icon: '🗑', label: 'Vaciar la cola', danger: true, disabled: !q.length, on: clearQueue },
        { sep: true },
        { icon: '⏭', label: 'Pasar al siguiente solo', checked: !!o.autoNext, on: () => toggleOpt('autoNext', queueMenu) },
        { icon: '⤼', label: 'Saltar los ya escuchados', checked: !!o.skipDone, on: () => toggleOpt('skipDone', queueMenu) },
        { icon: '🔁', label: 'Repetir: ' + { off: 'no', one: 'este episodio', all: 'toda la cola' }[o.repeat], on: () => cycleRepeat(queueMenu) },
        {
          icon: '🆕',
          label: 'Al acabar la cola: ' + (o.whenEmpty === 'latest' ? 'seguir con novedades' : 'parar'),
          on: () => {
            setPodcastQueueOption('whenEmpty', o.whenEmpty === 'latest' ? 'stop' : 'latest');
            queueMenu();
          }
        },
        { sep: true },
        { icon: ico('history'), label: 'Historial de reproducción', on: () => SCREENS.history('push') }
      ]
    });
  }
  function toggleOpt(k, reopen) {
    setPodcastQueueOption(k, !podcastQueueOptions()[k]);
    reopen?.();
  }
  function cycleRepeat(reopen) {
    const order = ['off', 'one', 'all'];
    const cur = podcastQueueOptions().repeat;
    setPodcastQueueOption('repeat', order[(order.indexOf(cur) + 1) % 3]);
    reopen?.();
  }

  /* -------------------------------------------------------------------------
     Novedades
  ------------------------------------------------------------------------- */
  function renderInbox(mode) {
    go('novedades', mode, root => {
      root.append(head('Novedades', { onMore: inboxMenu }));
      if (!podcastState.subs.length) {
        root.append(emptyBox('📥', 'Sin suscripciones', 'Suscríbete a podcasts para ver aquí sus episodios nuevos.', [['＋ Añadir podcast', () => window.openPodcastSearchDrawer?.()]]));
        return;
      }
      const list = inboxEpisodes();
      if (list === null) {
        root.append(el('div', 'pn-loading', 'Buscando episodios nuevos…'));
      } else if (!list.length) {
        root.append(emptyBox('✓', '¡Estás al día!', 'No hay episodios nuevos en tus suscripciones.'));
      } else {
        root.append(
          rowsList(list, e => ({
            onMenu: () => openEpisodeMenu(e, { extra: [{ icon: '✕', label: 'Quitar de novedades', on: () => hideFromInbox(e) }] })
          }))
        );
      }
      if (!poolFresh()) loadPool().then(() => podcastState.screen === 'novedades' && refreshMine(), () => {});
    });
  }
  function inboxMenu() {
    const list = inboxEpisodes() || [];
    podSheet({
      title: 'Novedades',
      subtitle: plural(list.length, 'episodio', 'episodios'),
      items: [
        { icon: '🔄', label: 'Buscar episodios nuevos', on: refreshPool },
        { icon: '➕', label: 'Añadir todas a la cola', disabled: !list.length, on: () => queueEpisodes([...list].reverse(), 'end') },
        { icon: '✓', label: 'Marcar todo como visto', disabled: !list.length, on: markInboxSeen }
      ]
    });
  }

  /* -------------------------------------------------------------------------
     Suscripciones
  ------------------------------------------------------------------------- */
  function renderSubs(mode) {
    go('subs', mode, root => {
      root.append(head('Suscripciones', { onMore: subsMenu }));
      updatePodcastMineCount();
      if (!podcastState.subs.length) {
        root.append(
          emptyBox('📚', 'Aún no tienes suscripciones', 'Pulsa ＋ para buscar podcasts o añadirlos por RSS, o importa tu OPML.', [
            ['📥 Importar OPML', () => $p('podcastFile')?.click()],
            ['＋ Añadir podcast', () => window.openPodcastSearchDrawer?.()]
          ])
        );
      } else {
        const sorted = getSortedPodcastSubs();
        if (($p('podMineSort')?.value || 'name') === 'category') {
          let grid = null,
            cur = null;
          sorted.forEach(p => {
            const cat = podcastCategoryOf(p);
            if (cat !== cur) {
              cur = cat;
              root.append(el('h3', 'pn-cat', `${pEsc(cat)} <small>${sorted.filter(x => podcastCategoryOf(x) === cat).length}</small>`));
              grid = el('div', 'pod-tiles pn-grid');
              root.append(grid);
            }
            grid.append(subTile(p));
          });
        } else {
          const grid = el('div', 'pod-tiles pn-grid');
          sorted.forEach(p => grid.append(subTile(p)));
          root.append(grid);
        }
        refreshPodcastActivity(podcastState.subs, {
          maxAge: 3600000,
          rerender: () => podcastState.screen === 'subs' && refreshMine()
        });
      }
    });
  }
  function subsMenu() {
    const sel = $p('podMineSort');
    const cur = sel?.value || 'name';
    podSheet({
      title: 'Suscripciones',
      subtitle: podcastSubsCountText(podcastState.subs.length),
      items: [
        { icon: '⇅', label: 'Ordenar: ' + (sel ? podcastSelectLabel('podMineSort') : 'Nombre'), on: sortSubsMenu },
        { icon: '🔄', label: 'Buscar episodios nuevos', on: refreshPool },
        { sep: true },
        { icon: ico('add'), label: 'Añadir podcast', on: () => window.openPodcastSearchDrawer?.() },
        { icon: '📥', label: 'Importar lista (OPML)', on: () => $p('podcastFile')?.click() },
        { icon: '💾', label: 'Exportar lista (OPML)', disabled: !podcastState.subs.length, on: () => window.exportPodcastOPML?.() }
      ]
    });
    void cur;
  }
  function sortSubsMenu() {
    const sel = $p('podMineSort');
    if (!sel) return;
    podSheet({
      title: 'Ordenar suscripciones',
      items: [...sel.options].map(o => ({
        icon: '',
        label: o.textContent,
        checked: o.value === sel.value,
        on: () => {
          sel.value = o.value;
          try {
            localStorage.setItem('radios_viferor_podcast_mine_sort', o.value);
          } catch {}
          refreshMine();
        }
      }))
    });
  }

  /* -------------------------------------------------------------------------
     Más: Episodios, Historial, Favoritos, Estadísticas, Ajustes
  ------------------------------------------------------------------------- */
  function moreMenu() {
    podSheet({
      title: 'Podcasts',
      items: [
        { icon: ico('rss'), label: 'Episodios', hint: 'Los últimos de todas tus suscripciones', on: () => SCREENS.allEpisodes('push') },
        { icon: ico('history'), label: 'Historial de reproducción', on: () => SCREENS.history('push') },
        { icon: ico('star'), label: 'Favoritos', hint: 'Episodios y podcasts favoritos', on: () => SCREENS.favorites('push') },
        { icon: ico('lists'), label: 'Mis listas', on: () => renderPodcastLists() },
        { icon: ico('stats'), label: 'Estadísticas', on: () => SCREENS.stats('push') },
        { icon: ico('add'), label: 'Añadir podcast', on: () => window.openPodcastSearchDrawer?.() },
        { icon: ico('gear'), label: 'Ajustes', on: settingsMenu }
      ]
    });
  }
  let epFilter = 'all';
  const EP_FILTERS = {
    all: ['Todos', () => true],
    unplayed: ['Sin escuchar', e => !isEpisodeDone(e.id) && getEpisodePos(e.id) <= 5],
    progress: ['Empezados', e => !isEpisodeDone(e.id) && getEpisodePos(e.id) > 5],
    done: ['Escuchados', e => isEpisodeDone(e.id)],
    queued: ['En la cola', e => isInQueue(e)],
    favs: ['Favoritos', e => isEpFav(e)]
  };
  function renderAllEpisodes(mode) {
    go('allEpisodes', mode, root => {
      const f = EP_FILTERS[epFilter] || EP_FILTERS.all;
      root.append(
        head('Episodios', {
          back: true,
          sub: epFilter !== 'all' ? `Filtro: ${f[0]}` : '',
          extra: [{ icon: 'filter', label: 'Filtrar', on: filterMenu }],
          onMore: () =>
            podSheet({ title: 'Episodios', items: [{ icon: '🔄', label: 'Buscar episodios nuevos', on: refreshPool }] })
        })
      );
      const p = readPoolCache();
      if (!p) root.append(el('div', 'pn-loading', 'Cargando episodios…'));
      else {
        const eps = p.eps.filter(f[1]);
        if (eps.length) root.append(rowsList(eps, { showPodcast: false }));
        else root.append(emptyBox('🎙️', 'No hay episodios', epFilter !== 'all' ? 'Ninguno cumple el filtro.' : 'Comprueba tus suscripciones o la conexión.'));
      }
      if (!poolFresh()) loadPool().then(() => podcastState.screen === 'allEpisodes' && refreshMine(), () => {});
    });
  }
  function filterMenu() {
    podSheet({
      title: 'Filtrar episodios',
      items: Object.entries(EP_FILTERS).map(([k, [label]]) => ({
        icon: '',
        label,
        checked: k === epFilter,
        on: () => {
          epFilter = k;
          refreshMine();
        }
      }))
    });
  }
  function renderHistory(mode) {
    go('history', mode, root => {
      const hist = dedupeEpisodes([...podcastState.history].reverse().filter(e => !isCurrentEpisode(e)));
      root.append(
        head('Historial de reproducción', {
          back: true,
          sub: hist.length ? plural(hist.length, 'episodio', 'episodios') : '',
          onMore: () =>
            podSheet({
              title: 'Historial',
              items: [
                {
                  icon: '🗑',
                  label: 'Borrar el historial',
                  danger: true,
                  disabled: !hist.length,
                  on: () => {
                    if (!confirm('¿Borrar el historial de reproducción?')) return;
                    podcastState.history = [];
                    savePodcastHistory();
                    refreshMine();
                  }
                }
              ]
            })
        })
      );
      if (!hist.length) root.append(emptyBox('🕘', 'Sin historial', 'Aquí aparecerá lo último que hayas escuchado.'));
      else root.append(rowsList(hist));
    });
  }
  function renderFavorites(mode) {
    go('favorites', mode, root => {
      const eps = loadEpFavs();
      const pods = podcastState.favs;
      root.append(head('Favoritos', { back: true }));
      const s1 = section('Episodios favoritos', { pill: eps.length ? String(eps.length) : '' });
      if (eps.length) s1.append(rowsList(eps));
      else s1.append(el('p', 'pn-hint', 'Pulsa ☆ en el reproductor (o en el menú de un episodio) para guardarlo aquí.'));
      root.append(s1);
      const s2 = section('Podcasts favoritos', { pill: pods.length ? String(pods.length) : '' });
      if (pods.length) {
        const g = el('div', 'pod-tiles pn-grid');
        pods.forEach(p => g.append(subTile(p)));
        s2.append(g);
      } else s2.append(el('p', 'pn-hint', 'Pulsa «☆ Favorito» dentro de cualquier podcast para tenerlo aquí, estés suscrito o no.'));
      root.append(s2);
    });
  }
  function renderStats(mode) {
    go('stats', mode, root => {
      flushListen();
      const st = listenStore();
      const done = Object.keys(podcastDone()).length;
      const total = Object.values(st).reduce((s, x) => s + (Number(x?.s) || 0), 0);
      root.append(head('Estadísticas', { back: true }));
      const box = el('div', 'pn-stats');
      [
        [longLeft(total), 'escuchado con la app'],
        [String(done), 'episodios terminados'],
        [String(inProgressEpisodes().length), 'episodios empezados'],
        [String(podcastState.subs.length), 'suscripciones']
      ].forEach(([n, l]) => box.append(el('div', 'pn-stat', `<strong>${pEsc(n)}</strong><small>${pEsc(l)}</small>`)));
      root.append(box);
      const counts = getPodcastPlayCounts();
      const byKey = new Map();
      const add = (k, title, art) => {
        if (!byKey.has(k)) byKey.set(k, { k, title: title || '', art: art || '', s: 0, n: 0 });
        const x = byKey.get(k);
        if (!x.title && title) x.title = title;
        if (!x.art && art) x.art = art;
        return x;
      };
      Object.entries(st).forEach(([k, v]) => (add(k, v?.t, v?.a).s = Number(v?.s) || 0));
      Object.entries(counts).forEach(([k, n]) => (add(k).n = Number(n) || 0));
      podcastState.subs.forEach(p => {
        const k = podcastKey(p);
        if (byKey.has(k)) add(k, p.title, p.artwork || p.image);
      });
      const top = [...byKey.values()].filter(x => x.s > 60 || x.n).sort((a, b) => b.s - a.s || b.n - a.n).slice(0, 30);
      const s = section('Por podcast');
      if (!top.length) s.append(el('p', 'pn-hint', 'Aún no hay datos. El tiempo se cuenta desde esta versión.'));
      else {
        const max = Math.max(1, ...top.map(x => x.s));
        const list = el('div', 'pn-list');
        top.forEach(x => {
          const r = el(
            'div',
            'pn-row pn-stat-row',
            `${artHtml(x.art, x.title)}<div class="pn-info"><strong>${pEsc(x.title || 'Podcast')}</strong><div class="pn-time"><i class="pn-bar"><b style="width:${((x.s / max) * 100).toFixed(1)}%"></b></i><span class="pn-t">${pEsc(
              fmtLong(x.s) || (x.s ? '< 1 min' : '—')
            )}</span></div><small class="pn-meta">${x.n ? plural(x.n, 'vez', 'veces') + ' empezado' : ''}</small></div>`
          );
          list.append(r);
        });
        s.append(list);
      }
      root.append(s);
    });
  }
  function settingsMenu() {
    const o = podcastQueueOptions();
    podSheet({
      title: 'Ajustes de podcasts',
      items: [
        { icon: ico('speed'), label: 'Velocidad: ' + speedLabel(podcastSpeed()), on: openSpeedMenu },
        { icon: '⏭', label: 'Pasar al siguiente solo', checked: !!o.autoNext, on: () => toggleOpt('autoNext', settingsMenu) },
        { icon: '⤼', label: 'Saltar los ya escuchados', checked: !!o.skipDone, on: () => toggleOpt('skipDone', settingsMenu) },
        { icon: '🔁', label: 'Repetir: ' + { off: 'no', one: 'este episodio', all: 'toda la cola' }[o.repeat], on: () => cycleRepeat(settingsMenu) },
        {
          icon: '🆕',
          label: 'Al acabar la cola: ' + (o.whenEmpty === 'latest' ? 'seguir con novedades' : 'parar'),
          on: () => {
            setPodcastQueueOption('whenEmpty', o.whenEmpty === 'latest' ? 'stop' : 'latest');
            settingsMenu();
          }
        },
        {
          icon: '⏱',
          label: 'En el reproductor: ' + (podShowRemaining() ? 'tiempo que queda' : 'duración total'),
          on: () => {
            try {
              localStorage.setItem(POD_TIME_MODE_KEY, podShowRemaining() ? 'total' : 'remaining');
            } catch {}
            updatePodcastPlayerUI();
            settingsMenu();
          }
        },
        { sep: true },
        { icon: '📥', label: 'Importar lista (OPML)', on: () => $p('podcastFile')?.click() },
        { icon: '💾', label: 'Exportar lista (OPML)', disabled: !podcastState.subs.length, on: () => window.exportPodcastOPML?.() }
      ]
    });
  }

  const SCREENS = {
    landing: renderHome,
    queue: renderQueue,
    novedades: renderInbox,
    subs: renderSubs,
    allEpisodes: renderAllEpisodes,
    history: renderHistory,
    favorites: renderFavorites,
    stats: renderStats
  };
  window.pnScreens = SCREENS;

  /* -------------------------------------------------------------------------
     Notas del programa y compartir episodio
  ------------------------------------------------------------------------- */
  function notesHtml(raw) {
    let txt = String(raw || '');
    if (/<[a-z][\s\S]*>/i.test(txt)) {
      // HTML del feed → texto (sin ejecutar nada): saltos donde había párrafos.
      const doc = new DOMParser().parseFromString(
        txt.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n\n'),
        'text/html'
      );
      txt = doc.body.textContent || '';
    } else txt = decodePodcastEntities(txt);
    txt = txt.replace(/\n{3,}/g, '\n\n').trim();
    return pEsc(txt).replace(/https?:\/\/[^\s<>"']+/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  }
  async function showNotes(e) {
    if (!e) return;
    const body = el('div', 'pn-notes');
    const meta = [e.podcastTitle, shortEpDate(e.date), episodeTimeText(e)].filter(Boolean).join(' · ');
    body.innerHTML = `<p class="pn-notes-meta">${pEsc(meta)}</p><div class="pn-notes-text">${e.description ? notesHtml(e.description) : '<em>Cargando notas…</em>'}</div>`;
    podSheet({ title: e.title || 'Episodio', body, cancel: 'Cerrar' });
    if (e.description || !e.feedUrl) {
      if (!e.description) body.querySelector('.pn-notes-text').innerHTML = '<em>Este episodio no tiene notas.</em>';
      return;
    }
    try {
      const eps = await fetchFeedEpisodes({ feedUrl: e.feedUrl, title: e.podcastTitle }, 0);
      const f = eps.find(x => (e.id && String(x.id) === String(e.id)) || epKey(x) === epKey(e) || x.audioUrl === e.audioUrl);
      if (f?.description) e.description = f.description;
    } catch {}
    const t = body.querySelector('.pn-notes-text');
    if (t) t.innerHTML = e.description ? notesHtml(e.description) : '<em>Este episodio no tiene notas.</em>';
  }
  window.pnShowNotes = showNotes;
  function shareEpisode(e) {
    if (!e) return;
    const url = String(e.pageUrl || e.link || e.audioUrl || '');
    const title = `${e.title || 'Episodio'}${e.podcastTitle ? ' — ' + e.podcastTitle : ''}`;
    if (!url) return podToast('Este episodio no tiene enlace para compartir');
    try {
      if (typeof window.Android?.sharePodcast === 'function') return window.Android.sharePodcast(title, url);
    } catch {}
    if (navigator.share) return navigator.share({ title, url }).catch(() => {});
    try {
      navigator.clipboard.writeText(url).then(() => podToast('Enlace copiado'), () => alert(url));
    } catch {
      alert(url);
    }
  }

  /* -------------------------------------------------------------------------
     Reproductor ampliado
  ------------------------------------------------------------------------- */
  function syncExpandedExtras() {
    const e = podcastState.current;
    const fav = $p('pnExpFav');
    if (fav) {
      const on = !!e && isEpFav(e);
      fav.innerHTML = ico(on ? 'star' : 'starOff');
      fav.classList.toggle('on', on);
      fav.setAttribute('aria-label', on ? 'Quitar de favoritos' : 'Añadir a favoritos');
    }
    const sp = $p('pnExpSpeedVal');
    if (sp) sp.textContent = podcastSpeed().toFixed(2).replace('.', ',');
    $p('pnExpSpeed')?.classList.toggle('on', podcastSpeed() !== 1);
    const sl = $p('pnExpSleep');
    if (sl) {
      const on = !!(podSleep.until || podSleep.end);
      sl.classList.toggle('on', on);
      sl.title = podSleep.end ? 'Se parará al terminar el episodio' : podSleep.until ? 'Se parará en ' + fmtPodTime((podSleep.until - Date.now()) / 1000) : 'Temporizador para dormir';
    }
    const sub = $p('podExpandedSub');
    if (sub && e) sub.textContent = [e.podcastTitle || e.author, shortEpDate(e.date)].filter(Boolean).join('  •  ');
  }
  function expandedMenu() {
    const e = podcastState.current;
    if (!e) return;
    const a = audio();
    const vol = Math.round((a?.volume ?? 0.8) * 100);
    const body = el(
      'label',
      'pn-vol',
      `<span>Volumen</span><input type="range" min="0" max="100" step="1" value="${vol}" aria-label="Volumen"><output>${vol}%</output>`
    );
    const r = body.querySelector('input');
    r.oninput = () => {
      setPodcastVolume(r.value);
      body.querySelector('output').textContent = r.value + '%';
    };
    podSheet({
      title: e.title || 'Episodio',
      subtitle: e.podcastTitle || '',
      items: [
        { icon: '☰', label: 'Ver la cola', hint: podcastState.queue.length ? plural(podcastState.queue.length, 'episodio', 'episodios') : 'Vacía', on: () => {
          closePodcastExpanded();
          tab('queue');
        } },
        { icon: '🎙️', label: 'Ir al podcast', disabled: !e.feedUrl, on: () => {
          closePodcastExpanded();
          goToPodcastOf(e);
        } },
        { icon: '📃', label: 'Añadir a una lista…', on: () => chooseListFor([e]) },
        { icon: '⏮', label: 'Episodio anterior', on: previousPodcast },
        { icon: '✓', label: 'Marcar como escuchado y pasar al siguiente', on: () => {
          markEpisodeDone(e.id);
          clearEpisodePos(e.id);
          nextPodcast(false);
        } }
      ],
      body
    });
  }

  /* -------------------------------------------------------------------------
     Refrescos en directo (▶/⏸ y progreso de las filas)
  ------------------------------------------------------------------------- */
  function syncPlayButtons() {
    const k = podcastState.current ? epKey(podcastState.current) : '';
    const playing = !!k && !audio()?.paused;
    document.querySelectorAll('#podcastContent .pn-play').forEach(b => {
      const on = playing && b.dataset.ep === k;
      if (b.classList.contains('on') === on) return;
      b.classList.toggle('on', on);
      b.innerHTML = ico(on ? 'pause' : 'play');
      b.setAttribute('aria-label', on ? 'Pausar' : 'Reproducir');
    });
  }
  let lastRowTick = 0;
  function tickRows() {
    const now = Date.now();
    if (now - lastRowTick < 1000) return;
    lastRowTick = now;
    const e = podcastState.current;
    if (!e || !podcastsViewActive()) return;
    const k = epKey(e);
    document.querySelectorAll(`#podcastContent .pn-row[data-ep="${CSS.escape(k)}"] .pn-time`).forEach(t => (t.innerHTML = timeLine(e)));
    const { pos, dur } = posDur(e);
    if (dur)
      document.querySelectorAll(`#podcastContent .pn-card[data-ep="${CSS.escape(k)}"] .pn-card-bar b`).forEach(b => (b.style.width = Math.min(100, (pos / dur) * 100).toFixed(1) + '%'));
  }

  /* -------------------------------------------------------------------------
     Sustituir las pantallas antiguas
  ------------------------------------------------------------------------- */
  // Portada → Inicio; «Mis suscripciones» → Suscripciones; Cola → Cola.
  window.renderPodcastLanding = fromHistory => renderHome(fromHistory ? 'none' : 'push');
  window.renderPodcastHome = (fromHistory = false, inline = false) =>
    inline ? renderHome(fromHistory ? 'none' : 'push') : renderSubs(fromHistory ? 'none' : 'push');
  window.renderPodcastQueue = fromHistory => renderQueue(fromHistory ? 'none' : 'push');
  window.rerenderPodcastHome = () => refreshMine();

  // La vista de un podcast conserva su cabecera, pero los episodios van en filas.
  const origEpisodesView = renderEpisodesView;
  window.renderEpisodesView = function (favItem, eps) {
    const saved = window.podcastCard;
    window.podcastCard = (p, episode) => (episode ? row(p) : saved(p, episode));
    try {
      origEpisodesView(favItem, eps);
    } finally {
      window.podcastCard = saved;
    }
    content().querySelector('.pod-episodes')?.classList.add('pn-list');
    syncNav();
  };

  // Atrás / adelante del historial con las pantallas nuevas.
  const origRestore = restorePodcastHistory;
  window.restorePodcastHistory = function (st) {
    const s = st?.podcastScreen || 'landing';
    if (SCREENS[s]) {
      if (!podcastsViewActive()) switchToPodcasts(true);
      return SCREENS[s]('none');
    }
    origRestore(st);
    syncNav();
  };

  // Marcar como escuchado, etc. vuelve a pintar también las pantallas nuevas.
  const origRefresh = refreshPodcastScreen;
  window.refreshPodcastScreen = function () {
    const s = podcastState.screen || '';
    if (SCREENS[s] && s !== 'queue') return refreshMine();
    return origRefresh();
  };

  // Menú de cualquier episodio: + notas y favorito.
  const origEpisodeMenu = openEpisodeMenu;
  window.openEpisodeMenu = function (e, opts = {}) {
    const fav = isEpFav(e);
    const extra = [
      { icon: ico('info'), label: 'Notas del episodio', on: () => showNotes(e) },
      { icon: ico(fav ? 'star' : 'starOff'), label: fav ? 'Quitar de favoritos' : 'Añadir a favoritos', on: () => toggleEpFav(e) },
      { icon: ico('share'), label: 'Compartir episodio', on: () => shareEpisode(e) },
      ...(opts.extra || [])
    ];
    return origEpisodeMenu(e, { ...opts, extra });
  };

  // Datos del reproductor ampliado (☆, velocidad, temporizador, «podcast • fecha»).
  const origNowUI = setPodcastNowUI;
  window.setPodcastNowUI = function (e) {
    origNowUI(e);
    syncExpandedExtras();
  };
  const origExtras = updatePlayerExtras;
  window.updatePlayerExtras = function () {
    origExtras();
    syncExpandedExtras();
  };
  // El contador de Novedades se actualiza cuando cambian las suscripciones.
  const origSaveSubs = savePodcastSubs;
  window.savePodcastSubs = function () {
    const r = origSaveSubs.apply(this, arguments);
    updateBadge();
    return r;
  };

  // Sabe en qué pantalla estás para marcar la pestaña de la barra inferior.
  let screenVal = podcastState.screen;
  try {
    Object.defineProperty(podcastState, 'screen', {
      configurable: true,
      enumerable: true,
      get: () => screenVal,
      set: v => {
        screenVal = v;
        queueMicrotask(syncNav);
      }
    });
  } catch {}

  /* -------------------------------------------------------------------------
     Arranque
  ------------------------------------------------------------------------- */
  function init() {
    document.body.classList.add('pod-nav');
    document.querySelectorAll('#pnNav [data-tab]').forEach(b => (b.onclick = () => tab(b.dataset.tab)));
    // ＋ flotante de Suscripciones (como en AntennaPod), encima del mini reproductor.
    const fab = el('button', 'pn-fab pn-fab-fixed', ico('add'));
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Añadir podcast');
    fab.onclick = () => window.openPodcastSearchDrawer?.();
    $p('viewPodcasts')?.append(fab);
    $p('pnExpFav')?.addEventListener('click', () => toggleEpFav(podcastState.current));
    $p('pnExpSleep')?.addEventListener('click', openSleepMenu);
    $p('pnExpShare')?.addEventListener('click', () => shareEpisode(podcastState.current));
    $p('pnExpMore')?.addEventListener('click', expandedMenu);
    $p('pnExpNotes')?.addEventListener('click', () => showNotes(podcastState.current));
    $p('pnExpSpeed')?.addEventListener('click', openSpeedMenu);
    const a = audio();
    if (a) {
      ['play', 'pause', 'playing', 'emptied'].forEach(ev => a.addEventListener(ev, syncPlayButtons));
      a.addEventListener('timeupdate', () => {
        trackListen();
        tickRows();
      });
      a.addEventListener('play', () => (lastTick = Date.now()));
      a.addEventListener('pause', flushListen);
      a.addEventListener('ended', () => {
        updateBadge();
        if (['landing', 'novedades', 'allEpisodes'].includes(podcastState.screen)) setTimeout(refreshMine, 300);
      });
    }
    setInterval(flushListen, 20000);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushListen());
    document.addEventListener('podcasts:queue-changed', () => {
      updateBadge();
      if (podDragging) return;
      // En Inicio/Novedades, lo que entra en la cola sale de las novedades.
      if (['novedades', 'landing'].includes(podcastState.screen) && podcastsViewActive()) refreshMine();
    });
    document.addEventListener('podcasts:subscriptions-changed', updateBadge);
    syncExpandedExtras();
    syncNav();
    // Los episodios nuevos se buscan en segundo plano poco después de abrir la app.
    setTimeout(() => {
      if (podcastState.subs.length && !poolFresh()) loadPool().catch(() => {});
    }, 4000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
