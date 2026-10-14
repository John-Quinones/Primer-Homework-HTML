// Persistence for clients, the process catalog and cases. Uses Node's built-in
// SQLite (node:sqlite), so there is no native dependency to install.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DEFAULT_MATRIX, PERMISSIONS } from "./auth.js";
import { seedTemplates } from "./templates.js";

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
  kind              TEXT NOT NULL DEFAULT 'tarea' CHECK (kind IN ('tarea','audiencia','termino')),
  title             TEXT NOT NULL,
  notes             TEXT NOT NULL DEFAULT '',
  due_at            TEXT NOT NULL,           -- local Bogotá time, 'YYYY-MM-DD HH:MM'
  location          TEXT NOT NULL DEFAULT '', -- sala or virtual link (hearings)
  assigned_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  remind_days       TEXT NOT NULL DEFAULT '[1]', -- JSON: days before due_at to alert
  status            TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','hecha','cancelada')),
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  done_at           TEXT
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
  status           TEXT NOT NULL DEFAULT 'Abierto',
  counterparty     TEXT NOT NULL DEFAULT '',
  facts            TEXT NOT NULL DEFAULT '',
  field_values     TEXT NOT NULL DEFAULT '{}',  -- JSON keyed by custom_fields.id
  office_id        INTEGER REFERENCES offices(id),
  assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS cases_client ON cases(client_id);

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
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS process_types_unique ON process_types(category_id, COALESCE(parent_id, 0), name)");
  const add = (t, col, def) => { if (!cols(t).has(col)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${col} ${def}`); };
  add("clients", "office_id", "INTEGER REFERENCES offices(id)");
  add("cases", "office_id", "INTEGER REFERENCES offices(id)");
  add("cases", "assigned_user_id", "INTEGER REFERENCES users(id) ON DELETE SET NULL");
  add("saved_rulings", "created_by", "INTEGER REFERENCES users(id) ON DELETE SET NULL");
  add("clients", "department", "TEXT NOT NULL DEFAULT ''");
  add("offices", "department", "TEXT NOT NULL DEFAULT ''");
  add("users", "custom_permissions", "INTEGER NOT NULL DEFAULT 0");
  add("users", "phone", "TEXT NOT NULL DEFAULT ''");
  add("users", "professional_card", "TEXT NOT NULL DEFAULT ''");
  for (const [col, def] of [["department", "TEXT NOT NULL DEFAULT ''"], ["city", "TEXT NOT NULL DEFAULT ''"], ["area", "TEXT NOT NULL DEFAULT ''"],
    ["court_id", "INTEGER REFERENCES courts(id) ON DELETE SET NULL"], ["court_name", "TEXT NOT NULL DEFAULT ''"],
    ["court_email", "TEXT NOT NULL DEFAULT ''"], ["radicado", "TEXT NOT NULL DEFAULT ''"],
    ["monitor", "INTEGER NOT NULL DEFAULT 0"], ["ext_process_id", "TEXT NOT NULL DEFAULT ''"],
    ["last_checked_at", "TEXT"], ["last_action_date", "TEXT"]]) add("cases", col, def);
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
  db.exec("CREATE TABLE IF NOT EXISTS known_permissions (permission TEXT PRIMARY KEY)");
  const known = new Set(db.prepare("SELECT permission FROM known_permissions").all().map((r) => r.permission));
  if (!known.size && db.prepare("SELECT COUNT(*) AS n FROM role_permissions").get().n) {
    // Databases from before this table existed already hold their matrix.
    for (const p of Object.keys(PERMISSIONS)) if (!["processes.consult", "templates.manage"].includes(p)) known.add(p);
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
