// «Objetos contractuales» of the services contract (version 2.2.46). Mounted under /api/contract-objects.
// Everyone who makes documents reads the active list; only Gerencia (the administrator) creates, edits, orders and deletes.
import express from "express";
import { randomUUID } from "node:crypto";
import { HttpError, toInt } from "./http.js";
import { scopeOf, inTransaction } from "./auth.js";
import { objectValues, sortObjects } from "./contract-objects.js";

export const CONTRACT_OBJECTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS contract_objects (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
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

const ACTIONS = ["docx", "pdf", "save", "mail", "whatsapp", "sign"];

export function contractObjectsRouter(db) {
  const r = express.Router();
  const gerencia = (req, res, next) => (req.user.role === "Gerencia" ? next()
    : res.status(403).json({ error: "Su rol no tiene permiso para administrar los objetos contractuales (solo Gerencia)." }));

  const usesOf = db.prepare("SELECT COUNT(DISTINCT batch) AS n FROM contract_object_uses WHERE object_id = ?");
  const out = (o) => ({ ...o, is_active: !!o.is_active, uses: usesOf.get(o.id).n });
  const all = () => sortObjects(db.prepare("SELECT * FROM contract_objects").all());
  const find = (id) => db.prepare("SELECT * FROM contract_objects WHERE id = ?").get(toInt(id, "El objeto contractual")) || (() => { throw new HttpError(404, "El objeto contractual no existe."); })();

  // The checklist of the contract form: active objects only. Gerencia may ask for every one (?all=1) to manage them.
  r.get("/", (req, res) => {
    const list = all().filter((o) => o.is_active || (req.query.all === "1" && req.user.role === "Gerencia"));
    res.json(list.map(out));
  });

  r.post("/", gerencia, (req, res) => {
    const v = objectValues(req.body, null, all());
    if (typeof v === "string") throw new HttpError(400, v);
    const order = (db.prepare("SELECT MAX(display_order) AS m FROM contract_objects").get().m ?? 0) + 1;
    const id = db.prepare("INSERT INTO contract_objects (title, clause, is_active, display_order, created_by) VALUES (?, ?, ?, ?, ?)")
      .run(v.title, v.clause, v.is_active, order, req.user.id).lastInsertRowid;
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
    const v = objectValues(req.body, cur, all().filter((o) => o.id !== cur.id));
    if (typeof v === "string") throw new HttpError(400, v);
    db.prepare("UPDATE contract_objects SET title = ?, clause = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?").run(v.title, v.clause, v.is_active, cur.id);
    res.json(out(find(cur.id)));
  });

  // Deleting an object that already went into a contract only deactivates it (the history keeps its title);
  // one never used is removed.
  r.delete("/:id", gerencia, (req, res) => {
    const cur = find(req.params.id);
    if (usesOf.get(cur.id).n) {
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
    if (!ids.length) throw new HttpError(400, "Marque al menos un objeto contractual.");
    const objs = ids.map((id) => db.prepare("SELECT * FROM contract_objects WHERE id = ? AND is_active = 1").get(id));
    if (objs.some((o) => !o)) throw new HttpError(400, "Uno de los objetos contractuales ya no está disponible.");
    const action = ACTIONS.includes(b.action) ? b.action : "";
    const caseId = b.case_id ? toInt(b.case_id, "El expediente") : null;
    if (caseId) {
      const k = db.prepare("SELECT office_id FROM cases WHERE id = ?").get(caseId);
      const sc = scopeOf(req.user);
      if (!k || (sc !== null && !sc.includes(k.office_id))) throw new HttpError(404, "El expediente no existe.");
    }
    const batch = randomUUID();
    const ins = db.prepare("INSERT INTO contract_object_uses (batch, object_id, object_title, case_id, template_id, document_id, action, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    inTransaction(db, () => { for (const o of sortObjects(objs)) ins.run(batch, o.id, o.title, caseId, Number(b.template_id) || null, Number(b.document_id) || null, action, req.user.id); });
    res.status(201).json({ batch, objects: sortObjects(objs).map((o) => ({ id: o.id, title: o.title })) });
  });

  // Contracts of a case and the objects each one carried.
  r.get("/uses", (req, res) => {
    const caseId = toInt(req.query.case_id, "El expediente");
    const k = db.prepare("SELECT office_id FROM cases WHERE id = ?").get(caseId);
    const sc = scopeOf(req.user);
    if (!k || (sc !== null && !sc.includes(k.office_id))) throw new HttpError(404, "El expediente no existe.");
    const rows = db.prepare("SELECT batch, object_id, object_title, template_id, document_id, action, created_at FROM contract_object_uses WHERE case_id = ? ORDER BY id").all(caseId);
    const batches = new Map();
    for (const x of rows) {
      if (!batches.has(x.batch)) batches.set(x.batch, { batch: x.batch, action: x.action, template_id: x.template_id, document_id: x.document_id, created_at: x.created_at, objects: [] });
      batches.get(x.batch).objects.push({ id: x.object_id, title: x.object_title });
    }
    res.json([...batches.values()]);
  });

  return r;
}
