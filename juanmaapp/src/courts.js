// Court directory (despachos judiciales) loaded from the Rama Judicial's
// official directory file, filtered by department, city and area.
import express from "express";
import { str } from "./http.js";
import { can } from "./auth.js";
import { courtCircuit, filterCourts } from "./case-meta.js";
import { judgeByRadicado } from "./ramajudicial.js";
import { properName } from "./person.js";
import { AREAS, DIVIPOLA, canonicalDepartment, canonicalCity, cityFromText, cityCode, inferArea, registerAreas } from "./places.js";


export function courtsRouter(db) {
  const r = express.Router();
  const loadAreas = () => registerAreas(db.prepare("SELECT name FROM court_areas ORDER BY rowid").all().map((x) => x.name));
  loadAreas();
  const gerencia = (req, res) => {
    if (can(req, "catalog.manage")) return true;
    res.status(403).json({ error: "Solo Gerencia puede crear o cambiar despachos." });
    return false;
  };

  r.get("/meta", (req, res) => {
    const total = db.prepare("SELECT COUNT(*) AS n FROM courts").get().n;
    const updated = db.prepare("SELECT MAX(updated_at) AS t FROM courts").get().t;
    const custom = db.prepare("SELECT COUNT(*) AS n FROM courts WHERE custom = 1").get().n;
    res.json({ areas: AREAS, total, updated, custom });
  });

  // The administrator adds an area of law that is not in the list (e.g. «Disciplinario Interno»).
  r.post("/areas", (req, res) => {
    if (!gerencia(req, res)) return;
    const name = str(req.body?.name).replace(/\s+/g, " ");
    if (!name) return res.status(400).json({ error: "Escriba el nombre del área." });
    if (name.length > 80) return res.status(400).json({ error: "El nombre del área es muy largo." });
    const same = AREAS.find((a) => a.toLowerCase() === name.toLowerCase());
    if (same) return res.json({ name: same, created: false, areas: AREAS });
    db.prepare("INSERT INTO court_areas (name) VALUES (?)").run(name);
    loadAreas();
    res.status(201).json({ name, created: true, areas: AREAS });
  });

  const courtInput = (b) => {
    const name = str(b.name).replace(/\s+/g, " ");
    const department = canonicalDepartment(b.department);
    if (!name) return { error: "Escriba el nombre del despacho." };
    if (!department) return { error: "Elija el departamento del despacho." };
    const city = canonicalCity(str(b.city) || cityFromText(b.department, department), department);
    if (!city) return { error: "Elija la ciudad del despacho." };
    const area = str(b.area);
    if (!area) return { error: "Elija el área del despacho." };
    if (!AREAS.includes(area)) return { error: "Área no válida. Agréguela primero con «+ Nueva área»." };
    const email = str(b.email).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "El correo no es válido." };
    return { v: { code: str(b.code), name, department, city, city_code: cityCode(city, department), circuit: courtCircuit(name, b.circuit), area,
      email, phone: str(b.phone), address: str(b.address), judge: str(b.judge).replace(/\s+/g, " ") } };
  };
  const sameKey = (name, city, exceptId = -1) => db.prepare("SELECT id FROM courts WHERE name = ? AND city = ? AND id != ?").get(name, city, exceptId);

  r.post("/", (req, res) => {
    if (!gerencia(req, res)) return;
    const { v, error } = courtInput(req.body || {});
    if (error) return res.status(400).json({ error });
    if (sameKey(v.name, v.city)) return res.status(409).json({ error: "Ya existe un despacho con ese nombre en esa ciudad." });
    const id = db.prepare(`INSERT INTO courts (code, name, department, city, city_code, circuit, area, email, phone, address, judge, custom)
      VALUES (:code, :name, :department, :city, :city_code, :circuit, :area, :email, :phone, :address, :judge, 1)`).run(v).lastInsertRowid;
    res.status(201).json(db.prepare("SELECT * FROM courts WHERE id = ?").get(id));
  });

  // Only the courts created by hand change here; the ones from the official file stay as loaded.
  r.put("/:id", (req, res) => {
    if (!gerencia(req, res)) return;
    const row = db.prepare("SELECT * FROM courts WHERE id = ?").get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "No existe el despacho." });
    if (!row.custom) return res.status(400).json({ error: "Los despachos del directorio oficial no se editan aquí; se actualizan cargando el Excel." });
    const { v, error } = courtInput(req.body || {});
    if (error) return res.status(400).json({ error });
    if (sameKey(v.name, v.city, row.id)) return res.status(409).json({ error: "Ya existe un despacho con ese nombre en esa ciudad." });
    db.prepare(`UPDATE courts SET code = :code, name = :name, department = :department, city = :city, city_code = :city_code, circuit = :circuit, area = :area,
      email = :email, phone = :phone, address = :address, judge = :judge, updated_at = datetime('now') WHERE id = :id`).run({ ...v, id: row.id });
    // Cases linked to this court keep their text in step with the new name.
    if (row.name !== v.name) db.prepare("UPDATE cases SET court_name = ? WHERE court_id = ?").run(v.name, row.id);
    res.json(db.prepare("SELECT * FROM courts WHERE id = ?").get(row.id));
  });

  // Switching off hides a hand-made court from the pickers without deleting it or the cases that use it.
  r.put("/:id/active", (req, res) => {
    if (!gerencia(req, res)) return;
    const row = db.prepare("SELECT id, custom FROM courts WHERE id = ?").get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "No existe el despacho." });
    if (!row.custom) return res.status(400).json({ error: "Solo se desactivan los despachos creados a mano." });
    db.prepare("UPDATE courts SET active = ? WHERE id = ?").run(req.body?.active ? 1 : 0, row.id);
    res.json({ id: row.id, active: req.body?.active ? 1 : 0 });
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
    if (str(req.query.all) !== "1") where.push("active = 1"); // Despachos screen asks for all=1 to show the switched-off ones too
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
    const find = db.prepare("SELECT id, custom FROM courts WHERE name = ? AND city = ?");
    const fill = db.prepare(`UPDATE courts SET email = CASE WHEN email = '' THEN :email ELSE email END, phone = CASE WHEN phone = '' THEN :phone ELSE phone END,
      address = CASE WHEN address = '' THEN :address ELSE address END, judge = CASE WHEN judge = '' THEN :judge ELSE judge END WHERE id = :id`);
    const ins = db.prepare(`INSERT INTO courts (code, name, department, city, city_code, circuit, area, email, phone, address, judge)
      VALUES (:code, :name, :department, :city, :city_code, :circuit, :area, :email, :phone, :address, :judge)`);
    const upd = db.prepare(`UPDATE courts SET code = :code, department = :department, city = :city, city_code = :city_code, circuit = :circuit, area = :area,
      email = CASE WHEN :email != '' THEN :email ELSE email END, phone = CASE WHEN :phone != '' THEN :phone ELSE phone END,
      address = CASE WHEN :address != '' THEN :address ELSE address END, judge = CASE WHEN :judge != '' THEN :judge ELSE judge END, updated_at = datetime('now') WHERE id = :id`);
    db.exec("BEGIN");
    try {
      if (req.body?.replace) db.prepare("DELETE FROM courts WHERE custom = 0").run(); // courts made by hand stay. Gerencia only, checked above (audit A01-001)
      rows.forEach((row, i) => {
        const name = str(row.name);
        const department = canonicalDepartment(row.department);
        if (!name || !department) {
          out.skipped.push({ row: row.rowNumber ?? i + 2, reason: !name ? "Sin nombre de despacho." : `Departamento no reconocido: "${str(row.department)}".` });
          return;
        }
        const city = canonicalCity(str(row.city) || cityFromText(row.department, department), department);
        const v = {
          code: str(row.code), name, department, city, city_code: cityCode(city, department), circuit: courtCircuit(name, row.circuit),
          area: inferArea(name, row.area), email: str(row.email).toLowerCase(), phone: str(row.phone), address: str(row.address),
          judge: str(row.judge).replace(/\s+/g, " "),
        };
        // A court loaded before with the city as the file wrote it («Cartagena») is found and its city updated, not duplicated.
        const hit = find.get(name, city) || find.get(name, properName(str(row.city)));
        if (hit && hit.custom) {
          // Created by hand: the file never changes its name, place or area; it only fills what is still empty.
          fill.run({ email: v.email, phone: v.phone, address: v.address, judge: v.judge, id: hit.id });
          out.updated++;
        } else if (hit) {
          const { name: _n, ...rest } = v;
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
    // Only the directory loaded from the file; the courts Gerencia created by hand stay.
    db.prepare("UPDATE cases SET court_id = NULL WHERE court_id IN (SELECT id FROM courts WHERE custom = 0)").run();
    db.prepare("DELETE FROM courts WHERE custom = 0").run();
    res.status(204).end();
  });

  return r;
}

export { DIVIPOLA };
