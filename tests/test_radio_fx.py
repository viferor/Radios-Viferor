# 📻 Ecualizador y corrección de auriculares en la radio (1.36.0).
import os, sys, json, threading, functools, http.server, socketserver
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
# Servidor de «emisora sin CORS» de verdad (otro origen, sin Access-Control-Allow-Origin):
# Playwright añade CORS a lo que sirve con route.fulfill, así que se redirige aquí.
class NoCors(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        self.send_response(200); self.send_header('Content-Type', 'audio/wav'); self.send_header('Content-Length', str(len(TONE))); self.end_headers(); self.wfile.write(TONE)
srv2 = socketserver.ThreadingTCPServer(('localhost', 0), NoCors); srv2.daemon_threads = True
threading.Thread(target=srv2.serve_forever, daemon=True).start()
NOCORS = 'http://localhost:%d/stream' % srv2.server_address[1]

REQ = []
def route(r):
    u = r.request.url
    if 'live-streams' in u: REQ.append((r.request.resource_type, u[-25:]))
    if u.startswith(BASE + '/api/'):
        if '/api/stations' in u: return r.fulfill(status=503, body='no')
        return r.fulfill(json={'song': ''})
    if u.startswith(BASE): return r.continue_()
    if 'google.com/s2/favicons' in u: return r.fulfill(status=404, body='')
    if 'radioparadise.com' in u:   # permite CORS
        return r.fulfill(body=TONE, headers={'content-type': 'audio/wav', 'access-control-allow-origin': '*'})
    if 'live-streams.nl' in u:     # no permite CORS
        return r.fulfill(status=302, headers={'location': NOCORS})
    return r.fulfill(status=404, body='')

FX = {'hpOn': True, 'hp': {'name': 'realme Buds Air 7 Pro (ANC off)', 'label': 'Realme Buds Air 7 Pro', 'preamp': -2.1,
      'filters': [{'type': 'peaking', 'fc': 1000, 'gain': 2, 'q': 1}]}, 'eq': False, 'autoOutput': False}
res = []
def ok(name, cond):
    res.append((name, bool(cond))); print(('OK  ' if cond else 'FAIL') + ' ' + name)
errs = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 390, 'height': 800})
    ctx.add_init_script("localStorage.setItem('radios_viferor_music_audio_v1', %s)" % json.dumps(json.dumps(FX)))
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', route)
    pg.goto(BASE + '/index.html'); pg.wait_for_timeout(800)
    st = lambda: pg.evaluate('document.getElementById("playerStatus").textContent')
    cur = lambda: pg.evaluate('(() => { const a = document.getElementById("audioPlayer"); return {fx: a.hasAttribute("crossorigin"), paused: a.paused, n: document.querySelectorAll("#audioPlayer").length}; })()')
    pg.click('#btnRadioHifi'); pg.wait_for_timeout(400)
    pg.locator('#stationsGrid .station-card', has_text='Main Mix').first.click(); pg.wait_for_timeout(2000)
    c = cur()
    ok('emisora que permite CORS suena por el ecualizador (%s · %s)' % (c, st()), c['fx'] and not c['paused'] and '🎧' in st())
    ok('AudioContext en marcha', pg.evaluate('window.radioFx && radioFx.nodes && radioFx.el.id === "audioPlayer"'))
    lvl = pg.evaluate('''async () => { const n = radioFx.nodes; const ctx = n.volume.context; const an = ctx.createAnalyser(); an.fftSize = 2048; n.volume.connect(an);
      let m = 0; for (let k = 0; k < 10; k++) { await new Promise(r => setTimeout(r, 100)); const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d); for (const v of d) m = Math.max(m, Math.abs(v)); } return m; }''')
    ok('por el ecualizador sale sonido, no silencio (pico %.3f)' % lvl, lvl > 0.01)
    REQ.clear()
    pg.locator('#stationsGrid .station-card', has_text='Naim Jazz').first.click(); pg.wait_for_timeout(2500)
    c = cur()
    ok('emisora sin CORS suena con el <audio> normal (%s · %s)' % (c, st()), not c['fx'] and not c['paused'] and 'sin ecualizar' in st())
    ok('solo un audioPlayer y el otro parado', c['n'] == 1 and pg.evaluate('document.getElementById("audioPlayerFx")?.paused !== false || document.getElementById("audioPlayerAlt")?.paused !== false'))
    pg.locator('#stationsGrid .station-card', has_text='Rock Mix').first.click(); pg.wait_for_timeout(2000)
    c = cur()
    ok('vuelve al ecualizador con otra emisora CORS', c['fx'] and not c['paused'])
    pg.evaluate("document.getElementById('volumeRange').value = 30; document.getElementById('volumeRange').dispatchEvent(new Event('input')); 0")
    ok('el volumen va al <audio> que suena', abs(pg.evaluate('document.getElementById("audioPlayer").volume') - 0.3) < 0.02)
    # Pausa y reanudar con el botón
    pg.click('#btnRadioPlay'); pg.wait_for_timeout(500)
    ok('pausa', cur()['paused'] and 'pausa' in st().lower())
    pg.click('#btnRadioPlay'); pg.wait_for_timeout(2000)
    ok('reanuda', not cur()['paused'])
    # Desactivar «aplicar a la radio»
    pg.evaluate("(() => { const s = JSON.parse(localStorage.getItem('radios_viferor_music_audio_v1')); s.radio = false; localStorage.setItem('radios_viferor_music_audio_v1', JSON.stringify(s)); })()")
    pg.locator('#stationsGrid .station-card', has_text='Mellow Mix').first.click(); pg.wait_for_timeout(2000)
    c = cur()
    ok('con «aplicar a la radio» apagado: <audio> normal y sin aviso (%s)' % st(), not c['fx'] and not c['paused'] and 'ecualizar' not in st() and '🎧' not in st())
    # Ajustes -> panel de sonido con el interruptor de radio
    pg.evaluate("document.getElementById('btnRadioSonido').click(); 0"); pg.wait_for_timeout(500)
    ok('Ajustes abre el panel de sonido con «Aplicar también a la radio»', pg.locator('#fxPanel input[data-k=radio]').count() == 1)
    pg.screenshot(path=os.path.join(SHOTS, 'radio_fx_panel.png'))
    ctx.close(); b.close()
good = sum(1 for _, c in res if c)
print(f'{good}/{len(res)} OK'); print('Errores JS:', len(errs)); [print('  ', e) for e in errs[:5]]
sys.exit(0 if good == len(res) and not errs else 1)
