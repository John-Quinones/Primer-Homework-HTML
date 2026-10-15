// Tasks, hearings and deadlines on cases, plus each user's notifications.
import express from "express";
import { typePath } from "./sql.js";
import { can, scopeOf } from "./auth.js";
import { TASK_KINDS as KINDS, TASK_KIND_LABEL, RESPONSE_KINDS } from "./case-meta.js";
import { notify } from "./monitor.js";
const STATUSES = ["pendiente", "hecha", "cancelada"];
const str = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const LOCAL = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function agendaRouter(db) {
  const r = express.Router();

  const officeCond = (req) => {
    const sc = scopeOf(req.user);
    return sc === null ? "1 = 1" : sc.length ? `k.office_id IN (${sc.map(Number).join(",")})` : "0 = 1";
  };
  const SELECT = `SELECT t.*, k.radicado, k.title AS case_title, k.office_id, c.full_name AS client_name,
      ${typePath("pt")} AS type_name, u.name AS assigned_name, ku.name AS case_assigned_name, cb.name AS created_by_name, ud.name AS done_by_name
    FROM tasks t JOIN cases k ON k.id = t.case_id JOIN clients c ON c.id = k.client_id
    JOIN process_types pt ON pt.id = k.process_type_id LEFT JOIN users u ON u.id = t.assigned_user_id
    LEFT JOIN users ku ON ku.id = k.assigned_user_id LEFT JOIN users cb ON cb.id = t.created_by LEFT JOIN users ud ON ud.id = t.done_by`;
  const out = (t) => ({ ...t, remind_days: JSON.parse(t.remind_days) });
  const visible = (req, id) => db.prepare(`${SELECT} WHERE t.id = ? AND ${officeCond(req)}`).get(id);
  const caseVisible = (req, caseId) => db.prepare(`SELECT k.* FROM cases k WHERE k.id = ? AND ${officeCond(req)}`).get(caseId);
  const err = (res, status, error) => res.status(status).json({ error });

  function values(req, b, cur = {}) {
    const v = {
      kind: KINDS.includes(b.kind) ? b.kind : cur.kind || "tarea",
      title: "title" in b ? str(b.title) : cur.title,
      notes: "notes" in b ? str(b.notes) : cur.notes || "",
      due_at: "due_at" in b ? str(b.due_at).replace("T", " ").slice(0, 16) : cur.due_at,
      location: "location" in b ? str(b.location) : cur.location || "",
      assigned_user_id: "assigned_user_id" in b ? (Number(b.assigned_user_id) || null) : cur.assigned_user_id ?? null,
      remind_days: "remind_days" in b ? b.remind_days : cur.remind_days ?? [1],
      status: STATUSES.includes(b.status) ? b.status : cur.status || "pendiente",
      done_notes: "done_notes" in b ? str(b.done_notes) : cur.done_notes || "",
      delivered_at: "delivered_at" in b ? str(b.delivered_at).slice(0, 10) : cur.delivered_at || "",
      response_at: "response_at" in b ? str(b.response_at).slice(0, 10) : cur.response_at || "",
      response_notes: "response_notes" in b ? str(b.response_notes) : cur.response_notes || "",
    };
    if (!RESPONSE_KINDS.includes(v.kind)) Object.assign(v, { delivered_at: "", response_at: "", response_notes: "" });
    if ((v.delivered_at && !DAY.test(v.delivered_at)) || (v.response_at && !DAY.test(v.response_at))) return "Fecha no válida.";
    // An answer received closes the oficio / petition.
    if (v.response_at && v.response_at !== (cur.response_at || "") && v.status !== "cancelada") v.status = "hecha";
    if (!v.title) return "Escriba el título.";
    if (!LOCAL.test(v.due_at || "")) return "Indique fecha y hora.";
    if (!Array.isArray(v.remind_days) || v.remind_days.some((d) => !Number.isInteger(d) || d < 0 || d > 60)) return "Avisos no válidos.";
    if (v.assigned_user_id && !db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(v.assigned_user_id)) return "El responsable no existe.";
    v.remind_days = JSON.stringify([...new Set(v.remind_days)].sort((a, b) => b - a));
    return v;
  }

  // The person a task is assigned to hears about it in the bell, with a link to the case.
  function tellAssignee(req, t, before) {
    if (!t?.assigned_user_id || t.assigned_user_id === before || t.assigned_user_id === req.user.id || t.status !== "pendiente") return;
    notify(db, t.assigned_user_id, "asignada", `${req.user.name} le asignó: ${TASK_KIND_LABEL[t.kind]} · ${t.title}`,
      `Plazo ${t.due_at} · ${t.client_name}`, `#expediente-${t.case_id}`, `assign:${t.id}:${t.assigned_user_id}`);
  }

  r.get("/tasks", (req, res) => {
    const where = [officeCond(req)], params = [];
    if (req.query.caseId) { where.push("t.case_id = ?"); params.push(Number(req.query.caseId)); }
    // Mine: assigned to me; else the case is mine; else nobody is responsible and I created it.
    if (req.query.mine === "1") {
      where.push(`(t.assigned_user_id = ? OR (t.assigned_user_id IS NULL AND (k.assigned_user_id = ?
        OR (k.assigned_user_id IS NULL AND t.created_by = ?))))`);
      params.push(req.user.id, req.user.id, req.user.id);
    }
    if (req.query.userId) {
      where.push("COALESCE(t.assigned_user_id, k.assigned_user_id) = ?");
      params.push(Number(req.query.userId));
    }
    if (STATUSES.includes(req.query.status)) { where.push("t.status = ?"); params.push(req.query.status); }
    if (KINDS.includes(req.query.kind)) { where.push("t.kind = ?"); params.push(req.query.kind); }
    if (LOCAL.test(req.query.from || "")) { where.push("t.due_at >= ?"); params.push(req.query.from); }
    if (LOCAL.test(req.query.to || "")) { where.push("t.due_at <= ?"); params.push(req.query.to); }
    res.json(db.prepare(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY t.due_at LIMIT 1000`).all(...params).map(out));
  });

  r.post("/tasks", (req, res) => {
    if (!can(req, "cases.write")) return err(res, 403, "Su rol no tiene permiso para esta acción.");
    const caseId = Number(req.body?.case_id);
    if (!caseVisible(req, caseId)) return err(res, 404, "El expediente no existe.");
    const v = values(req, req.body ?? {});
    if (typeof v === "string") return err(res, 400, v);
    const done = v.status === "hecha";
    const id = db.prepare(`INSERT INTO tasks (case_id, kind, title, notes, due_at, location, assigned_user_id, remind_days, status, created_by,
        done_at, done_by, done_notes, delivered_at, response_at, response_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${done ? "datetime('now')" : "NULL"}, ?, ?, ?, ?, ?)`).run(caseId, v.kind, v.title, v.notes, v.due_at, v.location, v.assigned_user_id,
      v.remind_days, v.status, req.user.id, done ? req.user.id : null, v.done_notes, v.delivered_at, v.response_at, v.response_notes).lastInsertRowid;
    const t = visible(req, id);
    tellAssignee(req, t, null);
    res.status(201).json(out(t));
  });

  r.put("/tasks/:id", (req, res) => {
    if (!can(req, "cases.write")) return err(res, 403, "Su rol no tiene permiso para esta acción.");
    const cur = visible(req, Number(req.params.id));
    if (!cur) return err(res, 404, "La tarea no existe.");
    const v = values(req, req.body ?? {}, out(cur));
    if (typeof v === "string") return err(res, 400, v);
    db.prepare(`UPDATE tasks SET kind = ?, title = ?, notes = ?, due_at = ?, location = ?, assigned_user_id = ?, remind_days = ?, status = ?,
      done_at = CASE WHEN ? = 'hecha' AND status != 'hecha' THEN datetime('now') WHEN ? != 'hecha' THEN NULL ELSE done_at END,
      done_by = CASE WHEN ? = 'hecha' AND status != 'hecha' THEN ? WHEN ? != 'hecha' THEN NULL ELSE done_by END,
      done_notes = ?, delivered_at = ?, response_at = ?, response_notes = ? WHERE id = ?`)
      .run(v.kind, v.title, v.notes, v.due_at, v.location, v.assigned_user_id, v.remind_days, v.status, v.status, v.status,
        v.status, req.user.id, v.status, v.done_notes, v.delivered_at, v.response_at, v.response_notes, cur.id);
    tellAssignee(req, visible(req, cur.id), cur.assigned_user_id);
    // A rescheduled task gets fresh reminders.
    if (v.due_at !== cur.due_at) db.prepare("DELETE FROM notifications WHERE key LIKE ?").run(`task:${cur.id}:%`);
    res.json(out(visible(req, cur.id)));
  });

  r.delete("/tasks/:id", (req, res) => {
    if (!can(req, "cases.write")) return err(res, 403, "Su rol no tiene permiso para esta acción.");
    const cur = visible(req, Number(req.params.id));
    if (!cur) return err(res, 404, "La tarea no existe.");
    db.prepare("DELETE FROM tasks WHERE id = ?").run(cur.id);
    res.status(204).end();
  });

  r.get("/notifications", (req, res) => {
    const items = db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50").all(req.user.id).map((n) => ({ ...n }));
    const unread = db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL").get(req.user.id).n;
    res.json({ items, unread });
  });

  r.post("/notifications/read", (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : null;
    if (ids?.length) {
      db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL AND id IN (${ids.join(",")})`).run(req.user.id);
    } else {
      db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(req.user.id);
    }
    res.status(204).end();
  });

  return r;
}
