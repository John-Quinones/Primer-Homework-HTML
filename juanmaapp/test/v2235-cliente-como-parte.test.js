import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

let srv, admin, office, type;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  office = (await admin.call("GET", "/admin/offices")).body[0].id;
  type = (await admin.call("GET", "/catalog")).body[0].types[0];
});
after(() => srv.close());

test("a registered client can be a party (ours or the other side) in several cases, and typed parties still work", async () => {
  const mk = async (first, doc) => (await admin.call("POST", "/clients", { person_type: "natural", first_names: first, last_names: "Prueba", id_type: "CC", id_number: doc, office_id: office })).body;
  const a = await mk("Ana", "52111222"), b = await mk("Beto", "80333444");
  const party = (c, role, ours) => ({ role, name: c.full_name, id_type: "CC", id_number: c.id_number, ours, client_id: c.id });
  const body = (client, parties) => ({ client_id: client.id, process_type_id: type.id, office_id: office, title: "Caso", parties });
  const k1 = (await admin.call("POST", "/cases", body(a, [party(b, "Demandado", false), { role: "Demandado", name: "Banco X", ours: false }]))).body;
  const k2 = (await admin.call("POST", "/cases", body(a, [party(b, "Demandante", true)]))).body;
  const got = (await admin.call("GET", `/cases/${k1.id}`)).body.parties;
  assert.equal(got.find((p) => p.name === b.full_name).client_id, b.id, "link kept although not ours");
  assert.equal(got.find((p) => p.name === "Banco X").client_id, null, "typed party stays unlinked");
  assert.equal((await admin.call("GET", `/cases/${k2.id}`)).body.parties[0].client_id, b.id);
  // Only the case where Beto is ours shows in his file.
  const mine = (await admin.call("GET", `/cases?clientId=${b.id}`)).body.map((x) => x.id);
  assert.deepEqual(mine, [k2.id]);
});
