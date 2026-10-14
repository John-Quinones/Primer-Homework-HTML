// Persistence for clients, the process catalog and cases. Uses Node's built-in
// SQLite (node:sqlite), so there is no native dependency to install.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DEFAULT_MATRIX } from "./auth.js";

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
CREATE TABLE IF NOT EXISTS process_types (
  id           INTEGER PRIMARY KEY,
  category_id  INTEGER NOT NULL REFERENCES process_categories(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  sort         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (category_id, name)
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

  const count = db.prepare("SELECT COUNT(*) AS n FROM process_categories").get().n;
  if (count === 0) seed(db);
  return db;
}

// Bring databases created by earlier versions up to the current schema.
function migrate(db) {
  const cols = (t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
  const add = (t, col, def) => { if (!cols(t).has(col)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${col} ${def}`); };
  add("clients", "office_id", "INTEGER REFERENCES offices(id)");
  add("cases", "office_id", "INTEGER REFERENCES offices(id)");
  add("cases", "assigned_user_id", "INTEGER REFERENCES users(id) ON DELETE SET NULL");
  add("saved_rulings", "created_by", "INTEGER REFERENCES users(id) ON DELETE SET NULL");
  db.exec("CREATE INDEX IF NOT EXISTS cases_office ON cases(office_id)");

  if (!db.prepare("SELECT id FROM offices WHERE is_main = 1").get()) {
    const existing = db.prepare("SELECT id FROM offices WHERE name = ?").get(MAIN_OFFICE);
    if (existing) db.prepare("UPDATE offices SET is_main = 1 WHERE id = ?").run(existing.id);
    else db.prepare("INSERT INTO offices (name, city, is_main) VALUES (?, ?, 1)").run(MAIN_OFFICE, "Ibagué");
  }
  const main = db.prepare("SELECT id FROM offices WHERE is_main = 1").get().id;
  db.prepare("UPDATE clients SET office_id = ? WHERE office_id IS NULL").run(main);
  db.prepare("UPDATE cases SET office_id = ? WHERE office_id IS NULL").run(main);

  if (!db.prepare("SELECT COUNT(*) AS n FROM role_permissions").get().n) {
    const ins = db.prepare("INSERT INTO role_permissions (role, permission) VALUES (?, ?)");
    for (const [role, perms] of Object.entries(DEFAULT_MATRIX)) for (const p of perms) ins.run(role, p);
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
