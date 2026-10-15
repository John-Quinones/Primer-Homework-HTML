# Project memory — TecjuridicosApp (formerly JuanMaApp; TEC Jurídicos)

The app lives in `juanmaapp/`. The other files at the root are unrelated homework.

## Who and how
- Client: TEC Jurídicos, Colombia; main office Ibagué (Tolima). The app is named "TecjuridicosApp" (renamed from JuanMaApp in change 18); internal identifiers (folder juanmaapp, Azure juanmaapp-tec, window.Juanma*, storage keys) keep the old name on purpose.
- Talk to the user in Spanish. UI text is Spanish (Colombia); code and comments are English.
- Brand: navy `#002b6a`, blue `#027cc6`, silver `#989795`, light silver `#c4c8cb`; "T" column logo (`public/logo-t.png`). Layout follows appbogado.app with these colors.
- Drafting engine: `prompts/nomosai-system-prompt.md` (NomosAI: no AI clichés, `[FILL: …]` markers, audit footer, Bold link, e-signature block, JSON payload). `src/validate.js` enforces it.

## Never
- Never show invented data (fake cases, judgments, actuaciones). If something needs the internet or e-mail and is not available, say so in the UI.
- Never reset the user's stored data. Data structure changes are migrations (`src/db.js` `migrate()`, `public/demo-backend.js` `migrate()`); the browser storage key in `public/web-store.js` never changes.

## Shape
- Server: Node 22, Express 5, `node:sqlite`, tests with `npm test` (node --test). Every feature exists twice: server routes in `src/` and the same routes in `public/demo-backend.js` for the published link. Shared pure logic is in `src/case-meta.js`, `src/ledger.js`, `src/validate.js`, served to the page as `/shared.js` (`src/browser-module.js`).
- Published link: `npm run preview` → `preview/juanmaapp-web.html`, published as a claude.ai artifact with capabilities `{downloads: true, db: {}, sample: {}}` (data in the artifact database, NomosAI through the viewer's Claude account). Republish to the same artifact so the link and its data stay.
- Deployment: chosen for testing = Azure App Service free F1 (`juanmaapp/AZURE.md`, `.github/workflows/azure-juanmaapp.yml`, DB in `/home/data`). Alternative: Render (`render.yaml`, `Dockerfile`, `DESPLIEGUE.md`). Sign-in with Microsoft 365 via `src/microsoft.js` (MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET).
- Azure publishes ONLY when the user asks: put [azure] in that commit message (workflow gate). Otherwise publish only the test link (artifact).
- Every published change is numbered (Cambio N = commits touching juanmaapp/); tell the user the number and add a row to `juanmaapp/CAMBIOS.md` in the same commit. Republish the artifact and let CI deploy to Azure on each change.
- Firm's server Excel export (AREA, FECHA DE CREACIÓN, TIPO DE PROCESO, ACTUACIONES, CIUDAD, ESTADO 1/2, RADICADO, No. CARPETA, DESPACHO JUDICIAL, HONORARIOS, PAGOS) is recognized by `public/importer.js` `guessAll`. Open questions to the user: which column holds the client name; whether ESTADO 2 is archivo definitivo or provisional.
- Permissions: `src/auth.js` (`PERMISSIONS`, `DEFAULT_MATRIX`); new permissions reach built-in roles once via `known_permissions`.
- Only Gerencia deletes (change 24): `GERENCIA_ONLY` perms in `src/auth.js`, every DELETE refused for other roles (server `requireAuth`, demo `request`), delete buttons hidden by the `is-gerencia` body class. Every delete asks with `confirmAsk`.
- Folder number = custom field "No. Carpeta" (`isFolderField`/`caseFolder` in `public/app.js`), shown on case cards, the case dialog title and the Carpeta column of Expedientes.

## Modules done
In-app help (`public/help.js`: "?" per module, examples and tips per field). Clients, cases (status Activo / Archivo provisional / Archivo definitivo; client's procedural role; affiliated yes/no), process catalog with two levels of sub-processes and custom fields, users/roles/offices with per-user permissions, Excel import from Access, DIVIPOLA type-ahead, court directory, agenda with reminders, Rama Judicial consultation with reports at 7/13/17 h, documents (templates + NomosAI), case law (official sites only), reports to Excel/PDF, e-signature, traced e-mail, payments (charges, installments, receipts, portfolio aging, reminders).

## Asked for, not started
Funcionarios module, flyer creation, video creation.
