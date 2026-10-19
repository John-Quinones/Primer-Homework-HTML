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
