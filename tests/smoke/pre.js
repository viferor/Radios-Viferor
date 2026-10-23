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
    { id: 1001, t: 'Tono de prueba', a: 'Pruebas', al: 'Pruebas', ai: 0, n: 1, y: 2024, d: 60000, fn: 'tone.wav', da: 0, s: 960078, m: 'audio/wav', g: 'Pruebas', f: 'Music' },
    { id: 1002, t: 'Tono de prueba 2', a: 'Pruebas', al: 'Pruebas', ai: 0, n: 2, y: 2024, d: 60000, fn: 'tone.wav', da: 0, s: 960078, m: 'audio/wav', g: 'Pruebas', f: 'Music' }
  ]
};
const realFetch = window.fetch;
window.fetch = function (u, o) {
  const url = String(u && u.url ? u.url : u);
  if (url.indexOf('/__music/library.json') >= 0)
    return Promise.resolve(new Response(JSON.stringify(LIB), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  if (url.indexOf('/api/') >= 0)
    return Promise.resolve(new Response(JSON.stringify({ ok: false, stations: [], items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  return realFetch.call(this, u, o);
};
