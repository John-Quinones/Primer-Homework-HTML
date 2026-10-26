// Accounts receivable math shared by the server and the published link.
// Money is whole Colombian pesos (integers). Dates are YYYY-MM-DD.
// A receipt tied to a charge pays that charge first; any excess, and every
// receipt not tied to a charge, pays the client's oldest open charges.

export const METHODS = ["Efectivo", "Transferencia", "Consignación", "Bold (tarjeta / PSE)", "Tarjeta", "Cheque", "Otro"];
export const AGING = [["al_dia", "Al día"], ["d1_30", "1 a 30 días"], ["d31_60", "31 a 60 días"], ["d61_90", "61 a 90 días"], ["d90", "Más de 90 días"]];
export const STATE_LABELS = { pagado: "Pagado", parcial: "Abono parcial", pendiente: "Pendiente", vencido: "Vencido", anulado: "Anulado" };

export const fmtCOP = (n) => "$ " + Math.round(Number(n) || 0).toLocaleString("es-CO");
export const daysBetween = (from, to) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);
export const addDays = (date, n) => new Date(Date.parse(date + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export function addMonths(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}
export const agingBucket = (days) => (days <= 0 ? "al_dia" : days <= 30 ? "d1_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "d90");

/** Split a total into n installments; the last one absorbs the remainder. */
export function splitAmount(total, n) {
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? total - base * (n - 1) : base));
}

/**
 * charges: [{id, client_id, amount, due_date, status}] (status 'vigente'|'anulado')
 * receipts: [{id, client_id, charge_id, amount, voided_at}]
 * Returns each charge with paid, balance, state and days_overdue, plus
 * per-client credit (money received beyond what is owed).
 */
export function applyPayments(charges, receipts, today) {
  const out = new Map(charges.map((c) => [c.id, { ...c, paid: 0 }]));
  const credit = new Map();
  const live = receipts.filter((r) => !r.voided_at);
  const openOf = (clientId) => [...out.values()]
    .filter((c) => c.client_id === clientId && c.status !== "anulado" && c.paid < c.amount)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id - b.id);
  const spill = (clientId, amount) => {
    let left = amount;
    for (const c of openOf(clientId)) {
      if (left <= 0) break;
      const take = Math.min(left, c.amount - c.paid);
      c.paid += take;
      left -= take;
    }
    if (left > 0) credit.set(clientId, (credit.get(clientId) || 0) + left);
  };
  // Tied receipts first, so a payment for a given installment lands there.
  for (const r of live.filter((r) => r.charge_id)) {
    const c = out.get(r.charge_id);
    if (!c || c.status === "anulado") { spill(r.client_id, r.amount); continue; }
    const take = Math.min(r.amount, Math.max(0, c.amount - c.paid));
    c.paid += take;
    if (r.amount > take) spill(r.client_id, r.amount - take);
  }
  for (const r of live.filter((r) => !r.charge_id)) spill(r.client_id, r.amount);
  for (const c of out.values()) {
    c.balance = c.status === "anulado" ? 0 : c.amount - c.paid;
    c.days_overdue = c.balance > 0 ? Math.max(0, daysBetween(c.due_date, today)) : 0;
    c.state = c.status === "anulado" ? "anulado" : c.balance <= 0 ? "pagado" : c.days_overdue > 0 ? "vencido" : c.paid > 0 ? "parcial" : "pendiente";
  }
  return { charges: [...out.values()], credit };
}

/** Totals and aging for a set of computed charges. */
export function portfolio(computed, credit = new Map()) {
  const aging = Object.fromEntries(AGING.map(([k]) => [k, 0]));
  const t = { billed: 0, paid: 0, balance: 0, overdue: 0, credit: [...credit.values()].reduce((a, b) => a + b, 0) };
  for (const c of computed) {
    if (c.status === "anulado") continue;
    t.billed += c.amount; t.paid += c.paid; t.balance += c.balance;
    if (c.balance > 0) { aging[agingBucket(c.days_overdue)] += c.balance; if (c.days_overdue > 0) t.overdue += c.balance; }
  }
  return { ...t, aging };
}

/** One line per client with what they owe. */
export function clientRows(computed, credit, receipts, clients) {
  const rows = new Map();
  for (const c of computed) {
    if (c.status === "anulado") continue;
    const r = rows.get(c.client_id) || { client_id: c.client_id, billed: 0, paid: 0, balance: 0, overdue: 0, max_days: 0, next_due: null };
    r.billed += c.amount; r.paid += c.paid; r.balance += c.balance;
    if (c.days_overdue > 0) { r.overdue += c.balance; r.max_days = Math.max(r.max_days, c.days_overdue); }
    if (c.balance > 0 && c.days_overdue === 0 && (!r.next_due || c.due_date < r.next_due)) r.next_due = c.due_date;
    rows.set(c.client_id, r);
  }
  // Everything the client has paid, applied to a charge or not (manual payments, old payments).
  for (const x of receipts) {
    if (x.voided_at) continue;
    const r = rows.get(x.client_id) || { client_id: x.client_id, billed: 0, paid: 0, balance: 0, overdue: 0, max_days: 0, next_due: null };
    r.received = (r.received || 0) + (Number(x.amount) || 0);
    rows.set(x.client_id, r);
  }
  return [...rows.values()].map((r) => {
    const cl = clients.find((x) => x.id === r.client_id) || {};
    const last = receipts.filter((x) => x.client_id === r.client_id && !x.voided_at).map((x) => x.paid_on).sort().at(-1) || null;
    return { ...r, received: r.received || 0, credit: credit.get(r.client_id) || 0, client_name: cl.full_name || "", id_number: [cl.id_type, cl.id_number].filter(Boolean).join(" "),
      email: cl.email || "", phone: cl.phone || "", last_payment: last };
  }).sort((a, b) => b.overdue - a.overdue || b.balance - a.balance);
}

/** Text of a payment reminder (e-mail and WhatsApp). */
export function reminderMessage({ clientName, charge, firmName, payInfo, today }) {
  const due = charge.days_overdue > 0
    ? `venció el ${charge.due_date} (${charge.days_overdue} día${charge.days_overdue === 1 ? "" : "s"} de mora)`
    : charge.due_date === today ? "vence hoy" : `vence el ${charge.due_date}`;
  const lines = [
    `Hola ${clientName}:`, "",
    `Le recordamos que el pago de "${charge.concept}"${charge.plan_label ? ` (${charge.plan_label})` : ""} por ${fmtCOP(charge.balance)} ${due}.`,
  ];
  if (charge.pay_link) lines.push("", `Puede pagar en línea aquí: ${charge.pay_link}`);
  if (payInfo) lines.push("", "Datos para el pago:", payInfo);
  lines.push("", "Si ya realizó el pago, por favor envíenos el soporte y omita este mensaje.", "", firmName || "TEC Jurídicos");
  return { subject: `Recordatorio de pago: ${charge.concept}`, text: lines.join("\n") };
}

// ----- Receipt numbers: consecutive, starting where the firm's paper series ends -----
export const RECEIPT_START = 1155;
/** Next receipt number: one after the highest issued, never below the configured start. */
export const nextReceiptNumber = (maxIssued, start = RECEIPT_START) => Math.max((Number(maxIssued) || 0) + 1, Number(start) || 1);
export const receiptLabel = (n) => `N.º ${n}`;

// ----- Colombian public holidays (Ley 51 de 1983 moves most of them to Monday) -----
const iso = (d) => d.toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const nextMonday = (d) => { const x = new Date(d); while (x.getUTCDay() !== 1) x.setUTCDate(x.getUTCDate() + 1); return x; };
const plusDays = (d, n) => new Date(d.getTime() + n * 86400000);
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return utc(y, Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1);
}
export function colombianHolidays(y) {
  const e = easter(y);
  const fixed = [[1, 1], [5, 1], [7, 20], [8, 7], [12, 8], [12, 25]].map(([m, d]) => utc(y, m, d));
  const moved = [[1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11]].map(([m, d]) => nextMonday(utc(y, m, d)));
  const easterBased = [plusDays(e, -3), plusDays(e, -2), nextMonday(plusDays(e, 39)), nextMonday(plusDays(e, 60)), nextMonday(plusDays(e, 68))];
  return new Set([...fixed, ...moved, ...easterBased].map(iso));
}

/**
 * Ley 2300 de 2023: collection contacts only Monday to Friday 7:00–19:00 and
 * Saturday 8:00–15:00 (Colombia time), never on Sundays or holidays.
 * `when` is "YYYY-MM-DD HH:MM" in Colombia time. Returns { ok, reason }.
 */
export function collectionWindow(when) {
  const [date, time = "00:00"] = String(when).split(" ");
  const d = new Date(date + "T00:00:00Z");
  const dow = d.getUTCDay(), hm = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  if (dow === 0) return { ok: false, reason: "Es domingo: la Ley 2300 de 2023 no permite gestiones de cobranza." };
  if (colombianHolidays(d.getUTCFullYear()).has(date)) return { ok: false, reason: "Es festivo: la Ley 2300 de 2023 no permite gestiones de cobranza." };
  if (dow === 6 && (hm < 480 || hm >= 900)) return { ok: false, reason: "Los sábados solo se permite cobrar de 8:00 a. m. a 3:00 p. m. (Ley 2300 de 2023)." };
  if (dow !== 6 && (hm < 420 || hm >= 1140)) return { ok: false, reason: "Entre semana solo se permite cobrar de 7:00 a. m. a 7:00 p. m. (Ley 2300 de 2023)." };
  return { ok: true, reason: "" };
}

/** Whole number in Spanish words, lower case: 35 → "treinta y cinco", 2000000 → "dos millones". */
export function numeroEnLetras(n) {
  const U = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince",
    "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco",
    "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
  const D = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
  const C = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];
  const under1000 = (x) => {
    if (x === 100) return "cien";
    const c = Math.floor(x / 100), r = x % 100;
    const dec = r < 30 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? " y " + U[r % 10] : "");
    return [C[c], dec].filter(Boolean).join(" ");
  };
  const apocope = (s) => s.replace(/veintiuno$/, "veintiún").replace(/uno$/, "un");
  const words = (x) => {
    if (x === 0) return "cero";
    const millions = Math.floor(x / 1e6), thousands = Math.floor((x % 1e6) / 1000), rest = x % 1000;
    const out = [];
    if (millions) out.push(millions === 1 ? "un millón" : apocope(words(millions)) + " millones");
    if (thousands) out.push(thousands === 1 ? "mil" : apocope(under1000(thousands)) + " mil");
    if (rest) out.push(under1000(rest));
    return out.join(" ");
  };
  return apocope(words(Math.round(n)));
}

/** "Un millón quinientos mil pesos m/cte." — amounts in words for receipts and contracts. */
export function pesosEnLetras(n) {
  const n0 = Math.round(n);
  const w = numeroEnLetras(n0);
  const de = n0 >= 1e6 && n0 % 1e6 === 0 ? " de" : "";
  return (w.charAt(0).toUpperCase() + w.slice(1) + de + (n0 === 1 ? " peso" : " pesos") + " m/cte.");
}

/** Pesos typed by a person: "2000", "$2000", "2.000.000", "2,000,000" → 2000, 2000, 2000000, 2000000 (null if none). */
export function pesosFromText(text) {
  let s = String(text ?? "").replace(/[$\s]/g, "").replace(/[.,]\d{1,2}$/, "");
  s = s.replace(/[.,]/g, "");
  return /^\d+$/.test(s) && Number(s) > 0 ? Number(s) : null;
}
/** Place values of an amount, highest first, zeros left out: 2500000 → «2 unidades de millón · 5 centenas de mil». */
export function placeValues(n) {
  const digits = String(Math.round(Number(n) || 0));
  const kind = ["unidad", "decena", "centena"], big = ["", " de mil", " de millón", " de mil millones", " de billón"];
  const parts = [];
  for (let i = 0; i < digits.length; i++) {
    const d = Number(digits[digits.length - 1 - i]);
    if (!d) continue;
    const name = kind[i % 3] + (d === 1 ? "" : kind[i % 3] === "unidad" ? "es" : "s");
    parts.unshift(`${d} ${name}${big[Math.floor(i / 3)] ?? ""}`);
  }
  return parts.join(" · ");
}
const dots = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
/** "$2.000" — the way a contract writes an amount typed as a plain number. */
export const fmtPesos = (n) => "$" + dots(Math.round(n));

/**
 * Fee terms of a services contract (version 2.67). `tipo` is "Honorarios", "Cuota de litis" or "Mixto";
 * `fijo` and `litis` are what the person typed (pesos, or a percentage such as «35%» for the cuota de litis).
 * Every amount comes out as number and words: «$2.000.000 (dos millones de pesos m/cte.)».
 * Only the parts that apply are returned, so the passages of the Word for the others disappear, and
 * `honorarios.modalidad` appears only when every amount the type needs is valid (otherwise the Word shows it as missing).
 */
export function feeTerms(tipo, fijo, litis) {
  const t = String(tipo ?? "").trim().toLowerCase();
  const money = (n) => `${fmtPesos(n)} (${pesosEnLetras(n).replace(/^./, (c) => c.toLowerCase())})`;
  const out = {};
  const wantFijo = t === "honorarios" || t === "mixto", wantLitis = t === "cuota de litis" || t === "mixto";
  const n = wantFijo ? pesosFromText(fijo) : null;
  if (n) out["honorarios.fijo"] = money(n);
  if (wantLitis) {
    const text = String(litis ?? "").trim();
    const pct = text.match(/^(\d{1,3})\s*(?:%|por\s*ciento)$/i);
    if (pct) {
      const p = Number(pct[1]);
      if (p > 0 && p <= 100) out["honorarios.litis_porcentaje"] = `${numeroEnLetras(p)} por ciento (${p} %)`;
    } else {
      const v = pesosFromText(text);
      if (v) out["honorarios.litis_valor"] = money(v);
    }
  }
  const ok = (!wantFijo || out["honorarios.fijo"]) && (!wantLitis || out["honorarios.litis_porcentaje"] || out["honorarios.litis_valor"]);
  if ((wantFijo || wantLitis) && ok) out["honorarios.modalidad"] = t === "mixto" ? "honorarios fijos y cuota de litis" : wantFijo ? "honorarios fijos" : "cuota de litis";
  return out;
}

const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const longDateEs = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return y ? `${d} de ${MONTHS_ES[m - 1]} de ${y}` : ""; };

/** Fee variables for documents ({{honorarios.*}}) from a case's charges. */
export function feeVariables(charges, receipts = []) {
  const live = charges.filter((c) => c.status !== "anulado");
  if (!live.length) return {};
  const total = live.reduce((a, c) => a + (Number(c.amount) || 0), 0);
  const paid = receipts.filter((r) => !r.voided_at).reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const dates = live.map((c) => c.due_date).sort();
  const n = live.length;
  return {
    "honorarios.valor": fmtCOP(total), "honorarios.valor_letras": pesosEnLetras(total),
    "honorarios.forma_pago": n > 1 ? `${n} cuotas: ${live.slice().sort((a, b) => a.due_date.localeCompare(b.due_date)).map((c) => `${fmtCOP(c.amount)} el ${longDateEs(c.due_date)}`).join("; ")}`
      : `un solo pago a más tardar el ${longDateEs(dates[0])}`,
    "honorarios.cuotas": String(n), "honorarios.pagado": fmtCOP(paid), "honorarios.saldo": fmtCOP(Math.max(0, total - paid)),
  };
}

/**
 * Last day of a term of `n` days that starts running the day after `date`.
 * unit "habiles": no weekends nor Colombian holidays; with judicial = true also no vacancia judicial
 * (20 December to 10 January, and Monday to Wednesday of Holy Week). unit "calendario": every day counts.
 * E.g. a petition is answered within 15 business days (Ley 1755 de 2015, art. 14).
 */
export function addBusinessDays(date, n, { unit = "habiles", judicial = false } = {}) {
  let d = new Date(date + "T00:00:00Z"), left = Number(n) || 0;
  const off = (x) => {
    if (unit === "calendario") return false;
    if (x.getUTCDay() === 0 || x.getUTCDay() === 6 || colombianHolidays(x.getUTCFullYear()).has(iso(x))) return true;
    if (!judicial) return false;
    const md = iso(x).slice(5);
    if (md >= "12-20" || md <= "01-10") return true;
    const e = easter(x.getUTCFullYear()).getTime(), t = x.getTime();
    return t >= e - 6 * 86400000 && t <= e - 4 * 86400000;
  };
  while (left > 0) {
    d = new Date(d.getTime() + 86400000);
    if (!off(d)) left--;
  }
  // A calendar term that ends on a non-working day moves to the next working day.
  if (unit === "calendario") while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || colombianHolidays(d.getUTCFullYear()).has(iso(d))) d = new Date(d.getTime() + 86400000);
  return iso(d);
}
