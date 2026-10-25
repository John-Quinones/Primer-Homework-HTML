// Version 2.2.34: deleting a client or a case is Gerencia's, needs the typed name / folder, is refused when money
// is attached, makes a copy first and is logged; the server and the published link behave the same.
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

async function setup(call, name) {
  const cat = (await call("POST", "/categories", { name: "Laboral " + name })).body;
  const field = (await call("POST", `/categories/${cat.id}/fields`, { label: "No. Carpeta", field_type: "text" })).body;
  const type = (await call("POST", `/categories/${cat.id}/types`, { name: "Ordinario" })).body;
  const client = (await call("POST", "/clients", { full_name: name, id_number: "9" + name.length + "1" })).body;
  const k = (await call("POST", "/cases", { client_id: client.id, process_type_id: type.id, title: "Caso", field_values: { [field.id]: "77" } })).body;
  return { client, k };
}

test("case: refuses without the typed folder, deletes with it; client deletes after its cases", async () => {
  const out = await same(async (call) => {
    const { client, k } = await setup(call, "Ana Borra");
    const r = [];
    r.push((await call("GET", `/cases/${k.id}/deletion`)).body);
    r.push((await call("DELETE", `/cases/${k.id}`)).status, (await call("DELETE", `/cases/${k.id}`, { confirm: "78" })).status);
    r.push((await call("GET", `/clients/${client.id}/deletion`)).body.blockers.length);
    r.push((await call("DELETE", `/clients/${client.id}`, { confirm: "Ana Borra" })).status);
    r.push((await call("DELETE", `/cases/${k.id}`, { confirm: "77" })).status);
    r.push((await call("DELETE", `/clients/${client.id}`, { confirm: "ana  BORRA" })).status);
    r.push((await call("GET", `/clients/${client.id}`)).status);
    return r;
  });
  assert.deepEqual(out, [{ expected: "77", blockers: [] }, 400, 400, 0, 204, 404, 404, 404]);
});

test("charges or receipts block deleting the case; the client goes with everything (2.2.42)", async () => {
  const out = await same(async (call) => {
    const { client, k } = await setup(call, "Bea Cobros");
    const ch = (await call("POST", "/payments/charges", { client_id: client.id, case_id: k.id, concept: "Honorarios", amount: 100000, due_date: "2026-12-01" })).body;
    await call("POST", "/payments/receipts", { client_id: client.id, charge_id: ch.id, amount: 50000, method: "Efectivo", paid_on: "2026-10-01" });
    const c = await call("DELETE", `/cases/${k.id}`, { confirm: "77" });
    const plan = (await call("GET", `/clients/${client.id}/deletion`)).body;
    const bad = await call("DELETE", `/clients/${client.id}`, { confirm: "otro" });
    const l = await call("DELETE", `/clients/${client.id}`, { confirm: "Bea Cobros" });
    return [c.status, /1 cobro/.test(c.body.error), plan.blockers.length, /1 expediente, 1 cobro, 1 recibo \(carpetas: 77\)/.test(plan.detail), bad.status, l.status,
      (await call("GET", `/clients/${client.id}`)).status, (await call("GET", `/cases/${k.id}`)).status];
  });
  assert.deepEqual(out, [409, true, 0, true, 400, 204, 404, 404]);
});

test("server: copy before deleting and a log entry keeping the data", async () => {
  const call = sides.server;
  const { client, k } = await setup(call, "Eva Bitacora");
  await call("DELETE", `/cases/${k.id}`, { confirm: "77" });
  await call("DELETE", `/clients/${client.id}`, { confirm: "Eva Bitacora" });
  const log = srv.db.prepare("SELECT summary, changes FROM audit_log WHERE action = 'Eliminó' ORDER BY id DESC LIMIT 2").all();
  assert.match(log[0].summary, /Eva Bitacora/);
  assert.match(log[0].changes, /Eva Bitacora/);
  assert.match(log[1].changes, /Caso/);
});

test("server: deleting a client with money leaves the log with every record and nothing behind", async () => {
  const call = sides.server;
  const { client, k } = await setup(call, "Flor Cascada");
  const ch = (await call("POST", "/payments/charges", { client_id: client.id, case_id: k.id, concept: "Cuota", amount: 1000, due_date: "2026-12-01" })).body;
  await call("POST", "/payments/receipts", { client_id: client.id, charge_id: ch.id, amount: 500, method: "Efectivo", paid_on: "2026-10-01" });
  assert.equal((await call("DELETE", `/clients/${client.id}`, { confirm: "Flor Cascada" })).status, 204);
  const log = srv.db.prepare("SELECT changes FROM audit_log WHERE action = 'Eliminó' ORDER BY id DESC LIMIT 1").get().changes;
  assert.match(log, /Expediente eliminado/); assert.match(log, /Cobro eliminado/); assert.match(log, /Recibo eliminado/);
  for (const t of ["cases", "charges", "receipts"]) assert.equal(srv.db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE client_id = ?`).get(client.id).n, 0);
});
