# Radios Viferor
Radios y podcast

## 1.16.1 — «Mis listas»

Debajo de «Mis podcasts» hay un botón «Mis listas» que despliega el orden de las
suscripciones, los modos (Últimos de todas, Mezclar, Continuar, Populares) y los accesos a la
Cola y a las Listas. «Mis podcasts» abre directamente tus suscripciones en el orden elegido.

## 1.16.0 — Cola y listas de reproducción de podcasts

**Cola.** Lo que suena después del episodio actual. Se guarda al cerrar la app y se ve en
☰ Cola (portada, «Mis podcasts» o el reproductor ampliado). Se reordena arrastrando ⠿, se
mezcla, se vacía, se guarda como lista y se quitan los escuchados (todo con «Deshacer»).
Opciones: repetir (episodio o cola entera), pasar al siguiente solo, saltar escuchados y, al
acabar la cola, seguir con novedades de tus suscripciones. ⏮ vuelve al principio si llevas
más de 10 s; si no, al episodio anterior del historial.

**Episodios.** Cada episodio tiene «＋ Cola» y un menú ⋯: reproducir ahora, a continuación,
al final de la cola, añadir a una lista, marcar como escuchado o no, ir al podcast. En cada
podcast, «☰ Cola y listas…» añade de golpe los sin escuchar (del más antiguo al más nuevo) o
crea una lista inteligente solo con ese podcast. «Últimos de todas», «Mezclar» y «Continuar»
ya no borran tu cola: si tienes una, preguntan si sustituirla, ponerlos a continuación o al
final.

**Listas.** Normales (eliges los episodios y el orden) e inteligentes (reglas: qué podcasts
—suscripciones, favoritos, una categoría o los que elijas—, sin escuchar / sin terminar /
empezados, fecha, duración mínima y máxima, cuántos por podcast, máximo y orden, incluido
«alternando podcasts»). Plantillas: novedades de la semana, cortos, a medias, lo nuevo de
favoritos, mezcla sorpresa. Se reproducen, se ponen a continuación o al final, se duplican,
se ordenan, se exportan e importan (JSON) y una inteligente se puede fijar como lista normal.
Las copias de seguridad completas ya las incluyen.

**Reproductor.** Velocidad (0,75× a 2,5×, se recuerda) y temporizador para dormir (minutos o
al terminar el episodio). Muestra cuál es el siguiente de la cola.

Código: `podcast-listas.js` (pantallas, listas, menús) y el núcleo de la cola en `podcasts.js`.
Claves nuevas: `radios_viferor_podcast_queue_v2`, `…_history_v1`, `…_queue_opts_v1`,
`…_playlists_v1`, `radios_viferor_podcast_speed`.

## 1.7.0 — Correcciones generales

**Versión.** Para publicar una versión nueva de la web: `node scripts/version.mjs 1.7.3 1730`
(actualiza `version.js` y las marcas `?v=` de `index.html`, para que el móvil no mezcle scripts
antiguos de su caché con los nuevos). La de Android está en `app/build.gradle`
(`versionName` / `versionCode`). «Buscar actualizaciones» compara la versión en uso con el
`version.js` publicado.

**Radio.** Reconexión con espera creciente (2, 4, 8… hasta 60 s, máximo 8 intentos) y sin
carreras al cambiar rápido de emisora. Pausar ya no provoca reconexiones, y la canción y la
programación solo se consultan mientras suena. Reordenar favoritas arrastrando ya no se corta.
Cargar favoritas añade sin duplicados.

**Podcasts.** La posición se guarda cada 5 s mientras suena. «Continuar» reproduce lo que dejaste
a medias. «Mis podcasts» hace como mucho 4 peticiones ligeras a la vez. Los episodios sin
`<guid>` tienen un identificador estable. «Reanudar al abrir» es opcional (en Ajustes).

**API.** `/api/metadata`, `/api/podcast-feed` y `/api/podcast-audio` ya no aceptan direcciones
internas ni privadas, validan cada redirección y limitan las peticiones por IP
(`api/_lib/net.js`). `/api/podcast-feed` admite `?meta=1` y `?limit=N`.

**Android.** Servicio en primer plano mientras suena, para que Android no corte el audio en
segundo plano. Los avisos de nuevos episodios usan JobScheduler y abren el podcast correcto.
El WebView solo navega por la app. Atrás en la pantalla principal manda la app a segundo plano.

**APK.** GitHub Actions compila el APK en cada cambio de `app/`
(pestaña *Actions* → *APK Android* → artefacto `radios-viferor-apk`).
