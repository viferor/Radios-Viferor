// Letras de «Mi música» (1.18.0): ver, sincronizar, traducir y entender.
//
// De dónde sale la letra (por orden):
//   1. Tu versión (la que pegaste, elegiste o sincronizaste) → localStorage, entra en el backup.
//   2. La incrustada en el archivo (ID3 USLT / ©lyr), leída con jsmediatags.
//   3. Un .lrc con el mismo nombre al lado de la canción (solo en el navegador).
//   4. LRCLIB, base de datos abierta (vía /api/lyrics), con caché en IndexedDB.
// Traducción: /api/translate (línea a línea). Significado: /api/song-meaning (IA).

const LYR_USER_KEY = 'radios_viferor_lyrics_user_v1';
const LYR_AI_KEY = 'radios_viferor_ai_key_v1';
const LYR_UI_KEY = 'radios_viferor_lyrics_ui_v1';
const LYR_REACTION = 0.2; // segundos que se descuentan al marcar (tiempo de reacción)

function lyrKey(t) {
  return mNorm(trackArtist(t)) + '|' + mNorm(t.title);
}
function lyrUserAll() {
  return lsGet(LYR_USER_KEY, {});
}
function lyrUserGet(t) {
  return lyrUserAll()[lyrKey(t)] || null;
}
function lyrUserSet(t, patch) {
  const all = lyrUserAll();
  const k = lyrKey(t);
  const v = { ...(all[k] || {}), ...patch, at: Date.now() };
  Object.keys(v).forEach(x => v[x] === undefined && delete v[x]);
  all[k] = v;
  if (!lsSet(LYR_USER_KEY, all)) podToast('⚠️ No se pudo guardar: el almacenamiento está lleno');
}
function lyrUserDelete(t, field = null) {
  const all = lyrUserAll();
  const k = lyrKey(t);
  if (!all[k]) return;
  if (field) delete all[k][field];
  else delete all[k];
  if (field && !Object.keys(all[k]).some(x => x !== 'at')) delete all[k];
  lsSet(LYR_USER_KEY, all);
}
function lyrHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/* ---------------------------------------------------------------------------
   LRC
--------------------------------------------------------------------------- */
const LRC_TIME = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
function parseLyrics(raw) {
  const text = String(raw || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  let offset = 0;
  const m = text.match(/^\[offset:\s*([+-]?\d+)\s*\]/im);
  if (m) offset = Number(m[1]) / 1000;
  const timed = [];
  let anyTime = false;
  text.split('\n').forEach(line => {
    const times = [];
    let mm;
    LRC_TIME.lastIndex = 0;
    while ((mm = LRC_TIME.exec(line))) times.push(Number(mm[1]) * 60 + Number(mm[2].replace(':', '.')));
    if (times.length) {
      anyTime = true;
      const body = line.replace(LRC_TIME, '').replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim();
      times.forEach(tt => timed.push({ t: tt, text: body }));
    } else if (!/^\[[a-z]+:.*\]$/i.test(line.trim())) timed.push({ t: null, text: line.trim() });
  });
  if (anyTime) {
    const lines = timed.filter(l => l.t != null).sort((a, b) => a.t - b.t);
    return { synced: true, lines, offset };
  }
  // Texto normal: sin líneas vacías al principio/final ni dobles.
  const lines = [];
  timed.forEach(l => {
    if (!l.text && (!lines.length || !lines.at(-1).text)) return;
    lines.push({ t: null, text: l.text });
  });
  while (lines.length && !lines.at(-1).text) lines.pop();
  return { synced: false, lines, offset };
}
function fmtLrcTime(sec) {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}
function toLrc(t, lines, offset = 0) {
  const head = [`[ti:${t.title}]`, t.artist && `[ar:${t.artist}]`, t.album && `[al:${t.album}]`, offset ? `[offset:${Math.round(offset * 1000)}]` : '', '[by:Radios Viferor]'].filter(Boolean);
  return head.concat(lines.filter(l => l.t != null).map(l => `[${fmtLrcTime(l.t)}]${l.text}`)).join('\n') + '\n';
}

/* ---------------------------------------------------------------------------
   Fuentes
--------------------------------------------------------------------------- */
async function lyrEmbedded(t) {
  try {
    let blob = null;
    if (!t.src) {
      const h = musicState.files.get(t.id);
      blob = h instanceof File ? h : await h?.getFile();
    } else {
      // App Android: solo la etiqueta ID3 del principio del archivo (mp3).
      const head = await fetch(t.src, { headers: { Range: 'bytes=0-9' } });
      const b = new Uint8Array(await head.arrayBuffer());
      if (!(b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33)) return '';
      const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
      if (size > 12e6) return '';
      const r = await fetch(t.src, { headers: { Range: `bytes=0-${size + 10 + 2047}` } });
      const buf = await r.arrayBuffer();
      if (buf.byteLength > 20e6) return '';
      blob = new Blob([buf], { type: 'audio/mpeg' });
    }
    if (!blob) return '';
    const lib = await loadTagLib();
    const tags = await readTags(lib, blob);
    const ly = tags?.lyrics;
    return String(typeof ly === 'string' ? ly : ly?.lyrics || '').trim();
  } catch {
    return '';
  }
}
async function lyrSidecar(t) {
  const map = musicState.lrcFiles;
  if (!map || !map.size || !t.id.startsWith('f:')) return '';
  const rel = t.id.slice(2);
  const cands = [stripExt(rel), stripExt(rel.split('/').slice(1).join('/'))].map(mNorm);
  for (const k of cands) {
    const h = map.get(k);
    if (h) {
      try {
        const f = h instanceof File ? h : await h.getFile();
        return await f.text();
      } catch {}
    }
  }
  return '';
}
// Consulta de letras: primero nuestro servidor (/api/lyrics, con caché); si falla o
// tarda, se pregunta a LRCLIB directamente desde el móvil/navegador (admite CORS).
const LRC_DIRECT = 'https://lrclib.net/api';
const lrcSig = ms => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
function lrcNorm(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
function lrcSimplify(t) {
  return String(t ?? '')
    .replace(/\s*[([](feat\.?|ft\.?|with|con)\s[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+(\d{4}\s+)?(remaster(ed)?|live|en directo|mono|stereo|radio edit|single version|versi[oó]n).*$/i, '')
    .replace(/\s*[([](\d{4}\s+)?(remaster(ed)?|live|en directo|mono|stereo|radio edit|single version|bonus track|explicit)[^)\]]*[)\]]/gi, '')
    .trim();
}
function lrcPickBest(items, { artist = '', title = '', duration = 0 } = {}) {
  const a = lrcNorm(artist),
    t = lrcNorm(lrcSimplify(title));
  let best = null,
    bs = -1e9;
  for (const x of items || []) {
    if (!x || !(x.syncedLyrics || x.plainLyrics || x.instrumental)) continue;
    const xa = lrcNorm(x.artistName),
      xt = lrcNorm(lrcSimplify(x.trackName));
    let sc = t && xt === t ? 40 : t && (xt.includes(t) || t.includes(xt)) ? 20 : -30;
    sc += a ? (xa === a || xa.includes(a) || a.includes(xa) ? 30 : -20) : 0;
    if (x.syncedLyrics) sc += 15;
    if (duration && x.duration) {
      const d = Math.abs(x.duration - duration);
      sc += d <= 2 ? 15 : d <= 5 ? 8 : d <= 15 ? 0 : -15;
    }
    if (sc > bs) (bs = sc), (best = x);
  }
  return bs >= 30 ? best : null;
}
const lrcShape = x =>
  x
    ? { found: true, id: x.id, trackName: x.trackName || '', artistName: x.artistName || '', albumName: x.albumName || '', duration: Number(x.duration) || 0, instrumental: !!x.instrumental, synced: x.syncedLyrics || '', plain: x.plainLyrics || '', source: 'lrclib' }
    : { found: false };
async function lrcDirect(path, params = {}) {
  const u = new URL(LRC_DIRECT + path);
  Object.entries(params).forEach(([k, v]) => v !== '' && v != null && u.searchParams.set(k, String(v)));
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(u, { signal: lrcSig(15000) });
      if (r.status === 404) return null;
      if (r.ok) return await r.json();
      if (r.status !== 429 && r.status < 500) throw Error('LRCLIB ' + r.status);
    } catch (e) {
      if (i) throw Error(e?.name === 'TimeoutError' ? 'LRCLIB tarda demasiado' : 'LRCLIB no responde');
    }
    await new Promise(r => setTimeout(r, 800));
  }
  throw Error('LRCLIB no responde');
}
async function lrcDirectQuery(q) {
  if (q.id) return lrcShape(await lrcDirect('/get/' + q.id));
  const title = lrcSimplify(q.title);
  if (q.search) {
    const lists = await Promise.allSettled([lrcDirect('/search', { track_name: title, artist_name: q.artist }), q.artist ? lrcDirect('/search', { q: `${q.artist} ${title}` }) : null]);
    if (lists.every(x => x.status === 'rejected')) throw lists[0].reason;
    const seen = new Set();
    const items = lists
      .flatMap(x => (x.status === 'fulfilled' && x.value) || [])
      .filter(x => x && !seen.has(x.id) && seen.add(x.id))
      .slice(0, 40)
      .map(x => ({ id: x.id, trackName: x.trackName, artistName: x.artistName, albumName: x.albumName, duration: x.duration, instrumental: !!x.instrumental, hasSynced: !!x.syncedLyrics, hasPlain: !!x.plainLyrics }));
    return { items };
  }
  const tries = [];
  if (q.artist && q.album && q.duration) tries.push(() => lrcDirect('/get', { artist_name: q.artist, track_name: q.title, album_name: q.album, duration: q.duration }).then(x => (x ? [x] : [])));
  if (q.artist) tries.push(() => lrcDirect('/search', { track_name: title, artist_name: q.artist }));
  tries.push(() => lrcDirect('/search', { q: `${q.artist || ''} ${title}`.trim() }));
  let err = null,
    ok = 0;
  for (const f of tries) {
    try {
      const hit = lrcPickBest(await f(), q);
      ok++;
      if (hit) return lrcShape(hit);
    } catch (e) {
      err = e;
    }
  }
  if (!ok && err) throw err;
  return { found: false };
}
// q: { id } | { artist, title, album, duration, search }
async function lyricsQuery(q) {
  const u = new URL('/api/lyrics', location.origin);
  if (q.id) u.searchParams.set('id', q.id);
  else {
    if (q.search) u.searchParams.set('search', '1');
    u.searchParams.set('artist', q.artist || '');
    u.searchParams.set('title', q.title || '');
    if (q.album) u.searchParams.set('album', q.album);
    if (q.duration) u.searchParams.set('duration', q.duration);
  }
  let first;
  try {
    const r = await fetch(u, { signal: lrcSig(25000) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) return d;
    first = Error(d.error || 'No se pudo buscar la letra');
  } catch (e) {
    first = e;
  }
  try {
    return await lrcDirectQuery(q);
  } catch (e) {
    throw Error(e?.message || first?.message || 'No se pudo buscar la letra');
  }
}
async function lyrOnline(t, force = false) {
  const ck = 'l|' + lyrKey(t);
  const c = !force && (await idbGet('lyrics', ck));
  // Lo no encontrado se vuelve a buscar al día siguiente.
  if (c && (c.found || Date.now() - c.at < 86400000)) return c;
  const d = await lyricsQuery({ artist: t.artist || '', title: t.title || '', album: t.album || '', duration: t.dur ? Math.round(t.dur) : 0 });
  const v = { found: !!d.found, id: d.id, synced: d.synced || '', plain: d.plain || '', instrumental: !!d.instrumental, at: Date.now() };
  idbPut('lyrics', ck, v);
  return v;
}
// Devuelve { lines, synced, offset, source, label, raw, instrumental, lrclibId }
async function loadLyrics(t, { force = false } = {}) {
  const user = lyrUserGet(t);
  const offsetOverride = user && typeof user.offset === 'number' ? user.offset : null;
  const done = (raw, source, label, extra = {}) => {
    const p = parseLyrics(raw);
    return { ...p, offset: offsetOverride ?? p.offset, raw, source, label, ...extra };
  };
  if (user?.text) return done(user.text, 'user', user.source === 'lrclib' ? 'Versión elegida de LRCLIB' : user.source === 'sync' ? 'Sincronizada por ti' : 'Tu versión', { lrclibId: user.lrclibId });
  const emb = await lyrEmbedded(t);
  if (emb) return done(emb, 'file', 'Letra guardada en el archivo');
  const side = await lyrSidecar(t);
  if (side) return done(side, 'lrc', 'Archivo .lrc junto a la canción');
  const on = await lyrOnline(t, force);
  if (on.instrumental) return { lines: [], synced: false, offset: 0, source: 'lrclib', label: 'LRCLIB', instrumental: true, raw: '' };
  if (on.found && (on.synced || on.plain)) return done(on.synced || on.plain, 'lrclib', 'Letra de LRCLIB', { lrclibId: on.id });
  return { lines: [], synced: false, offset: offsetOverride || 0, source: 'none', label: '', raw: '' };
}

/* ---------------------------------------------------------------------------
   Estado y panel
--------------------------------------------------------------------------- */
const lyr = { track: null, data: null, loading: false, error: '', mode: 'orig', trans: null, transLoading: false, transError: '', meaning: null, meaningOpen: false, meaningLoading: false, meaningError: '', sync: null, adj: null, cur: -1, userScrollAt: 0, raf: 0, token: 0 };
function lyrUi() {
  return { mode: 'orig', ...lsGet(LYR_UI_KEY, {}) };
}
function buildLyricsPanel() {
  if ($m('lyrPanel')) return;
  const p = musEl(
    'div',
    'lyr-panel',
    `<div class="lyr-head"><button type="button" class="lyr-close" aria-label="Cerrar la letra">←</button><div class="lyr-title"><strong id="lyrTitle"></strong><small id="lyrSub"></small></div><button type="button" class="lyr-more" aria-label="Opciones de la letra">⋯</button></div>
     <div class="lyr-modes" role="tablist"><button type="button" data-mode="orig">🎤 Letra</button><button type="button" data-mode="trans">🌐 Original + español</button><button type="button" data-mode="meaning">💡 Significado</button></div>
     <div class="lyr-body" id="lyrBody"></div>
     <div class="lyr-guide" id="lyrGuide" hidden><span>▶</span></div>
     <div class="lyr-foot" id="lyrFoot"></div>`
  );
  p.id = 'lyrPanel';
  p.hidden = true;
  p.setAttribute('role', 'dialog');
  p.setAttribute('aria-label', 'Letra de la canción');
  document.body.append(p);
  p.querySelector('.lyr-close').onclick = () => closeLyricsPanel();
  p.querySelector('.lyr-more').onclick = lyricsMenu;
  p.querySelectorAll('[data-mode]').forEach(b => (b.onclick = () => setLyricsMode(b.dataset.mode)));
  const body = $m('lyrBody');
  ['wheel', 'touchmove'].forEach(ev => body.addEventListener(ev, () => (lyr.userScrollAt = Date.now()), { passive: true }));
  initDragAdjust(body);
  document.addEventListener('keydown', e => {
    if (p.hidden || !lyr.sync) return;
    if ((e.key === ' ' || e.key === 'Enter') && !e.target.closest('input,textarea,select')) {
      e.preventDefault();
      syncMark();
    }
  });
}
function openLyrics(t) {
  t = t || musicState.current;
  if (!t) return podToast('No hay ninguna canción');
  buildLyricsPanel();
  const p = $m('lyrPanel');
  p.hidden = false;
  document.body.classList.add('lyr-open');
  lyr.mode = lyrUi().mode;
  if (!lyr.track || lyr.track.id !== t.id || !lyr.data) loadLyricsFor(t);
  else renderLyrics();
  startLyricsLoop();
}
window.openLyrics = openLyrics;
// Desde el menú ⋯ de una canción: si es la que suena, la letra seguirá a la siguiente.
window.openTrackLyrics = t => {
  lyr.followCurrent = musicState.current?.id === t.id;
  openLyrics(t);
};
function closeLyricsPanel() {
  const p = $m('lyrPanel');
  if (!p || p.hidden) return false;
  if (lyr.sync && lyr.sync.marked > 0 && !confirm('¿Salir sin guardar la sincronización?')) return true;
  // Atrás durante el ajuste: se guarda y se vuelve a la letra normal.
  if (lyr.adj) {
    finishDragAdjust(true);
    return true;
  }
  lyr.sync = null;
  lyr.adj = null;
  p.hidden = true;
  document.body.classList.remove('lyr-open');
  cancelAnimationFrame(lyr.raf);
  return true;
}
window.closeLyricsPanel = closeLyricsPanel;
async function loadLyricsFor(t, opts = {}) {
  const tok = ++lyr.token;
  Object.assign(lyr, { track: t, data: null, adj: null, loading: true, error: '', trans: null, transError: '', meaning: null, meaningOpen: false, meaningLoading: false, meaningError: '', sync: null, cur: -1 });
  renderLyrics();
  try {
    const d = await loadLyrics(t, opts);
    if (tok !== lyr.token) return;
    lyr.data = d;
  } catch (e) {
    if (tok !== lyr.token) return;
    lyr.error = e?.message || 'No se pudo buscar la letra';
  }
  lyr.loading = false;
  renderLyrics();
  if (lyr.mode === 'trans') ensureTranslation();
  if (lyr.mode === 'meaning') openMeaning();
}
function setLyricsMode(mode) {
  lyr.mode = mode;
  if (mode === 'meaning') lyr.adj = null;
  lsSet(LYR_UI_KEY, { ...lyrUi(), mode });
  renderLyrics();
  if (mode === 'trans') ensureTranslation();
  if (mode === 'meaning') openMeaning();
}
function isLyrTrackPlaying() {
  return !!lyr.track && musicState.current?.id === lyr.track.id;
}

/* ---------------------------------------------------------------------------
   Pintar
--------------------------------------------------------------------------- */
function renderLyrics() {
  const p = $m('lyrPanel');
  if (!p) return;
  const t = lyr.track;
  $m('lyrTitle').textContent = t?.title || '';
  $m('lyrSub').textContent = t ? trackSub(t) : '';
  p.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === lyr.mode && !lyr.sync));
  p.querySelector('.lyr-modes').hidden = !!lyr.sync;
  const body = $m('lyrBody'),
    foot = $m('lyrFoot');
  body.replaceChildren();
  foot.replaceChildren();
  lyr.cur = -1;
  const adjusting = !!(lyr.adj && !lyr.sync && lyr.mode !== 'meaning' && lyr.data?.synced && lyr.data.lines.length);
  if (!adjusting) lyr.adj = null;
  body.classList.toggle('lyr-adjusting', adjusting);
  $m('lyrGuide').hidden = !adjusting;
  if (lyr.sync) return renderSyncEditor(body, foot);
  if (lyr.loading) return body.append(musEl('div', 'lyr-msg', `<div class="lyr-spin"></div>${lyr.mode === 'meaning' ? 'Buscando la letra para explicar mejor la canción…' : 'Buscando la letra…'}`));
  // El significado no depende de tener la letra: con título y artista basta.
  if (lyr.mode === 'meaning' && (lyr.error || !lyr.data?.lines?.length)) {
    body.append(renderMeaningCard());
    body.append(musEl('p', 'lyr-ai-note', lyr.data?.instrumental ? 'Es una pieza instrumental: la explicación se basa en lo que se sabe de ella.' : 'Sin letra: la explicación se basa en el título, el artista y lo que se sabe de la canción.'));
    return;
  }
  if (lyr.error) {
    body.append(musEl('div', 'lyr-msg', `⚠️ ${pEsc(lyr.error)}`));
    return body.append(lyrButtons([['🔄 Reintentar', () => loadLyricsFor(t, { force: true }), 'primary'], ['💡 Ver el significado', () => setLyricsMode('meaning')]]));
  }
  const d = lyr.data;
  if (lyr.mode === 'meaning') {
    return body.append(renderMeaningCard());
  }
  if (d?.instrumental) {
    body.append(musEl('div', 'lyr-msg', '🎼 Es una pieza instrumental: no tiene letra.'));
    return body.append(lyrButtons([['🔎 Buscar otra versión', searchOtherLyrics], ['💡 Ver el significado', () => setLyricsMode('meaning')]]));
  }
  if (!d || !d.lines.length) {
    body.append(musEl('div', 'lyr-msg', 'No se ha encontrado la letra de esta canción.'));
    return body.append(
      lyrButtons([
        ['🔎 Buscar otra versión', searchOtherLyrics, 'primary'],
        ['🌐 Buscar en internet', () => searchLyricsWeb(t)],
        ['✏️ Escribir o pegar la letra', editLyrics],
        ['💡 Ver el significado', () => setLyricsMode('meaning')]
      ])
    );
  }
  if (lyr.mode === 'trans') body.append(renderTransTop());
  const showTr = lyr.mode === 'trans' && lyr.trans && lyr.trans.lang !== 'es';
  const list = musEl('div', 'lyr-lines' + (d.synced ? ' synced' : '') + (showTr ? ' with-tr' : ''));
  d.lines.forEach((l, i) => {
    const row = musEl('div', 'lyr-line' + (l.text ? '' : ' gap'));
    row.dataset.i = i;
    row.innerHTML = `<span class="o">${pEsc(l.text || (d.synced ? '♪' : ''))}</span>${showTr && l.text ? `<span class="tr">${pEsc(lyr.trans.lines[i] || '')}</span>` : ''}`;
    if (d.synced) row.onclick = () => seekToLine(i);
    list.append(row);
  });
  body.append(list);
  if (adjusting) {
    renderAdjustFoot(foot);
    placeLyrGuide();
    lyr.adj.progTop = -1;
    return;
  }
  // Pie: de dónde viene y sincronización.
  foot.append(musEl('span', 'lyr-src', pEsc(d.label + (d.synced ? ' · ⏱ sincronizada' : ' · sin sincronizar') + (d.offset ? ` · desfase ${d.offset > 0 ? '+' : ''}${d.offset.toFixed(1).replace('.', ',')} s` : ''))));
  const mine = d.source === 'user' && !lyrUserGet(lyr.track)?.published;
  foot.append(
    lyrButtons(
      d.synced
        ? [['↕️ Ajustar arrastrando', startDragAdjust, 'primary'], ['⇆ Desfase', offsetMenu], ['⏱ Volver a sincronizar', startSync], ...(mine ? [['📤 Compartir', () => shareToLrclib(lyr.track)]] : [])]
        : [['⏱ Sincronizar', startSync, 'primary'], ['🔎 Buscar versión sincronizada', searchOtherLyrics]]
    )
  );
  lyr.userScrollAt = 0;
  updateLyricsHighlight(true);
}
function lyrButtons(list) {
  const box = musEl('div', 'lyr-btns');
  list.forEach(([label, fn, cls]) => {
    const b = musEl('button', cls || '', pEsc(label));
    b.type = 'button';
    b.onclick = fn;
    box.append(b);
  });
  return box;
}
function renderTransTop() {
  const box = musEl('div', 'lyr-trans-top');
  if (lyr.transLoading) box.append(musEl('p', 'lyr-note', 'Traduciendo…'));
  else if (lyr.transError) {
    box.append(musEl('p', 'lyr-note warn', `⚠️ ${pEsc(lyr.transError)}`));
    box.append(lyrButtons([['🔄 Reintentar la traducción', () => ensureTranslation(true)]]));
  } else if (lyr.trans?.lang === 'es') box.append(musEl('p', 'lyr-note', 'La letra ya está en español.'));
  else if (lyr.trans) box.append(musEl('p', 'lyr-note', `Traducido del ${langName(lyr.trans.lang)} · traducción automática`));
  return box;
}
function langName(code) {
  try {
    return new Intl.DisplayNames(['es'], { type: 'language' }).of(code) || code;
  } catch {
    return code || 'otro idioma';
  }
}

/* ---------------------------------------------------------------------------
   Línea actual (sincronizada)
--------------------------------------------------------------------------- */
function startLyricsLoop() {
  cancelAnimationFrame(lyr.raf);
  const tick = () => {
    if ($m('lyrPanel')?.hidden) return;
    if (lyr.sync) updateSyncClock();
    else {
      updateLyricsHighlight(false);
      if (lyr.adj) adjustTick();
    }
    lyr.raf = requestAnimationFrame(tick);
  };
  lyr.raf = requestAnimationFrame(tick);
}
function updateLyricsHighlight(force) {
  const d = lyr.data;
  if (!d?.synced || !isLyrTrackPlaying()) return;
  const a = musicAudio();
  const now = (Number(a?.currentTime) || 0) + (d.offset || 0);
  let i = -1;
  for (let k = 0; k < d.lines.length; k++) {
    if (d.lines[k].t <= now) i = k;
    else break;
  }
  if (i === lyr.cur && !force) return;
  lyr.cur = i;
  const rows = document.querySelectorAll('#lyrBody .lyr-line');
  rows.forEach((r, k) => {
    r.classList.toggle('now', k === i);
    r.classList.toggle('past', k < i);
  });
  // Con el significado abierto no se desplaza sola (si no, lo sacaría de la vista).
  if (i >= 0 && !lyr.adj && lyr.mode !== 'meaning' && Date.now() - lyr.userScrollAt > 4000) rows[i]?.scrollIntoView({ block: 'center', behavior: force ? 'auto' : 'smooth' });
}
function seekToLine(i) {
  const d = lyr.data;
  if (!d?.synced || lyr.adj) return;
  if (!isLyrTrackPlaying()) {
    playTrackNow(lyr.track);
    return;
  }
  const a = musicAudio();
  a.currentTime = Math.max(0, d.lines[i].t - (d.offset || 0) + 0.01);
  if (a.paused) toggleMusicPlay();
  lyr.userScrollAt = 0;
}

/* ---------------------------------------------------------------------------
   Ajustar arrastrando: mientras suena, se arrastra la letra hasta que la línea
   que queda junto a la guía (▶) sea la que se oye. Cambia el desfase en vivo.
--------------------------------------------------------------------------- */
function startDragAdjust() {
  const d = lyr.data;
  if (!d?.synced || !d.lines.length) return podToast('Primero hace falta una letra sincronizada');
  if (lyr.mode === 'meaning') {
    lyr.mode = 'orig';
    lsSet(LYR_UI_KEY, { ...lyrUi(), mode: 'orig' });
  }
  if (!isLyrTrackPlaying()) playTrackNow(lyr.track);
  else if (musicAudio().paused) toggleMusicPlay();
  lyr.adj = { start: d.offset || 0, saved: d.offset || 0, userAt: 0, touching: false, progTop: -1, dirty: false };
  renderLyrics();
}
function finishDragAdjust(keep = true) {
  const a = lyr.adj,
    d = lyr.data;
  if (!a) return;
  if (!keep && d) {
    d.offset = a.start;
    lyrUserSet(lyr.track, { offset: a.start });
  } else saveAdjOffset();
  lyr.adj = null;
  renderLyrics();
  if (keep && d && Math.abs((d.offset || 0) - a.start) >= 0.05) podToast(`Letra ajustada (${fmtOffset(d.offset || 0)})`);
}
function fmtOffset(v) {
  return `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')} s`;
}
function saveAdjOffset() {
  const a = lyr.adj,
    d = lyr.data;
  if (!a || !d) return;
  const v = Math.round((d.offset || 0) * 20) / 20;
  d.offset = v;
  if (v !== a.saved) {
    lyrUserSet(lyr.track, { offset: v });
    a.saved = v;
  }
  a.dirty = false;
}
function renderAdjustFoot(foot) {
  foot.append(musEl('p', 'lyr-adj-help', 'Arrastra la letra hasta que la línea junto a <b>▶</b> sea la que se oye. Se guarda sola.'));
  foot.append(musEl('span', 'lyr-src', `Desfase <b id="lyrAdjVal">${pEsc(fmtOffset(lyr.data.offset || 0))}</b>`));
  const nudge = v => () => {
    lyr.data.offset = Math.round(((lyr.data.offset || 0) + v) * 20) / 20;
    saveAdjOffset();
    updateAdjValue();
  };
  foot.append(
    lyrButtons([
      ['−0,1 s', nudge(-0.1)],
      ['+0,1 s', nudge(0.1)],
      ['↺ Deshacer', () => finishDragAdjust(false)],
      ['✓ Listo', () => finishDragAdjust(true), 'primary']
    ])
  );
}
function updateAdjValue() {
  const el = $m('lyrAdjVal');
  if (el) el.textContent = fmtOffset(lyr.data?.offset || 0);
}
function placeLyrGuide() {
  const g = $m('lyrGuide'),
    body = $m('lyrBody');
  if (!g || !body) return;
  g.style.top = body.offsetTop + body.clientHeight / 2 + 'px';
}
// Filas con su posición (sin las transformaciones de la línea actual).
function adjRows() {
  const rows = [...document.querySelectorAll('#lyrBody .lyr-lines .lyr-line')];
  // Ancla: el centro de la línea (cuando empieza a sonar, la guía la atraviesa por el medio).
  return rows.map(r => ({ top: r.offsetTop + r.offsetHeight / 2, h: r.offsetHeight }));
}
// Tiempo de la letra que queda en la guía, interpolando dentro de la línea.
function adjTimeAtGuide() {
  const body = $m('lyrBody'),
    L = lyr.data.lines,
    R = adjRows();
  if (!R.length || R.length !== L.length) return null;
  const y = body.scrollTop + body.clientHeight / 2;
  let i = 0;
  while (i + 1 < R.length && R[i + 1].top <= y) i++;
  const span = (i + 1 < R.length ? R[i + 1].top : R[i].top + R[i].h + 14) - R[i].top || 1;
  if (i === 0 && y < R[0].top) return L[0].t - Math.min(4, ((R[0].top - y) / span) * 3);
  const dur = (i + 1 < L.length ? L[i + 1].t : L[i].t + 4) - L[i].t;
  const f = Math.max(-1, Math.min(1, (y - R[i].top) / span));
  return L[i].t + f * dur;
}
// Posición de desplazamiento que pone un tiempo de la letra en la guía.
function adjScrollFor(time) {
  const body = $m('lyrBody'),
    L = lyr.data.lines,
    R = adjRows();
  if (!R.length || R.length !== L.length) return null;
  let i = 0;
  while (i + 1 < L.length && L[i + 1].t <= time) i++;
  const span = (i + 1 < R.length ? R[i + 1].top : R[i].top + R[i].h + 14) - R[i].top;
  const dur = (i + 1 < L.length ? L[i + 1].t : L[i].t + 4) - L[i].t || 1;
  const f = Math.max(0, Math.min(1, (time - L[i].t) / dur));
  return R[i].top + f * span - body.clientHeight / 2;
}
function adjustTick() {
  const a = lyr.adj,
    d = lyr.data;
  if (!a || !d?.synced || !isLyrTrackPlaying()) return;
  const body = $m('lyrBody');
  if (a.touching || performance.now() - a.userAt < 220) return;
  if (a.dirty) saveAdjOffset();
  const top = adjScrollFor((Number(musicAudio().currentTime) || 0) + (d.offset || 0));
  if (top == null) return;
  if (Math.abs(body.scrollTop - top) >= 1) {
    body.scrollTop = top;
    a.progTop = body.scrollTop;
  }
}
function adjFromUserScroll() {
  const a = lyr.adj,
    d = lyr.data;
  if (!a || !d?.synced || !isLyrTrackPlaying()) return;
  const t = adjTimeAtGuide();
  if (t == null) return;
  d.offset = Math.max(-600, Math.min(600, t - (Number(musicAudio().currentTime) || 0)));
  a.dirty = true;
  updateAdjValue();
  updateLyricsHighlight(false);
}
function initDragAdjust(body) {
  const mark = on => () => lyr.adj && ((lyr.adj.touching = on), (lyr.adj.userAt = performance.now()));
  body.addEventListener('touchstart', mark(true), { passive: true });
  body.addEventListener('touchend', mark(false), { passive: true });
  body.addEventListener('touchcancel', mark(false), { passive: true });
  body.addEventListener('wheel', mark(false), { passive: true });
  body.addEventListener(
    'scroll',
    () => {
      const a = lyr.adj;
      if (!a) return;
      if (a.progTop >= 0 && Math.abs(body.scrollTop - a.progTop) < 2 && !a.touching) return;
      a.userAt = performance.now();
      adjFromUserScroll();
    },
    { passive: true }
  );
  // Ratón: arrastrar con el botón pulsado.
  let drag = null;
  body.addEventListener('pointerdown', e => {
    if (!lyr.adj || e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('button')) return;
    drag = { y: e.clientY, top: body.scrollTop };
    lyr.adj.touching = true;
    body.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  body.addEventListener('pointermove', e => {
    if (!drag || !lyr.adj) return;
    body.scrollTop = drag.top - (e.clientY - drag.y);
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    if (lyr.adj) (lyr.adj.touching = false), (lyr.adj.userAt = performance.now());
  };
  body.addEventListener('pointerup', end);
  body.addEventListener('pointercancel', end);
  window.addEventListener('resize', () => lyr.adj && placeLyrGuide());
}

/* ---------------------------------------------------------------------------
   Sincronizar (marcar cada línea mientras suena)
--------------------------------------------------------------------------- */
function startSync() {
  const d = lyr.data;
  const lines = (d?.lines || []).filter(l => l.text).map(l => ({ text: l.text, t: null }));
  if (!lines.length) return podToast('No hay letra que sincronizar');
  lyr.sync = { lines, idx: 0, marked: 0 };
  const a = musicAudio();
  if (!isLyrTrackPlaying()) playTrackNow(lyr.track);
  else {
    a.currentTime = 0;
    if (a.paused) toggleMusicPlay();
  }
  renderLyrics();
}
function renderSyncEditor(body, foot) {
  const s = lyr.sync;
  body.append(musEl('p', 'lyr-note', 'Pulsa <b>MARCAR</b> justo cuando empiece cada línea. Si te equivocas, «Deshacer» vuelve un poco atrás. En el ordenador también vale la barra espaciadora.'));
  const list = musEl('div', 'lyr-lines lyr-sync-list');
  s.lines.forEach((l, i) => {
    const row = musEl('div', 'lyr-line' + (i === s.idx ? ' now' : i < s.idx ? ' past' : ''), `<span class="lyr-time">${l.t != null ? fmtLrcTime(l.t) : '··:··'}</span><span class="o">${pEsc(l.text)}</span>`);
    list.append(row);
  });
  body.append(list);
  const done = s.idx >= s.lines.length;
  foot.append(musEl('span', 'lyr-src', `<span id="lyrSyncClock">0:00</span> · ${s.idx} de ${s.lines.length} líneas marcadas`));
  const ctrl = musEl('div', 'lyr-sync-ctrl');
  const mk = (label, fn, cls = '', dis = false) => {
    const b = musEl('button', cls, label);
    b.type = 'button';
    b.disabled = dis;
    b.onclick = fn;
    ctrl.append(b);
  };
  mk('⏪ 5 s', () => (musicAudio().currentTime = Math.max(0, musicAudio().currentTime - 5)));
  mk('↩ Deshacer', syncUndo, '', s.idx === 0);
  mk(done ? '✓ Hecho' : '● MARCAR', syncMark, 'mark', done);
  mk(musicAudio().paused ? '▶' : '⏸', () => (toggleMusicPlay(), setTimeout(renderLyrics, 50)));
  foot.append(ctrl);
  foot.append(
    lyrButtons([
      ['Cancelar', () => ((lyr.sync = null), renderLyrics())],
      ['💾 Guardar', syncSave, 'primary']
    ])
  );
  setTimeout(() => list.querySelector('.now')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30);
}
function updateSyncClock() {
  const el = $m('lyrSyncClock');
  if (el) el.textContent = fmtPodTime(musicAudio()?.currentTime || 0);
}
function syncMark() {
  const s = lyr.sync;
  if (!s || s.idx >= s.lines.length) return;
  if (!isLyrTrackPlaying()) return podToast('Primero tiene que sonar esta canción');
  const now = Math.max(0, (musicAudio().currentTime || 0) - LYR_REACTION);
  const prev = s.idx > 0 ? s.lines[s.idx - 1].t : 0;
  s.lines[s.idx].t = Math.max(now, prev + 0.05);
  s.idx++;
  s.marked++;
  renderLyrics();
  if (s.idx >= s.lines.length) podToast('¡Todas las líneas marcadas! Pulsa «Guardar».');
}
function syncUndo() {
  const s = lyr.sync;
  if (!s || s.idx === 0) return;
  s.idx--;
  s.lines[s.idx].t = null;
  const back = s.idx > 0 ? s.lines[s.idx - 1].t : 0;
  musicAudio().currentTime = Math.max(0, back - 1);
  renderLyrics();
}
function syncSave() {
  const s = lyr.sync;
  const marked = s.lines.filter(l => l.t != null);
  if (marked.length < 2) return podToast('Marca al menos un par de líneas');
  // Las que no se marcaron se quedan pegadas a la anterior.
  let last = 0;
  s.lines.forEach(l => {
    if (l.t == null) l.t = last + 0.01;
    last = l.t;
  });
  lyrUserSet(lyr.track, { text: toLrc(lyr.track, s.lines), source: 'sync', offset: undefined });
  lyr.sync = null;
  const tr = lyr.track;
  podToast('Letra sincronizada guardada', { action: '📤 Compartir en LRCLIB', onAction: () => shareToLrclib(tr) });
  loadLyricsFor(lyr.track);
}

/* ---------------------------------------------------------------------------
   Menú, desfase, editar, otras versiones, exportar
--------------------------------------------------------------------------- */
function lyricsMenu() {
  const d = lyr.data;
  const user = lyr.track && lyrUserGet(lyr.track);
  podSheet({
    title: 'Letra',
    subtitle: lyr.track ? `${lyr.track.title} · ${trackArtist(lyr.track)}` : '',
    items: [
      d?.lines?.length && { icon: '⏱', label: d.synced ? 'Volver a sincronizar' : 'Sincronizar', on: startSync },
      d?.synced && { icon: '↕️', label: 'Ajustar arrastrando la letra', hint: 'Mientras suena, arrastra hasta que coincida', on: startDragAdjust },
      d?.synced && { icon: '⇆', label: 'Ajustar desfase', on: offsetMenu },
      { icon: '🔎', label: 'Buscar otra versión', hint: 'En LRCLIB, con o sin tiempos', on: searchOtherLyrics },
      { icon: '🌐', label: 'Buscar la letra en internet', hint: 'Para copiarla y pegarla aquí', on: () => searchLyricsWeb(lyr.track) },
      { icon: '🌐', label: 'Buscar un .lrc sincronizado en internet', on: () => searchLyricsWeb(lyr.track, 'lrc') },
      { icon: '✏️', label: d?.lines?.length ? 'Editar la letra' : 'Escribir o pegar la letra', hint: 'Admite texto normal o .lrc', on: editLyrics },
      d?.lines?.length && { icon: '💾', label: d.synced ? 'Exportar .lrc' : 'Exportar .txt', on: exportLyrics },
      d?.lines?.length && d.source === 'user' && { icon: '📤', label: user?.published ? 'Compartir otra vez en LRCLIB' : 'Compartir en LRCLIB', hint: user?.published ? 'Ya la compartiste' : 'Para que aparezca sola a todo el mundo', on: () => shareToLrclib(lyr.track) },
      { icon: '🔄', label: 'Volver a buscar', on: () => loadLyricsFor(lyr.track, { force: true }) },
      user?.text && { icon: '🗑', label: 'Borrar mi versión', hint: 'Vuelve a la del archivo o la de LRCLIB', danger: true, on: () => (lyrUserDelete(lyr.track), loadLyricsFor(lyr.track)) }
    ]
  });
}
function offsetMenu() {
  const d = lyr.data;
  if (!d) return;
  const apply = delta => {
    const v = delta === null ? 0 : Math.round(((d.offset || 0) + delta) * 10) / 10;
    lyrUserSet(lyr.track, { offset: v });
    d.offset = v;
    renderLyrics();
    offsetMenu();
  };
  const fmt = v => `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')} s`;
  podSheet({
    title: '⇆ Ajustar desfase',
    subtitle: `Ahora: ${fmt(d.offset || 0)}. Mueve la letra hasta que la línea iluminada vaya a la par que la voz.`,
    items: [
      { icon: '⏩', label: 'La letra va tarde: adelantar 0,5 s', on: () => apply(0.5) },
      { icon: '›', label: 'Adelantar 0,1 s', on: () => apply(0.1) },
      { icon: '‹', label: 'Retrasar 0,1 s', on: () => apply(-0.1) },
      { icon: '⏪', label: 'La letra va antes de tiempo: retrasar 0,5 s', on: () => apply(-0.5) },
      d.offset ? { icon: '↺', label: 'Sin desfase', on: () => apply(null) } : null
    ],
    cancel: 'Listo'
  });
}
function editLyrics() {
  const d = lyr.data;
  const form = musEl('form', 'pod-sheet-form');
  form.innerHTML = `<button type="button" class="lyr-web-btn">🌐 Buscar la letra en internet para copiarla</button><label><span>Letra (texto normal o .lrc con tiempos [mm:ss.xx])</span><textarea class="lyr-textarea" rows="14" spellcheck="false"></textarea></label><button type="submit" class="pod-sheet-ok">Guardar</button>`;
  form.querySelector('.lyr-web-btn').onclick = () => searchLyricsWeb(lyr.track);
  const ta = form.querySelector('textarea');
  ta.value = d?.synced ? toLrc(lyr.track, d.lines) : (d?.lines || []).map(l => l.text).join('\n');
  form.onsubmit = ev => {
    ev.preventDefault();
    const v = ta.value.trim();
    if (!v) return ta.focus();
    lyrUserSet(lyr.track, { text: v, source: 'edit' });
    podSheetClose(false);
    podToast('Letra guardada');
    loadLyricsFor(lyr.track);
  };
  podSheet({ title: '✏️ Letra', body: form });
}
async function searchOtherLyrics() {
  const t = lyr.track;
  podToast('Buscando versiones…', { ms: 6000 });
  let items = [];
  try {
    const d = await lyricsQuery({ search: true, artist: t.artist || '', title: t.title || '' });
    items = d.items || [];
  } catch (e) {
    return podToast('No se pudo buscar: ' + (e?.message || 'error'));
  }
  if (!items.length) return podToast('No hay versiones en LRCLIB');
  // Primero las sincronizadas y las de duración parecida.
  items.sort((a, b) => b.hasSynced - a.hasSynced || Math.abs((a.duration || 0) - (t.dur || 0)) - Math.abs((b.duration || 0) - (t.dur || 0)));
  const cur = lyr.data?.lrclibId;
  podSheet({
    title: 'Elige una versión',
    subtitle: `${items.length} en LRCLIB · duración de tu canción: ${fmtPodTime(t.dur || 0)}`,
    items: items.slice(0, 25).map(x => ({
      icon: x.instrumental ? '🎼' : x.hasSynced ? '⏱' : '📝',
      label: `${x.artistName} — ${x.trackName}`,
      hint: [x.albumName, x.duration ? fmtPodTime(x.duration) : '', x.instrumental ? 'instrumental' : x.hasSynced ? 'sincronizada' : 'sin tiempos'].filter(Boolean).join(' · '),
      checked: x.id === cur,
      on: () => pickLrclibVersion(x.id)
    }))
  });
}
async function pickLrclibVersion(id) {
  try {
    const d = await lyricsQuery({ id: String(id).replace(/\D/g, '') });
    if (!d.found) throw Error('No encontrada');
    if (d.instrumental && !d.synced && !d.plain) return podToast('Esa versión es instrumental');
    lyrUserSet(lyr.track, { text: d.synced || d.plain, source: 'lrclib', lrclibId: d.id, offset: undefined });
    podToast(d.synced ? 'Versión sincronizada elegida' : 'Versión elegida');
    loadLyricsFor(lyr.track);
  } catch (e) {
    podToast('No se pudo cargar: ' + (e?.message || 'error'));
  }
}
function exportLyrics() {
  const d = lyr.data,
    t = lyr.track;
  const base = `${trackArtist(t)} - ${t.title}`.replace(/[\\/:*?"<>|]+/g, ' ').trim();
  if (d.synced) downloadText(base + '.lrc', toLrc(t, d.lines, d.offset), 'text/plain');
  else downloadText(base + '.txt', d.lines.map(l => l.text).join('\n') + '\n', 'text/plain');
}

/* ---------------------------------------------------------------------------
   Traducción
--------------------------------------------------------------------------- */
async function ensureTranslation(force = false) {
  const d = lyr.data;
  if (!d?.lines?.length || lyr.transLoading || (lyr.trans && !force)) return;
  const t = lyr.track;
  const texts = d.lines.map(l => l.text || '');
  const ck = 't|' + lyrKey(t) + '|' + lyrHash(texts.join('\n'));
  const tok = lyr.token;
  if (!force) {
    const c = await idbGet('lyrics', ck);
    if (c && tok === lyr.token) {
      lyr.trans = c;
      return renderLyrics();
    }
  }
  lyr.transLoading = true;
  lyr.transError = '';
  renderLyrics();
  try {
    const r = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: texts, to: 'es' }) });
    const res = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(res.error || 'No se pudo traducir');
    if (tok !== lyr.token) return;
    lyr.trans = { lang: res.lang || '', lines: res.lines || [] };
    idbPut('lyrics', ck, lyr.trans);
  } catch (e) {
    if (tok === lyr.token) lyr.transError = e?.message || 'No se pudo traducir';
  }
  lyr.transLoading = false;
  if (tok === lyr.token) renderLyrics();
}

/* ---------------------------------------------------------------------------
   Significado (IA)
--------------------------------------------------------------------------- */
function aiDeviceKey() {
  return lsGet(LYR_AI_KEY, null);
}
// El mejor significado sale con la letra; sin ella, con las etiquetas ID3
// (título, artista, álbum, año, género) y el nombre del archivo.
function lyrLyricsText() {
  return lyr.data?.instrumental ? '' : (lyr.data?.lines || []).map(l => l.text).join('\n').trim();
}
let meaningBusy = '';
async function openMeaning(force = false) {
  lyr.meaningOpen = true;
  const t = lyr.track;
  if (!t) return;
  // Si aún se está buscando la letra, se espera: al terminar se vuelve a llamar
  // (loadLyricsFor) y el significado sale con la letra si la hay.
  if (lyr.loading) return renderLyrics();
  const ck = 'm|' + lyrKey(t);
  const tok = lyr.token;
  const lyrics = lyrLyricsText();
  if (!force && !lyr.meaning) {
    const c = await idbGet('lyrics', ck);
    if (tok !== lyr.token) return;
    // Uno hecho sin letra se rehace solo cuando ya hay letra (sale mejor).
    if (c && !(c.noLyrics && lyrics)) {
      lyr.meaning = c;
      return renderLyrics();
    }
  }
  if (lyr.meaning && !force && !(lyr.meaning.noLyrics && lyrics)) return renderLyrics();
  const busy = tok + '|' + (lyrics ? 1 : 0);
  if (!force && meaningBusy === busy) return; // ya se está pidiendo
  meaningBusy = busy;
  lyr.meaning = null;
  lyr.meaningLoading = true;
  lyr.meaningError = '';
  renderLyrics();
  try {
    const headers = { 'Content-Type': 'application/json' };
    const dk = aiDeviceKey();
    if (dk?.key) {
      headers['X-AI-Provider'] = dk.provider;
      headers['X-AI-Key'] = dk.key;
    }
    const file = String(t.file || '').replace(/\.[a-z0-9]{2,5}$/i, '');
    const body = { title: t.title, artist: t.artist || t.albumArtist || '', album: t.album, year: t.year || '', lyrics, albumArtist: t.albumArtist || '', genre: t.genre || '', file: file && file !== t.title ? file : '' };
    const r = await fetch('/api/song-meaning', { method: 'POST', headers, body: JSON.stringify(body) });
    const res = await r.json().catch(() => ({}));
    if (r.status === 501 && res.error === 'no-key') throw Object.assign(Error('no-key'), { noKey: true });
    if (!r.ok) throw Error(res.error || 'No se pudo obtener el significado');
    const m = { text: res.text, provider: res.provider, model: res.model, at: Date.now(), noLyrics: !lyrics };
    idbPut('lyrics', ck, m);
    if (tok === lyr.token) lyr.meaning = m;
  } catch (e) {
    if (tok === lyr.token) lyr.meaningError = e.noKey ? 'no-key' : e?.message || 'Error';
  }
  if (meaningBusy === busy) meaningBusy = '';
  if (tok !== lyr.token) return;
  lyr.meaningLoading = false;
  renderLyrics();
}
function renderMeaningCard() {
  const card = musEl('section', 'lyr-meaning');
  card.append(musEl('h3', '', '💡 Significado de la canción'));
  if (lyr.meaningLoading) card.append(musEl('p', 'lyr-note', '<span class="lyr-spin"></span> Pensando en la canción…'));
  else if (lyr.meaningError === 'no-key') card.append(aiKeySetup());
  else if (lyr.meaningError) {
    card.append(musEl('p', 'lyr-note warn', `⚠️ ${pEsc(lyr.meaningError)}`));
    card.append(lyrButtons([['🔄 Reintentar', () => openMeaning(true)], ['🔑 Cambiar la clave de IA', () => ((lyr.meaningError = 'no-key'), renderLyrics())]]));
  } else if (lyr.meaning) {
    card.append(musEl('div', 'lyr-md', mdToHtml(lyr.meaning.text)));
    card.append(musEl('p', 'lyr-ai-note', `Explicación generada por IA (${lyr.meaning.provider === 'anthropic' ? 'Claude' : 'Gemini'}); puede contener errores.`));
    card.append(lyrButtons([['🔄 Regenerar', () => openMeaning(true)]]));
  }
  return card;
}
function aiKeySetup() {
  const box = musEl('div', 'lyr-ai-setup');
  const cur = aiDeviceKey() || { provider: 'gemini', key: '' };
  box.innerHTML = `<p>Para explicar el significado hace falta una <b>IA</b>. La forma más sencilla y <b>gratis</b>: crea una clave de Google Gemini en <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> (con tu cuenta de Google) y pégala aquí. También vale una de Anthropic (Claude), de pago.</p>
    <form class="pod-sheet-form"><label><span>Proveedor</span><select data-k="provider"><option value="gemini">Google Gemini (gratis)</option><option value="anthropic">Anthropic Claude</option></select></label><label><span>Clave</span><input data-k="key" type="password" autocomplete="off" placeholder="Pega aquí la clave"></label><button type="submit" class="pod-sheet-ok">Guardar y explicar</button></form>
    <p class="lyr-ai-note">La clave se guarda solo en este dispositivo y viaja a tu servidor de Radios Viferor para hacer la consulta. Si prefieres no guardarla aquí, ponla en Vercel como variable GEMINI_API_KEY o ANTHROPIC_API_KEY.</p>`;
  const f = box.querySelector('form');
  f.querySelector('[data-k=provider]').value = cur.provider;
  f.querySelector('[data-k=key]').value = cur.key || '';
  f.onsubmit = ev => {
    ev.preventDefault();
    const key = f.querySelector('[data-k=key]').value.trim();
    if (!key) return;
    lsSet(LYR_AI_KEY, { provider: f.querySelector('[data-k=provider]').value, key });
    openMeaning(true);
  };
  if (cur.key)
    box.append(
      lyrButtons([
        [
          '🗑 Borrar la clave guardada',
          () => {
            localStorage.removeItem(LYR_AI_KEY);
            podToast('Clave borrada');
            renderLyrics();
          }
        ]
      ])
    );
  return box;
}
// Markdown mínimo y seguro: ### títulos, listas, **negrita**, párrafos.
function mdToHtml(src) {
  const inline = s => pEsc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>');
  const out = [];
  let list = null,
    para = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join(' ')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<ul>${list.map(x => `<li>${inline(x)}</li>`).join('')}</ul>`);
    list = null;
  };
  String(src || '')
    .replace(/\r/g, '')
    .split('\n')
    .forEach(line => {
      const l = line.trim();
      const h = l.match(/^#{1,4}\s+(.*)$/);
      const li = l.match(/^[-*•]\s+(.*)$/) || l.match(/^\d+[.)]\s+(.*)$/);
      if (h) {
        flushPara();
        flushList();
        out.push(`<h4>${inline(h[1])}</h4>`);
      } else if (li) {
        flushPara();
        (list ||= []).push(li[1]);
      } else if (!l) {
        flushPara();
        flushList();
      } else {
        flushList();
        para.push(l);
      }
    });
  flushPara();
  flushList();
  return out.join('');
}

/* ---------------------------------------------------------------------------
   Enganches con el reproductor
--------------------------------------------------------------------------- */
document.addEventListener('music:now', () => {
  const p = $m('lyrPanel');
  if (!p || p.hidden || lyr.sync) return;
  // Si estabas viendo la letra de lo que sonaba, sigue a la canción nueva.
  if (musicState.current && lyr.track && musicState.current.id !== lyr.track.id && lyr.followCurrent !== false) loadLyricsFor(musicState.current);
});
function initLyrics() {
  $m('musExpLyrics')?.addEventListener('click', () => {
    lyr.followCurrent = true;
    openLyrics(musicState.current);
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initLyrics);
else initLyrics();

/* ---------------------------------------------------------------------------
   Buscar la letra en internet (para copiarla y pegarla)
--------------------------------------------------------------------------- */
function searchLyricsWeb(t, kind = 'letra') {
  t = t || lyr.track;
  if (!t) return;
  const q = `${t.artist ? t.artist + ' ' : ''}${t.title} ${kind}`;
  // En la app Android, los enlaces de fuera se abren en el navegador del móvil.
  window.open('https://www.google.com/search?q=' + encodeURIComponent(q), '_blank', 'noopener');
}

/* ---------------------------------------------------------------------------
   Compartir en LRCLIB (con su reto de prueba de trabajo)
--------------------------------------------------------------------------- */
// SHA-256 en JavaScript dentro de un Web Worker: busca un número tal que
// SHA-256(prefijo + número) < objetivo (comparando bytes), como pide LRCLIB.
const LYR_POW_WORKER = `
const K=new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
const W=new Uint32Array(64);
function sha256(m,len){
  const nb=((len+9+63)>>6)<<6, p=new Uint8Array(nb); p.set(m.subarray(0,len)); p[len]=0x80;
  const bits=len*8; p[nb-4]=bits>>>24; p[nb-3]=(bits>>>16)&255; p[nb-2]=(bits>>>8)&255; p[nb-1]=bits&255;
  let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
  for(let o=0;o<nb;o+=64){
    for(let i=0;i<16;i++)W[i]=(p[o+i*4]<<24)|(p[o+i*4+1]<<16)|(p[o+i*4+2]<<8)|p[o+i*4+3];
    for(let i=16;i<64;i++){const a=W[i-15],b=W[i-2];W[i]=(((a>>>7)|(a<<25))^((a>>>18)|(a<<14))^(a>>>3))+W[i-16]+(((b>>>17)|(b<<15))^((b>>>19)|(b<<13))^(b>>>10))+W[i-7]|0;}
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
    for(let i=0;i<64;i++){
      const t1=h+(((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7)))+((e&f)^(~e&g))+K[i]+W[i]|0;
      const t2=(((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10)))+((a&b)^(a&c)^(b&c))|0;
      h=g;g=f;f=e;e=d+t1|0;d=c;c=b;b=a;a=t1+t2|0;
    }
    h0=h0+a|0;h1=h1+b|0;h2=h2+c|0;h3=h3+d|0;h4=h4+e|0;h5=h5+f|0;h6=h6+g|0;h7=h7+h|0;
  }
  const out=new Uint8Array(32),hs=[h0,h1,h2,h3,h4,h5,h6,h7];
  for(let i=0;i<8;i++){out[i*4]=hs[i]>>>24;out[i*4+1]=(hs[i]>>>16)&255;out[i*4+2]=(hs[i]>>>8)&255;out[i*4+3]=hs[i]&255;}
  return out;
}
function less(h,t){for(let i=0;i<32;i++){if(h[i]!==t[i])return h[i]<t[i];}return false;}
onmessage=e=>{
  if(e.data.test){const b=new TextEncoder().encode(e.data.test);postMessage({hex:[...sha256(b,b.length)].map(x=>x.toString(16).padStart(2,'0')).join('')});return;}
  const {prefix,target,start,step}=e.data;
  const tb=new Uint8Array(32);for(let i=0;i<32;i++)tb[i]=parseInt(target.substr(i*2,2),16)||0;
  const pb=new TextEncoder().encode(prefix),buf=new Uint8Array(pb.length+24);buf.set(pb);
  let n=start,c=0;
  for(;;){
    const s=String(n);for(let i=0;i<s.length;i++)buf[pb.length+i]=s.charCodeAt(i);
    if(less(sha256(buf,pb.length+s.length),tb)){postMessage({nonce:s,count:c});return;}
    n+=step;if(++c%100000===0)postMessage({progress:100000});
  }
};`;
function solveLrclibChallenge(prefix, target, onProgress, timeoutMs = 280000) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([LYR_POW_WORKER], { type: 'text/javascript' }));
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    const workers = [];
    let tried = 0;
    const stop = () => {
      workers.forEach(w => w.terminate());
      URL.revokeObjectURL(url);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      stop();
      reject(Error('Se ha tardado demasiado. Prueba otra vez (mejor con el móvil cargando).'));
    }, timeoutMs);
    for (let i = 0; i < n; i++) {
      const w = new Worker(url);
      w.onmessage = e => {
        if (e.data.nonce != null) {
          stop();
          resolve(e.data.nonce);
        } else if (e.data.progress) {
          tried += e.data.progress;
          onProgress?.(tried);
        }
      };
      w.onerror = e => {
        stop();
        reject(Error('No se pudo resolver el reto' + (e?.message ? ': ' + e.message : '')));
      };
      w.postMessage({ prefix, target, start: i, step: n });
      workers.push(w);
    }
  });
}
window.solveLrclibChallenge = solveLrclibChallenge;
function lyrPlainText(d) {
  return d.lines.map(l => l.text).join('\n').trim();
}
// LRC para LRCLIB: solo líneas con tiempo y con el desfase ya aplicado.
function lyrSyncedForPublish(d) {
  return d.lines
    .filter(l => l.t != null)
    .map(l => `[${fmtLrcTime(l.t - (d.offset || 0))}]${l.text}`)
    .join('\n');
}
async function shareToLrclib(t) {
  t = t || lyr.track;
  const d = lyr.track?.id === t.id ? lyr.data : await loadLyrics(t);
  if (!d?.lines?.length) return podToast('No hay letra que compartir');
  if (!t.artist) return podToast('La canción no tiene artista en sus etiquetas; LRCLIB lo necesita');
  if (!(t.dur > 0)) return podToast('Reproduce la canción un momento para saber su duración y vuelve a intentarlo');
  podSheet({
    title: '📤 Compartir en LRCLIB',
    subtitle: `${trackArtist(t)} — ${t.title} · ${fmtPodTime(t.dur)}${d.synced ? ' · sincronizada' : ' · sin tiempos'}`,
    items: [
      {
        icon: '📤',
        label: 'Publicar',
        hint: 'Será pública para cualquiera que use LRCLIB. Antes, tu móvil resuelve un pequeño reto de cálculo (de segundos a un par de minutos).',
        on: () => publishToLrclib(t, d)
      }
    ]
  });
}
async function publishToLrclib(t, d) {
  const say = (m, o = {}) => podToast(m, { ms: 60000, ...o });
  try {
    say('Pidiendo el reto a LRCLIB…');
    const ch = await fetch('/api/lyrics-publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: 'challenge' }) });
    const c = await ch.json().catch(() => ({}));
    if (!ch.ok) throw Error(c.error || 'LRCLIB no responde');
    if (!c.prefix || !/^[0-9a-f]{64}$/i.test(c.target || '')) throw Error('LRCLIB ha enviado un reto no válido');
    say('Resolviendo el reto… (deja la app abierta)');
    const started = Date.now();
    const nonce = await solveLrclibChallenge(c.prefix, c.target, n => say(`Resolviendo el reto… ${(n / 1e6).toFixed(1).replace('.', ',')} M intentos · ${Math.round((Date.now() - started) / 1000)} s`));
    say('Publicando…');
    const body = {
      step: 'publish',
      token: `${c.prefix}:${nonce}`,
      trackName: t.title,
      artistName: t.artist,
      albumName: t.album || t.title,
      duration: Math.round(t.dur),
      plainLyrics: lyrPlainText(d),
      syncedLyrics: d.synced ? lyrSyncedForPublish(d) : null
    };
    const r = await fetch('/api/lyrics-publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const res = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(res.error || 'LRCLIB la ha rechazado');
    lyrUserSet(t, { published: Date.now() });
    idbPut('lyrics', 'l|' + lyrKey(t), null);
    podToast('¡Publicada en LRCLIB! Gracias por compartirla 🎉');
    if (lyr.track?.id === t.id) renderLyrics();
  } catch (e) {
    podToast('No se pudo publicar: ' + (e?.message || 'error'));
  }
}
window.shareToLrclib = shareToLrclib;
