# Mony, asistente jurídico (versión 2.2.8)

- Nombre visible «Mony» (decisión de John, 23/10/2026); configurable con `MONY_NAME`.
- Archivos: `juanmaapp/src/mony.js` (prompt, tools, bucle), `juanmaapp/src/terms.js` (calendario judicial), ruta `POST /api/mony/chat` en `src/app.js`, vista `#mony` en `public/app.js`/`index.html`. Prueba: `test/v2-2-8-mony.test.js` (SDK simulado, sin créditos).
- Modelo: `MONY_MODEL`, por defecto `claude-haiku-5-5` (regla de costos; los claude-3-x están retirados). Para análisis más fino usar `claude-sonnet-5-5`. Consumo anotado como «Mony (asistente)» en Configuración → Consumo de IA.
- Tools (todas de SOLO LECTURA): `consultar_estado_proceso` (Rama Judicial real, por radicado o `caso_id`; permiso `processes.consult`), `calcular_terminos_legales` (código, sin IA), `redactar_plantilla_memorial` (trae plantilla de la firma + datos del expediente; permiso `drafts.generate`; no guarda nada). Si una tool falla, el bucle la devuelve con `is_error` y Mony debe decirlo; nunca inventar.
- Bucle: máximo 6 rondas; maneja `tool_use`, `pause_turn`, `max_tokens`, `refusal` y tope de rondas.
- Seguridad: la página manda solo texto de usuario/asistente (máx. 20 mensajes); el servidor ignora bloques de herramientas y roles `system`. Cada tool respeta el alcance de oficina del usuario. Respuesta pintada como texto plano (sin HTML). Clave `ANTHROPIC_API_KEY` solo en el servidor.
- Calendario judicial (`terms.js`): no cuentan sábados, domingos, festivos (Ley 51/1983, Emiliani, Semana Santa) ni vacancia 20 dic–10 ene (se puede desactivar, p. ej. tutela). El conteo empieza el día siguiente a la fecha dada. El abogado confirma siempre contra el calendario del despacho.
- El enlace de pruebas no llama APIs externas: la vista muestra un botón a la App de Azure (como Jurisprudencia).
- Pendiente (no hecho): tools que escriban (crear tarea, guardar borrador) con botón de confirmación; subir PDF de providencia; historial en el servidor (hoy por usuario en el navegador).

- v2.2.9: etiquetas de estado por herramienta (running/ok/error) y tarjetas de acción (`cardFor` en mony.js: término con cuenta regresiva, abrir expediente, descargar borrador .txt). Las tarjetas no ejecutan nada por sí solas. Paleta del chat: #0F172A + cian.

- v2.2.10: avatar de Mony = `public/mony-avatar.webp` (rostro de partículas luminosas; imagen elegida por John, 23/10/2026). Regla de John: NO cambiar los colores de la App; solo el agente Mony usa la paleta #0F172A + cian.

- v2.2.11: clic en el rostro lo amplía (dialog #mony-zoom); avatar reescalado a 560 px en WebP (fuente original 339×204; pedir a John una imagen mayor para más nitidez). Seguimiento de cabeza: por ahora puntero; cámara después (decisión de John 23/10/2026, local y opcional).
