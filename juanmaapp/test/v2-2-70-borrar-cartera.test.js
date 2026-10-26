// Version 2.2.70: Gerencia deletes charges and receipts from Cartera, typing the confirmation; the window says the effect on the
// balance; a charge goes with its receipts; deleted receipt numbers are never reused. Server and published link must agree.
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

async function setup(call) {
  const cl = (await call("POST", "/clients", { full_name: "Armando Gómez Rocha", id_number: "79123456", id_type: "CC" })).body;
  const ids = (await call("POST", "/payments/charges", { client_id: cl.id, concept: "Honorarios", amount: 3000000, due_date: "2026-12-01", installments: 2 })).body.ids;
  const rec = (n, charge_id, amount) => call("POST", "/payments/receipts", { client_id: cl.id, charge_id, amount, method: "Efectivo", paid_on: "2026-10-20" }).then((x) => x.body);
  return { cl, ids, rec };
}

test("a receipt is deleted only with its number typed; the window shows the balance effect", async () => {
  const out = await same(async (call) => {
    const { cl, ids, rec } = await setup(call);
    const r = await rec(1, ids[0], 500000);
    const plan = (await call("GET", `/payments/receipts/${r.id}/deletion`)).body;
    assert.equal(plan.expected, String(r.number));
    assert.equal((await call("DELETE", `/payments/receipts/${r.id}`, { confirm: "x" })).status, 400);
    assert.equal((await call("DELETE", `/payments/receipts/${r.id}`, { confirm: String(r.number) })).status, 204);
    return { detail: plan.detail.replace(/N\.º \d+/g, "N.º #"), left: (await call("GET", `/payments/receipts?clientId=${cl.id}`)).body.length };
  });
  assert.equal(out.left, 0);
  assert.match(out.detail, /Saldo pendiente del cliente: \$2\.500\.000 → \$3\.000\.000/);
});

test("deleting a charge removes its receipts and reminders, lists them, and leaves nothing tied to it", async () => {
  await same(async (call) => {
    const { cl, ids, rec } = await setup(call);
    const r1 = await rec(1, ids[0], 700000), r2 = await rec(2, ids[0], 300000), keep = await rec(3, ids[1], 100000);
    const plan = (await call("GET", `/payments/charges/${ids[0]}/deletion`)).body;
    assert.equal(plan.expected, "ELIMINAR");
    assert.match(plan.detail, /2 recibos/);
    assert.deepEqual(plan.receipts, [r1.id, r2.id]);
    assert.equal((await call("DELETE", `/payments/charges/${ids[0]}`, {})).status, 400);
    assert.equal((await call("DELETE", `/payments/charges/${ids[0]}`, { confirm: "eliminar" })).status, 204);
    const left = (await call("GET", `/payments/receipts?clientId=${cl.id}`)).body;
    assert.deepEqual(left.map((x) => x.id), [keep.id]);
    const charges = (await call("GET", `/payments/charges?clientId=${cl.id}&state=`)).body;
    assert.deepEqual(charges.map((c) => c.id), [ids[1]]);
    return { n: left.length };
  });
});

test("an issued receipt number is never reused after deleting the last receipt", async () => {
  await same(async (call) => {
    const { cl, ids, rec } = await setup(call);
    const a = await rec(1, ids[0], 100000);
    assert.equal((await call("DELETE", `/payments/receipts/${a.id}`, { confirm: String(a.number) })).status, 204);
    const b = await rec(2, ids[0], 100000);
    assert.equal(b.number, a.number + 1);
    assert.equal((await call("GET", "/payments/settings")).body.receipt_next, b.number + 1);
    await call("DELETE", `/payments/charges/${ids[0]}`, { confirm: "ELIMINAR" });
    const c = await rec(3, ids[1], 100000);
    assert.equal(c.number, b.number + 1);
    return { cl: cl.id > 0 };
  });
});

test("the delete leaves a line in the log for the charge and one per receipt", async () => {
  const out = await same(async (call) => {
    const { ids, rec } = await setup(call);
    await rec(1, ids[0], 100000);
    await call("DELETE", `/payments/charges/${ids[0]}`, { confirm: "ELIMINAR" });
    const log = (await call("GET", "/audit?limit=50")).body;
    const row = (log.rows || log).find((e) => /Eliminó|Eliminar/i.test(e.action) && e.entity && /cobro/i.test(e.entity));
    return { found: !!row, receiptLine: !!row?.changes?.some((c) => /Recibo eliminado/.test(c.label)) };
  });
  assert.equal(out.found, true);
  assert.equal(out.receiptLine, true);
});
