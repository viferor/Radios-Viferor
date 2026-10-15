import json, os, re, time, threading, functools, http.server, socketserver, sys
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, 'shots'); os.makedirs(SHOTS, exist_ok=True)
TONE = open(os.path.join(HERE, 'tone.wav'), 'rb').read()
ARTS = [open(os.path.join(HERE, f'art{i}.png'), 'rb').read() for i in range(5)]
MODE = sys.argv[1] if len(sys.argv) > 1 else 'granted'   # granted | ask | old

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.ThreadingTCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=REPO))
srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d' % srv.server_address[1]

# Biblioteca simulada de MediaStore
LIB = []
albums = [
    ('Queen', 'A Night at the Opera', 1975, 'Rock', 'Music/Rock/Queen/A Night at the Opera', 8),
    ('Queen', 'News of the World', 1977, 'Rock', 'Music/Rock/Queen/News of the World', 6),
    ('Rosalía', 'El mal querer', 2018, 'Flamenco; Pop', 'Music/Pop/Rosalia', 7),
    ('', 'Grabaciones sueltas', 0, '', 'Download', 4),
    ('Varios', 'Éxitos del verano', 2020, 'Pop', 'Music/Recopilatorios/Verano', 15),
]
now = int(time.time())
tid = 100
for ai, (artist, album, year, genre, folder, n) in enumerate(albums):
    for k in range(1, n + 1):
        tid += 1
        a = artist if artist != 'Varios' else ['Shakira', 'Bad Bunny', 'Aitana'][k % 3]
        LIB.append({'id': tid, 't': f'{album[:10]} {k:02d}', 'a': a, 'al': album, 'aa': 'Varios artistas' if artist == 'Varios' else '',
                    'ai': ai + 1, 'n': (2000 + k) if (album == 'News of the World' and k > 3) else k, 'y': year, 'd': [180000, 240000, 95000, 420000][k % 4],
                    'fn': f'{k:02d} - pista.mp3', 'da': now - ai * 86400 * 20 - k, 's': 4_000_000, 'm': 'audio/mpeg', 'g': genre, 'f': folder})

TARGET = '00' + '3f' + 'f' * 60
SYNCED = '\n'.join(f'[00:{s:02d}.00]Line number {i+1}' for i, s in enumerate(range(1, 40, 3)))
def lyrics_api(r, u):
    from urllib.parse import urlparse, parse_qs
    q = {k: v[0] for k, v in parse_qs(urlparse(u).query).items()}
    state.setdefault('lyr_calls', []).append(q)
    if q.get('search') == '1':
        return r.fulfill(json={'items': [{'id': 77, 'trackName': q.get('title'), 'artistName': 'Queen', 'albumName': 'Otro', 'duration': 95, 'hasSynced': True, 'hasPlain': True, 'instrumental': False}, {'id': 78, 'trackName': q.get('title'), 'artistName': 'Queen', 'albumName': 'Live', 'duration': 300, 'hasSynced': False, 'hasPlain': True, 'instrumental': False}]})
    if q.get('id') == '77':
        return r.fulfill(json={'found': True, 'id': 77, 'synced': '[00:00.50]Versión elegida uno\n[00:02.00]Versión elegida dos', 'plain': 'x'})
    t = q.get('title', '')
    if t.endswith('01'): return r.fulfill(json={'found': True, 'id': 5, 'synced': SYNCED, 'plain': 'p'})
    if t.endswith('02'): return r.fulfill(json={'found': True, 'id': 6, 'synced': '', 'plain': 'Plain one\nPlain two\n\nPlain three\nPlain four'})
    return r.fulfill(json={'found': False})
def route(r):
    u = r.request.url
    if u.startswith('https://lrclib.net/api/'):
        state.setdefault('direct', []).append(u)
        if state.get('direct_fail'): return r.fulfill(status=503, body='busy', headers={'access-control-allow-origin': '*'})
        h = {'access-control-allow-origin': '*'}
        if '/get/' in u: return r.fulfill(json={'id': 91, 'trackName': 'X', 'artistName': 'Y', 'syncedLyrics': '[00:01.00]Directa id', 'plainLyrics': 'p'}, headers=h)
        if '/get?' in u: return r.fulfill(status=404, json={'code': 404}, headers=h)
        return r.fulfill(json=[{'id': 90, 'trackName': 'Tema Raro', 'artistName': 'Grupo', 'duration': 200, 'syncedLyrics': '[00:01.00]Directa', 'plainLyrics': 'Directa'}, {'id': 89, 'trackName': 'Otra', 'artistName': 'Nadie', 'plainLyrics': 'no'}], headers=h)
    if not u.startswith(BASE): return r.abort()
    if '/__music/library.json' in u:
        if MODE != 'granted' and not state.get('granted'): return r.fulfill(status=403, json={'ok': False, 'error': 'permission'})
        return r.fulfill(json={'ok': True, 'api': 1, 'count': len(LIB), 'tracks': LIB})
    if '/__music/ext/' in u:
        state.setdefault('ext', []).append(u)
        return r.fulfill(body=TONE, headers={'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-length': str(len(TONE))})
    if '/__music/extart/' in u:
        return r.fulfill(body=ARTS[0], headers={'content-type': 'image/png'})
    if '/__music/track/' in u:
        body = open(os.path.join(HERE,'withlyrics.mp3'),'rb').read() if u.endswith('/999') else TONE
        rng = {k.lower(): v for k, v in r.request.headers.items()}.get('range')
        ln = len(body)
        if rng and rng.startswith('bytes='):
            a, _, e = rng[6:].partition('-')
            a = int(a or 0); e = min(ln - 1, int(e) if e else ln - 1)
            state['ranges'] = state.get('ranges', 0) + 1
            return r.fulfill(status=206, body=body[a:e+1], headers={'content-type': 'audio/mpeg' if u.endswith('/999') else 'audio/wav', 'accept-ranges': 'bytes', 'content-range': f'bytes {a}-{e}/{ln}', 'content-length': str(e - a + 1)})
        return r.fulfill(body=body, headers={'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-length': str(ln)})
    m = re.search(r'/__music/art/(\d+)', u)
    if m:
        i = int(m.group(1)) - 1
        if i == 3: return r.fulfill(status=404, body='')
        return r.fulfill(body=ARTS[i % 5], headers={'content-type': 'image/png'})
    if '/m/' in u:
        return r.fulfill(body=open(os.path.join(HERE, u.rsplit('/', 1)[1]), 'rb').read(), headers={'content-type': 'audio/mpeg'})
    if '/api/lyrics-publish' in u:
        b = json.loads(r.request.post_data or '{}')
        if b.get('step') == 'challenge': return r.fulfill(json={'prefix': 'PFX9z', 'target': TARGET})
        state['publish'] = b
        return r.fulfill(json={'ok': True})
    if '/api/podcast-feed' in u:
        state.setdefault('feed', []).append(time.time())
        return r.fulfill(status=502, json={'error': 'No se pudo leer el podcast'})
    if '/api/similar' in u:
        state.setdefault('similar', []).append(u)
        return r.fulfill(json={'artist': 'Queen', 'artists': ['David Bowie', 'Rosalía', 'Led Zeppelin']})
    if '/api/lyrics' in u:
        if state.get('api_down'): return r.fulfill(status=502, json={'error': 'LRCLIB no responde (503)'})
        return lyrics_api(r, u)
    if '/api/translate' in u:
        body = json.loads(r.request.post_data or '{}')
        return r.fulfill(json={'lang': 'en', 'lines': [('ES: ' + l) if l.strip() else '' for l in body.get('lines', [])]})
    if '/api/song-meaning' in u:
        h = {k.lower(): v for k, v in r.request.headers.items()}
        state.setdefault('meaning_calls', []).append(h.get('x-ai-key'))
        state['meaning_body'] = json.loads(r.request.post_data or '{}')
        if not h.get('x-ai-key'): return r.fulfill(status=501, json={'error': 'no-key'})
        return r.fulfill(json={'text': '### En pocas palabras\nUna canción sobre **la libertad**.\n\n### Temas e imágenes\n- El mar\n- La noche', 'provider': 'gemini', 'model': 'gemini-3.6-flash'})
    if '/api/' in u: return r.fulfill(json={})
    if '/audio/' in u: return r.fulfill(body=TONE, headers={'content-type': 'audio/wav'})
    return r.continue_()
state = {}

errors, results = [], []
def check(name, cond, extra=''):
    results.append((name, bool(cond)))
    print(('OK   ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''))

ANDROID_MOCK = """
window.__calls = [];
const rec = n => (...a) => { window.__calls.push([n, ...a]); };
window.Android = {
  %s
  musicPermissionStatus: () => window.__perm || 'granted',
  requestMusicPermission: rec('requestMusicPermission'),
  openAppSettings: rec('openAppSettings'),
  setPlaybackSection: rec('setPlaybackSection'),
  startMusicMedia: rec('startMusicMedia'),
  updatePodcastMedia: rec('updatePodcastMedia'),
  startPodcastMedia: rec('startPodcastMedia'),
  stopPodcastMedia: rec('stopPodcastMedia'),
  syncPodcastSubscriptions: rec('sync'),
  canResumeAudio: () => true,
  saveTextFile: rec('saveTextFile')
};
""" % ('' if MODE == 'old' else 'musicApiVersion: () => 1,')

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.route('**/*', route)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e) + ' ' + str(getattr(e,'stack',''))[:400]))
    page.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.add_init_script(ANDROID_MOCK + """
      if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded','1'); }
      window.__perm = sessionStorage.getItem('perm') || %s;
    """ % json.dumps('ask' if MODE == 'ask' else 'granted'))

    page.goto(BASE + '/index.html'); page.wait_for_timeout(800)
    page.click('#btnViewMusic'); page.wait_for_function('musicState.loaded')
    page.evaluate("window.Android.audioState = () => window.__st || 'free'; 0")
    log = lambda: page.evaluate("JSON.parse(localStorage.getItem('radios_viferor_error_log_v1') || '[]').map(x => x.message)")
    def play():
        page.evaluate("window.__st = 'free'; if (!musicState.current) playTrackNow(musicState.tracks[0]); else if (musicAudio().paused) { musicUserPaused = false; musicAudio().play(); } 0"); page.wait_for_timeout(1200)
    def sys_pause():
        page.evaluate("window.__rvLastGesture = 0; musicAudio().pause(); 0"); page.wait_for_timeout(300)
    paused = lambda: page.evaluate("musicAudio().paused")
    # 1) Otra app suena más de 45 s → queda en pausa, aunque luego se calle
    play(); page.evaluate("window.__st = 'busy'; 0"); sys_pause()
    check('pausa del sistema → interrupción', page.evaluate("!!musicInterrupted") and paused())
    page.evaluate("musicInterruptInfo.t0 -= 50000; 0"); page.wait_for_timeout(1800)
    check('otra app > 45 s: queda en pausa', page.evaluate("!musicInterrupted && musicUserPaused") and paused())
    page.evaluate("window.__st = 'free'; 0"); page.wait_for_timeout(3500)
    check('…y no arranca sola cuando la otra app calla', paused())
    check('lo anota', any('queda en pausa' in m for m in log()), log()[-2:])
    # 2) Aviso corto → vuelve sola
    play(); sys_pause(); page.wait_for_timeout(4200)
    check('aviso corto: vuelve a sonar sola', not paused())
    check('lo anota (vuelve sola)', any('vuelve a sonar sola' in m for m in log()))
    # 3) Llamada larga → vuelve al colgar
    page.evaluate("window.__st = 'call'; 0"); sys_pause(); page.evaluate("musicInterruptInfo.t0 -= 600000; 0"); page.wait_for_timeout(2000)
    check('durante la llamada sigue esperando', paused() and page.evaluate("!!musicInterrupted && musicInterruptInfo.call"))
    page.evaluate("window.__st = 'free'; 0"); page.wait_for_timeout(2000)
    check('al colgar vuelve a sonar aunque haya durado 10 min', not paused())
    # 4) Ajuste desactivado
    page.evaluate("localStorage.setItem('radios_viferor_resume_after_interrupt', '0'); 0"); sys_pause(); page.wait_for_timeout(2000)
    check('ajuste en «no»: queda en pausa', paused() and page.evaluate("musicUserPaused"))
    page.evaluate("localStorage.removeItem('radios_viferor_resume_after_interrupt'); 0")
    # 5) Vigilancia de reanudar no arranca si lo pausó otra cosa
    play(); page.evaluate("toggleMusicPlay()"); page.wait_for_timeout(600)
    page.evaluate("window.__st = 'busy'; toggleMusicPlay(); 0"); page.wait_for_timeout(1500)
    sys_pause(); page.evaluate("musicInterruptInfo.t0 -= 50000; 0"); page.wait_for_timeout(7000)
    check('la vigilancia de «reanudar» no la arranca si la pausó otra app', paused(), log()[-3:])
    # 6) «Reanudar al abrir»: la marca de sonando se quita al pausar
    page.evaluate("""localStorage.setItem('radios_viferor_playback_resume_v1', JSON.stringify({ type: 'radio', station: { name: 'X' }, playing: true, at: Date.now() })); currentStation = { name: 'X', id: 'x' }; saveRadioResume(false); 0""")
    check('radio en pausa: ya no queda marcada como sonando', page.evaluate("JSON.parse(localStorage.getItem('radios_viferor_playback_resume_v1')).playing") is False)
    page.evaluate("""localStorage.setItem('radios_viferor_playback_resume_v1', JSON.stringify({ type: 'podcast', episode: { id: 'e1' }, playing: true, at: Date.now() })); podcastState.current = { id: 'e1', title: 'Ep', audioUrl: '/audio/a.wav' }; savePodcastResume(false); 0""")
    check('podcast en pausa: ya no queda marcado como sonando', page.evaluate("JSON.parse(localStorage.getItem('radios_viferor_playback_resume_v1')).playing") is False)
    # 7) Ajuste visible
    check('ajuste «Volver a sonar tras una llamada o aviso»', page.locator('#btnResumeAfter').count() == 1)
    b.close()

print('\nErrores JS:', len(errors))
for e in errors[:15]: print('  ', e[:300])
fails = [r for r in results if not r[1]]
print(f'{len(results) - len(fails)}/{len(results)} OK')
srv.shutdown()
