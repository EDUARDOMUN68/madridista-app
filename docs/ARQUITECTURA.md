# Arquitectura de actualización

Madridista es una PWA estática. index.html consume real_madrid.json; update_data.py genera calendarios, resultados, goleadores, jornadas y clasificaciones. GitHub Actions ejecuta el actualizador cada hora y GitHub Pages publica los cambios.

LaLiga define la pertenencia a las 38 jornadas de diez partidos. Si su página no responde, se conserva el catálogo completo anterior y se consultan los estados pendientes en los marcadores diarios de ESPN. Los encuentros finalizados del catálogo se trasladan al calendario del Madrid, manteniendo los canales de TV. No se infiere un final solo por el tiempo transcurrido.

Los goles se acreditan por participantes explícitos y se publican únicamente si el desglose coincide con el marcador. Champions utiliza consultas diarias y exige 18 partidos por jornada.

## Identidad visual y versión 3.24.1

HTML declara y muestra 3.24.1; sw.js utiliza la misma versión de caché. Manifest, favicon, cabecera y apple-touch-icon utilizan recursos locales versionados. Los PNG incluyen fondo blanco y margen para conservar el escudo en iconos recortados por el sistema. La fecha del JSON expresa actualización de datos y no la versión de la aplicación.


## Detalle de LaLiga — 3.24.1

En Jornada, los partidos de LaLiga programados, en directo y finalizados permiten abrir un diálogo con Resumen (goles, tarjetas y cambios por tiempos) y Estadísticas de equipo. Consulta bajo demanda el resumen de ESPN, comprueba ambos equipos y resuelve el identificador por marcador diario cuando el catálogo oficial no lo aporta. Mientras permanece abierto se consulta cada 60 segundos; se detiene al cerrar o recibir un final y se pausa en segundo plano. Muestra carga, ausencia de datos y reintento con aviso si conserva una respuesta anterior. Champions no incorpora esta interacción todavía.

Los módulos match-detail.js y match-detail.css están incluidos en la caché 3.24.1; no modifican marcadores ni datos deportivos persistidos. Diálogo con cierre, Escape, teclado y pestañas accesibles.


### Alineaciones antes del inicio — 3.24.1

La primera pestaña es Alineaciones, seguida de Resumen y Estadísticas. Los encuentros programados de Liga también permiten abrir la ficha. Se muestran titulares iniciales y suplentes, sin registrar cambios en esta pestaña. Solo se presenta un once cuando la fuente aporta once titulares únicos explícitos; si falta, se indica que todavía no está disponible. No se deduce un once a partir de una convocatoria. Las alineaciones suelen conocerse aproximadamente una hora antes, pero la publicación depende de la fuente. La ficha se revisa cada 60 segundos también antes del inicio mientras esté abierta.

La versión 3.24.1 incorpora acentos azul, lavanda, verde y dorado en Alineaciones; cambio exclusivamente visual.
