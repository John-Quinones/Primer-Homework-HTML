// Report data for the Reportes section. Each report returns columns + rows
// limited to the user's offices; the page turns them into Excel or PDF.
import express from "express";
import { scopeOf } from "./auth.js";

const OPEN = ["Abierto", "En trámite", "En espera de respuesta"];

export const REPORTS = {
  expedientes: "Expedientes",
  clientes: "Clientes",
  oficinas: "Resumen por oficina",
  responsables: "Carga por responsable",
  procesos: "Expedientes por tipo de proceso",
  jurisprudencia: "Sentencias guardadas",
};

export function reportsRouter(db) {
  const r = express.Router();

  r.get("/", (req, res) => res.json(REPORTS));

  r.get("/:type", (req, res) => {
    const type = req.params.type;
    if (!REPORTS[type]) return res.status(404).json({ error: "Reporte no disponible." });
    const q = req.query;
    const sc = scopeOf(req.user);
    const where = [];
    const params = [];
    const inOffices = (col) => {
      if (sc !== null) {
        where.push(sc.length ? `${col} IN (${sc.map(() => "?").join(",")})` : "0 = 1");
        params.push(...sc);
      }
      if (q.officeId) { where.push(`${col} = ?`); params.push(Number(q.officeId)); }
    };
    const dateRange = (col) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || "")) { where.push(`date(${col}) >= ?`); params.push(q.from); }
      if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || "")) { where.push(`date(${col}) <= ?`); params.push(q.to); }
    };
    const W = () => (where.length ? "WHERE " + where.join(" AND ") : "");
    const statusFilter = (col) => {
      if (q.status === "activos") where.push(`${col} IN (${OPEN.map(() => "?").join(",")})`), params.push(...OPEN);
      else if (q.status === "cerrados") where.push(`${col} = 'Cerrado'`);
      else if (q.status) where.push(`${col} = ?`), params.push(String(q.status));
    };
    let columns, rows;

    if (type === "expedientes") {
      inOffices("k.office_id");
      dateRange("k.created_at");
      statusFilter("k.status");
      if (q.categoryId) { where.push("t.category_id = ?"); params.push(Number(q.categoryId)); }
      if (q.assignedUserId) { where.push("k.assigned_user_id = ?"); params.push(Number(q.assignedUserId)); }
      columns = [["office", "Oficina"], ["client", "Cliente"], ["doc", "Documento"], ["category", "Tipo de proceso"],
        ["type", "Subproceso"], ["title", "Asunto"], ["status", "Estado"], ["assigned", "Responsable"],
        ["counterparty", "Contraparte"], ["created", "Creado"], ["updated", "Actualizado"]];
      rows = db.prepare(`
        SELECT o.name AS office, c.full_name AS client, trim(c.id_type || ' ' || c.id_number) AS doc,
               g.name AS category, t.name AS type, k.title, k.status, COALESCE(u.name, '') AS assigned,
               k.counterparty, date(k.created_at) AS created, date(k.updated_at) AS updated
        FROM cases k JOIN clients c ON c.id = k.client_id
        JOIN process_types t ON t.id = k.process_type_id JOIN process_categories g ON g.id = t.category_id
        LEFT JOIN offices o ON o.id = k.office_id LEFT JOIN users u ON u.id = k.assigned_user_id
        ${W()} ORDER BY o.name, g.name, c.full_name`).all(...params);
    } else if (type === "clientes") {
      if (sc !== null) {
        const ph = sc.map(() => "?").join(",") || "NULL";
        where.push(`(c.office_id IN (${ph}) OR c.id IN (SELECT client_id FROM cases WHERE office_id IN (${ph})))`);
        params.push(...sc, ...sc);
      }
      if (q.officeId) { where.push("c.office_id = ?"); params.push(Number(q.officeId)); }
      dateRange("c.created_at");
      columns = [["office", "Oficina"], ["name", "Nombre"], ["doc", "Documento"], ["email", "Correo"],
        ["phone", "Teléfono"], ["city", "Ciudad"], ["cases", "Expedientes"], ["created", "Creado"]];
      rows = db.prepare(`
        SELECT o.name AS office, c.full_name AS name, trim(c.id_type || ' ' || c.id_number) AS doc, c.email, c.phone,
               c.city, (SELECT COUNT(*) FROM cases WHERE client_id = c.id) AS cases, date(c.created_at) AS created
        FROM clients c LEFT JOIN offices o ON o.id = c.office_id ${W()} ORDER BY o.name, c.full_name`).all(...params);
    } else if (type === "oficinas") {
      inOffices("o.id");
      columns = [["office", "Oficina"], ["city", "Ciudad"], ["clients", "Clientes"], ["cases", "Expedientes"],
        ["active", "Activos"], ["closed", "Cerrados"], ["unassigned", "Sin responsable"], ["users", "Usuarios"]];
      rows = db.prepare(`
        SELECT o.name AS office, o.city,
          (SELECT COUNT(*) FROM clients WHERE office_id = o.id) AS clients,
          (SELECT COUNT(*) FROM cases WHERE office_id = o.id) AS cases,
          (SELECT COUNT(*) FROM cases WHERE office_id = o.id AND status IN (${OPEN.map(() => "?").join(",")})) AS active,
          (SELECT COUNT(*) FROM cases WHERE office_id = o.id AND status = 'Cerrado') AS closed,
          (SELECT COUNT(*) FROM cases WHERE office_id = o.id AND assigned_user_id IS NULL) AS unassigned,
          (SELECT COUNT(*) FROM user_offices WHERE office_id = o.id) AS users
        FROM offices o ${W()} ORDER BY o.is_main DESC, o.name`).all(...OPEN, ...params);
    } else if (type === "responsables") {
      inOffices("k.office_id");
      columns = [["user", "Responsable"], ["role", "Rol"], ["cases", "Expedientes"], ["active", "Activos"], ["closed", "Cerrados"]];
      rows = db.prepare(`
        SELECT COALESCE(u.name, 'Sin responsable') AS user, COALESCE(u.role, '') AS role, COUNT(*) AS cases,
               SUM(k.status IN (${OPEN.map(() => "?").join(",")})) AS active, SUM(k.status = 'Cerrado') AS closed
        FROM cases k LEFT JOIN users u ON u.id = k.assigned_user_id ${W()}
        GROUP BY k.assigned_user_id ORDER BY cases DESC`).all(...OPEN, ...params);
    } else if (type === "procesos") {
      inOffices("k.office_id");
      dateRange("k.created_at");
      columns = [["category", "Tipo de proceso"], ["type", "Subproceso"], ["cases", "Expedientes"], ["active", "Activos"]];
      rows = db.prepare(`
        SELECT g.name AS category, t.name AS type, COUNT(k.id) AS cases,
               SUM(k.status IN (${OPEN.map(() => "?").join(",")})) AS active
        FROM cases k JOIN process_types t ON t.id = k.process_type_id JOIN process_categories g ON g.id = t.category_id
        ${W()} GROUP BY t.id ORDER BY g.sort, t.sort`).all(...OPEN, ...params);
    } else if (type === "jurisprudencia") {
      if (sc !== null) {
        const ph = sc.map(() => "?").join(",") || "NULL";
        where.push(`(s.created_by = ? OR k.office_id IN (${ph}))`);
        params.push(req.user.id, ...sc);
      }
      dateRange("s.created_at");
      columns = [["reference", "Sentencia"], ["court", "Corte"], ["verified", "Fuente oficial verificada"],
        ["case", "Expediente"], ["url", "Enlace"], ["saved", "Guardada"]];
      rows = db.prepare(`
        SELECT s.reference, s.court, CASE s.verified WHEN 1 THEN 'Sí' ELSE 'No' END AS verified,
               COALESCE(c.full_name || ' · ' || t.name, '') AS "case", s.url, date(s.created_at) AS saved
        FROM saved_rulings s LEFT JOIN cases k ON k.id = s.case_id LEFT JOIN clients c ON c.id = k.client_id
        LEFT JOIN process_types t ON t.id = k.process_type_id ${W()} ORDER BY s.id DESC`).all(...params);
    }

    res.json({
      type, title: REPORTS[type],
      columns: columns.map(([key, label]) => ({ key, label })),
      rows: rows.map((row) => ({ ...row })),
      generatedAt: new Date().toISOString(),
      generatedBy: req.user.name,
    });
  });

  return r;
}
