# Módulo de importar

Leer primero; mapa para no releer todo (regla de John).

- Pantalla `#importar` (`renderImportar` y bloque «Importar» en `juanmaapp/public/app.js`; HTML `#view-importar` en `public/index.html`). Lógica de columnas, dedupe y alta en `public/importer.js` (`window.JuanmaImport`: `guessAll`, `buildRecord`, `run`, `plan`).
- v2.80 (pedido de John 23/10/2026): tres tarjetas arriba (`IMPORT_KINDS` en `app.js`): Clientes, Expedientes, Despachos. Cada una: «Plantilla vacía», «Descargar datos actuales» (`downloadImportKind`, Excel con `writeXlsxFile`) y «Subir Excel» (`uploadImportKind`). Clientes y Expedientes suben por el flujo de siempre (columnas, vista previa, «Importar») precedido de un resumen sin escribir (`IMP.plan`: nuevos / ya existen). Despachos usa `readCourtRows` + `importCourtRows` (`POST /courts/import`, la misma carga del módulo Despachos).
- Decisión de John: se sube el ARCHIVO, no un enlace de OneDrive (el enlace exige permisos de Microsoft, puede vencer; la página publicada no puede bajar archivos de otro dominio por CORS). El Excel descargado se puede editar y volver a subir.
- Reglas de datos reales: nada se borra ni sobrescribe; cliente existente (documento o nombre) solo completa vacíos; expediente igual (radicado, cliente+carpeta o cliente+asunto) se omite; despacho existente se actualiza sin borrar correo. Prueba: `test/v276-import-plan.test.js`.
