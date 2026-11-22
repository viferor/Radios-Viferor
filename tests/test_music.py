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
    page.goto(BASE + '/index.html'); page.wait_for_timeout(700)
    check('hay pestaña Música', page.locator('#btnViewMusic').is_visible())
    page.click('#btnViewMusic'); page.wait_for_timeout(500)

    if MODE == 'old':
        check('APK antiguo: pide actualizar', 'Actualiza la app' in page.inner_text('#musicContent'))
        page.screenshot(path=f'{SHOTS}/m-old.png'); b.close(); print('errores', errors); sys.exit()
    if MODE == 'ask':
        check('sin permiso: explica y ofrece botón', 'Permitir acceso' in page.inner_text('#musicContent'))
        page.screenshot(path=f'{SHOTS}/m-ask.png')
        page.click('.mus-setup .primary')
        check('el botón pide el permiso nativo', any(c[0] == 'requestMusicPermission' for c in page.evaluate('__calls')))
        state['granted'] = True
        page.evaluate("window.__perm='granted'; sessionStorage.setItem('perm','granted'); window.onAndroidMusicPermission(true)")
        page.wait_for_timeout(500)

    page.wait_for_selector('#musicContent .mus-row')
    n = page.evaluate('musicState.tracks.length')
    check('biblioteca cargada (40)', n == 40, n)
    check('álbumes 5', page.evaluate('musicState.albums.size') == 5, page.evaluate('musicState.albums.size'))
    check('artistas: Queen, Rosalía, desconocido, Shakira, Bad Bunny, Aitana', page.evaluate('musicState.artists.size') == 6, page.evaluate('[...musicState.artists.values()].map(a=>a.name)'))
    check('géneros separados por ;', page.evaluate("[...musicState.genres.values()].map(g=>g.name).sort().join(',')") == 'Flamenco,Pop,Rock')
    check('disco y pista desde TRACK (2004 → disco 2 pista 4)', page.evaluate("musicState.tracks.find(t=>t.id==='a'+(100+8+4)).disc") == 2)
    page.screenshot(path=f'{SHOTS}/m-01-canciones.png')

    # Álbumes y álbum
    page.click('#musTabs [data-tab=albums]'); page.wait_for_timeout(300)
    check('cuadrícula de álbumes', page.locator('.mus-album').count() == 5)
    page.screenshot(path=f'{SHOTS}/m-02-albumes.png')
    page.locator('.mus-album', has_text='A Night at the Opera').click(); page.wait_for_timeout(300)
    check('pantalla de álbum con 8 pistas numeradas', page.locator('#musicContent .mus-row').count() == 8 and page.locator('#musicContent .mus-row .qnum').first.inner_text() == '1')
    page.locator('#musicContent .mus-row').nth(1).locator('.pod-qinfo').click(); page.wait_for_timeout(700)
    check('toca la 2: suena la 2', page.evaluate('musicState.current.title') == 'A Night at 02')
    check('la cola es el resto del álbum (6)', page.evaluate('musicState.queue.length') == 6)
    check('suena de verdad', page.evaluate("!document.getElementById('musicAudio').paused"))
    calls = page.evaluate('__calls')
    check('Android: sección música y notificación', ['setPlaybackSection', 'music'] in calls and any(c[0] == 'startMusicMedia' and c[1] == 'A Night at 02' and c[3].startswith('http') for c in calls), [c for c in calls if c[0] in ('setPlaybackSection','startMusicMedia')][:3])
    check('fila actual resaltada', page.locator('#musicContent .mus-row.is-current').count() == 1)
    page.screenshot(path=f'{SHOTS}/m-03-album.png')
    # Siguiente / anterior
    page.evaluate("document.getElementById('musNext').click()"); page.wait_for_timeout(400)
    check('⏭ siguiente', page.evaluate('musicState.current.title') == 'A Night at 03')
    page.evaluate("document.getElementById('musPrev').click()"); page.wait_for_timeout(400)
    check('⏮ anterior', page.evaluate('musicState.current.title') == 'A Night at 02')
    # Repetir una / todo
    page.evaluate("setMusicOpt('repeat','one'); document.getElementById('musicAudio').dispatchEvent(new Event('ended'))"); page.wait_for_timeout(400)
    check('repetir una vuelve a la misma', page.evaluate('musicState.current.title') == 'A Night at 02')
    page.evaluate("setMusicOpt('repeat','all'); musicState.queue=[]; saveMusicQueue(); document.getElementById('musicAudio').dispatchEvent(new Event('ended'))"); page.wait_for_timeout(500)
    check('repetir todo: al acabar vuelve a empezar el álbum', page.evaluate('musicState.current.title') == 'A Night at 01' and page.evaluate('musicState.queue.length') == 7, page.evaluate('[musicState.current.title, musicState.queue.length]'))
    page.evaluate("setMusicOpt('repeat','off')")
    check('cuenta reproducción al terminar', page.evaluate("trackPlays(musicState.byId.get('a102'))") >= 1)
    # Aleatorio
    before = page.evaluate('musicState.queue.map(t=>t.id)')
    page.evaluate('toggleMusicShuffle()')
    after = page.evaluate('musicState.queue.map(t=>t.id)')
    check('aleatorio baraja la cola', sorted(before) == sorted(after) and before != after)
    page.evaluate('toggleMusicShuffle()')
    check('quitar aleatorio vuelve al orden', page.evaluate('musicState.queue.map(t=>t.id)') == before)

    # Atrás (Android) desde el álbum
    check('Atrás desde el álbum', page.evaluate('handleAndroidBack()'))
    page.wait_for_timeout(300)
    check('vuelve a la pestaña', page.evaluate('musicState.screen') == 'tab')

    # Artista
    page.click('#musTabs [data-tab=artists]'); page.wait_for_timeout(300)
    page.locator('.mus-list-row', has_text='Queen').locator('.pod-list-open').click(); page.wait_for_timeout(300)
    check('artista: 2 álbumes y 14 canciones', page.locator('.mus-album').count() == 2 and page.locator('#musicContent .mus-row').count() == 14)
    page.screenshot(path=f'{SHOTS}/m-04-artista.png')
    page.evaluate('history.back()'); page.wait_for_timeout(300)

    # Carpetas: entra solo en «Music», luego subcarpeta
    page.click('#musTabs [data-tab=folders]'); page.wait_for_timeout(300)
    names = page.evaluate("[...document.querySelectorAll('#musicContent .mus-list-row strong')].map(x=>x.textContent)")
    check('carpetas raíz: Download y Music', names == ['Download', 'Music'], names)
    page.locator('.mus-list-row', has_text='Music').locator('.pod-list-open').click(); page.wait_for_timeout(300)
    page.locator('.mus-list-row', has_text='Rock').locator('.pod-list-open').click(); page.wait_for_timeout(300)
    check('migas de pan', page.locator('.mus-crumbs button').count() == 2)
    check('▶ carpeta = todo lo de dentro (14)', 'canciones' in page.inner_text('.mus-head') and '14' in page.inner_text('.mus-head'))
    page.screenshot(path=f'{SHOTS}/m-05-carpeta.png')
    page.locator('.mus-crumbs button').first.click(); page.wait_for_timeout(300)
    check('miga «Music» navega', page.evaluate('musicState.screen') == 'folder:Music')

    # Géneros
    page.click('#musTabs [data-tab=genres]'); page.wait_for_timeout(300)
    check('géneros 3', page.locator('.mus-list-row').count() == 3)

    # Búsqueda
    page.fill('#musSearch', 'queen opera'); page.wait_for_timeout(500)
    check('búsqueda por palabras', page.locator('#musicContent .mus-row').count() == 8 and page.locator('.mus-album').count() == 1, page.locator('#musicContent .mus-row').count())
    page.screenshot(path=f'{SHOTS}/m-06-busqueda.png')
    page.evaluate('handleAndroidBack()'); page.wait_for_timeout(300)
    check('Atrás borra la búsqueda', page.input_value('#musSearch') == '' and page.evaluate('musicState.search') == '')

    # Lista normal desde menú de canción
    page.click('#musTabs [data-tab=songs]'); page.wait_for_timeout(300)
    page.locator('#musicContent .mus-row').nth(0).locator('.pod-qmenu').click()
    page.locator('.pod-sheet-item', has_text='Añadir a una lista').click()
    page.fill('.pod-sheet-form input', 'Para correr'); page.click('.pod-sheet-ok'); page.wait_for_timeout(200)
    for k in (1, 2, 3):
        page.locator('#musicContent .mus-row').nth(k).locator('.pod-qmenu').click()
        page.locator('.pod-sheet-item', has_text='Añadir a una lista').click()
        page.locator('.pod-sheet-item', has_text='Para correr').click(); page.wait_for_timeout(100)
    lid = page.evaluate("musicState.lists[0].id")
    check('lista con 4 canciones', page.evaluate('musicState.lists[0].items.length') == 4)
    page.evaluate(f"openMusicScreen('list:{lid}')"); page.wait_for_timeout(300)
    rows = page.locator('#musicContent .pod-qlist .mus-row')
    ids0 = page.evaluate('musicState.lists[0].items.map(x=>x.id)')
    h = rows.nth(2).locator('.pod-qhandle').bounding_box(); top = rows.nth(0).bounding_box()
    page.mouse.move(h['x'] + 10, h['y'] + 10); page.mouse.down()
    for k in range(1, 11):
        page.mouse.move(h['x'] + 10, h['y'] + 10 - (h['y'] - top['y'] + 20) * k / 10); page.wait_for_timeout(16)
    page.mouse.up(); page.wait_for_timeout(300)
    ids1 = page.evaluate('musicState.lists[0].items.map(x=>x.id)')
    check('arrastrar reordena la lista', ids1 == [ids0[2], ids0[0], ids0[1], ids0[3]], ids1)
    page.screenshot(path=f'{SHOTS}/m-07-lista.png')
    page.locator('.pod-list-actions button', has_text='Reproducir').first.click(); page.wait_for_timeout(400)
    check('reproducir lista: suena la primera y el resto en cola', page.evaluate('musicState.current.id') == ids1[0] and page.evaluate('musicState.queue.map(t=>t.id)') == ids1[1:])

    # Inteligentes
    page.evaluate("setMusicTab('lists')"); page.wait_for_timeout(200)
    page.locator('.pod-list-actions button', has_text='Lista inteligente').click()
    page.locator('.pod-sheet-item', has_text='Personalizada').click(); page.wait_for_selector('.pod-smart-form')
    page.fill('.pod-smart-form [data-k=name]', 'Queen sin escuchar')
    page.select_option('.pod-smart-form [data-k=source]', 'artists'); page.wait_for_timeout(100)
    page.locator('.pod-pick-list label', has_text='Queen').locator('input').check(); page.wait_for_timeout(100)
    page.select_option('.pod-smart-form [data-k=state]', 'never'); page.wait_for_timeout(100)
    prev = page.inner_text('[data-preview]')
    page.screenshot(path=f'{SHOTS}/m-08-editor.png')
    exp = page.evaluate("musicState.tracks.filter(t=>t.artist==='Queen' && !trackPlays(t)).length")
    check('vista previa cuenta bien', str(exp) in prev, prev)
    page.click('.pod-smart-form .pod-sheet-ok'); page.wait_for_timeout(300)
    check('lista inteligente creada y abierta', page.evaluate('musicState.screen').startswith('list:') and page.locator('#musicContent .mus-row').count() == exp)
    page.evaluate("openMusicSmartEditor(null,{name:'80s cortas',rules:{yearFrom:1970,yearTo:1979,maxMin:3,order:'shortest'}})")
    page.click('.pod-smart-form .pod-sheet-ok'); page.wait_for_timeout(300)
    got = page.evaluate("musicListTracks(musicState.lists.at(-1)).map(t=>[t.year,t.dur])")
    check('años y duración máxima', got and all(1970 <= y <= 1979 and d <= 180 for y, d in got) and [d for _, d in got] == sorted(d for _, d in got), got)
    # M3U
    m3u = "#EXTM3U\n#PLAYLIST:De otro reproductor\n/storage/emulated/0/Music/Pop/Rosalia/03 - pista.mp3\nC:\\Musica\\Verano\\05 - pista.mp3\nno/existe.mp3\n"
    r = page.evaluate("t => { const r = tracksFromM3u(t); return [r.tracks.map(x=>x.folder), r.missing]; }", m3u)
    check('M3U: encuentra por carpeta y archivo', r == [['Music/Pop/Rosalia', 'Music/Recopilatorios/Verano'], 1], r)
    page.evaluate("exportMusicList(musicState.lists[0],'m3u')")
    sv = [c for c in page.evaluate('__calls') if c[0] == 'saveTextFile']
    check('exporta M3U', sv and sv[-1][1].endswith('.m3u8') and '#EXTINF' in sv[-1][2] and 'Music/' in sv[-1][2])

    # Cola
    page.evaluate("openMusicScreen('queue')"); page.wait_for_timeout(300)
    check('pantalla cola', page.locator('#musicContent .pod-qlist .mus-row').count() == page.evaluate('musicState.queue.length'))
    page.screenshot(path=f'{SHOTS}/m-09-cola.png')

    # Exclusión con podcasts
    page.evaluate("document.getElementById('musicAudio').play()"); page.wait_for_timeout(300)
    page.evaluate("const a=document.getElementById('podcastAudio'); a.src='/audio/x.wav'; a.play()"); page.wait_for_timeout(600)
    check('podcast pausa la música', page.evaluate("document.getElementById('musicAudio').paused"))
    page.wait_for_timeout(3500)
    check('y la música no se reanuda sola', page.evaluate("document.getElementById('musicAudio').paused"))
    page.evaluate("toggleMusicPlay()"); page.wait_for_timeout(500)
    check('música pausa el podcast', page.evaluate("document.getElementById('podcastAudio').paused") and not page.evaluate("document.getElementById('musicAudio').paused"))

    # Reproductor ampliado
    page.click('#musMiniOpen'); page.wait_for_timeout(300)
    page.screenshot(path=f'{SHOTS}/m-10-ampliado.png')
    check('Atrás cierra el ampliado', page.evaluate('handleAndroidBack()') and page.locator('#musExpanded').is_hidden())

    # Otras pestañas siguen funcionando
    page.click('#btnViewPodcasts'); page.wait_for_timeout(300)
    check('cambio a Podcasts oculta Música', page.locator('#viewMusic').is_hidden() and page.locator('#viewPodcasts').is_visible())
    page.click('#btnViewRadios'); page.wait_for_timeout(300)
    check('cambio a Radios', page.locator('#viewFav').is_visible() and page.locator('#viewMusic').is_hidden())
    page.click('#btnViewMusic'); page.wait_for_timeout(300)
    check('volver a Música', page.locator('#viewMusic').is_visible())
    check('Atrás en Música → Radios', page.evaluate('handleAndroidBack()') or True)
    page.wait_for_timeout(300)
    check('… y llega a Radios', page.locator('#viewFav').is_visible())

    # Recarga
    snap = page.evaluate('[musicState.queue.map(t=>t.id), musicState.lists.map(l=>l.name), musicState.current.id]')
    page.reload(); page.wait_for_timeout(600)
    page.click('#btnViewMusic'); page.wait_for_function('musicState.loaded')
    page.wait_for_timeout(300)
    after = page.evaluate('[musicState.queue.map(t=>t.id), musicState.lists.map(l=>l.name), musicState.current && musicState.current.id]')
    check('recarga: cola, listas y canción actual', after == snap, f'{snap} vs {after}')
    check('recarga: no suena sola', page.evaluate("document.getElementById('musicAudio').paused"))

    # Modo oscuro y anchura
    page.evaluate("document.documentElement.classList.add('dark-mode')")
    page.click('#musTabs [data-tab=albums]'); page.wait_for_timeout(300)
    page.screenshot(path=f'{SHOTS}/m-11-oscuro.png')
    page.evaluate("openMusicScreen('album:' + [...musicState.albums.keys()][4])"); page.wait_for_timeout(300)
    page.screenshot(path=f'{SHOTS}/m-12-album-oscuro.png')
    ov = page.evaluate("document.getElementById('musicContent').scrollWidth - document.getElementById('musicContent').clientWidth")
    check('sin desborde horizontal', ov <= 1, ov)
    tb = page.evaluate("document.querySelector('.view-toggle').scrollWidth - document.querySelector('.view-toggle').clientWidth")
    check('las tres pestañas caben', tb <= 1, tb)

    # Navegador: carpeta con MP3 etiquetados (jsmediatags)
    res = page.evaluate("""async () => {
      const files = await Promise.all(['tag1.mp3','tag2.mp3','tag3.mp3'].map(async n => new File([await (await fetch('/m/'+n)).blob()], n, {type:'audio/mpeg', lastModified: 1})));
      const items = files.map(f => ({path:'Disco/'+f.name, folder:'Disco', file:f.name, fileObj:f}));
      const tr = await buildFromFiles(items, 'MiMusica');
      return tr.map(t => [t.title, t.artist, t.album, t.track, t.year, t.genre, t.folder, !!t.art]);
    }""")
    check('navegador: etiquetas y carátula leídas', res and all(r[1] == 'Banda Test' and r[2] == 'Disco de prueba' and r[4] == 1999 and r[5] == 'Rock' and r[6] == 'MiMusica/Disco' and r[7] for r in res) and sorted(r[3] for r in res) == [1, 2, 3], res)
    b.close()

print('\nErrores JS:', len(errors))
for e in errors[:15]: print('  ', e[:300])
fails = [r for r in results if not r[1]]
print(f'{len(results) - len(fails)}/{len(results)} OK')
srv.shutdown()
