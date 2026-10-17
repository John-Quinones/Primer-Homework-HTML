import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

let srv, admin, office;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  office = (await admin.call("GET", "/admin/offices")).body[0].id;
});
after(() => srv.close());

test("only Gerencia creates process types, sub-processes and fields; existing ones stay", async () => {
  const before = (await admin.call("GET", "/catalog")).body;
  const cat = (await admin.call("POST", "/categories", { name: "Propiedad Horizontal" }));
  assert.equal(cat.status, 201);
  assert.equal((await admin.call("POST", `/categories/${cat.body.id}/types`, { name: "Impugnación de actas" })).status, 201);
  const after = (await admin.call("GET", "/catalog")).body;
  assert.equal(after.length, before.length + 1);
  for (const c of before) assert.deepEqual(after.find((x) => x.id === c.id).types.map((t) => t.name), c.types.map((t) => t.name));

  // A Director Jurídico, even with the permission ticked by hand, cannot create them.
  const u = (await admin.call("POST", "/admin/users", { name: "Directora Catálogo", email: "dircat@firma.co", role: "Director Jurídico", office_ids: [office],
    password: "tribunal-azul-2026", custom_permissions: true, permissions: ["catalog.manage", "cases.write", "clients.write"] })).body;
  assert.ok(!u.permissions.includes("catalog.manage"));
  const d = await srv.login("dircat@firma.co", "tribunal-azul-2026");
  await d.call("POST", "/auth/password", { current: "tribunal-azul-2026", next: "tribunal-verde-2026" });
  assert.equal((await d.call("POST", "/categories", { name: "Comercial" })).status, 403);
  assert.equal((await d.call("POST", `/categories/${cat.body.id}/types`, { name: "Sucesión" })).status, 403);
  assert.equal((await d.call("POST", `/categories/${cat.body.id}/fields`, { label: "Etapa", field_type: "text" })).status, 403);
  assert.equal((await d.call("GET", "/catalog")).status, 200, "everyone still reads the catalog");
});
