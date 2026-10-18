// Officials per entity (version 2.27): the name, title and e-mail of whoever
// receives the firm's e-mails and petitions at each authority.
import express from "express";
import { can } from "./auth.js";
import { TREATMENTS, entityKey } from "./case-meta.js";

const str = (v, max = 200) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim()).slice(0, max);
const without = (o, key) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
const WRITERS = ["cases.write", "mail.send", "drafts.generate"];

/** Cleaned row from a request body; throws a user-facing message. */
export function authorityInput(b) {
  const entity = str(b?.entity);
  if (!entityKey(entity)) throw new Error("Escriba la entidad o el despacho.");
  const email = str(b?.email).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("El correo no es válido.");
  const treatment = TREATMENTS.includes(str(b?.treatment)) ? str(b.treatment) : "Señor(a)";
  return { entity, entity_key: entityKey(entity), treatment, name: str(b?.name), title: str(b?.title), email, city: str(b?.city, 100) };
}

export function authoritiesRouter(db) {
  const r = express.Router();
  const write = (req, res, next) => (WRITERS.some((p) => can(req, p)) ? next() : res.status(403).json({ error: "Su rol no tiene permiso para esta acción." }));
  const one = (id) => db.prepare("SELECT * FROM authorities WHERE id = ?").get(id);

  r.get("/", (req, res) => {
    const q = entityKey(req.query.q || "");
    const rows = db.prepare("SELECT * FROM authorities ORDER BY entity").all().map((x) => ({ ...x }));
    res.json(q ? rows.filter((x) => (x.entity_key + " " + entityKey(x.name)).includes(q)) : rows);
  });

  // Save by entity: a second save for the same entity updates its official.
  r.post("/", write, (req, res) => {
    let v;
    try { v = authorityInput(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
    const hit = db.prepare("SELECT id FROM authorities WHERE entity_key = ?").get(v.entity_key);
    if (hit) {
      db.prepare(`UPDATE authorities SET entity = :entity, treatment = :treatment, name = :name, title = :title, email = :email, city = :city,
        updated_by = :by, updated_at = datetime('now') WHERE id = :id`).run({ ...without(v, "entity_key"), by: req.user.id, id: hit.id });
      return res.json({ ...one(hit.id), updated: true });
    }
    const id = db.prepare(`INSERT INTO authorities (entity, entity_key, treatment, name, title, email, city, updated_by)
      VALUES (:entity, :entity_key, :treatment, :name, :title, :email, :city, :by)`).run({ ...v, by: req.user.id }).lastInsertRowid;
    res.status(201).json({ ...one(id) });
  });

  r.put("/:id", write, (req, res) => {
    const id = Number(req.params.id);
    if (!one(id)) return res.status(404).json({ error: "No existe." });
    let v;
    try { v = authorityInput(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
    const other = db.prepare("SELECT entity FROM authorities WHERE entity_key = ? AND id != ?").get(v.entity_key, id);
    if (other) return res.status(409).json({ error: `Ya hay un funcionario guardado para «${other.entity}».` });
    db.prepare(`UPDATE authorities SET entity = :entity, entity_key = :entity_key, treatment = :treatment, name = :name, title = :title,
      email = :email, city = :city, updated_by = :by, updated_at = datetime('now') WHERE id = :id`).run({ ...v, by: req.user.id, id });
    res.json({ ...one(id) });
  });

  // DELETE is Gerencia-only for every route (requireAuth).
  r.delete("/:id", (req, res) => {
    db.prepare("DELETE FROM authorities WHERE id = ?").run(Number(req.params.id));
    res.status(204).end();
  });
  return r;
}

/** Every saved official, for the addressee of a case. */
export const allAuthorities = (db) => db.prepare("SELECT entity, treatment, name, title, email, city FROM authorities").all();
