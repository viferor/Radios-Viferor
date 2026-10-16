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
    if '/api/autoeq' in u:
        from urllib.parse import urlparse, parse_qs
        q = {k: v[0] for k, v in parse_qs(urlparse(u).query).items()}
        if q.get('q'): return r.fulfill(json={'items': [{'name': 'Sony WH-1000XM5', 'path': 'oratory1990/over-ear/Sony WH-1000XM5', 'source': 'oratory1990', 'rig': ''}]})
        return r.fulfill(json={'name': 'Sony WH-1000XM5', 'source': 'oratory1990', 'path': q.get('path'), 'preamp': -6.5, 'filters': [{'type': 'lowshelf', 'fc': 105, 'gain': -4.2, 'q': 0.7}, {'type': 'peaking', 'fc': 3000, 'gain': 5.1, 'q': 1.2}]})
    if '/api/lyrics-publish' in u:
        b = json.loads(r.request.post_data or '{}')
        if b.get('step') == 'challenge': return r.fulfill(json={'prefix': 'PFX9z', 'target': TARGET})
        state['publish'] = b
        return r.fulfill(json={'ok': True})
    if '/api/lyrics' in u: return lyrics_api(r, u)
    if '/api/translate' in u:
        body = json.loads(r.request.post_data or '{}')
        return r.fulfill(json={'lang': 'en', 'lines': [('ES: ' + l) if l.strip() else '' for l in body.get('lines', [])]})
    if '/api/song-meaning' in u:
        h = {k.lower(): v for k, v in r.request.headers.items()}
        state.setdefault('meaning_calls', []).append(h.get('x-ai-key'))
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
    # Los scripts se cargan en cadena: hay que esperar a que ecualizador.js esté listo, o la
    # primera comprobación puede caer antes de que exista musicFx (pasaba de vez en cuando).
    page.wait_for_function('!!window.musicFx')
    page.click('#btnViewMusic'); page.wait_for_function('musicState.loaded')
    page.evaluate("openMusicScreen('album:' + [...musicState.albums.values()].find(a=>a.name==='A Night at the Opera').key)"); page.wait_for_timeout(300)
    page.locator('#musicContent .mus-row').first.locator('.pod-qinfo').click(); page.wait_for_timeout(700)
    check('sin ajustes no se crea la cadena', not page.evaluate('musicFx.active'))
    page.click('#musMiniOpen'); page.wait_for_timeout(200)
    page.click('#musExpFx'); page.wait_for_selector('#fxPanel .fx-card')
    page.screenshot(path=f'{SHOTS}/x-01-panel.png')
    page.locator('.fx-chip', has_text='sin cancelación').click(); page.wait_for_timeout(300)
    check('elegir los Realme activa la corrección y la cadena', page.evaluate('musicFx.active') and page.evaluate('fxSettings().hpOn'))
    hp = page.evaluate("musicFx.nodes.hp.slice(0,11).map(f=>[f.type, Math.round(f.frequency.value), +f.gain.value.toFixed(2), +f.Q.value.toFixed(2)])")
    check('filtros = AutoEq Buds Air 7 Pro (ANC off)', hp[0] == ['lowshelf', 105, -1.1, 0.7] and hp[1] == ['peaking', 43, -4.8, 0.75] and hp[5] == ['highshelf', 10000, -8, 0.7] and hp[10][2] == 0, hp[:6])
    pre = page.evaluate('20*Math.log10(musicFx.nodes.pre.gain.value)')
    check('preamp -2,1 dB', abs(pre + 2.1) < 0.05, pre)
    page.wait_for_timeout(600)
    check('el audio sigue sonando a través de la cadena', page.evaluate("musicFx.ctx.state") == 'running' and not page.evaluate('musicAudio().paused'))
    # Ecualizador
    page.locator('#fxPanel input[data-k=eq]').check(); page.wait_for_timeout(200)
    page.locator('.fx-chip', has_text='Graves potentes').click(); page.wait_for_timeout(300)
    eq = page.evaluate("musicFx.nodes.eq.map(f=>+f.gain.value.toFixed(1))")
    check('preset Graves potentes', eq == [6, 5.5, 4, 2, 0, 0, 0, 0, 0, 0], eq)
    pre = page.evaluate('20*Math.log10(musicFx.nodes.pre.gain.value)')
    check('preamp automático: -2,1 (auriculares) - 6 (ecualizador)', abs(pre + 8.1) < 0.05, pre)
    page.evaluate("const r=document.querySelector('[data-band=\"9\"]'); r.value=4; r.dispatchEvent(new Event('input'))"); page.wait_for_timeout(200)
    check('mover una banda: Personalizado', page.evaluate('fxSettings().preset') == 'Personalizado' and page.evaluate('+musicFx.nodes.eq[9].gain.value') == 4)
    page.click('#fxSave'); page.fill('.pod-sheet-form input', 'Mi coche'); page.click('.pod-sheet-ok'); page.wait_for_timeout(300)
    check('preset propio guardado', page.locator('.fx-chip', has_text='★ Mi coche').count() == 1)
    lit = page.evaluate("(()=>{const c=document.getElementById('fxCurve');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i])n++;return n})()")
    check('curva dibujada', lit > 500, lit)
    page.screenshot(path=f'{SHOTS}/x-02-eq.png')
    # Mono, balance, nivelador
    page.locator('#fxPanel input[data-k=mono]').check(); page.wait_for_timeout(150)
    page.locator('#fxPanel input[data-k=level]').check(); page.wait_for_timeout(150)
    page.evaluate("const r=document.querySelector('[data-k=balance]'); r.value=-0.3; r.dispatchEvent(new Event('input'))")
    n = page.evaluate("[musicFx.nodes.input.channelCount, musicFx.nodes.input.channelCountMode, +musicFx.nodes.pan.pan.value.toFixed(2), musicFx.nodes.level.ratio.value]")
    check('mono, balance y nivelador', n == [1, 'explicit', -0.3, 3], n)
    # Buscar auriculares
    page.fill('#fxHpQ', 'xm5'); page.click('#fxHpGo'); page.wait_for_selector('.fx-hp-item')
    page.locator('.fx-hp-item').first.click(); page.wait_for_timeout(400)
    check('auriculares buscados cargados', page.evaluate("fxSettings().hp.name") == 'Sony WH-1000XM5' and abs(page.evaluate("+musicFx.nodes.hp[1].gain.value") - 5.1) < 0.001 and page.evaluate("musicFx.nodes.hp[2].gain.value") == 0)
    # Fundido entre canciones (4 s)
    page.select_option('#fxPanel select[data-k=crossfade]', '4'); page.wait_for_timeout(100)
    page.evaluate('closeFxPanel(); closeMusicExpanded()')
    cur0 = page.evaluate('musicState.current.id'); nx = page.evaluate('musicState.queue[0].id'); d0 = page.evaluate('musicState.deck')
    page.evaluate("musicAudio().currentTime = musicAudio().duration - 6"); page.wait_for_timeout(3200)
    check('fundido: cambia de platina y de canción', page.evaluate('musicState.deck') != d0 and page.evaluate('musicState.current.id') == nx, page.evaluate('[musicState.deck, musicState.current.id]'))
    both = page.evaluate("musDecks.map(d=>!d.paused)")
    check('durante el fundido suenan las dos', both == [True, True], both)
    page.wait_for_timeout(4500)
    check('al acabar el fundido la anterior se para', page.evaluate("musDecks[%d].paused" % d0) and page.evaluate("musicState.xf") is None)
    check('historial y cola al día', page.evaluate("musicState.history.at(-1).id") == cur0 and page.evaluate("musicState.queue[0] && musicState.queue[0].id") != nx)
    check('ganancias de las platinas restauradas', page.evaluate("musicFx.nodes.decks.map(g=>+g.gain.value.toFixed(2))") == [1, 1])
    # Sin pausas (sin fundido)
    page.evaluate("saveFx({crossfade:0, gapless:true})")
    d1 = page.evaluate('musicState.deck'); nx2 = page.evaluate('musicState.queue[0].id')
    page.evaluate("musicAudio().currentTime = musicAudio().duration - 4"); page.wait_for_timeout(1500)
    check('precarga la siguiente', page.evaluate("musicState.preload && musicState.preload.id") == nx2)
    page.wait_for_timeout(4000)
    check('sin pausas: pasa a la otra platina ya cargada', page.evaluate('musicState.deck') != d1 and page.evaluate('musicState.current.id') == nx2 and not page.evaluate('musicAudio().paused'))
    # Fundido al pausar
    page.evaluate('toggleMusicPlay()'); page.wait_for_timeout(100)
    check('fundido al pausar: aún suena 0,1 s después', not page.evaluate('musicAudio().paused'))
    page.wait_for_timeout(400)
    check('… y luego se pausa', page.evaluate('musicAudio().paused'))
    page.evaluate('toggleMusicPlay()'); page.wait_for_timeout(600)
    check('reanuda con el nivel normal', not page.evaluate('musicAudio().paused') and page.evaluate("+musicFx.nodes.decks[musicState.deck].gain.value.toFixed(2)") == 1)
    # Lyrics siguen la canción tras cambiar de platina
    page.evaluate('openLyrics()'); page.wait_for_timeout(400)
    check('la letra usa la platina que suena', page.inner_text('#lyrTitle') == page.evaluate('musicState.current.title'))
    page.evaluate('closeLyricsPanel()')
    # Recarga
    page.reload(); page.wait_for_timeout(600)
    check('recarga: ajustes guardados, cadena aún sin crear', page.evaluate("fxSettings().eq && fxSettings().hp.name === 'Sony WH-1000XM5'") and not page.evaluate('musicFx.active'))
    page.mouse.click(5, 300); page.wait_for_timeout(300)
    check('al primer toque se aplica', page.evaluate('musicFx.active') and page.evaluate("+musicFx.nodes.eq[0].gain.value") == 6)
    page.evaluate("document.documentElement.classList.add('dark-mode')")
    page.click('#btnViewMusic'); page.wait_for_function('musicState.loaded'); page.evaluate('openFxPanel()'); page.wait_for_timeout(400)
    page.screenshot(path=f'{SHOTS}/x-03-oscuro.png')
    ov = page.evaluate("(()=>{const b=document.querySelector('.fx-body');return b.scrollWidth-b.clientWidth})()")
    check('sin desborde horizontal', ov <= 1, ov)
    # --- Según por dónde suena
    page.evaluate("closeFxPanel()")
    st0 = page.evaluate("fxSettings()")
    page.evaluate("onAudioOutput({type:'speaker', name:''}, {initial:true}); 0")
    st = page.evaluate("fxSettings()")
    check('salida: al arrancar en el altavoz guarda lo actual sin la corrección', st['autoOutput'] and 'speaker' in st['profiles'] and not st['hpOn'] and st['eq'] == st0['eq'], st['profiles'].keys())
    page.evaluate("window.onAndroidAudioOutput({type:'bluetooth', name:'realme Buds Air7 Pro'}); 0"); page.wait_for_timeout(200)
    st = page.evaluate("fxSettings()")
    check('Bluetooth nuevo conocido: activa su corrección', st['hpOn'] and 'realme' in st['hp']['name'] and not st['eq'], st['hp'])
    check('aviso al cambiar de salida', 'realme Buds Air7 Pro' in page.inner_text('body'))
    page.evaluate("saveFx({ eq: true, preset: 'Rock', bands: EQ_PRESETS.find(p=>p[0]==='Rock')[1].slice() }); 0")
    page.evaluate("window.onAndroidAudioOutput({type:'speaker', name:''}); 0"); page.wait_for_timeout(200)
    st = page.evaluate("fxSettings()")
    check('vuelta al altavoz: sus ajustes', not st['hpOn'] and st['eq'] == st0['eq'] and st['preset'] == st0['preset'], (st['hpOn'], st['preset']))
    page.evaluate("window.onAndroidAudioOutput({type:'bluetooth', name:'realme Buds Air7 Pro'}); 0"); page.wait_for_timeout(200)
    st = page.evaluate("fxSettings()")
    check('vuelta a los auriculares: corrección + Rock', st['hpOn'] and st['eq'] and st['preset'] == 'Rock')
    if page.evaluate('musicFx.active'):
        check('se aplica en la cadena', page.evaluate("+musicFx.nodes.eq[0].gain.value") == 4 and page.evaluate("musicFx.nodes.hp[0].type") == 'lowshelf')
    page.evaluate("window.onAndroidAudioOutput({type:'bluetooth', name:'JBL Flip 6'}); 0"); page.wait_for_timeout(200)
    st = page.evaluate("fxSettings()")
    check('Bluetooth desconocido: plano y sugiere buscar corrección', not st['hpOn'] and not st['eq'] and 'busca su corrección' in page.inner_text('body'))
    page.evaluate('openFxPanel()'); page.wait_for_timeout(300)
    check('panel: tarjeta de salida con la actual y las guardadas', 'Ahora: JBL Flip 6' in page.inner_text('#fxPanel') and page.locator('.fx-out-item').count() == 3)
    page.screenshot(path=f'{SHOTS}/x-04-salidas.png')
    page.locator('.fx-out-item', has_text='Altavoz').locator('button').click(); page.wait_for_timeout(200)
    check('olvidar una salida', page.locator('.fx-out-item').count() == 2)
    page.locator('input[data-k=autoOutput]').uncheck(); page.wait_for_timeout(200)
    page.evaluate("window.onAndroidAudioOutput({type:'bluetooth', name:'realme Buds Air7 Pro'}); 0"); page.wait_for_timeout(200)
    check('desactivado: no cambia nada al cambiar de salida', not page.evaluate("fxSettings().hpOn"))
    b.close()

print('\nErrores JS:', len(errors))
for e in errors[:15]: print('  ', e[:300])
fails = [r for r in results if not r[1]]
print(f'{len(results) - len(fails)}/{len(results)} OK')
srv.shutdown()
