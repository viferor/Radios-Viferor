"""Motor nativo de «Mi música» (APK 1.17) y botones de sección del widget.

Simula en JavaScript el reproductor nativo de Android (NativeMusic.java: avisos «ready»,
«playing», «time», «ended», «autostart», «syspause», «error»…) y comprueba que musica.js,
motor-nativo.js y ecualizador.js lo manejan como manejaban los <audio>: reproducir, pausar
con fundido, fundido entre canciones, paso sin hueco (enganche), interrupciones, fallos de
lectura, ecualizador, y que sin la APK nueva todo sigue como antes.

    python tests/test_motor_nativo.py
"""
import json, os, re, time, threading, functools, http.server, socketserver, sys
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
TONE = open(os.path.join(HERE, 'tone.wav'), 'rb').read()


class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


socketserver.ThreadingTCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=REPO))
srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d' % srv.server_address[1]

now = int(time.time())
LIB = [{'id': 200 + k, 't': f'Canción {k:02d}', 'a': 'Grupo', 'al': 'Disco', 'aa': '', 'ai': 1, 'n': k, 'y': 2020,
        'd': 4000, 'fn': f'{k:02d}.flac', 'da': now - k, 's': 40_000_000, 'm': 'audio/flac', 'g': 'Pop', 'f': 'Music/Disco'}
       for k in range(1, 9)]
state = {'track_fetch': 0}


def route(r):
    u = r.request.url
    if not u.startswith(BASE): return r.abort()
    if '/__music/library.json' in u:
        return r.fulfill(json={'ok': True, 'api': 1, 'count': len(LIB), 'tracks': LIB})
    if '/__music/track/' in u:
        state['track_fetch'] += 1
        return r.fulfill(body=TONE, headers={'content-type': 'audio/wav', 'content-length': str(len(TONE))})
    if '/__music/art/' in u: return r.fulfill(status=404, body='')
    if '/api/podcast-feed' in u: return r.fulfill(status=502, json={'error': 'x'})
    if '/api/' in u: return r.fulfill(json={})
    if '/audio/' in u or u.endswith('.mp3'): return r.fulfill(body=TONE, headers={'content-type': 'audio/wav'})
    return r.continue_()


errors, results = [], []


def check(name, cond, extra=''):
    results.append((name, bool(cond)))
    print(('OK   ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''))


# Reproductor nativo simulado: mismas órdenes (nm*) y mismos avisos que NativeMusic.java.
FAKE_NATIVE = r"""
window.__calls = [];
const rec = n => (...a) => { window.__calls.push([n, ...a]); };
const NM = window.__nm = {
  dur: 4, speed: 1,
  decks: [0, 1].map(i => ({ i, gen: 0, url: '', pos: 0, playing: false, ready: false, ended: false, vol: 1, t0: 0 })),
  arm: [-1, -1], fx: null, focus: true,
  st(d, extra) {
    const pos = d.playing ? d.pos + (performance.now() - d.t0) / 1000 * NM.speed : d.pos;
    return Object.assign({ t: Math.min(pos, NM.dur), dur: d.ready ? NM.dur : -1, buf: 30, pl: d.playing, rs: d.url ? (d.ready ? 4 : 0) : 0, ns: d.url ? 1 : 0 }, extra || {});
  },
  ev(i, type, extra) {
    const d = NM.decks[i];
    const s = NM.st(d, extra);
    setTimeout(() => window.rvNativeMusicEvent && window.rvNativeMusicEvent(i, d.gen, type, s), 0);
  },
  fixPos(d) { if (d.playing) { d.pos = Math.min(NM.dur, d.pos + (performance.now() - d.t0) / 1000 * NM.speed); d.t0 = performance.now(); } },
  tick() {
    NM.decks.forEach(d => {
      if (!d.playing) return;
      NM.fixPos(d);
      if (d.pos >= NM.dur) {
        d.playing = false; d.ended = true; d.pos = NM.dur;
        const [a, b] = NM.arm;
        if (a === d.i && b >= 0) {
          // Enganche: la siguiente empieza sola y las platinas se intercambian (como en Java).
          const o = NM.decks[b];
          NM.arm = [-1, -1];
          o.playing = true; o.ended = false; o.pos = 0; o.t0 = performance.now(); o.ready = true;
          window.__calls.push(['__autostart', b]);
          const s1 = NM.st(o), s2 = NM.st(d);
          setTimeout(() => { window.rvNativeMusicEvent(b, o.gen, 'autostart', s1); window.rvNativeMusicEvent(d.i, d.gen, 'ended', s2); }, 0);
        } else NM.ev(d.i, 'ended');
      } else NM.ev(d.i, 'time');
    });
  }
};
setInterval(() => NM.tick(), 100);
window.Android = {
  musicApiVersion: () => 1,
  musicPermissionStatus: () => 'granted',
  requestMusicPermission: rec('requestMusicPermission'),
  setPlaybackSection: rec('setPlaybackSection'),
  startMusicMedia: rec('startMusicMedia'),
  updatePodcastMedia: rec('updatePodcastMedia'),
  startPodcastMedia: rec('startPodcastMedia'),
  startRadioMedia: rec('startRadioMedia'),
  updateRadioMedia: rec('updateRadioMedia'),
  stopPodcastMedia: rec('stopPodcastMedia'),
  syncPodcastSubscriptions: rec('sync'),
  canResumeAudio: () => true,
  audioState: () => window.__st || 'free',
  audioOutput: () => '',
  nativeMusicVersion: () => (window.__sinNativo ? 0 : 1),
  nmLoad(i, url, gen) {
    window.__calls.push(['nmLoad', i, url, gen]);
    const d = NM.decks[i];
    if (NM.arm[0] === i || NM.arm[1] === i) NM.arm = [-1, -1];
    Object.assign(d, { gen, url, pos: 0, playing: false, ready: false, ended: false });
    setTimeout(() => {
      if (d.gen !== gen) return;
      if (window.__failNext) { window.__failNext = false; NM.ev(i, 'error', { err: 2, msg: 'ERROR_CODE_IO_UNSPECIFIED: prueba' }); return; }
      d.ready = true; NM.ev(i, 'ready');
    }, 40);
  },
  nmPlay(i) {
    window.__calls.push(['nmPlay', i]);
    const d = NM.decks[i];
    if (!d.url) return;
    if (!NM.focus) { NM.ev(i, 'syspause'); return; }
    if (d.ended) { d.ended = false; d.pos = 0; }
    if (d.playing) return;
    setTimeout(() => { d.playing = true; d.t0 = performance.now(); NM.ev(i, 'playing'); }, 30);
  },
  nmPause(i) { window.__calls.push(['nmPause', i]); const d = NM.decks[i]; NM.fixPos(d); if (d.playing) { d.playing = false; NM.ev(i, 'time'); } },
  nmSeek(i, s) { window.__calls.push(['nmSeek', i, s]); const d = NM.decks[i]; d.pos = s; d.t0 = performance.now(); d.ended = false; NM.ev(i, 'seeked'); },
  nmStop(i) { window.__calls.push(['nmStop', i]); Object.assign(NM.decks[i], { url: '', playing: false, ready: false }); },
  nmVolume(i, v, secs) { window.__calls.push(['nmVolume', i, v, secs]); NM.decks[i].vol = v; },
  nmArm(a, b) { window.__calls.push(['nmArm', a, b]); NM.arm = [a, b]; },
  nmFx(j) { window.__calls.push(['nmFx', j]); NM.fx = JSON.parse(j); },
  saveTextFile: rec('saveTextFile')
};
// Una «interrupción» del sistema (llamada, aviso): como onFocusChange de NativeMusic.
window.__sysPause = () => NM.decks.forEach(d => { if (d.playing) { NM.fixPos(d); d.playing = false; NM.ev(d.i, 'syspause'); } });
"""

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.route('**/*', route)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.add_init_script(FAKE_NATIVE + """
      if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded','1'); }
      if (sessionStorage.getItem('sinNativo')) window.__sinNativo = true;
    """)
    calls = lambda name=None: page.evaluate("window.__calls") if name is None else [c for c in page.evaluate("window.__calls") if c[0] == name]
    clear = lambda: page.evaluate("window.__calls = []; 0")
    log = lambda: page.evaluate("JSON.parse(localStorage.getItem('radios_viferor_error_log_v1') || '[]').map(x => x.message + ' ' + (x.source||''))")
    paused = lambda: page.evaluate("musicAudio().paused")

    page.goto(BASE + '/index.html'); page.wait_for_timeout(800)
    page.click('#btnViewMusic'); page.wait_for_function('musicState.loaded')

    # 1) Se usan las platinas nativas
    check('platinas nativas en la app 1.17', page.evaluate("musDecks.length === 2 && musDecks.every(d => d.rvNative)"))
    check('motor nativo activo', page.evaluate("rvMotorNativo.activo()"))

    # 2) Reproducir
    clear()
    page.evaluate("musicState.queue = musicState.tracks.slice(1, 4); startTrack(musicState.tracks[0]); 0")
    page.wait_for_timeout(500)
    ld = calls('nmLoad')
    check('carga la canción en el nativo con su dirección /__music/track/', ld and re.search(r'/__music/track/201$', ld[0][2]), ld)
    check('y la pone a sonar', calls('nmPlay') and not paused())
    t1 = page.evaluate("musicAudio().currentTime"); page.wait_for_timeout(600); t2 = page.evaluate("musicAudio().currentTime")
    check('el tiempo avanza', t2 > t1 + 0.3, [t1, t2])
    check('no copia la canción entera (sin blob ni trozos)', state['track_fetch'] == 0, state['track_fetch'])
    check('notificación de Android al día', len(calls('startMusicMedia')) >= 1)

    # 3) Pausa con fundido y reanudar
    clear()
    page.evaluate("toggleMusicPlay(); 0"); page.wait_for_timeout(500)
    vols = calls('nmVolume')
    check('pausa con fundido hecho en Android (0 en 0,25 s)', any(v[2] == 0 and abs(v[3] - 0.25) < 0.01 for v in vols), vols)
    check('…y luego pausa', paused() and calls('nmPause'))
    clear()
    page.evaluate("toggleMusicPlay(); 0"); page.wait_for_timeout(500)
    check('reanudar: suena y sube el volumen con fundido', not paused() and any(v[3] > 0 for v in calls('nmVolume')), calls('nmVolume'))

    # 4) Ecualizador: se manda a Android, sin Web Audio
    clear()
    page.evaluate("saveFx({ eq: true, bands: [6,5,4,2,0,0,0,0,0,0], level: true }); 0"); page.wait_for_timeout(200)
    fx = page.evaluate("window.__nm.fx")
    check('ecualizador → Android (10 bandas, preamp, nivelador)', fx and fx.get('on') and len(fx.get('filters', [])) == 10 and fx.get('pre') == -6 and fx.get('level') is True, fx)
    check('sin cadena de Web Audio', page.evaluate("!musicFx.active && !musicFx.ctx"))
    page.evaluate("chooseHeadphones && chooseHeadphones(HP_BUILTIN[0]); 0"); page.wait_for_timeout(200)
    fx = page.evaluate("window.__nm.fx")
    check('auriculares + ecualizador = 20 filtros, en orden', fx and len(fx['filters']) == 20 and fx['filters'][0]['type'] == 'lowshelf' and fx['filters'][10]['fc'] == 31, fx and len(fx['filters']))
    page.evaluate("saveFx({ eq: false, hpOn: false, level: false }); 0"); page.wait_for_timeout(100)
    check('todo apagado → sin procesar', page.evaluate("window.__nm.fx.on") is False)

    # 5) Paso sin hueco: se engancha la siguiente y empieza sola al acabar
    clear()
    page.evaluate("saveFx({ crossfade: 0, gapless: true }); finMusicInterrupt(); musicUserPaused = false; musicState.queue = musicState.tracks.slice(2, 5); startTrack(musicState.tracks[1]); 0")
    page.wait_for_timeout(500)
    deck0 = page.evaluate("musicState.deck")
    page.wait_for_function("musicState.current && musicState.current.id === musicState.tracks[2].id", timeout=9000)
    page.wait_for_timeout(400)
    arms = [c for c in calls('nmArm') if c[1] >= 0]
    check('enganche pedido (platina que suena → la de la siguiente)', any(c[1] == deck0 and c[2] == 1 - deck0 for c in arms), calls('nmArm'))
    # Solo se engancha con la siguiente ya cargada: nunca antes de su nmLoad.
    seq = [c for c in calls() if c[0] in ('nmArm', 'nmLoad')]
    primer_arm = next((k for k, c in enumerate(seq) if c[0] == 'nmArm' and c[1] == deck0 and c[2] == 1 - deck0), -1)
    carga_sig = next((k for k, c in enumerate(seq) if c[0] == 'nmLoad' and 'track/203' in c[2]), 99)
    check('…y solo después de cargar la siguiente', 0 <= carga_sig < primer_arm, seq)
    check('la siguiente empezó sola (sin esperar a la web)', calls('__autostart'))
    check('la web pasa a la otra platina sin recargar ni reiniciar la canción',
          page.evaluate("musicState.deck") == 1 - deck0 and not [c for c in calls('nmSeek') if c[1] == 1 - deck0 and c[2] == 0]
          and len([c for c in calls('nmLoad') if 'track/203' in c[2]]) == 1, [calls('nmSeek'), [c for c in calls('nmLoad')]])
    check('sigue sonando', not paused())
    check('la anterior queda en el historial', page.evaluate("musicState.history.some(t => t.id === musicState.tracks[1].id)"))

    # 6) Si cambia la cola, se desengancha
    page.wait_for_function("musicState.preload && musicState.preload.ready", timeout=6000)
    page.wait_for_timeout(300)
    armed_before = page.evaluate("window.__nm.arm")
    clear()
    page.evaluate("musicState.queue = musicState.tracks.slice(6, 8); saveMusicQueue(); 0"); page.wait_for_timeout(600)
    seq = [c for c in calls() if c[0] in ('nmArm', 'nmLoad')]
    otra = page.evaluate("window.__nm.arm[1]")
    check('cola cambiada → se desengancha y, si acaso, se engancha la nueva siguiente',
          armed_before[0] >= 0 and seq and seq[0] == ['nmArm', -1, -1]
          and (otra < 0 or page.evaluate("window.__nm.decks[window.__nm.arm[1]].url").endswith('/207')), [armed_before, seq])
    # 6b) Repetir esta canción: nada enganchado
    page.evaluate("setMusicOpt('repeat', 'one'); 0"); page.wait_for_timeout(400)
    check('repetir esta canción → sin enganche', page.evaluate("window.__nm.arm")[0] == -1)
    page.evaluate("setMusicOpt('repeat', 'off'); 0")

    # 7) Fundido entre canciones: lo hace Android con rampas
    clear()
    page.evaluate("saveFx({ crossfade: 2 }); window.__nm.dur = 12; musicState.queue = musicState.tracks.slice(3, 6); startTrack(musicState.tracks[2]); 0")
    page.wait_for_timeout(500)
    page.evaluate("musicAudio().currentTime = 9.5; 0")
    page.wait_for_function("musicState.current && musicState.current.id === musicState.tracks[3].id", timeout=9000)
    page.wait_for_timeout(300)
    ramps = [c for c in calls('nmVolume') if c[3] and c[3] >= 1]
    check('fundido: una platina sube y otra baja (rampas en Android)', len(ramps) >= 2 and any(c[2] == 0 for c in ramps) and any(c[2] > 0 for c in ramps), ramps)
    page.wait_for_timeout(2600)
    check('…y la anterior se pausa al acabar el fundido', page.evaluate("musDecks[1 - musicState.deck].paused"))
    page.evaluate("saveFx({ crossfade: 0 }); window.__nm.dur = 4; 0")

    # 8) Interrupción del sistema (aviso corto) → vuelve sola
    page.evaluate("window.__nm.dur = 60; finMusicInterrupt(); musicUserPaused = false; startTrack(musicState.tracks[0]); 0"); page.wait_for_timeout(600)
    page.evaluate("window.__rvLastGesture = 0; window.__sysPause(); 0"); page.wait_for_timeout(300)
    check('pausa del sistema → interrupción', paused() and page.evaluate("!!musicInterrupted"))
    page.wait_for_timeout(4200)
    check('aviso corto: vuelve a sonar sola', not paused(), log()[-3:])
    # 8b) Durante una llamada Android no da el foco: sigue en pausa esperando
    page.evaluate("window.__st = 'call'; window.__sysPause(); 0"); page.wait_for_timeout(2500)
    check('llamada: espera en pausa', paused() and page.evaluate("!!musicInterrupted"))
    page.evaluate("window.__st = 'free'; 0"); page.wait_for_timeout(2500)
    check('al colgar vuelve a sonar', not paused())

    # 9) Fallo de lectura a mitad: se recupera la misma canción en la otra platina, en el mismo punto
    clear()
    page.evaluate("musicAudio().currentTime = 30; 0"); page.wait_for_timeout(200)
    cur = page.evaluate("musicState.current.id"); d0 = page.evaluate("musicState.deck")
    page.evaluate("musicRetry = { id: musicState.current.id, tries: 0, since: 0 }; window.rvNativeMusicEvent(musicState.deck, musDecks[musicState.deck]._gen, 'error', { t: 30, dur: 60, err: 2, msg: 'ERROR_CODE_IO_UNSPECIFIED' }); 0")
    page.wait_for_timeout(1500)
    check('fallo de lectura: sigue la misma canción', page.evaluate("musicState.current.id") == cur)
    check('…recargada en la otra platina cerca del mismo punto',
          page.evaluate("musicState.deck") == 1 - d0 and any(c[1] == 1 - d0 and 25 <= c[2] <= 30 for c in calls('nmSeek')), calls('nmSeek'))
    check('…y suena', not paused())
    check('el fallo queda en el registro con el motivo de Android', any('ERROR_CODE_IO' in m for m in log()), log()[-4:])

    # 10) Widget: botones de sección
    clear()
    page.evaluate("musicUserPaused = true; musicAudio().pause(); 0"); page.wait_for_timeout(200)
    page.evaluate("viferorReproducirSeccion('music'); 0"); page.wait_for_timeout(500)
    check('widget 🎵: suena la música', not paused())
    page.evaluate("localStorage.setItem('radio_resume_state', JSON.stringify({ station: { id: 'r1', name: 'Radio Prueba', url: '/audio/r.mp3', urls: ['/audio/r.mp3'] } })); 0")
    page.evaluate("window.__rr = []; window.reproducirRadio = (s) => window.__rr.push(s && s.name); viferorReproducirSeccion('radio'); 0")
    page.wait_for_timeout(200)
    check('widget 📻 sin emisora puesta: pone la última guardada', page.evaluate("window.__rr") == ['Radio Prueba'] or page.evaluate("!!currentStation"), page.evaluate("window.__rr"))
    page.evaluate("localStorage.setItem('radios_viferor_podcast_resume_v3', JSON.stringify({ episode: { id: 'e9', title: 'Episodio', audioUrl: '/audio/e.mp3', podcastTitle: 'Pod' }, pos: 10, at: Date.now() })); 0")
    page.evaluate("viferorReproducirSeccion('podcast'); 0"); page.wait_for_timeout(700)
    check('widget 🎙️: reanuda el último episodio', page.evaluate("podcastState.current && podcastState.current.id") == 'e9')
    check('…y la música se pausa', paused())
    check('lo anota en el registro', any('Widget: ▶ podcast' in m for m in log()), log()[-3:])

    # 11) Elegir el reproductor del navegador (ajuste en 🎚️ Sonido)
    page.evaluate("openFxPanel(); 0"); page.wait_for_timeout(200)
    check('ajuste «Reproductor nativo» en Sonido', page.locator('#fxMotorNativo').count() == 1 and page.locator('#fxMotorNativo').is_checked())
    page.locator('#fxMotorNativo').uncheck(); page.wait_for_timeout(200)
    page.reload(); page.wait_for_timeout(800)
    page.click('#btnViewMusic'); page.wait_for_function('musicState.loaded')
    check('con el ajuste en «navegador»: platinas <audio> de siempre', page.evaluate("musDecks.every(d => d instanceof HTMLAudioElement)"))
    page.evaluate("localStorage.removeItem('radios_viferor_music_engine'); sessionStorage.setItem('sinNativo', '1'); 0")
    page.reload(); page.wait_for_timeout(800)
    page.click('#btnViewMusic'); page.wait_for_function('musicState.loaded')
    check('APK antigua (sin nativo): platinas <audio> de siempre', page.evaluate("musDecks.every(d => d instanceof HTMLAudioElement) && !rvMotorNativo.activo()"))
    page.evaluate("openFxPanel(); 0"); page.wait_for_timeout(200)
    check('…y sin el ajuste del reproductor', page.locator('#fxMotorNativo').count() == 0)
    b.close()

print('\nErrores JS:', len(errors))
for e in errors[:15]: print('  ', e[:300])
fails = [r for r in results if not r[1]]
print(f'{len(results) - len(fails)}/{len(results)} OK')
srv.shutdown()
sys.exit(1 if fails else 0)
