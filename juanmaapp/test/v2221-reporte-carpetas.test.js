import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

let srv, admin, office;
before(async () => { srv = await startServer(); admin = await srv.setup(); office = (await admin.call("GET", "/admin/offices")).body[0].id; });
after(() => srv.close());

test("Listado por número de carpeta: one row per case with its folder, cases without folder included", async () => {
  const client = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Ana", last_names: "Ruiz", id_type: "CC", id_number: "52111223", office_id: office })).body;
  const type = (await admin.call("GET", "/catalog")).body[0].types[0];
  const mk = async (title) => (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: type.id, office_id: office, title })).body;
  const [a, b, c] = [await mk("A"), await mk("B"), await mk("C")];
  await admin.call("PUT", `/cases/${a.id}/folder`, { folder: "10" });
  await admin.call("PUT", `/cases/${b.id}/folder`, { folder: "2" });
  const rep = (await admin.call("GET", "/reports/carpetas")).body;
  assert.equal(rep.title, "Listado por número de carpeta");
  assert.equal(rep.columns[0].key, "folder");
  assert.equal(rep.rows.length, 3);
  assert.deepEqual(rep.rows.map((r) => r.folder).sort(), ["", "10", "2"]);
  assert.equal((await admin.call("GET", "/reports/carpetas?status=Activo")).body.rows.length, 3);
  assert.equal((await admin.call("GET", "/reports/carpetas?status=Archivo definitivo")).body.rows.length, 0);
});

test("Listado de clientes por estado: filters by the client's own state and carries its folders", async () => {
  const office2 = (await admin.call("GET", "/admin/offices")).body[0].id;
  const mkc = async (n, id) => (await admin.call("POST", "/clients", { person_type: "natural", first_names: n, last_names: "Prueba", id_type: "CC", id_number: id, office_id: office2 })).body;
  const p = await mkc("Pablo", "70111222"), q = await mkc("Quique", "70111333");
  await admin.call("PUT", `/clients/${p.id}/archive`, { status: "Pendiente Pago Sentencia" });
  const all = (await admin.call("GET", "/reports/clientesestado")).body;
  assert.equal(all.title, "Listado de clientes por estado");
  assert.ok(all.rows.some((r) => r.name.includes("Pablo") && r.state === "Pendiente Pago Sentencia"));
  const pps = (await admin.call("GET", "/reports/clientesestado?clientState=Pendiente%20Pago%20Sentencia")).body;
  assert.deepEqual(pps.rows.map((r) => r.name.includes("Pablo")), [true]);
  const act = (await admin.call("GET", "/reports/clientesestado?clientState=activos")).body;
  assert.ok(act.rows.length >= 1 && act.rows.every((r) => r.state === "Activo") && act.rows.some((r) => r.name.includes("Quique")));
});
