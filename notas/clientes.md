# Módulo de clientes

Para no releer todo el código cada vez (regla de John, 19/10/2026). Leer esta nota primero.

## Dónde está
- Reglas de limpieza (una sola lógica, servidor y enlace): `juanmaapp/src/record-rules.js` (`CLIENT_TEXT_FIELDS`, `clientValues`, `homePlace`, `genderFromName`).
- Servidor: `src/records.js` (`CLIENT_FIELDS`, rutas `/clients`); columnas en `src/db.js` `migrate()` (`add("clients", …)`).
- Enlace de pruebas: `public/demo-backend.js` (`clientValues` usa las mismas reglas; los clientes viejos sin un campo nuevo lo leen vacío, sin migración).
- Pantalla: formulario `#client-dialog` en `public/index.html` (grupo `data-pt="natural"` solo persona natural, `data-pt="juridica"` empresa); `openClientDialog` y el guardado en `public/app.js`; ficha con `row(...)` y `factRow(...)`; ayuda por campo en `public/help.js` (`client.<campo>`).
- Plantillas: `{{cliente.*}}` en `src/templates.js` y en `demo-backend.js` (las dos), lista de marcadores en `src/templates-seed.js` `VARIABLES`.

## Lugares
- Lista oficial DANE (DIVIPOLA): `public/data/divipola.json` (33 departamentos, 1.121 municipios). Nombres oficiales con `canonicalDepartment`/`canonicalCity` (`src/place-rules.js`).
- Buscador: `public/combo.js`. Un `<input data-combo="dep">` y otro `data-combo="city" data-dep="[name=…]"` quedan con buscador sin tildes (una letra = empiezan con ella) por `wirePlaces`.

## Campos
- Residencia: `department`, `city` (por defecto Ibagué, Tolima, v2.53).
- Lugar de expedición de la cédula (v2.56): `id_department`, `id_city`; opcional, sin valor por defecto, vacío para persona jurídica. Marcadores `{{cliente.expedicion}}` («Ibagué (Tolima)»; Bogotá sola), `{{cliente.expedicion_ciudad}}`, `{{cliente.expedicion_departamento}}` (`idPlaceVariables` en `src/case-meta.js`). Azure hace copia de la base antes de crear las columnas.
- Pruebas: `test/v2-logica-unica.test.js` (servidor = enlace) y `test/v256-lugar-expedicion.test.js`.

- Afiliado y residencia (v2.61): `clients.affiliated` (0/1, casilla en el formulario, fila «Afiliado» en la ficha; `clientValues` en `record-rules.js`). Formulario: «Residencia: departamento / ciudad». Ficha: «Cédula expedida en» y «Residencia» (`residence()` y `idPlace()` en `app.js`), siempre visibles («Sin indicar»). Prueba: `test/v261-afiliado-curador.test.js`.

- Archivo de clientes (v2.94, pedido de John 23/10/2026): `clients.archive_status` ('' = activo, 'Archivo provisional', 'Archivo definitivo'); columna con valor por defecto, sin migrar filas, copia previa `antes-v2.87` en `src/db.js`. `PUT /clients/:id/archive` (permiso `clients.write`; `clientArchive` en `record-rules.js`), mismo en `demo-backend.js`. Pantalla: `#client-archive` (Clientes activos / provisional / definitivo, vistas excluyentes), `archiveButtons`/`archiveBadge`/acción `archive-client` en `public/app.js` (definitivo, o con expedientes activos, pide confirmar; no toca expedientes). Reemplaza la lógica de 2.71 (estado deducido de los expedientes). Inicio: `#kpi-clients` solo activos y `#kpi-success` «Clientes con Casos de Éxito!» (`[data-archive-view]` abre Clientes en esa vista). Los buscadores de otros módulos siguen viendo a todos los clientes. Prueba: `test/v287-archivo-clientes.test.js`.

- v2.95 (reglas de John 23/10/2026): archivo definitivo (enviar o sacar) solo Gerencia (servidor 403 en `PUT /clients/:id/archive`, botones y opción del formulario según `isGerencia()`); buscadores de otros módulos con `activeClients()` (`public/app.js`; conserva el cliente ya elegido); `#client-dialog` trae «Estado del cliente» (`archive_status`, se guarda con `PUT .../archive` tras el cliente); búsqueda «Cédula expedida en» (`by=idplace` en `clientMatches`). Importar: columna «Estado del cliente» (`client.archive_status`, `archiveState` en `importer.js`), nuevos toman el estado, existentes solo en modo «actualizar»; la tarjeta Clientes descarga filtrado por estado y lugar de expedición.

- v2.98 (pedido de John 23/10/2026): cuarto estado «Pendiente Pago Sentencia» (`PPS` en `src/case-meta.js`, `statusFrom`/`normStatus`; el cliente lo guarda en `archive_status`, `CLIENT_ARCHIVE_STATES`). Sin columna nueva ni migración. Es solo del cliente/expediente: no cuenta como activo ni como «Casos de Éxito»; `activeClients()` lo oculta de los buscadores de otros módulos. Inicio: `#kpi-pps-tile` (`data-case-status` abre Expedientes con ese estado). Importar: `archiveState` e `IMP.archiveState`, aviso `#import-state-warnings`.
- v2.101 (elección de John 23/10/2026, propuesta «C»): el estado del cliente se cambia con `clientStateSelect(c)` (`[data-client-state]`, `changeClientState`) en `public/app.js`; reemplaza los botones `archive-client` de la 2.94. Mismas reglas: definitivo solo Gerencia, aviso si hay expedientes activos.

- Orden (v2.2.17): clientes se listan por la carpeta más baja de sus expedientes (`clientsByFolder`); ver notas/expedientes.md.

- Eliminar cliente (v2.2.34, pedido de John 23/10/2026, solo Gerencia `clients.delete`): `GET /clients/:id/deletion` → `{expected, blockers}` y `DELETE /clients/:id` con `{confirm}` (nombre del cliente). Reglas en `deletionPlan`/`checkDeletion` (`src/record-rules.js`, una sola copia). Se bloquea (409) si tiene expedientes, cobros o recibos; copia previa `backupBeforeReceiptDelete(db, "antes-de-borrar-cliente")`; la bitácora guarda los campos (`deletedFields` en `src/audit.js`); en el enlace va a `deleteTrash`. UI: `confirmDeletion` en `public/app.js`. Prueba: `test/v2234-eliminar.test.js`.

- Teléfonos adicionales (v2.2.39, pedido de John 25/10/2026): `clients.extra_phones` (texto JSON `[{label, phone}]`, vacío por defecto; columna nueva con copia previa `antes-v2.2.39` en `src/db.js`). Limpieza en `extraPhones()` de `src/record-rules.js` (misma en servidor y enlace): formato `properPhone`, sin repetidos, máximo 10; si la petición no trae `extra_phones` se conserva lo guardado. `extraPhoneList(c)` en `src/person.js` (también la usa el buscador `clientMatches`). Pantalla: `#extra-phones` + `#add-extra-phone` en `#client-dialog`, `extraPhoneRow`/`extraPhonesOf`/`extraPhoneRows` en `public/app.js`. El teléfono principal `phone` no cambió (plantillas, WhatsApp, firmas). Prueba: `test/v2239-telefonos-adicionales.test.js`.
