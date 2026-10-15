# TecjuridicosApp

Client, case and legal-draft manager for paralegals and attorneys. Drafts are written by the **NomosAI Engine** system prompt: Rights of Petition, Contracts and Powers of Attorney, with an e-signature block, an optional Bold payment section, and a JSON payload for downstream Python / Node.js services.

## Sections

| Section | What it does |
|---|---|
| **Inicio** | Dashboard: clients, active cases, saved judgments, process types; cases per process type; recent activity. |
| **Agenda** | Tasks, hearings (audiencias) and deadlines (términos) per case, grouped by day with overdue items first. Each has a responsible person and reminders 7, 3, 1 or 0 days before; reminders and overdue alerts appear in the bell, once each. |
| **Consulta de procesos** | Every case with a 23-digit radicado can be consulted in the Rama Judicial's Consulta Nacional Unificada de Procesos: manually (all or selected) or automatically at 7:00, 13:00 and/or 17:00 Colombia time. New actions (actuaciones) raise notifications and go into a report by e-mail and/or WhatsApp to each user, covering their assigned cases, all monitored cases of their offices, or the ones they select. |
| **Despachos** | Court directory loaded from the Rama Judicial's official directory file (.xlsx/.csv): filter by department, city/municipality and area (Laboral, Civil, Familia…) with e-mail and phone. The case form uses it to pick the court and show its e-mail. |
| **Clientes** | Create, search, edit and delete clients (name, ID type and number, email, phone, address, city, notes). Each client shows their cases. |
| **Expedientes** | A case links a client to a sub-process (e.g. Laboral › Ejecutivo Laboral) and stores subject, counterparty, facts, the category's custom fields, the court and radicado. **Estado:** Activo, Archivo provisional or Archivo definitivo (older statuses are migrated: Cerrado → Archivo definitivo, the rest → Activo). **Calidad del cliente** follows the process: Demandante/Demandado (Civil, Laboral, Familia, Administrativo…), Ejecutante/Ejecutado (any ejecutivo), Querellante/Querellado/Denunciante/Denunciado/Víctima/Defendido (Penal). **Cliente afiliado:** Sí/No. |
| **Firmas** | Electronic signature. *By link:* each signer gets a private link by e-mail, reads the document and signs with a 6-digit code sent to their e-mail (10 minutes, 5 attempts), typed name and drawn signature. *In person:* the signer signs on the office device, witnessed by the signed-in user. Every request stores the document's SHA-256, time, IP, browser and an audit trail; the result downloads as the signed PDF plus a signature certificate. |
| **Correo certificado** | E-mail with traceability: SHA-256 of the message and each attachment, the mail server's answer, first opening and a read receipt the recipient confirms with a button; downloadable proof in PDF. Legal "correo electrónico certificado" before third parties needs an accredited provider (Ley 527 de 1999); the module is ready to connect one. |
| **Pagos y cartera** | **Cobros:** one charge or a plan of installments (monthly, every 15 days or weekly) per client and optionally per case, with a Bold or other payment link. **Recibos de caja:** consecutive numbers (RC-000001…), payment method and reference, amount in words, PDF for the client; a receipt is voided, never deleted. A payment tied to an installment pays it first; the excess and unassigned payments pay the oldest open installments. **Cartera:** balance, overdue amount, days late, next due date and last payment per client; aging (al día, 1–30, 31–60, 61–90, more than 90 days); account statement in PDF. **Recordatorios:** by e-mail or WhatsApp from the server, or "Abrir en WhatsApp" with the message ready; automatic daily reminders at 8:00 (Colombia) N days before the due date and every N days while overdue. Reports "Cartera por cliente" and "Recibos de caja" export to Excel and PDF. |
| **Documentos** | **Plantillas:** a library of document templates by category (Contrato, Poder, Derecho de petición, Demanda, Tutela, Recurso, Memorial, Otro). Four starter templates ship with the app; the firm uploads its own Word (.docx) or text (.md/.txt) files or writes them in the editor, inserting `{{variables}}` (client, case, court, lawyer, office, date and the category's custom fields). Choose a case and the document fills itself; missing data is listed first and stays marked `[FILL: …]`. Download as Word (Word uploads keep their original formatting) or PDF, or hand the filled text to NomosAI. **Redactar con NomosAI:** contracts, powers of attorney, petitions and lawsuits (demandas) drafted by the model, optionally on top of a firm template. |
| **Jurisprudencia** | Search judgments of the Corte Constitucional, Corte Suprema de Justicia (every chamber), Consejo de Estado and tribunals; analyze one (legal problem, facts, ratio decidendi, decision, dissents, norms, verbatim quotes, summary); check every citation in a draft (does it exist, is the reference right, does it support what the draft says); save judgments to a case. Claude may only search and read the official court sites, and a result is marked verified only when its URL is one the tools actually returned from those sites. |
| **Reportes** | Expedientes (filter by office, process type, status, responsible, dates), clients, summary per office, workload per responsible, cases per process type, saved judgments. Each exports to Excel (.xlsx) and PDF, limited to the user's offices. |
| **Usuarios** | Gerencia creates users (name, email, role, offices, initial password, active), offices (Ibagué is the main one; any number can be added) and edits the role × permission matrix. |
| **Importar** | Load existing data exported from Access (or any spreadsheet) as `.xlsx` or `.csv`. Columns are matched automatically (Nombres + Apellidos are joined, IdCliente/Código are skipped) and can be reassigned. A file can hold clients only, or one case per row with the client's data on the same row. Existing clients are matched by document number or name and only their blank fields are filled; identical cases are not created twice; missing process types, sub-processes and custom fields can be created on the fly. Rows that fail are listed by row number. The firm's server export is recognized as is: AREA → process type, TIPO DE PROCESO → sub-process (matched to an existing one when the name is contained in it), FECHA DE CREACIÓN keeps the original date, ESTADO 1/2 → Activo/Archivo definitivo, RADICADO (dashes allowed; one that is not 23 digits is kept in its own field), CIUDAD and DESPACHO JUDICIAL (linked to the directory when the name matches), No. CARPETA and ACTUACIONES as fields of the case, HONORARIOS → a charge in Pagos and PAGOS → a receipt against it. Re-importing the same file creates nothing twice (same radicado, or same client, sub-process and folder). |
| **Configuración** | Reorder process types, sub-processes (drag or arrows, or "Ordenar por más usados" by number of cases) and custom fields; add second-order sub-processes under any sub-process (e.g. Ordinario Laboral › Con medidas cautelares). Manage process types (Administrativo, Laboral, Penal, Familia, Derecho de Petición, Datacrédito, or new ones), their sub-processes, and custom fields per type: text, long text, number, date, or a drop-down list, optionally required. |

Only Gerencia deletes (clients, cases, tasks, templates, catalog entries, saved judgments, offices, roles), and every deletion asks for confirmation first. Deleting a client or sub-process that still has cases is refused.

Department and city/municipality fields use the DANE DIVIPOLA list (33 departments, 1,121 municipalities; `public/data/divipola.json`, from the MIT-licensed `divipola` package) with type-ahead: typing "C" lists Caldas, Caquetá, Casanare, Cauca, Cesar, Chocó, Córdoba and Cundinamarca. A case's 23-digit radicado fills its department and city (its first five digits are the DANE municipality code).

### Users, roles and offices

Roles: Gerencia, Director Jurídico, Director Contable, Gerente Regional, Abogado, Dependiente Judicial, Asistente, plus any role Gerencia creates (optionally copying another role's permissions). Gerencia can also give a single user their own permission checklist instead of their role's. Each user belongs to one or more offices; every client and case belongs to an office and a case can have a responsible person from that office. Roles with **"Ve todas las oficinas"** see every office; the rest see only their own offices' clients, cases, saved judgments and reports. The starting permissions (editable in Usuarios › Roles y permisos):

| Permiso | Gerencia | Dir. Jurídico | Dir. Contable | Gerente Regional | Abogado | Dependiente Judicial | Asistente |
|---|---|---|---|---|---|---|---|
| Ve todas las oficinas | ✓ | ✓ | ✓ | | | | |
| Usuarios, roles y oficinas | ✓ | | | | | | |
| Configuración del catálogo | ✓ | ✓ | | | | | |
| Crear/editar clientes | ✓ | ✓ | | ✓ | ✓ | | ✓ |
| Eliminar clientes (solo Gerencia) | ✓ | | | | | | |
| Crear/editar expedientes | ✓ | ✓ | | ✓ | ✓ | ✓ | ✓ |
| Eliminar expedientes (solo Gerencia) | ✓ | | | | | | |
| Generar borradores | ✓ | ✓ | | ✓ | ✓ | | ✓ |
| Jurisprudencia | ✓ | ✓ | | ✓ | ✓ | ✓ | |
| Importar | ✓ | ✓ | | ✓ | | | |
| Plantillas (crear/cargar/editar) | ✓ | ✓ | | | | | |
| Reportes | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| Consulta de procesos | ✓ | ✓ | | ✓ | ✓ | ✓ | |
| Firma electrónica | ✓ | ✓ | | ✓ | ✓ | | |
| Correo con trazabilidad | ✓ | ✓ | | ✓ | ✓ | ✓ | |
| Pagos, recibos y cartera | ✓ | | ✓ | ✓ | | | ✓ |

On first start the app asks for the Gerencia account. Passwords are hashed with scrypt (minimum 10 characters); sessions are HttpOnly cookies that last 12 hours; five failed sign-ins lock an email for 10 minutes; every write must carry the `X-JuanMa` header (CSRF). The last active Gerencia account cannot be demoted or deactivated. Set `COOKIE_SECURE=1` when serving over HTTPS.

## Test link (no installation)

`npm run preview` writes `preview/juanmaapp-web.html`, the whole app in one page for the published claude.ai link, and `preview/juanmaapp-preview.html`, the same page to open from disk. There is **no sample data**: it starts with the Ibagué office, the process catalog and the starter templates, and asks for the Gerencia account.

- **Data** is kept by `public/web-store.js`: on the published link, in the link's own database (the same on every device that opens it, kept across updates of the app); opened from disk, in that browser. Updates migrate the stored data; they never reset it.
- **Real on the link:** clients, cases, catalog, users and roles, offices, agenda, templates, import from Excel, reports, in-person e-signature, payments, receipts and portfolio, and NomosAI drafting and judgment analysis (the text is pasted), which run on the viewer's own Claude account.
- **Needs the installed app:** Rama Judicial consultation, case-law search and citation checks on the official sites, e-mail (signature links and codes, traced e-mail, reminders and reports), automatic WhatsApp. The link says so instead of showing invented results.
- Sign-in on the link is choosing your user: passwords belong to the installed app.

## Run

```bash
cd juanmaapp
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # or `ant auth login`
npm start                              # http://localhost:3000
npm test                               # output validator tests
```

Requires Node.js 22.13 or newer; data is stored with Node's built-in SQLite.

Env vars: `PORT` (default 3000), `NOMOS_MODEL` (default `claude-opus-5-5`), `DB_PATH` (default `data/juanmaapp.db`).

Notifications and reports:

| Variable | Purpose |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE=1`, `MAIL_FROM` | E-mail delivery (nodemailer). |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATE`, `WHATSAPP_LANG` | WhatsApp Business Cloud API. Business-initiated messages need a template approved by Meta with one body parameter (the report text). |
| `TSA_URL` (and optional `TSA_USER`, `TSA_PASS`) | RFC 3161 Time Stamping Authority. Each traced e-mail's SHA-256 is stamped and the reply (.tsr) kept. An ONAC-accredited TSA gives the stamp full legal weight. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Text messages (SMS) through Twilio, used for e-signature OTP codes and links. Without them the SMS option says it is not configured. |
| `RAMA_API_BASE` | Rama Judicial CPNU API base (default `https://consultaprocesos.ramajudicial.gov.co:448/api/v2`). |
| `SCHEDULER=0` | Turn off reminders and scheduled reports (e.g. on a second instance). |

## How it works

| Piece | File |
|---|---|
| NomosAI Engine system prompt (prompt-cached) | `prompts/nomosai-system-prompt.md` |
| Database schema and starting catalog | `src/db.js` |
| REST API: clients, catalog, cases | `src/records.js` |
| Express app, `POST /api/generate` | `src/app.js` |
| Users, roles, offices, sessions | `src/auth.js` |
| Report data | `src/reports.js` |
| Departments, municipalities, areas, radicado → place | `src/places.js`, `public/data/divipola.json`, `public/combo.js` |
| Court directory | `src/courts.js` |
| Tasks, hearings, notifications | `src/agenda-routes.js` |
| Rama Judicial client, checks, reports, scheduler | `src/ramajudicial.js`, `src/monitor.js`, `src/monitor-routes.js`, `src/notify.js` |
| Claude call (streaming, effort `high`, server-side refusal fallback) | `src/engine.js` |
| Rule checks on every draft | `src/validate.js` |
| UI (Spanish) | `public/` |
| Case-law search, analysis and citation check (official domains only) | `src/jurisprudence.js`, `src/jurisprudence-routes.js` |
| Citation detection in drafts | `public/citations.js` |
| Document templates, starter set, case → variables | `src/templates.js`, `src/templates-seed.js` |
| Word: fill .docx templates, Markdown → .docx | `public/docx.js` (pizzip, docxtemplater) |
| Excel / CSV import (runs in the browser through the regular API) | `public/importer.js` |
| In-browser backend for the preview | `public/demo-backend.js`, `scripts/build-preview.mjs` |

`src/validate.js` checks each draft instead of trusting the prompt alone. It splits SECTION 1 (Markdown) from SECTION 2 (JSON), parses the payload, and flags:

- blacklisted phrases (English and Spanish)
- a missing human-audit footer
- missing `[OTP_VERIFICATION_CODE]` / `[TIMESTAMP]` / `[IP_ADDRESS]`
- a Bold transaction ID that doesn't match the one the server issued

It also lists every `[FILL: …]` marker, and the UI highlights them in the draft.

### `POST /api/generate`

```json
{
  "caseId": 12,
  "documentType": "PETITION | CONTRACT | POWER_OF_ATTORNEY",
  "language": "Spanish",
  "jurisdiction": "Colombia",
  "client": { "fullName": "", "idNumber": "", "email": "", "address": "" },
  "counterparty": "",
  "facts": "",
  "payment": { "required": true, "items": "Redacción: COP 350.000" }
}
```

With `caseId`, client data, counterparty, facts and the process (type, sub-process, custom fields) come from the stored case; anything typed in the request overrides them.

The response is newline-delimited JSON. It sends `{"type":"text","text":…}` deltas, then one `{"type":"done", document, payload, fillFields, issues, ok, transactionId, boldLink}` or one `{"type":"error", error}`.

## Pending before production

- **Personal data.** The app stores client personal data. Serve it only over HTTPS (`COOKIE_SECURE=1`), back up `data/juanmaapp.db`, and handle the data under Colombia's Ley 1581 de 2012 (habeas data).
- **Rama Judicial consultation.** Written against the public CPNU API (`/Procesos/Consulta/NumeroRadicacion` and `/Proceso/Actuaciones/{id}`) and tested with simulated responses; it could not be exercised against the live service from the build environment. Verify it with a few real radicados after deploying, and keep the default pause between requests.
- **Court directory.** Download the official directory of judicial offices and their e-mails from the Rama Judicial website and load it in Despachos; reload it when the Rama publishes a new edition.
- **Case-law search.** Needs the Anthropic API key and outbound access to the court websites (through Anthropic's web search and fetch tools). The preview shows fictitious, clearly labeled examples only. Each search or verification makes several web lookups, so it costs more than a draft; the attorney still reads the official text before relying on it.
- **Starting catalog.** The Administrativo and Laboral sub-processes come from the firm. Those under Penal, Familia, Derecho de Petición and Datacrédito are suggested starting points; edit them in Configuración.

- **Brand.** `public/brand.css` uses the official TEC Jurídicos swatches from the brand manual: navy `#002b6a`, blue `#027cc6`, silver `#989795`, light silver `#c4c8cb`. The header logo and favicon (`public/logo-t.png`) are the manual's "T" column icon. The wordmark font is approximated with Michroma until the manual's typeface name is confirmed; no other file hard-codes a color or font.
- **Bold.** The server generates the transaction reference (`JMA_…`) and builds the link in the format the prompt specifies: `https://checkout.bold.co/payment/link/<id>`. It does **not** yet create the payment link through Bold's API. Wire that in with the merchant's Bold credentials so the link resolves.
- **E-signature.** Signing by link with an e-mailed code is a simple electronic signature (Ley 527 de 1999, Decreto 2364 de 2012) backed by its evidence. A digital signature with a certificate needs an accredited certification body. In drafts, `[OTP_VERIFICATION_CODE]`, `[TIMESTAMP]` and `[IP_ADDRESS]` stay as placeholders that the Firmas module's certificate answers.
- **Payments.** Amounts are whole pesos. The app does not issue electronic invoices (DIAN); receipts are cash receipts (recibos de caja).
- **Deployment.** `DESPLIEGUE.md` (Spanish): Render with a persistent disk. `AZURE.md` (Spanish): Azure App Service (free F1 plan for testing, B1 for daily use), published by `.github/workflows/azure-juanmaapp.yml` once the `AZURE_WEBAPP_NAME` variable and `AZURE_WEBAPP_PUBLISH_PROFILE` secret exist.
- **Microsoft 365 sign-in.** With `MS_TENANT_ID`, `MS_CLIENT_ID` and `MS_CLIENT_SECRET` (a single-tenant Entra app registration, redirect `<PUBLIC_URL>/api/auth/microsoft/callback`), the sign-in screen offers "Ingresar con la cuenta de Microsoft" (`src/microsoft.js`: authorization code + PKCE, state and nonce checked; the ID token comes straight from the token endpoint and its audience, tenant, issuer and expiry are checked). Only accounts whose e-mail matches an active TecjuridicosApp user get in; on an empty install the first account of the firm's directory becomes Gerencia. Users can then be created without a password.
- **Legal review.** Every draft carries the audit footer and must be reviewed by the attorney of record. Legal citations the model isn't sure of come back as `[FILL: …]` markers. They are never invented.
