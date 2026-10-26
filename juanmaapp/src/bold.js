// Bold (Colombia) collection, version 2.2.72: payment links for charges and the webhook that reconciles them.
//  - createBoldLink / ensureBoldLink: one link per charge through POST https://integrations.api.bold.co/online/link/v1
//    (BOLD_API_KEY = "llave de identidad", header "Authorization: x-api-key <key>"). The link's `reference` is stored in bold_links.
//  - boldWebhookHandler: POST /api/webhooks/bold. Bold signs the raw body: hex HMAC-SHA256, with the secret key, of the body in Base64
//    (header x-bold-signature). SALE_APPROVED creates the cash receipt of the charge once (idempotent by payment_id), VOID_APPROVED
//    voids it, and every event is kept in bold_events. Secrets come only from the environment (BOLD_API_KEY, BOLD_WEBHOOK_SECRET).
import crypto from "node:crypto";
import { HttpError, str } from "./http.js";
import { audit } from "./audit.js";
import { sendEmail } from "./notify.js";
import { bogota } from "./monitor.js";
import { nextReceiptNumber, receiptLabel, fmtCOP } from "./ledger.js";

const env = process.env;
const API = "https://integrations.api.bold.co";
export const BOLD_METHOD = "Bold (tarjeta / PSE)";

let fetchImpl = null;
/** Tests replace the call to Bold. */
export const setBoldFetch = (fn) => { fetchImpl = fn || null; };

export const boldStatus = () => ({ links: !!env.BOLD_API_KEY, webhook: env.BOLD_WEBHOOK_SECRET !== undefined || env.BOLD_WEBHOOK_TEST === "1" });

export const BOLD_SCHEMA = `
CREATE TABLE IF NOT EXISTS bold_links (
  reference  TEXT PRIMARY KEY,                       -- sent to Bold; comes back as data.metadata.reference
  charge_id  INTEGER NOT NULL REFERENCES charges(id) ON DELETE CASCADE,
  link_id    TEXT NOT NULL DEFAULT '',               -- LNK_xxx
  url        TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS bold_links_charge ON bold_links(charge_id);
CREATE TABLE IF NOT EXISTS bold_events (
  payment_id  TEXT NOT NULL,                         -- data.payment_id (or the notification's subject)
  type        TEXT NOT NULL,                         -- SALE_APPROVED, SALE_REJECTED, VOID_APPROVED, VOID_REJECTED
  reference   TEXT NOT NULL DEFAULT '',
  bold_code   TEXT NOT NULL DEFAULT '',
  amount      INTEGER NOT NULL DEFAULT 0,
  method      TEXT NOT NULL DEFAULT '',
  outcome     TEXT NOT NULL,                         -- conciliado, anulado, rechazado, sin_conciliar
  detail      TEXT NOT NULL DEFAULT '',
  receipt_id  INTEGER REFERENCES receipts(id) ON DELETE SET NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (payment_id, type)
);`;

// ----- Payment links -----
async function boldCall(method, url, body) {
  const key = env.BOLD_API_KEY;
  if (!key) throw new HttpError(503, "Bold no está configurado en el servidor (falta BOLD_API_KEY).");
  const res = await (fetchImpl || fetch)(API + url, {
    method, headers: { Authorization: `x-api-key ${key}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.errors && data.errors.length)) {
    const why = data.errors?.[0]?.message || data.errors?.[0]?.errors || data.message || res.status;
    throw new HttpError(502, `Bold no creó el link de pago (${typeof why === "string" ? why : JSON.stringify(why)}).`);
  }
  return data;
}

/** A new link for `amount` pesos; returns { reference, link_id, url }. */
export async function createBoldLink(charge, amount) {
  const reference = `TJ-C${charge.id}-${crypto.randomBytes(4).toString("hex")}`;
  const description = [charge.concept, charge.plan_label].filter(Boolean).join(" · ").slice(0, 100).padEnd(2, ".");
  const data = await boldCall("POST", "/online/link/v1", {
    amount_type: "CLOSE", amount: { currency: "COP", total_amount: Math.round(amount), tip_amount: 0 }, reference, description,
  });
  const url = data.payload?.url;
  if (!url) throw new HttpError(502, "Bold no devolvió la dirección del link de pago.");
  return { reference, link_id: data.payload.payment_link || "", url };
}

/** The charge's Bold link: the saved one when it is still ours and for the same amount, else a new one (saved in the charge's pay_link).
 *  A charge with a link someone typed by hand keeps it (it cannot be reconciled automatically). Returns the URL. */
export async function ensureBoldLink(db, charge, balance, { force = false } = {}) {
  const last = db.prepare("SELECT * FROM bold_links WHERE charge_id = ? ORDER BY rowid DESC LIMIT 1").get(charge.id);
  if (charge.pay_link && !(last && last.url === charge.pay_link)) {
    if (!force) return charge.pay_link;
  } else if (last && last.url === charge.pay_link && last.amount === Math.round(balance) && !force) return last.url;
  const link = await createBoldLink(charge, balance);
  db.prepare("INSERT INTO bold_links (reference, charge_id, link_id, url, amount) VALUES (?, ?, ?, ?, ?)")
    .run(link.reference, charge.id, link.link_id, link.url, Math.round(balance));
  db.prepare("UPDATE charges SET pay_link = ? WHERE id = ?").run(link.url, charge.id);
  return link.url;
}

// ----- Webhook -----
/** Hex HMAC-SHA256 of the Base64 of the raw body, as Bold computes it. */
export const boldSignature = (raw, secret) => crypto.createHmac("sha256", secret).update(Buffer.from(raw).toString("base64")).digest("hex");

export function validBoldSignature(raw, header, secret) {
  const want = Buffer.from(boldSignature(raw, secret));
  const got = Buffer.from(String(header || ""));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

const money = (v) => Math.round(Number(v) || 0);
const BOLD_USER = { id: null, name: "Bold (automático)" };

/** Applies one verified event. Returns { outcome, detail, receipt }. Everything is written in one transaction. */
export function applyBoldEvent(db, ev, req) {
  const type = str(ev.type);
  const d = ev.data || {};
  const paymentId = str(d.payment_id || ev.subject);
  const reference = str(d.metadata?.reference);
  const code = str(d.bold_code);
  const total = money(d.amount?.total ?? d.amount?.total_amount);
  const method = str(d.payment_method);
  if (!paymentId) throw new HttpError(400, "Evento sin identificador de pago.");
  if (db.prepare("SELECT 1 FROM bold_events WHERE payment_id = ? AND type = ?").get(paymentId, type)) return { outcome: "repetido", detail: "Evento ya procesado." };

  const note = (outcome, detail, receiptId = null) => db.prepare(`INSERT INTO bold_events (payment_id, type, reference, bold_code, amount, method, outcome, detail, receipt_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(paymentId, type, reference, code, total, method, outcome, detail, receiptId);
  const log = (action, summary, receiptId) => audit(db, req, { user: BOLD_USER, action, module: "Pagos", entity: "recibo", record_id: receiptId, summary });

  db.exec("BEGIN IMMEDIATE");
  try {
    let out;
    if (type === "SALE_APPROVED") {
      const link = reference ? db.prepare("SELECT * FROM bold_links WHERE reference = ?").get(reference) : null;
      const charge = link ? db.prepare("SELECT * FROM charges WHERE id = ?").get(link.charge_id) : null;
      if (!charge || charge.status === "anulado" || !(total > 0)) {
        const why = !charge ? "La referencia no corresponde a ningún cobro de la App." : charge.status === "anulado" ? "El cobro está anulado." : "Valor no válido.";
        note("sin_conciliar", why);
        out = { outcome: "sin_conciliar", detail: why };
        log("Pago Bold sin conciliar", `Pago Bold ${code || paymentId} por ${fmtCOP(total)} (ref. ${reference || "—"}): ${why} Revisar a mano.`, null);
      } else {
        const top = Math.max(db.prepare("SELECT MAX(number) AS n FROM receipts").get().n || 0, Number(db.prepare("SELECT value FROM settings WHERE key = 'receipt_issued'").get()?.value) || 0);
        const start = Number(JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'payments'").get()?.value || "{}").receipt_start) || undefined;
        const number = nextReceiptNumber(top, start);
        const concept = [charge.concept, charge.plan_label].filter(Boolean).join(" · ");
        const rid = Number(db.prepare(`INSERT INTO receipts (number, client_id, charge_id, case_id, office_id, amount, method, reference, paid_on, concept, notes, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).run(number, charge.client_id, charge.id, charge.case_id, charge.office_id, total, BOLD_METHOD,
          [code || paymentId, method].filter(Boolean).join(" · "), bogota(new Date()).slice(0, 10), concept,
          `Conciliado automáticamente por Bold (pago ${paymentId}${d.payer_email ? `, pagador ${d.payer_email}` : ""}).`).lastInsertRowid);
        note("conciliado", `Recibo ${receiptLabel(number)}`, rid);
        out = { outcome: "conciliado", detail: `Recibo ${receiptLabel(number)}`, receiptId: rid, number, charge, amount: total };
        log("Pago Bold conciliado", `Pago Bold ${code || paymentId} por ${fmtCOP(total)} → recibo ${receiptLabel(number)} del cobro «${concept}».`, rid);
      }
    } else if (type === "VOID_APPROVED") {
      const sale = db.prepare("SELECT receipt_id FROM bold_events WHERE payment_id = ? AND type = 'SALE_APPROVED' AND receipt_id IS NOT NULL").get(paymentId);
      const rec = sale ? db.prepare("SELECT * FROM receipts WHERE id = ?").get(sale.receipt_id) : null;
      if (rec && !rec.voided_at) {
        db.prepare("UPDATE receipts SET voided_at = datetime('now'), void_reason = ? WHERE id = ?").run("Anulación aprobada en Bold.", rec.id);
        note("anulado", `Recibo ${receiptLabel(rec.number)} anulado`, rec.id);
        out = { outcome: "anulado", detail: `Recibo ${receiptLabel(rec.number)} anulado` };
        log("Pago Bold anulado", `Anulación aprobada en Bold del pago ${code || paymentId}: recibo ${receiptLabel(rec.number)} anulado.`, rec.id);
      } else {
        note("sin_conciliar", "No hay recibo vigente para esa anulación.");
        out = { outcome: "sin_conciliar", detail: "No hay recibo vigente para esa anulación." };
        log("Pago Bold sin conciliar", `Anulación en Bold del pago ${code || paymentId} sin recibo vigente. Revisar a mano.`, null);
      }
    } else {
      note("rechazado", type);
      out = { outcome: "rechazado", detail: type };
    }
    db.exec("COMMIT");
    return out;
  } catch (err) { db.exec("ROLLBACK"); throw err; }
}

/** Express handler; mount it with express.raw() so the signature is checked over the exact bytes Bold sent. */
export function boldWebhookHandler(db) {
  return (req, res) => {
    try {
      const secret = env.BOLD_WEBHOOK_SECRET ?? (env.BOLD_WEBHOOK_TEST === "1" ? "" : null); // Bold's test mode signs with an empty key
      if (secret === null) return res.status(503).json({ error: "Webhook de Bold sin configurar." });
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
      if (!validBoldSignature(raw, req.get("x-bold-signature"), secret)) return res.status(400).json({ error: "Firma no válida." });
      let ev;
      try { ev = JSON.parse(raw.toString("utf8")); } catch { return res.status(400).json({ error: "Cuerpo no válido." }); }
      if (!ev || typeof ev !== "object" || !ev.data) return res.status(400).json({ error: "Evento no válido." });
      const out = applyBoldEvent(db, ev, req);
      res.status(200).json({ received: true, outcome: out.outcome });
      if (out.outcome === "conciliado") confirmPayment(db, out).catch((e) => console.error("bold confirm:", e.message));
    } catch (err) {
      if (!(err instanceof HttpError)) console.error("bold webhook:", err);
      res.status(err instanceof HttpError ? err.status : 500).json({ error: err instanceof HttpError ? err.message : "Error procesando el webhook." });
    }
  };
}

/** E-mail to the client with the receipt number (the Word/PDF receipt is made from Pagos → Recibos). */
async function confirmPayment(db, out) {
  const client = db.prepare("SELECT full_name, email FROM clients WHERE id = ?").get(out.charge.client_id);
  if (!client?.email) return;
  const concept = [out.charge.concept, out.charge.plan_label].filter(Boolean).join(" · ");
  const text = `Hola ${client.full_name}:\n\nRecibimos su pago de ${fmtCOP(out.amount)} por "${concept}". Quedó registrado con el recibo ${receiptLabel(out.number)}.\n\nGracias por su pago.\nTecjurídicos S.A.S.`;
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  await sendEmail(client.email, `Pago recibido: ${concept}`, text, `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${esc(text)}</div>`);
}
