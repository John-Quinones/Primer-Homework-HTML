// Mony and the agenda (version 2.2.26). Mony only READS the agenda and PROPOSES changes: nothing is saved here.
// A proposal carries the exact request the page would send (POST/PUT/DELETE /tasks) plus any overlapping events;
// the person reads the card and presses «Confirmar», so the App's own rules and permissions apply to the change.
import { scopeOf } from "./auth.js";
import { TASK_KINDS, taskFollowUp } from "./case-meta.js";
import { findCases } from "./mony-cases.js";

const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const LOCAL = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const SPAN_MIN = 60; // an event is taken to last an hour when looking for overlaps
const bogotaNow = (now = Date.now()) => new Date(now - 5 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
const ms = (local) => Date.parse(local.replace(" ", "T") + ":00Z");
const fromMs = (n) => new Date(n).toISOString().slice(0, 16).replace("T", " ");
const weekday = (local) => WEEKDAYS[new Date(ms(local)).getUTCDay()];
const normLocal = (v) => {
  const s = String(v ?? "").trim().replace("T", " ").slice(0, 16);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} 09:00`;
  return LOCAL.test(s) ? s : "";
};

function taskRows(db, user, where = "1 = 1", params = []) {
  const sc = scopeOf(user);
  return db.prepare(`
    SELECT t.*, k.office_id, k.assigned_user_id AS case_user_id, k.radicado, c.full_name AS client_name,
      COALESCE(t.assigned_user_id, k.assigned_user_id) AS who, u.name AS who_name
    FROM tasks t JOIN cases k ON k.id = t.case_id JOIN clients c ON c.id = k.client_id
    LEFT JOIN users_shown u ON u.id = COALESCE(t.assigned_user_id, k.assigned_user_id)
    WHERE ${where} ORDER BY t.due_at`).all(...params)
    .filter((t) => sc === null || sc.includes(t.office_id) || t.assigned_user_id === user.id);
}
const line = (t, now) => ({ tarea_id: t.id, tipo: t.kind, titulo: t.title, cuando: t.due_at, dia: weekday(t.due_at), lugar: t.location || undefined,
  estado: t.status, seguimiento: taskFollowUp(t, now).label, cliente: t.client_name, caso_id: t.case_id, funcionario: t.who_name || null });

/** consultar_agenda: events between two dates (default: today and the next 14 days). */
export function agendaList(db, user, input = {}, now = Date.now()) {
  const today = bogotaNow(now);
  const from = normLocal(input.desde) ? normLocal(input.desde).slice(0, 10) + " 00:00" : today.slice(0, 10) + " 00:00";
  const to = input.hasta ? normLocal(input.hasta).slice(0, 10) + " 23:59" : fromMs(ms(from) + 14 * 86400000).slice(0, 10) + " 23:59";
  const where = ["t.due_at >= ?", "t.due_at <= ?"], params = [from, to];
  if (input.estado !== "todas") where.push("t.status = 'pendiente'");
  if (input.caso_id) { where.push("t.case_id = ?"); params.push(Number(input.caso_id)); }
  if (input.tipo && TASK_KINDS.includes(input.tipo)) { where.push("t.kind = ?"); params.push(input.tipo); }
  let rows = taskRows(db, user, where.join(" AND "), params);
  const who = fold(input.funcionario);
  if (who === "yo" || who === "mi") rows = rows.filter((t) => t.who === user.id);
  else if (who) rows = rows.filter((t) => fold(t.who_name).includes(who));
  return { desde: from, hasta: to, total: rows.length, eventos: rows.slice(0, 40).map((t) => line(t, today)),
    nota: rows.length > 40 ? `Se muestran 40 de ${rows.length}.` : rows.length ? undefined : "No hay eventos en la agenda de la App en ese rango. (Google Calendar aún no está conectado.)" };
}

const resolveStaff = (db, name) => {
  const w = fold(name);
  if (!w) return null;
  const m = db.prepare("SELECT id, name FROM users_shown WHERE id IN (SELECT id FROM users WHERE active = 1)").all().filter((u) => fold(u.name).includes(w));
  if (m.length !== 1) throw new Error(m.length ? `Hay varios funcionarios que coinciden con «${name}»: ${m.map((u) => u.name).join("; ")}.` : `No encontré al funcionario «${name}».`);
  return m[0];
};

/** proponer_cambio_agenda: validates a create / change / postpone / cancel / delete and lists overlapping events. */
export function proposeAgenda(db, user, input = {}, now = Date.now()) {
  const today = bogotaNow(now);
  const action = ["crear", "modificar", "posponer", "cancelar", "eliminar"].includes(input.accion) ? input.accion : "";
  if (!action) throw new Error("La acción debe ser crear, modificar, posponer, cancelar o eliminar.");
  let cur = null, caseId = Number(input.caso_id) || null;
  if (action !== "crear") {
    if (!input.tarea_id) throw new Error("Indica el tarea_id del evento (búscalo con consultar_agenda).");
    cur = taskRows(db, user, "t.id = ?", [Number(input.tarea_id)])[0];
    if (!cur) throw new Error("El evento no existe o este usuario no puede verlo.");
    caseId = cur.case_id;
  } else if (!caseId && String(input.carpeta ?? "").trim()) {
    const f = findCases(db, user, { carpeta: input.carpeta });
    if (f.total !== 1) throw new Error(f.total ? "Hay varios expedientes con esa carpeta; indica el caso_id." : "No encontré esa carpeta.");
    caseId = f.expedientes[0].caso_id;
  } else if (!caseId && String(input.cliente ?? "").trim()) {
    const f = findCases(db, user, { cliente: input.cliente });
    if (f.total !== 1) throw new Error(f.total ? "El cliente tiene varios expedientes: pregunta cuál (carpeta o proceso)." : "No encontré a ese cliente.");
    caseId = f.expedientes[0].caso_id;
  }
  if (action === "crear" && !caseId) throw new Error("Todo evento va en un expediente: indica la carpeta, el cliente o el caso_id.");
  if (caseId) {
    const sc = scopeOf(user);
    const k = db.prepare("SELECT office_id FROM cases WHERE id = ?").get(caseId);
    if (!k || (sc !== null && !sc.includes(k.office_id))) throw new Error("El expediente no existe o este usuario no puede verlo.");
  }
  const payload = {};
  let when = cur?.due_at || "";
  if (action === "crear" || action === "modificar" || action === "posponer") {
    if (action === "crear") { payload.case_id = caseId; payload.kind = TASK_KINDS.includes(input.tipo) ? input.tipo : "audiencia"; payload.title = String(input.titulo ?? "").trim().slice(0, 200); }
    if (action !== "crear" && input.tipo && TASK_KINDS.includes(input.tipo)) payload.kind = input.tipo;
    if (action !== "crear" && String(input.titulo ?? "").trim()) payload.title = String(input.titulo).trim().slice(0, 200);
    if (action === "crear" && !payload.title) throw new Error("Falta el título del evento.");
    const newWhen = normLocal(input.fecha_hora) || (action === "posponer" && Number(input.dias) ? fromMs(ms(cur.due_at) + Number(input.dias) * 86400000) : "");
    if (action === "crear" && !newWhen) throw new Error("Falta la fecha y hora (AAAA-MM-DD HH:MM).");
    if (action === "posponer" && !newWhen) throw new Error("Indica la nueva fecha_hora o los días a posponer.");
    if (newWhen) { payload.due_at = newWhen; when = newWhen; }
    if (typeof input.lugar === "string") payload.location = input.lugar.slice(0, 200);
    if (typeof input.notas === "string") payload.notes = input.notas.slice(0, 1000);
    if (Array.isArray(input.recordatorio_dias)) payload.remind_days = input.recordatorio_dias.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 60);
    const staff = resolveStaff(db, input.funcionario);
    if (staff) payload.assigned_user_id = staff.id;
    if (when && when < today && action !== "modificar") throw new Error(`La fecha ${when} ya pasó (hoy es ${today.slice(0, 10)}).`);
  }
  if (action === "cancelar") payload.status = "cancelada";
  // Who carries the event decides whose agenda is checked for overlaps (nobody in charge: the case's own events).
  const owner = payload.assigned_user_id ?? cur?.who ?? db.prepare("SELECT assigned_user_id FROM cases WHERE id = ?").get(caseId)?.assigned_user_id ?? null;
  let conflicts = [];
  if (when && (action === "crear" || action === "modificar" || action === "posponer")) {
    const lo = fromMs(ms(when) - (SPAN_MIN - 1) * 60000), hi = fromMs(ms(when) + (SPAN_MIN - 1) * 60000);
    conflicts = taskRows(db, user, `t.status = 'pendiente' AND t.due_at >= ? AND t.due_at <= ? AND ${owner ? "COALESCE(t.assigned_user_id, k.assigned_user_id) = ?" : "t.case_id = ?"} AND t.id != ?`,
      [lo, hi, owner ?? caseId, cur?.id ?? 0]).map((t) => line(t, today));
  }
  const kindLabel = payload.kind || cur?.kind || "evento";
  const resumen = {
    crear: `Crear ${kindLabel}: «${payload.title}» el ${weekday(when)} ${when}${payload.location ? " · " + payload.location : ""}`,
    modificar: `Modificar «${cur?.title}»${when !== cur?.due_at ? ` → ${weekday(when)} ${when}` : ""}`,
    posponer: `Posponer «${cur?.title}» de ${cur?.due_at} a ${weekday(when)} ${when}`,
    cancelar: `Marcar como no cumplido/cancelado «${cur?.title}» (${cur?.due_at})`,
    eliminar: `ELIMINAR «${cur?.title}» (${cur?.due_at}) — solo Gerencia puede borrar; si no, usa cancelar`,
  }[action];
  return { accion: action, tarea_id: cur?.id ?? null, caso_id: caseId, resumen, antes: cur ? line(cur, today) : null, cambios: payload,
    cruces_en_agenda: conflicts, hay_cruce: conflicts.length > 0,
    estado: "PROPUESTA: no se ha guardado nada. La persona debe pulsar «Confirmar» en la tarjeta. Si hay_cruce es true, avísalo con claridad y ofrece otra hora." };
}
