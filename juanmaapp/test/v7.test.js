import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { setTransports } from "../src/notify.js";
import { paymentReminders, setPaymentsClock } from "../src/payments.js";
import { addDays } from "../src/ledger.js";
import { bogota } from "../src/monitor.js";

let srv, admin, client, caseId, typeId;
// A Thursday at 9:00 a.m. Colombia time: inside the Ley 2300 de 2023 window.
setPaymentsClock(() => new Date("2026-10-15T14:00:00Z"));
const mails = [];
before(async () => {
  process.env.SMTP_HOST = "smtp.test"; process.env.MAIL_FROM = "cobros@firma.co";
  setTransports({ mail: { sendMail: async (m) => { mails.push(m); return { messageId: "<x@test>" }; } } });
  srv = await startServer();
  admin = await srv.setup();
  client = (await admin.call("POST", "/clients", { full_name: "Marta Gómez", id_number: "1110", email: "marta@cliente.co", phone: "3001234567" })).body;
  const cat = (await admin.call("GET", "/catalog")).body.find((c) => c.name === "Laboral");
  typeId = cat.types.find((t) => t.name === "Ejecutivo Laboral").id;
});
after(() => srv.close());

test("case keeps the client's procedural role, affiliation and one of three statuses", async () => {
  const bad = await admin.call("POST", "/cases", { client_id: client.id, process_type_id: typeId, client_role: "Rey" });
  assert.equal(bad.status, 400);
  const r = await admin.call("POST", "/cases", { client_id: client.id, process_type_id: typeId, client_role: "ejecutante", affiliated: true, status: "En trámite" });
  assert.equal(r.status, 201);
  assert.equal(r.body.client_role, "Ejecutante");
  assert.equal(r.body.affiliated, true);
  assert.equal(r.body.status, "Activo");
  caseId = r.body.id;
  const u = await admin.call("PUT", `/cases/${caseId}`, { status: "Archivo provisional", affiliated: false });
  assert.equal(u.body.status, "Archivo provisional");
  assert.equal(u.body.affiliated, false);
  assert.equal(u.body.client_role, "Ejecutante", "untouched fields stay");
  const rep = await admin.call("GET", "/reports/expedientes?status=archivados");
  assert.equal(rep.body.rows.length, 1);
  assert.equal(rep.body.rows[0].role, "Ejecutante");
});

test("charges in installments, receipts, portfolio and aging", async () => {
  const today = bogota().slice(0, 10);
  const r = await admin.call("POST", "/payments/charges", { client_id: client.id, case_id: caseId, concept: "Honorarios", amount: "3.000.000",
    installments: 3, every: "mensual", due_date: addDays(today, -40) });
  assert.equal(r.status, 201);
  assert.equal(r.body.ids.length, 3);
  let charges = (await admin.call("GET", `/payments/charges?clientId=${client.id}`)).body;
  assert.deepEqual(charges.map((c) => c.amount), [1000000, 1000000, 1000000]);
  assert.equal(charges[0].plan_label, "Cuota 1 de 3");
  assert.equal(charges[0].state, "vencido");

  const p1 = await admin.call("POST", "/payments/receipts", { client_id: client.id, charge_id: charges[0].id, amount: 1200000, method: "Transferencia", reference: "TR-1" });
  assert.equal(p1.status, 201);
  assert.equal(p1.body.number, 1155);
  const p2 = await admin.call("POST", "/payments/receipts", { client_id: client.id, amount: 100000, method: "Efectivo" });
  assert.equal(p2.body.number, 1156);
  assert.equal((await admin.call("POST", "/payments/receipts", { client_id: client.id, amount: 5, method: "Trueque" })).status, 400);

  charges = (await admin.call("GET", `/payments/charges?clientId=${client.id}`)).body;
  assert.equal(charges[0].state, "pagado");
  assert.equal(charges[1].paid, 300000, "excess and the loose payment go to the next installment");
  const sum = (await admin.call("GET", "/payments/summary")).body;
  assert.equal(sum.totals.balance, 1700000);
  assert.equal(sum.clients[0].client_name, "Marta Gómez");

  await admin.call("POST", `/payments/receipts/${p2.body.id}/void`, { reason: "Duplicado" });
  assert.equal((await admin.call("GET", "/payments/summary")).body.totals.balance, 1800000);
  const cart = await admin.call("GET", "/reports/cartera");
  assert.equal(cart.body.rows[0].balance, 1800000);
  const rec = await admin.call("GET", "/reports/recibos");
  assert.equal(rec.body.rows[0].number, "N.º 1155");
});

test("payment reminders: manual and daily automatic", async () => {
  const charges = (await admin.call("GET", `/payments/charges?clientId=${client.id}&state=abiertos`)).body;
  mails.length = 0;
  const r = await admin.call("POST", `/payments/charges/${charges[0].id}/remind`, { channels: ["email"] });
  assert.equal(r.status, 200);
  assert.equal(mails[0].to, "marta@cliente.co");
  assert.match(mails[0].text, /\$ 800\.000/);
  await admin.call("PUT", "/payments/settings", { auto: true, days_before: 3, repeat_days: 7, pay_info: "Bancolombia ahorros 123", channels: ["email"] });
  mails.length = 0;
  assert.equal(await paymentReminders(srv.db), 0, "reminded today already");
  srv.db.prepare("UPDATE charges SET last_reminder_at = datetime('now', '-8 days')").run();
  assert.ok(await paymentReminders(srv.db) >= 1);
  assert.match(mails[0].text, /Bancolombia ahorros 123/);
  const log = (await admin.call("GET", "/payments/reminders")).body;
  assert.ok(log.some((x) => x.trigger === "auto"));
});

test("payments need their permission", async () => {
  const office = (await admin.call("GET", "/admin/offices")).body[0].id;
  await admin.call("POST", "/admin/users", { name: "Dependiente", email: "dep@firma.co", password: "clave-segura-2", role: "Dependiente Judicial", office_ids: [office] });
  const dep = await srv.login("dep@firma.co", "clave-segura-2");
  assert.equal((await dep.call("GET", "/payments/summary")).status, 403);
});
