# Radios Viferor
Radios y podcast

## 1.22.0 — Buscar canciones cortas o rotas

Menú ⋯ de Mi música → **⏱ Buscar canciones cortas o rotas…**: lista las canciones que duran
menos de lo que elijas (5 s, 15 s, 30 s, 1 min, 2 min u otra duración, en segundos o m:ss),
de la más corta a la más larga, incluidas las que no tienen duración. Debajo de cada una
sale la ruta del archivo; se pueden reproducir, guardar como lista, exportar sus rutas a
.txt u ocultar su carpeta.

## 1.21.1 — Deslizar para cambiar de canción

En el reproductor de música ampliado, deslizar el dedo a la **izquierda** pone la canción
**anterior** y a la **derecha**, la **siguiente**. La carátula sigue al dedo; un gesto corto
o vertical no hace nada, y tocar la carátula sigue abriendo la letra.

## 1.21.0 — Radio de una canción, ajustar la letra arrastrando y carátula → letra

- **📻 Radio de esta canción** (menú ⋯ de cualquier canción, también en el reproductor):
  crea una cola con música parecida de tu biblioteca: mismo artista, artistas parecidos
  (según ListenBrainz/MusicBrainz, vía `/api/similar`), mismo género y época, con más peso para tus
  favoritas y las más escuchadas, y sin repetir artista seguido. Es una radio sin fin:
  cuando quedan pocas canciones añade más. Reproducir otra colección la desactiva.
- **↕️ Ajustar arrastrando** (letra sincronizada): mientras suena, arrastra la letra hasta
  que la línea junto a la guía ▶ sea la que se oye; el desfase cambia en vivo y se guarda
  solo. Botones ±0,1 s, «Deshacer» y «Listo»; Atrás también termina el ajuste.
- Pulsar la **carátula** del reproductor ampliado abre la letra.

## 1.20.2 — Significado aunque no haya letra

La pestaña 💡 Significado ya no depende de encontrar la letra: si no la hay (o LRCLIB
falla), la IA explica la canción a partir del título, el artista y el álbum, y avisa si
no la conoce en vez de inventar. Desde «No se ha encontrado la letra» hay un botón
«💡 Ver el significado».

## 1.20.1 — Letras: LRCLIB más fiable

Cuando LRCLIB tardaba o devolvía un error puntual, la búsqueda de letra fallaba con
«LRCLIB no responde». Ahora el servidor reintenta, lanza a la vez la búsqueda exacta y la
de artista+título y solo da error si fallan todas; y si nuestro servidor no consigue
respuesta, la app pregunta a LRCLIB directamente desde el móvil.

## APK 1.10.1 — Sin corte al pasar a segundo plano

Al salir de la app, Android avisaba al WebView de que su ventana dejaba de verse;
Chromium marcaba la página como oculta y reajustaba el audio, lo que producía un corte
muy breve. Ahora, mientras hay algo sonando (servicio de reproducción activo), el WebView
ignora ese aviso y el sonido sigue sin interrupción. Solo cambia la app Android.

## 1.20.0 — Sonido: ecualizador, corrección de auriculares y motor de dos platinas

Botón **🎚️ Sonido** en el reproductor de música (y en el ⋯ de Mi música).

**Motor.** Dos `<audio>` (platinas): la siguiente canción se precarga 15 s antes y entra sin
pausa al acabar la actual, o con **fundido entre canciones** (2–12 s). Fundido corto al pausar
y reanudar (sin chasquidos). Los eventos solo cuentan para la platina que suena.

**Cadena de Web Audio** (`ecualizador.js`, solo se crea al activar algo, tras un toque):
mono → preamp → corrección de auriculares (hasta 20 filtros) → ecualizador de 10 bandas →
nivelador (compresión suave) → balance → limitador (−1 dB) → volumen. Preamp automático para no
saturar y curva de respuesta.

**Ecualizador**: 16 presets (graves, voz, rock, electrónica, flamenco y acústica, volumen bajo…)
y presets propios. **Auriculares**: correcciones de [AutoEq](https://github.com/jaakkopasanen/AutoEq)
(MIT, curva Harman). Incluidos los Realme Buds Air 7 Pro con y sin cancelación de ruido
(medición de Regan Cipher); el resto, unos 9.000 modelos, con `/api/autoeq` (índice y
ParametricEQ.txt de GitHub). Ajustes en `radios_viferor_music_audio_v1`.

**API.** El plan gratuito de Vercel admite 12 funciones: letras, traducción, significado, publicar
y AutoEq van en una sola, `api/music.js`, que reparte según `vercel.json` (las rutas
`/api/lyrics`, `/api/translate`… no cambian). Los manejadores están en `api/_*.js`.

## 1.19.0 — Favoritos y carpetas incluidas/excluidas en Mi música

**Favoritos** (`radios_viferor_music_favs_v1`): canciones (menú ⋯ o «☆ Favorita» en el
reproductor), álbumes, artistas, carpetas y géneros (botón ☆ en su cabecera o en su menú ⋯).
Pestaña **⭐ Favoritos** con todo lo marcado y botones para escucharlo junto; las listas
inteligentes tienen el origen «Mis favoritos».

**Carpetas** (`radios_viferor_music_folders_v1`): en Carpetas, «⚙️ Incluir / excluir carpetas»
abre el árbol de todas las carpetas (también las ocultas). 🚫 Excluir oculta una carpeta y lo de
dentro en toda la música (canciones, álbumes, artistas, búsqueda, listas inteligentes); ✅ Incluir
hace que solo se vea lo de las incluidas; se combinan. También desde el ⋯ de cada carpeta. Se
aplica al momento, sin volver a leer el móvil; las listas normales y la cola siguen pudiendo
tener canciones de carpetas ocultas.

## 1.18.1 — Significado como pestaña, buscar en internet y compartir en LRCLIB

- La letra tiene tres pestañas: **🎤 Letra**, **🌐 Original + español** y **💡 Significado**.
- **Gemini saturado (503):** reintenta una vez y, si sigue, prueba otros modelos «flash» de tu
  clave (los consulta a Google; también `GEMINI_FALLBACK_MODELS`). Si en Vercel hay además
  `ANTHROPIC_API_KEY`, la usa como último recurso. `vercel.json` da 60 s a esa función.
- **🌐 Buscar la letra en internet** (o un .lrc) cuando no está: abre Google para copiarla y
  pegarla en la app.
- **📤 Compartir en LRCLIB** las letras que escribes o sincronizas (`/api/lyrics-publish`). El
  dispositivo resuelve el reto de LRCLIB (SHA-256 en Web Workers) y se publica con el desfase
  aplicado.

## 1.18.0 — Letras: sincronizadas, traducidas y su significado

En «Mi música», botón **🎤 Letra** (reproductor ampliado o ⋯ de cualquier canción).

**De dónde sale.** Por orden: tu versión (pegada, elegida o sincronizada; se guarda en
`radios_viferor_lyrics_user_v1`, entra en el backup), la incrustada en el archivo (USLT/©lyr;
en el móvil se lee solo la etiqueta ID3 del principio con Range), un `.lrc` con el mismo nombre
al lado de la canción (navegador) y LRCLIB vía `/api/lyrics` (caché en IndexedDB).

**Sincronizada:** la línea que suena se ilumina y se centra; tocar una línea salta a ella.
«Ajustar desfase» la adelanta o retrasa. **Sin sincronizar:** «⏱ Sincronizar» pone la canción
desde el principio y se toca **MARCAR** al empezar cada línea (descuenta 0,2 s de reacción,
«Deshacer», barra espaciadora en el PC) y se guarda como LRC; o «Buscar versión sincronizada»
elige entre las de LRCLIB. También: editar o pegar la letra (texto o .lrc), exportar .lrc.

**Original + español:** traducción automática línea a línea (`/api/translate`, Google, sin
clave), debajo de cada línea. Ahí está **💡 Significado de la canción** (`/api/song-meaning`):
qué quiso transmitir el autor, temas e imágenes y contexto, explicado por IA. Necesita una
clave: `GEMINI_API_KEY` (gratis en aistudio.google.com/apikey) o `ANTHROPIC_API_KEY` en las
variables de Vercel, o pegarla en la app (se guarda solo en el dispositivo). Modelos:
`GEMINI_MODEL` (por defecto gemini-3.6-flash) y `ANTHROPIC_MODEL` (claude-haiku-5-5).

## 1.17.0 — Mi música (web) · APK 1.10.0

Tercera pestaña, **🎵 Música**: reproductor de la música guardada en el dispositivo.

**De dónde sale la música.** En la app Android (APK 1.10.0 o posterior) se pide el permiso
«Música y audio» y se leen las canciones registradas en el móvil (MediaStore). El WebView
intercepta tres rutas de la app: `/__music/library.json`, `/__music/track/{id}` (con Range,
para poder saltar) y `/__music/art/{álbum}` (`LocalMusic.java`). Nada sale del móvil. En el
navegador del PC se elige una carpeta: en Chrome/Edge se recuerda; las etiquetas y carátulas
se leen con jsmediatags (`vendor/`) y se guardan en IndexedDB. Con un APK antiguo, la pestaña
pide actualizar la app.

**Ver por** canciones, álbumes, artistas, carpetas (con migas de pan) y géneros, con búsqueda
por palabras. En cada álbum, artista, carpeta o género: reproducir, aleatorio, a continuación,
a la cola, guardar en lista o crear una lista inteligente. Menú ⋯ en cada canción (ir al álbum,
artista o carpeta, información, veces escuchada).

**Reproductor.** Mini y ampliado, aleatorio, repetir (todo / una), cola reordenable,
historial, temporizador, volumen. Notificación y pantalla de bloqueo con anterior/siguiente
(sección «music» en la parte nativa); en el PC, teclas multimedia. Solo suena una cosa a la
vez: radio, podcast o música.

**Listas.** Normales (reordenar, quitar, ordenar) e inteligentes (artistas, álbumes,
carpetas o géneros; nunca escuchadas, más escuchadas, olvidadas; añadidas hace poco;
duración; años; orden y máximo) con plantillas. Exportar e importar en M3U (VLC, Poweramp…)
o JSON. Se cuentan las escuchas (a los 30 s o a la mitad).

Claves: `radios_viferor_music_*` (cola, historial, opciones, listas, estadísticas, posición).

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
