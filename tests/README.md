# Pruebas automáticas (no se publican: están en .vercelignore)

Abren la web en un Chromium sin ventana (Playwright), con un Android simulado
(`window.Android` falso) y las peticiones de red falsas (biblioteca de música, letras,
feeds…). No necesitan internet ni el móvil.

## Preparar (una vez)

```powershell
pip install playwright
python -m playwright install chromium
```

## Ejecutar (desde la raíz del repo)

```powershell
python tests\test_music.py     # Mi música: biblioteca, cola, listas, reproductor (53)
python tests\test_lyrics.py    # Letras: LRCLIB, sincronizar, traducción, significado (43)
python tests\test_favs.py      # Favoritos y carpetas incluidas/excluidas (24)
python tests\test_fx.py        # Ecualizador, auriculares, salida de audio (36)
python tests\test_radio.py     # Radio de canción, ajustar letra, cortas, eliminar, duplicadas,
                               # editar ID3, abrir desde otras apps, gestos (84) — tarda ~2 min
python tests\test_fix.py       # Bucle de feeds, registro de errores, reanudar (11)
python tests\test_swipe.py     # Deslizar entre Radios/Podcasts/Música (10)
python tests\test_auto.py      # Que no suene sola: interrupciones, «Reanudar al abrir»,
                               # microcortes y fallos de lectura (20)
```

Cada una termina con `N/N OK` y `Errores JS: 0`. Si alguna dice `FAIL`, el cambio ha roto algo.
Las capturas se guardan en `tests/shots/` (ignorada por git).

## Comprobación rápida sin Python ni internet (`tests/smoke/`)

Si no hay Playwright a mano, esto abre la web en el Chromium que ya está instalado (el de
Playwright) con un Android simulado y comprueba lo más delicado sin descargar nada:

```powershell
powershell -ExecutionPolicy Bypass -File tests\smoke\run.ps1
```

Ahora comprueba: la app abre en Radios, la última pestaña se recuerda **una sola vez**, las
llamadas de las APK antiguas (`switchToMusic()` sin argumentos) se ignoran, `viferorIrAPestana`
funciona y la recuperación de la música **no reinicia la canción** (usa dos platinas
simuladas). Monta `tests/smoke/test.html` a partir de `index.html`; no se sube a Vercel
(`tests/` está en `.vercelignore`).

Nota: no se reproduce audio de verdad porque `--virtual-time-budget` se queda colgado
mientras hay reproducción. Por eso la recuperación se prueba con platinas simuladas.

## Editor ID3 (Java, sin Android)

```powershell
cd tests\id3
mkdir out
javac -d out ..\..\app\src\main\java\com\viferor\radioespana\Id3Editor.java T.java
python t.py ..        # necesita: pip install mutagen   → 22/22 OK
```

## Trucos aprendidos

- `page.evaluate("x = () => …")` **devuelve una función y Playwright la ejecuta**: termina
  esas expresiones con `; 0`.
- Lo mismo con funciones que devuelven una promesa que espera al usuario
  (p. ej. `chooseMusicListFor(...)` abre un diálogo): añade `; 0` o el test se queda colgado.
- El audio de prueba es `tone.wav` (60 s). Las rutas `/__music/...` se simulan con soporte
  de `Range` (hace falta para buscar dentro de la canción y leer etiquetas).
