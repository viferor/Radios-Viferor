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

    page.goto(BASE + '/index.html'); page.wait_for_timeout(600)
    page.click('#btnViewMusic'); page.wait_for_function('musicState.loaded')
    page.evaluate("openMusicScreen('album:' + [...musicState.albums.values()].find(a=>a.name==='A Night at the Opera').key)"); page.wait_for_timeout(300)
    page.locator('#musicContent .mus-row').first.locator('.pod-qinfo').click(); page.wait_for_timeout(600)
    page.click('#musMiniOpen'); page.wait_for_timeout(200)
    # --- Gestos en el reproductor
    order = page.evaluate("musicState.queue.slice(0,2).map(t=>t.id)")
    c0 = page.evaluate("musicState.current.id")
    ab = page.locator('#musExpArt').bounding_box()
    ax, ay = ab['x'] + ab['width'] / 2, ab['y'] + ab['height'] / 2
    def swipe(d, steps=8):
        page.mouse.move(ax, ay); page.mouse.down(); page.mouse.move(ax + d, ay + 4, steps=steps); page.mouse.up(); page.wait_for_timeout(700)
    swipe(-170)
    check('deslizar a la izquierda → siguiente', page.evaluate("musicState.current.id") == order[0] and page.locator('#lyrPanel').count() == 0, page.evaluate("musicState.current.id"))
    swipe(170)
    check('deslizar a la derecha → anterior', page.evaluate("musicState.current.id") == c0, page.evaluate("musicState.current.id"))
    swipe(40, steps=4)
    check('gesto corto: no cambia ni abre la letra', page.evaluate("musicState.current.id") == c0 and page.locator('#lyrPanel').count() == 0 and page.evaluate("getComputedStyle(document.getElementById('musExpArt')).transform") in ('none', 'matrix(1, 0, 0, 1, 0, 0)'))
    page.mouse.move(ax, ay); page.mouse.down(); page.mouse.move(ax + 5, ay + 120, steps=6); page.mouse.up(); page.wait_for_timeout(300)
    check('deslizar en vertical no cambia de canción', page.evaluate("musicState.current.id") == c0)
    page.evaluate("window.closeLyricsPanel && closeLyricsPanel()")
    # --- Carátula → letra
    page.click('#musExpArt'); page.wait_for_selector('#lyrBody .lyr-line')
    check('pulsar la carátula abre la letra', page.locator('#lyrPanel').is_visible())
    # --- Ajustar arrastrando
    check('botón «Ajustar arrastrando» en la letra sincronizada', page.locator('#lyrFoot button', has_text='Ajustar arrastrando').count() == 1)
    page.evaluate("const a=musicAudio(); a.currentTime = 10; if (a.paused) toggleMusicPlay();"); page.wait_for_timeout(300)
    page.locator('#lyrFoot button', has_text='Ajustar arrastrando').click(); page.wait_for_timeout(700)
    check('modo ajuste: guía visible y ayuda', page.locator('#lyrGuide').is_visible() and page.locator('.lyr-adj-help').count() == 1)
    gy = page.evaluate("document.getElementById('lyrGuide').getBoundingClientRect().top")
    def line_at_guide():
        return page.evaluate("""(y) => { let best=0; document.querySelectorAll('#lyrBody .lyr-line').forEach((r,i)=>{ const b=r.getBoundingClientRect(); if ((b.top + b.bottom) / 2 <= y + 1) best = i; }); return best; }""", gy)
    now_i = lambda: page.evaluate("[...document.querySelectorAll('#lyrBody .lyr-line')].findIndex(x=>x.classList.contains('now'))")
    check('sin tocar, la línea que suena queda en la guía', line_at_guide() == now_i() and now_i() >= 2, (line_at_guide(), now_i()))
    off0 = page.evaluate("lyr.data.offset || 0")
    box = page.locator('#lyrBody').bounding_box()
    x = box['x'] + box['width'] / 2; y = box['y'] + box['height'] / 2
    page.mouse.move(x, y); page.mouse.down()
    for k in range(1, 11):
        page.mouse.move(x, y - 16 * k); page.wait_for_timeout(30)
    mid_off = page.evaluate("lyr.data.offset")
    check('arrastrar hacia arriba adelanta la letra (desfase +)', mid_off > off0 + 1, mid_off)
    check('mientras arrastras, se ilumina la línea de la guía', line_at_guide() == now_i(), (line_at_guide(), now_i()))
    page.mouse.up(); page.wait_for_timeout(800)
    saved = page.evaluate("lyrUserGet(lyr.track)?.offset")
    check('al soltar se guarda el desfase', saved is not None and abs(saved - page.evaluate("lyr.data.offset")) < 0.06, saved)
    check('tras soltar sigue la línea de la guía', line_at_guide() == now_i(), (line_at_guide(), now_i()))
    check('el desfase se ve en el pie', '+' in page.inner_text('#lyrAdjVal'), page.inner_text('#lyrAdjVal'))
    page.screenshot(path=f'{SHOTS}/r-01-ajuste.png')
    0 and print('DBG', page.evaluate("[...document.getElementById('lyrPanel').children].map(c => c.className + ' ' + c.id + ' ' + JSON.stringify(c.getBoundingClientRect()) + ' ' + getComputedStyle(c).position)"))
    v1 = page.evaluate("lyr.data.offset"); page.locator('#lyrFoot button', has_text='+0,1 s').click(); page.wait_for_timeout(100)
    check('+0,1 s', abs(page.evaluate("lyr.data.offset") - v1 - 0.1) < 0.06)
    page.locator('#lyrFoot button', has_text='Deshacer').click(); page.wait_for_timeout(200)
    check('deshacer vuelve al desfase inicial', abs(page.evaluate("lyr.data.offset || 0") - off0) < 0.01 and page.locator('#lyrGuide').is_hidden() and abs((page.evaluate("lyrUserGet(lyr.track)?.offset") or 0) - off0) < 0.01)
    page.locator('#lyrFoot button', has_text='Ajustar arrastrando').click(); page.wait_for_timeout(400)
    page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x, y + 90, steps=6); page.mouse.up(); page.wait_for_timeout(500)
    neg = page.evaluate("lyr.data.offset")
    check('arrastrar hacia abajo retrasa la letra (desfase −)', neg < off0 - 0.5, neg)
    # Táctil: el dedo desplaza la lista (scroll nativo)
    page.evaluate("const b=document.getElementById('lyrBody'); b.dispatchEvent(new TouchEvent('touchstart', {bubbles:true})); window.__t0 = b.scrollTop;")
    for k in range(1, 8):
        page.evaluate(f"document.getElementById('lyrBody').scrollTop = window.__t0 + {20*k}"); page.wait_for_timeout(40)
    page.evaluate("document.getElementById('lyrBody').dispatchEvent(new TouchEvent('touchend', {bubbles:true}))"); page.wait_for_timeout(600)
    tch = page.evaluate("lyr.data.offset")
    check('táctil: deslizar hacia arriba adelanta y se guarda', tch > neg + 0.8 and abs(page.evaluate("lyrUserGet(lyr.track).offset") - tch) < 0.06 and line_at_guide() == now_i(), (neg, tch))
    neg = tch
    check('Atrás termina el ajuste y lo guarda', page.evaluate('handleAndroidBack()') and page.locator('#lyrPanel').is_visible() and page.locator('#lyrGuide').is_hidden() and abs(page.evaluate("lyrUserGet(lyr.track).offset") - neg) < 0.06)
    page.locator('#lyrBody .lyr-line').nth(5).click(); page.wait_for_timeout(200)
    check('fuera del ajuste, tocar una línea sigue saltando', abs(page.evaluate("musicAudio().currentTime") - (16.0 - neg)) < 0.6, page.evaluate("musicAudio().currentTime"))
    page.evaluate("closeLyricsPanel()")
    # --- Radio de una canción
    seed = page.evaluate("musicState.current.id")
    page.click('#musExpMore'); page.wait_for_timeout(200)
    check('«Radio de esta canción» en el menú ⋯ del reproductor', page.locator('.pod-sheet button', has_text='Radio de esta canción').count() == 1)
    page.locator('.pod-sheet button', has_text='Radio de esta canción').click(); page.wait_for_timeout(800)
    q = page.evaluate("musicState.queue.map(t => ({a: trackArtist(t), al: t.album}))")
    check('pide artistas parecidos a Deezer', state.get('similar') and 'artist=Queen' in state['similar'][-1], state.get('similar'))
    check('sigue sonando la misma canción', page.evaluate("musicState.current.id") == seed and page.evaluate("!musicAudio().paused"))
    check('cola de radio creada', len(q) >= 15 and page.evaluate("!!musicState.radio"), len(q))
    first = q[:9]
    check('primero lo parecido (Queen y artistas parecidos)', all(x['a'] in ('Queen', 'Rosalía') for x in first), first)
    check('incluye artistas parecidos (Rosalía)', any(x['a'] == 'Rosalía' for x in q[:12]), q[:12])
    check('no repite canciones', len(set(page.evaluate("musicState.queue.map(t=>t.id)"))) == len(q) and seed not in page.evaluate("musicState.queue.map(t=>t.id)"))
    reps = sum(1 for i in range(1, len(first)) if first[i]['a'] == first[i-1]['a'])
    check('mezcla artistas (pocas seguidas del mismo)', reps <= 5, [x['a'] for x in first])
    # Radio sin fin
    page.evaluate("musicState.queue = musicState.queue.slice(0, 1); saveMusicQueue();")
    page.evaluate("nextTrack(false)"); page.wait_for_timeout(800)
    check('radio sin fin: rellena la cola al acabarse', page.evaluate("musicState.queue.length") >= 5, page.evaluate("musicState.queue.length"))
    page.evaluate("playCollection(musicState.tracks.slice(0,5), 0)"); page.wait_for_timeout(300)
    check('otra colección quita el modo radio', page.evaluate("musicState.radio") is None)
    # Radio desde el ⋯ de otra canción (no la que suena)
    page.evaluate("openTrackMenu([...musicState.albums.values()].find(a=>a.name==='El mal querer').tracks[0])"); page.wait_for_timeout(200)
    page.locator('.pod-sheet button', has_text='Radio de esta canción').click(); page.wait_for_timeout(900)
    check('radio de otra canción: empieza por ella', page.evaluate("musicState.current.album") == 'El mal querer' and page.evaluate("musicState.queue.length") >= 10)
    # --- Canciones cortas
    page.evaluate("closeMusicExpanded && closeMusicExpanded(); const T=musicState.tracks; T[3].dur = 4; T[7].dur = 0; T[9].dur = 25; T[12].dur = 100;")
    page.click('#musMenu'); page.wait_for_timeout(200)
    page.locator('.pod-sheet button', has_text='Buscar canciones cortas').click(); page.wait_for_timeout(200)
    hint30 = page.locator('.pod-sheet button', has_text='Menos de 30 s').inner_text()
    check('menú con duraciones y recuento', '3 canciones' in hint30, hint30)
    page.locator('.pod-sheet button', has_text='Menos de 30 s').click(); page.wait_for_timeout(300)
    rows = page.locator('#musicContent .mus-row')
    check('pantalla: 3 canciones (incluida la sin duración)', rows.count() == 3 and 'sin duración' in page.inner_text('#musicContent'), rows.count())
    check('ordenadas de más corta a más larga', page.evaluate("[...document.querySelectorAll('#musicContent .mus-row')].map(r=>musicState.byId.get(r.dataset.id).dur)") == [0, 4, 25])
    check('muestra la ruta del archivo', '/' in rows.nth(1).locator('small').inner_text(), rows.nth(1).locator('small').inner_text())
    page.locator('.mus-chips button', has_text='2 min').click(); page.wait_for_timeout(300)
    check('cambiar a < 2 min', rows.count() == page.evaluate('musicState.tracks.filter(t=>!(t.dur>0)||t.dur<120).length') and rows.count() > 4 and page.evaluate("musicState.screen") == 'short:120')
    page.locator('.mus-chips button', has_text='Otra').click(); page.wait_for_timeout(200)
    page.fill('.pod-sheet-form input', '0:10'); page.locator('.pod-sheet-ok').click(); page.wait_for_timeout(300)
    check('otra duración (0:10 → 10 s)', page.evaluate("musicState.screen") == 'short:10' and rows.count() == 2 and page.locator('.mus-chips button.on').inner_text() == '< 10 s')
    page.screenshot(path=f'{SHOTS}/r-02-cortas.png')
    # --- Eliminar: «está bien», quitar de la biblioteca, borrar del móvil
    page.evaluate("openShortTracks(30, true)"); page.wait_for_timeout(300)
    ids = page.evaluate("[...document.querySelectorAll('#musicContent .mus-row')].map(r=>r.dataset.id)")
    page.locator('#musicContent .mus-row').nth(2).locator('.pod-qmenu').click(); page.wait_for_timeout(200)
    page.locator('.pod-sheet button', has_text='Está bien').click(); page.wait_for_timeout(300)
    check('«está bien»: deja de salir', rows.count() == 2 and page.locator('.mus-link').count() == 1)
    page.locator('.mus-link').click(); page.wait_for_timeout(200)
    check('volver a mostrar las marcadas', rows.count() == 3)
    # Quitar de la biblioteca
    n_before = page.evaluate("musicState.tracks.length")
    page.locator('#musicContent .mus-row').nth(1).locator('.pod-qdel').click(); page.wait_for_timeout(200)
    check('✕ abre eliminar con las dos opciones', page.locator('.pod-sheet button', has_text='Quitar de la biblioteca').count() == 1 and page.locator('.pod-sheet button', has_text='Borrar del móvil').count() == 1)
    page.evaluate("musicState.queue.unshift(musicState.byId.get(%s))" % json.dumps(ids[1]))
    page.locator('.pod-sheet button', has_text='Quitar de la biblioteca').click(); page.wait_for_timeout(300)
    check('quitada de la biblioteca, de la lista y de la cola', page.evaluate("musicState.tracks.length") == n_before - 1 and rows.count() == 2 and not page.evaluate("musicState.queue.some(t=>t.id===%s)" % json.dumps(ids[1])))
    page.evaluate("ensureMusicLibrary(true)"); page.wait_for_timeout(800)
    check('sigue quitada tras volver a leer la biblioteca', page.evaluate("musicState.tracks.length") == n_before - 1)
    page.click('#musMenu'); page.wait_for_timeout(200)
    page.locator('.pod-sheet button', has_text='Canciones quitadas').click(); page.wait_for_timeout(200)
    page.locator('.pod-sheet button', has_text='Devolverlas todas').click(); page.wait_for_timeout(300)
    check('devolver a la biblioteca', page.evaluate("musicState.tracks.length") == n_before)
    # Borrar del móvil (Android 11+: confirma el sistema)
    page.evaluate("""window.Android.musicDeleteMode = () => 'system';
      window.Android.deleteMusicFiles = (req, csv) => { (window.__dc = window.__dc || []).push([req, csv, new Error().stack.slice(0, 300)]); window.__del = csv; setTimeout(() => window.onAndroidMusicDeleted(req, csv.split(',').map(Number), null), 50); }; 0""")
    page.evaluate("const T=musicState.tracks; T[3].dur = 4; T[7].dur = 0; T[9].dur = 25; openShortTracks(30, true)"); page.wait_for_timeout(300)
    victim = page.evaluate("document.querySelectorAll('#musicContent .mus-row')[0].dataset.id")
    page.evaluate("playTrackNow(musicState.byId.get(%s)); musicState.queue = musicState.tracks.slice(20,23)" % json.dumps(victim)); page.wait_for_timeout(500)
    page.locator('#musicContent .mus-row').nth(0).locator('.pod-qdel').click(); page.wait_for_timeout(200)
    page.locator('.pod-sheet button', has_text='Borrar del móvil').click(); page.wait_for_timeout(600)
    check('borra en Android con el id de MediaStore', page.evaluate("window.__del") == victim[1:], page.evaluate("window.__del"))
    check('borrada: fuera de la biblioteca y pasa a la siguiente', not page.evaluate("musicState.byId.has(%s)" % json.dumps(victim)) and page.evaluate("musicState.current && musicState.current.id") != victim and page.evaluate("musicState.tracks.length") == n_before - 1)
    # Cancelado en el diálogo del sistema
    page.evaluate("""window.Android.deleteMusicFiles = (req, csv) => setTimeout(() => window.onAndroidMusicDeleted(req, [], 'cancelled'), 50); 0""")
    n1 = page.evaluate("musicState.tracks.length")
    page.evaluate("deleteTracksFlow([musicState.tracks[30]])"); page.wait_for_timeout(200)
    page.locator('.pod-sheet button', has_text='Borrar del móvil').click(); page.wait_for_timeout(500)
    check('cancelado: no cambia nada', page.evaluate("musicState.tracks.length") == n1)
    # Android 10 o anterior: confirma la app
    page.evaluate("window.Android.musicDeleteMode = () => 'app'; window.Android.deleteMusicFiles = (req, csv) => setTimeout(() => window.onAndroidMusicDeleted(req, csv.split(',').map(Number), null), 50); 0")
    page.evaluate("deleteTracksFlow([musicState.tracks[30]])"); page.wait_for_timeout(200)
    page.locator('.pod-sheet button', has_text='Borrar del móvil').click(); page.wait_for_timeout(300)
    check('Android antiguo: la app pide confirmación', page.locator('.pod-sheet button', has_text='Sí, borrar').count() == 1)
    page.locator('.pod-sheet button', has_text='Sí, borrar').click(); page.wait_for_timeout(400)
    check('…y borra', page.evaluate("musicState.tracks.length") == n1 - 1)
    # Menú de cualquier canción
    page.evaluate("openTrackMenu(musicState.tracks[0])"); page.wait_for_timeout(200)
    check('«Eliminar…» en el menú de canción', page.locator('.pod-sheet button', has_text='Eliminar…').count() == 1)
    page.evaluate("closePodSheet()")
    # --- Duplicadas
    page.evaluate("""(() => {
      const T = musicState.allTracks;
      const base = T.find(t => t.title === 'El mal que 03');
      const mk = (id, extra) => Object.assign({}, base, { id, art: '', albumKey: '' }, extra);
      T.push(mk('dup1', { folder: 'Download', file: 'el mal 03.mp3', size: base.size / 2, title: 'El mal que 03 (Remastered 2019)' }));
      T.push(mk('dup2', { folder: 'Music/Copias', file: 'el mal 03 copia.mp3' }));
      T.push(mk('ver1', { folder: 'Music/Live', file: 'live.mp3', dur: base.dur + 60 }));
      applyFolderFilter();
    })(); 0""")
    page.click('#musMenu'); page.wait_for_timeout(200)
    page.locator('.pod-sheet button', has_text='Buscar canciones duplicadas').click(); page.wait_for_timeout(400)
    grp = page.locator('.mus-dup-group')
    check('duplicadas: grupo con 3 copias (misma canción)', grp.count() >= 1 and page.evaluate("findDuplicateGroups('song').some(g => g.tracks.length === 3 && g.tracks.some(t=>t.id==='dup1'))"))
    best = page.evaluate("findDuplicateGroups('song').find(g => g.tracks.some(t=>t.id==='dup1')).best.id")
    check('recomienda conservar la original (no la de Download)', best not in ('dup1',), best)
    check('la de duración muy distinta no entra en «misma canción»', not page.evaluate("findDuplicateGroups('song').some(g => g.tracks.some(t=>t.id==='ver1'))"))
    page.locator('.mus-chips button', has_text='Mismo título y artista').click(); page.wait_for_timeout(300)
    check('«mismo título y artista» incluye la versión larga', page.evaluate("findDuplicateGroups('title').some(g => g.tracks.length === 4)"))
    page.locator('.mus-chips button', has_text='Copias exactas').click(); page.wait_for_timeout(300)
    check('copias exactas: mismo tamaño y duración', page.evaluate("findDuplicateGroups('exact').some(g => g.tracks.some(t=>t.id==='dup2'))") and not page.evaluate("findDuplicateGroups('exact').some(g => g.tracks.some(t=>t.id==='dup1'))"))
    page.locator('.mus-chips button', has_text='Misma canción').click(); page.wait_for_timeout(300)
    page.screenshot(path=f'{SHOTS}/r-03-duplicadas.png')
    g0 = page.locator('.mus-dup-group').first
    n_groups = page.locator('.mus-dup-group').count()
    g0.locator('button', has_text='No son duplicadas').click(); page.wait_for_timeout(300)
    check('«no son duplicadas» oculta el grupo', page.locator('.mus-dup-group').count() == n_groups - 1 and page.locator('.mus-link', has_text='no son duplicadas').count() == 1)
    page.locator('.mus-link', has_text='no son duplicadas').click(); page.wait_for_timeout(300)
    page.locator('.mus-dup-group').first.locator('button', has_text='sobrante').click(); page.wait_for_timeout(200)
    check('eliminar sobrantes abre eliminar', page.locator('.pod-sheet button', has_text='Quitar de la biblioteca').count() == 1)
    page.evaluate("closePodSheet()")
    # --- Listas: repetidas al añadir
   
    page.evaluate("musicState.lists = []; saveMusicLists(); 0")
    page.evaluate("chooseMusicListFor([musicState.byId.get('dup2'), musicState.byId.get(%s), musicState.tracks[0]]); 0" % json.dumps(best)); page.wait_for_timeout(200)
    page.fill('.pod-sheet-form input', 'Prueba'); page.locator('.pod-sheet-ok').click(); page.wait_for_timeout(300)
    check('lista nueva: avisa de repetidas entre las que añades', page.locator('.pod-sheet button', has_text='Añadir solo las nuevas (2)').count() == 1, page.inner_text('.pod-sheet') if page.locator('.pod-sheet').count() else '')
    page.locator('.pod-sheet button', has_text='Ver cuáles son').click(); page.wait_for_timeout(200)
    check('«ver cuáles son» lista la repetida', 'repetida' in page.inner_text('.pod-sheet'))
    page.locator('.pod-sheet button', has_text='Volver').click(); page.wait_for_timeout(200)
    page.locator('.pod-sheet button', has_text='Añadir solo las nuevas').click(); page.wait_for_timeout(300)
    L = page.evaluate("musicState.lists[0].items.map(x=>x.id)")
    check('solo las nuevas: 2 canciones', len(L) == 2, L)
    page.evaluate("chooseMusicListFor([musicState.byId.get('dup1'), musicState.tracks[0], musicState.tracks[1]])"); page.wait_for_timeout(200)
    page.locator('.pod-sheet button', has_text='Prueba').click(); page.wait_for_timeout(200)
    txt = page.inner_text('.pod-sheet')
    check('añadir a lista existente: detecta «ya está» y «otra copia»', 'ya está' in txt and 'otra copia' in txt, txt)
    page.locator('.pod-sheet button', has_text='Añadir solo las nuevas (1)').click(); page.wait_for_timeout(300)
    check('añade solo la nueva', page.evaluate("musicState.lists[0].items.length") == 3)
    page.evaluate("chooseMusicListFor([musicState.tracks[0]])"); page.wait_for_timeout(200)
    page.locator('.pod-sheet button', has_text='Prueba').click(); page.wait_for_timeout(200)
    page.locator('.pod-sheet button', has_text='Añadir igualmente').click(); page.wait_for_timeout(300)
    check('«añadir igualmente» la repite', page.evaluate("musicState.lists[0].items.length") == 4)
    page.evaluate("openMusicScreen('list:' + musicState.lists[0].id)"); page.wait_for_timeout(300)
    check('la lista avisa de repetidas', page.locator('.mus-dup-note').count() == 1)
    page.locator('.mus-dup-note button').click(); page.wait_for_timeout(300)
    check('quitar repetidas de la lista', page.evaluate("musicState.lists[0].items.length") == 3 and page.locator('.mus-dup-note').count() == 0)
    # Lista inteligente: sin repetidas
    sm = page.evaluate("resolveMusicSmart({ source: 'all', order: 'title', limit: 0 }).filter(t => sameSong(t, musicState.byId.get('dup2'))).length")
    check('listas inteligentes: una sola versión de cada canción', sm == 1, sm)
    # --- Editar nombre y etiquetas
    page.evaluate("""window.Android.editMusicFile = (req, id, json) => { window.__edit = [id, JSON.parse(json)]; setTimeout(() => window.onAndroidMusicEdited(req, { ok: true, tags: !!JSON.parse(json).tags, file: JSON.parse(json).file }), 80); }; 0""")
    t0 = page.evaluate("(() => { const t = musicState.tracks.find(t => /\\.mp3$/i.test(t.file)); playTrackNow(t); return { id: t.id, file: t.file, title: t.title }; })()")
    page.wait_for_timeout(500)
    page.evaluate("openTrackMenu(musicState.current)"); page.wait_for_timeout(200)
    page.locator('.pod-sheet button', has_text='Editar nombre y etiquetas').click(); page.wait_for_timeout(200)
    check('editor: nombre sin extensión y etiquetas rellenas', page.input_value('.mus-edit [name=file]') == t0['file'][:-4] and page.input_value('.mus-edit [name=title]') == t0['title'])
    page.screenshot(path=f'{SHOTS}/r-04-editar.png')
    page.fill('.mus-edit [name=file]', '07 - Queen - Bohemian: Rhapsody')
    page.locator('.mus-edit button', has_text='Etiquetas desde el nombre').click()
    check('etiquetas desde el nombre', page.input_value('.mus-edit [name=artist]') == 'Queen' and page.input_value('.mus-edit [name=title]') == 'Bohemian: Rhapsody' and page.input_value('.mus-edit [name=track]') == '7')
    page.locator('.mus-edit button', has_text='Nombre desde las etiquetas').click()
    check('nombre desde las etiquetas (sin caracteres prohibidos)', page.input_value('.mus-edit [name=file]') == '07 Queen - Bohemian Rhapsody', page.input_value('.mus-edit [name=file]'))
    page.fill('.mus-edit [name=year]', '1975'); page.fill('.mus-edit [name=genre]', 'Rock progresivo')
    page.locator('.mus-edit .pod-sheet-ok').click(); page.wait_for_timeout(900)
    ed = page.evaluate("window.__edit")
    check('envía a Android el id de MediaStore, nombre con extensión y solo lo cambiado', ed[0] == t0['id'][1:] and ed[1]['file'] == '07 Queen - Bohemian Rhapsody.mp3' and ed[1]['tags'].get('title') == 'Bohemian: Rhapsody' and ed[1]['tags'].get('genre') == 'Rock progresivo' and 'album' not in ed[1]['tags'] and 'year' not in ed[1]['tags'], ed)
    tt = page.evaluate("(() => { const t = musicState.byId.get(%s); return { title: t.title, artist: t.artist, file: t.file, year: t.year, track: t.track, src: t.src, cur: musicState.current.id === t.id, playing: !musicAudio().paused }; })()" % json.dumps(t0['id']))
    check('la biblioteca se actualiza', tt['title'] == 'Bohemian: Rhapsody' and tt['artist'] == 'Queen' and tt['file'] == '07 Queen - Bohemian Rhapsody.mp3' and tt['year'] == 1975 and tt['track'] == 7, tt)
    check('sigue sonando tras guardar (y sin caché)', tt['cur'] and tt['playing'] and '?v=' in tt['src'], tt)
    check('el artista nuevo aparece en el índice', page.evaluate("musicState.artists.has(mNorm('Queen')) && musicState.artists.get(mNorm('Queen')).tracks.some(t => t.id === %s)" % json.dumps(t0['id'])))
    # sin cambios: no llama a Android
    page.evaluate("window.__edit = null; editTrackFlow(musicState.byId.get(%s))" % json.dumps(t0['id'])); page.wait_for_timeout(200)
    page.locator('.mus-edit .pod-sheet-ok').click(); page.wait_for_timeout(300)
    check('sin cambios no toca el archivo', page.evaluate("window.__edit") is None)
    # cancelado por el usuario
    page.evaluate("""window.Android.editMusicFile = (req) => setTimeout(() => window.onAndroidMusicEdited(req, { ok: false, error: 'cancelled', tags: false }), 50); 0""")
    page.evaluate("editTrackFlow(musicState.byId.get(%s))" % json.dumps(t0['id'])); page.wait_for_timeout(200)
    page.fill('.mus-edit [name=title]', 'Otro título'); page.locator('.mus-edit .pod-sheet-ok').click(); page.wait_for_timeout(500)
    check('cancelado: no cambia la biblioteca', page.evaluate("musicState.byId.get(%s).title" % json.dumps(t0['id'])) == 'Bohemian: Rhapsody' and 'No se ha cambiado nada' in page.inner_text('body'))
    # no MP3: etiquetas desactivadas
    page.evaluate("(() => { const t = musicState.tracks[2]; t.file = 'cancion.flac'; editTrackFlow(t); })()"); page.wait_for_timeout(200)
    check('FLAC: etiquetas desactivadas, nombre sí', page.evaluate("document.querySelector('.mus-edit-tags').disabled") and not page.evaluate("document.querySelector('.mus-edit [name=file]').disabled"))
    page.evaluate("closePodSheet()")
    # --- Abrir desde otras apps
    lib = page.evaluate("(() => { const t = musicState.tracks[5]; return { id: t.id, file: t.file, size: t.size }; })()")
    page.evaluate("window.viferorOpenAudio({ name: 'x.mp3', mediaId: %s, token: 'tk0' }); 0" % lib['id'][1:]); page.wait_for_timeout(600)
    check('abrir: canción de la biblioteca por id de MediaStore', page.evaluate("musicState.current.id") == lib['id'] and page.locator('#musExpanded').is_visible())
    lib2 = page.evaluate("(() => { const t = musicState.tracks[8]; t.file = 'unica cancion.mp3'; t.size = 777; return { id: t.id, file: t.file, size: t.size }; })()")
    page.evaluate("window.viferorOpenAudio(%s); 0" % json.dumps({'name': lib2['file'], 'size': lib2['size'], 'token': 'tk1'})); page.wait_for_timeout(600)
    check('abrir: por nombre y tamaño', page.evaluate("musicState.current.id") == lib2['id'])
    amb = page.evaluate("(() => { const c = {}; musicState.tracks.forEach(t => c[t.file] = (c[t.file] || 0) + 1); return Object.keys(c).find(k => c[k] > 1); })()")
    page.evaluate("window.viferorOpenAudio(%s); 0" % json.dumps({'name': amb, 'token': 'amb1'})); page.wait_for_timeout(500)
    check('nombre repetido en la biblioteca: no adivina, suena el archivo abierto', page.evaluate("musicState.current.id") == 'xamb1')
    plays0 = page.evaluate("Object.keys(musicStats()).length")
    page.evaluate("window.viferorOpenAudio(%s); 0" % json.dumps({'name': 'audio WhatsApp.opus', 'size': 1234, 'token': 'abc123', 'title': 'Nota de voz', 'artist': 'Ana', 'dur': 12, 'art': True})); page.wait_for_timeout(900)
    cur = page.evaluate("({ id: musicState.current.id, title: musicState.current.title, src: musicAudio().src, art: document.getElementById('musExpArt').innerHTML, playing: !musicAudio().paused })")
    check('abrir: archivo de fuera de la biblioteca suena por /__music/ext/', cur['id'] == 'xabc123' and cur['title'] == 'Nota de voz' and '/__music/ext/abc123' in cur['src'] and cur['playing'], cur)
    check('…con su carátula', '/__music/extart/abc123' in cur['art'])
    page.evaluate("window.viferorOpenAudio(%s); 0" % json.dumps({'name': '05 - Los Planetas - Segundo premio.mp3', 'token': 'def456'})); page.wait_for_timeout(600)
    check('sin etiquetas: título y artista desde el nombre', page.evaluate("[musicState.current.title, musicState.current.artist]") == ['Segundo premio', 'Los Planetas'])
    page.evaluate("editTrackFlow(musicState.current)"); page.wait_for_timeout(200)
    check('un archivo de fuera no se puede editar', page.evaluate("document.querySelector('.mus-edit .pod-sheet-ok').disabled") and 'otra app' in page.inner_text('.mus-edit'))
    page.evaluate("closePodSheet()")
    # Lista M3U
    files = page.evaluate("musicState.tracks.slice(0,3).map(t => '/storage/emulated/0/' + t.folder + '/' + t.file)")
    m3u = '#EXTM3U\n#PLAYLIST:Lista de fuera\n' + '\n'.join(files) + '\nno/existe.mp3\n'
    nl = page.evaluate("musicState.lists.length")
    page.evaluate("window.viferorOpenAudio(%s); 0" % json.dumps({'name': 'fuera.m3u', 'playlist': True, 'text': m3u})); page.wait_for_timeout(600)
    check('abrir M3U: crea la lista y la abre', page.evaluate("musicState.lists.length") == nl + 1 and page.evaluate("musicState.lists.at(-1).name") == 'Lista de fuera' and page.evaluate("musicState.lists.at(-1).items.length") == 3 and page.evaluate("musicState.screen").startswith('list:'))
    page.evaluate("window.viferorOpenAudio({ error: 'sin permiso' }); 0"); page.wait_for_timeout(200)
    check('error al abrir: aviso', 'No se pudo abrir el archivo' in page.inner_text('body'))
    # Arranque en frío: la web lo recoge al iniciar
    page.add_init_script("""(() => { const o = sessionStorage.getItem('openOnce'); if (o && window.Android) window.Android.takeOpenedAudio = () => { sessionStorage.removeItem('openOnce'); return o; }; })();""")
    page.evaluate("sessionStorage.setItem('openOnce', JSON.stringify({ name: 'frio.mp3', token: 'cold1', title: 'En frío' }))")
    page.reload(); page.wait_for_timeout(2500)
    check('arranque en frío: lo recoge y suena', page.evaluate("musicState.current && musicState.current.title") == 'En frío' and page.evaluate("document.body.classList.contains('music-active')"))
    b.close()

print('\nErrores JS:', len(errors))
for e in errors[:15]: print('  ', e[:300])
fails = [r for r in results if not r[1]]
print(f'{len(results) - len(fails)}/{len(results)} OK')
srv.shutdown()
