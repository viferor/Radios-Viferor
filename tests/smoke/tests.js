/* Se inyecta al final: prueba la pestaña al abrir y la recuperación de la música.
   (No se reproduce audio de verdad: con tiempo virtual el reproductor deja la página
   colgada. La recuperación se prueba con dos platinas simuladas, que es donde estaba el
   fallo: reinicio en el segundo 0 y «AbortError» al recargar.) */
(async () => {
  const out = [];
  const check = (n, ok, extra = '') => out.push((ok ? 'OK   ' : 'FALLA') + ' · ' + n + (ok ? '' : ' [' + extra + ']'));
  const esperar = ms => new Promise(r => setTimeout(r, ms));
  const vista = () =>
    document.getElementById('viewMusic').classList.contains('active')
      ? 'music'
      : document.getElementById('viewPodcasts').classList.contains('active')
        ? 'podcasts'
        : 'radios';
  const guardada = () => localStorage.getItem('radios_viferor_last_tab_v1');

  try {
    // Los manejadores de las pestañas se ponen en DOMContentLoaded: hay que esperar a que
    // la app termine de arrancar antes de tocar nada.
    if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
    await esperar(50);

    // ---- 1. Sin nada guardado, la app abre en Radios
    check('abre en Radios', vista() === 'radios', vista());

    // ---- 2. Una APK antigua (llamadas sin argumentos a los 1,8 y 3,5 s) ya no devuelve a Música
    document.getElementById('btnViewPodcasts').click();
    check('tocar Podcasts cambia la pestaña', vista() === 'podcasts', vista());
    check('se guarda la pestaña (podcasts)', guardada() === 'podcasts', guardada());
    window.switchToMusic();
    window.switchToMusic();
    check('las 2 llamadas del APK viejo se ignoran', vista() === 'podcasts', vista());

    // ---- 3. Al abrir, se vuelve a la última pestaña
    localStorage.setItem('radios_viferor_last_tab_v1', 'music');
    window.restaurarPestanaAlAbrir();
    check('vuelve a la última pestaña (Música)', vista() === 'music', vista());

    // ---- 4. Y luego no la vuelve a cambiar
    document.getElementById('btnViewRadios').click();
    window.switchToMusic();
    check('después de tocar Radios se queda en Radios', vista() === 'radios', vista());

    // ---- 5. Petición explícita del widget / APK nueva
    check('viferorIrAPestana(podcasts)', window.viferorIrAPestana('podcasts') === true && vista() === 'podcasts', vista());
    check('viferorIrAPestana(music)', window.viferorIrAPestana('music') === true && vista() === 'music', vista());
    check('viferorIrAPestana(radio)', window.viferorIrAPestana('radio') === true && vista() === 'radios', vista());

    // ---- 6. La biblioteca de música carga
    window.viferorIrAPestana('music');
    for (let i = 0; i < 40 && !musicState.loaded; i++) await esperar(100);
    check('la biblioteca de música carga', musicState.loaded && musicState.tracks.length === 2, `${musicState.loaded}/${musicState.tracks.length}`);

    // ---- 7. Recuperación de un fallo de lectura con dos platinas simuladas:
    //         cambia de platina, NO vuelve al segundo 0 y no pausa nada antes de tiempo.
    const cubo = () => ({
      src: '', currentTime: 0, paused: true, readyState: 4, networkState: 1, ended: false, preload: '', volume: 1, error: null,
      ratio: {},
      addEventListener(ev, fn) { (this.ratio[ev] = this.ratio[ev] || []).push(fn); },
      removeEventListener(ev, fn) { this.ratio[ev] = (this.ratio[ev] || []).filter(f => f !== fn); },
      emitir(ev) { (this.ratio[ev] || []).slice().forEach(f => f({ target: this })); },
      load() { setTimeout(() => this.emitir('canplay'), 0); },
      play() { this.paused = false; this.emitir('play'); this.emitir('playing'); return Promise.resolve(); },
      pause() { this.paused = true; this.emitir('pause'); }
    });
    const a0 = cubo(),
      a1 = cubo();
    musDecks[0] = a0;
    musDecks[1] = a1;
    musicState.deck = 0;
    const cancion = musicState.tracks[0];
    cancion.src = 'tono-simulado.wav';
    musicState.current = cancion;
    a0.paused = false; // estaba sonando cuando falló la lectura
    a0.currentTime = 42.5;
    musicRetry = { id: '', tries: 0, since: 0, pos: 0 };
    const okRec = await musicRetrySameTrack(cancion, a0, 'prueba automática');
    await esperar(50);
    check('la recuperación usa la otra platina', okRec === true && musicState.deck === 1, `ok=${okRec} platina=${musicState.deck}`);
    check('la canción sigue donde iba (no vuelve a 0)', Math.abs(a1.currentTime - 40.5) < 0.6, 'pos=' + a1.currentTime);
    check('la platina nueva suena y la vieja se para', !a1.paused && a0.paused, `a1.pausada=${a1.paused} a0.pausada=${a0.paused}`);

    // ---- 8. El presupuesto de reintentos se perdona cuando la canción vuelve a sonar bien
    musicRetry = { id: cancion.id, tries: 2, since: Date.now(), pos: 10 };
    a1.currentTime = 45;
    check('se perdona el fallo si ha vuelto a sonar', musicCanRetry(cancion) === true, 'tries=' + musicRetry.tries);
    musicRetry = { id: cancion.id, tries: 2, since: Date.now(), pos: 45 };
    check('sin avanzar, no se reintenta sin fin', musicCanRetry(cancion) === false, 'tries=' + musicRetry.tries);

    // ---- 8b. Si una canción no se puede leer, la música NO se queda muda: sigue con la
    //          siguiente de lo que estabas escuchando (en el móvil se quedó parada).
    const t1 = musicState.tracks[0],
      t2 = musicState.tracks[1];
    musicState.queue = [];
    musicState.history = [];
    musicState.context = [t1, t2];
    musicState.current = t1;
    musicRetry = { id: t1.id, tries: 2, since: Date.now(), pos: 0 }; // sin reintentos
    const fallo = cubo();
    fallo.currentTime = 0; // así tampoco puede «saltar un trozo»
    musDecks[musicState.deck] = fallo;
    musicTrackFailed(t1, fallo);
    await esperar(300);
    check('tras un fallo sigue con otra canción', musicState.current && musicState.current.id === t2.id, 'suena=' + (musicState.current && musicState.current.id));

    // ---- 8c. Un error de DECODIFICAR no se reintenta en el mismo segundo: se salta el trozo
    const antes = musicState.deck;
    musicState.current = cancion;
    musicRetry = { id: cancion.id, tries: 0, since: Date.now(), pos: 0 };
    musicSalto = { id: '', hechos: 0 };
    const decod = cubo();
    decod.currentTime = 2.5;
    decod.duration = 200;
    decod.error = { code: 3 };
    decod.paused = false;
    musDecks[antes] = decod;
    musicTrackFailed(cancion, decod);
    await esperar(400);
    check(
      'un error de decodificar salta el trozo (no recarga el mismo segundo)',
      musicSalto.hechos === 1 && musicState.deck !== antes && Math.abs(musicAudio().currentTime - 12.5) < 1,
      `saltos=${musicSalto.hechos} platina=${antes}->${musicState.deck} t=${musicAudio().currentTime}`
    );

    // ---- 8d. Nunca dos recuperaciones a la vez (se peleaban por las platinas)
    musicRetry = { id: cancion.id, tries: 0, since: Date.now(), pos: 0 };
    musicRecuperando = true;
    const bloqueada = await musicRetrySameTrack(cancion, cubo(), 'prueba');
    musicRecuperando = false;
    check('no hay dos recuperaciones a la vez', bloqueada === false);

    // ---- 9. Pulsar la carátula abre la cola (o la lista, si suena una lista tuya); la letra
    //         sigue en su botón.
    musicState.current = musicState.tracks[0];
    musicState.listId = null;
    document.getElementById('musExpArt').click();
    check('la carátula abre la cola', musicState.screen === 'queue', 'pantalla=' + musicState.screen);
    check('la cola enseña lo que suena', /Sonando ahora/.test(document.getElementById('musicContent').textContent));
    check('el botón «🎤 Letra» sigue en su sitio', !!document.getElementById('musExpLyrics'));
    const lista = createMusicList('Prueba carátula', musicState.tracks);
    setPlayingList(lista.id);
    document.getElementById('musExpArt').click();
    check('si suena una lista, la carátula abre la lista', musicState.screen === 'list:' + lista.id, 'pantalla=' + musicState.screen);
    // Con aleatorio el orden de la lista no es el que suena: manda la cola.
    setMusicOpt('shuffle', true);
    document.getElementById('musExpArt').click();
    check('con aleatorio, la carátula abre la cola', musicState.screen === 'queue', 'pantalla=' + musicState.screen);
    setMusicOpt('shuffle', false);

    // ---- 10. Botón «⇅ Ordenar» en la cola y en las listas
    const pinchar = async (texto, contenedor) => {
      const b = [...document.querySelectorAll(contenedor + ' button')].find(x => (x.textContent || '').includes(texto) && !x.disabled);
      if (!b) return false;
      b.click();
      await esperar(40);
      return true;
    };
    const ficha = (id, title, artist, album, track, added) => ({ id, title, artist, album, track, added, disc: 1, dur: 60, folder: 'Music', file: id + '.mp3' });
    const z1 = ficha('z1', 'Zeta', 'Aerosmith', 'B', 3, 100),
      z2 = ficha('z2', 'Alfa', 'Zappa', 'A', 1, 300);
    musicState.queue = [z1, z2];
    openMusicScreen('queue');
    await esperar(40);
    check('la cola tiene el botón «Ordenar»', await pinchar('Ordenar', '#musicContent'));
    const opciones = [...document.querySelectorAll('.pod-sheet .pod-sheet-item')].map(b => b.textContent).join(' | ');
    check('el menú ofrece Título, Artista, Pista y Fecha', ['Título', 'Artista', 'Número de pista', 'Fecha'].every(t => opciones.includes(t)), opciones);
    check('ordena la cola por título', (await pinchar('Título', '.pod-sheet')) && musicState.queue[0].id === z2.id, musicState.queue.map(t => t.title).join(' | '));
    musicState.queue = [z1, z2];
    await pinchar('Ordenar', '#musicContent');
    check('ordena la cola por artista', (await pinchar('Artista', '.pod-sheet')) && musicState.queue[0].id === z1.id, musicState.queue.map(t => t.artist).join(' | '));
    musicState.queue = [z1, z2];
    await pinchar('Ordenar', '#musicContent');
    check('ordena la cola por fecha', (await pinchar('Fecha', '.pod-sheet')) && musicState.queue[0].id === z2.id, musicState.queue.map(t => t.added).join(' | '));
    musicState.queue = [z1, z2];
    await pinchar('Ordenar', '#musicContent');
    check('invierte el orden de la cola', (await pinchar('Invertir', '.pod-sheet')) && musicState.queue[0].id === z2.id, musicState.queue.map(t => t.title).join(' | '));

    const tA = musicState.tracks[0],
      tB = musicState.tracks[1];
    const lista2 = createMusicList('Prueba orden', [tB, tA]);
    openMusicScreen('list:' + lista2.id);
    await esperar(40);
    check('la lista tiene el botón «Ordenar»', await pinchar('Ordenar', '#musicContent'));
    check('ordena la lista por título', (await pinchar('Título', '.pod-sheet')) && lista2.items[0].id === tA.id, lista2.items.map(x => x.title).join(' | '));

    // ---- 11. El registro de errores no tiene fallos de JavaScript
    const errs = (JSON.parse(localStorage.getItem('radios_viferor_error_log_v1') || '[]') || []).filter(x => x.type === 'error');
    check('sin errores de JavaScript', errs.length === 0, JSON.stringify(errs.slice(0, 2)));
  } catch (e) {
    out.push('FALLA · excepción: ' + (e && e.message ? e.message : e));
  }
  const pre = document.createElement('pre');
  pre.id = 'rvout';
  pre.textContent = 'RESULTADOS\n' + out.join('\n') + '\nFIN';
  document.body.append(pre);
})();
