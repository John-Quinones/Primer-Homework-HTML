// Version 2.2.72: Bold payment links, signed webhook that reconciles payments (once), and the "Cyber LegalTech" reminder e-mail.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { boldSignature } from "../src/bold.js";
import { setBoldFetch } from "../src/bold.js";
import { setTransports } from "../src/notify.js";
import { setPaymentsClock } from "../src/payments.js";
import { renderCobroEmail, longDate, montoCOP } from "../src/email-cobro.js";

process.env.BOLD_API_KEY = "llave-identidad-de-prueba";
process.env.BOLD_WEBHOOK_SECRET = "llave-secreta-de-prueba";

let srv, call, client, chargeId, reference;
const calls = [];
const mails = [];
before(async () => {
  srv = await startServer();
  call = (await srv.setup()).call;
  setBoldFetch(async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ payload: { payment_link: "LNK_TEST1", url: "https://checkout.bold.co/LNK_TEST1" }, errors: [] }) };
  });
  setTransports({ mail: { sendMail: async (m) => { mails.push(m); return {}; } } });
  client = (await call("POST", "/clients", { full_name: "Armando Gómez Rocha", id_number: "79123456", id_type: "CC", email: "armando@correo.co" })).body;
  chargeId = (await call("POST", "/payments/charges", { client_id: client.id, concept: "Honorarios proceso laboral", amount: 3000000, due_date: "2026-12-01", installments: 2 })).body.ids[0];
});
after(() => { setBoldFetch(null); srv.close(); });

const post = (payload, { secret = process.env.BOLD_WEBHOOK_SECRET, sign = true } = {}) => {
  const raw = JSON.stringify(payload);
  return fetch(srv.base.replace("/api", "") + "/api/webhooks/bold", {
    method: "POST", headers: { "Content-Type": "application/json", ...(sign ? { "x-bold-signature": boldSignature(raw, secret) } : {}) }, body: raw,
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
};
const event = (type, extra = {}) => ({ id: "n-1", type, subject: "PAY-1", source: "/payments/links", spec_version: "1.0", time: 1, datacontenttype: "application/json",
  data: { payment_id: "PAY-1", bold_code: "BC123", amount: { currency: "COP", total: 1500000 }, payment_method: "PSE", payer_email: "x@y.co", metadata: { reference }, ...extra } });

test("crea el link de Bold con la llave y la referencia, y lo guarda en el cobro", async () => {
  const out = await call("POST", `/payments/charges/${chargeId}/bold-link`);
  assert.equal(out.status, 200);
  assert.equal(out.body.pay_link, "https://checkout.bold.co/LNK_TEST1");
  const c = calls.at(-1);
  assert.equal(c.url, "https://integrations.api.bold.co/online/link/v1");
  assert.equal(c.init.headers.Authorization, "x-api-key llave-identidad-de-prueba");
  assert.equal(c.body.amount_type, "CLOSE");
  assert.equal(c.body.amount.total_amount, 1500000);
  assert.match(c.body.reference, /^TJ-C\d+-[0-9a-f]{8}$/);
  reference = c.body.reference;
  const again = await call("POST", `/payments/charges/${chargeId}/bold-link`); // same amount: reused, no second call to Bold
  assert.equal(again.body.pay_link, out.body.pay_link);
  assert.equal(calls.length, 1);
});

test("rechaza un webhook sin firma o con firma falsa, y no crea nada", async () => {
  assert.equal((await post(event("SALE_APPROVED"), { sign: false })).status, 400);
  assert.equal((await post(event("SALE_APPROVED"), { secret: "otra" })).status, 400);
  assert.equal((await call("GET", "/payments/receipts")).body.length, 0);
});

test("venta aprobada crea un solo recibo, aunque Bold repita la notificación", async () => {
  const first = await post(event("SALE_APPROVED"));
  assert.deepEqual([first.status, first.body.outcome], [200, "conciliado"]);
  const second = await post(event("SALE_APPROVED"));
  assert.deepEqual([second.status, second.body.outcome], [200, "repetido"]);
  const rs = (await call("GET", "/payments/receipts")).body;
  assert.equal(rs.length, 1);
  assert.equal(rs[0].amount, 1500000);
  assert.equal(rs[0].charge_id, chargeId);
  assert.equal(rs[0].method, "Bold (tarjeta / PSE)");
  assert.match(rs[0].reference, /BC123/);
  const ch = (await call("GET", `/payments/charges?clientId=${client.id}`)).body.find((x) => x.id === chargeId);
  assert.equal(ch.state, "pagado");
  const log = (await call("GET", "/audit")).body;
  assert.ok(JSON.stringify(log).includes("Pago Bold conciliado"));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(mails.at(-1)?.to, "armando@correo.co"); // comprobante al cliente
});

test("un pago con referencia desconocida queda sin conciliar y no crea recibo", async () => {
  const out = await post(event("SALE_APPROVED", { payment_id: "PAY-X", metadata: { reference: "OTRA-COSA" } }));
  assert.deepEqual([out.status, out.body.outcome], [200, "sin_conciliar"]);
  assert.equal((await call("GET", "/payments/receipts")).body.length, 1);
});

test("venta rechazada no crea recibo; anulación aprobada anula el recibo", async () => {
  assert.equal((await post(event("SALE_REJECTED", { payment_id: "PAY-R" }))).body.outcome, "rechazado");
  assert.equal((await call("GET", "/payments/receipts")).body.length, 1);
  assert.equal((await post(event("VOID_APPROVED"))).body.outcome, "anulado");
  const r = (await call("GET", "/payments/receipts")).body[0];
  assert.ok(r.voided_at);
});

test("el correo «Cyber LegalTech» llena las variables, escapa y quita el botón sin link", () => {
  const html = renderCobroEmail({ nombreCliente: "Ana <b>&</b>", concepto: "Cuota 1 de 2", monto: montoCOP(1500000), fechaLimite: longDate("2026-12-01"),
    linkPago: "https://checkout.bold.co/LNK_TEST1" });
  assert.ok(!html.includes("{{") && !html.includes("<!--LINK"));
  assert.ok(html.includes("Ana &lt;b&gt;&amp;&lt;/b&gt;") && html.includes("1 de diciembre de 2026") && html.includes("$ 1.500.000"));
  assert.ok(html.includes('href="https://checkout.bold.co/LNK_TEST1"') && html.includes("PAGAR EN LÍNEA"));
  const sin = renderCobroEmail({ nombreCliente: "Ana", concepto: "x", monto: "$ 1", fechaLimite: "hoy", linkPago: "javascript:alert(1)", datosPago: "Nequi 314" });
  assert.ok(!sin.includes("PAGAR EN LÍNEA") && !sin.includes("javascript:") && sin.includes("Nequi 314"));
});

test("el recordatorio por correo usa la plantilla y el link de Bold", async () => {
  const id2 = (await call("POST", "/payments/charges", { client_id: client.id, concept: "Cuota extra", amount: 500000, due_date: "2027-01-10" })).body.ids[0];
  setTransports({ mail: { sendMail: async (m) => { mails.push(m); return {}; } } });
  setPaymentsClock(() => new Date("2026-11-04T17:00:00Z")); // a Wednesday at noon in Colombia: inside the Ley 2300 window whatever the hour the test runs
  const out = await call("POST", `/payments/charges/${id2}/remind`, { channels: ["email"] });
  setPaymentsClock(null);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const m = mails.at(-1);
  assert.ok(m.html.includes("PAGAR EN LÍNEA") && m.html.includes("https://checkout.bold.co/LNK_TEST1") && m.html.includes("Cuota extra"));
});

test("modo de pruebas: acepta la firma con clave vacía de Bold, y el GET informa el estado sin mostrar llaves", async () => {
  const url = srv.base.replace("/api", "") + "/api/webhooks/bold";
  const raw = JSON.stringify(event("SALE_REJECTED", { payment_id: "PAY-T" }));
  const send = () => fetch(url, { method: "POST", body: raw, headers: { "x-bold-signature": boldSignature(raw, "") } }).then((r) => r.status);
  assert.equal(await send(), 400);
  process.env.BOLD_WEBHOOK_TEST = "1";
  assert.equal(await send(), 200);
  delete process.env.BOLD_WEBHOOK_TEST;
  const st = await (await fetch(url)).json();
  assert.deepEqual([st.api_key, st.webhook_secret, st.test_mode], [true, true, false]);
  assert.ok(!JSON.stringify(st).includes("llave-"));
  const ev = (await call("GET", "/payments/bold-events")).body;
  assert.ok(ev.some((x) => x.outcome === "conciliado") && ev.some((x) => x.outcome === "sin_conciliar"));
});
