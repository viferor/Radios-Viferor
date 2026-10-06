Radio España — base reconstruida 1.0.0

Base: app(1).zip.

Cambios:
- catálogo local como fuente principal de búsqueda; no depende de Radio Browser para cada búsqueda;
- filtros de cadena/provincia/tipo se aplican inmediatamente sin F5;
- favoritos modifican la tarjeta sin reconstruir la cuadrícula, conservando scroll;
- reproducción con varias fuentes por cadena y resolución secundaria mediante /api/resolve;
- soporte HLS cuando el navegador lo necesita;
- logos asociados a las cadenas principales y fallback visual seguro;
- catálogo embebido en stations-data.js para evitar una dependencia de fetch del JSON local;
- eliminado .env.local del paquete.


MEJORA 1.1.0
- El catálogo ya no queda limitado a Córdoba/provincia.
- Se añade /api/stations para cargar catálogo nacional desde TDTChannels y Radio Browser.
- El catálogo local de respaldo se conserva y se mezcla con el catálogo nacional.
- Los filtros de provincia/cadena/tipo siguen funcionando sobre el conjunto nacional.
- No se modifica la lógica de reproducción, favoritos ni logos que ya estaba funcionando.


MEJORA 1.2.0 — METADATOS Y PROGRAMACION
- Ahora suena: lectura de metadatos ICY del stream cuando la emisora los publica.
- Programa actual y siguiente: consulta de la EPG de radio de TDTChannels mediante epg_id.
- Actualización periódica de canción y programación durante la reproducción.
- La reproducción existente y los logos no se han sustituido.


VERSION 1.2.1
- Metadatos musicales reforzados mediante servidor + Radio Browser cuando el stream no expone ICY al navegador.
- EPG de radio corregida a la fuente XML/XML.GZ oficial de TDTChannels.
- Control de volumen propio 0-100, 101 niveles, mute grande y recuperación del nivel anterior.
- Reproducción y logos conservados.


VERSIÓN 1.3.0 — PODCASTS
- Nueva pestaña Podcasts independiente.
- Importación/exportación OPML compatible con feeds tipo AntennaPod.
- Búsqueda y populares mediante catálogo iTunes.
- Lectura de feeds RSS/Atom mediante endpoint servidor.
- Modos: últimos de todas las suscripciones, mezcla aleatoria, continuar y populares.
- Reproductor de episodios separado del reproductor de Radios.
- Radios no modificadas funcionalmente.

Radio España 1.3.5 — Correcciones de Podcasts y navegación
- Navegación principal reducida a dos pestañas: Radios y Podcasts.
- Radios conserva su búsqueda dentro de la propia pestaña.
- Podcasts conserva su búsqueda dentro de la propia pestaña.
- Mis podcasts es una vista de pantalla completa con retorno correcto a la pantalla principal de Podcasts.
- Exportación de OPML y copias JSON mediante selector nativo de guardado en Android; en web usa Save File Picker cuando está disponible.
- Importador Android acepta JSON, OPML y XML.
- Tras importar OPML se consulta cada feed para recuperar portada, autor y descripción cuando el OPML no los contiene.
- Reproductores de Radio y Podcast siguen siendo mutuamente excluyentes.


1.3.7 — Importación OPML en Ajustes y actualización sin borrar caché manualmente. Se añadió un botón de Aplicar actualización cuando el servidor publica una compilación nueva. En Android limpia la caché WebView y recarga con URL de refresco; en navegador usa una URL de recarga con marca temporal.


1.3.9: Exportar OPML se mueve a Ajustes; ya no aparece en Mis podcasts.


1.4.3 — Modo oscuro real: fondo general oscuro, tarjetas y formularios oscuros, contraste reforzado en textos y filtros amarillos, y corrección de superficies blancas residuales.

1.4.9: permisos y estado de notificaciones Android preparados; canal nativo creado y acceso a ajustes de notificaciones.


## 1.4.9 — auditoría final Podcasts
- Filtros de categoría y populares revisados para no producir falsos ceros por metadatos ausentes.
- Suscripciones: alta/baja y refresco inmediato de Mis podcasts.
- Notificaciones de nuevos episodios mantenidas y apertura desde notificación preparada.
- Versión coherente 1.4.9 / 1409.

## 1.4.10 — Ajuste visual modo oscuro y filtros de Podcasts
- Favoritos de Radios en modo oscuro: fondo negro y estrella amarilla, sin círculo blanco.
- Filtros de Podcasts: etiquetas visibles, controles más grandes y distribución adaptada a móvil.
- Cabecera introductoria de Podcasts más compacta para dejar espacio a los filtros.
- Versión coherente 1.4.10 / 1410.

## 1.4.20 — Corrección búsqueda y populares de Podcasts
- Los resultados de búsqueda se muestran inmediatamente sin depender de entrar en Mis podcasts y volver.
- Se elimina cualquier estado visual de pantalla completa de Mis podcasts al pasar a resultados.
- Se fuerza el refresco/scroll del contenedor de resultados para evitar que queden fuera de vista.
- Populares incorpora fallback a búsqueda de Apple ordenada por número de episodios si el endpoint RSS devuelve error o vacío.
- El filtro de categoría acepta coincidencia por ID o por nombre cuando Apple entrega metadatos inconsistentes.
- Versión coherente 1.4.20 / 1420.


## 1.4.20 — Ordenación de Mis podcasts
- Añadido selector de orden en Mis podcasts: Nombre A-Z, Nombre Z-A, Más escuchados, Más recientes y Más antiguos.
- Se registra el número de reproducciones iniciadas por podcast para permitir ordenar por Más escuchados.
- La preferencia de orden queda guardada localmente.
- Sin cambios funcionales en Radios.

## 1.4.30 — Orden correcto de Mis podcasts por última actualización
- Se desescapan correctamente las URLs de audio del RSS (`&amp;` → `&`) antes de enviarlas al reproductor.
- El proxy `/api/podcast-audio` normaliza también URLs HTML-escapadas y valida que la fuente devuelva audio.
- Se actualiza la versión de diagnóstico, API, web y Android a 1.4.30 / 1430.
- No se modifica la reproducción ni la lógica de emisoras de Radios.

## 1.4.26 — Actualización web forzada y versión coherente
- Versión unificada 1.4.26 / 1426 en HTML, JavaScript, diagnóstico, API de versión y Android.
- Aplicar actualización en Android fuerza una carga WebView sin caché y restaura el modo de caché normal después de la recarga.
- Se conserva el proxy de audio para podcasts de Radio MARCA.


## Mejoras introducidas en 1.4.30
- “Más recientes” en Mis podcasts ordena por la fecha del episodio más reciente publicado, no por la fecha de suscripción.
- “Más antiguos” usa el mismo criterio en sentido inverso.
- Se actualiza periódicamente la fecha del último episodio de cada suscripción para mantener el orden correcto.
- Las suscripciones sin fecha conocida quedan como respaldo y no interfieren con las que sí tienen fecha de actualización.
- No se modifica la funcionalidad de Radios.


## 1.4.30 — Aviso de podcasts sin actividad reciente

### Mejoras introducidas
- Mis podcasts y resultados de búsqueda muestran la antigüedad del último episodio cuando supera 1 año.
- Más de 1 año: aviso informativo.
- Más de 2 años: aviso de posible inactividad.
- 3 años o más: aviso destacado de ausencia de nuevos episodios.
- Se muestra la fecha exacta del último episodio disponible.
- La comprobación en búsqueda se realiza de forma progresiva para no bloquear la búsqueda.
- Se mantiene la lógica de reproducción y el proxy selectivo de podcasts de la versión anterior.
- No se modifica la funcionalidad de Radios.
