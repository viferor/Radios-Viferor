# 💎 Alta calidad (FLAC): botón, filtro, reproducción FLAC, respaldo AAC y «solo con Wi-Fi».
import os, sys, time, threading, functools, http.server, socketserver
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, 'shots'); os.makedirs(SHOTS, exist_ok=True)
TONE = open(os.path.join(HERE, 'tone.wav'), 'rb').read()

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.ThreadingTCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=REPO))
srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d' % srv.server_address[1]

state = {'streams': [], 'flac_fail': False}
def route(r):
    u = r.request.url
    if u.startswith(BASE + '/api/'):
        if '/api/stations' in u: return r.fulfill(status=503, body='no')
        if '/api/metadata' in u:
            state.setdefault('meta', []).append(u)
            if 'distorsion' in u: return r.fulfill(json={'song': ''})
            return r.fulfill(json={'song': 'Artista Prueba - Canción Prueba', 'artist': 'Artista Prueba', 'track': 'Canción Prueba', 'cover': ''})
        return r.fulfill(json={})
    if u.startswith(BASE): return r.continue_()
    if 'google.com/s2/favicons' in u:
        return r.fulfill(body=open(os.path.join(HERE, 'art0.png'), 'rb').read(), headers={'content-type': 'image/png'})
    if 'radioparadise.com' in u or 'live-streams.nl' in u or 'radioemisoras.cl' in u or 'torontocast.com' in u:
        state['streams'].append(u)
        if state['flac_fail'] and ('flac' in u.lower()):
            return r.fulfill(status=404, body='x')
        return r.fulfill(body=TONE, headers={'content-type': 'audio/wav', 'access-control-allow-origin': '*'})
    return r.fulfill(status=404, body='')

CELL = "Object.defineProperty(navigator, 'connection', {get: () => ({type: 'cellular', addEventListener(){}})});"
res = []
def ok(name, cond):
    res.append((name, bool(cond))); print(('OK  ' if cond else 'FAIL') + ' ' + name)

errs = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    def nueva(cell=False):
        ctx = b.new_context(viewport={'width': 390, 'height': 800})
        if cell: ctx.add_init_script(CELL)
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.route('**/*', route)
        pg.goto(BASE + '/index.html'); pg.wait_for_timeout(800)
        return ctx, pg
    ctx, pg = nueva()
    ok('botón 💎 Alta calidad visible', pg.locator('#btnRadioHifi').is_visible())
    pg.screenshot(path=os.path.join(SHOTS, 'hifi_home.png'))
    pg.click('#btnRadioHifi'); pg.wait_for_timeout(500)
    n = pg.locator('#stationsGrid .station-card').count()
    ok('abre la búsqueda con 19 emisoras FLAC (%d)' % n, n == 19)
    ok('las emisoras llevan logo', pg.locator('#stationsGrid .station-card img').count() >= 19)
    ok('filtro Tipo = Alta calidad en los chips', 'Alta calidad' in pg.locator('#activeFilters').inner_text())
    pg.screenshot(path=os.path.join(SHOTS, 'hifi_lista.png'))
    pg.locator('#stationsGrid .station-card', has_text='Main Mix').first.click()
    pg.wait_for_timeout(1500)
    st = pg.locator('#status').inner_text() if pg.locator('#status').count() else pg.evaluate('statusEl.textContent')
    ok('suena el FLAC y lo indica (%s)' % st, 'FLAC' in st and state['streams'][-1].endswith('/flac'))
    pg.wait_for_timeout(800)
    m = [x for x in state.get('meta', []) if 'Paradise' in x]
    ok('pide «ahora suena» a la API de Radio Paradise (meta=rp:0)', m and 'meta=rp%3A0' in m[-1] and 'aac-320' in m[-1])
    ok('muestra artista y canción', 'Artista Prueba' in pg.evaluate('document.body.innerText'))
    # JB Radio2: FLAC caído -> MP3
    state['flac_fail'] = True; state['streams'].clear()
    pg.locator('#stationsGrid .station-card', has_text='JB Radio2').first.click()
    pg.wait_for_timeout(2000)
    ok('JB Radio2 sin FLAC suena por el MP3 (%s)' % state['streams'][-1:], state['streams'] and state['streams'][-1].endswith(':8076/mp3'))
    state['flac_fail'] = False
    # Emisora sin API ni stream con pérdida: no se pregunta y lo dice
    state['meta'] = []
    pg.locator('#stationsGrid .station-card', has_text='Distorsión FM').first.click()
    pg.wait_for_timeout(1500)
    ok('Distorsión FM: pregunta también por el FLAC (alt) y, si no hay nada, avisa', state['meta'] and 'alt=https' in state['meta'][-1] and 'no informa de la canción' in pg.evaluate('document.body.innerText'))
    # Ajustes -> comprobar «ahora suena» de todas
    pg.evaluate("document.getElementById('btnHifiCheck').click(); 0")
    pg.wait_for_timeout(2500)
    txt = pg.locator('#hifiCheck').inner_text()
    ok('comprobador: 18/19 con información (%s)' % txt.split(chr(10))[0], '18/19' in txt and 'Distorsión FM' in txt and 'sin información' in txt)
    pg.screenshot(path=os.path.join(SHOTS, 'hifi_check.png'))
    pg.click('#hifiCheckClose')
    # FLAC caído -> AAC de respaldo
    state['flac_fail'] = True; state['streams'].clear()
    pg.locator('#stationsGrid .station-card', has_text='Naim Jazz').first.click()
    pg.wait_for_timeout(2000)
    st = pg.evaluate('statusEl.textContent')
    ok('si el FLAC falla suena la AAC (%s)' % state['streams'][-1:], state['streams'] and state['streams'][-1].endswith('jazz-high.aac') and 'FLAC' not in st)
    state['flac_fail'] = False
    # ajuste
    ok('ajuste por defecto: solo con Wi-Fi', 'solo con Wi-Fi' in pg.locator('#btnHifiWifi').text_content())
    pg.evaluate("document.getElementById('btnHifiWifi').click(); 0")
    ok('ajuste cambia a «también con datos»', 'también con datos' in pg.locator('#btnHifiWifi').text_content())
    ok('se guarda', pg.evaluate("localStorage.getItem('radios_viferor_hifi_wifi_only')") == '0')
    # favorita y recarga
    pg.locator('#stationsGrid .station-card', has_text='ČRo Jazz').first.locator('.fav-btn').click()
    pg.click('#btnBackToRadios'); pg.wait_for_timeout(300)
    ok('se puede guardar como favorita', pg.locator('#favGrid .station-card', has_text='ČRo Jazz').count() == 1)
    ctx.close()
    # datos móviles
    state['streams'].clear()
    ctx, pg = nueva(cell=True)
    pg.click('#btnRadioHifi'); pg.wait_for_timeout(400)
    pg.locator('#stationsGrid .station-card', has_text='Rock Mix').first.click()
    pg.wait_for_timeout(1500)
    ok('con datos móviles no pide el FLAC (%s)' % state['streams'], state['streams'] and all('flac' not in u for u in state['streams']) and state['streams'][-1].endswith('rock-320'))
    pg.evaluate("localStorage.setItem('radios_viferor_hifi_wifi_only','0'); 0")
    state['streams'].clear()
    pg.locator('#stationsGrid .station-card', has_text='Mellow Mix').first.click()
    pg.wait_for_timeout(1500)
    ok('con el ajuste quitado, FLAC también con datos', state['streams'] and state['streams'][-1].endswith('mellow-flac'))
    # el filtro Musical sigue incluyendo las FLAC
    pg.evaluate("document.getElementById('selectType').value='musical'; aplicarFiltros(); 0"); pg.wait_for_timeout(300)
    ok('también salen en el tipo Musical', pg.locator('#stationsGrid .station-card', has_text='Radio Paradise').count() >= 4)
    ctx.close(); b.close()
good = sum(1 for _, c in res if c)
print(f'{good}/{len(res)} OK'); print('Errores JS:', len(errs)); [print('  ', e) for e in errs[:5]]
sys.exit(0 if good == len(res) and not errs else 1)
