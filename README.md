# Radios Viferor
Radios y podcast

## 1.7.0 — Correcciones generales

**Versión.** La versión de la web está solo en `version.js`; la de Android, en `app/build.gradle`
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
