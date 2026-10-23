import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

let srv, admin, office;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  office = (await admin.call("GET", "/admin/offices")).body[0].id;
});
after(() => srv.close());

test("only Gerencia deletes process types and sub-processes; one in use is refused and nothing is lost", async () => {
  const cat = (await admin.call("POST", "/categories", { name: "Tipo borrable" })).body;
  const t1 = (await admin.call("POST", `/categories/${cat.id}/types`, { name: "Sub en uso" })).body;
  const t2 = (await admin.call("POST", `/categories/${cat.id}/types`, { name: "Sub libre" })).body;
  const t3 = (await admin.call("POST", `/categories/${cat.id}/types`, { name: "Segundo orden", parent_id: t1.id })).body;
  const cl = (await admin.call("POST", "/clients", { full_name: "Cliente Prueba", id_number: "123456", office_id: office })).body;
  const k = await admin.call("POST", "/cases", { client_id: cl.id, process_type_id: t3.id, title: "Caso" });
  assert.equal(k.status, 201);

  const u = (await admin.call("POST", "/admin/users", { name: "Director Borra", email: "dirborra@firma.co", role: "Director Jurídico", office_ids: [office], password: "tribunal-azul-2026" })).body;
  const d = await srv.login("dirborra@firma.co", "tribunal-azul-2026");
  await d.call("POST", "/auth/password", { current: "tribunal-azul-2026", next: "tribunal-verde-2026" });
  assert.equal((await d.call("DELETE", `/types/${t2.id}`)).status, 403);
  assert.equal((await d.call("DELETE", `/categories/${cat.id}`)).status, 403);

  const r1 = await admin.call("DELETE", `/types/${t1.id}`);
  assert.equal(r1.status, 409); assert.match(r1.body.error, /1 expediente/);
  const r2 = await admin.call("DELETE", `/categories/${cat.id}`);
  assert.equal(r2.status, 409); assert.match(r2.body.error, /1 expediente/);
  const ids = (await admin.call("GET", "/catalog")).body.find((c) => c.id === cat.id).types.map((t) => t.id).sort();
  assert.deepEqual(ids, [t1.id, t2.id, t3.id].sort(), "nothing deleted");
  assert.equal((await admin.call("GET", `/cases/${k.body.id}`)).status, 200);

  assert.equal((await admin.call("DELETE", `/types/${t2.id}`)).status, 204);
  await admin.call("DELETE", `/cases/${k.body.id}`);
  assert.equal((await admin.call("DELETE", `/categories/${cat.id}`)).status, 204);
});
