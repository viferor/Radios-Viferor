// Sonido de «Mi música» (1.20.0): ecualizador, corrección de auriculares y motor.
//
// Cadena de Web Audio (solo se crea si activas algo que la necesita, porque una vez
// conectado el <audio> ya solo suena a través de ella):
//
//   platina 1 ─ ganancia ┐
//   platina 2 ─ ganancia ┴─ entrada (mono) ─ preamp ─ auriculares (AutoEq, hasta 20 filtros)
//      ─ ecualizador (10 bandas) ─ nivelador ─ balance ─ limitador ─ volumen ─ salida
//
// Las ganancias de cada platina hacen los fundidos sin saltos. El limitador evita que
// los refuerzos saturen.

const FX_KEY = 'radios_viferor_music_audio_v1';
const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_PRESETS = [
  ['Plano', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ['Graves potentes', [6, 5.5, 4, 2, 0, 0, 0, 0, 0, 0]],
  ['Graves suaves', [3, 3, 2, 1, 0, 0, 0, 0, 0, 0]],
  ['Menos graves', [-5, -4, -3, -1, 0, 0, 0, 0, 0, 0]],
  ['Agudos claros', [0, 0, 0, 0, 0, 0, 1, 3, 4, 4]],
  ['Agudos suaves', [0, 0, 0, 0, 0, 0, -1, -2, -4, -5]],
  ['Voz y podcasts', [-4, -3, -1, 0, 2, 3, 3, 2, 0, -2]],
  ['Rock', [4, 3, 2, 0, -1, -1, 1, 2, 3, 3]],
  ['Pop', [-1, 0, 2, 3, 3, 2, 0, -1, -1, -1]],
  ['Electrónica', [5, 4.5, 2, 0, -1, 0, 1, 2, 3, 4]],
  ['Hip-hop / reguetón', [5, 5, 3, 1, -1, -1, 1, 1, 2, 2]],
  ['Flamenco y acústica', [2, 2, 1, 1, 2, 2, 2, 2, 1, 1]],
  ['Jazz', [2, 2, 1, 1, -1, -1, 0, 1, 2, 3]],
  ['Clásica', [3, 2, 1, 0, 0, 0, -1, 1, 2, 3]],
  ['Volumen bajo', [6, 5, 3, 1, 0, 0, 0, 1, 3, 4]],
  ['En la calle', [3, 3, 2, 1, 0, 1, 2, 2, 1, 0]]
];
// AutoEq · Regan Cipher · objetivo Harman in-ear (MIT). https://github.com/jaakkopasanen/AutoEq
const HP_BUILTIN = [
  {
    name: 'realme Buds Air 7 Pro (ANC off)',
    label: 'Realme Buds Air 7 Pro · sin cancelación de ruido',
    source: 'Regan Cipher',
    path: 'Regan Cipher/in-ear/realme Buds Air 7 Pro (ANC off)',
    preamp: -2.1,
    filters: [
      ['lowshelf', 105, -1.1, 0.7],
      ['peaking', 43, -4.8, 0.75],
      ['peaking', 102, 2.5, 0.7],
      ['peaking', 283, -2.3, 1.01],
      ['peaking', 2322, 2.1, 2.05],
      ['highshelf', 10000, -8.0, 0.7],
      ['peaking', 8394, 2.4, 2.21],
      ['peaking', 5624, 1.1, 3.22],
      ['peaking', 1203, -0.8, 3.59],
      ['peaking', 5575, 0.2, 3.46]
    ]
  },
  {
    name: 'realme Buds Air 7 Pro (ANC on)',
    label: 'Realme Buds Air 7 Pro · con cancelación de ruido',
    source: 'Regan Cipher',
    path: 'Regan Cipher/in-ear/realme Buds Air 7 Pro (ANC on)',
    preamp: -2.2,
    filters: [
      ['lowshelf', 105, -2.6, 0.7],
      ['peaking', 42, -2.8, 1.1],
      ['peaking', 108, 2.7, 0.98],
      ['peaking', 287, -1.8, 0.54],
      ['peaking', 2434, 2.3, 1.72],
      ['highshelf', 10000, -6.6, 0.7],
      ['peaking', 8333, 2.6, 1.99],
      ['peaking', 1226, -1.1, 3.17],
      ['peaking', 6217, 1.6, 4.03],
      ['peaking', 646, 0.5, 1.87]
    ]
  }
].map(h => ({ ...h, filters: h.filters.map(([type, fc, gain, q]) => ({ type, fc, gain, q })) }));
const HP_MAX = 20;

const FX_DEFAULTS = {
  eq: false,
  bands: EQ_FREQS.map(() => 0),
  preset: 'Plano',
  autoPreamp: true,
  preamp: 0,
  hpOn: false,
  hp: null,
  crossfade: 0,
  gapless: true,
  fadePause: true,
  level: false,
  balance: 0,
  mono: false,
  custom: [],
  autoOutput: true, // ajustes distintos según por dónde suena (app Android)
  profiles: {} // salida → ajustes de sonido
};
// Lo que cambia con la salida (lo demás —fundidos, nivelador, presets guardados— es común).
const FX_PROFILE_FIELDS = ['eq', 'bands', 'preset', 'autoPreamp', 'preamp', 'hpOn', 'hp', 'balance', 'mono'];
function fxSettings() {
  const s = { ...FX_DEFAULTS, ...lsGet(FX_KEY, {}) };
  if (!Array.isArray(s.bands) || s.bands.length !== 10) s.bands = FX_DEFAULTS.bands.slice();
  if (!Array.isArray(s.custom)) s.custom = [];
  if (!s.profiles || typeof s.profiles !== 'object') s.profiles = {};
  return s;
}
function saveFx(patch, { fromProfile = false } = {}) {
  const s = { ...fxSettings(), ...patch };
  // Lo que se toca a mano queda guardado para la salida actual.
  const out = fxOutput.cur;
  if (!fromProfile && s.autoOutput && out && FX_PROFILE_FIELDS.some(k => k in patch)) {
    s.profiles = { ...s.profiles, [out.key]: { ...pickProfile(s), label: out.label, at: Date.now() } };
  }
  lsSet(FX_KEY, s);
  applyFx();
  return s;
}
function pickProfile(s) {
  const o = {};
  FX_PROFILE_FIELDS.forEach(k => (o[k] = Array.isArray(s[k]) ? s[k].slice() : s[k]));
  return o;
}

/* ---------------------------------------------------------------------------
   Según por dónde suena (app Android 1.12+): altavoz, cable, USB o cada Bluetooth
--------------------------------------------------------------------------- */
const fxOutput = { cur: null, supported: false };
const fxKeyNorm = v =>
  String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
function describeOutput(o) {
  const type = ['speaker', 'wired', 'usb', 'bluetooth'].includes(o?.type) ? o.type : 'other';
  const name = String(o?.name || '').trim();
  const key = type === 'bluetooth' || type === 'usb' || type === 'other' ? `${type}:${fxKeyNorm(name) || '?'}` : type;
  const icon = { speaker: '🔊', wired: '🎧', usb: '🎧', bluetooth: '🎧', other: '🔈' }[type];
  const label = type === 'speaker' ? 'Altavoz del móvil' : type === 'wired' ? 'Auriculares con cable' : name || (type === 'bluetooth' ? 'Bluetooth' : type === 'usb' ? 'Auriculares USB' : 'Otra salida');
  return { type, name, key, icon, label };
}
// Corrección conocida para unos auriculares Bluetooth por su nombre (p. ej. «realme Buds Air7 Pro»).
function hpForDevice(name, s) {
  const n = fxKeyNorm(name);
  if (n.length < 4) return null;
  const known = [...HP_BUILTIN, s.hp, ...Object.values(s.profiles).map(p => p.hp)].filter(Boolean);
  return known.find(h => {
    const hn = fxKeyNorm(String(h.name || '').replace(/\(.*?\)/g, ''));
    return hn.length >= 4 && (hn.includes(n) || n.includes(hn));
  });
}
function profileForNew(out, s) {
  const flat = { eq: false, bands: FX_DEFAULTS.bands.slice(), preset: 'Plano', autoPreamp: true, preamp: 0, hpOn: false, hp: s.hp, balance: 0, mono: false };
  if (out.type === 'bluetooth' || out.type === 'usb') {
    const hp = hpForDevice(out.name, s);
    if (hp) return { ...flat, hpOn: true, hp: { name: hp.name, label: hp.label || hp.name, source: hp.source, path: hp.path, preamp: hp.preamp, filters: hp.filters.slice(0, HP_MAX) } };
  }
  return flat;
}
function onAudioOutput(raw, { initial = false } = {}) {
  let o = raw;
  if (typeof o === 'string') {
    try {
      o = JSON.parse(o);
    } catch {
      return;
    }
  }
  if (!o || !o.type) return;
  fxOutput.supported = true;
  const out = describeOutput(o);
  const prev = fxOutput.cur;
  fxOutput.cur = out;
  const s = fxSettings();
  if (!s.autoOutput) return refreshFxPanel();
  let prof = s.profiles[out.key];
  let isNew = false;
  if (!prof) {
    isNew = true;
    // La primera vez se aprovecha lo que ya tenías para la salida en la que estás
    // (sin la corrección de auriculares si estás en el altavoz).
    prof = initial && !Object.keys(s.profiles).length ? { ...pickProfile(s), ...(out.type === 'speaker' ? { hpOn: false } : {}) } : profileForNew(out, s);
    s.profiles = { ...s.profiles, [out.key]: { ...prof, label: out.label, at: Date.now() } };
    lsSet(FX_KEY, s);
  }
  // Al arrancar solo se guarda: la cadena de audio se crea con el primer toque.
  if (initial) lsSet(FX_KEY, { ...fxSettings(), ...pickProfile({ ...s, ...prof }) });
  else saveFx(pickProfile({ ...s, ...prof }), { fromProfile: true });
  refreshFxPanel();
  if (!prev || prev.key === out.key) return;
  const what = prof.hpOn && prof.hp ? `corrección ${prof.hp.label || prof.hp.name}` : prof.eq ? `ecualizador «${prof.preset}»` : 'sin ecualizar';
  podToast(`${out.icon} ${out.label}: ${what}${isNew && !prof.hpOn && out.type !== 'speaker' ? ' · busca su corrección en 🎚️ Sonido' : ''}`, { ms: 4500 });
}
window.onAndroidAudioOutput = o => onAudioOutput(o);
function refreshFxPanel() {
  const p = document.getElementById('fxPanel');
  if (p && !p.hidden) renderFxPanel();
}
function forgetOutputProfile(key) {
  const s = fxSettings();
  const profiles = { ...s.profiles };
  delete profiles[key];
  lsSet(FX_KEY, { ...s, profiles });
  if (fxOutput.cur?.key === key) onAudioOutput({ type: fxOutput.cur.type, name: fxOutput.cur.name });
  else refreshFxPanel();
}
// ¿Hace falta la cadena de Web Audio? (los fundidos funcionan también sin ella)
function fxNeedsGraph(s = fxSettings()) {
  return s.eq || (s.hpOn && s.hp) || s.level || s.mono || Math.abs(s.balance) > 0.001;
}
const dbToGain = db => Math.pow(10, db / 20);
function eqAutoPreamp(s) {
  // Lo que más sube el ecualizador, compensado para no saturar.
  return s.eq ? -Math.max(0, ...s.bands) : 0;
}
function totalPreamp(s) {
  const hp = s.hpOn && s.hp ? Number(s.hp.preamp) || 0 : 0;
  const eq = s.eq ? (s.autoPreamp ? eqAutoPreamp(s) : Number(s.preamp) || 0) : 0;
  return hp + eq;
}

/* ---------------------------------------------------------------------------
   Cadena de audio
--------------------------------------------------------------------------- */
const musicFx = {
  active: false,
  ctx: null,
  nodes: null,
  engineOpts() {
    const s = fxSettings();
    return { crossfade: Number(s.crossfade) || 0, gapless: !!s.gapless, fadePause: !!s.fadePause };
  },
  resume() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  },
  setDeckGain(i, level, secs = 0) {
    const g = this.nodes?.decks[i];
    if (!g) return;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    if (secs > 0) g.gain.linearRampToValueAtTime(level, t + secs);
    else g.gain.setValueAtTime(level, t);
  },
  setVolume(v) {
    if (this.nodes) this.nodes.volume.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  },
  // Crea la cadena (una sola vez) y conecta las dos platinas.
  ensure() {
    if (this.active) return true;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx || !musDecks.length) return false;
    try {
      const ctx = new Ctx({ latencyHint: 'playback' });
      const mk = () => ctx.createGain();
      const n = {
        decks: [],
        input: mk(),
        pre: mk(),
        hp: Array.from({ length: HP_MAX }, () => ctx.createBiquadFilter()),
        eq: EQ_FREQS.map(() => ctx.createBiquadFilter()),
        level: ctx.createDynamicsCompressor(),
        pan: ctx.createStereoPanner ? ctx.createStereoPanner() : mk(),
        limiter: ctx.createDynamicsCompressor(),
        volume: mk()
      };
      musDecks.forEach((el, i) => {
        const src = ctx.createMediaElementSource(el);
        const g = mk();
        g.gain.value = musDeckLevel[i] ?? 1;
        src.connect(g).connect(n.input);
        n.decks.push(g);
      });
      const chain = [n.input, n.pre, ...n.hp, ...n.eq, n.level, n.pan, n.limiter, n.volume];
      for (let k = 0; k < chain.length - 1; k++) chain[k].connect(chain[k + 1]);
      n.volume.connect(ctx.destination);
      // Limitador: deja pasar todo salvo los picos que saturarían.
      n.limiter.threshold.value = -1;
      n.limiter.knee.value = 0;
      n.limiter.ratio.value = 20;
      n.limiter.attack.value = 0.002;
      n.limiter.release.value = 0.12;
      this.ctx = ctx;
      this.nodes = n;
      this.active = true;
      musDecks.forEach(el => (el.volume = 1));
      n.volume.gain.value = musUserVolume;
      this.resume();
      return true;
    } catch (e) {
      try {
        window.logError?.('MUSIC_FX', String(e?.message || e));
      } catch {}
      return false;
    }
  }
};
window.musicFx = musicFx;
function setBiquad(f, type, fc, gain, q) {
  f.type = type;
  f.frequency.value = Math.max(10, Math.min(22000, fc));
  f.gain.value = gain;
  f.Q.value = q;
}
function applyFx() {
  const s = fxSettings();
  if (!musicFx.active) {
    if (!fxNeedsGraph(s)) return;
    if (!musicFx.ensure()) return podToast('Este dispositivo no permite procesar el audio');
  }
  const n = musicFx.nodes;
  // Mono: se mezclan los dos canales en uno (útil con un solo auricular).
  n.input.channelCount = s.mono ? 1 : 2;
  n.input.channelCountMode = s.mono ? 'explicit' : 'max';
  n.input.channelInterpretation = 'speakers';
  n.pre.gain.value = dbToGain(totalPreamp(s));
  const hp = s.hpOn && s.hp ? s.hp.filters || [] : [];
  n.hp.forEach((f, i) => {
    const x = hp[i];
    if (x) setBiquad(f, x.type, x.fc, x.gain, x.q || 0.707);
    else setBiquad(f, 'peaking', 1000, 0, 1); // sin efecto
  });
  n.eq.forEach((f, i) => {
    const type = i === 0 ? 'lowshelf' : i === 9 ? 'highshelf' : 'peaking';
    setBiquad(f, type, EQ_FREQS[i], s.eq ? Number(s.bands[i]) || 0 : 0, 1.41);
  });
  // Nivelador: compresión suave (iguala canciones fuertes y flojas); apagado = sin efecto.
  if (s.level) Object.entries({ threshold: -24, knee: 18, ratio: 3, attack: 0.01, release: 0.3 }).forEach(([k, v]) => (n.level[k].value = v));
  else Object.entries({ threshold: 0, knee: 0, ratio: 1, attack: 0.003, release: 0.25 }).forEach(([k, v]) => (n.level[k].value = v));
  if (n.pan.pan) n.pan.pan.value = Math.max(-1, Math.min(1, Number(s.balance) || 0));
  drawFxCurve();
}

/* ---------------------------------------------------------------------------
   Curva de respuesta (lo que el ecualizador y la corrección hacen a cada frecuencia)
--------------------------------------------------------------------------- */
let fxCurveCtx = null;
function fxResponse(s, freqs) {
  if (!fxCurveCtx) {
    try {
      fxCurveCtx = new OfflineAudioContext(1, 128, 48000);
    } catch {
      return null;
    }
  }
  // Solo la forma (sin el preamp, que se indica aparte).
  const total = new Float32Array(freqs.length).fill(0);
  const mag = new Float32Array(freqs.length),
    ph = new Float32Array(freqs.length);
  const add = (type, fc, gain, q) => {
    const f = fxCurveCtx.createBiquadFilter();
    setBiquad(f, type, fc, gain, q);
    f.getFrequencyResponse(freqs, mag, ph);
    for (let i = 0; i < freqs.length; i++) total[i] += 20 * Math.log10(mag[i] || 1e-6);
  };
  if (s.hpOn && s.hp) s.hp.filters.forEach(x => add(x.type, x.fc, x.gain, x.q || 0.707));
  if (s.eq) s.bands.forEach((g, i) => g && add(i === 0 ? 'lowshelf' : i === 9 ? 'highshelf' : 'peaking', EQ_FREQS[i], g, 1.41));
  return total;
}
function drawFxCurve() {
  const cv = document.getElementById('fxCurve');
  if (!cv || cv.offsetParent === null) return;
  const s = fxSettings();
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth,
    H = cv.clientHeight;
  cv.width = W * dpr;
  cv.height = H * dpr;
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  const css = getComputedStyle(cv);
  const grid = css.getPropertyValue('--grid') || '#ccc',
    line = css.getPropertyValue('--line') || '#d32f2f',
    text = css.getPropertyValue('--text2') || '#888';
  const N = 160,
    lo = Math.log10(20),
    hi = Math.log10(20000);
  const freqs = new Float32Array(N).map((_, i) => Math.pow(10, lo + ((hi - lo) * i) / (N - 1)));
  const x = f => ((Math.log10(f) - lo) / (hi - lo)) * W;
  const y = db => H / 2 - (db / 15) * (H / 2 - 6);
  g.clearRect(0, 0, W, H);
  g.strokeStyle = grid;
  g.lineWidth = 1;
  g.font = '10px system-ui, sans-serif';
  g.fillStyle = text;
  [-12, -6, 0, 6, 12].forEach(d => {
    g.beginPath();
    g.moveTo(0, y(d));
    g.lineTo(W, y(d));
    g.globalAlpha = d === 0 ? 0.9 : 0.4;
    g.stroke();
    g.globalAlpha = 1;
    g.fillText((d > 0 ? '+' : '') + d, 3, y(d) - 2);
  });
  [100, 1000, 10000].forEach(f => {
    g.globalAlpha = 0.4;
    g.beginPath();
    g.moveTo(x(f), 0);
    g.lineTo(x(f), H);
    g.stroke();
    g.globalAlpha = 1;
    g.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), x(f) + 3, H - 3);
  });
  const r = fxResponse(s, freqs);
  if (!r) return;
  g.strokeStyle = line;
  g.lineWidth = 2.5;
  g.beginPath();
  for (let i = 0; i < N; i++) {
    const v = Math.max(-15, Math.min(15, r[i]));
    i ? g.lineTo(x(freqs[i]), y(v)) : g.moveTo(x(freqs[i]), y(v));
  }
  g.stroke();
}

/* ---------------------------------------------------------------------------
   Panel «🎚️ Sonido»
--------------------------------------------------------------------------- */
function fmtDb(v) {
  v = Math.round(Number(v) * 10) / 10;
  return (v > 0 ? '+' : '') + String(v).replace('.', ',') + ' dB';
}
function fmtHz(f) {
  return f >= 1000 ? f / 1000 + ' kHz' : f + ' Hz';
}
function openFxPanel() {
  let p = document.getElementById('fxPanel');
  if (!p) {
    p = musEl('div', 'fx-panel');
    p.id = 'fxPanel';
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-label', 'Sonido');
    document.body.append(p);
  }
  p.hidden = false;
  document.body.classList.add('fx-open');
  musicFx.resume();
  renderFxPanel();
}
window.openFxPanel = openFxPanel;
function closeFxPanel() {
  const p = document.getElementById('fxPanel');
  if (!p || p.hidden) return false;
  p.hidden = true;
  document.body.classList.remove('fx-open');
  return true;
}
window.closeFxPanel = closeFxPanel;
function renderFxPanel() {
  const p = document.getElementById('fxPanel');
  if (!p) return;
  const s = fxSettings();
  const sc = p.querySelector('.fx-body')?.scrollTop || 0;
  const presetBtns = [...EQ_PRESETS.map(([n]) => n), ...s.custom.map(c => '★ ' + c.name)]
    .map(n => `<button type="button" class="fx-chip${s.preset === n ? ' on' : ''}" data-preset="${pEsc(n)}">${pEsc(n)}</button>`)
    .join('');
  const hpName = s.hp ? s.hp.label || s.hp.name : '';
  p.innerHTML = `
  <div class="fx-head"><button type="button" class="fx-close" aria-label="Cerrar">←</button><strong>🎚️ Sonido</strong><span class="fx-state">${musicFx.active ? 'Procesado activo' : 'Sin procesar'}</span></div>
  <div class="fx-body">
    <canvas id="fxCurve" class="fx-curve" aria-label="Curva de ecualización"></canvas>
    <p class="fx-curve-note">${s.eq || (s.hpOn && s.hp) ? `Preamplificación total ${fmtDb(totalPreamp(s))} · limitador activo para que no sature.` : 'Activa el ecualizador o la corrección de tus auriculares para cambiar el sonido.'}</p>

    ${fxOutput.supported ? outputCardHtml(s) : ''}
    <section class="fx-card">
      <label class="fx-switch"><input type="checkbox" data-k="hpOn" ${s.hpOn ? 'checked' : ''}><span><b>🎧 Corrección de auriculares</b><small>Ajusta tus auriculares a una curva de referencia (Harman), con mediciones de AutoEq de unos 9.000 modelos.</small></span></label>
      <div class="fx-hp-now">${s.hp ? `<b>${pEsc(hpName)}</b><small>${s.hp.filters.length} filtros · preamp ${fmtDb(s.hp.preamp || 0)} · medición de ${pEsc(s.hp.source || 'AutoEq')}</small>` : '<small>Sin auriculares elegidos.</small>'}</div>
      <div class="fx-chips">${HP_BUILTIN.map(h => `<button type="button" class="fx-chip${s.hp?.name === h.name ? ' on' : ''}" data-hp="${pEsc(h.name)}">${pEsc(h.label)}</button>`).join('')}</div>
      <div class="fx-hp-search"><input type="search" id="fxHpQ" placeholder="🔎 Busca tus auriculares" autocomplete="off"><button type="button" id="fxHpGo">Buscar</button></div>
      <div class="fx-hp-results" id="fxHpRes"></div>
    </section>

    <section class="fx-card">
      <label class="fx-switch"><input type="checkbox" data-k="eq" ${s.eq ? 'checked' : ''}><span><b>🎛️ Ecualizador</b><small>10 bandas. Se suma a la corrección de auriculares.</small></span></label>
      <div class="fx-chips fx-presets">${presetBtns}</div>
      <div class="fx-bands${s.eq ? '' : ' off'}">${EQ_FREQS.map(
        (f, i) => `<label class="fx-band"><span>${fmtHz(f)}</span><input type="range" min="-12" max="12" step="0.5" value="${s.bands[i]}" data-band="${i}" aria-label="${fmtHz(f)}"><output>${fmtDb(s.bands[i])}</output></label>`
      ).join('')}
        <label class="fx-band fx-pre"><span>Preamp</span><input type="range" min="-12" max="6" step="0.5" value="${s.autoPreamp ? eqAutoPreamp(s) : s.preamp}" data-k="preamp" ${s.autoPreamp ? 'disabled' : ''} aria-label="Preamplificación"><output>${fmtDb(s.autoPreamp ? eqAutoPreamp(s) : s.preamp)}</output></label>
        <label class="fx-check"><input type="checkbox" data-k="autoPreamp" ${s.autoPreamp ? 'checked' : ''}> Preamp automático (evita saturar)</label>
      </div>
      <div class="fx-row"><button type="button" id="fxSave">💾 Guardar como preset</button>${s.custom.length ? '<button type="button" id="fxDel">🗑 Borrar un preset mío</button>' : ''}<button type="button" id="fxReset">↺ Plano</button></div>
    </section>

    <section class="fx-card">
      <b class="fx-title">▶️ Reproducción</b>
      <label class="fx-field"><span>Fundido entre canciones</span><select data-k="crossfade">${[0, 2, 3, 4, 6, 8, 10, 12].map(v => `<option value="${v}"${Number(s.crossfade) === v ? ' selected' : ''}>${v ? v + ' s' : 'No'}</option>`).join('')}</select></label>
      <label class="fx-check"><input type="checkbox" data-k="gapless" ${s.gapless ? 'checked' : ''}> Sin pausas entre canciones (carga la siguiente antes de que acabe)</label>
      <label class="fx-check"><input type="checkbox" data-k="fadePause" ${s.fadePause ? 'checked' : ''}> Fundido suave al pausar y reanudar</label>
      <label class="fx-check"><input type="checkbox" data-k="level" ${s.level ? 'checked' : ''}> Nivelar volumen (iguala canciones fuertes y flojas)</label>
      <label class="fx-check"><input type="checkbox" data-k="mono" ${s.mono ? 'checked' : ''}> Mono (para escuchar con un solo auricular)</label>
      <label class="fx-band fx-bal"><span>Balance</span><input type="range" min="-1" max="1" step="0.05" value="${s.balance}" data-k="balance" aria-label="Balance"><output>${balText(s.balance)}</output></label>
    </section>
    <p class="fx-foot">Correcciones de auriculares: <a href="https://github.com/jaakkopasanen/AutoEq" target="_blank" rel="noopener">AutoEq</a> (MIT). Con la app Android, comprueba que sigue sonando con la pantalla apagada; si no, desactiva el ecualizador y avísame.</p>
  </div>`;
  p.querySelector('.fx-close').onclick = closeFxPanel;
  p.querySelectorAll('input[type=checkbox][data-k]').forEach(
    c =>
      (c.onchange = () => {
        saveFx({ [c.dataset.k]: c.checked });
        if (c.dataset.k === 'autoOutput' && c.checked && fxOutput.cur) {
          // Al activarlo, lo de ahora queda como ajuste de esta salida.
          const st = fxSettings();
          lsSet(FX_KEY, { ...st, profiles: { ...st.profiles, [fxOutput.cur.key]: { ...pickProfile(st), label: fxOutput.cur.label, at: Date.now() } } });
        }
        renderFxPanel();
      })
  );
  p.querySelectorAll('[data-forget]').forEach(b => (b.onclick = () => forgetOutputProfile(b.dataset.forget)));
  p.querySelector('select[data-k=crossfade]').onchange = e => saveFx({ crossfade: Number(e.target.value) });
  p.querySelectorAll('[data-band]').forEach(r => {
    r.oninput = () => {
      const st = fxSettings();
      st.bands[Number(r.dataset.band)] = Number(r.value);
      r.nextElementSibling.value = fmtDb(r.value);
      saveFx({ bands: st.bands, preset: 'Personalizado', eq: true });
      if (st.autoPreamp) {
        const pr = p.querySelector('[data-k=preamp]');
        pr.value = eqAutoPreamp({ ...st, eq: true });
        pr.nextElementSibling.value = fmtDb(pr.value);
      }
      p.querySelectorAll('.fx-presets .fx-chip').forEach(b => b.classList.remove('on'));
      const sw = p.querySelector('input[data-k=eq]');
      if (!sw.checked) {
        sw.checked = true;
        p.querySelector('.fx-bands').classList.remove('off');
      }
    };
  });
  const pre = p.querySelector('[data-k=preamp]');
  pre.oninput = () => {
    pre.nextElementSibling.value = fmtDb(pre.value);
    saveFx({ preamp: Number(pre.value) });
  };
  const bal = p.querySelector('[data-k=balance]');
  bal.oninput = () => {
    bal.nextElementSibling.value = balText(bal.value);
    saveFx({ balance: Number(bal.value) });
  };
  p.querySelectorAll('[data-preset]').forEach(
    b =>
      (b.onclick = () => {
        const name = b.dataset.preset;
        const st = fxSettings();
        const bands = name.startsWith('★ ') ? st.custom.find(c => '★ ' + c.name === name)?.bands : EQ_PRESETS.find(x => x[0] === name)?.[1];
        if (!bands) return;
        saveFx({ bands: bands.slice(), preset: name, eq: name === 'Plano' ? st.eq : true });
        renderFxPanel();
      })
  );
  p.querySelectorAll('[data-hp]').forEach(b => (b.onclick = () => chooseHeadphones(HP_BUILTIN.find(h => h.name === b.dataset.hp))));
  const go = () => searchHeadphones(p.querySelector('#fxHpQ').value);
  p.querySelector('#fxHpGo').onclick = go;
  p.querySelector('#fxHpQ').onkeydown = e => e.key === 'Enter' && go();
  p.querySelector('#fxReset').onclick = () => (saveFx({ bands: FX_DEFAULTS.bands.slice(), preset: 'Plano' }), renderFxPanel());
  p.querySelector('#fxSave').onclick = async () => {
    const name = await podPromptText({ title: 'Guardar preset', label: 'Nombre', placeholder: 'Para el coche, para correr…' });
    if (!name) return;
    const st = fxSettings();
    const custom = st.custom.filter(c => c.name !== name).concat([{ name, bands: st.bands.slice() }]);
    saveFx({ custom, preset: '★ ' + name });
    renderFxPanel();
  };
  const del = p.querySelector('#fxDel');
  if (del)
    del.onclick = () =>
      podSheet({
        title: 'Borrar un preset',
        items: fxSettings().custom.map(c => ({
          icon: '🗑',
          label: c.name,
          danger: true,
          on: () => {
            saveFx({ custom: fxSettings().custom.filter(x => x.name !== c.name) });
            renderFxPanel();
          }
        }))
      });
  p.querySelector('.fx-body').scrollTop = sc;
  requestAnimationFrame(drawFxCurve);
}
function outputCardHtml(s) {
  const out = fxOutput.cur;
  const saved = Object.entries(s.profiles).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  const icon = k => (k === 'speaker' ? '🔊' : '🎧');
  return `<section class="fx-card fx-out">
      <label class="fx-switch"><input type="checkbox" data-k="autoOutput" ${s.autoOutput ? 'checked' : ''}><span><b>🔀 Según por dónde suena</b><small>Recuerda el ecualizador y la corrección de cada salida (altavoz, cable y cada Bluetooth) y los cambia solos al conectar o desconectar.</small></span></label>
      <div class="fx-hp-now"><b>${out ? `${out.icon} Ahora: ${pEsc(out.label)}` : 'Salida desconocida'}</b><small>${s.autoOutput ? 'Lo que cambies aquí se guarda para esta salida.' : 'Desactivado: los mismos ajustes para todo.'}</small></div>
      ${s.autoOutput && saved.length ? `<div class="fx-outs">${saved.map(([k, p]) => `<span class="fx-out-item${out?.key === k ? ' on' : ''}">${icon(k)} ${pEsc(p.label || k)} <small>${pEsc(p.hpOn && p.hp ? 'corrección' : p.eq ? p.preset : 'plano')}</small><button type="button" data-forget="${pEsc(k)}" aria-label="Olvidar">✕</button></span>`).join('')}</div>` : ''}
    </section>`;
}
function balText(v) {
  v = Number(v) || 0;
  if (Math.abs(v) < 0.01) return 'Centro';
  return `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? 'izq.' : 'der.'}`;
}
function chooseHeadphones(h) {
  if (!h) return;
  saveFx({ hp: { name: h.name, label: h.label || h.name, source: h.source, path: h.path, preamp: h.preamp, filters: h.filters.slice(0, HP_MAX) }, hpOn: true });
  podToast(`🎧 Corrección para ${h.label || h.name}`);
  renderFxPanel();
}
async function searchHeadphones(q) {
  const box = document.getElementById('fxHpRes');
  q = String(q || '').trim();
  if (!box || !q) return;
  box.innerHTML = '<p class="fx-hint">Buscando…</p>';
  try {
    const r = await fetch('/api/autoeq?q=' + encodeURIComponent(q));
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    if (!d.items?.length) {
      box.innerHTML = '<p class="fx-hint">No están en AutoEq. Prueba con menos palabras o sin la marca.</p>';
      return;
    }
    box.replaceChildren();
    d.items.slice(0, 25).forEach(it => {
      const b = musEl('button', 'fx-hp-item', `<b>${pEsc(it.name)}</b><small>Medición de ${pEsc(it.source)}${it.rig ? ' · ' + pEsc(it.rig) : ''}</small>`);
      b.type = 'button';
      b.onclick = () => loadHeadphones(it.path);
      box.append(b);
    });
  } catch (e) {
    box.innerHTML = `<p class="fx-hint">⚠️ ${pEsc(e?.message || 'No se pudo buscar')}</p>`;
  }
}
async function loadHeadphones(path) {
  try {
    const r = await fetch('/api/autoeq?path=' + encodeURIComponent(path));
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    if (!d.filters?.length) throw Error('Sin filtros');
    chooseHeadphones({ name: d.name, label: d.name, source: d.source, path: d.path, preamp: d.preamp, filters: d.filters });
  } catch (e) {
    podToast('No se pudo cargar: ' + (e?.message || 'error'));
  }
}

function initFx() {
  document.getElementById('musExpFx')?.addEventListener('click', openFxPanel);
  try {
    const o = window.Android?.audioOutput?.();
    if (o) onAudioOutput(o, { initial: true });
  } catch {}
  // Si había algo activado, la cadena se crea al primer toque (los navegadores lo exigen).
  if (fxNeedsGraph()) {
    const arm = () => {
      applyFx();
      musicFx.resume();
    };
    ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, arm, { once: true, capture: true }));
  }
  window.addEventListener('resize', () => requestAnimationFrame(drawFxCurve));
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initFx);
else initFx();
