// Process monitoring, task reminders and scheduled reports. Times are
// Colombia local time (UTC-5, no daylight saving).
import { findByRadicado, actuaciones } from "./ramajudicial.js";
import { sendEmail, sendWhatsapp } from "./notify.js";
import { loadUser, scopeOf } from "./auth.js";
import { LIVE_STATUSES } from "./case-meta.js";
import { paymentReminders } from "./payments.js";

export const REPORT_HOURS = ["07:00", "13:00", "17:00"];
const OPEN = LIVE_STATUSES;

/** 'YYYY-MM-DD HH:MM' in Bogotá for a Date (default now). */
export function bogota(date = new Date()) {
  return new Date(date.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
}
/** Epoch ms for a Bogotá local 'YYYY-MM-DD HH:MM'. */
export const bogotaMs = (local) => Date.parse(String(local).replace(" ", "T") + ":00-05:00");
const sqlUtc = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

function notify(db, userId, kind, title, body, link, key) {
  db.prepare(`INSERT OR IGNORE INTO notifications (user_id, kind, title, body, link, key) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(userId, kind, title, body, link, key ?? null);
}

// ---------- Rama Judicial checks ----------

/** Consult one case; returns { caseId, ok, newCount, error }. */
export async function checkCase(db, caseId) {
  const k = db.prepare("SELECT * FROM cases WHERE id = ?").get(caseId);
  if (!k?.radicado) return { caseId, ok: false, newCount: 0, error: "El expediente no tiene radicado." };
  const hadBaseline = !!db.prepare("SELECT 1 FROM process_checks WHERE case_id = ? AND ok = 1").get(caseId);
  try {
    let processId = k.ext_process_id;
    if (!processId) {
      const found = (await findByRadicado(k.radicado)).filter((p) => !p.radicado || p.radicado === k.radicado);
      if (!found.length) throw new Error("La Rama Judicial no tiene registrado este radicado.");
      found.sort((a, b) => (b.lastAction || "").localeCompare(a.lastAction || ""));
      processId = found[0].id;
      db.prepare(`UPDATE cases SET ext_process_id = ?, court_name = CASE WHEN court_name = '' THEN ? ELSE court_name END WHERE id = ?`)
        .run(processId, found[0].court, caseId);
    }
    const acts = await actuaciones(processId);
    const ins = db.prepare(`INSERT OR IGNORE INTO actuaciones (case_id, ext_key, fecha, actuacion, anotacion, fecha_inicial, fecha_final)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    let inserted = 0;
    for (const a of acts) inserted += ins.run(caseId, a.key, a.fecha, a.actuacion, a.anotacion, a.fecha_inicial, a.fecha_final).changes;
    // The first successful check only records history; novelties start after it.
    const newCount = hadBaseline ? inserted : 0;
    const last = acts.map((a) => a.fecha).sort().at(-1) || null;
    db.prepare("UPDATE cases SET last_checked_at = datetime('now'), last_action_date = COALESCE(?, last_action_date) WHERE id = ?").run(last, caseId);
    db.prepare("INSERT INTO process_checks (case_id, ok, new_count) VALUES (?, 1, ?)").run(caseId, newCount);
    if (newCount) {
      const users = new Set([k.assigned_user_id].filter(Boolean));
      for (const u of users) {
        notify(db, u, "actuacion", `${newCount} actuación(es) nueva(s)`, `Radicado ${k.radicado}`, `#consulta`, null);
      }
    }
    return { caseId, ok: true, newCount, error: "" };
  } catch (err) {
    db.prepare("INSERT INTO process_checks (case_id, ok, error) VALUES (?, 0, ?)").run(caseId, err.message);
    db.prepare("UPDATE cases SET last_checked_at = datetime('now') WHERE id = ?").run(caseId);
    return { caseId, ok: false, newCount: 0, error: err.message };
  }
}

export async function checkCases(db, caseIds, { pauseMs = 800 } = {}) {
  const out = [];
  for (const id of caseIds) {
    out.push(await checkCase(db, id));
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs)); // be gentle with the public service
  }
  return out;
}

// ---------- Report ----------

const prefsOf = (db, userId) => {
  const p = db.prepare("SELECT * FROM report_prefs WHERE user_id = ?").get(userId);
  const u = db.prepare("SELECT email, phone FROM users WHERE id = ?").get(userId);
  return p
    ? { ...p, hours: JSON.parse(p.hours), by_email: !!p.by_email, by_whatsapp: !!p.by_whatsapp, email: p.email || u.email }
    : { user_id: userId, hours: ["07:00"], by_email: true, email: u.email, by_whatsapp: false, whatsapp: u.phone, scope: "mine" };
};
export { prefsOf };

/** Monitored cases a user's report covers, limited to the offices they can see. */
export function reportCaseIds(db, userId) {
  const user = loadUser(db, userId);
  const p = prefsOf(db, userId);
  const sc = scopeOf(user);
  const inScope = sc === null ? "1 = 1" : sc.length ? `office_id IN (${sc.join(",")})` : "0 = 1";
  let rows;
  if (p.scope === "selected") {
    rows = db.prepare(`SELECT id FROM cases WHERE radicado != '' AND ${inScope}
      AND id IN (SELECT case_id FROM report_selection WHERE user_id = ?)`).all(userId);
  } else if (p.scope === "office") {
    rows = db.prepare(`SELECT id FROM cases WHERE monitor = 1 AND radicado != '' AND ${inScope}`).all();
  } else {
    rows = db.prepare(`SELECT id FROM cases WHERE monitor = 1 AND radicado != '' AND assigned_user_id = ? AND ${inScope}`).all(userId);
  }
  return rows.map((r) => r.id);
}

/** Text + HTML report: new actions since the user's last report, and the next 7 days of agenda. */
export function buildReport(db, userId, now = new Date()) {
  const ids = reportCaseIds(db, userId);
  const last = db.prepare("SELECT MAX(sent_at) AS t FROM report_log WHERE user_id = ?").get(userId).t
    || sqlUtc(now.getTime() - 24 * 3600 * 1000);
  const idList = ids.length ? ids.join(",") : "NULL";
  const news = db.prepare(`
    SELECT a.*, k.radicado, k.court_name, c.full_name AS client
    FROM actuaciones a JOIN cases k ON k.id = a.case_id JOIN clients c ON c.id = k.client_id
    WHERE a.case_id IN (${idList}) AND a.found_at > ? AND EXISTS (
      SELECT 1 FROM process_checks pc WHERE pc.case_id = a.case_id AND pc.ok = 1 AND pc.checked_at < a.found_at)
    ORDER BY a.case_id, a.fecha DESC`).all(last);
  const errors = db.prepare(`
    SELECT k.radicado, pc.error FROM cases k JOIN process_checks pc ON pc.id = (
      SELECT id FROM process_checks WHERE case_id = k.id ORDER BY id DESC LIMIT 1)
    WHERE k.id IN (${idList}) AND pc.ok = 0`).all();
  const user = loadUser(db, userId);
  const sc = scopeOf(user);
  const officeCond = sc === null ? "1 = 1" : sc.length ? `k.office_id IN (${sc.join(",")})` : "0 = 1";
  const from = bogota(now), to = bogota(new Date(now.getTime() + 7 * 86400000));
  const agenda = db.prepare(`
    SELECT t.*, c.full_name AS client, k.radicado FROM tasks t JOIN cases k ON k.id = t.case_id JOIN clients c ON c.id = k.client_id
    WHERE t.status = 'pendiente' AND t.due_at BETWEEN ? AND ? AND ${officeCond}
      AND (t.assigned_user_id = ? OR (t.assigned_user_id IS NULL AND (k.assigned_user_id = ?
        OR (k.assigned_user_id IS NULL AND t.created_by = ?))))
    ORDER BY t.due_at`).all(from, to, userId, userId, userId);

  const KIND = { tarea: "Tarea", audiencia: "Audiencia", termino: "Término" };
  const lines = [`TecjuridicosApp · Reporte de procesos · ${bogota(now)} (hora Colombia)`, ""];
  lines.push(`Procesos consultados: ${ids.length}. Actuaciones nuevas: ${news.length}.`);
  if (news.length) {
    lines.push("", "ACTUACIONES NUEVAS");
    for (const a of news) lines.push(`• ${a.radicado} (${a.client}) · ${a.fecha} · ${a.actuacion}${a.anotacion ? " — " + a.anotacion : ""}`);
  }
  if (agenda.length) {
    lines.push("", "PRÓXIMOS 7 DÍAS");
    for (const t of agenda) lines.push(`• ${t.due_at} · ${KIND[t.kind]}: ${t.title} (${t.client})`);
  }
  if (errors.length) {
    lines.push("", "NO SE PUDIERON CONSULTAR");
    for (const e of errors) lines.push(`• ${e.radicado}: ${e.error}`);
  }
  const text = lines.join("\n");
  const esc = (x) => String(x).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const html = `<div style="font-family:Arial,sans-serif;color:#101010">
    <h2 style="color:#002b6a;margin:0 0 4px">Reporte de procesos</h2>
    <p style="color:#555;margin:0 0 16px">${esc(bogota(now))} (hora Colombia) · ${ids.length} procesos · ${news.length} actuaciones nuevas</p>
    ${news.length ? `<h3 style="color:#002b6a">Actuaciones nuevas</h3><table cellpadding="6" style="border-collapse:collapse;font-size:13px">
      <tr style="background:#002b6a;color:#fff"><th align="left">Radicado</th><th align="left">Cliente</th><th align="left">Fecha</th><th align="left">Actuación</th></tr>
      ${news.map((a) => `<tr style="border-bottom:1px solid #ddd"><td>${esc(a.radicado)}</td><td>${esc(a.client)}</td><td>${esc(a.fecha)}</td>
        <td><strong>${esc(a.actuacion)}</strong>${a.anotacion ? "<br>" + esc(a.anotacion) : ""}</td></tr>`).join("")}</table>` : "<p>Sin actuaciones nuevas.</p>"}
    ${agenda.length ? `<h3 style="color:#002b6a">Próximos 7 días</h3><ul>${agenda.map((t) => `<li>${esc(t.due_at)} · ${KIND[t.kind]}: ${esc(t.title)} (${esc(t.client)})</li>`).join("")}</ul>` : ""}
    ${errors.length ? `<h3 style="color:#b3261e">No se pudieron consultar</h3><ul>${errors.map((e) => `<li>${esc(e.radicado)}: ${esc(e.error)}</li>`).join("")}</ul>` : ""}
    <p style="color:#888;font-size:12px">Fuente: Consulta Nacional Unificada de Procesos, Rama Judicial. Verifique en el despacho antes de actuar.</p></div>`;
  return { text, html, caseCount: ids.length, newCount: news.length, agendaCount: agenda.length };
}

/** Build and deliver one user's report; logs it and leaves an in-app copy. */
export async function deliverReport(db, userId, trigger, now = new Date()) {
  const p = prefsOf(db, userId);
  const r = buildReport(db, userId, now);
  const results = [];
  const subject = `TecjuridicosApp · ${r.newCount} actuación(es) nueva(s) · ${bogota(now).slice(0, 10)}`;
  if (p.by_email) results.push(await sendEmail(p.email, subject, r.text, r.html));
  if (p.by_whatsapp) results.push(await sendWhatsapp(p.whatsapp, r.text));
  db.prepare("INSERT INTO report_log (user_id, trigger, channels, summary) VALUES (?, ?, ?, ?)")
    .run(userId, trigger, JSON.stringify(results), r.text);
  notify(db, userId, "reporte", `Reporte de procesos (${trigger === "manual" ? "manual" : trigger})`,
    `${r.caseCount} procesos · ${r.newCount} actuaciones nuevas`, "#consulta", null);
  return { ...r, channels: results };
}

// ---------- Task reminders ----------

export function taskReminders(db, now = new Date()) {
  const nowMs = now.getTime();
  const tasks = db.prepare(`SELECT t.*, k.assigned_user_id AS case_user, c.full_name AS client
    FROM tasks t JOIN cases k ON k.id = t.case_id JOIN clients c ON c.id = k.client_id WHERE t.status = 'pendiente'`).all();
  const KIND = { tarea: "Tarea", audiencia: "Audiencia", termino: "Término" };
  let created = 0;
  for (const t of tasks) {
    const due = bogotaMs(t.due_at);
    const who = t.assigned_user_id || t.case_user || t.created_by;
    if (!who) continue;
    for (const d of JSON.parse(t.remind_days || "[]")) {
      if (nowMs >= due - d * 86400000 && nowMs < due) {
        const when = d === 0 ? "hoy" : d === 1 ? "mañana" : `en ${d} días`;
        const before = db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE key = ?").get(`task:${t.id}:${d}`).n;
        notify(db, who, t.kind, `${KIND[t.kind]} ${when}: ${t.title}`, `${t.due_at} · ${t.client}${t.location ? " · " + t.location : ""}`, "#agenda", `task:${t.id}:${d}`);
        if (!before) created++;
      }
    }
    if (nowMs >= due) {
      const before = db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE key = ?").get(`task:${t.id}:overdue`).n;
      notify(db, who, "vencida", `${KIND[t.kind]} vencida: ${t.title}`, `${t.due_at} · ${t.client}`, "#agenda", `task:${t.id}:overdue`);
      if (!before) created++;
    }
  }
  return created;
}

// ---------- Scheduler ----------

/** Runs every minute: reminders always; checks + reports at the users' chosen hours. */
export function startScheduler(db, { intervalMs = 60000 } = {}) {
  const done = new Set();
  const tick = async (at = new Date()) => {
    try {
      taskReminders(db, at);
      const now = bogota(at);
      const hhmm = now.slice(11, 16);
      // Payment reminders once a day at 8:00 (Colombia).
      if (hhmm === "08:00" && !done.has("pay " + now)) { done.add("pay " + now); await paymentReminders(db, at); }
      if (!REPORT_HOURS.includes(hhmm) || done.has(now)) return;
      done.add(now);
      const users = db.prepare("SELECT user_id, hours FROM report_prefs").all()
        .filter((p) => JSON.parse(p.hours).includes(hhmm))
        .map((p) => p.user_id)
        .filter((id) => loadUser(db, id)?.active && loadUser(db, id).permissions.includes("processes.consult"));
      const caseIds = [...new Set(users.flatMap((u) => reportCaseIds(db, u)))];
      await checkCases(db, caseIds);
      for (const u of users) await deliverReport(db, u, hhmm, at);
    } catch (err) {
      console.error("scheduler:", err);
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}

export { OPEN };
