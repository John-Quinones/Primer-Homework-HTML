# Rendimiento (lentitud de la App)

- Medir con una base local sembrada (512 clientes, 200 expedientes, 600 tareas), Playwright y `Emulation.setCPUThrottlingRate` ×4. Nunca con la base real.
- Lo ya hecho en 2.2.94: compresión, caché de `/vendor` e imágenes, el chat deja de consultar con la pestaña oculta.
- 2.3.15: la causa más grande era el reposo. `mony-face.js` (WebGL) dibuja ~25 cuadros/s en reposo y `wake()` no escanea si el ciclo ya corre; `chat-page.js` solo escribe en el DOM si el valor cambió (`setHidden/setText/setHtml/setClass/setCss`). Cualquier escritura repetida de `hidden`/clases en `body` dispara recálculos de estilo de toda la pantalla (hay selectores `:has()` en `hud.css` y `styles.css`).
- Las tareas de la Agenda usan `content-visibility: auto`. Las filas de tabla no admiten `content-visibility`; si Expedientes crece mucho, paginar.
- Pendiente (más grande): cargar bajo demanda pdf-lib, jspdf, html2canvas y membrete-assets (la pantalla de ingreso descarga ~1,7 MB); Agenda pide `/tasks` dos veces; cada pantalla vuelve a pedir clientes/expedientes.
