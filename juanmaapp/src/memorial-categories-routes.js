// Memorial categories (version 2.2.65). Mounted under /api/memorial-categories.
// Everyone who makes documents reads the active list; only Gerencia creates, edits, orders and deletes.
import express from "express";
import { HttpError, toInt } from "./http.js";
import { inTransaction } from "./auth.js";
import { categoryValues, sortCategories } from "./memorial-categories.js";

export const MEMORIAL_CATEGORIES_SCHEMA = `
CREATE TABLE IF NOT EXISTS memorial_categories (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

// A template belongs to at most one category; the column is only added, existing templates keep working (they show as «Otros memoriales»).
export function addMemorialColumn(db) {
  if (!db.prepare("PRAGMA table_info(document_templates)").all().some((x) => x.name === "memorial_category_id")) {
    db.exec("ALTER TABLE document_templates ADD COLUMN memorial_category_id INTEGER");
  }
}

export function memorialCategoriesRouter(db) {
  const r = express.Router();
  const gerencia = (req, res, next) => (req.user.role === "Gerencia" ? next()
    : res.status(403).json({ error: "Su rol no tiene permiso para administrar las categorías de memoriales (solo Gerencia)." }));
  const usesOf = db.prepare("SELECT COUNT(*) AS n FROM document_templates WHERE memorial_category_id = ?");
  const out = (o) => ({ ...o, is_active: !!o.is_active, templates: usesOf.get(o.id).n });
  const all = () => sortCategories(db.prepare("SELECT * FROM memorial_categories").all());
  const find = (id) => db.prepare("SELECT * FROM memorial_categories WHERE id = ?").get(toInt(id, "La categoría")) || (() => { throw new HttpError(404, "La categoría de memoriales no existe."); })();

  r.get("/", (req, res) => {
    res.json(all().filter((o) => o.is_active || (req.query.all === "1" && req.user.role === "Gerencia")).map(out));
  });

  r.post("/", gerencia, (req, res) => {
    const v = categoryValues(req.body, null, all());
    if (typeof v === "string") throw new HttpError(400, v);
    const order = (db.prepare("SELECT MAX(display_order) AS m FROM memorial_categories").get().m ?? 0) + 1;
    const id = db.prepare("INSERT INTO memorial_categories (title, description, is_active, display_order, created_by) VALUES (?, ?, ?, ?, ?)")
      .run(v.title, v.description, v.is_active, order, req.user.id).lastInsertRowid;
    res.status(201).json(out(find(id)));
  });

  r.put("/order", gerencia, (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
    const known = new Set(all().map((o) => o.id));
    if (!ids.length || ids.some((id) => !known.has(id)) || new Set(ids).size !== ids.length) throw new HttpError(400, "La lista de orden no es válida.");
    const rest = all().map((o) => o.id).filter((id) => !ids.includes(id));
    inTransaction(db, () => {
      const upd = db.prepare("UPDATE memorial_categories SET display_order = ?, updated_at = datetime('now') WHERE id = ?");
      [...ids, ...rest].forEach((id, i) => upd.run(i + 1, id));
    });
    res.json(all().map(out));
  });

  r.put("/:id", gerencia, (req, res) => {
    const cur = find(req.params.id);
    const v = categoryValues(req.body, cur, all().filter((o) => o.id !== cur.id));
    if (typeof v === "string") throw new HttpError(400, v);
    db.prepare("UPDATE memorial_categories SET title = ?, description = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?").run(v.title, v.description, v.is_active, cur.id);
    res.json(out(find(cur.id)));
  });

  // A category that still holds templates is only deactivated (its templates keep it and nothing is lost); an empty one is removed.
  r.delete("/:id", gerencia, (req, res) => {
    const cur = find(req.params.id);
    if (usesOf.get(cur.id).n) {
      db.prepare("UPDATE memorial_categories SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(cur.id);
      return res.json({ id: cur.id, deleted: false, deactivated: true });
    }
    db.prepare("DELETE FROM memorial_categories WHERE id = ?").run(cur.id);
    res.json({ id: cur.id, deleted: true, deactivated: false });
  });

  return r;
}
