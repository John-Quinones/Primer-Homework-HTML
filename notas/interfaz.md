# Interfaz

- Textos en español de Colombia. Colores de marca: azul oscuro `#002b6a`, azul `#027cc6`, plata `#989795`, plata clara `#c4c8cb`.
- Botones: neumorfismo en pantallas claras y vidrio esmerilado (glassmorphism) en zonas oscuras.
- Atrás/Adelante al pie de cada pantalla y en cada ventana emergente; nunca en la barra de arriba.
- Lo seleccionado (campo, pestaña, sección) se sombrea suave.
- Versión visible en tres lugares: sello en el ingreso, ventana «Novedades de la versión» al entrar a una versión nueva y línea al pie del menú.
- Efectos de movimiento (fundido, ampliación, desenfoque) dependen de Pantalla → Efectos, no de la configuración de animaciones de Windows: John las tiene apagadas.
- Nada se abre con un clic suelto: solo con botones «Ver …». Todo borrado pregunta antes.
- Nunca mostrar datos inventados (casos, actuaciones, sentencias). Si algo necesita internet o correo y no está disponible, decirlo en pantalla.
- Inicio: recuadro «Últimos movimientos» (15 últimas entradas de la Bitácora vía GET /audit?recent=1; con permiso audit.view ve todo, sin él solo lo propio) junto a «Próximas audiencias y vencimientos», que se mantiene.
- Inicio: banda de pestañas Clima / Emisoras / Noticias dentro del recuadro azul (v2.2.7, propuesta D que John eligió el 23/10/2026). Datos gratis desde el servidor: `src/banda-inicio.js` (Open-Meteo para Ibagué, caché 30 min; feeds RSS de Rama Judicial, Corte Suprema, Consejo de Estado y Ámbito Jurídico, caché 60 min; los URL de los feeds no se pudieron verificar desde el contenedor, sin internet: si una fuente no responde se ve el aviso y el botón a su sitio). Emisoras = enlaces en pestaña nueva (lista `BANDA_EMISORAS` en `public/app.js`). El enlace de pruebas no sale a internet: allí solo cargan las emisoras.
