# Arquitectura de actualización

Madridista es una PWA estática. index.html consume real_madrid.json; update_data.py genera calendarios, resultados, goleadores, jornadas y clasificaciones. GitHub Actions ejecuta el actualizador cada hora y GitHub Pages publica los cambios.

LaLiga define la pertenencia a las 38 jornadas de diez partidos. Si su página no responde, se conserva el catálogo completo anterior y se consultan los estados pendientes en los marcadores diarios de ESPN. Los encuentros finalizados del catálogo se trasladan al calendario del Madrid, manteniendo los canales de TV. No se infiere un final solo por el tiempo transcurrido.

Los goles se acreditan por participantes explícitos y se publican únicamente si el desglose coincide con el marcador. Champions utiliza consultas diarias y exige 18 partidos por jornada.

## Identidad visual y versión 3.22.1

HTML declara y muestra 3.22.1; sw.js utiliza la misma versión de caché. Manifest, favicon, cabecera y apple-touch-icon utilizan recursos locales versionados. Los PNG incluyen fondo blanco y margen para conservar el escudo en iconos recortados por el sistema. La fecha del JSON expresa actualización de datos y no la versión de la aplicación.
