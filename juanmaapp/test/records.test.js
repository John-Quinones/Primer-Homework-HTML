import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { SEED_CATALOG } from "../src/db.js";
import { startServer } from "./helpers.js";

let srv, call;
before(async () => {
  srv = await startServer();
  call = (await srv.setup()).call;
});
after(() => srv.close());

test("catalog is seeded with categories and sub-processes", async () => {
  const { body } = await call("GET", "/catalog");
  assert.deepEqual(body.map((c) => c.name), SEED_CATALOG.map(([n]) => n));
  const adm = body.find((c) => c.name === "Administrativo");
  assert.ok(adm.types.some((t) => t.name === "Medio de Control de Reparación Directa"));
  const lab = body.find((c) => c.name === "Laboral");
  assert.ok(lab.types.some((t) => t.name === "Requerimiento Oficina de Trabajo"));
});

test("client CRUD with validation", async () => {
  assert.equal((await call("POST", "/clients", { full_name: "  " })).status, 400);
  const created = await call("POST", "/clients", { full_name: "Ana Pérez", id_number: "52123456", email: "ana@x.co" });
  assert.equal(created.status, 201);
  assert.equal(created.body.id_type, "CC");
  const upd = await call("PUT", `/clients/${created.body.id}`, { phone: "3001234567" });
  assert.equal(upd.body.phone, "300 123 4567");
  assert.equal(upd.body.email, "ana@x.co");
  const list = await call("GET", "/clients?q=5212");
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].case_count, 0);
});

test("categories, sub-processes and custom fields are editable", async () => {
  const cat = await call("POST", "/categories", { name: "Civil" });
  assert.equal(cat.status, 201);
  assert.equal((await call("POST", "/categories", { name: "Civil" })).status, 409);
  const type = await call("POST", `/categories/${cat.body.id}/types`, { name: "Proceso Verbal" });
  assert.equal(type.status, 201);
  assert.equal((await call("POST", `/categories/${cat.body.id}/fields`, { label: "Etapa", field_type: "select" })).status, 400);
  const field = await call("POST", `/categories/${cat.body.id}/fields`, {
    label: "Etapa", field_type: "select", options: ["Demanda", "Audiencia"], required: true,
  });
  assert.deepEqual(field.body.options, ["Demanda", "Audiencia"]);
  const catalog = (await call("GET", "/catalog")).body.find((c) => c.id === cat.body.id);
  assert.equal(catalog.types[0].name, "Proceso Verbal");
  assert.equal(catalog.fields[0].required, true);
});

test("cases link a client to a sub-process and enforce required fields", async () => {
  const client = (await call("POST", "/clients", { full_name: "Luis Gómez" })).body;
  const catalog = (await call("GET", "/catalog")).body;
  const lab = catalog.find((c) => c.name === "Laboral");
  const field = (await call("POST", `/categories/${lab.id}/fields`, { label: "Juzgado", required: true })).body;
  const typeId = lab.types.find((t) => t.name === "Ejecutivo Laboral").id;

  const missing = await call("POST", "/cases", { client_id: client.id, process_type_id: typeId });
  assert.equal(missing.status, 400);

  const k = await call("POST", "/cases", {
    client_id: client.id, process_type_id: typeId, title: "Cobro prestaciones",
    field_values: { [field.id]: "Juzgado 5 Laboral", 9999: "ignored" },
  });
  assert.equal(k.status, 201);
  assert.equal(k.body.category_name, "Laboral");
  assert.equal(k.body.type_name, "Ejecutivo Laboral");
  assert.deepEqual(k.body.field_values, { [field.id]: "Juzgado 5 Laboral" });

  assert.equal((await call("GET", `/cases?clientId=${client.id}`)).body.length, 1);
  // A client or sub-process with cases cannot be deleted.
  assert.equal((await call("DELETE", `/clients/${client.id}`)).status, 409);
  assert.equal((await call("DELETE", `/types/${typeId}`)).status, 409);

  assert.equal((await call("DELETE", `/cases/${k.body.id}`)).status, 204);
  assert.equal((await call("DELETE", `/clients/${client.id}`)).status, 204);
});
