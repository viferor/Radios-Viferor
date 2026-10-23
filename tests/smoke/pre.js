/* Se inyecta ANTES de los scripts de la app: Android falso y respuestas falsas de la API. */
window.__calls = [];
const rec = n => (...a) => { window.__calls.push([n, ...a]); };
window.Android = {
  musicApiVersion: () => 1,
  musicPermissionStatus: () => 'granted',
  requestMusicPermission: rec('requestMusicPermission'),
  openAppSettings: rec('openAppSettings'),
  setPlaybackSection: rec('setPlaybackSection'),
  startRadioMedia: rec('startRadioMedia'),
  updateRadioMedia: rec('updateRadioMedia'),
  updateRadioNowPlaying: rec('updateRadioNowPlaying'),
  stopRadioMedia: rec('stopRadioMedia'),
  startMusicMedia: rec('startMusicMedia'),
  startPodcastMedia: rec('startPodcastMedia'),
  updatePodcastMedia: rec('updatePodcastMedia'),
  stopPodcastMedia: rec('stopPodcastMedia'),
  syncPodcastSubscriptions: rec('sync'),
  canResumeAudio: () => true,
  audioOutput: () => '',
  audioState: () => 'free',
  lastPlaybackSection: () => window.__lastSection || 'radio',
  saveTextFile: rec('saveTextFile')
};
const LIB = {
  ok: true,
  api: 1,
  count: 2,
  tracks: [
    { id: 1001, t: 'Tono de prueba', a: 'Pruebas', al: 'Pruebas', ai: 0, n: 1, y: 2024, d: 60000, fn: 'tone.wav', da: 0, s: 200000, m: 'audio/wav', g: 'Pruebas', f: 'Music' },
    { id: 1002, t: 'Tono de prueba 2', a: 'Pruebas', al: 'Pruebas', ai: 0, n: 2, y: 2024, d: 60000, fn: 'tone.wav', da: 0, s: 200000, m: 'audio/wav', g: 'Pruebas', f: 'Music' }
  ]
};
const realFetch = window.fetch;
// Audio de prueba con «Range»: 200 KB con cabecera RIFF y bytes que se pueden comparar.
const AUDIO = (() => {
  const n = 200000;
  const b = new Uint8Array(n);
  b.set([82, 73, 70, 70]); // «RIFF»
  for (let i = 4; i < n; i++) b[i] = (i * 37 + 11) & 0xff;
  return b;
})();
window.fetch = function (u, o) {
  const url = String(u && u.url ? u.url : u);
  if (url.indexOf('/__music/library.json') >= 0)
    return Promise.resolve(new Response(JSON.stringify(LIB), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  // Archivo de audio falso con soporte de «Range»: sirve para la prueba de lectura
  // (Música → ⋯ → Comprobar la lectura), que compara trozos solapados byte a byte.
  if (url.indexOf('/__music/track/') >= 0) {
    const cabeceras = (o && o.headers) || {};
    const rango = cabeceras.Range || cabeceras.range || '';
    const m = /bytes=(\d*)-(\d*)/.exec(rango);
    let desde = 0,
      hasta = AUDIO.length - 1;
    if (m) {
      desde = m[1] === '' ? Math.max(0, AUDIO.length - Number(m[2])) : Number(m[1]);
      hasta = m[1] !== '' && m[2] !== '' ? Math.min(AUDIO.length - 1, Number(m[2])) : AUDIO.length - 1;
    }
    const cuerpo = AUDIO.subarray(desde, hasta + 1);
    return Promise.resolve(
      new Response(cuerpo, {
        status: m ? 206 : 200,
        headers: {
          'Content-Type': 'audio/wav',
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${desde}-${hasta}/${AUDIO.length}`,
          'Content-Length': String(cuerpo.length)
        }
      })
    );
  }
  if (url.indexOf('/api/') >= 0)
    return Promise.resolve(new Response(JSON.stringify({ ok: false, stations: [], items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  return realFetch.call(this, u, o);
};
