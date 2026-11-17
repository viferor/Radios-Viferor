/* ===========================================================================
   🎵 Motor nativo de «Mi música» (app Android 1.17+)
   ---------------------------------------------------------------------------
   En la app, la música ya no suena en dos <audio> del WebView sino en dos reproductores
   nativos (ExoPlayer, ver NativeMusic.java). Con el WebView, Android solo deja búferes de
   unos milisegundos y con la pantalla apagada se oían microcortes (sobre todo con el
   ecualizador y con FLAC); el nativo procesa por adelantado y suena como Poweramp.

   Este archivo presenta cada reproductor nativo como si fuera un <audio>: mismas
   propiedades (src, currentTime, duration, paused, ended, readyState, volume…), mismos
   métodos (play, pause, load) y mismos eventos. Así musica.js sigue igual: cola, fundidos,
   recuperación de fallos, letras… solo cambia quién suena.

   · Solo se usa si la app lo tiene (Android.nativeMusicVersion) y no se ha elegido el
     reproductor web en 🎚️ Sonido (radios_viferor_music_engine = 'web').
   · En el navegador del PC no cambia nada.
   · Órdenes: Android.nm*(...). Avisos: window.rvNativeMusicEvent(platina, gen, tipo, estado).
     «gen» numera cada carga: los avisos de una canción anterior se ignoran.
=========================================================================== */
(function () {
  const MOTOR_KEY = 'radios_viferor_music_engine';
  const And = () => window.Android;

  function nativoEnApp() {
    try {
      const A = And();
      return !!A && typeof A.nativeMusicVersion === 'function' && Number(A.nativeMusicVersion()) >= 1;
    } catch {
      return false;
    }
  }
  function elegidoWeb() {
    try {
      return localStorage.getItem(MOTOR_KEY) === 'web';
    } catch {
      return false;
    }
  }
  function llamar(nombre, ...args) {
    try {
      const A = And();
      if (A && typeof A[nombre] === 'function') return A[nombre](...args);
    } catch (e) {
      window.logError?.('MUSIC_NATIVE', `Música (nativo): ${nombre} falló`, '', String(e?.message || e));
    }
  }
  function absoluta(u) {
    try {
      return new URL(u, location.href).href;
    } catch {
      return String(u || '');
    }
  }
  function domError(nombre, msg) {
    try {
      return new DOMException(msg, nombre);
    } catch {
      return Object.assign(new Error(msg), { name: nombre });
    }
  }
  const MEDIA_ERR = { 1: 'cancelado', 2: 'red', 3: 'decodificación', 4: 'formato no soportado' };

  // Enganche para pasar sin hueco a la siguiente (ver NativeMusic.arm). Se lleva aquí la
  // misma regla que en Java: cargar algo en cualquiera de las dos platinas lo deshace.
  let armado = [-1, -1];
  function armar(from, to) {
    if (from === armado[0] && to === armado[1]) return;
    armado = [from, to];
    llamar('nmArm', from, to);
  }
  function olvidarEnganche(i) {
    if (armado[0] === i || armado[1] === i) armado = [-1, -1];
  }

  class NativeDeck extends EventTarget {
    constructor(i) {
      super();
      this.rvNative = true;
      this.i = i;
      this.id = 'musicNativo' + (i + 1);
      this.tagName = 'NATIVE-AUDIO';
      this._src = '';
      this._gen = 0;
      this._t = 0;
      this._tAt = 0;
      this._dur = NaN;
      this._paused = true;
      this._ended = false;
      this._playing = false; // lo que dice el reproductor nativo
      this._rs = 0;
      this._ns = 0;
      this._buf = 0;
      this._error = null;
      this._volume = 1;
      this._preload = 'auto';
      this._pend = [];
      this._loadQueued = false;
      this._auto = false;
      this._autoTimer = 0;
      this.muted = false;
      this.playbackRate = 1;
      this.crossOrigin = null;
    }
    // ---- Propiedades de <audio>
    get src() {
      return this._src;
    }
    set src(v) {
      v = String(v || '');
      this._src = v ? absoluta(v) : '';
      this._queueLoad();
    }
    get currentSrc() {
      return this._src;
    }
    getAttribute(n) {
      return n === 'src' ? this._src || null : n === 'id' ? this.id : null;
    }
    setAttribute(n, v) {
      if (n === 'src') this.src = v;
    }
    hasAttribute(n) {
      return n === 'src' && !!this._src;
    }
    removeAttribute(n) {
      if (n !== 'src') return;
      this._src = '';
      this._queueLoad();
    }
    get preload() {
      return this._preload;
    }
    set preload(v) {
      this._preload = String(v || '');
    }
    get paused() {
      return this._paused;
    }
    get ended() {
      return this._ended;
    }
    get readyState() {
      return this._rs;
    }
    get networkState() {
      return this._ns;
    }
    get error() {
      return this._error;
    }
    get duration() {
      return this._dur;
    }
    get seeking() {
      return false;
    }
    get currentTime() {
      // Entre aviso y aviso (cada 250 ms) se calcula, para que la letra vaya fina.
      if (!this._paused && this._playing && !this._ended) {
        const t = this._t + (performance.now() - this._tAt) / 1000;
        return Number.isFinite(this._dur) && this._dur > 0 ? Math.min(t, this._dur) : t;
      }
      return this._t;
    }
    set currentTime(v) {
      v = Math.max(0, Number(v) || 0);
      // Si la canción ha empezado sola, sin hueco, al terminar la anterior (enganche),
      // switchToOtherDeck aún pone currentTime = 0 antes de su play(): eso la reiniciaría.
      if (this._auto && v === 0) return;
      if (!this._src) return;
      this._t = Number.isFinite(this._dur) && this._dur > 0 ? Math.min(v, this._dur) : v;
      this._tAt = performance.now();
      this._ended = false;
      llamar('nmSeek', this.i, this._t);
      this._fire('seeking');
      this._fire('timeupdate');
    }
    get buffered() {
      const t = this.currentTime,
        b = this._buf,
        n = this._src && this._rs >= 1 ? 1 : 0;
      return {
        length: n,
        start: () => t,
        end: () => t + b
      };
    }
    get volume() {
      return this._volume;
    }
    set volume(v) {
      v = Math.max(0, Math.min(1, Number(v) || 0));
      this._volume = v;
      llamar('nmVolume', this.i, v, 0);
    }
    // Fundido hecho en Android (sin pasos desde la web): volumen final y segundos.
    rvRampa(v, secs) {
      v = Math.max(0, Math.min(1, Number(v) || 0));
      this._volume = v;
      llamar('nmVolume', this.i, v, Math.max(0, Number(secs) || 0));
    }
    rvArm(from, to) {
      armar(from, to);
    }
    canPlayType() {
      return 'probably';
    }
    // ---- Métodos de <audio>
    load() {
      this._queueLoad();
    }
    _queueLoad() {
      if (this._loadQueued) return;
      this._loadQueued = true;
      queueMicrotask(() => {
        if (!this._loadQueued) return;
        this._loadQueued = false;
        this._doLoad();
      });
    }
    _doLoad() {
      const habia = this._gen > 0 && (this._rs > 0 || this._ns > 0);
      this._gen++;
      this._auto = false;
      olvidarEnganche(this.i);
      // Como el algoritmo de carga de HTML: lo pendiente se cancela y queda en pausa.
      this._rejectPend('AbortError', 'Se ha cargado otra canción');
      this._paused = true;
      this._playing = false;
      this._ended = false;
      this._t = 0;
      this._tAt = performance.now();
      this._dur = NaN;
      this._error = null;
      this._rs = 0;
      this._buf = 0;
      if (habia) this._fire('emptied');
      if (!this._src) {
        this._ns = 0;
        llamar('nmStop', this.i);
        return;
      }
      this._ns = 2;
      llamar('nmLoad', this.i, this._src, this._gen);
      this._fire('loadstart');
    }
    play() {
      // Una carga pendiente va antes que el play().
      if (this._loadQueued) {
        this._loadQueued = false;
        this._doLoad();
      }
      const auto = this._auto;
      this._auto = false;
      return new Promise((resolve, reject) => {
        if (!this._src) return reject(domError('NotSupportedError', 'No hay canción cargada'));
        const estabaEnPausa = this._paused;
        if (this._ended) {
          this._ended = false;
          this._t = 0;
          this._tAt = performance.now();
        }
        this._paused = false;
        if (estabaEnPausa) this._fire('play');
        // Ya suena (empezó sola por el enganche, o nunca se paró): listo.
        if (this._playing && (auto || !estabaEnPausa)) {
          this._error = null;
          return resolve();
        }
        this._pend.push({ resolve, reject });
        llamar('nmPlay', this.i);
      });
    }
    pause() {
      if (this._loadQueued) {
        this._loadQueued = false;
        this._doLoad();
      }
      this._auto = false;
      if (this._paused) return;
      this._t = this.currentTime;
      this._tAt = performance.now();
      this._paused = true;
      this._playing = false;
      this._rejectPend('AbortError', 'La reproducción se ha pausado');
      llamar('nmPause', this.i);
      this._fire('timeupdate');
      this._fire('pause');
    }
    // ---- Internos
    _fire(tipo) {
      queueMicrotask(() => {
        const ev = new Event(tipo);
        try {
          this.dispatchEvent(ev);
        } catch {}
        const h = this['on' + tipo];
        if (typeof h === 'function') {
          try {
            h.call(this, ev);
          } catch (e) {
            window.logError?.('error', String(e?.message || e), 'motor-nativo on' + tipo);
          }
        }
      });
    }
    _resolvePend() {
      const p = this._pend;
      this._pend = [];
      p.forEach(x => x.resolve());
    }
    _rejectPend(nombre, msg) {
      const p = this._pend;
      this._pend = [];
      p.forEach(x => x.reject(domError(nombre, msg)));
    }
    _recibir(tipo, s) {
      s = s || {};
      if (typeof s.t === 'number' && tipo !== 'ended') {
        this._t = s.t;
        this._tAt = performance.now();
      }
      let durCambia = false;
      if (typeof s.dur === 'number' && s.dur >= 0 && s.dur !== this._dur) {
        this._dur = s.dur;
        durCambia = true;
      }
      if (typeof s.buf === 'number') this._buf = s.buf;
      if (typeof s.rs === 'number') this._rs = s.rs;
      if (typeof s.ns === 'number') this._ns = s.ns;
      if (typeof s.pl === 'boolean') this._playing = s.pl;
      switch (tipo) {
        case 'ready':
          this._fire('durationchange');
          this._fire('loadedmetadata');
          this._fire('loadeddata');
          this._fire('canplay');
          this._fire('canplaythrough');
          break;
        case 'canplay':
          if (durCambia) this._fire('durationchange');
          this._fire('canplay');
          this._fire('canplaythrough');
          break;
        case 'waiting':
          if (!this._paused) this._fire('waiting');
          break;
        case 'playing':
          if (this._paused) {
            // Se pausó mientras arrancaba: que no siga sonando.
            llamar('nmPause', this.i);
            break;
          }
          this._error = null;
          this._resolvePend();
          this._fire('playing');
          this._fire('timeupdate');
          break;
        case 'time':
          if (durCambia) this._fire('durationchange');
          this._fire('timeupdate');
          break;
        case 'seeked':
          this._fire('seeked');
          this._fire('timeupdate');
          break;
        case 'ended': {
          const enPausa = this._paused;
          olvidarEnganche(this.i);
          this._ended = true;
          this._playing = false;
          this._paused = true;
          if (Number.isFinite(this._dur)) this._t = this._dur;
          this._tAt = performance.now();
          this._rejectPend('AbortError', 'La canción ha terminado');
          this._fire('timeupdate');
          if (!enPausa) this._fire('pause');
          this._fire('ended');
          break;
        }
        case 'error': {
          olvidarEnganche(this.i);
          const code = Number(s.err) || 2;
          this._error = { code, message: String(s.msg || ''), MEDIA_ERR_ABORTED: 1, MEDIA_ERR_NETWORK: 2, MEDIA_ERR_DECODE: 3, MEDIA_ERR_SRC_NOT_SUPPORTED: 4 };
          this._playing = false;
          // Los fallos los gestiona el evento «error» (musicTrackFailed): si además se
          // rechazara play() con otro nombre, se gestionaría dos veces y saltaría dos canciones.
          this._rejectPend('AbortError', 'No se pudo reproducir');
          window.logError?.(
            'media',
            `${this.id}: error ${code} (${MEDIA_ERR[code] || 'desconocido'})${s.msg ? ' · ' + s.msg : ''}`,
            String(this._src).replace(/\?.*$/, '').slice(0, 160),
            `t=${(this._t || 0).toFixed(1)} rs=${this._rs} ns=${this._ns} motor=nativo`
          );
          this._fire('error');
          break;
        }
        case 'syspause':
          // Llamada, aviso u otra app: pausa del sistema (musica.js decide si vuelve a sonar).
          if (!this._paused) {
            this._paused = true;
            this._playing = false;
            this._rejectPend('AbortError', 'Interrumpida por el sistema');
            this._fire('timeupdate');
            this._fire('pause');
          }
          break;
        case 'autostart': {
          // Empieza sola, sin hueco, al acabar la otra platina.
          olvidarEnganche(this.i);
          const enPausa = this._paused;
          this._ended = false;
          this._error = null;
          this._paused = false;
          this._playing = true;
          this._auto = true;
          clearTimeout(this._autoTimer);
          this._autoTimer = setTimeout(() => (this._auto = false), 8000);
          if (enPausa) this._fire('play');
          this._resolvePend();
          this._fire('playing');
          this._fire('timeupdate');
          break;
        }
        default:
          break;
      }
    }
  }

  let decks = null;
  window.rvNativeMusicEvent = (i, gen, tipo, estado) => {
    const d = decks && decks[i];
    if (!d || gen !== d._gen) return;
    try {
      d._recibir(tipo, estado);
    } catch (e) {
      window.logError?.('error', 'motor-nativo: ' + (e?.message || e), tipo);
    }
  };

  window.rvMotorNativo = {
    KEY: MOTOR_KEY,
    // ¿La app tiene reproductor nativo? (aunque se haya elegido el web)
    disponible: nativoEnApp,
    // ¿Se va a usar? (se decide al abrir la app)
    usar: () => nativoEnApp() && !elegidoWeb(),
    // ¿Está sonando la música por el nativo?
    activo: () => !!decks,
    crearPlatinas() {
      if (!decks) decks = [new NativeDeck(0), new NativeDeck(1)];
      window.logError?.('AUTO', 'Música: reproductor nativo', 'sin cortes en segundo plano (APK 1.17+)');
      return decks;
    },
    // Ajustes de sonido (los aplica el reproductor nativo, ver FxDsp.java).
    fx(plan) {
      llamar('nmFx', JSON.stringify(plan || { on: false }));
    },
    elegirWeb(web) {
      try {
        if (web) localStorage.setItem(MOTOR_KEY, 'web');
        else localStorage.removeItem(MOTOR_KEY);
      } catch {}
    }
  };
})();
