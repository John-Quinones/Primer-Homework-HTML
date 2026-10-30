// Version 2.3.22: installments typed by hand (value and date each); payments lower the balance. Server and link must agree.
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

test("manual installments keep their own value and date, and receipts debit the fee", async () => {
  const out = {};
  for (const [name, call] of Object.entries(sides)) {
    const cl = (await call("POST", "/clients", { full_name: "Marta Lucía Pardo", id_number: "52123456", id_type: "CC" })).body;
    const parts = [{ amount: 1000000, due_date: "2026-11-05" }, { amount: 2500000, due_date: "2027-01-20" }, { amount: 500000, due_date: "2027-03-01" }];
    const bad = await call("POST", "/payments/charges", { client_id: cl.id, concept: "Honorarios", amount: 4100000, due_date: "2026-11-05", parts });
    assert.equal(bad.status, 400);
    const ok = await call("POST", "/payments/charges", { client_id: cl.id, concept: "Honorarios", amount: 4000000, due_date: "2026-11-05", parts });
    assert.equal(ok.status, 201);
    await call("POST", "/payments/receipts", { client_id: cl.id, amount: 1500000, method: "Efectivo", paid_on: "2026-11-06" });
    const charges = (await call("GET", `/payments/charges?clientId=${cl.id}&state=`)).body;
    out[name] = charges.map((c) => [c.plan_label, c.amount, c.due_date, c.paid, c.balance]);
  }
  assert.deepEqual(out.link, out.server);
  assert.deepEqual(out.server, [["Cuota 1 de 3", 1000000, "2026-11-05", 1000000, 0], ["Cuota 2 de 3", 2500000, "2027-01-20", 500000, 2000000], ["Cuota 3 de 3", 500000, "2027-03-01", 0, 500000]]);
});
