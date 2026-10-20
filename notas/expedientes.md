# Módulo de expedientes

Leer primero; mapa para no releer todo (regla de John, 19/10/2026).

- Servidor: `juanmaapp/src/records.js` (rutas `/cases`, `caseOut`); enlace: `public/demo-backend.js` (POST/PUT `/cases`). Columnas en `src/db.js` `migrate()`.
- Pantalla: formulario `#case-dialog` en `public/index.html`; `openCaseDialog`, guardado, `renderCaseRows` (filtros) y ficha (`factRow`) en `public/app.js`.
- Calidad del cliente (`cases.client_role`): (v2.62) no se pregunta el rol: John marca la parte del proceso donde está el cliente (casillas `#role-chips` = Demandantes/Demandados…, `renderRoleChips`); el `<select name="client_role">` oculto guarda el rol (el primero de esa parte). Roles por tipo de proceso en `src/case-meta.js` (`PARTY_ROLES`).
- Curador ad-litem (v2.61): `cases.ad_litem` (0/1, casilla en el formulario, fila en la ficha, filtro «Solo curaduría ad-litem» `#case-adlitem`). Opcional, 0 en lo existente. Prueba: `test/v261-afiliado-curador.test.js`.
- `cases.affiliated` (del expediente) sigue existiendo; desde 2.61 «afiliado» también está en el cliente (`clients.affiliated`).
- Roles por proceso (v2.64): `PARTY_ROLES` en `src/case-meta.js` — judicial Demandante/Demandado; ejecutivo Ejecutante/Ejecutado; conciliación Convocante/Convocado (categoría o tipo con «concili»); petición Peticionario; penal Denunciante, Denunciado, Víctima, Indiciado, Acusado, Procesado. Querellante/Querellado/Defendido siguen aceptados (`LEGACY_PARTY_ROLES`) pero ya no se ofrecen. «Cliente afiliado» y «curadores ad-litem» están dentro del cuadro «Partes del proceso», junto a las casillas de la parte del cliente.
