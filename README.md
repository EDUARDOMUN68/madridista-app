Versión actual de la interfaz: **3.23.0**.

# Madridista App v3

Cambios de esta versión:
- Filas de partidos y resultados más compactas: Liga/Champions queda mucho más cerca del rival.
- Clasificación de LaLiga coloreada por zonas:
  - Champions
  - Europa League
  - Conference League
  - Descenso
- Clasificación de Champions preparada con colores:
  - 1.º–8.º: octavos directos
  - 9.º–24.º: playoff
  - 25.º–36.º: eliminados
- Leyenda visual de colores en ambas clasificaciones.
- El Real Madrid sigue resaltado con una marca dorada.
- Las zonas están definidas también en real_madrid.json para poder cambiarlas sin rehacer toda la app.

Nota: las plazas europeas de LaLiga pueden desplazarse por Copa del Rey o por cupos UEFA adicionales.


## v4
- Botón ↻ junto a la fecha de actualización.
- Al pulsarlo fuerza una nueva lectura de `real_madrid.json`, ignorando la caché.
- Muestra un aviso cuando los datos se han recargado.
- El service worker prioriza siempre la versión online del JSON y usa la caché solo como respaldo.
- Preparada para combinar este botón con GitHub Actions: la automatización actualizará el JSON y el botón permitirá pedir la versión más reciente al instante.

## Recuperación de resultados pendientes

El actualizador conserva las 38 jornadas completas ya publicadas si la página oficial de LaLiga no responde. Refresca los estados y marcadores pendientes mediante consultas diarias y traslada los finales del catálogo al calendario del Real Madrid, conservando la TV. Los goleadores siguen requiriendo un desglose acreditado que coincida con el marcador.

## Versión 3.22.2 — 11 de octubre de 2026

- Versión visible bajo el nombre Madridista, independiente de la fecha de los datos.
- Escudo del Real Madrid en cabecera, favicon e iconos instalables de 192 y 512 píxeles. Fondo blanco y margen seguro en el icono maskable. Recurso del equipo servido por ESPN: https://a.espncdn.com/i/teamlogos/soccer/500/86.png.
- Columnas de goleadores vacías cuando un equipo no marca, sin el texto «Sin goles».
- Manifest e iconos versionados; caché 3.22.2. Algunos sistemas renuevan el icono instalado con retraso.


## Detalle de LaLiga — 3.23.0

En Jornada, los partidos de LaLiga en directo y finalizados permiten abrir un diálogo con Resumen (goles, tarjetas y cambios por tiempos) y Estadísticas de equipo. Consulta bajo demanda el resumen de ESPN, comprueba ambos equipos y resuelve el identificador por marcador diario cuando el catálogo oficial no lo aporta. Mientras permanece abierto se consulta cada 60 segundos; se detiene al cerrar o recibir un final y se pausa en segundo plano. Muestra carga, ausencia de datos y reintento con aviso si conserva una respuesta anterior. Champions no incorpora esta interacción todavía.

Los módulos match-detail.js y match-detail.css están incluidos en la caché 3.23.0; no modifican marcadores ni datos deportivos persistidos. Diálogo con cierre, Escape, teclado y pestañas accesibles.
