// Report data for the Reportes section. Each report returns columns + rows
// limited to the user's offices; the page turns them into Excel or PDF.
import express from "express";
import { typePath } from "./sql.js";
import { formatRadicado } from "./portals.js";
import { scopeOf } from "./auth.js";
import { paymentsReport } from "./payments.js";
import { isFolderLabel } from "./case-meta.js";

const OPEN = ["Activo"];
const ARCHIVED = "('Archivo provisional', 'Archivo definitivo')";

export const REPORTS = {
  expedientes: "Expedientes",
  carpetas: "Listado por número de carpeta",
  clientes: "Clientes",
  clientesestado: "Listado de clientes por estado",
  oficinas: "Resumen por oficina",
  responsables: "Carga por responsable",
  procesos: "Expedientes por tipo de proceso",
  jurisprudencia: "Sentencias guardadas",
  cartera: "Cartera por cliente",
  recibos: "Recibos de caja",
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
      else if (q.status === "archivados" || q.status === "cerrados") where.push(`${col} IN ${ARCHIVED}`);
      else if (q.status) where.push(`${col} = ?`), params.push(String(q.status));
    };
    let columns, rows;

    if (type === "clientesestado") {
      // Version 2.2.22: clients by their own state (clients.archive_status; '' = Activo). Folders of all their cases come as
      // text; the page orders by the lowest one (folderListing logic) and writes them sorted.
      if (sc !== null) {
        const ph = sc.map(() => "?").join(",") || "NULL";
        where.push(`(c.office_id IN (${ph}) OR c.id IN (SELECT client_id FROM cases WHERE office_id IN (${ph})))`);
        params.push(...sc, ...sc);
      }
      if (q.officeId) { where.push("c.office_id = ?"); params.push(Number(q.officeId)); }
      if (q.clientState === "activos") where.push("c.archive_status = ''");
      else if (["Archivo provisional", "Archivo definitivo", "Pendiente Pago Sentencia"].includes(q.clientState)) { where.push("c.archive_status = ?"); params.push(q.clientState); }
      const folderIds = db.prepare("SELECT id, label FROM custom_fields").all().filter((f) => isFolderLabel(f.label)).map((f) => String(f.id));
      const byClient = new Map();
      for (const k of db.prepare("SELECT client_id, field_values FROM cases ORDER BY id").all()) {
        const v = JSON.parse(k.field_values || "{}");
        const folder = folderIds.map((i) => String(v[i] ?? "").trim()).find(Boolean);
        if (folder) byClient.set(k.client_id, [...(byClient.get(k.client_id) || []), folder]);
      }
      columns = [["folder", "No. Carpeta"], ["name", "Nombre"], ["doc", "Documento"], ["phone", "Teléfono"], ["email", "Correo"],
        ["city", "Ciudad"], ["state", "Estado"], ["cases", "Expedientes"], ["office", "Oficina"]];
      rows = db.prepare(`
        SELECT c.id, o.name AS office, c.full_name AS name, trim(c.id_type || ' ' || c.id_number) AS doc, c.phone, c.email, c.city,
               CASE c.archive_status WHEN '' THEN 'Activo' ELSE c.archive_status END AS state,
               (SELECT COUNT(*) FROM cases WHERE client_id = c.id) AS cases
        FROM clients c LEFT JOIN offices o ON o.id = c.office_id ${W()} ORDER BY c.id`).all(...params)
        .map(({ id, ...row }) => ({ ...row, folder: (byClient.get(id) || []).join(", ") }));
    } else if (type === "carpetas") {
      // Version 2.2.22: one row per case with its "No. Carpeta" (the page sorts them numerically and applies the range).
      inOffices("k.office_id");
      statusFilter("k.status");
      if (q.assignedUserId) { where.push("k.assigned_user_id = ?"); params.push(Number(q.assignedUserId)); }
      const folderIds = db.prepare("SELECT id, label FROM custom_fields").all().filter((f) => isFolderLabel(f.label)).map((f) => String(f.id));
      columns = [["folder", "No. Carpeta"], ["client", "Cliente"], ["doc", "Documento"], ["category", "Tipo de proceso"], ["type", "Subproceso"],
        ["radicado", "Número de expediente"], ["court", "Despacho"], ["status", "Estado"], ["assigned", "Responsable"], ["office", "Oficina"]];
      rows = db.prepare(`
        SELECT k.id, k.field_values, o.name AS office, c.full_name AS client, trim(c.id_type || ' ' || c.id_number) AS doc,
               g.name AS category, ${typePath("t")} AS type, k.radicado, k.case_number, k.court_name AS court, k.status,
               COALESCE(u.name, '') AS assigned
        FROM cases k JOIN clients c ON c.id = k.client_id
        JOIN process_types t ON t.id = k.process_type_id JOIN process_categories g ON g.id = t.category_id
        LEFT JOIN offices o ON o.id = k.office_id LEFT JOIN users_shown u ON u.id = k.assigned_user_id
        ${W()} ORDER BY k.id`).all(...params).map(({ field_values, case_number, ...row }) => {
        const v = JSON.parse(field_values || "{}");
        const folder = folderIds.map((i) => String(v[i] ?? "").trim()).find(Boolean) || "";
        return { ...row, folder, radicado: row.radicado || case_number || "" };
      });
    } else if (type === "expedientes") {
      inOffices("k.office_id");
      dateRange("k.created_at");
      statusFilter("k.status");
      if (q.categoryId) { where.push("t.category_id = ?"); params.push(Number(q.categoryId)); }
      if (q.assignedUserId) { where.push("k.assigned_user_id = ?"); params.push(Number(q.assignedUserId)); }
      columns = [["office", "Oficina"], ["client", "Cliente"], ["doc", "Documento"], ["category", "Tipo de proceso"],
        ["type", "Subproceso"], ["title", "Asunto"], ["radicado", "Radicado"], ["role", "Calidad del cliente"], ["affiliated", "Afiliado"],
        ["status", "Estado"], ["assigned", "Responsable"],
        ["counterparty", "Contraparte"], ["created", "Creado"], ["updated", "Actualizado"]];
      rows = db.prepare(`
        SELECT o.name AS office, c.full_name AS client, trim(c.id_type || ' ' || c.id_number) AS doc,
               g.name AS category, ${typePath("t")} AS type, k.title, k.radicado, k.client_role AS role,
               CASE k.affiliated WHEN 1 THEN 'Sí' ELSE 'No' END AS affiliated, k.status, COALESCE(u.name, '') AS assigned,
               k.counterparty, date(k.created_at) AS created, date(k.updated_at) AS updated
        FROM cases k JOIN clients c ON c.id = k.client_id
        JOIN process_types t ON t.id = k.process_type_id JOIN process_categories g ON g.id = t.category_id
        LEFT JOIN offices o ON o.id = k.office_id LEFT JOIN users_shown u ON u.id = k.assigned_user_id
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
        ["active", "Activos"], ["closed", "Archivados"], ["unassigned", "Sin responsable"], ["users", "Usuarios"]];
      rows = db.prepare(`
        SELECT o.name AS office, o.city,
          (SELECT COUNT(*) FROM clients WHERE office_id = o.id) AS clients,
          (SELECT COUNT(*) FROM cases WHERE office_id = o.id) AS cases,
          (SELECT COUNT(*) FROM cases WHERE office_id = o.id AND status IN (${OPEN.map(() => "?").join(",")})) AS active,
          (SELECT COUNT(*) FROM cases WHERE office_id = o.id AND status IN ${ARCHIVED}) AS closed,
          (SELECT COUNT(*) FROM cases WHERE office_id = o.id AND assigned_user_id IS NULL) AS unassigned,
          (SELECT COUNT(*) FROM user_offices WHERE office_id = o.id) AS users
        FROM offices o ${W()} ORDER BY o.is_main DESC, o.name`).all(...OPEN, ...params);
    } else if (type === "responsables") {
      inOffices("k.office_id");
      columns = [["user", "Responsable"], ["role", "Rol"], ["cases", "Expedientes"], ["active", "Activos"], ["closed", "Archivados"]];
      rows = db.prepare(`
        SELECT COALESCE(u.name, 'Sin responsable') AS user, COALESCE(u.role, '') AS role, COUNT(*) AS cases,
               SUM(k.status IN (${OPEN.map(() => "?").join(",")})) AS active, SUM(k.status IN ${ARCHIVED}) AS closed
        FROM cases k LEFT JOIN users_shown u ON u.id = k.assigned_user_id ${W()}
        GROUP BY k.assigned_user_id ORDER BY cases DESC`).all(...OPEN, ...params);
    } else if (type === "procesos") {
      inOffices("k.office_id");
      dateRange("k.created_at");
      columns = [["category", "Tipo de proceso"], ["type", "Subproceso"], ["cases", "Expedientes"], ["active", "Activos"]];
      rows = db.prepare(`
        SELECT g.name AS category, ${typePath("t")} AS type, COUNT(k.id) AS cases,
               SUM(k.status IN (${OPEN.map(() => "?").join(",")})) AS active
        FROM cases k JOIN process_types t ON t.id = k.process_type_id JOIN process_categories g ON g.id = t.category_id
        ${W()} GROUP BY t.id ORDER BY g.sort, t.sort`).all(...OPEN, ...params);
    } else if (type === "cartera" || type === "recibos") {
      if (!req.user.permissions.includes("payments.manage")) return res.status(403).json({ error: "Su rol no tiene permiso para ver la cartera." });
      ({ columns, rows } = paymentsReport(db, req.user, type, q));
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
               COALESCE(c.full_name || ' · ' || ${typePath("t")}, '') AS "case", s.url, date(s.created_at) AS saved
        FROM saved_rulings s LEFT JOIN cases k ON k.id = s.case_id LEFT JOIN clients c ON c.id = k.client_id
        LEFT JOIN process_types t ON t.id = k.process_type_id ${W()} ORDER BY s.id DESC`).all(...params);
    }

    res.json({
      type, title: REPORTS[type],
      columns: columns.map(([key, label]) => ({ key, label })),
      rows: rows.map((row) => ("radicado" in row ? { ...row, radicado: /^\d{23}$/.test(String(row.radicado).replace(/\D/g, "")) ? formatRadicado(row.radicado) : row.radicado } : { ...row })),
      generatedAt: new Date().toISOString(),
      generatedBy: req.user.name,
    });
  });

  return r;
}
