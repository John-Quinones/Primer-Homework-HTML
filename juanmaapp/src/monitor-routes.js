// Process consultation: monitored cases, manual checks, report preferences.
import express from "express";
import { typePath } from "./sql.js";
import { scopeOf } from "./auth.js";
import { checkCases, deliverReport, buildReport, prefsOf, REPORT_HOURS } from "./monitor.js";
import { channelsStatus } from "./notify.js";
import { withDecisions } from "./decision.js";

export function monitorRouter(db) {
  const r = express.Router();
  const officeCond = (req) => {
    const sc = scopeOf(req.user);
    return sc === null ? "1 = 1" : sc.length ? `k.office_id IN (${sc.map(Number).join(",")})` : "0 = 1";
  };

  r.get("/status", (req, res) => res.json({ channels: channelsStatus(), hours: REPORT_HOURS }));

  r.get("/cases", (req, res) => {
    const rows = db.prepare(`
      SELECT k.id, k.radicado, k.monitor, k.court_name, k.court_email, k.department, k.city, k.area, k.title, k.status,
             k.last_checked_at, k.last_action_date, k.office_id, k.assigned_user_id, c.full_name AS client_name, ${typePath("pt")} AS type_name,
             u.name AS assigned_name,
             (SELECT COUNT(*) FROM actuaciones a WHERE a.case_id = k.id AND a.found_at > datetime('now', '-7 days')
                AND EXISTS (SELECT 1 FROM process_checks pc WHERE pc.case_id = k.id AND pc.ok = 1 AND pc.checked_at < a.found_at)) AS new_7d,
             (SELECT error FROM process_checks pc WHERE pc.case_id = k.id ORDER BY pc.id DESC LIMIT 1) AS last_error,
             EXISTS (SELECT 1 FROM report_selection s WHERE s.user_id = ? AND s.case_id = k.id) AS selected
      FROM cases k JOIN clients c ON c.id = k.client_id JOIN process_types pt ON pt.id = k.process_type_id
      LEFT JOIN users u ON u.id = k.assigned_user_id
      WHERE k.radicado != '' AND ${officeCond(req)} ORDER BY k.last_action_date DESC, k.id DESC`).all(req.user.id);
    res.json(rows.map((x) => ({ ...x, monitor: !!x.monitor, selected: !!x.selected })));
  });

  r.get("/cases/:id/actuaciones", (req, res) => {
    const k = db.prepare(`SELECT k.id FROM cases k WHERE k.id = ? AND ${officeCond(req)}`).get(Number(req.params.id));
    if (!k) return res.status(404).json({ error: "El expediente no existe." });
    res.json(withDecisions(db.prepare("SELECT * FROM actuaciones WHERE case_id = ? ORDER BY fecha DESC, id DESC").all(k.id).map((x) => ({ ...x }))));
  });

  r.put("/cases/:id/monitor", (req, res) => {
    const k = db.prepare(`SELECT k.id FROM cases k WHERE k.id = ? AND k.radicado != '' AND ${officeCond(req)}`).get(Number(req.params.id));
    if (!k) return res.status(404).json({ error: "El expediente no existe o no tiene radicado." });
    db.prepare("UPDATE cases SET monitor = ? WHERE id = ?").run(req.body?.monitor ? 1 : 0, k.id);
    res.json({ id: k.id, monitor: !!req.body?.monitor });
  });

  // Manual check of the given cases (or all monitored ones the user can see).
  r.post("/check", async (req, res) => {
    const ids = Array.isArray(req.body?.case_ids) ? req.body.case_ids.map(Number).filter(Boolean) : null;
    const rows = ids
      ? db.prepare(`SELECT k.id FROM cases k WHERE k.radicado != '' AND ${officeCond(req)} AND k.id IN (${ids.join(",") || "NULL"})`).all()
      : db.prepare(`SELECT k.id FROM cases k WHERE k.radicado != '' AND k.monitor = 1 AND ${officeCond(req)}`).all();
    if (rows.length > 100) return res.status(400).json({ error: "Máximo 100 procesos por consulta manual." });
    const results = await checkCases(db, rows.map((x) => x.id), { pauseMs: Number(process.env.RAMA_PAUSE_MS ?? 800) });
    res.json({ results, checked: results.length, ok: results.filter((x) => x.ok).length, newCount: results.reduce((a, x) => a + x.newCount, 0) });
  });

  r.get("/prefs", (req, res) => res.json(prefsOf(db, req.user.id)));

  r.put("/prefs", (req, res) => {
    const b = req.body ?? {};
    const hours = Array.isArray(b.hours) ? b.hours.filter((h) => REPORT_HOURS.includes(h)) : [];
    const scope = ["mine", "office", "selected"].includes(b.scope) ? b.scope : "mine";
    const email = String(b.email ?? "").trim();
    const whatsapp = String(b.whatsapp ?? "").replace(/[^\d+]/g, "");
    if (b.by_email && email && !email.includes("@")) return res.status(400).json({ error: "Correo no válido." });
    if (b.by_whatsapp && whatsapp.replace(/\D/g, "").length < 10) return res.status(400).json({ error: "Número de WhatsApp no válido." });
    db.prepare(`INSERT INTO report_prefs (user_id, hours, by_email, email, by_whatsapp, whatsapp, scope) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET hours = excluded.hours, by_email = excluded.by_email, email = excluded.email,
        by_whatsapp = excluded.by_whatsapp, whatsapp = excluded.whatsapp, scope = excluded.scope`)
      .run(req.user.id, JSON.stringify(hours), b.by_email ? 1 : 0, email, b.by_whatsapp ? 1 : 0, whatsapp, scope);
    if (Array.isArray(b.selected)) {
      db.prepare("DELETE FROM report_selection WHERE user_id = ?").run(req.user.id);
      const ins = db.prepare("INSERT OR IGNORE INTO report_selection (user_id, case_id) VALUES (?, ?)");
      for (const id of b.selected.map(Number).filter(Boolean)) {
        if (db.prepare(`SELECT 1 FROM cases k WHERE k.id = ? AND ${officeCond(req)}`).get(id)) ins.run(req.user.id, id);
      }
    }
    res.json(prefsOf(db, req.user.id));
  });

  r.get("/report/preview", (req, res) => res.json(buildReport(db, req.user.id)));

  // Manual report now: optionally re-check first, then deliver through the user's channels.
  r.post("/report", async (req, res) => {
    if (req.body?.check) {
      const { reportCaseIds } = await import("./monitor.js");
      await checkCases(db, reportCaseIds(db, req.user.id), { pauseMs: Number(process.env.RAMA_PAUSE_MS ?? 800) });
    }
    res.json(await deliverReport(db, req.user.id, "manual"));
  });

  r.get("/log", (req, res) => {
    res.json(db.prepare("SELECT * FROM report_log WHERE user_id = ? ORDER BY id DESC LIMIT 30").all(req.user.id)
      .map((x) => ({ ...x, channels: JSON.parse(x.channels) })));
  });

  return r;
}
