/* Prepara la pantalla que se quiere fotografiar (lo usa shot.ps1).
   Uso: ...shot.html?shot=queue | podqueue | expanded | list */
(async () => {
  const esperar = ms => new Promise(r => setTimeout(r, ms));
  const modo = new URLSearchParams(location.search).get('shot') || 'queue';
  if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
  // La biblioteca se carga al abrir la pestaña de música, así que primero se entra.
  switchToMusic(false);
  for (let i = 0; i < 60 && !musicState.loaded; i++) await esperar(100);
  musicState.queue = musicState.tracks.slice(0, 4);
  musicState.current = musicState.tracks[0];
  saveMusicQueue();
  updateMusicNowUI();
  await esperar(150);
  if (modo === 'expanded') {
    openMusicExpanded();
  } else if (modo === 'list') {
    const l = createMusicList('Para el coche', musicState.tracks.slice(0, 4));
    openMusicScreen('list:' + l.id);
  } else if (modo === 'podqueue') {
    switchToPodcasts(true);
    await esperar(150);
    renderPodcastQueue(true);
  } else {
    // Como el usuario: abrir el reproductor y tocar «☰ Cola».
    openMusicExpanded();
    await esperar(120);
    document.getElementById('musExpQueue').click();
  }
  await esperar(250);
})();
