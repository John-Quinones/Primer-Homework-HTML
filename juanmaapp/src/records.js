// REST routes for clients, the process catalog (categories → sub-processes →
// custom fields) and cases. Mounted under /api by app.js.
import express from "express";

const FIELD_TYPES = ["text", "textarea", "number", "date", "select"];
const CLIENT_FIELDS = ["full_name", "id_type", "id_number", "email", "phone", "address", "city", "notes"];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const str = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

function requireText(value, label) {
  const s = str(value);
  if (!s) throw new HttpError(400, `${label} es obligatorio.`);
  return s;
}

function toInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${label} no es válido.`);
  return n;
}

function plain(row) {
  return row ? { ...row } : row;
}

export function recordsRouter(db) {
  const r = express.Router();

  const getOr404 = (sql, id, what) => {
    const row = db.prepare(sql).get(id);
    if (!row) throw new HttpError(404, `${what} no existe.`);
    return plain(row);
  };

  // Wrap handlers so thrown HttpErrors and SQLite constraint errors become JSON.
  const h = (fn) => (req, res) => {
    try {
      const out = fn(req, res);
      if (out !== undefined) res.json(out);
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
      if (/UNIQUE constraint/.test(err.message)) return res.status(409).json({ error: "Ya existe un registro con ese nombre." });
      if (/FOREIGN KEY constraint/.test(err.message)) {
        return res.status(409).json({ error: "No se puede eliminar: tiene expedientes asociados." });
      }
      console.error(err);
      res.status(500).json({ error: "Error interno." });
    }
  };

  // ---------- Clients ----------
  const clientValues = (body, existing = {}) => {
    const v = {};
    for (const f of CLIENT_FIELDS) v[f] = f in body ? str(body[f]) : existing[f] ?? "";
    v.full_name = requireText(v.full_name, "El nombre del cliente");
    v.id_type ||= "CC";
    return v;
  };

  r.get("/clients", h((req) => {
    const q = `%${str(req.query.q)}%`;
    return db.prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM cases WHERE client_id = c.id) AS case_count
      FROM clients c
      WHERE c.full_name LIKE ? OR c.id_number LIKE ?
      ORDER BY c.full_name COLLATE NOCASE`).all(q, q).map(plain);
  }));

  r.get("/clients/:id", h((req) => getOr404("SELECT * FROM clients WHERE id = ?", toInt(req.params.id, "id"), "El cliente")));

  r.post("/clients", h((req, res) => {
    const v = clientValues(req.body ?? {});
    const id = db.prepare(`INSERT INTO clients (${CLIENT_FIELDS.join(",")})
      VALUES (${CLIENT_FIELDS.map((f) => ":" + f).join(",")})`).run(v).lastInsertRowid;
    res.status(201);
    return getOr404("SELECT * FROM clients WHERE id = ?", id, "El cliente");
  }));

  r.put("/clients/:id", h((req) => {
    const id = toInt(req.params.id, "id");
    const v = clientValues(req.body ?? {}, getOr404("SELECT * FROM clients WHERE id = ?", id, "El cliente"));
    db.prepare(`UPDATE clients SET ${CLIENT_FIELDS.map((f) => `${f} = :${f}`).join(", ")} WHERE id = :id`).run({ ...v, id });
    return getOr404("SELECT * FROM clients WHERE id = ?", id, "El cliente");
  }));

  r.delete("/clients/:id", h((req, res) => {
    const { changes } = db.prepare("DELETE FROM clients WHERE id = ?").run(toInt(req.params.id, "id"));
    if (!changes) throw new HttpError(404, "El cliente no existe.");
    res.status(204).end();
  }));

  // ---------- Catalog ----------
  r.get("/catalog", h(() => {
    const cats = db.prepare("SELECT * FROM process_categories ORDER BY sort, name").all().map(plain);
    const types = db.prepare("SELECT * FROM process_types ORDER BY sort, name").all().map(plain);
    const fields = db.prepare("SELECT * FROM custom_fields ORDER BY sort, id").all().map(plain);
    return cats.map((c) => ({
      ...c,
      types: types.filter((t) => t.category_id === c.id),
      fields: fields
        .filter((f) => f.category_id === c.id)
        .map((f) => ({ ...f, options: JSON.parse(f.options), required: !!f.required })),
    }));
  }));

  const nextSort = (table, where = "", ...args) =>
    db.prepare(`SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM ${table} ${where}`).get(...args).n;

  r.post("/categories", h((req, res) => {
    const name = requireText(req.body?.name, "El nombre del tipo de proceso");
    const id = db.prepare("INSERT INTO process_categories (name, sort) VALUES (?, ?)")
      .run(name, nextSort("process_categories")).lastInsertRowid;
    res.status(201);
    return getOr404("SELECT * FROM process_categories WHERE id = ?", id, "El tipo de proceso");
  }));

  r.put("/categories/:id", h((req) => {
    const id = toInt(req.params.id, "id");
    getOr404("SELECT * FROM process_categories WHERE id = ?", id, "El tipo de proceso");
    db.prepare("UPDATE process_categories SET name = ? WHERE id = ?").run(requireText(req.body?.name, "El nombre"), id);
    return getOr404("SELECT * FROM process_categories WHERE id = ?", id, "El tipo de proceso");
  }));

  r.delete("/categories/:id", h((req, res) => {
    const { changes } = db.prepare("DELETE FROM process_categories WHERE id = ?").run(toInt(req.params.id, "id"));
    if (!changes) throw new HttpError(404, "El tipo de proceso no existe.");
    res.status(204).end();
  }));

  r.post("/categories/:id/types", h((req, res) => {
    const catId = toInt(req.params.id, "id");
    getOr404("SELECT * FROM process_categories WHERE id = ?", catId, "El tipo de proceso");
    const name = requireText(req.body?.name, "El nombre del subproceso");
    const id = db.prepare("INSERT INTO process_types (category_id, name, sort) VALUES (?, ?, ?)")
      .run(catId, name, nextSort("process_types", "WHERE category_id = ?", catId)).lastInsertRowid;
    res.status(201);
    return getOr404("SELECT * FROM process_types WHERE id = ?", id, "El subproceso");
  }));

  r.put("/types/:id", h((req) => {
    const id = toInt(req.params.id, "id");
    getOr404("SELECT * FROM process_types WHERE id = ?", id, "El subproceso");
    db.prepare("UPDATE process_types SET name = ? WHERE id = ?").run(requireText(req.body?.name, "El nombre"), id);
    return getOr404("SELECT * FROM process_types WHERE id = ?", id, "El subproceso");
  }));

  r.delete("/types/:id", h((req, res) => {
    const { changes } = db.prepare("DELETE FROM process_types WHERE id = ?").run(toInt(req.params.id, "id"));
    if (!changes) throw new HttpError(404, "El subproceso no existe.");
    res.status(204).end();
  }));

  r.post("/categories/:id/fields", h((req, res) => {
    const catId = toInt(req.params.id, "id");
    getOr404("SELECT * FROM process_categories WHERE id = ?", catId, "El tipo de proceso");
    const b = req.body ?? {};
    const label = requireText(b.label, "El nombre del campo");
    const type = FIELD_TYPES.includes(b.field_type) ? b.field_type : "text";
    const options = type === "select" ? (Array.isArray(b.options) ? b.options : []).map(str).filter(Boolean) : [];
    if (type === "select" && !options.length) throw new HttpError(400, "Una lista desplegable necesita opciones.");
    const id = db.prepare(`INSERT INTO custom_fields (category_id, label, field_type, options, required, sort)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(catId, label, type, JSON.stringify(options), b.required ? 1 : 0,
        nextSort("custom_fields", "WHERE category_id = ?", catId)).lastInsertRowid;
    res.status(201);
    const f = getOr404("SELECT * FROM custom_fields WHERE id = ?", id, "El campo");
    return { ...f, options: JSON.parse(f.options), required: !!f.required };
  }));

  r.delete("/fields/:id", h((req, res) => {
    const { changes } = db.prepare("DELETE FROM custom_fields WHERE id = ?").run(toInt(req.params.id, "id"));
    if (!changes) throw new HttpError(404, "El campo no existe.");
    res.status(204).end();
  }));

  // ---------- Cases ----------
  const CASE_SELECT = `
    SELECT k.*, c.full_name AS client_name, t.name AS type_name, t.category_id,
           g.name AS category_name
    FROM cases k
    JOIN clients c ON c.id = k.client_id
    JOIN process_types t ON t.id = k.process_type_id
    JOIN process_categories g ON g.id = t.category_id`;

  const caseOut = (row) => ({ ...plain(row), field_values: JSON.parse(row.field_values) });

  const getCase = (id) => {
    const row = db.prepare(`${CASE_SELECT} WHERE k.id = ?`).get(id);
    if (!row) throw new HttpError(404, "El expediente no existe.");
    return caseOut(row);
  };

  // Keep only values for fields defined on the case's category; enforce required ones.
  const cleanFieldValues = (typeId, values) => {
    const type = getOr404("SELECT * FROM process_types WHERE id = ?", typeId, "El subproceso");
    const fields = db.prepare("SELECT * FROM custom_fields WHERE category_id = ?").all(type.category_id);
    const out = {};
    for (const f of fields) {
      const v = str(values?.[f.id] ?? values?.[String(f.id)]);
      if (f.required && !v) throw new HttpError(400, `El campo "${f.label}" es obligatorio.`);
      if (v) out[f.id] = v;
    }
    return out;
  };

  r.get("/cases", h((req) => {
    const clientId = req.query.clientId ? toInt(req.query.clientId, "clientId") : null;
    const rows = clientId
      ? db.prepare(`${CASE_SELECT} WHERE k.client_id = ? ORDER BY k.updated_at DESC`).all(clientId)
      : db.prepare(`${CASE_SELECT} ORDER BY k.updated_at DESC`).all();
    return rows.map(caseOut);
  }));

  r.get("/cases/:id", h((req) => getCase(toInt(req.params.id, "id"))));

  r.post("/cases", h((req, res) => {
    const b = req.body ?? {};
    const clientId = toInt(b.client_id, "El cliente");
    getOr404("SELECT id FROM clients WHERE id = ?", clientId, "El cliente");
    const typeId = toInt(b.process_type_id, "El subproceso");
    const values = cleanFieldValues(typeId, b.field_values);
    const id = db.prepare(`INSERT INTO cases (client_id, process_type_id, title, status, counterparty, facts, field_values)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(clientId, typeId, str(b.title), str(b.status) || "Abierto", str(b.counterparty), str(b.facts),
        JSON.stringify(values)).lastInsertRowid;
    res.status(201);
    return getCase(id);
  }));

  r.put("/cases/:id", h((req) => {
    const id = toInt(req.params.id, "id");
    const cur = getCase(id);
    const b = req.body ?? {};
    const typeId = b.process_type_id ? toInt(b.process_type_id, "El subproceso") : cur.process_type_id;
    const values = cleanFieldValues(typeId, b.field_values ?? cur.field_values);
    db.prepare(`UPDATE cases SET process_type_id = ?, title = ?, status = ?, counterparty = ?, facts = ?,
      field_values = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(typeId, "title" in b ? str(b.title) : cur.title, str(b.status) || cur.status,
        "counterparty" in b ? str(b.counterparty) : cur.counterparty, "facts" in b ? str(b.facts) : cur.facts,
        JSON.stringify(values), id);
    return getCase(id);
  }));

  r.delete("/cases/:id", h((req, res) => {
    const { changes } = db.prepare("DELETE FROM cases WHERE id = ?").run(toInt(req.params.id, "id"));
    if (!changes) throw new HttpError(404, "El expediente no existe.");
    res.status(204).end();
  }));

  return r;
}
