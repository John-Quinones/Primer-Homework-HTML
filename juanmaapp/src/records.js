// REST routes for clients, the process catalog (categories → sub-processes →
// custom fields) and cases. Mounted under /api by app.js.
import express from "express";
import { createHash } from "node:crypto";
import { typePath } from "./sql.js";
import { can, scopeOf, loadUser } from "./auth.js";
import { normStatus, normPartyRole, cleanParties, isFolderLabel, folderKey, nextFolder } from "./case-meta.js";
import { personFields, clientMatches, properAddress, properPhone } from "./person.js";
import { AREAS, canonicalDepartment, canonicalCity, normalizeRadicado, placeFromRadicado } from "./places.js";
import { formatRadicado } from "./portals.js";

const FIELD_TYPES = ["text", "textarea", "number", "date", "select"];
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
const PHOTO_MAX = 1_500_000; // characters of the data URL (about 1.1 MB of image)
const CLIENT_FIELDS = ["full_name", "id_type", "id_number", "email", "phone", "address", "department", "city", "notes", "office_id",
  "person_type", "first_names", "last_names", "legal_rep"];
const NAME_FIELDS = ["full_name", "id_type", "person_type", "first_names", "last_names", "legal_rep"];

const fail400 = (msg) => { throw new HttpError(400, msg); };

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

  // ----- Office scope -----
  const mainOffice = () => db.prepare("SELECT id FROM offices WHERE is_main = 1").get().id;
  const inScope = (req, officeId) => {
    const sc = scopeOf(req.user);
    return sc === null || sc.includes(Number(officeId));
  };
  // SQL fragment + params limiting rows to the user's offices.
  const scopeSql = (req, col) => {
    const sc = scopeOf(req.user);
    if (sc === null) return ["1 = 1", []];
    if (!sc.length) return ["0 = 1", []];
    return [`${col} IN (${sc.map(() => "?").join(",")})`, sc];
  };
  const checkPerm = (req, perm) => {
    if (!can(req, perm)) throw new HttpError(403, "Su rol no tiene permiso para esta acción.");
  };
  // A client is visible if it belongs to one of the user's offices or has a case there.
  const clientVisible = (req, clientId) => {
    const [w, p] = scopeSql(req, "office_id");
    return !!db.prepare(`SELECT id FROM clients WHERE id = ? AND (${w} OR id IN (SELECT client_id FROM cases WHERE ${w}))`)
      .get(clientId, ...p, ...p);
  };
  const officeFor = (req, requested, fallback) => {
    let id = requested ? Number(requested) : fallback;
    if (!id) {
      const sc = scopeOf(req.user);
      id = sc === null ? mainOffice() : sc[0];
    }
    if (!db.prepare("SELECT id FROM offices WHERE id = ?").get(id)) throw new HttpError(400, "La oficina no existe.");
    if (!inScope(req, id)) throw new HttpError(403, "No tiene acceso a esa oficina.");
    return id;
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
  const clientValues = (req, body, existing = {}) => {
    const v = {};
    for (const f of CLIENT_FIELDS) if (f !== "office_id" && !NAME_FIELDS.includes(f)) v[f] = f in body ? str(body[f]) : existing[f] ?? "";
    // Names in proper case, split into first and last names; legal entities use their business name and NIT.
    try { Object.assign(v, personFields(body, existing)); } catch (err) { throw new HttpError(400, err.message); }
    v.id_number = v.id_number.replace(/\s+/g, "");
    v.department = canonicalDepartment(v.department) || (v.department ? fail400("Departamento no reconocido.") : "");
    v.city = canonicalCity(v.city, v.department);
    v.address = properAddress(v.address);
    v.phone = properPhone(v.phone);
    v.office_id = officeFor(req, body.office_id, existing.office_id);
    return v;
  };
  const getClient = (req, id) => {
    const c = getOr404(`SELECT c.*, o.name AS office_name, p.photo FROM clients c LEFT JOIN offices o ON o.id = c.office_id
      LEFT JOIN client_photos p ON p.client_id = c.id WHERE c.id = ?`, id, "El cliente");
    if (!clientVisible(req, id)) throw new HttpError(404, "El cliente no existe.");
    return { ...c, photo: c.photo || "", has_photo: !!c.photo };
  };

  r.get("/clients", h((req) => {
    const q = str(req.query.q), by = str(req.query.by);
    const [kw, kp] = scopeSql(req, "k.office_id");
    const [cw, cp] = scopeSql(req, "c.office_id");
    const [sw, sp] = scopeSql(req, "office_id");
    return db.prepare(`
      SELECT c.*, o.name AS office_name, EXISTS (SELECT 1 FROM client_photos p WHERE p.client_id = c.id) AS has_photo,
        (SELECT COUNT(*) FROM cases k WHERE (k.client_id = c.id OR EXISTS (SELECT 1 FROM json_each(k.parties) j
          WHERE json_extract(j.value, '$.client_id') = c.id AND json_extract(j.value, '$.ours') = 1)) AND ${kw}) AS case_count
      FROM clients c LEFT JOIN offices o ON o.id = c.office_id
      WHERE (${cw} OR c.id IN (SELECT client_id FROM cases WHERE ${sw}))
      ORDER BY c.full_name COLLATE NOCASE`).all(...kp, ...cp, ...sp).map(plain).filter((c) => clientMatches(c, q, by));
  }));

  r.get("/clients/:id", h((req) => getClient(req, toInt(req.params.id, "id"))));

  r.post("/clients", h((req, res) => {
    checkPerm(req, "clients.write");
    const v = clientValues(req, req.body ?? {});
    const id = db.prepare(`INSERT INTO clients (${CLIENT_FIELDS.join(",")})
      VALUES (${CLIENT_FIELDS.map((f) => ":" + f).join(",")})`).run(v).lastInsertRowid;
    res.status(201);
    return getClient(req, id);
  }));

  r.put("/clients/:id", h((req) => {
    checkPerm(req, "clients.write");
    const id = toInt(req.params.id, "id");
    const v = clientValues(req, req.body ?? {}, getClient(req, id));
    db.prepare(`UPDATE clients SET ${CLIENT_FIELDS.map((f) => `${f} = :${f}`).join(", ")} WHERE id = :id`).run({ ...v, id });
    return getClient(req, id);
  }));

  // Optional photo (version 2.22): taken with the camera or uploaded, sent as a small JPEG/PNG/WebP data URL; "" removes it.
  r.put("/clients/:id/photo", h((req) => {
    checkPerm(req, "clients.write");
    const id = toInt(req.params.id, "id");
    getClient(req, id);
    const photo = str(req.body?.photo);
    if (!photo) db.prepare("DELETE FROM client_photos WHERE client_id = ?").run(id);
    else {
      if (!PHOTO_RE.test(photo)) fail400("La foto debe ser una imagen JPG, PNG o WebP.");
      if (photo.length > PHOTO_MAX) fail400("La foto es demasiado grande. Use una imagen más pequeña.");
      db.prepare(`INSERT INTO client_photos (client_id, photo) VALUES (?, ?)
        ON CONFLICT(client_id) DO UPDATE SET photo = excluded.photo, updated_at = datetime('now')`).run(id, photo);
    }
    return getClient(req, id);
  }));

  r.delete("/clients/:id", h((req, res) => {
    checkPerm(req, "clients.delete");
    const id = toInt(req.params.id, "id");
    getClient(req, id);
    db.prepare("DELETE FROM clients WHERE id = ?").run(id);
    res.status(204).end();
  }));

  // ---------- Catalog ----------
  r.get("/catalog", h(() => {
    const cats = db.prepare("SELECT * FROM process_categories ORDER BY sort, name").all().map(plain);
    // Types come flat with parent_id; the page nests second-order ones. "uses" counts cases (own + children).
    const types = db.prepare(`SELECT t.*, ${typePath("t")} AS path,
        (SELECT COUNT(*) FROM cases k WHERE k.process_type_id = t.id
           OR k.process_type_id IN (SELECT id FROM process_types WHERE parent_id = t.id)) AS uses
      FROM process_types t ORDER BY t.sort, t.name`).all().map(plain);
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
    checkPerm(req, "catalog.manage");
    const name = requireText(req.body?.name, "El nombre del tipo de proceso");
    const id = db.prepare("INSERT INTO process_categories (name, sort) VALUES (?, ?)")
      .run(name, nextSort("process_categories")).lastInsertRowid;
    res.status(201);
    return getOr404("SELECT * FROM process_categories WHERE id = ?", id, "El tipo de proceso");
  }));

  r.put("/categories/:id", h((req) => {
    checkPerm(req, "catalog.manage");
    const id = toInt(req.params.id, "id");
    getOr404("SELECT * FROM process_categories WHERE id = ?", id, "El tipo de proceso");
    db.prepare("UPDATE process_categories SET name = ? WHERE id = ?").run(requireText(req.body?.name, "El nombre"), id);
    return getOr404("SELECT * FROM process_categories WHERE id = ?", id, "El tipo de proceso");
  }));

  r.delete("/categories/:id", h((req, res) => {
    checkPerm(req, "catalog.manage");
    const { changes } = db.prepare("DELETE FROM process_categories WHERE id = ?").run(toInt(req.params.id, "id"));
    if (!changes) throw new HttpError(404, "El tipo de proceso no existe.");
    res.status(204).end();
  }));

  r.post("/categories/:id/types", h((req, res) => {
    checkPerm(req, "catalog.manage");
    const catId = toInt(req.params.id, "id");
    getOr404("SELECT * FROM process_categories WHERE id = ?", catId, "El tipo de proceso");
    const name = requireText(req.body?.name, "El nombre del subproceso");
    // Two levels only: a second-order sub-process hangs from a first-order one of the same category.
    const parentId = req.body?.parent_id ? toInt(req.body.parent_id, "El subproceso padre") : null;
    if (parentId) {
      const parent = getOr404("SELECT * FROM process_types WHERE id = ?", parentId, "El subproceso padre");
      if (parent.category_id !== catId || parent.parent_id) throw new HttpError(400, "Solo se admiten subprocesos de segundo orden bajo un subproceso principal.");
    }
    const id = db.prepare("INSERT INTO process_types (category_id, parent_id, name, sort) VALUES (?, ?, ?, ?)")
      .run(catId, parentId, name, nextSort("process_types", "WHERE category_id = ? AND COALESCE(parent_id, 0) = ?", catId, parentId || 0)).lastInsertRowid;
    res.status(201);
    return getOr404("SELECT * FROM process_types WHERE id = ?", id, "El subproceso");
  }));

  // Manual order (drag or arrows): ids of siblings in their new order.
  r.put("/categories/:id/order", h((req) => {
    checkPerm(req, "catalog.manage");
    const catId = toInt(req.params.id, "id");
    const ids = (req.body?.type_ids || []).map(Number);
    const rows = db.prepare(`SELECT id, parent_id FROM process_types WHERE category_id = ? AND id IN (${ids.map(() => "?").join(",") || "NULL"})`).all(catId, ...ids);
    if (rows.length !== ids.length || new Set(rows.map((x) => x.parent_id ?? 0)).size > 1) {
      throw new HttpError(400, "Solo se pueden ordenar subprocesos del mismo nivel.");
    }
    const upd = db.prepare("UPDATE process_types SET sort = ? WHERE id = ?");
    ids.forEach((id, i) => upd.run(i, id));
    return { ok: true };
  }));

  // Most-used first, at every level of the category.
  r.post("/categories/:id/sort-by-usage", h((req) => {
    checkPerm(req, "catalog.manage");
    const catId = toInt(req.params.id, "id");
    const rows = db.prepare(`SELECT t.id, COALESCE(t.parent_id, 0) AS parent,
        (SELECT COUNT(*) FROM cases k WHERE k.process_type_id = t.id
           OR k.process_type_id IN (SELECT id FROM process_types WHERE parent_id = t.id)) AS uses
      FROM process_types t WHERE t.category_id = ? ORDER BY parent, uses DESC, t.sort`).all(catId);
    const upd = db.prepare("UPDATE process_types SET sort = ? WHERE id = ?");
    const pos = new Map();
    for (const r of rows) { const i = pos.get(r.parent) ?? 0; upd.run(i, r.id); pos.set(r.parent, i + 1); }
    return { ok: true };
  }));

  r.put("/category-order", h((req) => {
    checkPerm(req, "catalog.manage");
    const upd = db.prepare("UPDATE process_categories SET sort = ? WHERE id = ?");
    (req.body?.ids || []).map(Number).forEach((id, i) => upd.run(i, id));
    return { ok: true };
  }));

  r.put("/categories/:id/fields/order", h((req) => {
    checkPerm(req, "catalog.manage");
    const upd = db.prepare("UPDATE custom_fields SET sort = ? WHERE id = ? AND category_id = ?");
    const catId = toInt(req.params.id, "id");
    (req.body?.field_ids || []).map(Number).forEach((id, i) => upd.run(i, id, catId));
    return { ok: true };
  }));

  r.put("/types/:id", h((req) => {
    checkPerm(req, "catalog.manage");
    const id = toInt(req.params.id, "id");
    getOr404("SELECT * FROM process_types WHERE id = ?", id, "El subproceso");
    db.prepare("UPDATE process_types SET name = ? WHERE id = ?").run(requireText(req.body?.name, "El nombre"), id);
    return getOr404("SELECT * FROM process_types WHERE id = ?", id, "El subproceso");
  }));

  r.delete("/types/:id", h((req, res) => {
    checkPerm(req, "catalog.manage");
    const { changes } = db.prepare("DELETE FROM process_types WHERE id = ?").run(toInt(req.params.id, "id"));
    if (!changes) throw new HttpError(404, "El subproceso no existe.");
    res.status(204).end();
  }));

  r.post("/categories/:id/fields", h((req, res) => {
    checkPerm(req, "catalog.manage");
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
    checkPerm(req, "catalog.manage");
    const { changes } = db.prepare("DELETE FROM custom_fields WHERE id = ?").run(toInt(req.params.id, "id"));
    if (!changes) throw new HttpError(404, "El campo no existe.");
    res.status(204).end();
  }));

  // ---------- Cases ----------
  const CASE_SELECT = `
    SELECT k.*, c.full_name AS client_name, ${typePath("t")} AS type_name, t.category_id,
           g.name AS category_name, o.name AS office_name, u.name AS assigned_name
    FROM cases k
    JOIN clients c ON c.id = k.client_id
    JOIN process_types t ON t.id = k.process_type_id
    JOIN process_categories g ON g.id = t.category_id
    LEFT JOIN offices o ON o.id = k.office_id
    LEFT JOIN users_shown u ON u.id = k.assigned_user_id`;

  const caseOut = (row) => ({ ...plain(row), field_values: JSON.parse(row.field_values), affiliated: !!row.affiliated, parties: JSON.parse(row.parties || "[]") });
  // Our clients among the parties are linked to their client record (given, or found by document number).
  const PARTY_CLIENT = "EXISTS (SELECT 1 FROM json_each(k.parties) j WHERE json_extract(j.value, '$.client_id') = ? AND json_extract(j.value, '$.ours') = 1)";
  function caseParties(req, list, mainClientId) {
    const { parties, error } = cleanParties(list);
    if (error) throw new HttpError(400, error);
    const digits = (x) => String(x || "").replace(/\D/g, "");
    for (const p of parties) {
      if (p.client_id && !clientVisible(req, p.client_id)) p.client_id = null;
      if (p.ours && !p.client_id && digits(p.id_number).length >= 5) {
        const found = db.prepare("SELECT id, id_number FROM clients").all().find((c) => digits(c.id_number) === digits(p.id_number));
        if (found && clientVisible(req, found.id)) p.client_id = found.id;
      }
      if (!p.ours) p.client_id = null;
    }
    return JSON.stringify(parties.filter((p) => p.client_id !== mainClientId));
  }
  const partyRole = (x) => {
    const r = normPartyRole(x);
    if (r === null) throw new HttpError(400, `Calidad del cliente no válida: ${x}`);
    return r;
  };

  const getCase = (req, id) => {
    const row = db.prepare(`${CASE_SELECT} WHERE k.id = ?`).get(id);
    if (!row || !inScope(req, row.office_id)) throw new HttpError(404, "El expediente no existe.");
    return caseOut(row);
  };
  // Place, area, court and radicado of a case. A 23-digit radicado fills the
  // department and city (its first five digits are the DANE municipality code).
  const caseLocation = (b, cur = {}) => {
    const pick = (k) => (k in b ? str(b[k]) : cur[k] ?? "");
    const radicado = normalizeRadicado(pick("radicado"));
    if (radicado && radicado.length !== 23) throw new HttpError(400, "El radicado debe tener 23 dígitos.");
    let department = canonicalDepartment(pick("department"));
    if (pick("department") && !department) throw new HttpError(400, "Departamento no reconocido.");
    let city = canonicalCity(pick("city"), department);
    const fromRad = radicado ? placeFromRadicado(radicado) : null;
    if (fromRad && !department) { department = fromRad.department; city = city || fromRad.city; }
    const area = pick("area");
    if (area && !AREAS.includes(area)) throw new HttpError(400, "Área no válida.");
    let courtId = "court_id" in b ? (b.court_id ? toInt(b.court_id, "El despacho") : null) : cur.court_id ?? null;
    let courtName = pick("court_name"), courtEmail = pick("court_email");
    if (courtId) {
      const c = db.prepare("SELECT * FROM courts WHERE id = ?").get(courtId);
      if (!c) throw new HttpError(400, "El despacho no existe en el directorio.");
      courtName = c.name;
      courtEmail = c.email;
      department ||= c.department;
      city ||= c.city;
    }
    const monitor = "monitor" in b ? (b.monitor ? 1 : 0) : cur.monitor ?? (radicado ? 1 : 0);
    return { department, city, area: area || (courtId ? db.prepare("SELECT area FROM courts WHERE id = ?").get(courtId).area : ""),
      court_id: courtId, court_name: courtName, court_email: courtEmail, radicado, monitor: radicado ? monitor : 0 };
  };

  // The responsible person must be an active user of the case's office (or see all offices).
  const checkAssignee = (userId, officeId) => {
    if (!userId) return null;
    const u = loadUser(db, userId);
    if (!u?.active) throw new HttpError(400, "El responsable no existe o está inactivo.");
    if (scopeOf(u) !== null && !scopeOf(u).includes(officeId)) throw new HttpError(400, "El responsable no pertenece a la oficina del expediente.");
    return u.id;
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
    const [w, p] = scopeSql(req, "k.office_id");
    const where = [w];
    const params = [...p];
    if (req.query.clientId) { const cid = toInt(req.query.clientId, "clientId"); where.push(`(k.client_id = ? OR ${PARTY_CLIENT})`); params.push(cid, cid); }
    if (req.query.officeId) { where.push("k.office_id = ?"); params.push(toInt(req.query.officeId, "officeId")); }
    if (req.query.mine === "1") { where.push("k.assigned_user_id = ?"); params.push(req.user.id); }
    return db.prepare(`${CASE_SELECT} WHERE ${where.join(" AND ")} ORDER BY k.updated_at DESC`).all(...params).map(caseOut);
  }));

  r.get("/cases/:id", h((req) => getCase(req, toInt(req.params.id, "id"))));

  r.post("/cases", h((req, res) => {
    checkPerm(req, "cases.write");
    const b = req.body ?? {};
    const clientId = toInt(b.client_id, "El cliente");
    getOr404("SELECT id FROM clients WHERE id = ?", clientId, "El cliente");
    if (!clientVisible(req, clientId)) throw new HttpError(404, "El cliente no existe.");
    const officeId = officeFor(req, b.office_id, null);
    const assignee = checkAssignee(b.assigned_user_id ? toInt(b.assigned_user_id, "El responsable") : null, officeId);
    const typeId = toInt(b.process_type_id, "El subproceso");
    const values = cleanFieldValues(typeId, b.field_values);
    const loc = caseLocation(b);
    const id = db.prepare(`INSERT INTO cases (client_id, process_type_id, title, status, counterparty, facts, field_values, office_id, assigned_user_id,
        department, city, area, court_id, court_name, court_email, radicado, monitor, client_role, affiliated, parties, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`)
      .run(clientId, typeId, str(b.title), normStatus(b.status), str(b.counterparty), str(b.facts),
        JSON.stringify(values), officeId, assignee, loc.department, loc.city, loc.area, loc.court_id, loc.court_name,
        loc.court_email, loc.radicado, loc.monitor, partyRole(b.client_role), b.affiliated ? 1 : 0, caseParties(req, b.parties, clientId),
        // Imported cases keep the date they were opened in the previous system.
        /^\d{4}-\d{2}-\d{2}$/.test(str(b.created_at)) && !Number.isNaN(Date.parse(b.created_at)) ? `${b.created_at} 00:00:00` : null).lastInsertRowid;
    res.status(201);
    return getCase(req, id);
  }));

  r.put("/cases/:id", h((req) => {
    checkPerm(req, "cases.write");
    const id = toInt(req.params.id, "id");
    const cur = getCase(req, id);
    const b = req.body ?? {};
    const typeId = b.process_type_id ? toInt(b.process_type_id, "El subproceso") : cur.process_type_id;
    const values = cleanFieldValues(typeId, b.field_values ?? cur.field_values);
    const officeId = officeFor(req, b.office_id, cur.office_id);
    const assignee = "assigned_user_id" in b
      ? checkAssignee(b.assigned_user_id ? toInt(b.assigned_user_id, "El responsable") : null, officeId)
      : cur.assigned_user_id && officeId !== cur.office_id ? null : cur.assigned_user_id;
    const loc = caseLocation(b, cur);
    db.prepare(`UPDATE cases SET process_type_id = ?, title = ?, status = ?, counterparty = ?, facts = ?,
      field_values = ?, office_id = ?, assigned_user_id = ?, department = ?, city = ?, area = ?, court_id = ?,
      court_name = ?, court_email = ?, radicado = ?, monitor = ?, client_role = ?, affiliated = ?, parties = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(typeId, "title" in b ? str(b.title) : cur.title, str(b.status) ? normStatus(b.status) : cur.status,
        "counterparty" in b ? str(b.counterparty) : cur.counterparty, "facts" in b ? str(b.facts) : cur.facts,
        JSON.stringify(values), officeId, assignee, loc.department, loc.city, loc.area, loc.court_id, loc.court_name,
        loc.court_email, loc.radicado, loc.monitor, "client_role" in b ? partyRole(b.client_role) : cur.client_role,
        "affiliated" in b ? (b.affiliated ? 1 : 0) : cur.affiliated ? 1 : 0, "parties" in b ? caseParties(req, b.parties, cur.client_id) : JSON.stringify(cur.parties), id);
    return getCase(req, id);
  }));

  // ----- Folder numbers (version 2.18): set or change them from the client screen -----
  // The number lives in the "No. Carpeta" field of the case's process type; a type without
  // that field gets it when its first number is assigned. A number is used by one case only.
  const folderFields = () => db.prepare("SELECT id, category_id, label, required FROM custom_fields ORDER BY id").all().filter((f) => isFolderLabel(f.label));
  const usedFolders = () => {
    const ids = folderFields().map((f) => String(f.id));
    return db.prepare(`SELECT k.id, k.client_id, k.title, k.field_values, c.full_name, ${typePath("pt")} AS type_name FROM cases k JOIN clients c ON c.id = k.client_id
        JOIN process_types pt ON pt.id = k.process_type_id`).all()
      .flatMap((k) => { const v = JSON.parse(k.field_values || "{}"); return ids.map((i) => str(v[i])).filter(Boolean).map((folder) => ({ case_id: k.id, client_id: k.client_id, client: k.full_name, name: k.title || k.type_name, folder })); });
  };
  r.get("/folders/next", h(() => ({ next: nextFolder(usedFolders().map((x) => x.folder)) })));
  r.put("/cases/:id/folder", h((req) => {
    checkPerm(req, "cases.write");
    const cur = getCase(req, toInt(req.params.id, "id"));
    const folder = str(req.body?.folder).slice(0, 40);
    const catId = db.prepare("SELECT category_id FROM process_types WHERE id = ?").get(cur.process_type_id).category_id;
    const mine = folderFields().filter((f) => f.category_id === catId);
    if (!folder && mine.some((f) => f.required)) fail400("El número de carpeta es obligatorio en este tipo de proceso.");
    if (folder) {
      const other = usedFolders().find((x) => x.case_id !== cur.id && folderKey(x.folder) === folderKey(folder));
      if (other) fail400(`La carpeta ${other.folder} ya está asignada ${clientVisible(req, other.client_id) ? `al expediente «${other.name}» de ${other.client}` : "a otro expediente"}. Escriba otro número.`);
    }
    const values = { ...cur.field_values };
    for (const f of mine) delete values[f.id];
    if (folder) {
      const id = mine[0]?.id ?? db.prepare("INSERT INTO custom_fields (category_id, label, field_type, options, required, sort) VALUES (?, 'No. Carpeta', 'text', '[]', 0, ?)")
        .run(catId, nextSort("custom_fields", "WHERE category_id = ?", catId)).lastInsertRowid;
      values[id] = folder;
    }
    db.prepare("UPDATE cases SET field_values = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(values), cur.id);
    return getCase(req, cur.id);
  }));

  // «Cargar radicados» (version 2.24): one radicado per case, 23 digits, used by one case only.
  // Changing or removing one already saved needs replace: true (the screen asks first).
  r.put("/cases/:id/radicado", h((req) => {
    checkPerm(req, "cases.write");
    const cur = getCase(req, toInt(req.params.id, "id"));
    const radicado = normalizeRadicado(req.body?.radicado);
    if (radicado && radicado.length !== 23) fail400(`El radicado debe tener 23 dígitos (tiene ${radicado.length}).`);
    if (radicado === cur.radicado) return cur;
    if (cur.radicado && !req.body?.replace) fail400(`Este expediente ya tiene el radicado ${formatRadicado(cur.radicado)}. Confirme si quiere cambiarlo.`);
    if (radicado) {
      const other = db.prepare(`SELECT k.id, k.client_id, k.title, c.full_name, ${typePath("pt")} AS type_name FROM cases k JOIN clients c ON c.id = k.client_id
        JOIN process_types pt ON pt.id = k.process_type_id WHERE k.radicado = ? AND k.id <> ?`).get(radicado, cur.id);
      if (other) fail400(`El radicado ${formatRadicado(radicado)} ya está en ${clientVisible(req, other.client_id) ? `el expediente «${other.title || other.type_name}» de ${other.full_name}` : "otro expediente"}.`);
    }
    const place = radicado && !cur.department ? placeFromRadicado(radicado) : null;
    // A new radicado turns the automatic consultation on; a changed one keeps what the case had.
    const monitor = !radicado ? 0 : cur.radicado ? (cur.monitor ? 1 : 0) : 1;
    db.prepare("UPDATE cases SET radicado = ?, monitor = ?, department = ?, city = ?, updated_at = datetime('now') WHERE id = ?")
      .run(radicado, monitor, place?.department || cur.department || "", place ? cur.city || place.city : cur.city || "", cur.id);
    return getCase(req, cur.id);
  }));

  // ----- Documents saved to a case (Word / PDF generated in Documentos) -----
  const DOC_TYPES = { docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pdf: "application/pdf" };
  r.get("/cases/:id/documents", h((req) => {
    const k = getCase(req, toInt(req.params.id, "id"));
    return db.prepare(`SELECT d.id, d.case_id, d.name, d.filename, d.mime, d.size, d.sha256, d.created_at, u.name AS created_by_name
      FROM case_documents d LEFT JOIN users_shown u ON u.id = d.created_by WHERE d.case_id = ? ORDER BY d.id DESC`).all(k.id).map(plain);
  }));
  r.post("/cases/:id/documents", h((req, res) => {
    checkPerm(req, "cases.write");
    const k = getCase(req, toInt(req.params.id, "id"));
    const b = req.body ?? {};
    const ext = String(b.filename || "").toLowerCase().match(/\.(docx|pdf)$/)?.[1];
    if (!ext) throw new HttpError(400, "Solo se guardan archivos Word (.docx) o PDF.");
    const file = Buffer.from(String(b.file_base64 || ""), "base64");
    if (!file.length || file.length > 10 * 1024 * 1024) throw new HttpError(400, "El archivo debe pesar menos de 10 MB.");
    const magic = file.subarray(0, 5).toString("latin1");
    if (ext === "pdf" ? magic !== "%PDF-" : !magic.startsWith("PK")) throw new HttpError(400, "El archivo no corresponde a su formato.");
    const name = str(b.name) || str(b.filename);
    const id = db.prepare(`INSERT INTO case_documents (case_id, name, filename, mime, size, sha256, file, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(k.id, name.slice(0, 200), str(b.filename).slice(0, 200), DOC_TYPES[ext], file.length, createHash("sha256").update(file).digest("hex"), file, req.user.id).lastInsertRowid;
    res.status(201);
    return plain(db.prepare("SELECT id, case_id, name, filename, mime, size, sha256, created_at FROM case_documents WHERE id = ?").get(id));
  }));
  const getDoc = (req) => {
    const d = db.prepare("SELECT * FROM case_documents WHERE id = ?").get(toInt(req.params.docId, "docId"));
    if (!d || d.case_id !== toInt(req.params.id, "id")) throw new HttpError(404, "El documento no existe.");
    getCase(req, d.case_id);
    return d;
  };
  r.get("/cases/:id/documents/:docId/file", h((req) => {
    const d = getDoc(req);
    return { filename: d.filename, mime: d.mime, base64: Buffer.from(d.file).toString("base64") };
  }));
  r.delete("/cases/:id/documents/:docId", h((req, res) => {
    checkPerm(req, "cases.write");
    db.prepare("DELETE FROM case_documents WHERE id = ?").run(getDoc(req).id);
    res.status(204).end();
  }));

  r.delete("/cases/:id", h((req, res) => {
    checkPerm(req, "cases.delete");
    const id = toInt(req.params.id, "id");
    getCase(req, id);
    db.prepare("DELETE FROM cases WHERE id = ?").run(id);
    res.status(204).end();
  }));

  return r;
}
