# «Buscar canciones nuevas» (APK 1.18): escanear carpetas y refresco automático.
#   python tests\test_scan.py
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
def song(i, folder='Music/Rock'):
    return {'id': i, 't': f'Canción {i}', 'a': 'Artista', 'al': 'Álbum', 'aa': '', 'ai': 1, 'n': i, 'y': 2020, 'd': 200000,
            'fn': f'{i}.mp3', 'da': now - i, 's': 4_000_000, 'm': 'audio/mpeg', 'g': 'Rock', 'f': folder}
LIB = [song(i) for i in range(1, 11)]
fetches = []

def route(r):
    u = r.request.url
    if not u.startswith(BASE): return r.abort()
    if '/__music/library.json' in u:
        fetches.append(1)
        return r.fulfill(json={'ok': True, 'api': 1, 'count': len(LIB), 'tracks': LIB})
    if '/__music/' in u: return r.fulfill(body=TONE, headers={'content-type': 'audio/wav'})
    if '/api/' in u: return r.fulfill(json={})
    return r.continue_()

results, errors = [], []
def check(name, cond, extra=''):
    results.append((name, bool(cond)))
    print(('OK   ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''))

MOCK = """
window.__calls = [];
const rec = n => (...a) => { window.__calls.push([n, ...a]); };
window.Android = {
  musicApiVersion: () => 1,
  musicScanApiVersion: () => window.__noScan ? 0 : 1,
  scanMusicFolders: rec('scan'),
  pickMusicScanFolder: rec('pick'),
  musicStorageRoots: () => '[]',
  musicPermissionStatus: () => 'granted',
  requestMusicPermission: rec('requestMusicPermission'),
  setPlaybackSection: rec('setPlaybackSection'),
  startMusicMedia: rec('startMusicMedia'),
  updatePodcastMedia: rec('u'), startPodcastMedia: rec('s'), stopPodcastMedia: rec('st'),
  syncPodcastSubscriptions: rec('sync'), canResumeAudio: () => true
};
if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded','1'); }
"""

def toast(page): return page.evaluate("document.getElementById('podToast')?.textContent || ''")
def scans(page): return [c for c in page.evaluate('__calls') if c[0] == 'scan']

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    ctx.route('**/*', route)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script(MOCK)
    page.goto(BASE + '/index.html'); page.wait_for_timeout(700)
    page.click('#btnViewMusic')
    page.wait_for_selector('#musicContent .mus-row')
    check('biblioteca inicial (10)', page.evaluate('musicState.tracks.length') == 10)
    page.wait_for_timeout(1800)
    s = scans(page)
    check('al abrir: escaneo silencioso de todo el móvil', len(s) == 1 and json.loads(s[0][2]) == [], s)
    check('al abrir no hay aviso', 'Buscando' not in toast(page))
    LIB.append(song(11)); LIB.append(song(12, 'Download'))
    page.evaluate("onAndroidMusicScan({ok:true, folders:[], ms:10})"); page.wait_for_timeout(400)
    check('tras el escaneo silencioso se ven las nuevas (12)', page.evaluate('musicState.tracks.length') == 12)

    # Menú → Buscar canciones nuevas
    page.click('#musMenu'); page.wait_for_timeout(200)
    check('menú: Buscar canciones nuevas (todo el móvil)', page.locator('.pod-sheet-item', has_text='Buscar canciones nuevas').count() == 1 and 'todo el móvil' in page.locator('.pod-sheet-item', has_text='Buscar canciones nuevas').inner_text())
    page.locator('.pod-sheet-item', has_text='Buscar canciones nuevas').click(); page.wait_for_timeout(200)
    check('aviso «Buscando…»', 'Buscando canciones nuevas' in toast(page), toast(page))
    check('pide escanear todo', json.loads(scans(page)[-1][2]) == [])
    LIB.extend([song(13), song(14), song(15)]); del LIB[0]
    page.evaluate("onAndroidMusicScan({ok:true, folders:[], ms:10})"); page.wait_for_timeout(400)
    check('resultado: 3 nuevas · 1 quitada', '3 canciones nuevas' in toast(page) and '1 quitada' in toast(page), toast(page))
    check('biblioteca 14', page.evaluate('musicState.tracks.length') == 14)
    page.click('#musMenu'); page.locator('.pod-sheet-item', has_text='Buscar canciones nuevas').click(); page.wait_for_timeout(100)
    page.evaluate("onAndroidMusicScan({ok:true, folders:[], ms:10})"); page.wait_for_timeout(400)
    check('sin cambios: «Sin novedades»', 'Sin novedades' in toast(page), toast(page))

    # Carpeta de música configurada
    page.click('#musMenu'); page.locator('.pod-sheet-item', has_text='Carpeta de música').click(); page.wait_for_timeout(200)
    page.locator('.pod-sheet-item', has_text='Elegir una carpeta').click(); page.wait_for_timeout(100)
    check('abre el selector nativo', any(c[0] == 'pick' for c in page.evaluate('__calls')))
    page.evaluate("onAndroidMusicFolder({path:'/storage/emulated/0/Music/Rock', error:''})"); page.wait_for_timeout(200)
    check('guarda la carpeta y la escanea', json.loads(scans(page)[-1][2]) == ['/storage/emulated/0/Music/Rock'])
    page.evaluate("onAndroidMusicScan({ok:true, folders:[], ms:10})"); page.wait_for_timeout(300)
    page.click('#musMenu'); page.wait_for_timeout(200)
    check('el menú muestra la carpeta', 'Music/Rock' in page.locator('.pod-sheet-item', has_text='Buscar canciones nuevas').inner_text())
    page.locator('.pod-sheet-item', has_text='Buscar canciones nuevas').click(); page.wait_for_timeout(100)
    check('buscar usa la carpeta configurada', json.loads(scans(page)[-1][2]) == ['/storage/emulated/0/Music/Rock'])
    page.evaluate("onAndroidMusicScan({ok:true, folders:[], ms:10})"); page.wait_for_timeout(300)

    # Escanear una carpeta solo esta vez
    page.click('#musMenu'); page.locator('.pod-sheet-item', has_text='Escanear una carpeta').click(); page.wait_for_timeout(100)
    page.evaluate("onAndroidMusicFolder({path:'/storage/ABCD-1234/Flac', error:''})"); page.wait_for_timeout(200)
    check('escanea esa carpeta', json.loads(scans(page)[-1][2]) == ['/storage/ABCD-1234/Flac'])
    check('…sin cambiar la configurada', page.evaluate("musicScanFolder()") == '/storage/emulated/0/Music/Rock')
    check('aviso con la SD', 'tarjeta SD › Flac' in toast(page), toast(page))
    page.evaluate("onAndroidMusicScan({ok:true, folders:[], ms:10})"); page.wait_for_timeout(300)

    # Cambio detectado por Android (copiar música con la app abierta)
    page.click('#musTabs [data-tab=songs]') if page.locator('#musTabs [data-tab=songs]').count() else None
    LIB.append(song(16))
    n0 = len(fetches)
    page.evaluate("onAndroidMusicChanged()"); page.wait_for_timeout(400)
    check('cambio en Android: se refresca sola (15)', page.evaluate('musicState.tracks.length') == 15)
    check('sin pantalla de carga', page.locator('#musicContent .mus-loading').count() == 0)
    page.evaluate("onAndroidMusicChanged()"); page.wait_for_timeout(400)
    check('sin cambios no vuelve a pintar', page.evaluate('musicState.tracks.length') == 15 and len(fetches) == n0 + 2)

    # Volver a la app → escaneo silencioso (con 30 s de margen)
    page.evaluate("musScan.lastAuto = 0; document.dispatchEvent(new Event('visibilitychange'))"); page.wait_for_timeout(100)
    k = len(scans(page))
    page.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); page.wait_for_timeout(100)
    check('al volver escanea una vez (no en bucle)', len(scans(page)) == k, k)

    # APK antigua
    page.evaluate("onAndroidMusicScan({ok:true}); window.__noScan = true"); page.wait_for_timeout(300)
    page.click('#musMenu'); page.locator('.pod-sheet-item', has_text='Buscar canciones nuevas').click(); page.wait_for_timeout(300)
    check('APK antigua: pide actualizar', 'APK 1.18' in toast(page), toast(page))
    b.close()

check('sin errores de página', not errors, errors)
bad = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(bad)}/{len(results)} OK')
sys.exit(1 if bad else 0)
