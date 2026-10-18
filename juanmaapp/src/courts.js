// Court directory (despachos judiciales) loaded from the Rama Judicial's
// official directory file, filtered by department, city and area.
import express from "express";
import { can } from "./auth.js";
import { courtCircuit, filterCourts } from "./case-meta.js";
import { judgeByRadicado } from "./ramajudicial.js";
import { AREAS, DIVIPOLA, canonicalDepartment, canonicalCity, cityCode, inferArea } from "./places.js";

const str = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

export function courtsRouter(db) {
  const r = express.Router();

  r.get("/meta", (req, res) => {
    const total = db.prepare("SELECT COUNT(*) AS n FROM courts").get().n;
    const updated = db.prepare("SELECT MAX(updated_at) AS t FROM courts").get().t;
    res.json({ areas: AREAS, total, updated });
  });

  // Departments and cities that actually have courts (for filters).
  r.get("/places", (req, res) => {
    const rows = db.prepare("SELECT department, city, COUNT(*) AS n FROM courts GROUP BY department, city ORDER BY department, city").all();
    res.json(rows.map((x) => ({ ...x })));
  });

  r.get("/", (req, res) => {
    // Department in SQL; city (or its circuit) and area (with the courts that
    // also hear it, e.g. promiscuous ones) through the shared rule.
    const where = [], params = [];
    if (str(req.query.department)) { where.push("department = ?"); params.push(str(req.query.department)); }
    if (str(req.query.q)) {
      where.push("(name LIKE ? OR email LIKE ? OR code LIKE ?)");
      const q = `%${str(req.query.q)}%`;
      params.push(q, q, q);
    }
    const limit = Math.min(Number(req.query.limit) || 500, 2000);
    const rows = db.prepare(`SELECT * FROM courts ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY department, city, area, name`).all(...params);
    const want = { city: str(req.query.city), area: str(req.query.area) };
    res.json(filterCourts(rows, want).slice(0, limit).map((x) => ({ ...x })));
  });

  // Version 2.27: judge suggestions for a court. The Rama Judicial's record of the radicado
  // ("ponente") comes first; the directory file and other cases of the same court follow.
  // The user always chooses or types the name: nothing is filled in by itself.
  r.get("/judge", async (req, res) => {
    const courtId = Number(req.query.court_id) || null;
    const court = courtId ? db.prepare("SELECT id, name, judge FROM courts WHERE id = ?").get(courtId) : null;
    const courtName = court?.name || str(req.query.court_name);
    const out = { rama: null, rama_error: "", directory: court?.judge || "", others: [] };
    if (courtName) {
      out.others = db.prepare(`SELECT judge_name AS name, COUNT(*) AS n FROM cases WHERE judge_name != '' AND (court_id = ? OR court_name = ?)
        GROUP BY judge_name ORDER BY n DESC, name LIMIT 5`).all(courtId ?? -1, courtName).map((x) => x.name);
    }
    const radicado = str(req.query.radicado).replace(/\D/g, "");
    if (radicado.length === 23) {
      try {
        out.rama = await judgeByRadicado(radicado);
        if (!out.rama) out.rama_error = "La Rama Judicial no tiene registrado este radicado.";
        else if (!out.rama.judge) out.rama_error = "La Rama Judicial no trae el nombre del juez para este proceso.";
      } catch (err) {
        out.rama_error = err.message;
      }
    } else {
      out.rama_error = "Escriba el radicado de 23 dígitos para traer el nombre del juez de la Rama Judicial.";
    }
    res.json(out);
  });

  // Rows come from the page, already mapped to our fields from the official file.
  r.post("/import", (req, res) => {
    if (!can(req, "catalog.manage")) return res.status(403).json({ error: "Su rol no tiene permiso para esta acción." });
    // Replacing deletes the whole directory first: only Gerencia deletes (audit A01-001).
    if (req.body?.replace && req.user.role !== "Gerencia") return res.status(403).json({ error: "Solo Gerencia puede reemplazar todo el directorio." });
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: "El archivo no trae despachos." });
    if (rows.length > 20000) return res.status(400).json({ error: "Máximo 20.000 despachos por carga." });
    const out = { created: 0, updated: 0, skipped: [] };
    const find = db.prepare("SELECT id FROM courts WHERE name = ? AND city = ?");
    const ins = db.prepare(`INSERT INTO courts (code, name, department, city, city_code, circuit, area, email, phone, address, judge)
      VALUES (:code, :name, :department, :city, :city_code, :circuit, :area, :email, :phone, :address, :judge)`);
    const upd = db.prepare(`UPDATE courts SET code = :code, department = :department, city_code = :city_code, circuit = :circuit, area = :area,
      email = CASE WHEN :email != '' THEN :email ELSE email END, phone = CASE WHEN :phone != '' THEN :phone ELSE phone END,
      address = CASE WHEN :address != '' THEN :address ELSE address END, judge = CASE WHEN :judge != '' THEN :judge ELSE judge END, updated_at = datetime('now') WHERE id = :id`);
    db.exec("BEGIN");
    try {
      if (req.body?.replace) db.prepare("DELETE FROM courts").run(); // Gerencia only, checked above (audit A01-001)
      rows.forEach((row, i) => {
        const name = str(row.name);
        const department = canonicalDepartment(row.department);
        if (!name || !department) {
          out.skipped.push({ row: row.rowNumber ?? i + 2, reason: !name ? "Sin nombre de despacho." : `Departamento no reconocido: "${str(row.department)}".` });
          return;
        }
        const city = canonicalCity(row.city, department);
        const v = {
          code: str(row.code), name, department, city, city_code: cityCode(city, department), circuit: courtCircuit(name, row.circuit),
          area: inferArea(name, row.area), email: str(row.email).toLowerCase(), phone: str(row.phone), address: str(row.address),
          judge: str(row.judge).replace(/\s+/g, " "),
        };
        const hit = find.get(name, city);
        if (hit) {
          const { name: _n, city: _c, ...rest } = v;
          upd.run({ ...rest, id: hit.id });
          out.updated++;
        } else {
          ins.run(v);
          out.created++;
        }
      });
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    res.json(out);
  });

  r.delete("/", (req, res) => {
    if (!can(req, "catalog.manage")) return res.status(403).json({ error: "Su rol no tiene permiso para esta acción." });
    db.prepare("UPDATE cases SET court_id = NULL WHERE court_id IS NOT NULL").run();
    db.prepare("DELETE FROM courts").run();
    res.status(204).end();
  });

  return r;
}

export { DIVIPOLA };
