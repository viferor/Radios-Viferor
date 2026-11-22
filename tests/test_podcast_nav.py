# Podcasts al estilo AntennaPod (1.40.0): barra inferior, Inicio, Cola, Novedades,
# Suscripciones, Más, filas de episodio y reproductor ampliado.
# Uso: python tests/test_podcast_nav.py   (capturas en tests/shots/pn_*.png)
import json, os, re, time, threading, functools, http.server, socketserver
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, 'shots'); os.makedirs(SHOTS, exist_ok=True)
TONE = open(os.path.join(HERE, 'tone.wav'), 'rb').read()
ARTS = [open(os.path.join(HERE, f'art{i}.png'), 'rb').read() for i in range(5)]

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.ThreadingTCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=REPO))
srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d' % srv.server_address[1]

NOW = time.time()
FEEDS = {
    'https://f.test/pizarra.xml': ('La Pizarra de Quintana', 0),
    'https://f.test/libro.xml': ('Un Libro Una Hora', 1),
    'https://f.test/larguero.xml': ('El Larguero', 2),
    'https://f.test/historia.xml': ('SER Historia', 3),
}
def feed_json(url, limit):
    title, i = FEEDS[url]
    eps = []
    for k in range(20):
        t = NOW - (k * 2 + i) * 86400 - i * 3600
        eps.append({
            'id': f'{i}-{k}', 'title': f'{title}: episodio {20 - k} con un título bastante largo para ver cómo se corta',
            'description': f'<p>Notas del episodio {20-k} de {title}.</p><p>Más en https://ejemplo.test/{i}/{k}</p>',
            'date': time.strftime('%a, %d %b %Y %H:%M:%S +0000', time.gmtime(t)),
            'audioUrl': f'{BASE}/audio/{i}-{k}.wav', 'duration': str(3600 + k * 120), 'size': 50_000_000 + k * 1_000_000,
            'image': f'{BASE}/img/{i}.png', 'pageUrl': f'https://ejemplo.test/{i}/{k}'})
    if limit: eps = eps[:limit]
    return {'feed': {'title': title, 'image': f'{BASE}/img/{i}.png', 'author': 'Autor', 'description': 'Desc'}, 'episodes': eps}

state = {'feed': 0}
def route(r):
    u = r.request.url
    if not u.startswith(BASE): return r.abort()
    if '/api/podcast-feed' in u:
        q = {k: v[0] for k, v in parse_qs(urlparse(u).query).items()}
        state['feed'] += 1
        if q.get('url') not in FEEDS: return r.fulfill(status=404, json={'error': 'no'})
        if q.get('meta') == '1':
            d = feed_json(q['url'], 0)
            rec = [int((NOW - k * 86400) * 1000) for k in range(12)]
            return r.fulfill(json={'feed': d['feed'], 'latest': rec[0], 'recent': rec, 'count': 20})
        return r.fulfill(json=feed_json(q['url'], int(q.get('limit') or 0)))
    m = re.search(r'/img/(\d+)\.png', u)
    if m: return r.fulfill(body=ARTS[int(m.group(1)) % 5], headers={'content-type': 'image/png'})
    if '/audio/' in u: return r.fulfill(body=TONE, headers={'content-type': 'audio/wav'})
    if '/__music/' in u: return r.fulfill(status=403, json={'ok': False})
    if '/api/' in u: return r.fulfill(json={})
    return r.continue_()

errors, results = [], []
def check(name, cond, extra=''):
    results.append((name, bool(cond)))
    print(('OK   ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''))

SUBS = [{'title': t, 'feedUrl': u, 'subscribedAt': '2026-01-01', 'artwork': f'{BASE}/img/{i}.png', 'newCount': [520, 7, 787, 71][i]}
        for u, (t, i) in FEEDS.items()]

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    for dark in (True, False):
        ctx = b.new_context(viewport={'width': 412, 'height': 915}, device_scale_factor=2, is_mobile=True, has_touch=True)
        ctx.route('**/*', route)
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        page.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        page.add_init_script("""
          if (!sessionStorage.getItem('seeded')) {
            localStorage.clear(); sessionStorage.setItem('seeded','1');
            localStorage.setItem('radios_viferor_podcasts_v1', %s);
            localStorage.setItem('radios_viferor_theme', %s);
          }""" % (json.dumps(json.dumps(SUBS)), json.dumps('dark' if dark else 'light')))
        page.goto(BASE + '/index.html'); page.wait_for_timeout(700)
        sfx = 'dark' if dark else 'light'
        check(f'[{sfx}] al abrir sigue en Radios', page.evaluate("document.getElementById('viewFav').classList.contains('active')"))
        page.click('#btnViewPodcasts'); page.wait_for_timeout(2500)
        check(f'[{sfx}] barra inferior visible', page.is_visible('#pnNav'))
        check(f'[{sfx}] Inicio activo', page.evaluate("document.querySelector('#pnNav [data-tab=landing]').classList.contains('active')"))
        check(f'[{sfx}] Inicio: título', page.inner_text('#podcastContent .pn-head h2') == 'Inicio')
        check(f'[{sfx}] Inicio: novedades en filas', page.locator('#podcastContent .pn-sec-inbox .pn-row').count() == 3, page.locator('#podcastContent .pn-sec-inbox .pn-row').count())
        check(f'[{sfx}] Inicio: Sorpréndete', page.locator('#podcastContent .pn-sec-surprise .pn-card').count() > 0)
        badge = page.inner_text('#pnInboxBadge')
        check(f'[{sfx}] contador de Novedades', badge.isdigit() and int(badge) > 0, badge)
        if dark:
            # Episodio empezado → «Continúa escuchando»
            page.evaluate("""(async () => { const eps = await fetchFeedEpisodes(podcastState.subs[0], 15); setEpisodePos(eps[1], 1200, 3720, true); await playEpisodeNow(eps[0]); })()""")
            page.wait_for_timeout(1500)
            page.evaluate("document.getElementById('podcastAudio').currentTime = 2.0"); page.wait_for_timeout(500)
            page.evaluate("pnScreens.landing('none')"); page.wait_for_timeout(400)
            check('Continúa escuchando: 2 tarjetas', page.locator('#podcastContent .pn-sec:first-of-type .pn-card').count() >= 2, page.locator('#podcastContent .pn-card').count())
            check('mini reproductor: solo ▶ visible', page.is_visible('#podPlayPause') and not page.is_visible('#podNext'))
            page.screenshot(path=os.path.join(SHOTS, f'pn_inicio_{sfx}.png'))
            # Cola
            page.evaluate("(async () => { const eps = await fetchFeedEpisodes(podcastState.subs[2], 15); queueEpisodes(eps.slice(0, 4), 'end', { toast: false }); })()"); page.wait_for_timeout(500)
            page.click('#pnNav [data-tab=queue]'); page.wait_for_timeout(500)
            check('Cola: título y resumen', page.inner_text('#podcastContent .pn-head h2') == 'Cola' and 'quedan' in page.inner_text('#podcastContent .pn-head-sub'), page.inner_text('#podcastContent .pn-head'))
            check('Cola: 5 filas (sonando + 4)', page.locator('#podcastContent .pn-row').count() == 5)
            check('Cola: asas para ordenar en 4', page.locator('#podcastContent .pn-handle').count() == 4)
            check('Cola: fila con fecha · MB', 'MB' in page.inner_text('#podcastContent .pn-row:nth-child(2) .pn-meta'), page.inner_text('#podcastContent .pn-row:nth-child(2) .pn-meta'))
            check('Cola: pestaña activa', page.evaluate("document.querySelector('#pnNav [data-tab=queue]').classList.contains('active')"))
            page.screenshot(path=os.path.join(SHOTS, f'pn_cola_{sfx}.png'))
            # Mover con el menú del episodio
            first = page.evaluate("podcastState.queue[0].id")
            page.evaluate("moveQueueItem(0, 3)"); page.wait_for_timeout(300)
            check('Cola: reordenar se refleja', page.evaluate("podcastState.queue[3].id") == first)
            # Novedades
            page.click('#pnNav [data-tab=novedades]'); page.wait_for_timeout(500)
            n_inbox = page.locator('#podcastContent .pn-row').count()
            check('Novedades: lista', n_inbox > 10, n_inbox)
            check('Novedades: lo de la cola no sale', page.evaluate("[...document.querySelectorAll('#podcastContent .pn-row')].every(r => !podcastState.queue.some(e => epKey(e) === r.dataset.ep))"))
            page.screenshot(path=os.path.join(SHOTS, f'pn_novedades_{sfx}.png'))
            # Atrás desde una pestaña vuelve a Inicio
            page.evaluate("handleAndroidBack()"); page.wait_for_timeout(500)
            check('Atrás desde Novedades → Inicio', page.evaluate("podcastState.screen") == 'landing', page.evaluate("podcastState.screen"))
            # Suscripciones
            page.click('#pnNav [data-tab=subs]'); page.wait_for_timeout(600)
            check('Suscripciones: 4 portadas', page.locator('#podcastContent .pn-grid .pn-tile').count() == 4)
            check('Suscripciones: número de nuevos', page.locator('#podcastContent .pn-grid .pod-tile-badge').count() >= 3, page.inner_text('#podcastContent .pn-grid'))
            check('Suscripciones: botón ＋', page.is_visible('.pn-fab-fixed'))
            page.screenshot(path=os.path.join(SHOTS, f'pn_subs_{sfx}.png'))
            # Abrir un podcast → filas
            page.click('#podcastContent .pn-grid .pn-tile >> nth=1'); page.wait_for_timeout(1200)
            check('Podcast: episodios en filas', page.locator('#podcastContent .pod-episodes .pn-row').count() == 20, page.locator('#podcastContent .pod-episodes .pn-row').count())
            check('Podcast: barra inferior sigue', page.is_visible('#pnNav'))
            page.screenshot(path=os.path.join(SHOTS, f'pn_podcast_{sfx}.png'))
            page.evaluate("handleAndroidBack()"); page.wait_for_timeout(500)
            check('Atrás desde el podcast → Suscripciones', page.evaluate("podcastState.screen") == 'subs', page.evaluate("podcastState.screen"))
            # Más
            page.click('#pnNav [data-tab=more]'); page.wait_for_timeout(400)
            items = page.inner_text('.pod-sheet-card')
            check('Más: opciones', all(x in items for x in ['Episodios', 'Historial', 'Favoritos', 'Estadísticas', 'Añadir podcast', 'Ajustes']), items)
            page.screenshot(path=os.path.join(SHOTS, f'pn_mas_{sfx}.png'))
            page.click('.pod-sheet-item:has-text("Episodios")'); page.wait_for_timeout(500)
            check('Episodios: lista de todas', page.locator('#podcastContent .pn-row').count() >= 40)
            page.click('#podcastContent .pn-head [aria-label=Filtrar]'); page.wait_for_timeout(300)
            page.click('.pod-sheet-item:has-text("Empezados")'); page.wait_for_timeout(300)
            check('Episodios: filtro Empezados', page.locator('#podcastContent .pn-row').count() >= 1 and page.locator('#podcastContent .pn-row').count() <= 3, page.locator('#podcastContent .pn-row').count())
            page.screenshot(path=os.path.join(SHOTS, f'pn_episodios_{sfx}.png'))
            # Reproductor ampliado
            page.click('#podcastMiniOpen'); page.wait_for_timeout(500)
            check('Ampliado: visible', page.is_visible('#podExpanded'))
            check('Ampliado: podcast • fecha', '•' in page.inner_text('#podExpandedSub'), page.inner_text('#podExpandedSub'))
            check('Ampliado: velocidad 1,00', page.inner_text('#pnExpSpeedVal') == '1,00')
            page.click('#pnExpFav'); page.wait_for_timeout(300)
            check('Ampliado: ☆ → favorito', page.evaluate("JSON.parse(localStorage.getItem('radios_viferor_podcast_ep_favs_v1')).length") == 1)
            t0 = page.evaluate("document.getElementById('podcastAudio').currentTime")
            page.screenshot(path=os.path.join(SHOTS, f'pn_reproductor_{sfx}.png'))
            page.click('#pnExpNotes'); page.wait_for_timeout(500)
            check('Notas del programa', 'Notas del episodio' in page.inner_text('.pod-sheet-card') and page.locator('.pn-notes-text a').count() == 1, page.inner_text('.pod-sheet-card')[:200])
            page.screenshot(path=os.path.join(SHOTS, f'pn_notas_{sfx}.png'))
            page.evaluate("closePodSheet()")
            page.click('#pnExpSleep'); page.wait_for_timeout(300)
            check('zᶻᶻ abre el temporizador', 'Temporizador' in page.inner_text('.pod-sheet-card'))
            page.evaluate("closePodSheet()")
            page.evaluate("handleAndroidBack()"); page.wait_for_timeout(300)
            check('Atrás cierra el reproductor', not page.is_visible('#podExpanded'))
            # Favoritos y estadísticas
            page.evaluate("pnScreens.favorites('push')"); page.wait_for_timeout(400)
            check('Favoritos: el episodio', page.locator('#podcastContent .pn-row').count() == 1)
            page.evaluate("pnScreens.stats('push')"); page.wait_for_timeout(400)
            check('Estadísticas: se pinta', page.locator('#podcastContent .pn-stat').count() == 4)
            page.screenshot(path=os.path.join(SHOTS, f'pn_estadisticas_{sfx}.png'))
            # Marcar todo como visto
            page.evaluate("pnScreens.novedades('replace')"); page.wait_for_timeout(300)
            page.click('#podcastContent .pn-head .pn-more'); page.wait_for_timeout(300)
            page.click('.pod-sheet-item:has-text("Marcar todo como visto")'); page.wait_for_timeout(400)
            check('Marcar todo como visto: vacía', page.locator('#podcastContent .pn-row').count() == 0 and page.is_hidden('#pnInboxBadge'))
            # Radios y Música siguen sin la barra
            page.click('#btnViewRadios'); page.wait_for_timeout(300)
            check('Radios: sin barra de podcasts', not page.is_visible('#pnNav'))
        else:
            page.screenshot(path=os.path.join(SHOTS, f'pn_inicio_{sfx}.png'))
            page.click('#pnNav [data-tab=subs]'); page.wait_for_timeout(500)
            page.screenshot(path=os.path.join(SHOTS, f'pn_subs_{sfx}.png'))
        ctx.close()
    b.close()

print('\nErrores JS:', len(errors))
for e in errors[:15]: print('  ', e[:300])
fails = [r for r in results if not r[1]]
print(f'{len(results) - len(fails)}/{len(results)} OK')
srv.shutdown()
