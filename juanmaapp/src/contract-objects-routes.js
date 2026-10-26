// «Objetos contractuales» of the services contract (version 2.2.46). Mounted under /api/contract-objects.
// Everyone who makes documents reads the active list; only Gerencia (the administrator) creates, edits, orders and deletes.
import express from "express";
import { randomUUID } from "node:crypto";
import { HttpError, toInt } from "./http.js";
import { scopeOf, inTransaction } from "./auth.js";
import { objectValues, sortObjects, KINDS } from "./contract-objects.js";

export const CONTRACT_OBJECTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS contract_objects (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'contrato',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  clause TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Which objects each generated contract carried. No foreign key on purpose: the title is copied, so the history survives a deleted object.
CREATE TABLE IF NOT EXISTS contract_object_uses (
  id INTEGER PRIMARY KEY,
  batch TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'contrato',
  object_id INTEGER NOT NULL,
  object_title TEXT NOT NULL,
  case_id INTEGER,
  template_id INTEGER,
  document_id INTEGER,
  action TEXT NOT NULL DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS contract_object_uses_case ON contract_object_uses(case_id);
CREATE INDEX IF NOT EXISTS contract_object_uses_object ON contract_object_uses(object_id);`;

// Version 2.2.47: tables made by 2.2.46 get the two new columns (added, nothing existing is changed or removed).
export function addKindColumns(db) {
  const has = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c);
  if (!has("contract_objects", "kind")) db.exec("ALTER TABLE contract_objects ADD COLUMN kind TEXT NOT NULL DEFAULT 'contrato'");
  if (!has("contract_objects", "description")) db.exec("ALTER TABLE contract_objects ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  if (!has("contract_object_uses", "kind")) db.exec("ALTER TABLE contract_object_uses ADD COLUMN kind TEXT NOT NULL DEFAULT 'contrato'");
  db.exec("CREATE INDEX IF NOT EXISTS contract_objects_kind ON contract_objects(kind)");
}

const ACTIONS = ["docx", "pdf", "save", "mail", "whatsapp", "sign"];

// One router per kind: «contrato» (/api/contract-objects) and «poder» (/api/power-classes). Same rules, separate lists.
export function contractObjectsRouter(db, kind = "contrato") {
  const K = KINDS[kind];
  const r = express.Router();
  const gerencia = (req, res, next) => (req.user.role === "Gerencia" ? next()
    : res.status(403).json({ error: `Su rol no tiene permiso para administrar ${kind === "poder" ? "las clases de poder" : "los objetos contractuales"} (solo Gerencia).` }));

  const usesOf = db.prepare("SELECT COUNT(DISTINCT batch) AS n FROM contract_object_uses WHERE object_id = ? AND kind = ?");
  const out = (o) => ({ ...o, is_active: !!o.is_active, uses: usesOf.get(o.id, kind).n });
  const all = () => sortObjects(db.prepare("SELECT * FROM contract_objects WHERE kind = ?").all(kind));
  const find = (id) => db.prepare("SELECT * FROM contract_objects WHERE id = ? AND kind = ?").get(toInt(id, K.nounThe), kind) || (() => { throw new HttpError(404, `${K.nounThe} no existe.`); })();

  // The checklist of the contract form: active objects only. Gerencia may ask for every one (?all=1) to manage them.
  r.get("/", (req, res) => {
    const list = all().filter((o) => o.is_active || (req.query.all === "1" && req.user.role === "Gerencia"));
    res.json(list.map(out));
  });

  r.post("/", gerencia, (req, res) => {
    const v = objectValues(req.body, null, all(), kind);
    if (typeof v === "string") throw new HttpError(400, v);
    const order = (db.prepare("SELECT MAX(display_order) AS m FROM contract_objects WHERE kind = ?").get(kind).m ?? 0) + 1;
    const id = db.prepare("INSERT INTO contract_objects (kind, title, description, clause, is_active, display_order, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(kind, v.title, v.description, v.clause, v.is_active, order, req.user.id).lastInsertRowid;
    res.status(201).json(out(find(id)));
  });

  // Display order: the ids in the order they should appear; objects not listed keep their place after them.
  r.put("/order", gerencia, (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
    const known = new Set(all().map((o) => o.id));
    if (!ids.length || ids.some((id) => !known.has(id)) || new Set(ids).size !== ids.length) throw new HttpError(400, "La lista de orden no es válida.");
    const rest = all().map((o) => o.id).filter((id) => !ids.includes(id));
    inTransaction(db, () => {
      const upd = db.prepare("UPDATE contract_objects SET display_order = ?, updated_at = datetime('now') WHERE id = ?");
      [...ids, ...rest].forEach((id, i) => upd.run(i + 1, id));
    });
    res.json(all().map(out));
  });

  r.put("/:id", gerencia, (req, res) => {
    const cur = find(req.params.id);
    const v = objectValues(req.body, cur, all().filter((o) => o.id !== cur.id), kind);
    if (typeof v === "string") throw new HttpError(400, v);
    db.prepare("UPDATE contract_objects SET title = ?, description = ?, clause = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?").run(v.title, v.description, v.clause, v.is_active, cur.id);
    res.json(out(find(cur.id)));
  });

  // Deleting an object that already went into a contract only deactivates it (the history keeps its title);
  // one never used is removed.
  r.delete("/:id", gerencia, (req, res) => {
    const cur = find(req.params.id);
    if (usesOf.get(cur.id, kind).n) {
      db.prepare("UPDATE contract_objects SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(cur.id);
      return res.json({ id: cur.id, deleted: false, deactivated: true });
    }
    db.prepare("DELETE FROM contract_objects WHERE id = ?").run(cur.id);
    res.json({ id: cur.id, deleted: true, deactivated: false });
  });

  // Records which objects a generated contract carried (one batch per generation).
  r.post("/uses", (req, res) => {
    const b = req.body ?? {};
    const ids = [...new Set((Array.isArray(b.object_ids) ? b.object_ids : []).map(Number))];
    if (!ids.length) throw new HttpError(400, kind === "poder" ? "Marque al menos una clase de poder." : "Marque al menos un objeto contractual.");
    const objs = ids.map((id) => db.prepare("SELECT * FROM contract_objects WHERE id = ? AND kind = ? AND is_active = 1").get(id, kind));
    if (objs.some((o) => !o)) throw new HttpError(400, kind === "poder" ? "Una de las clases de poder ya no está disponible." : "Uno de los objetos contractuales ya no está disponible.");
    const action = ACTIONS.includes(b.action) ? b.action : "";
    const caseId = b.case_id ? toInt(b.case_id, "El expediente") : null;
    if (caseId) {
      const k = db.prepare("SELECT office_id FROM cases WHERE id = ?").get(caseId);
      const sc = scopeOf(req.user);
      if (!k || (sc !== null && !sc.includes(k.office_id))) throw new HttpError(404, "El expediente no existe.");
    }
    const batch = randomUUID();
    const ins = db.prepare("INSERT INTO contract_object_uses (batch, kind, object_id, object_title, case_id, template_id, document_id, action, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    inTransaction(db, () => { for (const o of sortObjects(objs)) ins.run(batch, kind, o.id, o.title, caseId, Number(b.template_id) || null, Number(b.document_id) || null, action, req.user.id); });
    res.status(201).json({ batch, objects: sortObjects(objs).map((o) => ({ id: o.id, title: o.title })) });
  });

  // Contracts of a case and the objects each one carried.
  r.get("/uses", (req, res) => {
    const caseId = toInt(req.query.case_id, "El expediente");
    const k = db.prepare("SELECT office_id FROM cases WHERE id = ?").get(caseId);
    const sc = scopeOf(req.user);
    if (!k || (sc !== null && !sc.includes(k.office_id))) throw new HttpError(404, "El expediente no existe.");
    const rows = db.prepare("SELECT batch, object_id, object_title, template_id, document_id, action, created_at FROM contract_object_uses WHERE case_id = ? AND kind = ? ORDER BY id").all(caseId, kind);
    const batches = new Map();
    for (const x of rows) {
      if (!batches.has(x.batch)) batches.set(x.batch, { batch: x.batch, action: x.action, template_id: x.template_id, document_id: x.document_id, created_at: x.created_at, objects: [] });
      batches.get(x.batch).objects.push({ id: x.object_id, title: x.object_title });
    }
    res.json([...batches.values()]);
  });

  return r;
}
