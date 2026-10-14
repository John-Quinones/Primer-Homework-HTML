// Persistence for clients, the process catalog and cases. Uses Node's built-in
// SQLite (node:sqlite), so there is no native dependency to install.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

const SCHEMA = `
PRAGMA foreign_keys = ON;

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
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS cases_client ON cases(client_id);
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

  const count = db.prepare("SELECT COUNT(*) AS n FROM process_categories").get().n;
  if (count === 0) seed(db);
  return db;
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
