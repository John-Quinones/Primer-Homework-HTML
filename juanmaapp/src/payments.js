// Payments: charges (what a client owes, one per installment), cash receipts
// with consecutive numbers, the accounts-receivable portfolio (cartera) with
// aging, and payment reminders to the client by e-mail or WhatsApp.
import express from "express";
import { scopeOf } from "./auth.js";
import { sendEmail, sendWhatsapp, channelsStatus } from "./notify.js";
import { bogota } from "./monitor.js";
import { METHODS, AGING, STATE_LABELS, applyPayments, portfolio, clientRows, reminderMessage, splitAmount, addMonths, addDays, fmtCOP,
  RECEIPT_START, nextReceiptNumber, receiptLabel, collectionWindow } from "./ledger.js";

const str = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const money = (v) => (typeof v === "number" ? Math.round(v) : Number(String(v ?? "").replace(/[^\d]/g, "")));
const today = (now = new Date()) => bogota(now).slice(0, 10);

export const PAYMENT_DEFAULTS = { auto: false, days_before: 3, repeat_days: 7, pay_info: "", firm_name: "TEC Jurídicos", firm_nit: "", channels: ["email"], receipt_start: RECEIPT_START };

export function paymentSettings(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'payments'").get();
  return { ...PAYMENT_DEFAULTS, ...(row ? JSON.parse(row.value) : {}) };
}

// Current time for the Ley 2300 window; tests fix it.
let clock = () => new Date();
export const setPaymentsClock = (fn) => { clock = fn || (() => new Date()); };
const colombiaNow = (d) => new Date(d.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Visible rows: in my offices (everything with scope.all).
const officeSql = (user, col) => {
  const sc = scopeOf(user);
  return sc === null ? "1 = 1" : sc.length ? `${col} IN (${sc.map(Number).join(",")})` : "0 = 1";
};

/** Charges and receipts the user can see, with balances computed. */
export function loadLedger(db, user, { clientId = null, officeId = null } = {}, now = new Date()) {
  const w = [officeSql(user, "office_id")];
  if (clientId) w.push(`client_id = ${Number(clientId)}`);
  if (officeId) w.push(`office_id = ${Number(officeId)}`);
  const charges = db.prepare(`SELECT * FROM charges WHERE ${w.join(" AND ")}`).all().map((x) => ({ ...x }));
  const receipts = db.prepare(`SELECT * FROM receipts WHERE ${w.join(" AND ")}`).all().map((x) => ({ ...x }));
  const { charges: computed, credit } = applyPayments(charges, receipts, today(now));
  return { charges: computed, receipts, credit };
}

const clientsById = (db, ids) => ids.length
  ? db.prepare(`SELECT id, full_name, id_type, id_number, email, phone, address, city FROM clients WHERE id IN (${ids.map(Number).join(",")})`).all().map((x) => ({ ...x }))
  : [];

function decorate(db, computed) {
  const clients = clientsById(db, [...new Set(computed.map((c) => c.client_id))]);
  const cases = new Map(db.prepare("SELECT k.id, k.title, k.radicado FROM cases k").all().map((k) => [k.id, k]));
  return computed.map((c) => {
    const cl = clients.find((x) => x.id === c.client_id) || {};
    const k = c.case_id ? cases.get(c.case_id) : null;
    return { ...c, client_name: cl.full_name || "", client_email: cl.email || "", client_phone: cl.phone || "",
      case_label: k ? [k.radicado, k.title].filter(Boolean).join(" · ") : "", state_label: STATE_LABELS[c.state] };
  });
}

/** Rows for the Reportes section. */
export function paymentsReport(db, user, type, q) {
  const { charges, receipts, credit } = loadLedger(db, user, { officeId: Number(q.officeId) || null });
  if (type === "cartera") {
    const rows = clientRows(charges, credit, receipts, clientsById(db, [...new Set([...charges, ...receipts].map((c) => c.client_id))]))
      .filter((r) => r.balance > 0 || q.status !== "pendientes")
      .map((r) => ({ client: r.client_name, doc: r.id_number, phone: r.phone, billed: r.billed, paid: r.paid, received: r.received, balance: r.balance,
        overdue: r.overdue, max_days: r.max_days, next_due: r.next_due || "", last_payment: r.last_payment || "" }));
    return { columns: [["client", "Cliente"], ["doc", "Documento"], ["phone", "Teléfono"], ["billed", "Facturado"], ["paid", "Aplicado a cobros"], ["received", "Total pagado"],
      ["balance", "Saldo"], ["overdue", "Vencido"], ["max_days", "Días de mora"], ["next_due", "Próximo vencimiento"], ["last_payment", "Último pago"]], rows };
  }
  const inRange = (d) => (!DATE.test(q.from || "") || d >= q.from) && (!DATE.test(q.to || "") || d <= q.to);
  const names = clientsById(db, [...new Set(receipts.map((r) => r.client_id))]);
  const rows = receipts.filter((r) => inRange(r.paid_on)).sort((a, b) => a.number - b.number).map((r) => ({
    number: receiptLabel(r.number), date: r.paid_on, client: names.find((c) => c.id === r.client_id)?.full_name || "",
    concept: r.concept, method: r.method, reference: r.reference, amount: r.voided_at ? 0 : r.amount, status: r.voided_at ? `Anulado: ${r.void_reason}` : "Vigente" }));
  return { columns: [["number", "Recibo"], ["date", "Fecha"], ["client", "Cliente"], ["concept", "Concepto"], ["method", "Medio"],
    ["reference", "Referencia"], ["amount", "Valor"], ["status", "Estado"]], rows };
}

async function remind(db, charge, client, { channels, trigger, userId, settings, now }) {
  const msg = reminderMessage({ clientName: client.full_name, charge, firmName: settings.firm_name, payInfo: settings.pay_info, today: today(now) });
  const results = [];
  for (const ch of channels) {
    const r = ch === "manual" ? { channel: "manual", ok: true, detail: "Enviado por el usuario (WhatsApp o copia del texto)." }
      : ch === "whatsapp" ? await sendWhatsapp(client.phone, msg.text)
      : await sendEmail(client.email, msg.subject, msg.text, `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${msg.text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</div>`);
    if (ch === "email" && !client.email) r.detail = "El cliente no tiene correo.";
    if (ch === "whatsapp" && !client.phone) r.detail = "El cliente no tiene teléfono.";
    db.prepare("INSERT INTO payment_reminders (charge_id, client_id, channel, ok, detail, trigger, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(charge.id, client.id, ch, r.ok ? 1 : 0, str(r.detail), trigger, userId);
    results.push(r);
  }
  if (results.some((r) => r.ok)) db.prepare("UPDATE charges SET last_reminder_at = datetime('now') WHERE id = ?").run(charge.id);
  return { results, message: msg };
}

/** Daily automatic reminders: a few days before the due date, then every N days while overdue. */
export async function paymentReminders(db, now = new Date()) {
  const settings = paymentSettings(db);
  if (!settings.auto) return 0;
  // Ley 2300 de 2023: no collection contacts on Sundays, holidays or outside the allowed hours.
  if (!collectionWindow(colombiaNow(clock())).ok) return 0;
  const system = { permissions: ["scope.all"], offices: [] };
  const { charges } = loadLedger(db, system, {}, now);
  const t = today(now);
  let sent = 0;
  for (const c of charges.filter((x) => x.balance > 0)) {
    const last = c.last_reminder_at ? c.last_reminder_at.slice(0, 10) : null;
    const before = c.due_date === addDays(t, Number(settings.days_before) || 0);
    const overdue = c.days_overdue > 0 && (!last || last <= addDays(t, -(Number(settings.repeat_days) || 7)));
    if (!before && !overdue) continue;
    const client = db.prepare("SELECT * FROM clients WHERE id = ?").get(c.client_id);
    if (!client) continue;
    await remind(db, c, client, { channels: settings.channels, trigger: "auto", userId: null, settings, now });
    sent++;
  }
  return sent;
}

export function paymentsRouter(db) {
  const r = express.Router();
  const h = (fn) => async (req, res) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? null);
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(err);
      // Only messages written for the user; internal ones (database, libraries) stay in the log (audit A10-001).
      res.status(err instanceof HttpError ? err.status : 500).json({ error: err instanceof HttpError ? err.message : "Error interno del servidor." });
    }
  };
  const getCharge = (req, id) => db.prepare(`SELECT * FROM charges WHERE id = ? AND ${officeSql(req.user, "office_id")}`).get(id)
    || (() => { throw new HttpError(404, "El cobro no existe."); })();
  const visibleClient = (req, id) => {
    const sc = scopeOf(req.user);
    const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(Number(id));
    if (!c) throw new HttpError(404, "El cliente no existe.");
    if (sc !== null && !sc.includes(c.office_id)
      && !db.prepare(`SELECT 1 FROM cases WHERE client_id = ? AND office_id IN (${sc.map(Number).join(",") || "NULL"})`).get(c.id)) throw new HttpError(404, "El cliente no existe.");
    return c;
  };
  // Office of a charge/receipt: the case's, else the client's, else my first.
  const officeOf = (req, client, caseId) => {
    if (caseId) {
      const k = db.prepare("SELECT office_id, client_id FROM cases WHERE id = ?").get(Number(caseId));
      const sc = scopeOf(req.user);
      if (!k || (sc !== null && !sc.includes(k.office_id))) throw new HttpError(404, "El expediente no existe.");
      if (k.client_id !== client.id) throw new HttpError(400, "El expediente no es de este cliente.");
      return k.office_id;
    }
    const sc = scopeOf(req.user);
    return sc === null || sc.includes(client.office_id) ? client.office_id : sc[0] ?? null;
  };

  r.get("/meta", h(() => ({ methods: METHODS, aging: AGING.map(([key, label]) => ({ key, label })), states: STATE_LABELS, channels: channelsStatus() })));

  r.get("/summary", h((req) => {
    const { charges, receipts, credit } = loadLedger(db, req.user, { officeId: Number(req.query.officeId) || null });
    const t = today();
    const monthStart = t.slice(0, 8) + "01";
    const collected = receipts.filter((x) => !x.voided_at && x.paid_on >= monthStart).reduce((a, x) => a + x.amount, 0);
    const dueSoon = charges.filter((c) => c.balance > 0 && c.days_overdue === 0 && c.due_date <= addDays(t, 7)).reduce((a, c) => a + c.balance, 0);
    return {
      today: t, totals: portfolio(charges, credit), collected_month: collected, due_7d: dueSoon,
      received_total: receipts.filter((x) => !x.voided_at).reduce((a, x) => a + (Number(x.amount) || 0), 0),
      clients: clientRows(charges, credit, receipts, clientsById(db, [...new Set([...charges, ...receipts].map((c) => c.client_id))])),
    };
  }));

  r.get("/charges", h((req) => {
    const { charges } = loadLedger(db, req.user, { clientId: Number(req.query.clientId) || null });
    let list = decorate(db, charges);
    if (req.query.caseId) list = list.filter((c) => c.case_id === Number(req.query.caseId));
    if (req.query.state === "abiertos") list = list.filter((c) => c.balance > 0);
    else if (STATE_LABELS[req.query.state]) list = list.filter((c) => c.state === req.query.state);
    return list.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id - b.id);
  }));

  r.post("/charges", h((req, res) => {
    const b = req.body ?? {};
    const client = visibleClient(req, b.client_id);
    const concept = str(b.concept);
    if (!concept) throw new HttpError(400, "Escriba el concepto del cobro.");
    const total = money(b.amount);
    if (!(total > 0)) throw new HttpError(400, "Escriba un valor mayor que cero.");
    if (!DATE.test(str(b.due_date))) throw new HttpError(400, "Indique la fecha de vencimiento.");
    const n = Math.min(60, Math.max(1, Number(b.installments) || 1));
    if (n > total) throw new HttpError(400, "Demasiadas cuotas para ese valor.");
    const step = b.every === "quincenal" ? (d, i) => addDays(d, 15 * i) : b.every === "semanal" ? (d, i) => addDays(d, 7 * i) : (d, i) => addMonths(d, i);
    const officeId = officeOf(req, client, b.case_id);
    const amounts = splitAmount(total, n);
    const ins = db.prepare(`INSERT INTO charges (client_id, case_id, office_id, concept, plan_label, amount, due_date, pay_link, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const ids = [];
    db.exec("BEGIN");
    try {
      amounts.forEach((amount, i) => ids.push(Number(ins.run(client.id, Number(b.case_id) || null, officeId, concept, n > 1 ? `Cuota ${i + 1} de ${n}` : "",
        amount, step(str(b.due_date), i), str(b.pay_link), str(b.notes), req.user.id).lastInsertRowid)));
      db.exec("COMMIT");
    } catch (err) { db.exec("ROLLBACK"); throw err; }
    res.status(201);
    return { ids };
  }));

  r.put("/charges/:id", h((req) => {
    const c = getCharge(req, Number(req.params.id));
    if (c.status === "anulado") throw new HttpError(400, "El cobro está anulado.");
    const b = req.body ?? {};
    const amount = "amount" in b ? money(b.amount) : c.amount;
    if (!(amount > 0)) throw new HttpError(400, "Escriba un valor mayor que cero.");
    const due = "due_date" in b ? str(b.due_date) : c.due_date;
    if (!DATE.test(due)) throw new HttpError(400, "Indique la fecha de vencimiento.");
    db.prepare("UPDATE charges SET concept = ?, amount = ?, due_date = ?, pay_link = ?, notes = ? WHERE id = ?")
      .run(str(b.concept) || c.concept, amount, due, "pay_link" in b ? str(b.pay_link) : c.pay_link, "notes" in b ? str(b.notes) : c.notes, c.id);
    return { ok: true };
  }));

  r.post("/charges/:id/void", h((req) => {
    const c = getCharge(req, Number(req.params.id));
    if (!str(req.body?.reason)) throw new HttpError(400, "Escriba el motivo de la anulación.");
    db.prepare("UPDATE charges SET status = 'anulado', void_reason = ? WHERE id = ?").run(str(req.body.reason), c.id);
    return { ok: true };
  }));

  r.post("/charges/:id/remind", h(async (req) => {
    const raw = getCharge(req, Number(req.params.id));
    const { charges } = loadLedger(db, req.user, { clientId: raw.client_id });
    const c = charges.find((x) => x.id === raw.id);
    if (!(c.balance > 0)) throw new HttpError(400, "Este cobro no tiene saldo pendiente.");
    const client = db.prepare("SELECT * FROM clients WHERE id = ?").get(c.client_id);
    const channels = (Array.isArray(req.body?.channels) ? req.body.channels : ["email"]).filter((x) => ["email", "whatsapp", "manual"].includes(x));
    if (!channels.length) throw new HttpError(400, "Elija cómo enviar el recordatorio.");
    if (channels.some((x) => x !== "manual")) {
      const w = collectionWindow(colombiaNow(clock()));
      if (!w.ok) throw new HttpError(400, `${w.reason} Programe el envío para un horario permitido.`);
    }
    return remind(db, c, client, { channels, trigger: "manual", userId: req.user.id, settings: paymentSettings(db) });
  }));

  r.get("/receipts", h((req) => {
    const w = [officeSql(req.user, "r.office_id")], p = [];
    if (req.query.clientId) { w.push("r.client_id = ?"); p.push(Number(req.query.clientId)); }
    if (DATE.test(req.query.from || "")) { w.push("r.paid_on >= ?"); p.push(req.query.from); }
    if (DATE.test(req.query.to || "")) { w.push("r.paid_on <= ?"); p.push(req.query.to); }
    return db.prepare(`SELECT r.*, c.full_name AS client_name, trim(c.id_type || ' ' || c.id_number) AS client_doc, c.email AS client_email,
        ch.concept AS charge_concept, ch.plan_label, u.name AS created_by_name
      FROM receipts r JOIN clients c ON c.id = r.client_id LEFT JOIN charges ch ON ch.id = r.charge_id LEFT JOIN users u ON u.id = r.created_by
      WHERE ${w.join(" AND ")} ORDER BY r.number DESC LIMIT 2000`).all(...p).map((x) => ({ ...x }));
  }));

  r.post("/receipts", h((req, res) => {
    const b = req.body ?? {};
    const client = visibleClient(req, b.client_id);
    const amount = money(b.amount);
    if (!(amount > 0)) throw new HttpError(400, "Escriba el valor recibido.");
    if (!METHODS.includes(b.method)) throw new HttpError(400, "Elija el medio de pago.");
    const paidOn = str(b.paid_on) || today();
    if (!DATE.test(paidOn)) throw new HttpError(400, "Fecha de pago no válida.");
    let charge = null;
    if (b.charge_id) {
      charge = getCharge(req, Number(b.charge_id));
      if (charge.client_id !== client.id) throw new HttpError(400, "El cobro no es de este cliente.");
      if (charge.status === "anulado") throw new HttpError(400, "El cobro está anulado.");
    }
    const caseId = charge?.case_id || Number(b.case_id) || null;
    const officeId = charge?.office_id ?? officeOf(req, client, caseId);
    const concept = str(b.concept) || (charge ? [charge.concept, charge.plan_label].filter(Boolean).join(" · ") : "Abono a cuenta");
    db.exec("BEGIN IMMEDIATE");
    try {
      const number = nextReceiptNumber(db.prepare("SELECT MAX(number) AS n FROM receipts").get().n, paymentSettings(db).receipt_start);
      const id = db.prepare(`INSERT INTO receipts (number, client_id, charge_id, case_id, office_id, amount, method, reference, paid_on, concept, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(number, client.id, charge?.id ?? null, caseId, officeId, amount, b.method, str(b.reference),
        paidOn, concept, str(b.notes), req.user.id).lastInsertRowid;
      db.exec("COMMIT");
      res.status(201);
      return { ...db.prepare("SELECT * FROM receipts WHERE id = ?").get(id), client_name: client.full_name };
    } catch (err) { db.exec("ROLLBACK"); throw err; }
  }));

  r.post("/receipts/:id/void", h((req) => {
    const x = db.prepare(`SELECT * FROM receipts WHERE id = ? AND ${officeSql(req.user, "office_id")}`).get(Number(req.params.id));
    if (!x) throw new HttpError(404, "El recibo no existe.");
    if (x.voided_at) throw new HttpError(400, "El recibo ya está anulado.");
    if (!str(req.body?.reason)) throw new HttpError(400, "Escriba el motivo de la anulación.");
    db.prepare("UPDATE receipts SET voided_at = datetime('now'), void_reason = ? WHERE id = ?").run(str(req.body.reason), x.id);
    return { ok: true };
  }));

  r.get("/reminders", h((req) => db.prepare(`SELECT pr.*, c.full_name AS client_name, ch.concept, ch.plan_label, u.name AS created_by_name
      FROM payment_reminders pr JOIN charges ch ON ch.id = pr.charge_id JOIN clients c ON c.id = pr.client_id LEFT JOIN users u ON u.id = pr.created_by
      WHERE ${officeSql(req.user, "ch.office_id")} ${req.query.clientId ? `AND pr.client_id = ${Number(req.query.clientId)}` : ""}
      ORDER BY pr.id DESC LIMIT 500`).all().map((x) => ({ ...x, ok: !!x.ok }))));

  r.get("/settings", h(() => {
    const v = paymentSettings(db);
    return { ...v, receipt_next: nextReceiptNumber(db.prepare("SELECT MAX(number) AS n FROM receipts").get().n, v.receipt_start) };
  }));
  r.put("/settings", h((req) => {
    const b = req.body ?? {};
    const v = {
      auto: !!b.auto,
      days_before: Math.min(30, Math.max(0, Number(b.days_before) || 0)),
      repeat_days: Math.min(60, Math.max(1, Number(b.repeat_days) || 7)),
      pay_info: str(b.pay_info).slice(0, 1500), firm_name: str(b.firm_name) || PAYMENT_DEFAULTS.firm_name, firm_nit: str(b.firm_nit),
      channels: (Array.isArray(b.channels) ? b.channels : ["email"]).filter((x) => ["email", "whatsapp"].includes(x)),
      receipt_start: Math.max(1, Math.round(Number(b.receipt_start) || paymentSettings(db).receipt_start)),
    };
    db.prepare("INSERT INTO settings (key, value) VALUES ('payments', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(v));
    return v;
  }));

  return r;
}

export { fmtCOP };
