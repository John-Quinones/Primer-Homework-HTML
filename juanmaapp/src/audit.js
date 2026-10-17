// Audit log (change 50): every change made through the API, with who, when (UTC,
// shown in Colombia time), from which device and IP, and what changed field by field.
// Sign-ins, sign-outs and password events are logged explicitly by auth.js / microsoft.js.
// Entries are never edited or deleted from the app.
import express from "express";
import { auditTarget, auditVerb, auditDiff, deviceOf } from "./case-meta.js";
import { scopeOf, hiddenUnlocked, ASSISTANT } from "./auth.js";

export const AUDIT_SCHEMA = `CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY,
  at            TEXT NOT NULL DEFAULT (datetime('now')),
  user_id       INTEGER,
  user_name     TEXT NOT NULL DEFAULT '',
  action        TEXT NOT NULL,
  module        TEXT NOT NULL DEFAULT '',
  entity        TEXT NOT NULL DEFAULT '',
  record_id     INTEGER,
  case_id       INTEGER,
  summary       TEXT NOT NULL DEFAULT '',
  changes       TEXT NOT NULL DEFAULT '[]',
  ok            INTEGER NOT NULL DEFAULT 1,
  ip            TEXT NOT NULL DEFAULT '',
  device        TEXT NOT NULL DEFAULT '',
  device_detail TEXT NOT NULL DEFAULT '',
  user_agent    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS audit_at ON audit_log(at);
CREATE INDEX IF NOT EXISTS audit_case ON audit_log(case_id);`;

/** Write one entry. Never throws: the audit must not break the action it records. */
export function audit(db, req, { user = req.user, action, module = "Acceso", entity = "", record_id = null, case_id = null, summary = "", changes = [], ok = true }) {
  try {
    const ua = String(req.get?.("user-agent") || "").slice(0, 300);
    const d = deviceOf(ua);
    db.prepare(`INSERT INTO audit_log (user_id, user_name, action, module, entity, record_id, case_id, summary, changes, ok, ip, device, device_detail, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(user?.id ?? null, user?.name ?? "", action, module, entity, record_id, case_id,
      String(summary).slice(0, 500), JSON.stringify(changes), ok ? 1 : 0, String(req.ip || ""), d.kind, d.detail, ua);
  } catch (err) {
    console.error("audit:", err.message);
  }
}

// Rows read before and after a change, to know what changed.
const SNAP = [
  [/^\/cases\/(\d+)$/, "SELECT * FROM cases WHERE id = ?"],
  [/^\/cases\/(\d+)\/folder$/, "SELECT * FROM cases WHERE id = ?"],
  [/^\/clients\/(\d+)$/, "SELECT * FROM clients WHERE id = ?"],
  [/^\/tasks\/(\d+)$/, "SELECT * FROM tasks WHERE id = ?"],
  [/^\/payments\/charges\/(\d+)/, "SELECT * FROM charges WHERE id = ?"],
  [/^\/payments\/receipts\/(\d+)/, "SELECT * FROM receipts WHERE id = ?"],
  [/^\/admin\/users\/(\d+)/, `SELECT id, CASE WHEN hidden = 1 THEN '${ASSISTANT}' ELSE name END AS name, CASE WHEN hidden = 1 THEN '' ELSE email END AS email,
    role, active, phone, professional_card, custom_permissions FROM users WHERE id = ?`],
  [/^\/esign\/(\d+)/, "SELECT id, title, status, case_id FROM sign_requests WHERE id = ?"],
];
const parseRow = (row) => {
  if (!row) return null;
  const o = { ...row };
  for (const k of ["parties", "field_values", "remind_days"]) if (typeof o[k] === "string") try { o[k] = JSON.parse(o[k]); } catch {}
  return o;
};
const nameOf = (x) => x && (x.full_name || x.title || x.name || x.concept || x.subject || (x.number ? `N.º ${x.number}` : "") || x.email || "");
// Reads and housekeeping that are not changes.
// Hiding users is logged by auth.js itself, without the hidden user's name.
const SKIP = [/^\/notifications/, /^\/auth\//, /^\/admin\/hidden-users\//, /^\/admin\/users\/\d+\/hidden$/, /^\/monitor\/report\/preview/, /^\/payments\/reminders\/preview/];

/** Middleware after requireAuth: logs every successful (or denied) change. */
export function auditMiddleware(db) {
  return (req, res, next) => {
    if (!req.user || !["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    const path = req.path;
    if (SKIP.some((re) => re.test(path))) return next();
    const snap = SNAP.find(([re]) => re.test(path));
    const sql = snap?.[1], rid = snap ? Number(path.match(snap[0])[1]) : null;
    let before = null;
    try { before = sql ? parseRow(db.prepare(sql).get(rid)) : null; } catch {}
    let body = null;
    const json = res.json.bind(res);
    res.json = (x) => { body = x; return json(x); };
    res.on("finish", () => {
      const ok = res.statusCode < 400;
      if (!ok && ![401, 403].includes(res.statusCode)) return; // validation errors change nothing
      const t = auditTarget(path);
      let after = null;
      try { after = ok && sql && req.method !== "DELETE" ? parseRow(db.prepare(sql).get(rid)) : null; } catch {}
      const created = req.method === "POST" && body && typeof body === "object" && !Array.isArray(body) ? body : null;
      const record = rid ?? t.id ?? created?.id ?? null;
      const caseId = t.isCase ? t.id ?? created?.id ?? null : after?.case_id ?? before?.case_id ?? created?.case_id ?? (Number(req.body?.case_id) || null);
      const name = nameOf(after) || nameOf(before) || nameOf(created) || "";
      const verb = ok ? auditVerb(req.method, path) : "Intentó (sin permiso)";
      const extra = path.match(/\/(void|cancel|resend|invite|monitor|documents|folder)\b/)?.[1];
      audit(db, req, {
        action: verb, module: t.module, entity: t.entity, record_id: record, case_id: caseId, ok,
        summary: `${verb} ${t.entity}${name ? ` «${name}»` : ""}${extra ? ` (${{ void: "anulación", cancel: "cancelación", resend: "reenvío", invite: "invitación", monitor: "consulta automática", documents: "documento", folder: "número de carpeta" }[extra]})` : ""}`,
        changes: req.method === "PUT" || req.method === "PATCH" ? auditDiff(before, after) : [],
      });
    });
    next();
  };
}

export function auditRouter(db) {
  const r = express.Router();
  const can = (req, p) => req.user.permissions.includes(p);
  r.get("/", (req, res) => {
    const q = req.query, where = [], params = [];
    if (q.caseId) {
      // A case's own history: anyone who can see the case.
      const k = db.prepare("SELECT office_id FROM cases WHERE id = ?").get(Number(q.caseId));
      const sc = scopeOf(req.user);
      if (!k || (sc !== null && !sc.includes(k.office_id))) return res.status(404).json({ error: "El expediente no existe." });
      where.push("case_id = ?"); params.push(Number(q.caseId));
    } else if (!can(req, "audit.view")) {
      return res.status(403).json({ error: "Su rol no tiene permiso para ver la bitácora." });
    }
    // Dates are Colombia days: from 00:00 to 23:59 local (UTC+5 h).
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || "")) { where.push("at >= datetime(?, '+5 hours')"); params.push(q.from); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || "")) { where.push("at < datetime(?, '+29 hours')"); params.push(q.to); }
    if (q.userId) { where.push("user_id = ?"); params.push(Number(q.userId)); }
    if (q.module) { where.push("module = ?"); params.push(String(q.module)); }
    if (q.device) { where.push("device = ?"); params.push(String(q.device)); }
    // A hidden user's real name is never a search hit while the hidden users stay locked.
    const unlocked = hiddenUnlocked(req);
    if (q.q) { where.push(`(summary LIKE ? OR (user_name LIKE ?${unlocked ? "" : " AND COALESCE(user_id, 0) NOT IN (SELECT id FROM users WHERE hidden = 1)"}) OR changes LIKE ?)`); const like = `%${String(q.q).slice(0, 80)}%`; params.push(like, like, like); }
    if (q.before) { where.push("id < ?"); params.push(Number(q.before)); }
    const rows = db.prepare(`SELECT * FROM audit_log ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT 300`).all(...params);
    // The entry keeps who really did it (user_id); a hidden user reads "Asistente" unless unlocked.
    const hiddenRows = db.prepare("SELECT id, name, email FROM users WHERE hidden = 1").all();
    const hidden = new Map(hiddenRows.map((u) => [u.id, u.name]));
    // Older entries about a hidden user (created, edited) name them too: masked while locked.
    const mask = (t) => (unlocked ? t : hiddenRows.reduce((acc, u) => (u.name ? acc.split(u.name).join(ASSISTANT) : acc).split(u.email || "\u0000").join("(oculto)"), t));
    res.json(rows.map((x) => ({ ...x, ok: !!x.ok, summary: mask(x.summary), changes: JSON.parse(mask(x.changes || "[]")),
      ...(hidden.has(x.user_id) ? { user_name: unlocked ? `${hidden.get(x.user_id)} (oculto)` : ASSISTANT, hidden_user: true } : {}) })));
  });
  return r;
}
