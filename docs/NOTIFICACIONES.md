# Avisos de los partidos del Real Madrid — 3.28.0

La campana de la cabecera activa o desactiva los avisos en ese dispositivo, con preferencia local persistente. La baja cancela la suscripción del navegador y borra su registro remoto cuando hay red. En dispositivos nuevos el permiso se pide tras tocar la campana; los ya activados mantienen la elección.

## Cobertura

- Real Madrid en LaLiga y Champions, tanto local como visitante.
- Once confirmado de once titulares únicos antes del inicio.
- Inicio, goles de ambos equipos con goleador y marcador, expulsiones de ambos equipos con jugador (incluida doble amarilla), descanso, inicio de segunda parte y final con resultado.
- Los avisos de incidencias abren Resumen; las alineaciones abren Alineaciones, en la competición y jornada correspondientes.
- El servicio consulta cada minuto. Hay retraso de sondeo y de publicación de la fuente; no garantiza avisar en el instante de la jugada. Red, permisos y Android también condicionan la entrega.

## Fuente y límites

El servicio consulta el calendario público y las fichas ESPN de esp.1 / uefa.champions, resueltas por fecha, horario, Madrid (equipo 86) y localía. Solo sigue encuentros dentro de las dos horas previas y seis posteriores al horario confirmado. Rechaza cambios de fecha, fichas ajenas, fases desconocidas y partidos suspendidos. No deduce el inicio o final por el reloj.

Para goles exige que los eventos acreditados coincidan con el marcador de ambos equipos. Usa el jugador explícito y no inventa nombres si faltan. Las correcciones de marcador a la baja pueden generar «Marcador corregido». No son avisos oficiales del club: dependen de la fuente disponible.

Cada partido guarda una referencia de fase e incidencias y una cola con caducidad de tres minutos. El primer sondeo a mitad de partido establece una referencia sin repetir el histórico; tampoco reproduce todo lo perdido tras más de cinco minutos sin sondeos. Un móvil recién activado no recibe incidencias anteriores a su alta. Cambios de fase e incidencias se deduplican por dispositivo y en IndexedDB del receptor; reintentos de red no deben repetir el mismo aviso. No se fusionan goles distintos en un mismo topic push.

Las suscripciones antiguas siguen recibiendo los avisos de Liga compatibles. Los nuevos eventos y Champions requieren abrir 3.28.0 para actualizar el receptor y registrar su capacidad. No hay que renovar claves ni reinstalar.

## Servicio y privacidad

Worker madridista-alineaciones, Durable Object SQLite privado y cron cada minuto. VAPID privado como secreto; ninguna clave privada o suscripción en GitHub, JSON público o documentación. Registro limitado a 50 dispositivos, origen de la app, cuerpo limitado y endpoints push validados. No expone listas de suscripciones ni una ruta pública para enviar avisos arbitrarios. Los endpoints 404/410 se eliminan.

Web Push cifra mensajes. fetch usa redirect manual y rechaza redirecciones; el diagnóstico omite URLs y claves. El permiso y el aviso de activación se confirmaron en un móvil real antes de esta ampliación; las incidencias nuevas se comprueban con secuencias simuladas hasta observar un partido real.

## Verificación y despliegue

Desde notifications: npm ci, npm test y wrangler deploy --dry-run. Desde la raíz: node --test test_push_client.cjs test_push_receiver.cjs. Pruebas de fases, goleadores/marcadores, expulsiones, históricos, VAR, cola/reintento, persistencia y alta/baja. CI valida esas suites. Desplegar con las claves existentes y publicar la app; comprobar Pages y abrir la nueva versión en el móvil. El reloj del equipo no decide fases deportivas.

Fuentes técnicas: [Web Push](https://web.dev/articles/push-notifications-overview), [web-push](https://github.com/web-push-libs/web-push), [Cloudflare Workers](https://developers.cloudflare.com/workers/).
