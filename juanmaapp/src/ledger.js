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
