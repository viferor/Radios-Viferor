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

    // ---- 9. El registro de errores no tiene fallos de JavaScript
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
