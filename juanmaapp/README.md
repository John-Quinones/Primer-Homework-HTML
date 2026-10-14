# JuanMaApp

Client, case and legal-draft manager for paralegals and attorneys. Drafts are written by the **NomosAI Engine** system prompt: Rights of Petition, Contracts and Powers of Attorney, with an e-signature block, an optional Bold payment section, and a JSON payload for downstream Python / Node.js services.

## Sections

| Section | What it does |
|---|---|
| **Inicio** | Dashboard: clients, active cases, saved judgments, process types; cases per process type; recent activity. |
| **Clientes** | Create, search, edit and delete clients (name, ID type and number, email, phone, address, city, notes). Each client shows their cases. |
| **Expedientes** | A case links a client to a sub-process (e.g. Laboral › Ejecutivo Laboral) and stores subject, status, counterparty, facts and the category's custom fields. Filter by process type. |
| **Borradores** | Pick a case (or fill the form by hand) and generate a draft. The case's client data, process and custom fields are sent to NomosAI. |
| **Jurisprudencia** | Search judgments of the Corte Constitucional, Corte Suprema de Justicia (every chamber), Consejo de Estado and tribunals; analyze one (legal problem, facts, ratio decidendi, decision, dissents, norms, verbatim quotes, summary); check every citation in a draft (does it exist, is the reference right, does it support what the draft says); save judgments to a case. Claude may only search and read the official court sites, and a result is marked verified only when its URL is one the tools actually returned from those sites. |
| **Reportes** | Expedientes (filter by office, process type, status, responsible, dates), clients, summary per office, workload per responsible, cases per process type, saved judgments. Each exports to Excel (.xlsx) and PDF, limited to the user's offices. |
| **Usuarios** | Gerencia creates users (name, email, role, offices, initial password, active), offices (Ibagué is the main one; any number can be added) and edits the role × permission matrix. |
| **Importar** | Load existing data exported from Access (or any spreadsheet) as `.xlsx` or `.csv`. Columns are matched automatically (Nombres + Apellidos are joined, IdCliente/Código are skipped) and can be reassigned. A file can hold clients only, or one case per row with the client's data on the same row. Existing clients are matched by document number or name and only their blank fields are filled; identical cases are not created twice; missing process types, sub-processes and custom fields can be created on the fly. Rows that fail are listed by row number. |
| **Configuración** | Manage process types (Administrativo, Laboral, Penal, Familia, Derecho de Petición, Datacrédito, or new ones), their sub-processes, and custom fields per type: text, long text, number, date, or a drop-down list, optionally required. |

Deleting a client or sub-process that still has cases is refused.

### Users, roles and offices

Roles: Gerencia, Director Jurídico, Director Contable, Gerente Regional, Abogado, Dependiente Judicial, Asistente. Each user belongs to one or more offices; every client and case belongs to an office and a case can have a responsible person from that office. Roles with **"Ve todas las oficinas"** see every office; the rest see only their own offices' clients, cases, saved judgments and reports. The starting permissions (editable in Usuarios › Roles y permisos):

| Permiso | Gerencia | Dir. Jurídico | Dir. Contable | Gerente Regional | Abogado | Dependiente Judicial | Asistente |
|---|---|---|---|---|---|---|---|
| Ve todas las oficinas | ✓ | ✓ | ✓ | | | | |
| Usuarios, roles y oficinas | ✓ | | | | | | |
| Configuración del catálogo | ✓ | ✓ | | | | | |
| Crear/editar clientes | ✓ | ✓ | | ✓ | ✓ | | ✓ |
| Eliminar clientes | ✓ | ✓ | | | | | |
| Crear/editar expedientes | ✓ | ✓ | | ✓ | ✓ | ✓ | ✓ |
| Eliminar expedientes | ✓ | ✓ | | ✓ | | | |
| Generar borradores | ✓ | ✓ | | ✓ | ✓ | | ✓ |
| Jurisprudencia | ✓ | ✓ | | ✓ | ✓ | ✓ | |
| Importar | ✓ | ✓ | | ✓ | | | |
| Reportes | ✓ | ✓ | ✓ | ✓ | ✓ | | |

On first start the app asks for the Gerencia account. Passwords are hashed with scrypt (minimum 10 characters); sessions are HttpOnly cookies that last 12 hours; five failed sign-ins lock an email for 10 minutes; every write must carry the `X-JuanMa` header (CSRF). The last active Gerencia account cannot be demoted or deactivated. Set `COOKIE_SECURE=1` when serving over HTTPS.

## Preview without installing

`npm run preview` writes `preview/juanmaapp-preview.html`, one self-contained file that runs in any browser with sample data (three offices and one sample user per role, chosen on the sign-in screen), and `preview/juanmaapp-web.html`, the same app for the published web link. Nothing is sent to a server; drafts and case-law results are fixed, labeled examples.

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

## How it works

| Piece | File |
|---|---|
| NomosAI Engine system prompt (prompt-cached) | `prompts/nomosai-system-prompt.md` |
| Database schema and starting catalog | `src/db.js` |
| REST API: clients, catalog, cases | `src/records.js` |
| Express app, `POST /api/generate` | `src/app.js` |
| Users, roles, offices, sessions | `src/auth.js` |
| Report data | `src/reports.js` |
| Claude call (streaming, effort `high`, server-side refusal fallback) | `src/engine.js` |
| Rule checks on every draft | `src/validate.js` |
| UI (Spanish) | `public/` |
| Case-law search, analysis and citation check (official domains only) | `src/jurisprudence.js`, `src/jurisprudence-routes.js` |
| Citation detection in drafts | `public/citations.js` |
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
- **Case-law search.** Needs the Anthropic API key and outbound access to the court websites (through Anthropic's web search and fetch tools). The preview shows fictitious, clearly labeled examples only. Each search or verification makes several web lookups, so it costs more than a draft; the attorney still reads the official text before relying on it.
- **Starting catalog.** The Administrativo and Laboral sub-processes come from the firm. Those under Penal, Familia, Derecho de Petición and Datacrédito are suggested starting points; edit them in Configuración.

- **Brand.** `public/brand.css` uses the official TEC Jurídicos swatches from the brand manual: navy `#002b6a`, blue `#027cc6`, silver `#989795`, light silver `#c4c8cb`. The header logo and favicon (`public/logo-t.png`) are the manual's "T" column icon. The wordmark font is approximated with Michroma until the manual's typeface name is confirmed; no other file hard-codes a color or font.
- **Bold.** The server generates the transaction reference (`JMA_…`) and builds the link in the format the prompt specifies: `https://checkout.bold.co/payment/link/<id>`. It does **not** yet create the payment link through Bold's API. Wire that in with the merchant's Bold credentials so the link resolves.
- **E-signature.** `[OTP_VERIFICATION_CODE]`, `[TIMESTAMP]` and `[IP_ADDRESS]` stay as placeholders for your e-signature provider to fill at signing time.
- **Legal review.** Every draft carries the audit footer and must be reviewed by the attorney of record. Legal citations the model isn't sure of come back as `[FILL: …]` markers. They are never invented.
