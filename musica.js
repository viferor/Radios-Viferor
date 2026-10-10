// «Mi música» (1.17.0): reproductor de música local.
//
// · App Android (APK 1.10+): la biblioteca sale del móvil (MediaStore). El WebView
//   sirve /__music/library.json, /__music/track/{id} y /__music/art/{albumId}.
// · Navegador (PC): eliges una carpeta; en Chrome/Edge se recuerda (File System
//   Access) y las etiquetas se leen con jsmediatags (vendor/), con caché en IndexedDB.
// · Vistas: canciones, álbumes, artistas, carpetas y géneros; búsqueda.
// · Reproductor con aleatorio, repetir, cola, historial, temporizador y listas
//   (normales e inteligentes), como en Podcasts. Reutiliza podSheet, podToast,
//   podPromptText, makeSortable… de podcast-listas.js.

/* ===========================================================================
   Estado y utilidades
=========================================================================== */
const MUS_KEYS = {
  queue: 'radios_viferor_music_queue_v1',
  history: 'radios_viferor_music_history_v1',
  context: 'radios_viferor_music_context_v1',
  opts: 'radios_viferor_music_opts_v1',
  lists: 'radios_viferor_music_playlists_v1',
  stats: 'radios_viferor_music_stats_v1',
  resume: 'radios_viferor_music_resume_v1',
  ui: 'radios_viferor_music_ui_v1',
  volume: 'radios_viferor_music_volume'
};
const MUS_UNKNOWN_ARTIST = 'Artista desconocido';
const MUS_AUDIO_EXT = /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|weba|webm|mp4|alac|aiff?)$/i;
const musicState = {
  source: '', // android | folder | files
  loaded: false,
  loading: false,
  tracks: [],
  byId: new Map(),
  albums: new Map(),
  artists: new Map(),
  genres: new Map(),
  folders: new Map(),
  queue: [],
  history: [],
  context: [],
  current: null,
  lists: [],
  screen: 'tab',
  tab: 'songs',
  search: '',
  files: new Map(), // navegador: id → FileSystemFileHandle | File
  folderName: ''
};
window.musicState = musicState;
const $m = id => document.getElementById(id);
const musCollator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
function mNorm(v) {
  return typeof normalizar === 'function' ? normalizar(v || '') : String(v || '').toLowerCase().trim();
}
function lsGet(k, def) {
  try {
    const v = JSON.parse(localStorage.getItem(k) || 'null');
    return v == null ? def : v;
  } catch {
    return def;
  }
}
function lsSet(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}
function musicUi() {
  return { tab: 'songs', songSort: 'title', albumSort: 'name', ...lsGet(MUS_KEYS.ui, {}) };
}
function saveMusicUi(patch) {
  lsSet(MUS_KEYS.ui, { ...musicUi(), ...patch });
}
function fmtDur(sec) {
  return sec > 0 ? fmtPodTime(sec) : '';
}
function tracksSummary(list) {
  const total = list.reduce((s, t) => s + (t.dur || 0), 0);
  const tt = fmtLong(total);
  return `${plural(list.length, 'canción', 'canciones')}${tt ? ` · ${tt}` : ''}`;
}
function musicViewActive() {
  return !!$m('viewMusic')?.classList.contains('active');
}
function androidMusicApi() {
  try {
    return window.Android && typeof window.Android.musicApiVersion === 'function' ? Number(window.Android.musicApiVersion()) || 0 : 0;
  } catch {
    return 0;
  }
}
function isAndroidApp() {
  return !!window.Android || /RadiosViferor\//.test(navigator.userAgent);
}
function stripExt(name) {
  return String(name || '').replace(/\.[^.]+$/, '');
}
function trackArtist(t) {
  return t.artist || MUS_UNKNOWN_ARTIST;
}
function trackSub(t) {
  return [trackArtist(t), t.album].filter(Boolean).join(' · ');
}
function minimalTrack(t) {
  return t ? { id: t.id, title: t.title, artist: t.artist, album: t.album, folder: t.folder, file: t.file, dur: t.dur } : null;
}
function pathKey(t) {
  return mNorm((t.folder ? t.folder + '/' : '') + (t.file || ''));
}
// Encuentra en la biblioteca una canción guardada (por id; si cambió, por ruta).
function resolveTrack(x) {
  if (!x) return null;
  const id = typeof x === 'string' ? x : x.id;
  const byId = musicState.byId.get(id);
  if (byId) return byId;
  if (typeof x === 'object' && x.file) return musicState.byPath?.get(pathKey(x)) || null;
  return null;
}

/* ===========================================================================
   Biblioteca: Android
=========================================================================== */
async function loadAndroidLibrary() {
  const r = await fetch('/__music/library.json?ts=' + Date.now(), { cache: 'no-store' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) throw Error(d.error === 'permission' ? 'permission' : d.error || 'No se pudo leer la música');
  return (d.tracks || []).map(x => {
    const n = Number(x.n) || 0;
    return {
      id: 'a' + x.id,
      title: x.t || stripExt(x.fn) || 'Sin título',
      artist: x.a || '',
      album: x.al || '',
      albumArtist: x.aa || '',
      track: n % 1000,
      disc: n >= 1000 ? Math.floor(n / 1000) : 0,
      year: Number(x.y) || 0,
      dur: (Number(x.d) || 0) / 1000,
      folder: x.f || '',
      file: x.fn || '',
      added: (Number(x.da) || 0) * 1000,
      genre: x.g || '',
      size: Number(x.s) || 0,
      src: '/__music/track/' + x.id,
      art: x.ai ? `/__music/art/${x.ai}?t=${x.id}` : ''
    };
  });
}

/* ===========================================================================
   Biblioteca: navegador (carpeta elegida)
=========================================================================== */
const MUS_DB = 'radios-viferor-music';
function musDb() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(MUS_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('art')) db.createObjectStore('art');
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function idb(store, mode, fn) {
  const db = await musDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, mode);
    const st = tx.objectStore(store);
    const out = fn(st);
    tx.oncomplete = () => res(out && typeof out === 'object' && 'result' in out ? out.result : out);
    tx.onerror = () => rej(tx.error);
  });
}
const idbGet = (store, key) => idb(store, 'readonly', st => st.get(key)).catch(() => undefined);
const idbPut = (store, key, val) => idb(store, 'readwrite', st => st.put(val, key)).catch(() => undefined);
function loadTagLib() {
  if (window.jsmediatags) return Promise.resolve(window.jsmediatags);
  return new Promise(res => {
    const s = document.createElement('script');
    s.src = 'vendor/jsmediatags.min.js';
    s.onload = () => res(window.jsmediatags || null);
    s.onerror = () => res(null);
    document.head.append(s);
  });
}
function readTags(lib, file) {
  return new Promise(res => {
    if (!lib) return res(null);
    try {
      lib.read(file, { onSuccess: r => res(r?.tags || null), onError: () => res(null) });
    } catch {
      res(null);
    }
  });
}
// Recorre la carpeta (handle) y devuelve [{path, folder, file, handle}].
async function walkDir(dir, prefix = '', out = []) {
  for await (const entry of dir.values()) {
    if (entry.kind === 'directory') await walkDir(entry, prefix ? `${prefix}/${entry.name}` : entry.name, out);
    else if (MUS_AUDIO_EXT.test(entry.name)) out.push({ path: prefix ? `${prefix}/${entry.name}` : entry.name, folder: prefix, file: entry.name, handle: entry });
  }
  return out;
}
// Lee etiquetas (con caché) y monta las canciones. items: [{path, folder, file, handle|fileObj}].
async function buildFromFiles(items, rootName) {
  const lib = await loadTagLib();
  const tracks = [];
  const arts = new Map();
  let done = 0;
  const total = items.length;
  const progress = () => setMusicLoading(`Leyendo tu música… ${done} de ${total}`);
  progress();
  musicState.files = new Map();
  const work = async it => {
    const f = it.fileObj || (await it.handle.getFile());
    const id = 'f:' + (rootName ? rootName + '/' : '') + it.path;
    const cacheKey = id + '|' + f.size + '|' + f.lastModified;
    let meta = await idbGet('meta', cacheKey);
    if (!meta) {
      const tags = await readTags(lib, f);
      meta = {
        title: tags?.title || '',
        artist: tags?.artist || '',
        album: tags?.album || '',
        albumArtist: tags?.TPE2?.data || tags?.aART?.data || '',
        track: parseInt(tags?.track, 10) || 0,
        disc: parseInt(tags?.TPOS?.data || tags?.disk?.data?.disk, 10) || 0,
        year: parseInt(tags?.year, 10) || 0,
        genre: typeof tags?.genre === 'string' ? tags.genre.replace(/^\(\d+\)/, '') : '',
        hasArt: !!tags?.picture
      };
      if (tags?.picture?.data?.length) {
        const key = mNorm(meta.album) + '|' + it.folder;
        const blob = new Blob([new Uint8Array(tags.picture.data)], { type: tags.picture.format || 'image/jpeg' });
        await idbPut('art', key, blob);
        meta.artKey = key;
      }
      idbPut('meta', cacheKey, meta);
    }
    const t = {
      id,
      title: meta.title || stripExt(it.file),
      artist: meta.artist,
      album: meta.album,
      albumArtist: meta.albumArtist,
      track: meta.track,
      disc: meta.disc,
      year: meta.year,
      dur: Number(meta.dur) || 0,
      folder: rootName ? (it.folder ? `${rootName}/${it.folder}` : rootName) : it.folder,
      file: it.file,
      added: f.lastModified || 0,
      genre: meta.genre,
      size: f.size,
      src: '',
      art: '',
      artKey: meta.artKey || '',
      cacheKey
    };
    musicState.files.set(id, it.fileObj || it.handle);
    tracks.push(t);
    done++;
    if (done % 25 === 0) progress();
  };
  let i = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (i < items.length) {
        const it = items[i++];
        try {
          await work(it);
        } catch {
          done++;
        }
      }
    })
  );
  // Carátulas: una URL por álbum (de la caché de IndexedDB).
  for (const t of tracks) {
    if (!t.artKey) continue;
    if (!arts.has(t.artKey)) {
      const blob = await idbGet('art', t.artKey);
      arts.set(t.artKey, blob ? URL.createObjectURL(blob) : '');
    }
    t.art = arts.get(t.artKey);
  }
  return tracks;
}
async function pickMusicFolder() {
  if (window.showDirectoryPicker) {
    let dir;
    try {
      dir = await window.showDirectoryPicker({ id: 'rv-music', mode: 'read' });
    } catch (e) {
      if (e?.name !== 'AbortError') podToast('No se pudo abrir la carpeta');
      return;
    }
    await idbPut('kv', 'dir', dir);
    return scanFolderHandle(dir);
  }
  // Firefox/Safari: selector de carpeta clásico (hay que elegirla en cada visita).
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.webkitdirectory = true;
  input.onchange = async () => {
    const files = [...(input.files || [])].filter(f => MUS_AUDIO_EXT.test(f.name));
    if (!files.length) return podToast('No hay archivos de música en esa carpeta');
    const items = files.map(f => {
      const rel = f.webkitRelativePath || f.name;
      const parts = rel.split('/');
      const file = parts.pop();
      return { path: rel, folder: parts.join('/'), file, fileObj: f };
    });
    musicState.source = 'files';
    musicState.loading = true;
    try {
      finishLibrary(await buildFromFiles(items, ''), 'files');
    } finally {
      musicState.loading = false;
    }
  };
  input.click();
}
async function scanFolderHandle(dir) {
  musicState.loading = true;
  musicState.folderName = dir.name;
  setMusicLoading(`Buscando canciones en «${dir.name}»…`);
  try {
    const items = await walkDir(dir);
    if (!items.length) {
      musicState.loading = false;
      renderMusicSetup('empty');
      return;
    }
    finishLibrary(await buildFromFiles(items, dir.name), 'folder');
  } catch (e) {
    renderMusicSetup('error', e?.message);
  } finally {
    musicState.loading = false;
  }
}
async function trackSrc(t) {
  if (t.src) return t.src;
  const h = musicState.files.get(t.id);
  if (!h) return '';
  const f = h instanceof File ? h : await h.getFile();
  if (musicState._objUrl) URL.revokeObjectURL(musicState._objUrl);
  musicState._objUrl = URL.createObjectURL(f);
  return musicState._objUrl;
}

/* ===========================================================================
   Índices: álbumes, artistas, géneros, carpetas
=========================================================================== */
function albumKeyOf(t) {
  if (!t.album) return 'f|' + mNorm(t.folder);
  return mNorm(t.album) + '|' + (t.albumArtist ? mNorm(t.albumArtist) : mNorm(t.folder));
}
function finishLibrary(tracks, source) {
  musicState.source = source;
  musicState.tracks = tracks;
  musicState.byId = new Map(tracks.map(t => [t.id, t]));
  musicState.byPath = new Map(tracks.map(t => [pathKey(t), t]));
  const albums = new Map(),
    artists = new Map(),
    genres = new Map(),
    folders = new Map();
  const node = path => {
    if (!folders.has(path)) {
      const parts = path ? path.split('/') : [];
      folders.set(path, { path, name: parts.at(-1) || 'Todas las carpetas', parent: parts.length ? parts.slice(0, -1).join('/') : null, children: new Set(), tracks: [], count: 0 });
      if (parts.length) node(parts.slice(0, -1).join('/')).children.add(path);
    }
    return folders.get(path);
  };
  node('');
  for (const t of tracks) {
    t.albumKey = albumKeyOf(t);
    let al = albums.get(t.albumKey);
    if (!al) {
      al = { key: t.albumKey, name: t.album || (t.folder ? t.folder.split('/').at(-1) : 'Sin álbum'), artists: new Set(), albumArtist: t.albumArtist, year: 0, tracks: [], art: '', added: 0, folder: t.folder };
      albums.set(t.albumKey, al);
    }
    al.tracks.push(t);
    if (t.artist) al.artists.add(t.artist);
    if (t.year) al.year = Math.max(al.year, t.year);
    if (!al.art && t.art) al.art = t.art;
    al.added = Math.max(al.added, t.added || 0);
    const an = trackArtist(t);
    const ak = mNorm(an);
    if (!artists.has(ak)) artists.set(ak, { key: ak, name: an, tracks: [], albums: new Set(), art: '' });
    const ar = artists.get(ak);
    ar.tracks.push(t);
    ar.albums.add(t.albumKey);
    if (!ar.art && t.art) ar.art = t.art;
    // Géneros: «Rock; Pop» o «Rock/Pop» cuentan en los dos.
    String(t.genre || '')
      .split(/\s*[;/,]\s*/)
      .filter(Boolean)
      .forEach(g => {
        const gk = mNorm(g);
        if (!genres.has(gk)) genres.set(gk, { key: gk, name: g, tracks: [] });
        genres.get(gk).tracks.push(t);
      });
    node(t.folder).tracks.push(t);
  }
  const byDiscTrack = (a, b) => (a.disc || 0) - (b.disc || 0) || (a.track || 0) - (b.track || 0) || musCollator.compare(a.title, b.title);
  albums.forEach(al => {
    al.tracks.sort(byDiscTrack);
    al.artist = al.albumArtist || (al.artists.size === 1 ? [...al.artists][0] : al.artists.size ? 'Varios artistas' : MUS_UNKNOWN_ARTIST);
  });
  // Cuántas canciones hay debajo de cada carpeta (recursivo).
  const countUnder = p => {
    const n = folders.get(p);
    n.count = n.tracks.length + [...n.children].reduce((s, c) => s + countUnder(c), 0);
    return n.count;
  };
  countUnder('');
  folders.forEach(f => f.tracks.sort((a, b) => musCollator.compare(a.file || a.title, b.file || b.title)));
  Object.assign(musicState, { albums, artists, genres, folders, loaded: true, loading: false });
  restoreMusicSession();
  document.dispatchEvent(new CustomEvent('music:library'));
  if (musicViewActive()) renderMusicScreen();
  updateMusicStrip();
}
function folderTracks(path) {
  if (!path) return musicState.tracks;
  return musicState.tracks.filter(t => t.folder === path || t.folder.startsWith(path + '/'));
}

/* ===========================================================================
   Reproducción
=========================================================================== */
const MUS_OPTS_DEFAULT = { shuffle: false, repeat: 'off' };
function musicOpts() {
  return { ...MUS_OPTS_DEFAULT, ...lsGet(MUS_KEYS.opts, {}) };
}
function setMusicOpt(k, v) {
  lsSet(MUS_KEYS.opts, { ...musicOpts(), [k]: v });
  updateMusicPlayerUI();
  document.dispatchEvent(new CustomEvent('music:queue'));
}
function musicAudio() {
  return $m('musicAudio');
}
let musicUserPaused = false,
  musicCounted = false,
  musicErrors = 0,
  musicInterrupted = 0,
  musicInterruptTimer = null,
  musicLastSave = 0,
  musicLastSync = 0;

function saveMusicQueue() {
  lsSet(MUS_KEYS.queue, musicState.queue.map(t => t.id));
  lsSet(MUS_KEYS.context, musicState.context.slice(0, 5000).map(t => t.id));
  document.dispatchEvent(new CustomEvent('music:queue'));
}
function saveMusicHistory() {
  lsSet(MUS_KEYS.history, musicState.history.slice(-100).map(t => t.id));
}
function saveMusicResume() {
  const a = musicAudio();
  const t = musicState.current;
  if (!t) return;
  lsSet(MUS_KEYS.resume, { id: t.id, pos: Number(a?.currentTime) || 0, at: Date.now() });
}
function restoreMusicSession() {
  const ids = x => (Array.isArray(x) ? x : []).map(resolveTrack).filter(Boolean);
  musicState.queue = ids(lsGet(MUS_KEYS.queue, []));
  musicState.history = ids(lsGet(MUS_KEYS.history, []));
  musicState.context = ids(lsGet(MUS_KEYS.context, []));
  if (!musicState.current) {
    const r = lsGet(MUS_KEYS.resume, null);
    const t = r && resolveTrack(r.id);
    if (t) {
      // Se deja preparada (sin sonar) donde estaba.
      prepareTrack(t, r.pos || 0);
    }
  }
}
function pushMusicHistory(t) {
  if (!t) return;
  musicState.history = [...musicState.history.filter(x => x.id !== t.id), t].slice(-100);
  saveMusicHistory();
}
// Estadísticas: veces escuchada y última vez (cuenta a los 30 s o a la mitad).
function musicStats() {
  if (!musicState._stats) musicState._stats = lsGet(MUS_KEYS.stats, {});
  return musicState._stats;
}
function trackPlays(t) {
  return Number(musicStats()[t.id]?.[0] || 0);
}
function trackLastPlayed(t) {
  return Number(musicStats()[t.id]?.[1] || 0);
}
function countMusicPlay(t) {
  const st = musicStats();
  const prev = st[t.id] || [0, 0];
  st[t.id] = [prev[0] + 1, Date.now()];
  const keys = Object.keys(st);
  if (keys.length > 6000) keys.sort((a, b) => st[a][1] - st[b][1]).slice(0, keys.length - 6000).forEach(k => delete st[k]);
  lsSet(MUS_KEYS.stats, st);
}
function pauseOtherAudio() {
  try {
    const pa = document.getElementById('podcastAudio');
    if (pa && !pa.paused) window.viferorNativePodcastPause ? window.viferorNativePodcastPause() : pa.pause();
  } catch {}
  try {
    const ra = document.getElementById('audioPlayer');
    if (ra && !ra.paused) window.viferorNativeRadioPause ? window.viferorNativeRadioPause() : ra.pause();
  } catch {}
}
async function prepareTrack(t, pos = 0) {
  const a = musicAudio();
  if (!a || !t) return;
  musicState.current = t;
  const src = await trackSrc(t);
  if (!src) return;
  a.preload = 'metadata';
  a.src = src;
  a.onloadedmetadata = () => {
    if (pos > 0 && pos < (a.duration || 0) - 2) a.currentTime = pos;
    updateMusicPlayerUI();
  };
  updateMusicNowUI();
}
async function startTrack(t, { pos = 0 } = {}) {
  const a = musicAudio();
  if (!a || !t) return;
  pauseOtherAudio();
  musicState.current = t;
  musicCounted = false;
  musicUserPaused = false;
  finMusicInterrupt();
  updateMusicNowUI();
  let src = '';
  try {
    src = await trackSrc(t);
  } catch {}
  if (!src) return musicTrackFailed(t);
  a.src = src;
  a.onloadedmetadata = () => {
    if (pos > 0 && pos < (a.duration || 0) - 2) a.currentTime = pos;
    // En el navegador la duración no viene en las etiquetas: se guarda al conocerla.
    if (!t.dur && Number.isFinite(a.duration)) {
      t.dur = a.duration;
      if (t.cacheKey) idbGet('meta', t.cacheKey).then(m => m && idbPut('meta', t.cacheKey, { ...m, dur: a.duration }));
    }
    updateMusicPlayerUI();
  };
  try {
    await a.play();
    musicErrors = 0;
  } catch (e) {
    if (e?.name !== 'AbortError') musicTrackFailed(t);
  }
  saveMusicResume();
  saveMusicQueue();
  syncMusicAndroid(true);
  updateMediaSession();
}
function musicTrackFailed(t) {
  try {
    window.logError?.('MUSIC_AUDIO', 'No se pudo reproducir ' + (t?.id || ''));
  } catch {}
  musicErrors++;
  podToast(`No se pudo reproducir «${t?.title || 'canción'}»`);
  if (musicErrors < 5 && musicState.queue.length) setTimeout(() => nextTrack(true), 1200);
}
function playTrackNow(t) {
  if (!t) return;
  if (musicState.current && musicState.current.id !== t.id) pushMusicHistory(musicState.current);
  musicState.queue = musicState.queue.filter(x => x.id !== t.id);
  saveMusicQueue();
  startTrack(t);
}
async function nextTrack(auto = false) {
  const o = musicOpts();
  const cur = musicState.current;
  if (auto && cur && o.repeat === 'one') return startTrack(cur);
  let next = musicState.queue.shift();
  if (!next && o.repeat === 'all' && musicState.context.length) {
    musicState.queue = o.shuffle ? shuffled(musicState.context) : [...musicState.context];
    next = musicState.queue.shift();
  }
  if (!next) {
    saveMusicQueue();
    if (!auto) podToast('No hay más canciones en la cola');
    else updateMusicPlayerUI();
    return;
  }
  if (cur && cur.id !== next.id) pushMusicHistory(cur);
  saveMusicQueue();
  return startTrack(next);
}
function prevTrack() {
  const a = musicAudio();
  const cur = musicState.current;
  if (a && cur && a.currentTime > 3) {
    a.currentTime = 0;
    return;
  }
  let prev = musicState.history.pop();
  while (prev && cur && prev.id === cur.id) prev = musicState.history.pop();
  saveMusicHistory();
  if (!prev) {
    if (a) a.currentTime = 0;
    return;
  }
  musicState.queue = musicState.queue.filter(x => x.id !== prev.id);
  if (cur) musicState.queue.unshift(cur);
  saveMusicQueue();
  startTrack(prev);
}
function toggleMusicPlay() {
  const a = musicAudio();
  if (!a) return;
  if (!musicState.current) {
    if (musicState.queue.length) nextTrack(false);
    else if (musicState.tracks.length) playCollection(musicState.tracks, 0, { shuffle: true });
    return;
  }
  if (a.paused) {
    pauseOtherAudio();
    musicUserPaused = false;
    finMusicInterrupt();
    if (!a.src) startTrack(musicState.current);
    else a.play().catch(() => {});
  } else {
    musicUserPaused = true;
    a.pause();
  }
}
// Reproducir una colección (álbum, carpeta, lista…) desde una canción.
// how: replace | next | end. Con aleatorio, el resto se baraja.
function playCollection(tracks, start = 0, { shuffle = null, how = 'replace', label = '' } = {}) {
  tracks = (tracks || []).filter(Boolean);
  if (!tracks.length) return podToast('No hay canciones');
  if (how !== 'replace') return queueTracks(tracks, how);
  if (shuffle !== null) setMusicOpt('shuffle', !!shuffle);
  const sh = musicOpts().shuffle;
  let first, rest;
  if (sh && shuffle === true) {
    const all = shuffled(tracks);
    first = all[0];
    rest = all.slice(1);
  } else {
    first = tracks[Math.max(0, Math.min(start, tracks.length - 1))];
    rest = sh ? shuffled(tracks.filter(t => t !== first)) : tracks.slice(tracks.indexOf(first) + 1);
  }
  const before = [...musicState.queue];
  musicState.context = [...tracks];
  musicState.queue = rest;
  playTrackNow(first);
  if (before.length > 3)
    podToast(label ? `Reproduciendo ${label}` : 'La cola se ha sustituido', {
      action: 'Deshacer',
      onAction: () => {
        musicState.queue = before;
        saveMusicQueue();
      }
    });
}
function queueTracks(tracks, how = 'end', { toast = true } = {}) {
  let items = tracks.filter(t => t && t.id !== musicState.current?.id);
  if (!items.length) return;
  if (how === 'next') {
    const ids = new Set(items.map(t => t.id));
    musicState.queue = musicState.queue.filter(t => !ids.has(t.id));
    musicState.queue.unshift(...items);
  } else {
    const have = new Set(musicState.queue.map(t => t.id));
    items = items.filter(t => !have.has(t.id));
    if (!items.length) return toast && podToast('Ya estaba en la cola');
    musicState.queue.push(...items);
  }
  saveMusicQueue();
  if (!musicState.current) nextTrack(false);
  else if (toast) podToast(how === 'next' ? `${plural(items.length, 'canción', 'canciones')} a continuación` : `${plural(items.length, 'canción añadida', 'canciones añadidas')} a la cola`);
}
function toggleMusicShuffle() {
  const on = !musicOpts().shuffle;
  if (on) {
    musicState.queue = shuffled(musicState.queue);
  } else if (musicState.context.length) {
    // Vuelve al orden original de lo que estabas escuchando.
    const pos = new Map(musicState.context.map((t, i) => [t.id, i]));
    musicState.queue = [...musicState.queue].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  }
  setMusicOpt('shuffle', on);
  saveMusicQueue();
  podToast(on ? '🔀 Aleatorio activado' : 'Aleatorio desactivado');
}
function cycleMusicRepeat() {
  const order = ['off', 'all', 'one'];
  const next = order[(order.indexOf(musicOpts().repeat) + 1) % 3];
  setMusicOpt('repeat', next);
  podToast({ off: 'Sin repetir', all: '🔁 Repetir todo', one: '🔂 Repetir esta canción' }[next]);
}

// Interrupciones (notificación, llamada…): como en la radio y los podcasts.
function finMusicInterrupt() {
  musicInterrupted = 0;
  clearInterval(musicInterruptTimer);
  musicInterruptTimer = null;
}
function startMusicInterrupt(a) {
  musicInterrupted = Date.now();
  clearInterval(musicInterruptTimer);
  musicInterruptTimer = setInterval(() => {
    if (!musicInterrupted || !a.paused) return finMusicInterrupt();
    const t = Date.now() - musicInterrupted;
    if (t > 15 * 60 * 1000) {
      finMusicInterrupt();
      musicUserPaused = true;
      syncMusicAndroid(true);
      updateMusicPlayerUI();
      return;
    }
    if (t >= 2500 && (window.rvPuedeReanudar ? window.rvPuedeReanudar(t) : t > 5000)) {
      finMusicInterrupt();
      a.play().catch(() => {});
    }
  }, 1500);
}

/* ---- Android (notificación) y teclas multimedia del navegador ---- */
function absUrl(u) {
  try {
    return u ? new URL(u, location.href).href : '';
  } catch {
    return '';
  }
}
function syncMusicAndroid(force = false) {
  try {
    const a = musicAudio();
    const t = musicState.current;
    if (!a || !t || !window.Android) return;
    const playing = (!a.paused && !a.ended) || !!musicInterrupted;
    const d = Number.isFinite(a.duration) ? a.duration : t.dur || 0;
    const pos = Number.isFinite(a.currentTime) ? a.currentTime : 0;
    if (force && typeof window.Android.startMusicMedia === 'function') {
      window.Android.setPlaybackSection?.('music');
      window.Android.startMusicMedia(t.title || 'Canción', trackSub(t) || 'Mi música', absUrl(t.art), d, pos, playing);
    } else if (typeof window.Android.updatePodcastMedia === 'function') {
      window.Android.updatePodcastMedia(d, pos, playing);
    }
  } catch {}
}
function updateMediaSession() {
  if (!('mediaSession' in navigator) || window.Android) return;
  const t = musicState.current;
  if (!t) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: trackArtist(t), album: t.album || '', artwork: t.art ? [{ src: absUrl(t.art) }] : [] });
    navigator.mediaSession.setActionHandler('play', () => toggleMusicPlay());
    navigator.mediaSession.setActionHandler('pause', () => toggleMusicPlay());
    navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack(false));
    navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack());
  } catch {}
}
window.viferorNativeMusicPlay = () => {
  musicUserPaused = false;
  const a = musicAudio();
  if (a && musicState.current) {
    pauseOtherAudio();
    a.play().catch(() => {});
  }
};
window.viferorNativeMusicPause = () => {
  finMusicInterrupt();
  musicUserPaused = true;
  musicAudio()?.pause();
};
window.viferorNativeMusicNext = () => nextTrack(false);
window.viferorNativeMusicPrevious = () => prevTrack();
window.viferorNativeMusicSeek = delta => {
  const a = musicAudio();
  if (a && Number.isFinite(a.currentTime)) a.currentTime = Math.max(0, Math.min(a.duration || Infinity, a.currentTime + (Number(delta) || 0)));
};
window.viferorNativeMusicSetPosition = ms => {
  const a = musicAudio();
  if (a && Number.isFinite(a.duration)) a.currentTime = Math.max(0, Math.min(a.duration, (Number(ms) || 0) / 1000));
};

/* ===========================================================================
   Listas de música (normales e inteligentes)
=========================================================================== */
const MUS_SMART_DEFAULTS = {
  source: 'all', // all | artists | albums | folders | genres
  picked: [], // claves elegidas (artistas, álbumes, carpetas o géneros)
  state: 'all', // all | never | played | recent | forgotten
  addedDays: 0,
  minMin: 0,
  maxMin: 0,
  yearFrom: 0,
  yearTo: 0,
  order: 'random',
  limit: 100
};
const MUS_SMART_LABELS = {
  source: { all: 'Toda mi música', artists: 'Artistas elegidos', albums: 'Álbumes elegidos', folders: 'Carpetas elegidas', genres: 'Géneros elegidos' },
  state: {
    all: 'Todas',
    never: 'Nunca escuchadas',
    played: 'Escuchadas alguna vez',
    recent: 'Escuchadas en los últimos 30 días',
    forgotten: 'Olvidadas (no escuchadas en 30 días)'
  },
  order: {
    random: 'Al azar',
    plays: 'Más escuchadas primero',
    lastPlayed: 'Escuchadas hace menos primero',
    added: 'Añadidas recientemente primero',
    title: 'Título (A-Z)',
    artist: 'Artista y álbum',
    album: 'Álbum (en su orden)',
    year: 'Año (más nuevas primero)',
    yearAsc: 'Año (más antiguas primero)',
    shortest: 'Más cortas primero',
    longest: 'Más largas primero'
  }
};
const MUS_SMART_TEMPLATES = [
  { icon: '🔥', name: 'Más escuchadas', hint: 'Tu top 50', rules: { state: 'played', order: 'plays', limit: 50 } },
  { icon: '🆕', name: 'Añadidas recientemente', hint: 'Lo que entró en los últimos 30 días', rules: { addedDays: 30, order: 'added', limit: 100 } },
  { icon: '✨', name: 'Nunca escuchadas', hint: 'Al azar', rules: { state: 'never', order: 'random', limit: 100 } },
  { icon: '🕸', name: 'Olvidadas', hint: 'Escuchadas antes, pero no en 30 días', rules: { state: 'forgotten', order: 'random', limit: 50 } },
  { icon: '🔀', name: 'Mezcla de 100', hint: 'Cien canciones al azar', rules: { order: 'random', limit: 100 } },
  { icon: '🛠', name: 'Personalizada', hint: 'Elige artistas, carpetas, géneros, años…', rules: {} }
];
function loadMusicLists() {
  const x = lsGet(MUS_KEYS.lists, []);
  musicState.lists = (Array.isArray(x) ? x : []).map(normMusicList).filter(Boolean);
}
function normMusicList(l) {
  if (!l || !l.name) return null;
  const out = { id: String(l.id || newListId()), name: String(l.name).slice(0, 80), type: l.type === 'smart' ? 'smart' : 'manual', createdAt: l.createdAt || Date.now(), updatedAt: l.updatedAt || Date.now() };
  if (out.type === 'smart') out.rules = { ...MUS_SMART_DEFAULTS, ...(l.rules || {}) };
  else out.items = (Array.isArray(l.items) ? l.items : []).filter(x => x && x.id).map(x => ({ id: x.id, title: x.title || '', artist: x.artist || '', album: x.album || '', folder: x.folder || '', file: x.file || '', dur: x.dur || 0 }));
  return out;
}
function saveMusicLists() {
  if (!lsSet(MUS_KEYS.lists, musicState.lists)) podToast('⚠️ No se pudo guardar: el almacenamiento está lleno');
  document.dispatchEvent(new CustomEvent('music:lists'));
}
function musicListById(id) {
  return musicState.lists.find(l => l.id === id) || null;
}
function createMusicList(name, tracks = []) {
  const l = normMusicList({ name, type: 'manual', items: tracks.map(minimalTrack) });
  musicState.lists.push(l);
  saveMusicLists();
  return l;
}
function addTracksToList(l, tracks) {
  const have = new Set(l.items.map(x => x.id));
  const add = tracks.filter(t => t && !have.has(t.id));
  l.items.push(...add.map(minimalTrack));
  l.updatedAt = Date.now();
  saveMusicLists();
  return { added: add.length, already: tracks.length - add.length };
}
// Canciones de una lista normal que siguen en la biblioteca (y cuántas faltan).
function manualListTracks(l) {
  const out = [];
  let missing = 0;
  l.items.forEach(x => {
    const t = resolveTrack(x);
    if (t) out.push(t);
    else missing++;
  });
  return { tracks: out, missing };
}
function smartPool(r) {
  const picked = new Set((r.picked || []).map(String));
  switch (r.source) {
    case 'artists':
      return musicState.tracks.filter(t => picked.has(mNorm(trackArtist(t))));
    case 'albums':
      return musicState.tracks.filter(t => picked.has(t.albumKey));
    case 'genres':
      return musicState.tracks.filter(t => String(t.genre || '').split(/\s*[;/,]\s*/).some(g => picked.has(mNorm(g))));
    case 'folders':
      return musicState.tracks.filter(t => [...picked].some(p => t.folder === p || t.folder.startsWith(p + '/')));
    default:
      return musicState.tracks;
  }
}
function resolveMusicSmart(rules) {
  const r = { ...MUS_SMART_DEFAULTS, ...rules };
  const now = Date.now(),
    DAY = 86400000;
  let list = smartPool(r).filter(t => {
    const plays = trackPlays(t),
      last = trackLastPlayed(t);
    if (r.state === 'never' && plays) return false;
    if (r.state === 'played' && !plays) return false;
    if (r.state === 'recent' && (!last || now - last > 30 * DAY)) return false;
    if (r.state === 'forgotten' && (!plays || now - last <= 30 * DAY)) return false;
    if (r.addedDays && (!t.added || now - t.added > r.addedDays * DAY)) return false;
    if (t.dur) {
      if (r.minMin && t.dur < r.minMin * 60) return false;
      if (r.maxMin && t.dur > r.maxMin * 60) return false;
    }
    if (r.yearFrom && (!t.year || t.year < r.yearFrom)) return false;
    if (r.yearTo && (!t.year || t.year > r.yearTo)) return false;
    return true;
  });
  const by = fn => list.sort(fn);
  const byAlbum = (a, b) => musCollator.compare(a.album || '', b.album || '') || (a.disc || 0) - (b.disc || 0) || (a.track || 0) - (b.track || 0);
  switch (r.order) {
    case 'plays': by((a, b) => trackPlays(b) - trackPlays(a) || trackLastPlayed(b) - trackLastPlayed(a)); break;
    case 'lastPlayed': by((a, b) => trackLastPlayed(b) - trackLastPlayed(a)); break;
    case 'added': by((a, b) => (b.added || 0) - (a.added || 0)); break;
    case 'title': by((a, b) => musCollator.compare(a.title, b.title)); break;
    case 'artist': by((a, b) => musCollator.compare(trackArtist(a), trackArtist(b)) || (b.year || 0) - (a.year || 0) || byAlbum(a, b)); break;
    case 'album': by(byAlbum); break;
    case 'year': by((a, b) => (b.year || 0) - (a.year || 0) || byAlbum(a, b)); break;
    case 'yearAsc': by((a, b) => (a.year || 9999) - (b.year || 9999) || byAlbum(a, b)); break;
    case 'shortest': by((a, b) => (a.dur || 1e9) - (b.dur || 1e9)); break;
    case 'longest': by((a, b) => (b.dur || 0) - (a.dur || 0)); break;
    default: list = shuffled(list);
  }
  return r.limit ? list.slice(0, r.limit) : list;
}
// Las inteligentes al azar no cambian cada vez que abres la lista (5 min).
const musSmartCache = new Map();
function musicListTracks(l, { fresh = false } = {}) {
  if (l.type !== 'smart') return manualListTracks(l).tracks;
  const sig = JSON.stringify(l.rules);
  const c = musSmartCache.get(l.id);
  if (!fresh && c && c.sig === sig && Date.now() - c.t < 300000 && c.n === musicState.tracks.length) return c.tracks;
  const tracks = resolveMusicSmart(l.rules);
  musSmartCache.set(l.id, { sig, t: Date.now(), n: musicState.tracks.length, tracks });
  return tracks;
}
function musicSmartSummary(r) {
  r = { ...MUS_SMART_DEFAULTS, ...r };
  const parts = [r.source === 'all' ? 'Toda mi música' : `${(r.picked || []).length} ${{ artists: 'artistas', albums: 'álbumes', folders: 'carpetas', genres: 'géneros' }[r.source]}`];
  if (r.state !== 'all') parts.push(MUS_SMART_LABELS.state[r.state].toLowerCase());
  if (r.addedDays) parts.push(`añadidas en ${r.addedDays} días`);
  if (r.minMin) parts.push(`más de ${r.minMin} min`);
  if (r.maxMin) parts.push(`menos de ${r.maxMin} min`);
  if (r.yearFrom || r.yearTo) parts.push(`años ${r.yearFrom || '…'}–${r.yearTo || '…'}`);
  parts.push(MUS_SMART_LABELS.order[r.order].toLowerCase());
  if (r.limit) parts.push(`máx. ${r.limit}`);
  return parts.join(' · ');
}
function chooseMusicListFor(tracks) {
  tracks = tracks.filter(Boolean);
  if (!tracks.length) return;
  const save = l => {
    const r = addTracksToList(l, tracks);
    podToast(r.added ? `${plural(r.added, 'canción añadida', 'canciones añadidas')} a «${l.name}»${r.already ? ` · ${r.already} ya estaban` : ''}` : `Ya estaba${tracks.length > 1 ? 'n' : ''} en «${l.name}»`, {
      action: 'Abrir',
      onAction: () => openMusicScreen('list:' + l.id)
    });
  };
  const createNew = async () => {
    const name = await podPromptText({ title: 'Nueva lista', label: 'Nombre de la lista', placeholder: 'Para correr, para el coche…', ok: 'Crear y añadir' });
    if (name) save(createMusicList(name));
  };
  const lists = musicState.lists.filter(l => l.type === 'manual');
  if (!lists.length) return createNew();
  podSheet({
    title: 'Añadir a una lista',
    subtitle: tracksSummary(tracks),
    items: [
      { icon: '＋', label: 'Nueva lista…', on: createNew },
      { sep: true },
      ...lists.map(l => {
        const inside = tracks.length === 1 && l.items.some(x => x.id === tracks[0].id);
        return { icon: '📃', label: l.name, hint: inside ? 'Ya está en esta lista' : plural(l.items.length, 'canción', 'canciones'), checked: inside, on: () => save(l) };
      })
    ]
  });
}
function downloadText(name, content, mime) {
  if (window.Android && typeof window.Android.saveTextFile === 'function') return window.Android.saveTextFile(name, content, mime);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function listSlug(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'lista';
}
function exportMusicList(l, format = 'json') {
  if (format === 'm3u') {
    // Rutas relativas (carpeta/archivo): las entienden VLC, Poweramp, foobar2000…
    const tracks = musicListTracks(l);
    const body = tracks.map(t => `#EXTINF:${Math.round(t.dur || -1)},${trackArtist(t)} - ${t.title}\n${t.folder ? t.folder + '/' : ''}${t.file || t.title}`).join('\n');
    return downloadText(`${listSlug(l.name)}.m3u8`, `#EXTM3U\n#PLAYLIST:${l.name}\n${body}\n`, 'audio/x-mpegurl');
  }
  downloadText(`radios-viferor-musica-${listSlug(l.name)}.json`, JSON.stringify({ type: 'radios-viferor-music-playlist', version: 1, exportedAt: new Date().toISOString(), list: l }, null, 2), 'application/json');
}
// M3U de otros reproductores: se buscan las canciones por carpeta y nombre de archivo.
function tracksFromM3u(text) {
  const byFile = new Map();
  musicState.tracks.forEach(t => {
    const k = mNorm(t.file);
    if (!byFile.has(k)) byFile.set(k, []);
    byFile.get(k).push(t);
  });
  const out = [];
  let missing = 0;
  String(text)
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('#'))
    .forEach(line => {
      const parts = line.replace(/\\/g, '/').split('/').filter(Boolean);
      const file = mNorm(decodeURIComponent(parts.pop() || ''));
      const parent = mNorm(decodeURIComponent(parts.pop() || ''));
      const cands = byFile.get(file) || [];
      const t = cands.find(c => mNorm(c.folder.split('/').at(-1)) === parent) || cands[0];
      if (t) out.push(t);
      else missing++;
    });
  return { tracks: out, missing };
}
function importMusicListFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.m3u,.m3u8,application/json,audio/x-mpegurl';
  input.onchange = () => {
    const f = input.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const text = String(r.result || '');
        if (/\.m3u8?$/i.test(f.name) || text.trimStart().startsWith('#EXTM3U')) {
          const { tracks, missing } = tracksFromM3u(text);
          if (!tracks.length) throw Error('Ninguna canción de esa lista está en tu música.');
          const name = (text.match(/^#PLAYLIST:(.+)$/m)?.[1] || stripExt(f.name)).trim();
          const l = createMusicList(name, tracks);
          podToast(`Lista «${l.name}»: ${plural(tracks.length, 'canción', 'canciones')}${missing ? ` · ${missing} no encontradas` : ''}`);
          return openMusicScreen('list:' + l.id);
        }
        const d = JSON.parse(text);
        const raw = d?.type === 'radios-viferor-music-playlist' ? [d.list] : Array.isArray(d?.lists) ? d.lists : [];
        const got = raw.map(x => normMusicList({ ...x, id: newListId() })).filter(Boolean);
        if (!got.length) throw Error('El archivo no contiene ninguna lista de música.');
        got.forEach(l => musicState.lists.push(l));
        saveMusicLists();
        podToast(got.length === 1 ? `Lista «${got[0].name}» importada` : `${got.length} listas importadas`);
        if (got.length === 1) openMusicScreen('list:' + got[0].id);
      } catch (e) {
        alert('No se pudo importar: ' + (e?.message || e));
      }
    };
    r.readAsText(f);
  };
  input.click();
}

/* ===========================================================================
   Navegación
=========================================================================== */
function openMusicScreen(screen, { replace = false } = {}) {
  if (!musicViewActive()) switchToMusic(true);
  const st = { ...(history.state || {}), musicScreen: screen };
  delete st.podcastScreen;
  if (replace) history.replaceState(st, '');
  else history.pushState(st, '');
  musicState.screen = screen;
  renderMusicScreen();
  const c = $m('musicContent');
  if (c && !replace) c.scrollTop = 0;
}
window.openMusicScreen = openMusicScreen;
function restoreMusicHistory(st) {
  if (!musicViewActive()) switchToMusic(true);
  musicState.screen = st?.musicScreen || 'tab';
  renderMusicScreen();
}
window.restoreMusicHistory = restoreMusicHistory;
function backFromMusic() {
  if (musicState.search) {
    setMusicSearch('');
    return;
  }
  if (musicState.screen !== 'tab') {
    if (history.state?.musicScreen) history.back();
    else {
      musicState.screen = 'tab';
      renderMusicScreen();
    }
    return;
  }
  switchToRadios();
}
window.backFromMusic = backFromMusic;
function switchToMusic(fromHistory = false) {
  ['viewFav', 'viewSearch', 'viewPodcasts'].forEach(id => $m(id)?.classList.remove('active'));
  $m('viewMusic')?.classList.add('active');
  document.body.classList.remove('podcasts-active', 'podcast-detail-active', 'podcast-subs-fullscreen', 'podcast-results-active', 'pod-adding');
  document.body.classList.add('music-active');
  document.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b.id === 'btnViewMusic'));
  window.closePodcastMineMenu?.();
  if (!fromHistory) {
    const st = { ...(history.state || {}), musicScreen: 'tab' };
    delete st.podcastScreen;
    history.pushState(st, '');
    musicState.screen = 'tab';
  }
  renderMusicScreen();
  ensureMusicLibrary();
}
window.switchToMusic = switchToMusic;
function setMusicTab(tab) {
  musicState.tab = tab;
  saveMusicUi({ tab });
  if (musicState.search) {
    musicState.search = '';
    if ($m('musSearch')) $m('musSearch').value = '';
  }
  document.querySelectorAll('#musTabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  if (musicState.screen !== 'tab') openMusicScreen('tab');
  else {
    renderMusicScreen();
    $m('musicContent').scrollTop = 0;
  }
}
let musSearchTimer = null;
function setMusicSearch(q) {
  musicState.search = q;
  if ($m('musSearch') && $m('musSearch').value !== q) $m('musSearch').value = q;
  renderMusicScreen();
}

/* ===========================================================================
   Pantallas
=========================================================================== */
function musEl(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function setMusicLoading(text) {
  const root = $m('musicContent');
  if (!root || !musicViewActive()) return;
  let l = root.querySelector('.pod-loading.mus-loading');
  if (!l) {
    root.replaceChildren();
    l = musEl('div', 'pod-loading mus-loading');
    root.append(l);
  }
  l.textContent = text;
}
function renderMusicSetup(state, detail = '') {
  musicState.setup = state;
  const root = $m('musicContent');
  if (!root || !musicViewActive()) return;
  const T = {
    ask: ['🎵', 'Tu música, aquí', 'Para ver las canciones guardadas en el móvil, Radios Viferor necesita permiso para leer «Música y audio». No se sube nada a internet: todo se queda en el móvil.', [['🔓 Permitir acceso a la música', () => window.Android.requestMusicPermission(), 'primary']]],
    denied: ['🔒', 'Sin permiso', 'Sin el permiso de «Música y audio» no se pueden leer tus canciones.', [['🔓 Volver a pedir permiso', () => window.Android.requestMusicPermission(), 'primary']]],
    blocked: ['🔒', 'Permiso desactivado', 'Android ya no deja volver a preguntarlo. Ábrelo en Ajustes → Permisos → «Música y audio» → Permitir, y vuelve aquí.', [['⚙️ Abrir los ajustes de la app', () => window.Android.openAppSettings(), 'primary']]],
    'old-apk': ['⬆️', 'Actualiza la app', 'Para leer la música del móvil hace falta la versión 1.10.0 o posterior de la app Android (la parte web ya está al día). Instala el APK nuevo encima del actual: tus radios, podcasts y listas se conservan.', []],
    pick: ['📁', 'Elige tu carpeta de música', window.showDirectoryPicker ? 'Elige la carpeta donde guardas tu música. Se recordará para la próxima vez (solo en este navegador). Los archivos no salen de tu ordenador.' : 'Elige la carpeta donde guardas tu música. En este navegador hay que elegirla en cada visita (en Chrome o Edge se recuerda). Los archivos no salen de tu ordenador.', [['📁 Elegir carpeta', pickMusicFolder, 'primary']]],
    regrant: ['📁', `Tu carpeta «${musicState.folderName}»`, 'El navegador pide confirmar otra vez el acceso a la carpeta de música.', [[`🔓 Permitir acceso a «${musicState.folderName}»`, regrantMusicFolder, 'primary'], ['📁 Elegir otra carpeta', pickMusicFolder]]],
    empty: ['🔍', 'No se ha encontrado música', isAndroidApp() ? 'Android no tiene canciones registradas en el móvil. Copia tu música (mp3, m4a, flac, ogg…) a la carpeta «Music» y vuelve a buscar.' : 'Esa carpeta no tiene archivos de música (mp3, m4a, flac, ogg, opus, wav…).', [[isAndroidApp() ? '🔄 Volver a buscar' : '📁 Elegir otra carpeta', () => (isAndroidApp() ? ensureMusicLibrary(true) : pickMusicFolder()), 'primary']]],
    error: ['⚠️', 'No se pudo leer la música', detail || 'Error desconocido', [['🔄 Reintentar', () => ensureMusicLibrary(true), 'primary']]]
  }[state] || ['🎵', 'Mi música', '', []];
  const box = musEl('div', 'pod-empty mus-setup', `<div>${T[0]}</div><h3>${pEsc(T[1])}</h3><p>${pEsc(T[2])}</p>`);
  const acts = musEl('div', 'pod-empty-actions');
  T[3].forEach(([label, fn, cls]) => {
    const b = musEl('button', cls || '', pEsc(label));
    b.type = 'button';
    b.onclick = fn;
    acts.append(b);
  });
  box.append(acts);
  root.replaceChildren(box);
}
async function regrantMusicFolder() {
  const dir = await idbGet('kv', 'dir');
  if (!dir) return pickMusicFolder();
  try {
    if ((await dir.requestPermission({ mode: 'read' })) === 'granted') return scanFolderHandle(dir);
  } catch {}
  podToast('Sin permiso para esa carpeta');
}
async function ensureMusicLibrary(force = false) {
  if (musicState.loading || (musicState.loaded && !force)) return;
  if (isAndroidApp()) {
    if (!androidMusicApi()) return renderMusicSetup('old-apk');
    let st = 'ask';
    try {
      st = window.Android.musicPermissionStatus();
    } catch {}
    if (st !== 'granted') return renderMusicSetup(st === 'blocked' ? 'blocked' : 'ask');
    musicState.loading = true;
    setMusicLoading('Buscando música en el móvil…');
    try {
      const tracks = await loadAndroidLibrary();
      musicState.loading = false;
      if (!tracks.length) return renderMusicSetup('empty');
      finishLibrary(tracks, 'android');
    } catch (e) {
      musicState.loading = false;
      renderMusicSetup(e?.message === 'permission' ? 'ask' : 'error', e?.message);
    }
    return;
  }
  if (force && musicState.source === 'files') return pickMusicFolder();
  const dir = await idbGet('kv', 'dir');
  if (dir && typeof dir.queryPermission === 'function') {
    musicState.folderName = dir.name;
    let p = 'prompt';
    try {
      p = await dir.queryPermission({ mode: 'read' });
    } catch {}
    if (p === 'granted') return scanFolderHandle(dir);
    return renderMusicSetup('regrant');
  }
  renderMusicSetup('pick');
}
window.onAndroidMusicPermission = granted => {
  if (granted) ensureMusicLibrary(true);
  else renderMusicSetup(window.Android?.musicPermissionStatus?.() === 'blocked' ? 'blocked' : 'denied');
};

function renderMusicScreen() {
  const root = $m('musicContent');
  if (!root) return;
  document.querySelectorAll('#musTabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === musicState.tab));
  if (!musicState.loaded) {
    if (!musicState.loading && musicState.setup) renderMusicSetup(musicState.setup);
    else if (!musicState.loading) setMusicLoading('Cargando…');
    return;
  }
  if (!musicState.tracks.length) return renderMusicSetup('empty');
  const s = musicState.screen || 'tab';
  root.replaceChildren();
  document.body.classList.toggle('mus-detail', s !== 'tab' && !musicState.search);
  if (musicState.search) return renderMusicSearch(root, musicState.search);
  if (s === 'tab') return renderMusicTab(root, musicState.tab);
  const [kind, ...rest] = s.split(':');
  const key = rest.join(':');
  if (kind === 'album') return renderAlbum(root, key);
  if (kind === 'artist') return renderArtist(root, key);
  if (kind === 'folder') return renderFolder(root, key, true);
  if (kind === 'genre') return renderGenre(root, key);
  if (kind === 'list') return renderMusicList(root, key);
  if (kind === 'queue') return renderMusicQueue(root);
  renderMusicTab(root, musicState.tab);
}

// ---- piezas comunes
function musArtHtml(art, name, cls = '') {
  const hue = [...String(name || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 11);
  return `<span class="mus-art ${cls}" style="--ph:${hue}"><span>${pEsc(podcastInitials(name || '♪'))}</span>${art ? `<img src="${pEsc(art)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}</span>`;
}
function trackRow(t, i, o = {}) {
  const row = musEl('div', 'pod-qrow mus-row' + (o.noArt ? ' mus-numbered' : '') + (musicState.current?.id === t.id ? ' is-current' : ''));
  row.dataset.id = t.id;
  const lead = o.handle ? '<button class="pod-qhandle" type="button" aria-label="Arrastrar para cambiar el orden">⠿</button>' : '';
  const num = o.num != null ? `<span class="qnum">${o.num}</span>` : '';
  const art = o.noArt ? '' : musArtHtml(t.art, t.album || t.title, 'mus-art-s');
  row.innerHTML = `${lead}${num}${art}<div class="pod-qinfo"><strong>${pEsc(t.title)}</strong><small>${pEsc(o.sub != null ? o.sub : trackSub(t))}</small></div><span class="mus-dur">${pEsc(fmtDur(t.dur))}</span><div class="pod-qbtns">${o.onRemove ? '<button class="pod-qdel" type="button" aria-label="Quitar">✕</button>' : ''}<button class="pod-qmenu" type="button" aria-label="Más opciones">⋯</button></div>`;
  row.querySelector('.pod-qinfo').onclick = () => (o.onPlay ? o.onPlay(i) : playTrackNow(t));
  const art2 = row.querySelector('.mus-art');
  if (art2) art2.onclick = row.querySelector('.pod-qinfo').onclick;
  row.querySelector('.pod-qmenu').onclick = () => openTrackMenu(t, { extra: o.menuExtra ? o.menuExtra(t, i) : [] });
  if (o.onRemove) row.querySelector('.pod-qdel').onclick = () => o.onRemove(i);
  return row;
}
// Listas largas: se pintan a trozos según bajas.
function appendRowsChunked(container, items, make, chunk = 120) {
  let i = 0;
  const sentinel = musEl('div', 'mus-sentinel');
  container.append(sentinel);
  let io = null;
  const more = () => {
    const end = Math.min(items.length, i + chunk);
    const frag = document.createDocumentFragment();
    for (; i < end; i++) frag.append(make(items[i], i));
    sentinel.before(frag);
    if (i >= items.length) {
      io?.disconnect();
      sentinel.remove();
    }
  };
  more();
  if (i < items.length && 'IntersectionObserver' in window) {
    io = new IntersectionObserver(es => es.some(e => e.isIntersecting) && more(), { root: $m('musicContent'), rootMargin: '800px' });
    io.observe(sentinel);
  } else while (i < items.length) more();
}
function collectionActions(tracks, { label = '', smart = null, more = null } = {}) {
  const has = tracks.length > 0;
  return actionBar([
    ['▶ Reproducir', () => playCollection(tracks, 0, { shuffle: false, label }), 'primary', !has],
    ['🔀 Aleatorio', () => playCollection(tracks, 0, { shuffle: true, label }), '', !has],
    ['⏭ A continuación', () => queueTracks(tracks, 'next'), '', !has],
    ['➕ A la cola', () => queueTracks(tracks, 'end'), '', !has],
    more ? ['⋯ Más', more] : ['📃 A una lista', () => chooseMusicListFor(tracks), '', !has]
  ]);
}
function collectionMenu(title, tracks, { smart = null } = {}) {
  podSheet({
    title,
    subtitle: tracksSummary(tracks),
    items: [
      { icon: '▶', label: 'Reproducir', on: () => playCollection(tracks, 0, { shuffle: false, label: title }) },
      { icon: '🔀', label: 'Reproducir en aleatorio', on: () => playCollection(tracks, 0, { shuffle: true, label: title }) },
      { icon: '⏭', label: 'Reproducir a continuación', on: () => queueTracks(tracks, 'next') },
      { icon: '➕', label: 'Añadir al final de la cola', on: () => queueTracks(tracks, 'end') },
      { icon: '📃', label: 'Guardar en una lista…', on: () => chooseMusicListFor(tracks) },
      smart && { icon: '✨', label: 'Crear lista inteligente con esto', hint: 'Por ejemplo: solo lo no escuchado, al azar', on: () => openMusicSmartEditor(null, { name: title, rules: smart }) }
    ]
  });
}
function detailHead(title, sub, art, { round = false, onMore = null } = {}) {
  const h = musEl('div', 'pod-section-title pod-detail-head mus-head');
  h.innerHTML = `<button class="pod-back-btn" type="button">← Volver</button><div class="mus-head-top">${art !== null ? musArtHtml(art, title, 'mus-art-l' + (round ? ' round' : '')) : ''}<div class="pod-detail-title"><h2>${pEsc(title)}</h2>${sub ? `<p class="pod-list-sub">${pEsc(sub)}</p>` : ''}</div>${onMore ? '<button class="mus-head-more" type="button" aria-label="Más opciones">⋯</button>' : ''}</div>`;
  h.querySelector('.pod-back-btn').onclick = backFromMusic;
  if (onMore) h.querySelector('.mus-head-more').onclick = onMore;
  return h;
}
function tabHead(title, count, extraHtml = '') {
  return musEl('div', 'mus-tab-head', `<h2>${title} <span>${count}</span></h2>${extraHtml}`);
}
function sortSelect(id, options, value) {
  return `<select id="${id}" class="mus-sort" aria-label="Ordenar">${options.map(([v, t]) => `<option value="${v}"${v === value ? ' selected' : ''}>${pEsc(t)}</option>`).join('')}</select>`;
}

// ---- pestañas
function sortedSongs(sort) {
  const list = [...musicState.tracks];
  const byAlbum = (a, b) => musCollator.compare(a.album || '', b.album || '') || (a.disc || 0) - (b.disc || 0) || (a.track || 0) - (b.track || 0);
  const f = {
    title: (a, b) => musCollator.compare(a.title, b.title),
    artist: (a, b) => musCollator.compare(trackArtist(a), trackArtist(b)) || byAlbum(a, b),
    album: (a, b) => byAlbum(a, b),
    added: (a, b) => (b.added || 0) - (a.added || 0),
    plays: (a, b) => trackPlays(b) - trackPlays(a) || musCollator.compare(a.title, b.title),
    dur: (a, b) => (b.dur || 0) - (a.dur || 0),
    folder: (a, b) => musCollator.compare(a.folder, b.folder) || musCollator.compare(a.file, b.file)
  }[sort];
  return list.sort(f || ((a, b) => musCollator.compare(a.title, b.title)));
}
function renderMusicTab(root, tab) {
  const ui = musicUi();
  if (tab === 'songs') {
    const list = sortedSongs(ui.songSort);
    root.append(
      tabHead(
        '🎵 Canciones',
        list.length,
        sortSelect('musSongSort', [['title', 'Título'], ['artist', 'Artista'], ['album', 'Álbum'], ['added', 'Añadidas recientemente'], ['plays', 'Más escuchadas'], ['dur', 'Más largas'], ['folder', 'Carpeta']], ui.songSort)
      )
    );
    root.querySelector('#musSongSort').onchange = e => {
      saveMusicUi({ songSort: e.target.value });
      renderMusicScreen();
    };
    root.append(collectionActions(list, { label: 'todas las canciones' }));
    const box = musEl('div', 'pod-queue');
    root.append(box);
    appendRowsChunked(box, list, (t, i) => trackRow(t, i, { onPlay: k => playCollection(list, k) }));
  } else if (tab === 'albums') {
    let albums = [...musicState.albums.values()];
    const s = ui.albumSort;
    albums.sort(
      s === 'artist' ? (a, b) => musCollator.compare(a.artist, b.artist) || (b.year || 0) - (a.year || 0) : s === 'year' ? (a, b) => (b.year || 0) - (a.year || 0) || musCollator.compare(a.name, b.name) : s === 'added' ? (a, b) => b.added - a.added : (a, b) => musCollator.compare(a.name, b.name)
    );
    root.append(tabHead('💿 Álbumes', albums.length, sortSelect('musAlbumSort', [['name', 'Nombre'], ['artist', 'Artista'], ['year', 'Año'], ['added', 'Añadidos recientemente']], s)));
    root.querySelector('#musAlbumSort').onchange = e => {
      saveMusicUi({ albumSort: e.target.value });
      renderMusicScreen();
    };
    root.append(albumGrid(albums));
  } else if (tab === 'artists') {
    const artists = [...musicState.artists.values()].sort((a, b) => (a.name === MUS_UNKNOWN_ARTIST) - (b.name === MUS_UNKNOWN_ARTIST) || musCollator.compare(a.name, b.name));
    root.append(tabHead('🎤 Artistas', artists.length));
    const box = musEl('div', 'mus-list');
    root.append(box);
    appendRowsChunked(box, artists, ar => listRow(musArtHtml(ar.art, ar.name, 'mus-art-s round'), ar.name, `${plural(ar.albums.size, 'álbum', 'álbumes')} · ${plural(ar.tracks.length, 'canción', 'canciones')}`, () => openMusicScreen('artist:' + ar.key), () => collectionMenu(ar.name, artistTracks(ar), { smart: { source: 'artists', picked: [ar.key] } })));
  } else if (tab === 'folders') {
    renderFolder(root, '', false);
  } else if (tab === 'genres') {
    const genres = [...musicState.genres.values()].sort((a, b) => musCollator.compare(a.name, b.name));
    root.append(tabHead('🏷️ Géneros', genres.length));
    if (!genres.length) root.append(musEl('div', 'pod-empty pod-empty-small', '<p>Tus canciones no tienen el género indicado en sus etiquetas.</p>'));
    const box = musEl('div', 'mus-list');
    genres.forEach(g => box.append(listRow('<span class="mus-ic">🏷️</span>', g.name, plural(g.tracks.length, 'canción', 'canciones'), () => openMusicScreen('genre:' + g.key), () => collectionMenu(g.name, g.tracks, { smart: { source: 'genres', picked: [g.key] } }))));
    root.append(box);
  } else if (tab === 'lists') {
    renderMusicListsTab(root);
  }
}
function listRow(leadHtml, title, sub, onOpen, onMenu) {
  const r = musEl('div', 'pod-list-card mus-list-row');
  r.innerHTML = `<button class="pod-list-open" type="button">${leadHtml}<span class="tx"><strong>${pEsc(title)}</strong><small>${pEsc(sub)}</small></span></button>${onMenu ? '<button class="pod-list-more" type="button" aria-label="Más opciones">⋯</button>' : ''}`;
  r.querySelector('.pod-list-open').onclick = onOpen;
  if (onMenu) r.querySelector('.pod-list-more').onclick = onMenu;
  return r;
}
function albumGrid(albums) {
  const g = musEl('div', 'pod-tiles mus-albums');
  appendRowsChunked(g, albums, al => {
    const b = musEl('button', 'pod-tile mus-album');
    b.type = 'button';
    b.innerHTML = `${musArtHtml(al.art, al.name, 'mus-art-tile')}<span class="pod-tile-title">${pEsc(al.name)}</span><small class="mus-tile-sub">${pEsc([al.artist, al.year || ''].filter(Boolean).join(' · '))}</small>`;
    b.onclick = () => openMusicScreen('album:' + al.key);
    return b;
  }, 60);
  return g;
}
function artistTracks(ar) {
  const order = [...ar.albums].map(k => musicState.albums.get(k)).filter(Boolean).sort((a, b) => (b.year || 0) - (a.year || 0) || musCollator.compare(a.name, b.name));
  const key = mNorm(ar.name);
  return order.flatMap(al => al.tracks.filter(t => mNorm(trackArtist(t)) === key));
}

// ---- detalle
function renderAlbum(root, key) {
  const al = musicState.albums.get(key);
  if (!al) return renderMusicTab(root, musicState.tab);
  const tr = al.tracks;
  root.append(detailHead(al.name, [al.artist, al.year || '', tracksSummary(tr)].filter(Boolean).join(' · '), al.art, { onMore: () => collectionMenu(al.name, tr, { smart: { source: 'albums', picked: [al.key] } }) }));
  root.append(collectionActions(tr, { label: `«${al.name}»` }));
  const box = musEl('div', 'pod-queue');
  const multiArtist = al.artists.size > 1;
  tr.forEach((t, i) => box.append(trackRow(t, i, { num: t.track || i + 1, noArt: true, sub: multiArtist ? trackArtist(t) : fmtDiscFolder(t, al), onPlay: k => playCollection(tr, k) })));
  root.append(box);
}
function fmtDiscFolder(t, al) {
  return t.disc > 1 || [...new Set(al.tracks.map(x => x.disc))].length > 1 ? `Disco ${t.disc || 1}` : trackArtist(t);
}
function renderArtist(root, key) {
  const ar = musicState.artists.get(key);
  if (!ar) return renderMusicTab(root, musicState.tab);
  const tr = artistTracks(ar);
  root.append(detailHead(ar.name, `${plural(ar.albums.size, 'álbum', 'álbumes')} · ${tracksSummary(tr)}`, ar.art, { round: true, onMore: () => collectionMenu(ar.name, tr, { smart: { source: 'artists', picked: [ar.key] } }) }));
  root.append(collectionActions(tr, { label: ar.name }));
  const albums = [...ar.albums].map(k => musicState.albums.get(k)).filter(Boolean).sort((a, b) => (b.year || 0) - (a.year || 0));
  if (albums.length > 1 || albums[0]?.tracks.length !== tr.length) {
    root.append(musEl('h3', 'pod-list-h', 'Álbumes'));
    root.append(albumGrid(albums));
  }
  root.append(musEl('h3', 'pod-list-h', 'Canciones'));
  const box = musEl('div', 'pod-queue');
  tr.forEach((t, i) => box.append(trackRow(t, i, { sub: [t.album, t.year || ''].filter(Boolean).join(' · '), onPlay: k => playCollection(tr, k) })));
  root.append(box);
}
function renderGenre(root, key) {
  const g = musicState.genres.get(key);
  if (!g) return renderMusicTab(root, musicState.tab);
  root.append(detailHead(g.name, tracksSummary(g.tracks), null, { onMore: () => collectionMenu(g.name, g.tracks, { smart: { source: 'genres', picked: [g.key] } }) }));
  root.append(collectionActions(g.tracks, { label: g.name }));
  const box = musEl('div', 'pod-queue');
  root.append(box);
  appendRowsChunked(box, g.tracks, (t, i) => trackRow(t, i, { onPlay: k => playCollection(g.tracks, k) }));
}
function renderFolder(root, path, pushed) {
  const F = musicState.folders;
  // En la raíz se baja solo mientras haya una única subcarpeta sin canciones.
  if (!pushed) {
    let n = F.get('');
    while (n && n.children.size === 1 && !n.tracks.length) n = F.get([...n.children][0]);
    path = n?.path || '';
  }
  const node = F.get(path);
  if (!node) return renderMusicTab(root, 'songs');
  const all = folderTracks(path);
  const crumbs = path ? path.split('/') : [];
  if (pushed) root.append(detailHead(node.name, tracksSummary(all), null, { onMore: () => collectionMenu(node.name, all, { smart: path ? { source: 'folders', picked: [path] } : null }) }));
  else root.append(tabHead('📁 Carpetas', node.count));
  if (crumbs.length) {
    const bc = musEl('nav', 'mus-crumbs');
    bc.setAttribute('aria-label', 'Ruta');
    crumbs.forEach((c, i) => {
      const p = crumbs.slice(0, i + 1).join('/');
      const b = musEl('button', i === crumbs.length - 1 ? 'on' : '', pEsc(c));
      b.type = 'button';
      b.onclick = () => p !== path && openMusicScreen('folder:' + p);
      bc.append(b);
    });
    root.append(bc);
  }
  root.append(collectionActions(all, { label: `la carpeta «${node.name}»` }));
  const subs = [...node.children].map(p => F.get(p)).sort((a, b) => musCollator.compare(a.name, b.name));
  if (subs.length) {
    const box = musEl('div', 'mus-list');
    subs.forEach(sf => box.append(listRow('<span class="mus-ic">📁</span>', sf.name, plural(sf.count, 'canción', 'canciones'), () => openMusicScreen('folder:' + sf.path), () => collectionMenu(sf.name, folderTracks(sf.path), { smart: { source: 'folders', picked: [sf.path] } }))));
    root.append(box);
  }
  if (node.tracks.length) {
    if (subs.length) root.append(musEl('h3', 'pod-list-h', 'Canciones de esta carpeta'));
    const box = musEl('div', 'pod-queue');
    root.append(box);
    appendRowsChunked(box, node.tracks, (t, i) => trackRow(t, i, { sub: [trackArtist(t), t.file].filter(Boolean).join(' · '), onPlay: k => playCollection(node.tracks, k) }));
  }
}
function renderMusicSearch(root, q) {
  const words = mNorm(q).split(/\s+/).filter(Boolean);
  const hay = (...vals) => {
    const h = mNorm(vals.join(' '));
    return words.every(w => h.includes(w));
  };
  const songs = musicState.tracks.filter(t => hay(t.title, t.artist, t.album, t.file, t.genre)).sort((a, b) => musCollator.compare(a.title, b.title));
  const albums = [...musicState.albums.values()].filter(a => hay(a.name, a.artist));
  const artists = [...musicState.artists.values()].filter(a => hay(a.name));
  const folders = [...musicState.folders.values()].filter(f => f.path && hay(f.name));
  root.append(tabHead(`🔎 «${pEsc(q)}»`, songs.length + albums.length + artists.length + folders.length));
  if (!songs.length && !albums.length && !artists.length && !folders.length) {
    root.append(musEl('div', 'pod-empty pod-empty-small', '<p>No hay nada que coincida.</p>'));
    return;
  }
  if (artists.length) {
    root.append(musEl('h3', 'pod-list-h', 'Artistas'));
    const box = musEl('div', 'mus-list');
    artists.slice(0, 20).forEach(ar => box.append(listRow(musArtHtml(ar.art, ar.name, 'mus-art-s round'), ar.name, plural(ar.tracks.length, 'canción', 'canciones'), () => openMusicScreen('artist:' + ar.key))));
    root.append(box);
  }
  if (albums.length) {
    root.append(musEl('h3', 'pod-list-h', 'Álbumes'));
    root.append(albumGrid(albums.slice(0, 30)));
  }
  if (folders.length) {
    root.append(musEl('h3', 'pod-list-h', 'Carpetas'));
    const box = musEl('div', 'mus-list');
    folders.slice(0, 20).forEach(f => box.append(listRow('<span class="mus-ic">📁</span>', f.name, `${f.path} · ${plural(f.count, 'canción', 'canciones')}`, () => openMusicScreen('folder:' + f.path))));
    root.append(box);
  }
  if (songs.length) {
    root.append(musEl('h3', 'pod-list-h', `Canciones <small>${songs.length}</small>`));
    root.append(collectionActions(songs, { label: 'los resultados' }));
    const box = musEl('div', 'pod-queue');
    root.append(box);
    appendRowsChunked(box, songs, (t, i) => trackRow(t, i, { onPlay: k => playCollection(songs, k) }));
  }
}

// ---- menú de canción
function openTrackMenu(t, { extra = [] } = {}) {
  const cur = musicState.current?.id === t.id;
  const inQ = musicState.queue.some(x => x.id === t.id);
  const ar = musicState.artists.get(mNorm(trackArtist(t)));
  podSheet({
    title: t.title,
    subtitle: [trackArtist(t), t.album, fmtDur(t.dur)].filter(Boolean).join(' · '),
    items: [
      !cur && { icon: '▶', label: 'Reproducir ahora', on: () => playTrackNow(t) },
      !cur && { icon: '⏭', label: 'Reproducir a continuación', on: () => queueTracks([t], 'next') },
      !cur && !inQ && { icon: '➕', label: 'Añadir al final de la cola', on: () => queueTracks([t], 'end') },
      !cur && inQ && {
        icon: '✕',
        label: 'Quitar de la cola',
        on: () => {
          musicState.queue = musicState.queue.filter(x => x.id !== t.id);
          saveMusicQueue();
        }
      },
      { icon: '📃', label: 'Añadir a una lista…', on: () => chooseMusicListFor([t]) },
      t.albumKey && musicState.albums.has(t.albumKey) && { icon: '💿', label: `Ir al álbum «${musicState.albums.get(t.albumKey).name}»`, on: () => openMusicScreen('album:' + t.albumKey) },
      ar && { icon: '🎤', label: `Ir a ${ar.name}`, on: () => openMusicScreen('artist:' + ar.key) },
      t.folder && { icon: '📁', label: 'Ir a la carpeta', hint: t.folder, on: () => openMusicScreen('folder:' + t.folder) },
      { icon: 'ℹ️', label: 'Información', on: () => trackInfo(t) },
      ...(extra.length ? [{ sep: true }, ...extra] : [])
    ]
  });
}
function trackInfo(t) {
  const plays = trackPlays(t),
    last = trackLastPlayed(t);
  const rows = [
    ['Título', t.title],
    ['Artista', trackArtist(t)],
    ['Álbum', t.album],
    ['Artista del álbum', t.albumArtist],
    ['Pista', t.track ? (t.disc ? `${t.disc}-` : '') + t.track : ''],
    ['Año', t.year || ''],
    ['Género', t.genre],
    ['Duración', fmtDur(t.dur)],
    ['Carpeta', t.folder],
    ['Archivo', t.file],
    ['Tamaño', t.size ? (t.size / 1048576).toFixed(1).replace('.', ',') + ' MB' : ''],
    ['Escuchada', plays ? `${plural(plays, 'vez', 'veces')} · última: ${new Date(last).toLocaleDateString('es-ES')}` : 'Nunca']
  ].filter(r => r[1]);
  const body = musEl('dl', 'mus-info', rows.map(([k, v]) => `<dt>${pEsc(k)}</dt><dd>${pEsc(v)}</dd>`).join(''));
  podSheet({ title: 'Información', body, cancel: 'Cerrar' });
}

/* ===========================================================================
   Listas: pestaña, detalle y editor
=========================================================================== */
function renderMusicListsTab(root) {
  root.append(tabHead('📃 Listas', musicState.lists.length));
  root.append(
    actionBar([
      ['＋ Nueva lista', newMusicListFlow, 'primary'],
      ['✨ Lista inteligente', newMusicSmartFlow],
      ['📥 Importar (M3U o JSON)', importMusicListFile]
    ])
  );
  const box = musEl('div', 'pod-lists');
  const q = musicState.queue;
  const qc = musEl('div', 'pod-list-card is-queue');
  qc.innerHTML = `<button class="pod-list-open" type="button"><span class="ic">☰</span><span class="tx"><strong>Cola</strong><small>${q.length ? pEsc(tracksSummary(q)) + (q[0] ? ` · Siguiente: ${pEsc(q[0].title)}` : '') : 'Vacía'}</small></span></button>`;
  qc.querySelector('.pod-list-open').onclick = () => openMusicScreen('queue');
  box.append(qc);
  musicState.lists.forEach(l => {
    const c = musEl('div', 'pod-list-card');
    const n = l.type === 'smart' ? musicListTracks(l).length : manualListTracks(l).tracks.length;
    c.innerHTML = `<button class="pod-list-open" type="button"><span class="ic">${l.type === 'smart' ? '✨' : '📃'}</span><span class="tx"><strong>${pEsc(l.name)}</strong><small>${pEsc(l.type === 'smart' ? `${plural(n, 'canción', 'canciones')} · ${musicSmartSummary(l.rules)}` : plural(n, 'canción', 'canciones'))}</small></span></button><button class="pod-list-play" type="button" aria-label="Reproducir">▶</button><button class="pod-list-more" type="button" aria-label="Más opciones">⋯</button>`;
    c.querySelector('.pod-list-open').onclick = () => openMusicScreen('list:' + l.id);
    c.querySelector('.pod-list-play').onclick = () => playCollection(musicListTracks(l, { fresh: true }), 0, { shuffle: false, label: `«${l.name}»` });
    c.querySelector('.pod-list-more').onclick = () => musicListMenu(l);
    box.append(c);
  });
  root.append(box);
  if (!musicState.lists.length)
    root.append(
      musEl(
        'div',
        'pod-empty pod-empty-small',
        '<p><b>Una lista normal</b> guarda las canciones que eliges, en el orden que quieras. <b>Una inteligente</b> se llena sola: «nunca escuchadas», «más escuchadas», «solo estos artistas», «años 80»… También puedes importar listas M3U de otros reproductores.</p>'
      )
    );
}
async function newMusicListFlow() {
  const name = await podPromptText({ title: 'Nueva lista', label: 'Nombre de la lista', placeholder: 'Para correr, para el coche…', ok: 'Crear' });
  if (!name) return;
  const l = createMusicList(name);
  openMusicScreen('list:' + l.id);
  podToast('Añade canciones con ⋯ → «Añadir a una lista…»');
}
function newMusicSmartFlow() {
  podSheet({
    title: 'Nueva lista inteligente',
    subtitle: 'Se rellena sola según tus reglas. Elige un punto de partida:',
    items: MUS_SMART_TEMPLATES.map(t => ({ icon: t.icon, label: t.name, hint: t.hint, on: () => openMusicSmartEditor(null, { name: t.name === 'Personalizada' ? '' : t.name, rules: t.rules }) }))
  });
}
function musicListMenu(l, inside = false) {
  const manual = l.type === 'manual';
  const tracks = () => musicListTracks(l, { fresh: true });
  podSheet({
    title: l.name,
    subtitle: manual ? plural(l.items.length, 'canción', 'canciones') : musicSmartSummary(l.rules),
    items: [
      { icon: '▶', label: 'Reproducir', on: () => playCollection(tracks(), 0, { shuffle: false, label: `«${l.name}»` }) },
      { icon: '🔀', label: 'Reproducir en aleatorio', on: () => playCollection(tracks(), 0, { shuffle: true, label: `«${l.name}»` }) },
      { icon: '⏭', label: 'Reproducir a continuación', on: () => queueTracks(tracks(), 'next') },
      { icon: '➕', label: 'Añadir al final de la cola', on: () => queueTracks(tracks(), 'end') },
      { sep: true },
      {
        icon: '✏️',
        label: 'Cambiar el nombre',
        on: async () => {
          const n = await podPromptText({ title: 'Cambiar el nombre', label: 'Nombre de la lista', value: l.name });
          if (n) {
            l.name = n;
            saveMusicLists();
          }
        }
      },
      !manual && { icon: '⚙️', label: 'Editar las reglas', on: () => openMusicSmartEditor(l) },
      {
        icon: '📄',
        label: 'Duplicar',
        on: () => {
          const c = normMusicList({ ...JSON.parse(JSON.stringify(l)), id: newListId(), name: l.name + ' (copia)' });
          musicState.lists.splice(musicState.lists.indexOf(l) + 1, 0, c);
          saveMusicLists();
          podToast(`Creada «${c.name}»`);
        }
      },
      !manual && {
        icon: '📌',
        label: 'Convertir en lista normal',
        hint: 'Fija las canciones de ahora',
        on: () => {
          const c = createMusicList(l.name + ' (fija)', tracks());
          openMusicScreen('list:' + c.id);
        }
      },
      manual && l.items.length > 1 && { icon: '⇅', label: 'Ordenar…', on: () => sortMusicListMenu(l) },
      { icon: '📤', label: 'Exportar como M3U', hint: 'Para VLC, Poweramp, foobar2000…', on: () => exportMusicList(l, 'm3u') },
      { icon: '💾', label: 'Exportar (copia de Radios Viferor)', on: () => exportMusicList(l, 'json') },
      {
        icon: '🗑',
        label: 'Borrar la lista',
        danger: true,
        on: () => {
          const idx = musicState.lists.indexOf(l);
          musicState.lists.splice(idx, 1);
          saveMusicLists();
          podToast(`Lista «${l.name}» borrada`, {
            action: 'Deshacer',
            onAction: () => {
              musicState.lists.splice(idx, 0, l);
              saveMusicLists();
            }
          });
          if (inside) backFromMusic();
        }
      }
    ]
  });
}
function sortMusicListMenu(l) {
  const apply = fn => {
    const before = [...l.items];
    const tr = new Map(l.items.map(x => [x.id, resolveTrack(x) || x]));
    l.items.sort((a, b) => fn(tr.get(a.id), tr.get(b.id)));
    saveMusicLists();
    podToast('Lista ordenada', {
      action: 'Deshacer',
      onAction: () => {
        l.items = before;
        saveMusicLists();
      }
    });
  };
  podSheet({
    title: `Ordenar «${l.name}»`,
    items: [
      { icon: '🔤', label: 'Título', on: () => apply((a, b) => musCollator.compare(a.title || '', b.title || '')) },
      { icon: '🎤', label: 'Artista', on: () => apply((a, b) => musCollator.compare(a.artist || '', b.artist || '') || musCollator.compare(a.album || '', b.album || '')) },
      { icon: '💿', label: 'Álbum', on: () => apply((a, b) => musCollator.compare(a.album || '', b.album || '') || (a.track || 0) - (b.track || 0)) },
      { icon: '🔥', label: 'Más escuchadas', on: () => apply((a, b) => trackPlays(b) - trackPlays(a)) },
      {
        icon: '🔀',
        label: 'Al azar',
        on: () => {
          const before = [...l.items];
          l.items = shuffled(l.items);
          saveMusicLists();
          podToast('Lista mezclada', { action: 'Deshacer', onAction: () => ((l.items = before), saveMusicLists()) });
        }
      },
      { icon: '↕', label: 'Invertir el orden', on: () => ((l.items = l.items.reverse()), saveMusicLists()) }
    ]
  });
}
function renderMusicList(root, id) {
  const l = musicListById(id);
  if (!l) return renderMusicTab(root, 'lists');
  const smart = l.type === 'smart';
  const tracks = musicListTracks(l);
  const missing = smart ? 0 : manualListTracks(l).missing;
  root.append(detailHead(`${smart ? '✨' : '📃'} ${l.name}`, tracksSummary(tracks), null, { onMore: () => musicListMenu(l, true) }));
  if (smart) root.append(musEl('p', 'pod-list-rules', pEsc(musicSmartSummary(l.rules))));
  root.append(
    actionBar([
      ['▶ Reproducir', () => playCollection(musicListTracks(l, { fresh: true }), 0, { shuffle: false, label: `«${l.name}»` }), 'primary', !tracks.length],
      ['🔀 Aleatorio', () => playCollection(musicListTracks(l, { fresh: true }), 0, { shuffle: true, label: `«${l.name}»` }), '', !tracks.length],
      ['⏭ A continuación', () => queueTracks(tracks, 'next'), '', !tracks.length],
      ['➕ A la cola', () => queueTracks(tracks, 'end'), '', !tracks.length],
      smart && ['⚙️ Reglas', () => openMusicSmartEditor(l)],
      smart && ['🔄 Actualizar', () => (musicListTracks(l, { fresh: true }), renderMusicScreen())],
      ['⋯ Más', () => musicListMenu(l, true)]
    ])
  );
  if (missing) root.append(musEl('p', 'mus-note', `⚠️ ${plural(missing, 'canción de esta lista ya no está', 'canciones de esta lista ya no están')} en tu música.`));
  if (!tracks.length) {
    root.append(musEl('div', 'pod-empty pod-empty-small', smart ? '<p>Ahora mismo ninguna canción cumple estas reglas.</p>' : '<p>La lista está vacía. Usa <b>⋯ → Añadir a una lista…</b> en cualquier canción, álbum, artista o carpeta.</p>'));
    return;
  }
  const box = musEl('div', 'pod-queue' + (smart ? '' : ' pod-qlist'));
  root.append(box);
  if (smart) {
    appendRowsChunked(box, tracks, (t, i) => trackRow(t, i, { num: i + 1, onPlay: k => playCollection(tracks, k) }));
    return;
  }
  root.insertBefore(musEl('h3', 'pod-list-h', '<small>Arrastra ⠿ para cambiar el orden · toca una canción para empezar desde ahí</small>'), box);
  const idx = l.items.map(x => resolveTrack(x));
  l.items.forEach((x, i) => {
    const t = idx[i];
    if (!t) return;
    box.append(
      trackRow(t, i, {
        handle: true,
        onPlay: () => playCollection(tracks, tracks.indexOf(t)),
        onRemove: k => removeFromMusicList(l, k),
        menuExtra: () => [
          i > 0 && { icon: '⤒', label: 'Subir al principio', on: () => moveMusicListItem(l, i, 0) },
          i < l.items.length - 1 && { icon: '⤓', label: 'Bajar al final', on: () => moveMusicListItem(l, i, l.items.length - 1) },
          { icon: '✕', label: 'Quitar de esta lista', on: () => removeFromMusicList(l, i) }
        ].filter(Boolean)
      })
    );
  });
  // Los índices de las filas son los de l.items (las que faltan no se pintan).
  const rowIdx = l.items.map((x, i) => (idx[i] ? i : -1)).filter(i => i >= 0);
  makeSortable(box, (from, to) => moveMusicListItem(l, rowIdx[from], rowIdx[to]), $m('musicContent'));
}
function moveMusicListItem(l, from, to) {
  l.items = moveInArray(l.items, from, to);
  l.updatedAt = Date.now();
  saveMusicLists();
}
function removeFromMusicList(l, i) {
  const before = [...l.items];
  l.items.splice(i, 1);
  saveMusicLists();
  podToast(`Quitada de «${l.name}»`, { action: 'Deshacer', onAction: () => ((l.items = before), saveMusicLists()) });
}
function openMusicSmartEditor(list, preset = {}) {
  const editing = !!list;
  const r = { ...MUS_SMART_DEFAULTS, ...(editing ? list.rules : preset.rules || {}) };
  const pickSources = {
    artists: () => [...musicState.artists.values()].map(a => [a.key, a.name, a.tracks.length]),
    albums: () => [...musicState.albums.values()].map(a => [a.key, `${a.name} — ${a.artist}`, a.tracks.length]),
    folders: () => [...musicState.folders.values()].filter(f => f.path).map(f => [f.path, f.path, f.count]),
    genres: () => [...musicState.genres.values()].map(g => [g.key, g.name, g.tracks.length])
  };
  const form = musEl('form', 'pod-sheet-form pod-smart-form');
  form.innerHTML = `
    <label><span>Nombre</span><input type="text" data-k="name" maxlength="80" placeholder="Por ejemplo: Rock de los 80" autocomplete="off"></label>
    <label><span>Canciones de</span>${selectHtml('source', Object.entries(MUS_SMART_LABELS.source), r.source)}</label>
    <fieldset class="if-pick"><legend>Elige <small data-pick-count></small></legend><input type="search" class="pod-pick-filter" placeholder="Filtrar…" aria-label="Filtrar"><div class="pod-pick-list"></div></fieldset>
    <label><span>Cuáles</span>${selectHtml('state', Object.entries(MUS_SMART_LABELS.state), r.state)}</label>
    <label><span>Añadidas al móvil</span>${selectHtml('addedDays', [[0, 'Cuando sea'], [7, 'Última semana'], [30, 'Último mes'], [90, 'Últimos 3 meses'], [365, 'Último año']], r.addedDays)}</label>
    <div class="pod-smart-row"><label><span>Duración mínima</span>${selectHtml('minMin', [[0, 'Cualquiera'], [1, '1 min'], [2, '2 min'], [3, '3 min'], [5, '5 min'], [10, '10 min']], r.minMin)}</label><label><span>Duración máxima</span>${selectHtml('maxMin', [[0, 'Cualquiera'], [3, '3 min'], [4, '4 min'], [5, '5 min'], [6, '6 min'], [8, '8 min'], [10, '10 min'], [20, '20 min']], r.maxMin)}</label></div>
    <div class="pod-smart-row"><label><span>Desde el año</span><input type="number" data-k="yearFrom" inputmode="numeric" min="1900" max="2100" placeholder="Cualquiera"></label><label><span>Hasta el año</span><input type="number" data-k="yearTo" inputmode="numeric" min="1900" max="2100" placeholder="Cualquiera"></label></div>
    <div class="pod-smart-row"><label><span>Orden</span>${selectHtml('order', Object.entries(MUS_SMART_LABELS.order), r.order)}</label><label><span>Máximo</span>${selectHtml('limit', [[25, '25'], [50, '50'], [100, '100'], [250, '250'], [500, '500'], [0, 'Todas']], r.limit)}</label></div>
    <p class="mus-preview" data-preview></p>
    <button type="submit" class="pod-sheet-ok">${editing ? 'Guardar cambios' : 'Crear lista'}</button>`;
  const $f = k => form.querySelector(`[data-k="${k}"]`);
  $f('name').value = editing ? list.name : preset.name || '';
  if (r.yearFrom) $f('yearFrom').value = r.yearFrom;
  if (r.yearTo) $f('yearTo').value = r.yearTo;
  let picked = new Set((r.picked || []).map(String));
  let shownSource = '';
  const fillPick = () => {
    const src = $f('source').value;
    const fs = form.querySelector('.if-pick');
    fs.hidden = src === 'all';
    if (src === 'all' || src === shownSource) return;
    if (shownSource) picked = new Set();
    shownSource = src;
    fs.querySelector('legend').firstChild.textContent = { artists: 'Elige artistas ', albums: 'Elige álbumes ', folders: 'Elige carpetas ', genres: 'Elige géneros ' }[src];
    const items = pickSources[src]().sort((a, b) => musCollator.compare(a[1], b[1]));
    fs.querySelector('.pod-pick-list').innerHTML = items.length
      ? items.map(([k, label, n]) => `<label><input type="checkbox" value="${pEsc(k)}"${picked.has(String(k)) ? ' checked' : ''}><span>${pEsc(label)} <small>${n}</small></span></label>`).join('')
      : '<em>No hay nada que elegir.</em>';
  };
  const read = () => ({
    source: $f('source').value,
    picked: [...form.querySelectorAll('.if-pick input[type=checkbox]:checked')].map(c => c.value),
    state: $f('state').value,
    addedDays: Number($f('addedDays').value),
    minMin: Number($f('minMin').value),
    maxMin: Number($f('maxMin').value),
    yearFrom: Number($f('yearFrom').value) || 0,
    yearTo: Number($f('yearTo').value) || 0,
    order: $f('order').value,
    limit: Number($f('limit').value)
  });
  const preview = () => {
    const rr = read();
    const n = rr.source !== 'all' && !rr.picked.length ? 0 : resolveMusicSmart({ ...rr, limit: 0, order: 'title' }).length;
    form.querySelector('[data-pick-count]').textContent = rr.picked.length ? `(${rr.picked.length})` : '';
    form.querySelector('[data-preview]').textContent = `Ahora mismo cumplen las reglas ${plural(n, 'canción', 'canciones')}${rr.limit && n > rr.limit ? ` (la lista tendrá ${rr.limit})` : ''}.`;
  };
  form.addEventListener('change', () => {
    fillPick();
    preview();
  });
  form.addEventListener('input', e => {
    if (e.target.matches('[data-k=yearFrom],[data-k=yearTo]')) preview();
  });
  form.querySelector('.pod-pick-filter').addEventListener('input', ev => {
    const t = mNorm(ev.target.value);
    form.querySelectorAll('.pod-pick-list label').forEach(lb => (lb.hidden = !!t && !mNorm(lb.textContent).includes(t)));
  });
  fillPick();
  preview();
  form.onsubmit = ev => {
    ev.preventDefault();
    const nm = $f('name').value.trim();
    if (!nm) return $f('name').focus();
    const rules = read();
    if (rules.source !== 'all' && !rules.picked.length) return podToast('Elige al menos uno');
    if (rules.minMin && rules.maxMin && rules.minMin >= rules.maxMin) return podToast('La duración mínima debe ser menor que la máxima');
    let l = list;
    if (editing) Object.assign(l, { name: nm, rules, updatedAt: Date.now() });
    else {
      l = normMusicList({ name: nm, type: 'smart', rules });
      musicState.lists.push(l);
    }
    musSmartCache.delete(l.id);
    podSheetClose(false);
    saveMusicLists();
    if (musicState.screen === 'list:' + l.id) renderMusicScreen();
    else openMusicScreen('list:' + l.id);
  };
  podSheet({ title: editing ? 'Editar lista inteligente' : 'Nueva lista inteligente', body: form });
  if (!$f('name').value) setTimeout(() => $f('name').focus(), 60);
}

/* ===========================================================================
   Cola
=========================================================================== */
let musHistOpen = false;
function renderMusicQueue(root) {
  const q = musicState.queue;
  const o = musicOpts();
  root.append(detailHead('☰ Cola', q.length ? tracksSummary(q) : 'Vacía', null));
  const cur = musicState.current;
  if (cur) {
    root.append(musEl('h3', 'pod-list-h', 'Sonando ahora'));
    root.append(trackRow(cur, 0, { onPlay: () => toggleMusicPlay() }));
  }
  root.append(
    actionBar([
      [o.shuffle ? '🔀 Aleatorio: sí' : '🔀 Aleatorio: no', toggleMusicShuffle, o.shuffle ? 'on' : ''],
      [{ off: '🔁 Repetir: no', all: '🔁 Repetir: todo', one: '🔂 Repetir: una' }[o.repeat], cycleMusicRepeat, o.repeat !== 'off' ? 'on' : ''],
      ['💾 Guardar como lista', saveMusicQueueAsList, '', !q.length && !cur],
      [
        '🗑 Vaciar',
        () => {
          const before = [...q];
          musicState.queue = [];
          saveMusicQueue();
          podToast('Cola vaciada', { action: 'Deshacer', onAction: () => ((musicState.queue = before), saveMusicQueue()) });
        },
        'danger',
        !q.length
      ]
    ])
  );
  root.append(musEl('h3', 'pod-list-h', `A continuación${q.length ? ' <small>arrastra ⠿ para ordenar</small>' : ''}`));
  if (!q.length) {
    root.append(musEl('div', 'pod-empty pod-empty-small', `<p>La cola está vacía.${o.repeat === 'all' && musicState.context.length ? ' Con «Repetir: todo» volverá a empezar lo que estás escuchando.' : ' Usa ⋯ en cualquier canción, álbum o carpeta para añadir.'}</p>`));
  } else {
    const box = musEl('div', 'pod-queue pod-qlist');
    const shown = q.slice(0, 300);
    shown.forEach((t, i) =>
      box.append(
        trackRow(t, i, {
          num: i + 1,
          handle: true,
          onPlay: () => playTrackNow(t),
          onRemove: k => {
            const before = [...musicState.queue];
            musicState.queue.splice(k, 1);
            saveMusicQueue();
            podToast('Quitada de la cola', { action: 'Deshacer', onAction: () => ((musicState.queue = before), saveMusicQueue()) });
          },
          menuExtra: (tt, k) => [
            k > 0 && { icon: '⤒', label: 'Subir al principio', on: () => ((musicState.queue = moveInArray(musicState.queue, k, 0)), saveMusicQueue()) },
            k < musicState.queue.length - 1 && { icon: '⤓', label: 'Bajar al final', on: () => ((musicState.queue = moveInArray(musicState.queue, k, musicState.queue.length - 1)), saveMusicQueue()) }
          ].filter(Boolean)
        })
      )
    );
    makeSortable(
      box,
      (from, to) => {
        musicState.queue = moveInArray(musicState.queue, from, to);
        saveMusicQueue();
      },
      $m('musicContent')
    );
    root.append(box);
    if (q.length > shown.length) root.append(musEl('p', 'mus-note', `… y ${q.length - shown.length} más.`));
  }
  const hist = [...musicState.history].reverse().filter(t => !cur || t.id !== cur.id).slice(0, 30);
  if (hist.length) {
    const d = musEl('details', 'pod-history', `<summary>🕘 Escuchado hace poco <span>${hist.length}</span></summary>`);
    d.open = musHistOpen;
    d.ontoggle = () => (musHistOpen = d.open);
    const box = musEl('div', 'pod-queue');
    hist.forEach((t, i) => box.append(trackRow(t, i, { onPlay: () => playTrackNow(t) })));
    d.append(box);
    root.append(d);
  }
}
async function saveMusicQueueAsList() {
  const tracks = [musicState.current, ...musicState.queue].filter(Boolean);
  const name = await podPromptText({ title: 'Guardar la cola como lista', label: 'Nombre de la lista', value: 'Cola del ' + new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }) });
  if (!name) return;
  const l = createMusicList(name, tracks);
  podToast(`Lista «${l.name}» creada`, { action: 'Abrir', onAction: () => openMusicScreen('list:' + l.id) });
}

/* ===========================================================================
   Reproductor (mini y ampliado)
=========================================================================== */
function updateMusicNowUI() {
  const t = musicState.current;
  $m('musPlayerMini')?.classList.toggle('is-empty', !t);
  if (t) {
    const art = musArtHtml(t.art, t.album || t.title);
    $m('musNow').textContent = t.title;
    $m('musNowSub').textContent = trackSub(t);
    $m('musMiniArt').innerHTML = art;
    $m('musExpArt').innerHTML = art;
    $m('musExpTitle').textContent = t.title;
    $m('musExpSub').textContent = trackSub(t);
  }
  document.querySelectorAll('#musicContent .mus-row').forEach(r => r.classList.toggle('is-current', !!t && r.dataset.id === t.id));
  updateMusicPlayerUI();
}
function updateMusicPlayerUI() {
  const a = musicAudio();
  if (!a) return;
  const cur = Number.isFinite(a.currentTime) ? a.currentTime : 0;
  const dur = Number.isFinite(a.duration) ? a.duration : musicState.current?.dur || 0;
  const r = $m('musRange');
  if (r && !r.matches(':active')) {
    r.max = dur || 100;
    r.value = Math.min(cur, dur || 100);
  }
  if ($m('musCur')) $m('musCur').textContent = fmtPodTime(cur);
  if ($m('musDurEl')) $m('musDurEl').textContent = '−' + fmtPodTime(Math.max(0, dur - cur));
  if ($m('musMiniBar')) $m('musMiniBar').style.width = dur ? Math.min(100, (cur / dur) * 100).toFixed(2) + '%' : '0%';
  const playing = !a.paused || !!musicInterrupted;
  ['musPlay', 'musExpPlay'].forEach(id => $m(id) && ($m(id).textContent = playing ? '⏸' : '▶'));
  const o = musicOpts();
  const sh = $m('musExpShuffle'),
    rp = $m('musExpRepeat');
  if (sh) {
    sh.classList.toggle('on', o.shuffle);
    sh.setAttribute('aria-pressed', o.shuffle ? 'true' : 'false');
  }
  if (rp) {
    rp.classList.toggle('on', o.repeat !== 'off');
    rp.textContent = o.repeat === 'one' ? '🔂' : '🔁';
    rp.title = { off: 'Sin repetir', all: 'Repetir todo', one: 'Repetir esta canción' }[o.repeat];
  }
  if ($m('musExpQueueCount')) $m('musExpQueueCount').textContent = musicState.queue.length;
  const up = $m('musUpNext');
  if (up) {
    const n = musicState.queue[0];
    up.hidden = !n;
    up.textContent = n ? `A continuación: ${n.title} — ${trackArtist(n)}` : '';
  }
  const sl = $m('musExpSleep');
  if (sl) {
    sl.classList.toggle('on', !!(musSleep.until || musSleep.end));
    sl.textContent = musSleep.end ? '🌙 Fin de la canción' : musSleep.until ? '🌙 ' + fmtPodTime((musSleep.until - Date.now()) / 1000) : '🌙 Temporizador';
  }
}
let musSleep = { until: 0, end: false, timer: null };
function setMusicSleep(min) {
  clearInterval(musSleep.timer);
  musSleep = { until: 0, end: min === 'end', timer: null };
  if (min > 0) {
    musSleep.until = Date.now() + min * 60000;
    musSleep.timer = setInterval(() => {
      if (Date.now() >= musSleep.until) {
        setMusicSleep(0);
        if (!musicAudio().paused) {
          window.viferorNativeMusicPause();
          podToast('🌙 Temporizador: música en pausa');
        }
      }
      updateMusicPlayerUI();
    }, 1000);
  }
  updateMusicPlayerUI();
}
function openMusicSleepMenu() {
  const active = musSleep.until || musSleep.end;
  podSheet({
    title: '🌙 Temporizador para dormir',
    items: [
      active && { icon: '✕', label: 'Desactivar', on: () => setMusicSleep(0) },
      { icon: '⏹', label: 'Al terminar esta canción', checked: musSleep.end, on: () => setMusicSleep('end') },
      ...[5, 10, 15, 30, 45, 60, 90].map(m => ({ icon: '⏱', label: m < 60 ? `${m} minutos` : m === 60 ? '1 hora' : '1 hora y media', on: () => setMusicSleep(m) }))
    ]
  });
}
function setMusicVolume(v) {
  const a = musicAudio();
  v = Math.max(0, Math.min(100, Number(v) || 0));
  if (a) a.volume = v / 100;
  if ($m('musExpVolume')) $m('musExpVolume').value = v;
  if ($m('musExpVolumeValue')) $m('musExpVolumeValue').value = v + '%';
  if ($m('musExpMute')) $m('musExpMute').textContent = v === 0 ? '🔇' : v < 40 ? '🔉' : '🔊';
  if (v > 0) lsSet(MUS_KEYS.volume, v);
}
function openMusicExpanded() {
  if (!musicState.current) return;
  $m('musExpanded').hidden = false;
  updateMusicPlayerUI();
}
function closeMusicExpanded() {
  $m('musExpanded').hidden = true;
}
window.closeMusicExpanded = closeMusicExpanded;

/* ===========================================================================
   Arranque
=========================================================================== */
function initMusic() {
  loadMusicLists();
  musicState.tab = musicUi().tab;
  $m('btnViewMusic')?.addEventListener('click', () => switchToMusic());
  document.querySelectorAll('#musTabs [data-tab]').forEach(b => (b.onclick = () => setMusicTab(b.dataset.tab)));
  $m('musSearch')?.addEventListener('input', e => {
    clearTimeout(musSearchTimer);
    const v = e.target.value.trim();
    musSearchTimer = setTimeout(() => setMusicSearch(v), 220);
  });
  $m('musMenu')?.addEventListener('click', () =>
    podSheet({
      title: '🎵 Mi música',
      subtitle: musicState.loaded ? `${tracksSummary(musicState.tracks)} · ${musicState.source === 'android' ? 'en el móvil' : `carpeta «${musicState.folderName || 'elegida'}»`}` : '',
      items: [
        { icon: '☰', label: 'Cola', hint: plural(musicState.queue.length, 'canción', 'canciones'), on: () => openMusicScreen('queue') },
        { icon: '📃', label: 'Listas', on: () => setMusicTab('lists') },
        { icon: '🔀', label: 'Toda mi música en aleatorio', disabled: !musicState.tracks.length, on: () => playCollection(musicState.tracks, 0, { shuffle: true, label: 'toda tu música' }) },
        { sep: true },
        { icon: '🔄', label: isAndroidApp() ? 'Volver a buscar música en el móvil' : 'Volver a leer la carpeta', on: () => ensureMusicLibrary(true) },
        !isAndroidApp() && { icon: '📁', label: 'Elegir otra carpeta', on: pickMusicFolder }
      ]
    })
  );
  const a = musicAudio();
  a.volume = (lsGet(MUS_KEYS.volume, 80) || 80) / 100;
  setMusicVolume(Math.round(a.volume * 100));
  a.addEventListener('play', () => {
    pauseOtherAudio();
    syncMusicAndroid(true);
    updateMusicPlayerUI();
  });
  a.addEventListener('playing', () => {
    finMusicInterrupt();
    musicUserPaused = false;
  });
  a.addEventListener('pause', () => {
    saveMusicResume();
    if (musicState.current && !a.ended && !musicUserPaused && !(window.rvPausaDelUsuario?.() ?? true)) {
      // Pausa del sistema (notificación, llamada…): se reanuda sola.
      startMusicInterrupt(a);
      updateMusicPlayerUI();
      return;
    }
    syncMusicAndroid(false);
    updateMusicPlayerUI();
  });
  a.addEventListener('timeupdate', () => {
    const t = musicState.current;
    if (t && !musicCounted && (a.currentTime >= 30 || (a.duration && a.currentTime >= a.duration * 0.5))) {
      musicCounted = true;
      countMusicPlay(t);
    }
    const now = Date.now();
    if (now - musicLastSave > 5000) {
      musicLastSave = now;
      saveMusicResume();
    }
    if (now - musicLastSync > 5000) {
      musicLastSync = now;
      syncMusicAndroid(false);
    }
    updateMusicPlayerUI();
  });
  a.addEventListener('loadedmetadata', updateMusicPlayerUI);
  a.addEventListener('ended', () => {
    const t = musicState.current;
    if (t && !musicCounted) countMusicPlay(t);
    musicCounted = true;
    if (musSleep.end) {
      setMusicSleep(0);
      musicUserPaused = true;
      syncMusicAndroid(false);
      podToast('🌙 Temporizador: fin de la canción');
      return;
    }
    nextTrack(true);
  });
  a.addEventListener('error', () => {
    if (a.src && musicState.current) musicTrackFailed(musicState.current);
  });
  // Si empieza la radio o un podcast, la música se pausa (como pausa del usuario).
  ['audioPlayer', 'podcastAudio'].forEach(id =>
    document.getElementById(id)?.addEventListener('play', () => {
      if (!a.paused || musicInterrupted) {
        finMusicInterrupt();
        musicUserPaused = true;
        a.pause();
      }
    })
  );
  // Mini y ampliado
  $m('musPlay').onclick = toggleMusicPlay;
  $m('musPrev').onclick = prevTrack;
  $m('musNext').onclick = () => nextTrack(false);
  $m('musMiniOpen').onclick = openMusicExpanded;
  $m('musMiniArt').onclick = openMusicExpanded;
  $m('musMiniOpen').onkeydown = e => (e.key === 'Enter' || e.key === ' ') && openMusicExpanded();
  $m('musExpClose').onclick = closeMusicExpanded;
  $m('musExpanded').addEventListener('click', e => e.target.id === 'musExpanded' && closeMusicExpanded());
  $m('musExpPlay').onclick = toggleMusicPlay;
  $m('musExpPrev').onclick = prevTrack;
  $m('musExpNext').onclick = () => nextTrack(false);
  $m('musExpShuffle').onclick = toggleMusicShuffle;
  $m('musExpRepeat').onclick = cycleMusicRepeat;
  $m('musExpQueue').onclick = () => {
    closeMusicExpanded();
    openMusicScreen('queue');
  };
  $m('musExpSleep').onclick = openMusicSleepMenu;
  $m('musExpMore').onclick = () => musicState.current && openTrackMenu(musicState.current);
  $m('musExpMute').onclick = () => setMusicVolume(a.volume > 0 ? 0 : lsGet(MUS_KEYS.volume, 80));
  $m('musExpVolume').addEventListener('input', e => setMusicVolume(e.target.value));
  $m('musRange').addEventListener('input', e => {
    if (Number.isFinite(a.duration)) a.currentTime = Number(e.target.value);
    updateMusicPlayerUI();
  });
  document.addEventListener('music:queue', () => {
    updateMusicPlayerUI();
    if (podDragging || !musicViewActive()) return;
    if (musicState.screen === 'queue' || (musicState.screen === 'tab' && musicState.tab === 'lists' && !musicState.search)) {
      const c = $m('musicContent'),
        sc = c.scrollTop;
      renderMusicScreen();
      c.scrollTop = sc;
    }
  });
  document.addEventListener('music:lists', () => {
    if (podDragging || !musicViewActive()) return;
    const s = musicState.screen;
    if ((s === 'tab' && musicState.tab === 'lists') || s.startsWith('list:')) {
      const c = $m('musicContent'),
        sc = c.scrollTop;
      renderMusicScreen();
      c.scrollTop = sc;
    }
  });
  // Al volver de los ajustes de Android (permiso concedido a mano).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && musicViewActive() && !musicState.loaded && !musicState.loading && isAndroidApp()) ensureMusicLibrary();
  });
  window.addEventListener('pagehide', saveMusicResume);
  updateMusicPlayerUI();
}
function updateMusicStrip() {}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMusic);
else initMusic();
