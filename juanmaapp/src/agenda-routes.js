// Tasks, hearings and deadlines on cases, plus each user's notifications.
import express from "express";
import { typePath } from "./sql.js";
import { can, scopeOf, loadUser } from "./auth.js";
import { TASK_KINDS as KINDS, TASK_KIND_LABEL, RESPONSE_KINDS, taskLogEvents } from "./case-meta.js";
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
  const SELECT = `SELECT t.*, k.radicado, k.title AS case_title, k.office_id, k.client_id, c.full_name AS client_name,
      ${typePath("pt")} AS type_name, u.name AS assigned_name, ku.name AS case_assigned_name, cb.name AS created_by_name, ud.name AS done_by_name
    FROM tasks t JOIN cases k ON k.id = t.case_id JOIN clients c ON c.id = k.client_id
    JOIN process_types pt ON pt.id = k.process_type_id LEFT JOIN users_shown u ON u.id = t.assigned_user_id
    LEFT JOIN users_shown ku ON ku.id = k.assigned_user_id LEFT JOIN users_shown cb ON cb.id = t.created_by LEFT JOIN users_shown ud ON ud.id = t.done_by`;
  const out = (t) => ({ ...t, remind_days: JSON.parse(t.remind_days) });
  const visible = (req, id) => db.prepare(`${SELECT} WHERE t.id = ? AND ${officeCond(req)}`).get(id);
  const caseVisible = (req, caseId) => db.prepare(`SELECT k.* FROM cases k WHERE k.id = ? AND ${officeCond(req)}`).get(caseId);
  const err = (res, status, error) => res.status(status).json({ error });

  function values(req, b, cur = {}, officeId = null) {
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
      term_from: "term_from" in b ? str(b.term_from).slice(0, 10) : cur.term_from || "",
      term_days: "term_days" in b ? (Number.isInteger(Number(b.term_days)) && Number(b.term_days) > 0 && b.term_days !== "" ? Number(b.term_days) : null) : cur.term_days ?? null,
      term_unit: "term_unit" in b ? (b.term_unit === "calendario" ? "calendario" : "habiles") : cur.term_unit || "",
      term_label: "term_label" in b ? str(b.term_label).slice(0, 200) : cur.term_label || "",
    };
    if (v.term_days && v.term_days > 400) return "Término no válido.";
    if (v.term_from && !DAY.test(v.term_from)) return "Fecha no válida.";
    if (!v.term_days || !v.term_from) Object.assign(v, { term_from: "", term_days: null, term_unit: "", term_label: "" });
    if (!RESPONSE_KINDS.includes(v.kind)) Object.assign(v, { delivered_at: "", response_at: "", response_notes: "" });
    if ((v.delivered_at && !DAY.test(v.delivered_at)) || (v.response_at && !DAY.test(v.response_at))) return "Fecha no válida.";
    // An answer received closes the oficio / petition.
    if (v.response_at && v.response_at !== (cur.response_at || "") && v.status !== "cancelada") v.status = "hecha";
    if (!v.title) return "Escriba el título.";
    if (!LOCAL.test(v.due_at || "")) return "Indique fecha y hora.";
    if (!Array.isArray(v.remind_days) || v.remind_days.some((d) => !Number.isInteger(d) || d < 0 || d > 60)) return "Avisos no válidos.";
    if (v.assigned_user_id && !db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(v.assigned_user_id)) return "El responsable no existe.";
    // The assignee must be able to open the case: its office, or every office (audit A01-003).
    if (v.assigned_user_id && v.assigned_user_id !== cur.assigned_user_id && officeId != null) {
      const u = loadUser(db, v.assigned_user_id);
      if (!u.permissions.includes("scope.all") && !u.offices.some((o) => o.id === officeId)) return "Ese funcionario no tiene acceso a la oficina de este expediente.";
    }
    v.remind_days = JSON.stringify([...new Set(v.remind_days)].sort((a, b) => b - a));
    return v;
  }

  // Task history (version 2.18): one row per thing done to a task, with who and when.
  const shownName = (id) => db.prepare("SELECT name FROM users_shown WHERE id = ?").get(id)?.name || "";
  function logTask(req, before, after) {
    const t = after || before;
    const ins = db.prepare("INSERT INTO task_log (task_id, case_id, user_id, action, kind, title, detail, assigned_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const e of taskLogEvents(before, after, shownName)) ins.run(t.id, t.case_id, req.user.id, e.action, t.kind, t.title, String(e.detail).slice(0, 500), t.assigned_user_id ?? null);
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
    const v = values(req, req.body ?? {}, {}, caseVisible(req, caseId).office_id);
    if (typeof v === "string") return err(res, 400, v);
    const done = v.status === "hecha";
    const id = db.prepare(`INSERT INTO tasks (case_id, kind, title, notes, due_at, location, assigned_user_id, remind_days, status, created_by,
        done_at, done_by, done_notes, delivered_at, response_at, response_notes, term_from, term_days, term_unit, term_label)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${done ? "datetime('now')" : "NULL"}, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(caseId, v.kind, v.title, v.notes, v.due_at, v.location, v.assigned_user_id,
      v.remind_days, v.status, req.user.id, done ? req.user.id : null, v.done_notes, v.delivered_at, v.response_at, v.response_notes,
      v.term_from, v.term_days, v.term_unit, v.term_label).lastInsertRowid;
    const t = visible(req, id);
    logTask(req, null, out(t));
    tellAssignee(req, t, null);
    res.status(201).json(out(t));
  });

  r.put("/tasks/:id", (req, res) => {
    if (!can(req, "cases.write")) return err(res, 403, "Su rol no tiene permiso para esta acción.");
    const cur = visible(req, Number(req.params.id));
    if (!cur) return err(res, 404, "La tarea no existe.");
    const v = values(req, req.body ?? {}, out(cur), cur.office_id);
    if (typeof v === "string") return err(res, 400, v);
    db.prepare(`UPDATE tasks SET kind = ?, title = ?, notes = ?, due_at = ?, location = ?, assigned_user_id = ?, remind_days = ?, status = ?,
      done_at = CASE WHEN ? = 'hecha' AND status != 'hecha' THEN datetime('now') WHEN ? != 'hecha' THEN NULL ELSE done_at END,
      done_by = CASE WHEN ? = 'hecha' AND status != 'hecha' THEN ? WHEN ? != 'hecha' THEN NULL ELSE done_by END,
      done_notes = ?, delivered_at = ?, response_at = ?, response_notes = ?, term_from = ?, term_days = ?, term_unit = ?, term_label = ? WHERE id = ?`)
      .run(v.kind, v.title, v.notes, v.due_at, v.location, v.assigned_user_id, v.remind_days, v.status, v.status, v.status,
        v.status, req.user.id, v.status, v.done_notes, v.delivered_at, v.response_at, v.response_notes, v.term_from, v.term_days, v.term_unit, v.term_label, cur.id);
    logTask(req, out(cur), out(visible(req, cur.id)));
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
    logTask(req, out(cur), null);
    res.status(204).end();
  });

  // History of a case's tasks, newest first; ?userId= keeps what that person did or what was assigned to them.
  // Tasks from before version 2.18 show only what they kept: who created them and who closed them.
  r.get("/task-log", (req, res) => {
    const caseId = Number(req.query.caseId);
    if (!caseVisible(req, caseId)) return err(res, 404, "El expediente no existe.");
    const rows = db.prepare(`SELECT l.*, u.name AS user_name, a.name AS assigned_name FROM task_log l LEFT JOIN users_shown u ON u.id = l.user_id
      LEFT JOIN users_shown a ON a.id = l.assigned_user_id WHERE l.case_id = ? ORDER BY l.id DESC`).all(caseId).map((x) => ({ ...x }));
    const logged = new Set(rows.map((x) => `${x.action}:${x.task_id}`));
    for (const t of db.prepare(`${SELECT} WHERE t.case_id = ?`).all(caseId)) {
      const base = { task_id: t.id, case_id: caseId, kind: t.kind, title: t.title, assigned_user_id: t.assigned_user_id, assigned_name: t.assigned_name, earlier: true };
      if (t.created_at && !logged.has(`creada:${t.id}`)) rows.push({ ...base, at: t.created_at, user_id: t.created_by, user_name: t.created_by_name || "", action: "creada", detail: "" });
      if (t.done_at && t.status === "hecha" && !logged.has(`hecha:${t.id}`)) rows.push({ ...base, at: t.done_at, user_id: t.done_by, user_name: t.done_by_name || "", action: "hecha", detail: t.done_notes || "" });
    }
    const uid = Number(req.query.userId) || null;
    res.json(rows.filter((x) => !uid || x.user_id === uid || x.assigned_user_id === uid)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)) || (b.id || 0) - (a.id || 0)));
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
