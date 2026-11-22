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

def route(r):
    u = r.request.url
    if not u.startswith(BASE): return r.abort()
    if '/__music/library.json' in u:
        if MODE != 'granted' and not state.get('granted'): return r.fulfill(status=403, json={'ok': False, 'error': 'permission'})
        return r.fulfill(json={'ok': True, 'api': 1, 'count': len(LIB), 'tracks': LIB})
    if '/__music/track/' in u: return r.fulfill(body=TONE, headers={'content-type': 'audio/wav'})
    m = re.search(r'/__music/art/(\d+)', u)
    if m:
        i = int(m.group(1)) - 1
        if i == 3: return r.fulfill(status=404, body='')
        return r.fulfill(body=ARTS[i % 5], headers={'content-type': 'image/png'})
    if '/m/' in u:
        return r.fulfill(body=open(os.path.join(HERE, u.rsplit('/', 1)[1]), 'rb').read(), headers={'content-type': 'audio/mpeg'})
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
    check('pestaña Favoritos la primera', page.locator('#musTabs button').first.inner_text().strip() == '⭐ Favoritos')
    page.click('#musTabs [data-tab=favs]'); page.wait_for_timeout(200)
    check('favoritos vacío explica cómo marcar', 'Marca con' in page.inner_text('#musicContent'))
    # Canción favorita desde el menú
    page.click('#musTabs [data-tab=songs]'); page.wait_for_timeout(200)
    page.locator('#musicContent .mus-row').first.locator('.pod-qmenu').click()
    page.locator('.pod-sheet-item', has_text='Añadir a favoritos').click(); page.wait_for_timeout(300)
    check('estrella en la fila', page.locator('#musicContent .mus-row').first.locator('.mus-favmark').count() == 1)
    # Álbum favorito con el botón ☆ de la cabecera
    page.evaluate("openMusicScreen('album:' + [...musicState.albums.values()].find(a=>a.name==='El mal querer').key)"); page.wait_for_timeout(300)
    page.click('.mus-head-fav'); page.wait_for_timeout(200)
    check('☆ del álbum pasa a ★', page.inner_text('.mus-head-fav') == '★')
    page.evaluate('history.back()'); page.wait_for_timeout(200)
    # Artista favorito desde su menú en la lista
    page.click('#musTabs [data-tab=artists]'); page.wait_for_timeout(200)
    page.locator('.mus-list-row', has_text='Queen').locator('.pod-list-more').click()
    page.locator('.pod-sheet-item', has_text='Añadir a favoritos').click(); page.wait_for_timeout(200)
    # Género y carpeta
    page.click('#musTabs [data-tab=genres]'); page.wait_for_timeout(200)
    page.locator('.mus-list-row', has_text='Flamenco').locator('.pod-list-more').click()
    page.locator('.pod-sheet-item', has_text='Añadir a favoritos').click(); page.wait_for_timeout(200)
    page.click('#musTabs [data-tab=albums]'); page.wait_for_timeout(200)
    check('estrella en la portada del álbum', page.locator('.mus-album', has_text='El mal querer').locator('.mus-tile-fav').count() == 1)
    page.click('#musTabs [data-tab=favs]'); page.wait_for_timeout(300)
    t = page.inner_text('#musicContent')
    check('pestaña Favoritos con todo', 'Canciones' in t and 'Álbumes' in t and 'Artistas' in t and 'Géneros' in t)
    pool = page.evaluate('favPool().length')
    check('todo junto sin repetir (canción de Queen + 7 + 14 = 21)', pool == 21, pool)
    page.screenshot(path=f'{SHOTS}/f-01-favoritos.png')
    page.locator('.pod-list-actions button', has_text='Aleatorio').click(); page.wait_for_timeout(400)
    check('aleatorio de favoritos', page.evaluate('musicState.queue.length') == 20)
    page.evaluate("openMusicSmartEditor(null,{name:'Favs',rules:{source:'favs',order:'random',limit:0}})")
    check('lista inteligente: sin selector para favoritos', page.locator('.if-pick').is_hidden())
    page.click('.pod-smart-form .pod-sheet-ok'); page.wait_for_timeout(300)
    check('lista inteligente «Mis favoritos»', page.evaluate('musicListTracks(musicState.lists.at(-1)).length') == 21)
    # Reproductor: favorita
    page.click('#musMiniOpen'); page.wait_for_timeout(200)
    before = page.evaluate("isMusicFav('tracks', musicState.current.id)")
    page.click('#musExpFav'); page.wait_for_timeout(200)
    check('☆ del reproductor', page.evaluate("isMusicFav('tracks', musicState.current.id)") != before and ('★' in page.inner_text('#musExpFav')) != before)
    page.click('#musExpClose')
    # Una lista con una canción de Download (para comprobar que sigue tras excluir)
    dl = page.evaluate("musicState.tracks.find(t=>t.folder==='Download').id")
    page.evaluate(f"createMusicList('Con Download', [musicState.byId.get('{dl}')])")
    # Excluir Download desde el menú de la carpeta
    page.click('#musTabs [data-tab=folders]'); page.wait_for_timeout(200)
    check('barra de filtro sin filtros', 'todas las carpetas' in page.inner_text('.mus-ffbar'))
    page.locator('.mus-list-row', has_text='Download').locator('.pod-list-more').click()
    page.locator('.pod-sheet-item', has_text='Excluir esta carpeta').click(); page.wait_for_timeout(300)
    check('excluir: 36 canciones', page.evaluate('musicState.tracks.length') == 36)
    check('excluir: desaparece el álbum y el artista desconocido', page.evaluate('musicState.albums.size') == 4 and page.evaluate("[...musicState.artists.values()].every(a=>a.name!=='Artista desconocido')"))
    check('barra avisa del filtro', '1 carpeta excluida' in page.inner_text('.mus-ffbar') and '4 canciones ocultas' in page.inner_text('.mus-ffbar'))
    page.fill('#musSearch', 'Grabaciones'); page.wait_for_timeout(400)
    check('la búsqueda tampoco la encuentra', 'No hay nada' in page.inner_text('#musicContent'))
    page.fill('#musSearch', ''); page.wait_for_timeout(400)
    lid = page.evaluate("musicState.lists.find(l=>l.name==='Con Download').id")
    check('una lista tuya la sigue teniendo', page.evaluate(f"musicListTracks(musicListById('{lid}')).length") == 1)
    # Gestor
    page.click('.mus-ffbar button'); page.wait_for_selector('.mus-fm-row')
    check('el gestor muestra la excluida', page.locator('.mus-fm-row.exc', has_text='Download').count() == 1)
    page.screenshot(path=f'{SHOTS}/f-02-gestor.png')
    page.locator('.mus-fm-row', has_text='Music').first.locator('.mus-fm-tg').click(); page.wait_for_timeout(200)
    page.locator('.mus-fm-row', has_text='Rock').locator('.mus-fm-inc').click(); page.wait_for_timeout(300)
    check('incluir solo Rock: 14', page.evaluate('musicState.tracks.length') == 14)
    page.locator('.mus-fm-row', has_text='Rock').locator('.mus-fm-tg').click(); page.wait_for_timeout(200)
    page.locator('.mus-fm-row', has_text='Queen').locator('.mus-fm-tg').click(); page.wait_for_timeout(200)
    page.locator('.mus-fm-row', has_text='News of the World').locator('.mus-fm-exc').click(); page.wait_for_timeout(300)
    check('incluir Rock y excluir un disco: 8', page.evaluate('musicState.tracks.length') == 8)
    page.screenshot(path=f'{SHOTS}/f-03-gestor-reglas.png')
    # Recarga: se mantiene
    page.reload(); page.wait_for_timeout(600)
    page.click('#btnViewMusic'); page.wait_for_function('musicState.loaded')
    check('recarga: el filtro se mantiene', page.evaluate('musicState.tracks.length') == 8)
    # Ocultarlo todo
    page.evaluate("setFolderRule('Music','exclude',true,{toast:false}); setFolderRule('Download','exclude',true,{toast:false})")
    page.evaluate("setMusicTab('songs')"); page.wait_for_timeout(300)
    check('si no queda nada, lo dice', 'Todo está oculto' in page.inner_text('#musicContent'))
    page.screenshot(path=f'{SHOTS}/f-04-oculto.png')
    page.locator('#musicContent button', has_text='Mostrar todo').click(); page.wait_for_timeout(300)
    check('«Mostrar todo» quita los filtros', page.evaluate('musicState.tracks.length') == 40)
    page.evaluate("document.documentElement.classList.add('dark-mode'); openMusicScreen('fmanage')"); page.wait_for_timeout(300)
    page.screenshot(path=f'{SHOTS}/f-05-gestor-oscuro.png')
    ov = page.evaluate("document.getElementById('musicContent').scrollWidth - document.getElementById('musicContent').clientWidth")
    check('sin desborde horizontal', ov <= 1, ov)
    b.close()

print('\nErrores JS:', len(errors))
for e in errors[:15]: print('  ', e[:300])
fails = [r for r in results if not r[1]]
print(f'{len(results) - len(fails)}/{len(results)} OK')
srv.shutdown()
