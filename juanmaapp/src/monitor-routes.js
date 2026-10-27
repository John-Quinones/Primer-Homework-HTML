// Process consultation: monitored cases, manual checks, report preferences.
import express from "express";
import { typePath } from "./sql.js";
import { scopeOf } from "./auth.js";
import { checkCase, checkCases, deliverReport, buildReport, prefsOf, REPORT_HOURS, getSchedule, setSchedule, runCycle, cycleState } from "./monitor.js";
import { probePublicaciones, urlTemplate } from "./publicaciones.js";
import { channelsStatus } from "./notify.js";
import { withDecisions } from "./decision.js";
import { checkAllPortals, probePortals } from "./portal-check.js";
import { findByRadicado, processDetail } from "./ramajudicial.js";
import { PORTALS } from "./portals.js";

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
      LEFT JOIN users_shown u ON u.id = k.assigned_user_id
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

  // One request, every platform (change 55).
  r.post("/cases/:id/check-all", async (req, res) => {
    const k = db.prepare(`SELECT k.id FROM cases k WHERE k.id = ? AND ${officeCond(req)}`).get(Number(req.params.id));
    if (!k) return res.status(404).json({ error: "El expediente no existe." });
    res.json(await checkAllPortals(db, k.id));
  });

  // «Consultar en Rama Judicial» (version 2.N): the national query (CPNU) right now, for one case.
  // Saves the actuaciones like the automatic check and returns the process data the portal shows.
  r.post("/cases/:id/rama", async (req, res) => {
    const k = db.prepare(`SELECT k.id, k.radicado FROM cases k WHERE k.id = ? AND ${officeCond(req)}`).get(Number(req.params.id));
    if (!k) return res.status(404).json({ error: "El expediente no existe." });
    const url = PORTALS.find((p) => p.id === "cpnu").url;
    if (!k.radicado) return res.json({ ok: false, error: "El expediente no tiene radicado.", url, processes: [], acts: [], newCount: 0, first: false });
    const first = !db.prepare("SELECT 1 FROM process_checks WHERE case_id = ? AND ok = 1").get(k.id);
    const check = await checkCase(db, k.id);
    let processes = [];
    if (check.ok) {
      try {
        processes = (await findByRadicado(k.radicado)).filter((p) => !p.radicado || p.radicado === k.radicado);
        processes.sort((a, b) => (b.lastAction || "").localeCompare(a.lastAction || ""));
        if (processes[0]) processes[0].judge = (await processDetail(processes[0].id)).judge;
      } catch { /* the actuaciones are what matters */ }
    }
    const acts = withDecisions(db.prepare("SELECT * FROM actuaciones WHERE case_id = ? ORDER BY fecha DESC, id DESC").all(k.id).map((x) => ({ ...x })));
    res.json({ ok: check.ok, error: check.error, newCount: check.newCount, first: check.ok && first, url, processes, acts });
  });

  // Connection test with the portals, from the server (Gerencia).
  r.get("/portal-probe", async (req, res) => {
    if (!req.user.permissions.includes("users.manage")) return res.status(403).json({ error: "Solo Gerencia." });
    res.json(await probePortals());
  });

  // Automatic consultation (version 2.2.83): hours chosen by Gerencia, «Consultar ahora», Publicaciones Procesales.
  const gerencia = (req, res) => (req.user.permissions.includes("users.manage") ? true : (res.status(403).json({ error: "Solo Gerencia." }), false));
  r.get("/schedule", (req, res) => res.json({ ...getSchedule(db), ...cycleState(), publicaciones: !!urlTemplate() }));
  r.put("/schedule", (req, res) => {
    if (!gerencia(req, res)) return;
    const v = setSchedule(db, req.body ?? {});
    if (v.enabled && !v.hours.length) return res.status(400).json({ error: "Indique al menos una hora." });
    res.json({ ...v, ...cycleState(), publicaciones: !!urlTemplate() });
  });
  r.post("/run-now", (req, res) => {
    if (!gerencia(req, res)) return;
    if (cycleState().running) return res.json({ started: false, ...cycleState() });
    runCycle(db, "manual").catch((err) => console.error("run-now:", err));
    res.json({ started: true, ...cycleState(), running: true });
  });
  r.get("/publicaciones-probe", async (req, res) => {
    if (!gerencia(req, res)) return;
    res.json(await probePublicaciones());
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
