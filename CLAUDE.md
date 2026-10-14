# Project memory — JuanMaApp (TEC Jurídicos)

The app lives in `juanmaapp/`. The other files at the root are unrelated homework.

## Who and how
- Client: TEC Jurídicos, Colombia; main office Ibagué (Tolima). The app name "JuanMaApp" may change later.
- Talk to the user in Spanish. UI text is Spanish (Colombia); code and comments are English.
- Brand: navy `#002b6a`, blue `#027cc6`, silver `#989795`, light silver `#c4c8cb`; "T" column logo (`public/logo-t.png`). Layout follows appbogado.app with these colors.
- Drafting engine: `prompts/nomosai-system-prompt.md` (NomosAI: no AI clichés, `[FILL: …]` markers, audit footer, Bold link, e-signature block, JSON payload). `src/validate.js` enforces it.

## Never
- Never show invented data (fake cases, judgments, actuaciones). If something needs the internet or e-mail and is not available, say so in the UI.
- Never reset the user's stored data. Data structure changes are migrations (`src/db.js` `migrate()`, `public/demo-backend.js` `migrate()`); the browser storage key in `public/web-store.js` never changes.

## Shape
- Server: Node 22, Express 5, `node:sqlite`, tests with `npm test` (node --test). Every feature exists twice: server routes in `src/` and the same routes in `public/demo-backend.js` for the published link. Shared pure logic is in `src/case-meta.js`, `src/ledger.js`, `src/validate.js`, served to the page as `/shared.js` (`src/browser-module.js`).
- Published link: `npm run preview` → `preview/juanmaapp-web.html`, published as a claude.ai artifact with capabilities `{downloads: true, db: {}, sample: {}}` (data in the artifact database, NomosAI through the viewer's Claude account). Republish to the same artifact so the link and its data stay.
- Deployment: `render.yaml` at the repo root + `juanmaapp/Dockerfile`; guide in `juanmaapp/DESPLIEGUE.md`.
- Permissions: `src/auth.js` (`PERMISSIONS`, `DEFAULT_MATRIX`); new permissions reach built-in roles once via `known_permissions`.

## Modules done
Clients, cases (status Activo / Archivo provisional / Archivo definitivo; client's procedural role; affiliated yes/no), process catalog with two levels of sub-processes and custom fields, users/roles/offices with per-user permissions, Excel import from Access, DIVIPOLA type-ahead, court directory, agenda with reminders, Rama Judicial consultation with reports at 7/13/17 h, documents (templates + NomosAI), case law (official sites only), reports to Excel/PDF, e-signature, traced e-mail, payments (charges, installments, receipts, portfolio aging, reminders).

## Asked for, not started
Funcionarios module, flyer creation, video creation.
