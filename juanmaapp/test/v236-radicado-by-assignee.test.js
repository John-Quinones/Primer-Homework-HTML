import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

let srv, admin, office;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  office = (await admin.call("GET", "/admin/offices")).body[0].id;
});
after(() => srv.close());

test("the responsible funcionario types and changes the radicado by hand; others without cases.write cannot", async () => {
  const mk = (name, email) => admin.call("POST", "/admin/users", { name, email, role: "Director Contable", office_ids: [office], password: "tribunal-azul-2026" });
  const laura = (await mk("Laura Gómez", "laura@firma.co")).body;
  await mk("Pedro Ruiz", "pedro@firma.co");
  const client = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Ana", last_names: "Ruiz", id_type: "CC", id_number: "52111222", office_id: office })).body;
  const type = (await admin.call("GET", "/catalog")).body[0].types[0];
  const k = (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: type.id, office_id: office, title: "Pensión", assigned_user_id: laura.id })).body;

  const s = await srv.login("laura@firma.co", "tribunal-azul-2026");
  const set = await s.call("PUT", `/cases/${k.id}/radicado`, { radicado: "73-001-41-89-002-2016-01179-00" });
  assert.equal(set.status, 200);
  assert.equal(set.body.radicado, "73001418900220160117900");
  assert.equal(set.body.monitor, 0, "only the box turns the consultation on (v2.38)");
  const changed = await s.call("PUT", `/cases/${k.id}/radicado`, { radicado: "73001418900220160117901", replace: true });
  assert.equal(changed.body.radicado, "73001418900220160117901");

  const p = await srv.login("pedro@firma.co", "tribunal-azul-2026");
  const refused = await p.call("PUT", `/cases/${k.id}/radicado`, { radicado: "73001418900220160117999", replace: true });
  assert.equal(refused.status, 403);
  assert.equal((await admin.call("GET", `/cases/${k.id}`)).body.radicado, "73001418900220160117901");
});
