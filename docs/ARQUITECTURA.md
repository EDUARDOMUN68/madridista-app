# Arquitectura de actualización

Madridista es una PWA estática. index.html consume real_madrid.json; update_data.py genera calendarios, resultados, goleadores, jornadas y clasificaciones. GitHub Actions ejecuta el actualizador cada hora y GitHub Pages publica los cambios.

LaLiga define la pertenencia a las 38 jornadas de diez partidos. Si su página no responde, se conserva el catálogo completo anterior y se consultan los estados pendientes en los marcadores diarios de ESPN. Los encuentros finalizados del catálogo se trasladan al calendario del Madrid, manteniendo los canales de TV. No se infiere un final solo por el tiempo transcurrido.

Los goles se acreditan por participantes explícitos y se publican únicamente si el desglose coincide con el marcador. Champions utiliza consultas diarias y exige 18 partidos por jornada.
