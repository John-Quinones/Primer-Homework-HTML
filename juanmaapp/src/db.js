// Persistence for clients, the process catalog and cases. Uses Node's built-in
// SQLite (node:sqlite), so there is no native dependency to install.
import { AUDIT_SCHEMA } from "./audit.js";
import { CONSENT_SCHEMA } from "./consents.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DEFAULT_MATRIX, PERMISSIONS, ASSISTANT } from "./auth.js";
import { seedTemplates } from "./templates.js";
import { FEE_CLAUSE_OLD, FEE_CLAUSE_NEW, CONTRACT_HEAD_OLD, CONTRACT_HEAD_NEW, FIRM_FIXES } from "./templates-seed.js";
import { normStatus, courtCircuit } from "./case-meta.js";
import { newVerifyCode } from "./verify-code.js";
import { looksLikeCompany, splitFullName } from "./person.js";

export const MAIN_OFFICE = "Ibagué";

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS offices (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL UNIQUE,
  city     TEXT NOT NULL DEFAULT '',
  address  TEXT NOT NULL DEFAULT '',
  phone    TEXT NOT NULL DEFAULT '',
  email    TEXT NOT NULL DEFAULT '',
  is_main  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_offices (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  office_id  INTEGER NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, office_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL
);

-- Roles: the seven built-in ones plus any the firm creates.
CREATE TABLE IF NOT EXISTS roles (
  name     TEXT PRIMARY KEY,
  builtin  INTEGER NOT NULL DEFAULT 0
);

-- Per-user permissions, used only when users.custom_permissions = 1.
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission  TEXT NOT NULL,
  PRIMARY KEY (user_id, permission)
);

-- Court directory (Rama Judicial), loaded from the official directory file.
CREATE TABLE IF NOT EXISTS courts (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL,
  department  TEXT NOT NULL DEFAULT '',
  city        TEXT NOT NULL DEFAULT '',
  city_code   TEXT NOT NULL DEFAULT '',
  area        TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (name, city)
);
CREATE INDEX IF NOT EXISTS courts_place ON courts(department, city, area);

-- Tasks, hearings and deadlines on a case.
CREATE TABLE IF NOT EXISTS tasks (
  id                INTEGER PRIMARY KEY,
  case_id           INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL DEFAULT 'tarea' CHECK (kind IN ('tarea','audiencia','termino','recurso','requerimiento','peticion','oficio')),
  title             TEXT NOT NULL,
  notes             TEXT NOT NULL DEFAULT '',
  due_at            TEXT NOT NULL,           -- local Bogotá time, 'YYYY-MM-DD HH:MM'
  location          TEXT NOT NULL DEFAULT '', -- sala or virtual link (hearings)
  assigned_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  remind_days       TEXT NOT NULL DEFAULT '[1]', -- JSON: days before due_at to alert
  status            TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','hecha','cancelada')),
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  done_at           TEXT,
  done_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  done_notes        TEXT NOT NULL DEFAULT '',  -- how it was fulfilled
  delivered_at      TEXT NOT NULL DEFAULT '',  -- oficios/peticiones: date delivered or filed (local date)
  response_at       TEXT NOT NULL DEFAULT '',  -- date the answer arrived (local date)
  response_notes    TEXT NOT NULL DEFAULT '',
  term_from         TEXT NOT NULL DEFAULT '',  -- term (change 48): runs from the day after this date
  term_days         INTEGER,
  term_unit         TEXT NOT NULL DEFAULT '',  -- habiles | calendario
  term_label        TEXT NOT NULL DEFAULT ''   -- e.g. "Contestar demanda (verbal) · CGP art. 369"
);
CREATE INDEX IF NOT EXISTS tasks_due ON tasks(status, due_at);

-- In-app notifications; key makes each reminder fire once.
CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  link        TEXT NOT NULL DEFAULT '',
  key         TEXT UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  read_at     TEXT
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, read_at);

-- Rama Judicial consultation: actions (actuaciones) seen per case and each check run.
CREATE TABLE IF NOT EXISTS actuaciones (
  id           INTEGER PRIMARY KEY,
  case_id      INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  ext_key      TEXT NOT NULL,
  fecha        TEXT NOT NULL DEFAULT '',
  actuacion    TEXT NOT NULL DEFAULT '',
  anotacion    TEXT NOT NULL DEFAULT '',
  fecha_inicial TEXT NOT NULL DEFAULT '',
  fecha_final  TEXT NOT NULL DEFAULT '',
  found_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (case_id, ext_key)
);
CREATE TABLE IF NOT EXISTS process_checks (
  id          INTEGER PRIMARY KEY,
  case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  checked_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ok          INTEGER NOT NULL,
  new_count   INTEGER NOT NULL DEFAULT 0,
  error       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS process_checks_case ON process_checks(case_id, checked_at);

-- Delivery preferences for the automatic process report.
CREATE TABLE IF NOT EXISTS report_prefs (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hours         TEXT NOT NULL DEFAULT '["07:00"]',
  by_email      INTEGER NOT NULL DEFAULT 1,
  email         TEXT NOT NULL DEFAULT '',
  by_whatsapp   INTEGER NOT NULL DEFAULT 0,
  whatsapp      TEXT NOT NULL DEFAULT '',
  scope         TEXT NOT NULL DEFAULT 'mine' CHECK (scope IN ('mine','office','selected'))
);
CREATE TABLE IF NOT EXISTS report_selection (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id  INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, case_id)
);
CREATE TABLE IF NOT EXISTS report_log (
  id        INTEGER PRIMARY KEY,
  user_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
  sent_at   TEXT NOT NULL DEFAULT (datetime('now')),
  trigger   TEXT NOT NULL,                  -- 'manual' or the scheduled hour
  channels  TEXT NOT NULL DEFAULT '[]',     -- JSON: [{channel, ok, detail}]
  summary   TEXT NOT NULL DEFAULT ''
);

-- Document templates: markdown text with {{variables}} or an uploaded .docx.
CREATE TABLE IF NOT EXISTS case_documents (
  id           INTEGER PRIMARY KEY,
  case_id      INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  filename     TEXT NOT NULL,
  mime         TEXT NOT NULL,
  size         INTEGER NOT NULL,
  sha256       TEXT NOT NULL,
  file         BLOB NOT NULL,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS case_documents_case ON case_documents(case_id);

CREATE TABLE IF NOT EXISTS document_templates (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  format       TEXT NOT NULL CHECK (format IN ('markdown','docx')),
  body         TEXT,
  filename     TEXT,
  file         BLOB,
  builtin      INTEGER NOT NULL DEFAULT 0,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Electronic signature requests, their signers and an audit trail.
CREATE TABLE IF NOT EXISTS sign_requests (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  case_id       INTEGER REFERENCES cases(id) ON DELETE SET NULL,
  office_id     INTEGER REFERENCES offices(id),
  doc_kind      TEXT NOT NULL CHECK (doc_kind IN ('markdown','pdf')),
  doc_text      TEXT,
  doc_file      BLOB,
  doc_name      TEXT NOT NULL DEFAULT '',
  doc_hash      TEXT NOT NULL,
  message       TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'enviada' CHECK (status IN ('enviada','completada','cancelada','rechazada')),
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at  TEXT
);
CREATE TABLE IF NOT EXISTS sign_signers (
  id              INTEGER PRIMARY KEY,
  request_id      INTEGER NOT NULL REFERENCES sign_requests(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  id_type         TEXT NOT NULL DEFAULT 'CC',
  id_number       TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  token_hash      TEXT NOT NULL UNIQUE,
  otp_hash        TEXT,
  otp_expires_at  TEXT,
  otp_sent_at     TEXT,
  otp_attempts    INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','firmado','rechazado')),
  method          TEXT,
  signed_at       TEXT,
  ip              TEXT,
  user_agent      TEXT,
  typed_name      TEXT,
  signature_png   TEXT,
  reject_reason   TEXT
);
CREATE TABLE IF NOT EXISTS sign_events (
  id          INTEGER PRIMARY KEY,
  request_id  INTEGER NOT NULL REFERENCES sign_requests(id) ON DELETE CASCADE,
  signer_id   INTEGER REFERENCES sign_signers(id) ON DELETE CASCADE,
  at          TEXT NOT NULL DEFAULT (datetime('now')),
  event       TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  ip          TEXT NOT NULL DEFAULT ''
);

-- E-mail with traceability: content hash, SMTP acceptance, opening and acknowledgment.
CREATE TABLE IF NOT EXISTS mail_messages (
  id               INTEGER PRIMARY KEY,
  case_id          INTEGER REFERENCES cases(id) ON DELETE SET NULL,
  office_id        INTEGER REFERENCES offices(id),
  to_addr          TEXT NOT NULL,
  cc               TEXT NOT NULL DEFAULT '',
  subject          TEXT NOT NULL,
  body             TEXT NOT NULL,
  content_hash     TEXT NOT NULL,
  token_hash       TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL CHECK (status IN ('enviado','fallido')),
  smtp_message_id  TEXT NOT NULL DEFAULT '',
  smtp_response    TEXT NOT NULL DEFAULT '',
  sent_at          TEXT NOT NULL DEFAULT (datetime('now')),
  opened_at        TEXT, open_ip TEXT, open_ua TEXT,
  confirmed_at     TEXT, confirm_ip TEXT, confirm_ua TEXT, confirm_name TEXT,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS mail_attachments (
  id          INTEGER PRIMARY KEY,
  message_id  INTEGER NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL DEFAULT 'application/octet-stream',
  size        INTEGER NOT NULL,
  sha256      TEXT NOT NULL,
  data        BLOB NOT NULL
);

-- Every traceable activity of a sent e-mail: SMTP acceptance, each opening, each download, the acknowledgment.
CREATE TABLE IF NOT EXISTS mail_events (
  id          INTEGER PRIMARY KEY,
  message_id  INTEGER NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
  at          TEXT NOT NULL,
  event       TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  ip          TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS mail_events_message ON mail_events(message_id);

CREATE TABLE IF NOT EXISTS role_permissions (
  role        TEXT NOT NULL,
  permission  TEXT NOT NULL,
  PRIMARY KEY (role, permission)
);

CREATE TABLE IF NOT EXISTS clients (
  id          INTEGER PRIMARY KEY,
  full_name   TEXT NOT NULL,
  id_type     TEXT NOT NULL DEFAULT 'CC',
  id_number   TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL DEFAULT '',
  city        TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  office_id   INTEGER REFERENCES offices(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Main process type: Administrativo, Laboral, Penal, ...
CREATE TABLE IF NOT EXISTS process_categories (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  sort  INTEGER NOT NULL DEFAULT 0
);

-- Sub-process that depends on a category: Reparación Directa, Ejecutivo Laboral, ...
-- parent_id makes a second-order sub-process (Ordinario Laboral › Primera instancia).
CREATE TABLE IF NOT EXISTS process_types (
  id           INTEGER PRIMARY KEY,
  category_id  INTEGER NOT NULL REFERENCES process_categories(id) ON DELETE CASCADE,
  parent_id    INTEGER REFERENCES process_types(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  sort         INTEGER NOT NULL DEFAULT 0
);

-- User-defined fields shown on every case of a category.
CREATE TABLE IF NOT EXISTS custom_fields (
  id           INTEGER PRIMARY KEY,
  category_id  INTEGER NOT NULL REFERENCES process_categories(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  field_type   TEXT NOT NULL DEFAULT 'text' CHECK (field_type IN ('text','textarea','number','date','select')),
  options      TEXT NOT NULL DEFAULT '[]',   -- JSON array, used by 'select'
  required     INTEGER NOT NULL DEFAULT 0,
  sort         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (category_id, label)
);

CREATE TABLE IF NOT EXISTS cases (
  id               INTEGER PRIMARY KEY,
  client_id        INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  process_type_id  INTEGER NOT NULL REFERENCES process_types(id) ON DELETE RESTRICT,
  title            TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'Activo',
  counterparty     TEXT NOT NULL DEFAULT '',
  facts            TEXT NOT NULL DEFAULT '',
  field_values     TEXT NOT NULL DEFAULT '{}',  -- JSON keyed by custom_fields.id
  office_id        INTEGER REFERENCES offices(id),
  assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS cases_client ON cases(client_id);

-- Payments: what the client owes (charges / installments) and what they paid (receipts).
CREATE TABLE IF NOT EXISTS charges (
  id               INTEGER PRIMARY KEY,
  client_id        INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  case_id          INTEGER REFERENCES cases(id) ON DELETE SET NULL,
  office_id        INTEGER REFERENCES offices(id),
  concept          TEXT NOT NULL,
  plan_label       TEXT NOT NULL DEFAULT '',     -- e.g. "Cuota 2 de 6"
  amount           INTEGER NOT NULL CHECK (amount > 0),
  due_date         TEXT NOT NULL,                -- YYYY-MM-DD
  pay_link         TEXT NOT NULL DEFAULT '',
  notes            TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'vigente' CHECK (status IN ('vigente','anulado')),
  void_reason      TEXT NOT NULL DEFAULT '',
  last_reminder_at TEXT,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS charges_client ON charges(client_id);

CREATE TABLE IF NOT EXISTS receipts (
  id           INTEGER PRIMARY KEY,
  number       INTEGER NOT NULL UNIQUE,
  client_id    INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  charge_id    INTEGER REFERENCES charges(id) ON DELETE SET NULL,
  case_id      INTEGER REFERENCES cases(id) ON DELETE SET NULL,
  office_id    INTEGER REFERENCES offices(id),
  amount       INTEGER NOT NULL CHECK (amount > 0),
  method       TEXT NOT NULL,
  reference    TEXT NOT NULL DEFAULT '',
  paid_on      TEXT NOT NULL,
  concept      TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',
  voided_at    TEXT,
  void_reason  TEXT NOT NULL DEFAULT '',
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS receipts_client ON receipts(client_id);

CREATE TABLE IF NOT EXISTS payment_reminders (
  id         INTEGER PRIMARY KEY,
  charge_id  INTEGER REFERENCES charges(id) ON DELETE CASCADE,
  client_id  INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  channel    TEXT NOT NULL,
  ok         INTEGER NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  trigger    TEXT NOT NULL DEFAULT 'manual',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sent_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Judgments saved from the case-law search, optionally attached to a case.
CREATE TABLE IF NOT EXISTS saved_rulings (
  id          INTEGER PRIMARY KEY,
  case_id     INTEGER REFERENCES cases(id) ON DELETE SET NULL,
  reference   TEXT NOT NULL,
  court       TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL DEFAULT '',
  verified    INTEGER NOT NULL DEFAULT 0,
  analysis    TEXT NOT NULL DEFAULT '{}',
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// Starting catalog. Administrativo and Laboral come from the firm's request;
// the rest are common starting points and can be edited in Configuración.
export const SEED_CATALOG = [
  ["Administrativo", [
    "Medio de Control de Nulidad y Restablecimiento del Derecho",
    "Medio de Control de Reparación Directa",
    "Acción Contractual",
    "Petición",
  ]],
  ["Laboral", [
    "Ordinario Laboral de Primera Instancia",
    "Ejecutivo Laboral",
    "Requerimiento Empleador",
    "Requerimiento Oficina de Trabajo",
  ]],
  ["Penal", ["Denuncia Penal", "Querella", "Representación de Víctima", "Defensa Técnica"]],
  ["Familia", ["Divorcio", "Custodia y Cuidado Personal", "Fijación de Cuota Alimentaria", "Regulación de Visitas"]],
  ["Derecho de Petición", ["Petición de Interés General", "Petición de Interés Particular", "Solicitud de Información", "Consulta"]],
  ["Datacrédito", ["Reclamo ante la Fuente", "Reclamo ante el Operador", "Queja ante la SIC"]],
];

export function openDb(file = process.env.DB_PATH || "data/juanmaapp.db") {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);

  migrate(db);
  seedTemplates(db);

  const count = db.prepare("SELECT COUNT(*) AS n FROM process_categories").get().n;
  if (count === 0) seed(db);
  return db;
}

// Bring databases created by earlier versions up to the current schema.
function migrate(db) {
  const cols = (t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
  // Second-order sub-processes: rebuild process_types to add parent_id and
  // replace UNIQUE(category_id, name) with uniqueness per parent.
  if (!cols("process_types").has("parent_id")) {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");
    db.exec(`CREATE TABLE process_types_new (
      id INTEGER PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES process_categories(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES process_types(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0)`);
    db.exec("INSERT INTO process_types_new (id, category_id, name, sort) SELECT id, category_id, name, sort FROM process_types");
    db.exec("DROP TABLE process_types");
    db.exec("ALTER TABLE process_types_new RENAME TO process_types");
    db.exec("COMMIT");
    db.exec("PRAGMA foreign_keys = ON");
  }
  // Change 47: more task kinds (recursos, requerimientos, peticiones, oficios) and follow-up columns.
  // SQLite cannot change a CHECK constraint in place, so the table is rebuilt keeping every row.
  if (!/'oficio'/.test(db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get()?.sql || "'oficio'")) {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");
    db.exec(`CREATE TABLE tasks_new (
      id INTEGER PRIMARY KEY,
      case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'tarea' CHECK (kind IN ('tarea','audiencia','termino','recurso','requerimiento','peticion','oficio')),
      title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', due_at TEXT NOT NULL, location TEXT NOT NULL DEFAULT '',
      assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, remind_days TEXT NOT NULL DEFAULT '[1]',
      status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','hecha','cancelada')),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), done_at TEXT,
      done_by INTEGER REFERENCES users(id) ON DELETE SET NULL, done_notes TEXT NOT NULL DEFAULT '',
      delivered_at TEXT NOT NULL DEFAULT '', response_at TEXT NOT NULL DEFAULT '', response_notes TEXT NOT NULL DEFAULT '')`);
    db.exec(`INSERT INTO tasks_new (id, case_id, kind, title, notes, due_at, location, assigned_user_id, remind_days, status, created_by, created_at, done_at)
      SELECT id, case_id, kind, title, notes, due_at, location, assigned_user_id, remind_days, status, created_by, created_at, done_at FROM tasks`);
    db.exec("DROP TABLE tasks");
    db.exec("ALTER TABLE tasks_new RENAME TO tasks");
    db.exec("CREATE INDEX IF NOT EXISTS tasks_due ON tasks(status, due_at)");
    db.exec("COMMIT");
    db.exec("PRAGMA foreign_keys = ON");
  }
  for (const [col, def] of [["term_from", "TEXT NOT NULL DEFAULT ''"], ["term_days", "INTEGER"], ["term_unit", "TEXT NOT NULL DEFAULT ''"], ["term_label", "TEXT NOT NULL DEFAULT ''"]]) {
    if (!new Set(db.prepare("PRAGMA table_info(tasks)").all().map((c) => c.name)).has(col)) db.exec(`ALTER TABLE tasks ADD COLUMN ${col} ${def}`);
  }
  db.exec(AUDIT_SCHEMA); // change 50
  // Version 2.18: history of every task (who did what, when). Rows are only added, never changed or removed.
  db.exec(`CREATE TABLE IF NOT EXISTS task_log (
    id INTEGER PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime('now')), task_id INTEGER NOT NULL, case_id INTEGER NOT NULL,
    user_id INTEGER, action TEXT NOT NULL, kind TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '',
    assigned_user_id INTEGER);
    CREATE INDEX IF NOT EXISTS task_log_case ON task_log(case_id, id);
    CREATE TRIGGER IF NOT EXISTS task_log_no_update BEFORE UPDATE ON task_log BEGIN SELECT RAISE(ABORT, 'El historial de tareas no se modifica.'); END;
    CREATE TRIGGER IF NOT EXISTS task_log_no_delete BEFORE DELETE ON task_log BEGIN SELECT RAISE(ABORT, 'El historial de tareas no se borra.'); END;`);
  // Version 2.22: optional client photo, in its own table so client lists stay light. Existing clients simply have none.
  db.exec(`CREATE TABLE IF NOT EXISTS client_photos (
    client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE, photo TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS process_types_unique ON process_types(category_id, COALESCE(parent_id, 0), name)");
  const add = (t, col, def) => { if (!cols(t).has(col)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${col} ${def}`); };
  add("clients", "office_id", "INTEGER REFERENCES offices(id)");
  add("cases", "office_id", "INTEGER REFERENCES offices(id)");
  add("cases", "assigned_user_id", "INTEGER REFERENCES users(id) ON DELETE SET NULL");
  add("saved_rulings", "created_by", "INTEGER REFERENCES users(id) ON DELETE SET NULL");
  add("clients", "department", "TEXT NOT NULL DEFAULT ''");
  add("courts", "circuit", "TEXT NOT NULL DEFAULT ''");
  // Certified e-mail evidence (change 39): the exact message sent (.eml) with several digests, attachment digests, trusted timestamp.
  for (const [col, def] of [["raw", "BLOB"], ["raw_sha1", "TEXT NOT NULL DEFAULT ''"], ["raw_sha256", "TEXT NOT NULL DEFAULT ''"], ["raw_sha512", "TEXT NOT NULL DEFAULT ''"],
    ["raw_sha3_512", "TEXT NOT NULL DEFAULT ''"], ["attach_mode", "TEXT NOT NULL DEFAULT 'adjunto'"], ["tsa_url", "TEXT NOT NULL DEFAULT ''"], ["tsa_reply", "TEXT"],
    ["tsa_time", "TEXT NOT NULL DEFAULT ''"], ["tsa_detail", "TEXT NOT NULL DEFAULT ''"], ["sent_at_ms", "TEXT NOT NULL DEFAULT ''"]]) add("mail_messages", col, def);
  for (const [col, def] of [["sha1", "TEXT NOT NULL DEFAULT ''"], ["sha512", "TEXT NOT NULL DEFAULT ''"], ["sha3_512", "TEXT NOT NULL DEFAULT ''"]]) add("mail_attachments", col, def);
  // E-signature: OTP by e-mail, SMS or WhatsApp; where the signature stamp goes; e-mail notices (change 33).
  add("sign_signers", "otp_channel", "TEXT NOT NULL DEFAULT 'email'");
  add("sign_requests", "stamp_page", "TEXT NOT NULL DEFAULT 'last'");
  add("sign_requests", "stamp_pos", "TEXT NOT NULL DEFAULT 'br'");
  add("sign_requests", "notify", "INTEGER NOT NULL DEFAULT 1");
  // Verification (change 41): a public code printed on every page and the signed PDF kept once, with its SHA-256.
  add("sign_requests", "verify_code", "TEXT");
  add("sign_requests", "signed_pdf", "BLOB");
  add("sign_requests", "signed_sha256", "TEXT");
  add("sign_requests", "mail_opts", "TEXT"); // version 2.8: parts of the e-mail the office kept (NULL = all)
  for (const r of db.prepare("SELECT id FROM sign_requests WHERE verify_code IS NULL").all()) {
    db.prepare("UPDATE sign_requests SET verify_code = ? WHERE id = ?").run(newVerifyCode(), r.id);
  }
  // Circuit courts already loaded take their circuit from the name ("… del Circuito de Ibagué").
  const setCircuit = db.prepare("UPDATE courts SET circuit = ? WHERE id = ?");
  for (const c of db.prepare("SELECT id, name FROM courts WHERE circuit = ''").all()) {
    const circuit = courtCircuit(c.name);
    if (circuit) setCircuit.run(circuit, c.id);
  }
  add("offices", "department", "TEXT NOT NULL DEFAULT ''");
  add("users", "custom_permissions", "INTEGER NOT NULL DEFAULT 0");
  add("users", "phone", "TEXT NOT NULL DEFAULT ''");
  add("users", "professional_card", "TEXT NOT NULL DEFAULT ''");
  // Invitations and temporary passwords (change 45).
  add("users", "must_change_password", "INTEGER NOT NULL DEFAULT 0");
  add("users", "invited_at", "TEXT");
  // Change 51 (security audit): sign-in counters in the database, idle sessions, Microsoft object id.
  db.exec("CREATE TABLE IF NOT EXISTS auth_throttle (key TEXT PRIMARY KEY, n INTEGER NOT NULL, first_ms INTEGER NOT NULL, until_ms INTEGER NOT NULL DEFAULT 0)");
  add("sessions", "last_seen", "TEXT");
  // Version 2.19: answers of case-law research kept 30 days so the same query returns at once.
  db.exec("CREATE TABLE IF NOT EXISTS jurisprudence_cache (key TEXT PRIMARY KEY, result TEXT NOT NULL, created_ms INTEGER NOT NULL)");
  add("users", "ms_oid", "TEXT");
  // Version 2.11: hidden users. Their actions read "Asistente" everywhere through this view;
  // the real author stays in user_id columns and is shown only after the hidden-users password.
  add("users", "hidden", "INTEGER NOT NULL DEFAULT 0");
  db.exec(`DROP VIEW IF EXISTS users_shown;
    CREATE VIEW users_shown AS SELECT id, CASE WHEN hidden = 1 THEN '${ASSISTANT}' ELSE name END AS name,
      CASE WHEN hidden = 1 THEN '${ASSISTANT}' ELSE role END AS role FROM users`);
  for (const [col, def] of [["department", "TEXT NOT NULL DEFAULT ''"], ["city", "TEXT NOT NULL DEFAULT ''"], ["area", "TEXT NOT NULL DEFAULT ''"],
    ["court_id", "INTEGER REFERENCES courts(id) ON DELETE SET NULL"], ["court_name", "TEXT NOT NULL DEFAULT ''"],
    ["court_email", "TEXT NOT NULL DEFAULT ''"], ["radicado", "TEXT NOT NULL DEFAULT ''"],
    ["monitor", "INTEGER NOT NULL DEFAULT 0"], ["ext_process_id", "TEXT NOT NULL DEFAULT ''"],
    ["last_checked_at", "TEXT"], ["last_action_date", "TEXT"],
    ["client_role", "TEXT NOT NULL DEFAULT ''"], ["affiliated", "INTEGER NOT NULL DEFAULT 0"],
    ["parties", "TEXT NOT NULL DEFAULT '[]'"]]) add("cases", col, def); // parties: JSON list (change 49)
  // Clients: natural persons with first and last names; legal entities with business name and NIT (change 19).
  for (const [col, def] of [["person_type", "TEXT NOT NULL DEFAULT 'natural'"], ["first_names", "TEXT NOT NULL DEFAULT ''"],
    ["last_names", "TEXT NOT NULL DEFAULT ''"], ["legal_rep", "TEXT NOT NULL DEFAULT ''"]]) add("clients", col, def);
  for (const c of db.prepare("SELECT id, full_name, id_type FROM clients WHERE first_names = '' AND last_names = '' AND person_type = 'natural'").all()) {
    if (looksLikeCompany(c.full_name, c.id_type)) {
      db.prepare("UPDATE clients SET person_type = 'juridica', id_type = 'NIT' WHERE id = ?").run(c.id);
    } else {
      const s = splitFullName(c.full_name);
      if (s.first_names) db.prepare("UPDATE clients SET first_names = ?, last_names = ?, full_name = ? WHERE id = ?")
        .run(s.first_names, s.last_names, `${s.first_names} ${s.last_names}`.trim(), c.id);
    }
  }
  // The app was renamed (change 18): starter templates carry the new name in their footer.
  if (cols("document_templates").has("builtin")) db.exec("UPDATE document_templates SET body = replace(body, 'JuanMaApp', 'TecjuridicosApp') WHERE builtin = 1 AND body LIKE '%JuanMaApp%'");
  // Change 36: the starter contract takes its fee from Pagos ({{honorarios.*}}).
  if (cols("document_templates").has("builtin")) {
    db.prepare("UPDATE document_templates SET body = replace(body, ?, ?) WHERE builtin = 1 AND instr(body, ?) > 0").run(FEE_CLAUSE_OLD, FEE_CLAUSE_NEW, FEE_CLAUSE_OLD);
    for (const [from, to] of FIRM_FIXES) db.prepare("UPDATE document_templates SET body = replace(body, ?, ?) WHERE builtin = 1 AND instr(body, ?) > 0").run(from, to, from);
    db.prepare("UPDATE document_templates SET body = replace(body, ?, ?) WHERE builtin = 1 AND instr(body, ?) = 1").run(CONTRACT_HEAD_OLD, CONTRACT_HEAD_NEW, CONTRACT_HEAD_OLD);
  }
  // Three statuses: Activo, Archivo provisional, Archivo definitivo.
  for (const row of db.prepare("SELECT DISTINCT status FROM cases").all()) {
    const next = normStatus(row.status);
    if (next !== row.status) db.prepare("UPDATE cases SET status = ? WHERE status = ?").run(next, row.status);
  }
  db.exec("CREATE INDEX IF NOT EXISTS cases_radicado ON cases(radicado)");
  db.exec("CREATE INDEX IF NOT EXISTS cases_office ON cases(office_id)");

  if (!db.prepare("SELECT id FROM offices WHERE is_main = 1").get()) {
    const existing = db.prepare("SELECT id FROM offices WHERE name = ?").get(MAIN_OFFICE);
    if (existing) db.prepare("UPDATE offices SET is_main = 1 WHERE id = ?").run(existing.id);
    else db.prepare("INSERT INTO offices (name, department, city, is_main) VALUES (?, 'Tolima', 'Ibagué', 1)").run(MAIN_OFFICE);
  }
  db.prepare("UPDATE offices SET department = 'Tolima' WHERE name = ? AND department = ''").run(MAIN_OFFICE);
  const insRole = db.prepare("INSERT OR IGNORE INTO roles (name, builtin) VALUES (?, 1)");
  for (const role of Object.keys(DEFAULT_MATRIX)) insRole.run(role);
  const main = db.prepare("SELECT id FROM offices WHERE is_main = 1").get().id;
  db.prepare("UPDATE clients SET office_id = ? WHERE office_id IS NULL").run(main);
  db.prepare("UPDATE cases SET office_id = ? WHERE office_id IS NULL").run(main);

  // Grant each permission's defaults the first time this database sees it, so
  // permissions added in later versions reach existing built-in roles once.
  // Client authorizations (change 56): append-only evidence.
  db.exec(CONSENT_SCHEMA);

  db.exec("CREATE TABLE IF NOT EXISTS known_permissions (permission TEXT PRIMARY KEY)");
  const known = new Set(db.prepare("SELECT permission FROM known_permissions").all().map((r) => r.permission));
  if (!known.size && db.prepare("SELECT COUNT(*) AS n FROM role_permissions").get().n) {
    // Databases from before this table existed already hold their matrix.
    for (const p of Object.keys(PERMISSIONS)) if (!["processes.consult", "templates.manage", "esign.use", "mail.send"].includes(p)) known.add(p);
    const insK = db.prepare("INSERT OR IGNORE INTO known_permissions (permission) VALUES (?)");
    for (const p of known) insK.run(p);
  }
  const insP = db.prepare("INSERT OR IGNORE INTO role_permissions (role, permission) VALUES (?, ?)");
  for (const p of Object.keys(PERMISSIONS)) {
    if (known.has(p)) continue;
    for (const [role, perms] of Object.entries(DEFAULT_MATRIX)) if (perms.includes(p)) insP.run(role, p);
    db.prepare("INSERT INTO known_permissions (permission) VALUES (?)").run(p);
  }
}

function seed(db) {
  const addCat = db.prepare("INSERT INTO process_categories (name, sort) VALUES (?, ?)");
  const addType = db.prepare("INSERT INTO process_types (category_id, name, sort) VALUES (?, ?, ?)");
  db.exec("BEGIN");
  try {
    SEED_CATALOG.forEach(([cat, types], i) => {
      const catId = addCat.run(cat, i).lastInsertRowid;
      types.forEach((t, j) => addType.run(catId, t, j));
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
