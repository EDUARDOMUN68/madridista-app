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
