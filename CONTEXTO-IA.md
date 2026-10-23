# Radios Viferor — Contexto completo para el asistente de IA

> **Para la IA (DeepSeek u otra):** lee este archivo entero antes de tocar nada. Es el traspaso
> del asistente que ha construido el proyecto hasta ahora. Aquí está qué es, cómo está hecho,
> cómo se trabaja, qué no hay que romper y cómo volver atrás si algo sale mal.
>
> **Estado de referencia (todo funcionando):** web **1.29.5** (compilación 12950) · APK
> **1.16.1** (versionCode 11601) · rama de respaldo
> **`respaldo/estable-2026-10-15`** en GitHub · fecha 2026-10-23.

---

## 0. Reglas de oro (no negociables)

1. **No rompas lo que funciona.** Cada cambio es pequeño, se prueba y se puede deshacer.
   Si una tarea exige reescribir mucho, propón antes el plan y espera el «sí» del usuario.
2. **Nunca borres ni renombres claves de `localStorage`** (lista en §8). Ahí están las
   emisoras favoritas, suscripciones, listas, progreso de podcasts, ajustes… del usuario.
   Si cambias un formato, añade una migración que lea el antiguo.
3. **Vercel Hobby: máximo 12 funciones** en `api/`. Hay 9. Un archivo nuevo en `api/` (sin
   `_` delante) es una función más. **Las funciones nuevas van dentro de `api/music.js`**
   (despachador) como `api/_nombre.js` + una entrada en `rewrites` de `vercel.json`. Si te
   pasas de 12, **el despliegue entero falla** (ya pasó una vez).
4. **Nada de frameworks, bundlers ni npm en la web.** Es JavaScript «vanilla» con scripts
   clásicos (variables y funciones globales compartidas entre archivos). No conviertas a
   módulos, no añadas React/Vite/TypeScript.
5. **Todo cambio en la web sube la versión** con `node scripts/version.mjs X.Y.Z NNNNN`
   (si no, el móvil sigue usando los archivos viejos de caché) y añade una entrada al
   principio de `README.md`. Todo cambio en `app/` sube `versionCode`/`versionName` en
   `app/build.gradle`.
6. **Antes de empezar, siempre `git pull`.** El usuario a veces trabaja con otros asistentes
   a la vez; ya ha habido cambios en remoto que no estaban en local.
7. **Nunca `git push --force` a `main`**, nunca reescribas historia publicada y **nunca
   borres la rama `respaldo/estable-2026-10-15`.**
8. **Habla con el usuario en español de España, claro y sin jerga.** No es programador
   profesional: dale pasos concretos (qué botón de GitHub Desktop, qué comando de PowerShell).
9. **No digas que algo funciona si no lo has comprobado.** Di qué has probado (y cómo) y qué
   no se ha podido probar (p. ej. «en el móvil no lo he podido probar»).
10. **No metas claves ni secretos en el código.** Las claves van en variables de entorno de
    Vercel (§6) o en el `localStorage` del propio usuario.

---

## 1. Qué es

**Radios Viferor** es una app personal del usuario (no está en Google Play) con tres pestañas:

| Pestaña | Qué hace |
|---|---|
| 📻 **Radios** | Emisoras españolas en directo (catálogo TDTChannels + local + radio-browser), favoritas ordenables, «Ahora suena» (ICY/metadatos), programa actual (EPG), reconexión automática, HLS. |
| 🎙️ **Podcasts** | Búsqueda (Apple Podcasts / PodcastIndex), suscripciones, OPML, episodios, cola, listas manuales e inteligentes, velocidad, temporizador, progreso, avisos de episodios nuevos (APK). |
| 🎵 **Música** | Reproductor de la música del móvil: canciones/álbumes/artistas/carpetas/géneros, favoritos, listas (normales e inteligentes, M3U), cola, motor de dos platinas (fundido y sin pausas), ecualizador + corrección de auriculares (AutoEq) por salida de audio, letras (LRCLIB) sincronizadas/traducidas/significado (IA), radio de una canción, duplicadas, canciones cortas/rotas, editar nombre e ID3, borrar archivos, abrir audio desde otras apps. |

Dos partes:

- **Web** en Vercel: <https://radiosviferor.vercel.app> (HTML/CSS/JS + funciones serverless en `api/`).
- **App Android** (`com.viferor.radioespana`): un WebView que carga esa web y añade lo nativo
  (notificación y controles multimedia, servicio en segundo plano, acceso a la música del
  móvil, borrar/editar archivos, abrir audio desde otras apps, widget, avisos de podcasts).

**Repositorio:** <https://github.com/viferor/Radios-Viferor> (rama `main`). Cada push a `main`
despliega la web en Vercel automáticamente; si toca `app/`, GitHub Actions compila el APK.

### El usuario
- Habla español (España). Usa **Windows**, **GitHub Desktop**, **Android Studio** y **PowerShell**.
- Repo local: `C:\Users\vifer\Downloads\radiosapp\v1\Radios Viferor`
- Móvil Android con auriculares **realme Buds Air 7 Pro**.
- Instala el APK con Gradle (necesita **JDK 17**; con Java 25 falla con «Unsupported class
  file major version 69»):

```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17*" | Resolve-Path | Select-Object -ExpandProperty Path
cd "C:\Users\vifer\Downloads\radiosapp\v1\Radios Viferor"
.\gradlew.bat --stop
.\gradlew.bat installDebug
```
(Si no tiene el JDK 17: `winget install --id EclipseAdoptium.Temurin.17.JDK -e`.)

---

## 2. Arquitectura en una imagen

```
 Móvil Android ─────────────────────────────────────────────────────────────
 │ MainActivity (WebView «AudioWebView»)                                    │
 │   carga https://radiosviferor.vercel.app/                                │
 │   puente JS:  window.Android.xxx()   (solo si la página es la de la app) │
 │   Android → web: evaluateJavascript("window.viferorNativeXxx…" /         │
 │                  "window.onAndroidXxx(…)")                               │
 │   intercepta https://radiosviferor.vercel.app/__music/…  (LocalMusic)    │
 │ MediaPlaybackService (primer plano) + PodcastMediaController (MediaSession│
 │   + notificación con secciones radio / podcast / music)                  │
 ───────────────────────────────────────────────────────────────────────────
 Vercel ────────────────────────────────────────────────────────────────────
 │ estáticos: index.html, *.js, styles.css, vendor/                         │
 │ api/*.js (funciones Node): stations, resolve, metadata, program,         │
 │   radio-search, podcast-search, podcast-feed, podcast-audio, music       │
 │   music.js despacha: lyrics, translate, song-meaning, lyrics-publish,    │
 │   autoeq, similar  (vía rewrites de vercel.json)                         │
 ───────────────────────────────────────────────────────────────────────────
 Externos: TDTChannels, radio-browser.info, Apple Podcasts, PodcastIndex,
 feeds RSS, LRCLIB, Google Translate (gtx), Gemini/Claude, AutoEq (GitHub raw),
 MusicBrainz + ListenBrainz, Deezer (respaldo).
```

---

## 3. Mapa de archivos

### Web (raíz)
| Archivo | Para qué |
|---|---|
| `index.html` | Estructura de las 3 pestañas, reproductores, menú de ajustes. Carga los scripts **en este orden**: `version.js`, `diagnostics.js`, `stations-data.js`, `buscador-radios.js`, `app.js`, `podcasts.js`, `podcast-listas.js`, `musica.js`, `letras.js`, `ecualizador.js` (todos con `?v=compilación`). |
| `version.js` | Única fuente de versión (`window.RV_VERSION`). No editar a mano: usar `scripts/version.mjs`. |
| `diagnostics.js` | Registro de errores (localStorage, agrupa repetidos ×N, errores de `<audio>`, envuelve `fetch`), `window.logError`, menú de ajustes (actualizar, «Reanudar al abrir», «Volver a sonar tras llamada o aviso»). |
| `stations-data.js` | Catálogo local de emisoras (respaldo). |
| `buscador-radios.js` | Buscador de emisoras (provincias, comunidades, cadenas, tipos). |
| `app.js` | **Radios**: catálogo, favoritas (`mis_radios_favoritas_v1`), reproducción (`reproducirRadio`, `intentarFuente`, HLS, reconexión, vigilancia de cortes), «Ahora suena», EPG, interrupciones del sistema (`rvPausaDelUsuario`, `rvInterrupcionPaso`, `rvAnotar`), gesto de deslizar entre pestañas, backup completo, tema. |
| `podcasts.js` | **Podcasts**: estado `podcastState`, suscripciones, búsqueda, feeds, episodios, reproductor (`podcastAudio`), progreso/reanudar, cola v2, `restoreLastPlayback` («Reanudar al abrir»), puentes `viferorNativePodcast*`, atrás de Android `handleAndroidBack`. |
| `podcast-listas.js` | Utilidades de interfaz **compartidas por todo** (`podToast`, `podSheet`, `podSheetClose`, `podPromptText`, `actionBar`, `makeSortable`) + listas/cola/velocidad/temporizador de podcasts. |
| `musica.js` | **Mi música** (el más grande): biblioteca (Android / carpeta / archivos), índices, motor de dos platinas (`musDecks`, `musicAudio()`, fundido, sin pausas), cola, historial, listas (manuales/inteligentes/M3U), favoritos, carpetas incluidas/excluidas, pantallas, reproductor mini y ampliado, gesto de carátula, radio de canción, cortas/rotas, duplicadas, eliminar, editar ID3, abrir desde otras apps, autorrecuperación al reanudar. |
| `letras.js` | Letras: fuentes (tuya, incrustada ID3/USLT, `.lrc`, LRCLIB con respaldo directo), panel, sincronizar con MARCAR, ajustar arrastrando, desfase, traducción, significado (IA), compartir en LRCLIB (prueba de trabajo). |
| `ecualizador.js` | Cadena Web Audio (`musicFx`): preamp, hasta 20 filtros de auriculares (AutoEq), EQ 10 bandas, nivelador, balance, mono, limitador; presets; búsqueda de auriculares; **ajustes por salida de audio** (altavoz/cable/USB/cada Bluetooth). |
| `styles.css` | Todos los estilos (claro y `html.dark-mode`). |
| `vendor/` | `hls.min.js`, `jsmediatags.min.js` (con sus licencias). |
| `scripts/version.mjs` | Cambia versión de la web y las marcas `?v=` de `index.html`. |
| `vercel.json` | Cabeceras, `maxDuration` de `api/music.js`, **rewrites** de las subfunciones. |
| `.vercelignore` | Excluye `tests/` y este archivo del despliegue. |
| `tests/` | Pruebas automáticas (Playwright) — ver `tests/README.md`. `tests/smoke/` no necesita Python. |
| `README.md` | **Historial de versiones** (la más nueva arriba). Mantenerlo. |

### API (`api/`)
| Ruta | Archivo | Qué hace |
|---|---|---|
| `/api/stations` | `stations.js` | Catálogo nacional (TDTChannels + radio-browser). |
| `/api/resolve` | `resolve.js` | Resuelve el stream de una emisora. |
| `/api/metadata` | `metadata.js` | «Ahora suena» (ICY y otros). |
| `/api/program` | `program.js` | Programa actual/siguiente (EPG de TDTChannels). |
| `/api/radio-search` | `radio-search.js` | Buscar emisoras en radio-browser. |
| `/api/podcast-search` | `podcast-search.js` | Buscar/populares (Apple; PodcastIndex si hay claves). |
| `/api/podcast-feed` | `podcast-feed.js` | Lee y normaliza un RSS (`meta=1` = solo metadatos). |
| `/api/podcast-audio` | `podcast-audio.js` | Proxy de audio solo para hosts Omny/Triton. |
| `/api/lyrics` | `_lyrics.js` vía `music.js` | Letras LRCLIB (`id`, `search=1`, o artista+título+álbum+duración). |
| `/api/translate` | `_translate.js` | Traducción línea a línea (Google gtx). |
| `/api/song-meaning` | `_song-meaning.js` | Significado con IA (Gemini o Claude; reintentos y modelos de respaldo). |
| `/api/lyrics-publish` | `_lyrics-publish.js` | Publicar letra en LRCLIB (reto + prueba de trabajo). |
| `/api/autoeq` | `_autoeq.js` | Buscar auriculares y sus filtros en AutoEq. |
| `/api/similar` | `_similar.js` | Artistas parecidos (MusicBrainz → ListenBrainz; Deezer de respaldo). |

`api/_lib/net.js`: `safeFetch` (bloquea IPs internas en cada redirección, lista blanca de host,
timeout), `readLimited`, `rateLimited`, `HttpError`. `api/_lib/body.js`: `readJson`.
**Todo fetch del servidor a terceros debe usar `safeFetch`.**

### Android (`app/src/main/java/com/viferor/radioespana/`)
| Archivo | Qué hace |
|---|---|
| `MainActivity.java` | WebView (`AudioWebView`: no se da por oculto mientras suena, evita cortes al pasar a segundo plano), puente `AndroidBridge` (§7), intercepta `/__music/`, permisos, archivos, recrea el WebView si muere el renderer (`?autoresume=1`), intents de abrir audio, onActivityResult/permisos delegados. |
| `LocalMusic.java` | MediaStore → `/__music/library.json`, `/__music/track/{id}` (con Range), `/__music/art/{albumId}?t=`, `/__music/ext/{ficha}`, `/__music/extart/{ficha}`. |
| `MediaPlaybackService.java` | Servicio en primer plano (WakeLock/WifiLock), auriculares desconectados → pausa. |
| `PodcastMediaController.java` | MediaSession + notificación (secciones radio/podcast/music). |
| `MusicDeleter.java` | Borrar archivos (Android 11+ `createDeleteRequest`; 10 `RecoverableSecurityException`; ≤9 permiso de escritura). |
| `MusicEditor.java` + `Id3Editor.java` | Renombrar y escribir ID3 (MP3) sin tocar el audio ni carátula/letra. `Id3Editor` es Java puro (probado en `tests/id3`). |
| `AudioOutputWatcher.java` | Avisa a la web de la salida de audio (altavoz/cable/USB/Bluetooth con nombre). |
| `OpenAudioActivity.java` + `ExternalAudio.java` | «Abrir con…»/«Compartir» audio y M3U desde otras apps. |
| `WidgetProvider`, `BootReceiver`, `PodcastCheckJobService`, `PodcastNotificationScheduler`, `MediaControlReceiver` | Widget, avisos de episodios nuevos, botones multimedia. |

`app/build.gradle`: compileSdk/targetSdk 34, minSdk 23, versión actual **1.15.0 / 11500**.
`.github/workflows/android.yml`: compila `assembleDebug` en cada push que toque `app/`.

---

## 4. Cómo trabajar (procedimiento para cada cambio)

1. `git pull` (o «Fetch/Pull» en GitHub Desktop). Lee los archivos que vas a tocar **enteros
   en la zona afectada**; busca con grep todos los usos de lo que cambies.
2. Haz el cambio mínimo. Mantén el estilo: español en textos y comentarios, `const`/`let`,
   funciones con nombre en español o inglés según el archivo, escapar HTML con `pEsc()`.
3. Comprueba sintaxis: `node --check archivo.js` (cada JS tocado); Java: compila en Android
   Studio o deja que lo haga GitHub Actions.
4. Prueba: ejecuta las pruebas de `tests/` relacionadas (y añade casos nuevos para lo nuevo).
   Si en el entorno no hay Python/Playwright, usa `powershell -ExecutionPolicy Bypass -File
   tests\smoke\run.ps1`: monta la web con un Android simulado, la abre en el Chromium que ya
   está instalado y comprueba pestañas y recuperación de la música (no necesita red).
5. Versión: `node scripts/version.mjs 1.28.1 12810` (la compilación sigue el patrón
   `1.28.1 → 12810`, `1.29.0 → 12900`). Si tocas `app/`, sube `versionCode` (+100 por menor,
   p. ej. 11500 → 11600) y `versionName` en `app/build.gradle`.
6. Añade la entrada al principio de `README.md` (`## 1.28.1 — título` + qué cambia y por qué).
7. Commit con mensaje en español que diga qué cambia (p. ej. «Podcasts: … (1.28.1)») y push.
8. Comprueba que Vercel ha desplegado (estado del commit en GitHub = «Vercel success») y, si
   tocaste `app/`, que el workflow «APK Android» ha terminado en verde.
9. Explica al usuario en 3-6 líneas qué ha cambiado, qué has probado y qué tiene que hacer
   (cerrar y abrir la app; o reinstalar el APK con los comandos de §1).

### Si solo tienes chat (sin acceso a archivos)
Pide al usuario que pegue los archivos o fragmentos necesarios. Entrega **cambios exactos**:
«en `musica.js`, busca este bloque … y sustitúyelo por …», o el archivo completo si es corto.
Recuérdale subir versión (paso 5) y hacer commit + push en GitHub Desktop.

---

## 5. Convenciones y piezas reutilizables

- **Interfaz común** (en `podcast-listas.js`, globales):
  `podToast(texto, {action, onAction, ms})`, `podSheet({title, subtitle, items:[{icon,label,hint,on,danger,disabled,checked,sep}], body, cancel, onClose})`,
  `podSheetClose()`, `await podPromptText({title,label,value,ok,placeholder})` (devuelve `null` si cancela),
  `actionBar([[texto, fn, clase, desactivado], …])`, `makeSortable(lista, onMove, scroller)`.
- **Música**: `musEl(tag, clase, html)`, `$m(id)`, `mNorm()`, `lsGet/lsSet`, `trackRow(t,i,opts)`,
  `appendRowsChunked`, `openMusicScreen('album:'|'artist:'|'list:'|'short:'|'dups:'…)`,
  `playCollection`, `queueTracks`, `playTrackNow`, `toggleMusicPlay`, `musicAudio()`.
  Ordenar: `musicSortFn(by)`, `openMusicSortMenu({title,count,conCarpeta,apply})`,
  `openQueueSortMenu()`, `sortMusicListMenu(l)` (botón «⇅ Ordenar» de la cola y de las listas).
  Pistas Android: id `a<idMediaStore>`; abiertas desde otra app: `x<ficha>` con `external:true`.
- **Atrás de Android**: `handleAndroidBack()` en `podcasts.js` cierra en orden hoja → paneles →
  letra → reproductor ampliado → pantallas. Todo panel nuevo debe engancharse ahí.
- **Escape**: cualquier texto de usuario/feeds en `innerHTML` pasa por `pEsc()`.
- **Mensajes en pantalla**: español de España, cortos, con emoji como el resto.
- **Comentarios**: en español, explican el *porqué* (lo que no es obvio).

---

## 6. Variables de entorno (Vercel → Settings → Environment Variables)

| Variable | Uso |
|---|---|
| `GEMINI_API_KEY` | Significado de canciones (está puesta). |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS` | Opcionales (modelo y respaldos). |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Opcionales (Claude como alternativa/respaldo). |
| `PODCASTINDEX_KEY`, `PODCASTINDEX_SECRET` | Opcionales (búsqueda en PodcastIndex). |

El usuario también puede poner su clave de IA en el propio móvil (se guarda en
`radios_viferor_ai_key_v1` y viaja en cabeceras `X-AI-Provider`/`X-AI-Key`).

---

## 7. Puente Android ⇄ web

**Web → Android** (`window.Android.*`, solo existe dentro de la app; comprobar siempre con
`typeof window.Android?.metodo === 'function'` porque el APK instalado puede ser antiguo):

`setPlaybackSection`, `startRadioMedia`, `updateRadioMedia`, `updateRadioNowPlaying`,
`stopRadioMedia`, `startPodcastMedia`, `updatePodcastMedia`, `stopPodcastMedia`,
`startMusicMedia`, `musicApiVersion`, `musicPermissionStatus`, `requestMusicPermission`,
`openAppSettings`, `deleteMusicFiles(reqId, idsCsv)`, `musicDeleteMode()`,
`editMusicFile(reqId, id, json)`, `takeOpenedAudio()`, `audioOutput()`, `audioState()`
(`call`/`busy`/`free`), `canResumeAudio()`, `reloadApp`, `sharePodcast`,
`syncPodcastSubscriptions`, `areNotificationsEnabled`, `requestNotificationPermission`,
`openNotificationSettings`, `saveTextFile`, `lastPlaybackSection()` (APK 1.16+, §9).

**Android → web** (funciones globales que la web debe mantener con el mismo nombre):
`viferorNativeRadio{Play,Pause}`, `viferorNativePodcast{Play,Pause,Next,Previous,Seek,SetPosition}`,
`viferorNativeMusic{Play,Pause,Next,Previous,Seek,SetPosition}`, `onAndroidMusicPermission`,
`onAndroidMusicDeleted`, `onAndroidMusicEdited`, `onAndroidAudioOutput`, `viferorOpenAudio`,
`viferorIrAPestana(seccion)` (APK 1.16+: cambia de pestaña, lo usa el widget),
`handleAndroidBack`, `switchToRadios/Podcasts/Music` (compatibilidad; solo se usan sin
argumentos desde APK ≤ 1.15 y en ese caso se ignoran), `onAndroidNotificationPermissionResult`,
`openPodcastFromNotification`.

**Si cambias un nombre de un lado, rompes el otro** (y los APK ya instalados).

---

## 8. Datos del usuario (no romper)

`localStorage` (todo entra en «💾 Backup completo de la aplicación» de Ajustes):

- Radios: `mis_radios_favoritas_v1`, `radio_espana_logos_v1`, `radio_resume_state`.
- General: `radios_viferor_playback_resume_v1`, `radios_viferor_autoresume`,
  `radios_viferor_resume_after_interrupt`, `radios_viferor_theme`, `radios_viferor_error_log_v1`,
  `radios_viferor_last_tab_v1` (última pestaña: `radios`/`podcasts`/`music`).
- Podcasts: `radios_viferor_podcasts_v1` (suscripciones), `…_podcast_favs_v1`,
  `…_podcast_queue_v2` (y `_v1` antiguo), `…_podcast_queue_opts_v1`, `…_podcast_history_v1`,
  `…_podcast_progress_v1`, `…_podcast_done_v1`, `…_podcast_resume_v3`, `…_podcast_playlists_v1`,
  `…_podcast_play_counts_v1`, `…_podcast_speed`, `…_podcast_filters_v1`, `…_podcast_language`,
  `…_podcast_mine_sort`, `…_podcast_time_mode`.
- Música: `radios_viferor_music_*`: `queue_v1`, `history_v1`, `context_v1`, `opts_v1`,
  `playlists_v1`, `playing_list_v1`, `stats_v1`, `resume_v1`, `ui_v1`, `volume`, `favs_v1`,
  `folders_v1`, `hidden_v1`, `short_secs`, `short_ok_v1`, `dup_ignore_v1`, `similar_v2`,
  `audio_v1` (ecualizador y perfiles por salida).
- Letras/IA: `radios_viferor_lyrics_user_v1`, `radios_viferor_lyrics_ui_v1`, `radios_viferor_ai_key_v1`.

IndexedDB `radios-viferor-music` (v2: `kv`, `meta`, `art`, `lyrics`) = cachés y la carpeta
elegida en navegador; se puede perder sin daño.

---

## 9. Lecciones aprendidas (errores que ya pasaron — no repetir)

- **Límite de 12 funciones de Vercel** → despliegue fallido. Subfunciones dentro de `api/music.js`.
- **Bucle de peticiones**: pintar → consultar → fallar → volver a pintar. Cualquier consulta
  que se lance al pintar debe tener espera tras fallo (ver `metaFailedAt` en `podcasts.js`).
- **«Se pone a sonar sola»**: (a) la marca de «sonando» no se quitaba al pausar →
  «Reanudar al abrir» arrancaba; (b) tras interrupción se esperaba 15 min a que otra app
  callara. Ahora: llamada → vuelve al colgar; aviso ≤ 45 s → vuelve; si no, queda en pausa.
  No reintroduzcas reanudaciones automáticas sin estos límites y sin `rvAnotar(...)`.
- **Clasificar pausas**: una pausa es del usuario si pasa por los botones (flags
  `musicUserPaused`/`podcastUserPaused`/`radioUserPaused`) o hubo un toque hace < 1,5 s
  (`rvPausaDelUsuario`). Respeta esos flags en todo código nuevo que pause o reanude.
- **«Me devuelve a Música y tengo que tocar Radios varias veces»**: `MainActivity` pedía la
  pestaña en cada arranque y dos veces (1,8 s y 3,5 s). Ahora solo se cambia de pestaña si
  el intent trae `openSection` (widget) y la última pestaña la restaura la web una vez
  (`restaurarPestanaAlAbrir`). **Cualquier llamada nueva a `switchToMusic`/`switchToPodcasts`/
  `switchToRadios` desde la web debe llevar argumentos**; sin argumentos se ignora (es la
  firma de las APK antiguas).
- **Música: recuperar sin reiniciar**. Para volver a cargar una canción se usa
  `musicRetrySameTrack`, que la carga en la **otra platina** en el punto donde iba y luego
  cambia a ella. **No volver a hacer `pause()` + `prepareTrack()` + `play()`**: así salían
  los «AbortError» y las canciones que volvían al segundo 0.
- **`PIPELINE_ERROR_READ` en `/__music/track/…`**: el tamaño que declara MediaStore puede
  quedarse corto. `LocalMusic` usa el tamaño real (`getStatSize()`), no declara longitud si
  no la sabe y reabre el archivo si una lectura falla. Los fallos se anotan como `MUSIC_IO`
  en el registro (`LocalMusic.setDiag`).
  **Nunca usar `AssetFileDescriptor.createInputStream()`** para servir audio: corta la lectura
  en la longitud *declarada* (desfasada a veces) y salta el `startOffset` por su cuenta; el
  cuerpo termina antes de lo que dice `Content-Length` y Chromium da `PIPELINE_ERROR_READ` a
  mitad de canción (y `play()` se queda colgado). Se lee el descriptor directamente con
  `new FileInputStream(afd.getFileDescriptor())` + `getChannel().position()`.
- **🩺 Prueba de lectura** (Mi música → ⋯ → «Comprobar la lectura de los archivos»,
  `probarLecturaMusica()`): compara bytes de rangos solapados de 3 canciones y lo anota como
  `MUSIC_IO`. Es la forma de distinguir «falla al servir el archivo» de «falla el
  reproductor del WebView», sin tener el móvil en mano.
- **Música: una sola recuperación a la vez** (`musicRecuperando` / `musicRecuperar`): la
  vigilancia de reanudar y el aviso de error se lanzaban juntos, se peleaban por las platinas
  y gastaban los 2 intentos sin arreglar nada (`AbortError`). **No volver a llamar a
  `musicCargarEnOtra` directamente**: siempre por `musicRecuperar`.
- **Errores que no son de lectura**: código 3/4 (`MEDIA_ERR_DECODE`/`FORMATO`) → no se
  reintenta el mismo segundo, se salta el trozo (`musicSaltarTrozo(t,a,10,1)`) y, si no, se
  pasa a la siguiente canción. Un fallo de **leer** en los primeros 5 s → siguiente canción
  (no tiene sentido empezarla en el 0:20).
- **Versión del APK a la vista**: el pie muestra «App Android X» (la lee del user-agent
  `RadiosViferor/x.y.z`, ver `diagnostics.js`) y se anota al abrir la app. Si es anterior a
  1.16.0 sale ⚠️. Sirve para saber si las mejoras nativas de música están puestas y para
  interpretar el registro (sin 1.16.0 **no hay líneas `MUSIC_IO`**).
- **Música: una canción que no se puede leer no deja la música muda.** Escalera de
  recuperación en `musicTrackFailed`: (1) `musicRetrySameTrack` en la otra platina y en el
  mismo punto; (2) `musicSaltarTrozo` 20 s más adelante (2 veces por canción); (3)
  `musicContinuarTrasFallo`: cola → siguiente/anterior del `musicState.context` → última del
  historial, con tope de 3 fallos seguidos (`musicFallosSeguidos`, se pone a 0 al sonar).
  **No volver a dejar el caso «fallo + cola vacía = silencio»**.
- **Nunca dejar una platina a volumen 0**: `deckLevel` sube en el cambio de platina
  (`switchToOtherDeck`, con red de seguridad a los 2,5 s), al reanudar (`toggleMusicPlay`) y
  al pausar (el fundido de pausa siempre devuelve el nivel). En el registro salía `gan=0.00`
  y la canción «sonaba» en silencio.
- **Microcortes con datos cargados** (`waiting` con `buf` de 50-180 s): `vigilanciaParada`
  vuelve a llamar a `play()` a los 2,5 s y solo recarga en la otra platina a los 9 s.
- **Dos platinas** en música (`musicAudio` y `musicAudio2`): los eventos solo cuentan para la
  activa (`on(ev, fn)` en `initMusic`). No escuches eventos de `#musicAudio` directamente.
- **Web Audio** (ecualizador) solo se crea tras un toque del usuario; con él activo el volumen
  va por `GainNode`, no por `audio.volume`. Fundidos: `deckLevel(i, nivel, segundos)`.
- **Caché del móvil**: sin subir versión (marcas `?v=`), el móvil ejecuta JS viejo.
- **Java 25** rompe Gradle: usar JDK 17.
- **Deezer ya no da artistas relacionados** → ListenBrainz. **LRCLIB** a veces da 5xx →
  reintento + consulta directa desde el móvil. **Gemini** da 503 a veces → reintento y modelos
  de respaldo.
- **Gestos**: deslizar la carátula ← = siguiente, → = anterior; **tocar la carátula** abre la
  cola o la lista que está sonando (`musAbrirListaSonando()`); la letra está en su botón
  «🎤 Letra» del reproductor ampliado. Deslizar en la pantalla principal ← = pestaña de la
  derecha (Radios → Podcasts → Música).
- **Pruebas Playwright**: no devuelvas funciones/promesas pendientes en `page.evaluate` (`; 0`).
- El repo «se movió»: la URL canónica es `https://github.com/viferor/Radios-Viferor`.

---

## 10. Pendiente / sin verificar en el móvil

Funciona en las pruebas pero el usuario aún debe confirmarlo en el móvil (APK 1.16.0):
borrar archivos, editar nombre/ID3, abrir audio desde otras apps, ajustes por salida de audio,
que no vuelva a sonar sola tras interrupciones. El feed «Comandante Lara»
(`feeds.asound.co`) devolvía 502 desde Vercel: ya no provoca bucle, pero la causa no se sabe.

**1.29.0 — cortes de música**: el registro del móvil (23-10-2026) demostró que los cortes eran
`PIPELINE_ERROR_READ: FFmpegDemuxer: data source error` al leer `/__music/track/…`, y que la
recuperación reiniciaba la canción (`AbortError`, vuelta al segundo 0). Está cambiado, pero
**falta saber si sigue apareciendo `MUSIC_IO` en el registro del móvil** y con qué detalle
(tamaño que no cuadra, reapertura, byte). Si vuelve a cortarse, pedir el registro y mirar esas
líneas antes de tocar nada más.

**1.29.2 — la canción se quedó parada (registro del 23-10, 15:57)**: `Fresh – Kool & The Gang`
falló al leer en el segundo 186 en las **dos** platinas y, con la cola vacía, se quedó muda
hasta pulsar «anterior». La web ya no deja ese caso, pero **la causa de la lectura sigue
siendo nativa**: sin APK 1.16.0 instalada no hay reintento de lectura ni reapertura del
archivo. Confirmar en el registro si aparecen líneas `MUSIC_IO` (tamaño que no cuadra,
reapertura, byte) — si no aparecen, el móvil tiene una APK anterior. También había un
`play()` que tardó 34 s y una platina con `gan=0.00` (ya corregido).

Ideas que se ofrecieron y el usuario no ha pedido aún: editar etiquetas de varias canciones a
la vez; presets de ecualización para el altavoz del móvil.

---

## 11. 🚨 Recuperación ante catástrofe (volver a como está hoy)

**Punto seguro:** rama `respaldo/estable-2026-10-15` = commit `427ee52` (web 1.28.0, APK 1.15.0).

### A. La web se ha roto (lo más rápido, sin tocar código)
Vercel → proyecto **radiosviferor** → **Deployments** → busca el despliegue del commit
`427ee52` («Que no se ponga a sonar sola…») → **⋯ → Promote to Production / Instant
Rollback**. La web vuelve al instante. Después arregla el código con calma.

### B. Volver el código de `main` a hoy (sin perder el historial)
En PowerShell, en la carpeta del repo:
```powershell
git fetch origin
git checkout main
git pull
git revert --no-edit 427ee52..HEAD     # deshace todo lo posterior con commits nuevos
git push
```
(Si el revert da conflictos y no se aclara: `git revert --abort` y usa la opción C.)

### C. Opción drástica (deja `main` idéntico al respaldo)
```powershell
git fetch origin
git checkout main
git reset --hard origin/respaldo/estable-2026-10-15
git push --force-with-lease origin main
```
⚠️ Borra de `main` todo lo posterior al respaldo (sigue en el historial de GitHub unos días,
pero no a la vista). Solo si A y B no bastan, y con el «sí» explícito del usuario.

### D. El APK nuevo falla
Reinstalar el estable: en GitHub Desktop, *Current branch* → `respaldo/estable-2026-10-15`,
y luego los comandos de instalación de §1 (`installDebug`). Volver después a `main`.
Consejo: guarda una copia de `app\build\outputs\apk\debug\app-debug.apk` cuando una versión
funcione bien.

### E. Datos del usuario (favoritas, podcasts, listas…)
Ajustes (☰) → **💾 Backup completo de la aplicación** → guarda el `.json`. Para recuperar:
**📂 Restaurar backup de la aplicación**. Hacer un backup **antes** de cualquier cambio grande
en formatos de datos.

### F. Claves
Si se crea otro proyecto de Vercel: volver a poner `GEMINI_API_KEY` (y las opcionales de §6).

---

## 12. Primer mensaje recomendado para empezar una sesión

> «Lee CONTEXTO-IA.md del repo Radios-Viferor. Haz `git pull`. Quiero: [tarea]. Antes de
> cambiar nada, dime qué archivos vas a tocar y cómo lo vas a probar. Sigue el procedimiento
> de la sección 4 (versión, README, pruebas) y explícame al final qué tengo que hacer yo.»
