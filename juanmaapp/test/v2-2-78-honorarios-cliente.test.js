// Version 2.2.78: fees are typed by hand and can be charged straight to a client with no case; every payment shows by case and by client.
// Server and published link must agree.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { startLink } from "./link-backend.js";

let srv, sides;
before(async () => {
  srv = await startServer();
  const link = await startLink();
  const server = await srv.setup();
  await link.call("POST", "/auth/setup", { name: "Gerente General", email: "gerencia@firma.co" });
  sides = { server: server.call, link: link.call };
});
after(() => srv.close());

async function same(scenario) {
  const out = {};
  for (const [name, call] of Object.entries(sides)) out[name] = await scenario(call);
  assert.deepEqual(out.link, out.server);
  return out.server;
}

test("fees for a client with no case, and payments toward them, show on the client", async () => {
  const out = await same(async (call) => {
    const cl = (await call("POST", "/clients", { full_name: "Marta Lucía Pardo", id_number: "52123456", id_type: "CC" })).body;
    const ch = await call("POST", "/payments/charges", { client_id: cl.id, concept: "Honorarios", amount: 4000000, due_date: "2026-12-01" });
    assert.equal(ch.status, 201);
    await call("POST", "/payments/receipts", { client_id: cl.id, charge_id: ch.body.ids[0], amount: 1000000, method: "Efectivo", paid_on: "2026-10-27" });
    await call("POST", "/payments/receipts", { client_id: cl.id, amount: 500000, method: "Transferencia", paid_on: "2026-10-28" });
    const charges = (await call("GET", `/payments/charges?clientId=${cl.id}&state=`)).body;
    const receipts = (await call("GET", `/payments/receipts?clientId=${cl.id}`)).body;
    return { charge: charges.map((c) => [c.concept, c.case_id, c.amount, c.paid, c.balance]), receipts: receipts.map((r) => [r.case_id, r.amount, r.method]).sort() };
  });
  assert.deepEqual(out.charge, [["Honorarios", null, 4000000, 1500000, 2500000]]);
  assert.equal(out.receipts.length, 2);
});

test("fees on a case: payments tied to its fee show by case and by client", async () => {
  const out = await same(async (call) => {
    const cl = (await call("POST", "/clients", { full_name: "Jairo Ríos Peña", id_number: "80123456", id_type: "CC" })).body;
    const lab = (await call("GET", "/catalog")).body.find((c) => c.name === "Laboral");
    const k = (await call("POST", "/cases", { client_id: cl.id, process_type_id: lab.types[0].id })).body;
    const caseId = k.id;
    const ch = (await call("POST", "/payments/charges", { client_id: cl.id, case_id: caseId, concept: "Honorarios", amount: 2000000, due_date: "2026-12-01" })).body.ids[0];
    await call("POST", "/payments/receipts", { client_id: cl.id, charge_id: ch, amount: 300000, method: "Efectivo", paid_on: "2026-10-27" });
    const byCase = (await call("GET", `/payments/charges?caseId=${caseId}&state=`)).body;
    return { n: byCase.length, paid: byCase[0]?.paid };
  });
  assert.equal(out.n, 1);
  assert.equal(out.paid, 300000);
});
