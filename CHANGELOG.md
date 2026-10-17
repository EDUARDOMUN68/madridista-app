# Registro de cambios

## 11 de octubre de 2026 — recuperación de resultados

- Refresca resultados pendientes del catálogo completo guardado cuando LaLiga no responde.
- Traslada encuentros finalizados del catálogo al calendario del Real Madrid para mostrarlos en Resultados y verificar sus goleadores.
- Conserva la pertenencia a jornadas, información de TV y validación de 38 jornadas de diez partidos.
- Validación: seis pruebas Python, incluida indisponibilidad de la página oficial y traslado de un final al calendario.

## 3.22.0 — 11 de octubre de 2026

- Versión visible en la cabecera y escudo en cabecera e iconos de instalación.
- Quitado «Sin goles» en el historial; conserva el nombre del equipo y deja vacío su desglose.
- URLs de iconos y manifest versionadas, caché renovada y registro del service worker sin caché HTTP del script.
- Revisada la interfaz en navegador local, incluidos resultados y anchura móvil sin desbordamiento horizontal.

## 3.22.2 — 11 de octubre de 2026

- Sustituidos los PNG dañados que cortaban el escudo en la cabecera.
- Renovadas las URLs de recursos y la caché para descargar las imágenes completas.

## Datos — 12 de octubre de 2026

- Actualizado Valencia–Real Madrid (J12) al sábado 7 de noviembre, 21:00 Europe/Madrid, con DAZN, según los calendarios oficiales de LaLiga y Real Madrid.
- Comprobados calendario y jornada J12; conservadas las 38 jornadas de diez partidos y las ocho jornadas de Champions. La versión de interfaz continúa en 3.22.2.


## 3.23.0 — 17 de octubre de 2026

- Detalle al pulsar encuentros de LaLiga en directo o finalizados en Jornada.
- Resumen por tiempos con goles, tarjetas y sustituciones, y pestaña de estadísticas de equipo.
- Consulta bajo demanda, actualización cada 60 segundos en directo y estados de carga/error/reintento.
- Fondo claro, cierre por Escape y navegación por teclado. Champions queda sin cambios.


## 3.24.0 — 17 de octubre de 2026

- Alineaciones como primera pestaña: titulares, dorsales, posición, formación y suplentes disponibles.
- Permite abrir encuentros de Liga antes del inicio y revisa la ficha cada 60 segundos abierta.
- Informa cuando las alineaciones aún no están publicadas; no muestra convocatorias como onces ni duplica cambios del Resumen.
- Renovación automática de la página al activar una nueva caché; los recursos versionados se buscan con su URL exacta.


## 3.24.1 — 17 de octubre de 2026

- Alineaciones con cabeceras azul y lavanda, formación dorada, titulares en verde suave y suplentes en ámbar. Dorsales destacados y filas alternas, conservando fondos claros y texto oscuro.


## 3.25.0 — 17 de octubre de 2026

- Servicio Web Push para avisar del once del Real Madrid en LaLiga antes del inicio.
- Permiso inicial del móvil, registro privado, recepción con ventana cerrada y apertura de Alineaciones.
- Servicio Cloudflare configurado con claves privadas y cron cada dos minutos. Activación por dispositivo al conceder permiso; entrega real en móvil pendiente de confirmación.
- Aviso único de confirmación al registrar el móvil.

## 3.25.1 — 17 de octubre de 2026

- Espera al receptor actualizado antes de registrar los avisos.
- Estado visible con permiso previo y recuperación del aviso inicial no recibido.
- Pruebas de actualización del receptor, reintentos y confirmación recibida.

### Servicio de avisos — corrección del 17 de octubre de 2026

- Corregida incompatibilidad de fetch en Cloudflare: utiliza redirect manual y rechaza redirecciones sin seguirlas. El modo error impedía todos los envíos.
- Prueba de regresión para el modo de redirección y diagnóstico sin endpoints ni claves. La interfaz continúa en 3.25.1.

## 3.26.0 — 17 de octubre de 2026

- Detalle de los partidos de Champions en Jornada, antes del inicio, en directo y finalizados.
- Mismas pestañas que en Liga: Alineaciones primero, Resumen y Estadísticas, con colores y seguimiento cada 60 segundos.
- Consulta la ficha de la competición seleccionada; conserva validación de equipos, carga, ausencia de datos y reintento. Los avisos móviles continúan limitados al Madrid en Liga.
