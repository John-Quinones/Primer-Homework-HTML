// Party categories (version 2.2.87). Mounted under /api/party-categories.
// Everyone who opens a case reads the active list; only Gerencia creates, edits, orders and deletes.
import express from "express";
import { HttpError, toInt } from "./http.js";
import { inTransaction } from "./auth.js";
import { setPartyCategories } from "./case-meta.js";
import { categoryValues, categoryUses, sortCategories, DEFAULT_ROLES, LEGACY_ROLES, DEFAULT_CONDITIONS } from "./party-categories.js";

export const PARTY_CATEGORIES_SCHEMA = `
CREATE TABLE IF NOT EXISTS party_categories (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  plural TEXT NOT NULL DEFAULT '',
  side TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'rol',
  flag TEXT NOT NULL DEFAULT '',
  pair_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

/** The starter list, created once and only when the table is empty; the cases already loaded keep their marks (nothing is rewritten). */
export function seedPartyCategories(db) {
  if (db.prepare("SELECT 1 FROM party_categories LIMIT 1").get()) return;
  const ins = db.prepare("INSERT INTO party_categories (title, plural, side, kind, flag, is_active, display_order) VALUES (?, ?, ?, ?, ?, ?, ?)");
  let order = 0;
  const ids = new Map();
  for (const [t, p, side] of DEFAULT_ROLES) ids.set(t, Number(ins.run(t, p, side, "rol", "", 1, ++order).lastInsertRowid));
  for (const [t, p, side] of LEGACY_ROLES) ins.run(t, p, side, "rol", "", 0, ++order);
  for (const [t, p, flag] of DEFAULT_CONDITIONS) ins.run(t, p, "", "condicion", flag, 1, ++order);
  const pair = db.prepare("UPDATE party_categories SET pair_id = ? WHERE id = ?");
  for (const [t, , , other] of DEFAULT_ROLES) if (other) pair.run(ids.get(other), ids.get(t));
}

/** Registers the stored list in case-meta so sides, labels and role names follow it. */
export function refreshPartyCategories(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'party_categories'").get()) return;
  setPartyCategories(sortCategories(db.prepare("SELECT * FROM party_categories").all()));
}

export function partyCategoriesRouter(db) {
  const r = express.Router();
  const gerencia = (req, res, next) => (req.user.role === "Gerencia" ? next()
    : res.status(403).json({ error: "Su rol no tiene permiso para administrar las categorías de partes (solo Gerencia)." }));
  const cases = () => db.prepare("SELECT client_role, parties FROM cases").all();
  const all = () => sortCategories(db.prepare("SELECT * FROM party_categories").all());
  const out = (o, list = cases()) => ({ ...o, is_active: !!o.is_active, uses: o.kind === "condicion" ? db.prepare(`SELECT COUNT(*) AS n FROM cases WHERE ${o.flag} = 1`).get().n : categoryUses(o.title, list) });
  const outAll = () => { const list = cases(); return all().map((o) => out(o, list)); };
  const find = (id) => db.prepare("SELECT * FROM party_categories WHERE id = ?").get(toInt(id, "La categoría")) || (() => { throw new HttpError(404, "La categoría de partes no existe."); })();

  r.get("/", (req, res) => {
    // `all=1` (also inactive ones) is how the page learns the side of a role that was deactivated but is still on some cases.
    res.json(outAll().filter((o) => o.is_active || req.query.all === "1"));
  });

  r.post("/", gerencia, (req, res) => {
    const v = categoryValues({ ...req.body, kind: undefined }, null, all());
    if (typeof v === "string") throw new HttpError(400, v);
    const order = (db.prepare("SELECT MAX(display_order) AS m FROM party_categories").get().m ?? 0) + 1;
    const id = db.prepare("INSERT INTO party_categories (title, plural, side, kind, pair_id, is_active, display_order, created_by) VALUES (?, ?, ?, 'rol', ?, ?, ?, ?)")
      .run(v.title, v.plural, v.side, v.pair_id, v.is_active, order, req.user.id).lastInsertRowid;
    refreshPartyCategories(db);
    res.status(201).json(out(find(id)));
  });

  r.put("/order", gerencia, (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
    const known = new Set(all().map((o) => o.id));
    if (!ids.length || ids.some((id) => !known.has(id)) || new Set(ids).size !== ids.length) throw new HttpError(400, "La lista de orden no es válida.");
    const rest = all().map((o) => o.id).filter((id) => !ids.includes(id));
    inTransaction(db, () => {
      const upd = db.prepare("UPDATE party_categories SET display_order = ?, updated_at = datetime('now') WHERE id = ?");
      [...ids, ...rest].forEach((id, i) => upd.run(i + 1, id));
    });
    refreshPartyCategories(db);
    res.json(outAll());
  });

  r.put("/:id", gerencia, (req, res) => {
    const cur = find(req.params.id);
    const uses = out(cur).uses;
    const v = categoryValues(req.body, cur, all().filter((o) => o.id !== cur.id), uses);
    if (typeof v === "string") throw new HttpError(400, v);
    db.prepare("UPDATE party_categories SET title = ?, plural = ?, side = ?, pair_id = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?").run(v.title, v.plural, v.side, v.pair_id, v.is_active, cur.id);
    refreshPartyCategories(db);
    res.json(out(find(cur.id)));
  });

  // A category in use (or a built-in condition) is only deactivated, so no case loses its mark; an unused one is removed.
  r.delete("/:id", gerencia, (req, res) => {
    const cur = find(req.params.id);
    if (cur.kind === "condicion" || out(cur).uses) {
      db.prepare("UPDATE party_categories SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(cur.id);
      refreshPartyCategories(db);
      return res.json({ id: cur.id, deleted: false, deactivated: true });
    }
    db.prepare("UPDATE party_categories SET pair_id = NULL WHERE pair_id = ?").run(cur.id);
    db.prepare("DELETE FROM party_categories WHERE id = ?").run(cur.id);
    refreshPartyCategories(db);
    res.json({ id: cur.id, deleted: true, deactivated: false });
  });

  return r;
}
