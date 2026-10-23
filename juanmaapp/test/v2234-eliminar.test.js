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
  assert.deepEqual(out, [{ expected: "77", blockers: [] }, 400, 400, 1, 409, 204, 204, 404]);
});

test("charges or receipts block deleting the client and the case", async () => {
  const out = await same(async (call) => {
    const { client, k } = await setup(call, "Bea Cobros");
    await call("POST", "/payments/charges", { client_id: client.id, case_id: k.id, concept: "Honorarios", amount: 100000, due_date: "2026-12-01" });
    const c = await call("DELETE", `/cases/${k.id}`, { confirm: "77" });
    const l = await call("DELETE", `/clients/${client.id}`, { confirm: "Bea Cobros" });
    return [c.status, /1 cobro/.test(c.body.error), l.status, /1 expediente/.test(l.body.error)];
  });
  assert.deepEqual(out, [409, true, 409, true]);
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
