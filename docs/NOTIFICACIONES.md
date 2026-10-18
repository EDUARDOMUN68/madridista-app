# Avisos de alineación del Real Madrid — 3.25.1

Servicio desplegado y configurado con cron cada dos minutos. La app registra el dispositivo después del permiso inicial; la entrega real en el móvil requiere comprobación adicional.

## Funcionamiento

- Solo LaLiga y el Real Madrid en esta primera entrega. Champions queda pendiente.
- Un servicio de Cloudflare Workers revisa cada dos minutos el calendario publicado. Solo consulta fichas de partidos con horario confirmado que comienzan en las dos horas siguientes.
- Resuelve la ficha por fecha, hora, localía y equipo 86. No usa identificadores históricos sin contrastarlos. Rechaza encuentros iniciados, finalizados o reprogramados respecto del calendario.
- Envía cuando el Madrid tiene once jugadores únicos señalados explícitamente como titulares. No equivale a una convocatoria ni garantiza que la fuente publique exactamente una hora antes.
- Web Push cifra el mensaje. Las claves privadas VAPID se guardan como secretos del servicio. Las suscripciones y el registro de avisos permanecen en almacenamiento privado de un Durable Object SQLite; no se guardan en el repositorio ni en el JSON público.
- Un dispositivo registrado y activado recibe los avisos, con interruptor en la campana de la cabecera. El primer permiso requiere pulsación y confirmación del navegador; ningún sitio puede concedérselo por el usuario.
- El receptor usa IndexedDB y un tag por partido para no repetir un aviso reenviado. No se promete entrega infalible: red, permisos y sistema operativo pueden impedirla. El TTL termina al inicio, evitando avisos antiguos al reconectar.
- Al tocar el aviso se abre la alineación del partido en Jornada. Al finalizar se detiene el seguimiento del servicio para ese encuentro. La app puede permanecer cerrada y el ordenador apagado.

## Configuración y activación

1. Crear una cuenta de Cloudflare y completar personalmente sus condiciones y verificaciones.
2. Desde `notifications/`, instalar con `npm ci` y autorizar Wrangler en esa cuenta. Usar Workers Free con Durable Objects SQLite; no activar un plan de pago para esta integración.
3. Generar el par VAPID mediante `web-push`. Introducir `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` como secretos con `wrangler secret put`, sin escribirlos en archivos públicos ni en mensajes. La clave pública se sirve por `/config`; la privada nunca sale del servicio.
4. Ejecutar `wrangler deploy`, comprobar el Worker y su cron, y poner su URL HTTPS en `push-config.js`. La URL no es un secreto. No configurar la URL antes de verificar el servicio.
5. Revisar/publicar la app 3.25.1 con esos recursos, abrirla en el móvil y aceptar el permiso. Confirmar registro y comprobar la recepción real con la app cerrada antes de dar la función por terminada.

La cuenta y la autorización de despliegue están configuradas. Las claves VAPID se guardan como secretos del Worker. El usuario confirma permiso ya concedido; falta comprobar físicamente la recepción en su móvil.

## Verificaciones

`cd notifications && npm test` comprueba horario Madrid y horario de invierno, exclusión de Champions/históricos, onces completos, identidad de ficha, endpoints push, cifrado, deduplicación persistente y borrado de endpoints 410. `node --test test_push_receiver.cjs`, desde la raíz, comprueba filtrado y deduplicación del receptor con almacenamiento simulado. `wrangler deploy --dry-run` valida el paquete sin desplegar.

El servicio limita a 50 dispositivos, acepta registros desde el origen de la app, valida servidores push conocidos y limita el tamaño de las peticiones. No expone un listado de suscripciones ni un endpoint público para disparar avisos. Una respuesta 503/429 se reintenta en otro ciclo; una 404/410 elimina la suscripción. Una entrega de red incierta puede reenviarse; el receptor la filtra por partido.

Fuentes técnicas: [Web Push](https://web.dev/articles/push-notifications-overview), [web-push](https://github.com/web-push-libs/web-push), [Workers Free y Durable Objects SQLite](https://developers.cloudflare.com/workers/platform/pricing/).

Al registrar un móvil nuevo, el servicio envía un único aviso de confirmación «Avisos del Madrid activados». También se filtran reenvíos de esta confirmación. El permiso y la recepción física deben confirmarse en el dispositivo; una respuesta satisfactoria del servidor push no acredita por sí sola que Android haya mostrado el aviso.

El registro espera confirmación del receptor actualizado del service worker. Muestra su estado también con permiso ya concedido y recupera el aviso inicial si el receptor no lo recibió, con espera entre reintentos y deduplicación local. La respuesta del servidor distingue un fallo del envío de prueba.

Compatibilidad Workers: los envíos usan fetch con redirect manual. Los 3xx se consideran fallos y no se siguen, manteniendo el envío en el endpoint validado. Los registros de error omiten endpoints y claves.

### Control compacto de avisos — 3.27.0

Campana junto a actualizar: activa/desactiva avisos por dispositivo y recuerda la elección local. Usuarios con permiso previo continúan activos hasta desactivarlos. En dispositivos nuevos se pide permiso solo al tocar la campana. La baja cancela primero la suscripción del navegador y después intenta borrar el registro del servicio; si la red falla, el endpoint cancelado deja de recibir y se depura al responder 410. Los errores se indican en la campana con reintento; confirmaciones breves sin recuadro permanente. Cabecera con Datos y Directo, sin la línea Comprobado duplicada.
