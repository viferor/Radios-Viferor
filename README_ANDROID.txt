RADIO ESPAÑA 1.2.1 — PROYECTO ANDROID
=====================================

Proyecto Android Studio preparado para generar un APK de Radio España.

La aplicación nativa es un WebView que carga:
https://radiosviferor.vercel.app/

Versión:
- versionName: 1.2.1
- versionCode: 1201
- package: com.viferor.radioespana

Requisitos:
- Android Studio
- Android SDK 34
- JDK 17

Flujo recomendado:
1. Abrir esta carpeta raíz en Android Studio.
2. Esperar a Gradle Sync.
3. Build > Clean Project (si aparece) o ejecutar la tarea clean desde Gradle.
4. Build > Rebuild Project.
5. Build > Generate App Bundles or APKs > Generate APKs.

No se han modificado los archivos web de Radio España 1.2.1.


Radio España 1.2.2: soporte nativo para seleccionar archivos JSON desde Android WebView mediante ACTION_OPEN_DOCUMENT, corrigiendo la carga de copias de seguridad de emisoras. La web sigue cargándose desde https://radiosviferor.vercel.app/ y permanece en versión web 1.2.1.

## 1.4.16 — Corrección de errores DOM y carga
- Protegidas las transiciones Radios/Podcasts frente a elementos DOM inexistentes.
- Protegida la restauración del historial de Podcasts.
- Al volver a Radios se limpian también los estados visuales de resultados/fullscreen de Podcasts.
- Eliminadas referencias de versión 1.4.13/1.4.5 del paquete y unificada la versión en 1.4.16 / build 1416.
- La búsqueda de Podcasts conserva la vista de resultados independiente.
