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
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
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
    page.click('#musExpLyrics'); page.wait_for_selector('#lyrBody .lyr-line')
    check('letra sincronizada de LRCLIB', page.locator('#lyrBody .lyr-lines.synced .lyr-line').count() == 13)
    q0 = state['lyr_calls'][0]
    check('busca con artista, título, álbum y duración', q0.get('artist') == 'Queen' and q0.get('album') == 'A Night at the Opera' and q0.get('duration') == '240', q0)
    page.evaluate("document.getElementById('musicAudio').currentTime = 8.2"); page.wait_for_timeout(400)
    now = page.evaluate("[...document.querySelectorAll('#lyrBody .lyr-line')].findIndex(x=>x.classList.contains('now'))")
    check('línea actual según el tiempo (8,2 s → línea 3)', now == 2, now)
    page.screenshot(path=f'{SHOTS}/l-01-sincronizada.png')
    page.locator('#lyrBody .lyr-line').nth(5).click(); page.wait_for_timeout(300)
    check('tocar una línea salta a su tiempo', abs(page.evaluate("document.getElementById('musicAudio').currentTime") - 16.0) < 0.5, page.evaluate("document.getElementById('musicAudio').currentTime"))
    # Traducción
    page.click('.lyr-modes [data-mode=trans]'); page.wait_for_selector('#lyrBody .lyr-line .tr')
    check('original + español', page.locator('#lyrBody .lyr-line .tr').first.inner_text() == 'ES: Line number 1')
    check('dice el idioma de origen', 'inglés' in page.inner_text('.lyr-trans-top'))
    # Significado: sin clave → formulario; con clave → texto
    check('tres pestañas', page.locator('.lyr-modes button').count() == 3)
    page.click('.lyr-modes [data-mode=meaning]'); page.wait_for_selector('.lyr-ai-setup')
    check('la pestaña Significado no muestra la letra', page.locator('#lyrBody .lyr-line').count() == 0)
    check('sin clave: explica cómo conseguirla', 'aistudio.google.com' in page.inner_text('.lyr-ai-setup'))
    page.screenshot(path=f'{SHOTS}/l-02-sin-clave.png')
    page.fill('.lyr-ai-setup [data-k=key]', 'AIzaSyTEST-1234567890abcdef'); page.click('.lyr-ai-setup .pod-sheet-ok')
    page.wait_for_selector('.lyr-md h4')
    check('con clave: la envía y muestra el significado', state['meaning_calls'][-1] == 'AIzaSyTEST-1234567890abcdef' and page.locator('.lyr-md h4').count() == 2 and page.locator('.lyr-md li').count() == 2 and page.locator('.lyr-md strong').count() == 1)
    page.screenshot(path=f'{SHOTS}/l-03-significado.png')
    n_calls = len(state['meaning_calls'])
    page.screenshot(path=f'{SHOTS}/l-05-pestanas.png')
    page.click('.lyr-modes [data-mode=trans]'); page.wait_for_timeout(200)
    check('original + español ya no lleva el botón de significado', page.locator('.lyr-meaning-btn').count() == 0 and page.locator('.lyr-md').count() == 0)
    # Siguiente canción: la letra la sigue
    page.evaluate("nextTrack(false)"); page.wait_for_timeout(700)
    check('la letra sigue a la canción siguiente', page.inner_text('#lyrTitle') == 'A Night at 02')
    check('letra sin tiempos', page.locator('#lyrBody .lyr-lines.synced').count() == 0 and page.locator('#lyrBody .lyr-line:not(.gap)').count() == 4)
    # Sincronizar
    page.click('.lyr-modes [data-mode=orig]'); page.wait_for_timeout(200)
    page.locator('.lyr-foot button', has_text='Sincronizar').first.click(); page.wait_for_timeout(300)
    check('modo sincronizar con 4 líneas', page.locator('.lyr-sync-list .lyr-line').count() == 4)
    page.screenshot(path=f'{SHOTS}/l-04-sincronizar.png')
    for tsec in (2.0, 5.0, 9.0):
        page.evaluate(f"document.getElementById('musicAudio').currentTime = {tsec}"); page.wait_for_timeout(150)
        page.click('.lyr-sync-ctrl .mark'); page.wait_for_timeout(150)
    page.locator('.lyr-sync-ctrl button', has_text='Deshacer').click(); page.wait_for_timeout(150)
    check('deshacer vuelve atrás', page.evaluate('lyr.sync.idx') == 2 and page.evaluate("document.getElementById('musicAudio').currentTime") < 5)
    for tsec in (10.0, 14.0):
        page.evaluate(f"document.getElementById('musicAudio').currentTime = {tsec}"); page.wait_for_timeout(150)
        page.click('.lyr-sync-ctrl .mark'); page.wait_for_timeout(150)
    page.locator('.lyr-foot button', has_text='Guardar').click(); page.wait_for_timeout(500)
    saved = page.evaluate("lyrUserGet(musicState.current)")
    import re as _re
    ts = [float(m[0])*60+float(m[1]) for m in _re.findall(r'\[(\d+):(\d+\.\d+)\]Plain', saved['text'])] if saved else []
    check('se guarda como LRC (marca − 0,2 s de reacción)', saved and saved['source'] == 'sync' and len(ts) == 4 and all(abs(a-b) < 0.2 for a, b in zip(ts, [1.8, 4.8, 9.8, 13.8])), ts)
    check('y se ve sincronizada', page.locator('#lyrBody .lyr-lines.synced').count() == 1 and 'Sincronizada por ti' in page.inner_text('.lyr-src'))
    # Desfase
    page.locator('.lyr-foot button', has_text='⇆ Desfase').click()
    page.locator('.pod-sheet-item', has_text='adelantar 0,5').click(); page.wait_for_timeout(100)
    page.evaluate('closePodSheet()')
    check('desfase guardado', page.evaluate("lyrUserGet(musicState.current).offset") == 0.5 and '+0,5 s' in page.inner_text('.lyr-src'))
    # No encontrada → buscar otra versión
    page.evaluate("nextTrack(false)"); page.wait_for_timeout(700)
    check('no encontrada: ofrece buscar o pegar', 'No se ha encontrado' in page.inner_text('#lyrBody'))
    page.locator('#lyrBody button', has_text='Buscar otra versión').click()
    page.wait_for_selector('.pod-sheet-item'); page.wait_for_timeout(200)
    check('lista de versiones, sincronizadas primero', '⏱' in page.locator('.pod-sheet-item').first.inner_text())
    page.locator('.pod-sheet-item').first.click(); page.wait_for_timeout(600)
    check('versión elegida guardada', page.evaluate("lyrUserGet(musicState.current).lrclibId") == 77 and page.locator('#lyrBody .lyr-line').count() == 2)
    # Editar / pegar
    page.click('.lyr-more'); page.locator('.pod-sheet-item', has_text='Editar la letra').click()
    page.fill('.lyr-textarea', 'Mi letra pegada\nSegunda'); page.click('.pod-sheet-form .pod-sheet-ok'); page.wait_for_timeout(500)
    check('letra editada', page.locator('#lyrBody .lyr-line').first.inner_text() == 'Mi letra pegada' and 'Tu versión' in page.inner_text('.lyr-src'))
    page.click('.lyr-more'); page.locator('.pod-sheet-item', has_text='Borrar mi versión').click(); page.wait_for_timeout(500)
    check('borrar mi versión vuelve a LRCLIB', 'No se ha encontrado' in page.inner_text('#lyrBody'))
    # Exportar .lrc de la sincronizada
    page.evaluate("openTrackLyrics(musicState.byId.get('a102'))"); page.wait_for_timeout(500)
    page.click('.lyr-more'); page.locator('.pod-sheet-item', has_text='Exportar .lrc').click()
    sv = [c for c in page.evaluate('__calls') if c[0] == 'saveTextFile']
    check('exporta .lrc', sv and sv[-1][1].endswith('.lrc') and '[offset:500]' in sv[-1][2], sv[-1][1:3] if sv else None)
    check('caché: el significado no se vuelve a pedir', len(state['meaning_calls']) == n_calls)
    # Buscar en internet
    page.evaluate("window.__opened=[]; window.open=(u)=>{window.__opened.push(u); return null;}")
    page.click('.lyr-more'); page.locator('.pod-sheet-item', has_text='Buscar la letra en internet').click()
    op = page.evaluate('__opened')
    check('buscar en internet abre Google con artista y título', op and op[-1].startswith('https://www.google.com/search?q=') and 'Queen' in op[-1] and 'letra' in op[-1], op)
    # SHA-256 del Worker == hashlib
    import hashlib
    hx = page.evaluate('''() => new Promise(r => { const w = new Worker(URL.createObjectURL(new Blob([LYR_POW_WORKER]))); w.onmessage = e => r(e.data.hex); w.postMessage({test: 'abc'.repeat(30) + 'ñ'}); })''')
    check('SHA-256 del dispositivo correcto', hx == hashlib.sha256(('abc'*30+'ñ').encode()).hexdigest())
    # Compartir en LRCLIB (la canción 01 tiene letra sincronizada tuya + desfase 0)
    page.evaluate("openTrackLyrics(musicState.byId.get('a102'))"); page.wait_for_timeout(500)
    print('DIRECT:', page.evaluate('''() => new Promise(r => { const url = URL.createObjectURL(new Blob([LYR_POW_WORKER], {type:'text/javascript'})); const w = new Worker(url); w.onerror = e => r('ERR ' + e.message + ' L' + e.lineno); w.onmessage = e => { if (e.data.nonce) r(e.data); }; w.postMessage({prefix:'PFX9z', target:'003f'+'f'.repeat(60), start:1, step:3}); })'''))
    page.locator('.lyr-foot button', has_text='Compartir').click()
    page.locator('.pod-sheet-item', has_text='Publicar').click()
    for _ in range(40):
        page.wait_for_timeout(1500)
        if page.evaluate("!!(lyrUserGet(musicState.byId.get('a102'))||{}).published"): break
    print('TOAST:', page.inner_text('#podToast'), '| src:', page.evaluate("lyr.data && lyr.data.source"), '| track:', page.evaluate("lyr.track.title"))
    pub = state['publish']
    pref, nonce = pub['token'].split(':')
    hv = hashlib.sha256((pref + nonce).encode()).digest()
    check('el número cumple el reto (SHA-256 < objetivo)', hv < bytes.fromhex(TARGET), pub['token'])
    check('publica título, artista, álbum y duración', pub['trackName'] == 'A Night at 02' and pub['artistName'] == 'Queen' and pub['albumName'] == 'A Night at the Opera' and pub['duration'] == 95, pub)
    check('LRC con el desfase aplicado (+0,5 s → 0,5 s antes)', pub['syncedLyrics'].startswith('[00:01.') and 'Plain one' in pub['syncedLyrics'] and pub['plainLyrics'].startswith('Plain one'), pub['syncedLyrics'][:40])
    # Atrás cierra la letra
    check('Atrás cierra la letra', page.evaluate('handleAndroidBack()') and page.locator('#lyrPanel').is_hidden())
    # Letra incrustada (Android: etiqueta ID3 del principio)
    emb = page.evaluate("""async () => lyrEmbedded({ id:'a999', src:'/__music/track/999', title:'Con letra' })""")
    check('letra incrustada (USLT) en el móvil', emb.startswith('Primera línea incrustada'), emb)
    emb2 = page.evaluate("""async () => { const f = new File([await (await fetch('/m/withlyrics.mp3')).blob()], 'x.mp3'); musicState.files.set('f:test', f); return lyrEmbedded({id:'f:test', title:'x'}); }""")
    check('letra incrustada en el navegador', emb2.startswith('Primera línea incrustada'))
    side = page.evaluate("""async () => { musicState.lrcFiles = new Map([[mNorm('Disco/01 tema'), new File(['[00:01.00]Desde lrc'], '01 tema.lrc')]]); return lyrSidecar({ id:'f:MiMusica/Disco/01 tema.mp3' }); }""")
    check('.lrc al lado de la canción', side.startswith('[00:01.00]Desde lrc'), side)
    p = page.evaluate("JSON.stringify(parseLyrics('[ar:X]\\n[offset:-200]\\n[00:01.00][00:20.00]Coro <00:01.50>palabra\\n[00:05.5]Verso'))")
    check('LRC: varias marcas, desfase y marcas por palabra', p == json.dumps({"synced": True, "lines": [{"t": 1, "text": "Coro palabra"}, {"t": 5.5, "text": "Verso"}, {"t": 20, "text": "Coro palabra"}], "offset": -0.2}, separators=(',', ':')), p)
    # Modo oscuro de la página no afecta (el panel siempre es oscuro); ancho
    page.evaluate("openLyrics(musicState.current)"); page.wait_for_timeout(300)
    ov = page.evaluate("document.getElementById('lyrBody').scrollWidth - document.getElementById('lyrBody').clientWidth")
    check('sin desborde horizontal', ov <= 1, ov)
    # Servidor caído → LRCLIB directo desde el navegador
    state['api_down'] = True
    d = page.evaluate("lyricsQuery({artist:'Grupo', title:'Tema Raro (Remastered 2011)', album:'Disco', duration:201})")
    check('servidor caído: letra directa de LRCLIB', d.get('found') and d.get('id') == 90 and d.get('synced', '').startswith('[00:01.00]Directa'), d)
    d = page.evaluate("lyricsQuery({search:true, artist:'Grupo', title:'Tema Raro'})")
    check('servidor caído: versiones directas', len(d.get('items', [])) == 2, d)
    d = page.evaluate("lyricsQuery({id:'91'})")
    check('servidor caído: versión por id directa', d.get('synced', '').startswith('[00:01.00]Directa id'), d)
    state['direct_fail'] = True
    msg = page.evaluate("lyricsQuery({artist:'A', title:'B'}).then(()=>'ok', e=>e.message)")
    check('ambos caídos: error claro', 'LRCLIB' in msg, msg)
    # Significado sin letra (letra no encontrada y con LRCLIB caído)
    for label in ['sin letra', 'LRCLIB caído']:
        page.evaluate("closeLyricsPanel()")
        n0 = len(state['meaning_calls'])
        page.evaluate("lsSet(LYR_UI_KEY, { ...lyrUi(), mode: 'meaning' }); openLyrics({ id: 'nolyr-' + Date.now(), title: 'Canción Sin Letra ' + LBL, artist: 'Alguien', album: 'X', dur: 200 })".replace('LBL', repr(label)))
        for _ in range(100):
            if len(state['meaning_calls']) > n0 and page.locator('.lyr-md').count(): break
            page.wait_for_timeout(200)
        page.wait_for_timeout(300)
        mb = state.get('meaning_body', {})
        check(f'significado {label}: se pide con título/artista y se muestra', len(state['meaning_calls']) == n0 + 1 and mb.get('title') == 'Canción Sin Letra ' + label and not mb.get('lyrics') and page.locator('#lyrBody .lyr-ai-note').count() >= 2, [len(state['meaning_calls']) - n0, page.locator('#lyrBody .lyr-ai-note').all_inner_texts()])
        state['api_down'] = True; state['direct_fail'] = True
    page.evaluate("setLyricsMode('orig')"); page.wait_for_timeout(200)
    check('desde el error de letra hay botón de significado', page.locator('#lyrBody button', has_text='Ver el significado').count() == 1)
    state['api_down'] = False; state['direct_fail'] = False
    b.close()

print('peticiones con Range:', state.get('ranges'))
print('\nErrores JS:', len(errors))
for e in errors[:15]: print('  ', e[:300])
fails = [r for r in results if not r[1]]
print(f'{len(results) - len(fails)}/{len(results)} OK')
srv.shutdown()
