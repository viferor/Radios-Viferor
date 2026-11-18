"""Tocar una canción de la cola debe empezar desde el principio (web 1.39.1).

Fallo: al abrir la app se dejaba preparada la última canción en su punto (p. ej. el
segundo 7) y ese «ir al segundo 7 cuando cargue» se quedaba pegado a la platina. Con
fundido (o al precargar la siguiente), cualquier canción que se cargara después en esa
platina empezaba también en el segundo 7. Usa el Android simulado de test_motor_nativo.py.

    python tests/test_cola_posicion.py
"""
import json, os, re, time, threading, functools, http.server, socketserver, sys
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
TONE = open(os.path.join(HERE, 'tone.wav'), 'rb').read()
FAKE_NATIVE = re.search(r'FAKE_NATIVE = r"""(.*?)"""', open(os.path.join(HERE, 'test_motor_nativo.py'), encoding='utf-8').read(), re.S).group(1)

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.ThreadingTCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=REPO))
srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d' % srv.server_address[1]
now = int(time.time())
LIB = [{'id': 200 + k, 't': f'Canción {k:02d}', 'a': 'Grupo', 'al': 'Disco', 'aa': '', 'ai': 1, 'n': k, 'y': 2020,
        'd': 12000, 'fn': f'{k:02d}.flac', 'da': now - k, 's': 40_000_000, 'm': 'audio/flac', 'g': 'Pop', 'f': 'Music/Disco'} for k in range(1, 9)]

def route(r):
    u = r.request.url
    if not u.startswith(BASE): return r.abort()
    if '/__music/library.json' in u: return r.fulfill(json={'ok': True, 'api': 1, 'count': len(LIB), 'tracks': LIB})
    if '/__music/' in u or '/audio/' in u: return r.fulfill(body=TONE, headers={'content-type': 'audio/wav'})
    if '/api/' in u: return r.fulfill(json={})
    return r.continue_()

results, errors = [], []
def check(name, cond, extra=''):
    results.append((name, bool(cond)))
    print(('OK   ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''))

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    ctx.route('**/*', route)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script(FAKE_NATIVE + """
      window.__nm.dur = 12;
      if (!sessionStorage.getItem('seeded')) {
        localStorage.clear(); sessionStorage.setItem('seeded','1');
        // La app se cerró con la canción 1 en el segundo 7.
        localStorage.setItem('radios_viferor_music_resume_v1', JSON.stringify({ id: 'a201', pos: 7, at: Date.now() }));
      }
    """)
    calls = lambda n: [c for c in page.evaluate('window.__calls') if c[0] == n]
    seeks7 = lambda: [c for c in calls('nmSeek') if abs(c[2] - 7) < 0.01]
    page.goto(BASE + '/index.html'); page.wait_for_timeout(800)
    page.click('#btnViewMusic'); page.wait_for_function('musicState.loaded')
    page.wait_for_timeout(400)
    check('al abrir: la última canción preparada en el segundo 7', page.evaluate("musicState.current?.id") == 'a201' and len(seeks7()) == 1, calls('nmSeek'))
    # ▶ (como desde el widget) y la canción acaba sola: pasa a la otra platina sin pausa
    page.evaluate("window.__calls = []; 0")
    page.evaluate("saveFx({ crossfade: 0, gapless: true }); musicState.queue = musicState.tracks.slice(1, 7); toggleMusicPlay(); 0"); page.wait_for_timeout(800)
    page.evaluate("musicAudio().currentTime = 10.5; 0"); page.wait_for_timeout(3500)
    d0 = page.evaluate("musicState.deck")
    cur = page.evaluate("musicAudio().currentTime")
    check('la siguiente (sin pausa) empieza desde el principio y la precargada no salta al 7', page.evaluate("musicState.current.id") == 'a202' and cur < 4 and not seeks7(), [page.evaluate("musicState.current.title"), cur, calls('nmSeek')])
    # Y la que se precarga después en la primera platina tampoco salta al segundo 7
    page.evaluate("musicAudio().currentTime = 10.5; 0"); page.wait_for_timeout(3500)
    cur = page.evaluate("musicAudio().currentTime")
    check('la de después también desde el principio', page.evaluate("musicState.current.id") == 'a203' and cur < 4 and not seeks7(), [page.evaluate("musicState.current.title"), cur, calls('nmSeek')])
    # Tocar canciones de la cola con fundido (cargan en la otra platina)
    page.evaluate("saveFx({ crossfade: 2 }); 0")
    for k in range(3):
        page.evaluate("window.__calls = []; musicState.queue = musicState.tracks.slice(3, 8); playQueueFrom(%d); 0" % k); page.wait_for_timeout(1800)
        cur = page.evaluate("musicAudio().currentTime")
        check(f'cola ({k + 1}): «{page.evaluate("musicState.current.title")}» empieza desde el principio', cur < 4 and not seeks7(), [cur, calls('nmSeek')])
    # Seguir donde se quedó sigue funcionando para su propia canción
    page.evaluate("window.__calls = []; startTrack(musicState.tracks[5], { pos: 5 }); 0"); page.wait_for_timeout(800)
    check('reanudar en un punto sigue funcionando (segundo 5)', any(abs(c[2] - 5) < 0.01 for c in calls('nmSeek')), calls('nmSeek'))
    b.close()

check('sin errores de página', not errors, errors)
bad = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(bad)}/{len(results)} OK')
sys.exit(1 if bad else 0)
