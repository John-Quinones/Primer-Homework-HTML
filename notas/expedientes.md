# Módulo de expedientes

Leer primero; mapa para no releer todo (regla de John, 19/10/2026).

- Servidor: `juanmaapp/src/records.js` (rutas `/cases`, `caseOut`); enlace: `public/demo-backend.js` (POST/PUT `/cases`). Columnas en `src/db.js` `migrate()`.
- Pantalla: formulario `#case-dialog` en `public/index.html`; `openCaseDialog`, guardado, `renderCaseRows` (filtros) y ficha (`factRow`) en `public/app.js`.
- Calidad del cliente (`cases.client_role`): se elige marcando una casilla (`#role-chips`, `renderRoleChips`); el `<select name="client_role">` oculto guarda el valor. Roles por tipo de proceso en `src/case-meta.js` (`PARTY_ROLES`).
- Curador ad-litem (v2.61): `cases.ad_litem` (0/1, casilla en el formulario, fila en la ficha, filtro «Solo curaduría ad-litem» `#case-adlitem`). Opcional, 0 en lo existente. Prueba: `test/v261-afiliado-curador.test.js`.
- `cases.affiliated` (del expediente) sigue existiendo; desde 2.61 «afiliado» también está en el cliente (`clients.affiliated`).
