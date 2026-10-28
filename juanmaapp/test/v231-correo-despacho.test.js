import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

let srv, admin, office, type, client;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  office = (await admin.call("GET", "/admin/offices")).body[0].id;
  type = (await admin.call("GET", "/catalog")).body[0].types[0];
  client = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Ana", last_names: "Prueba", id_type: "CC", id_number: "52111222", office_id: office })).body;
});
after(() => srv.close());

test("the court e-mail of a case: directory fills it, a typed one is kept and can be saved in the directory", async () => {
  const rows = [
    { name: "Juzgado 001 Civil Municipal de Ibagué", department: "Tolima", city: "Ibagué", area: "Civil", email: "j01cmpalibague@cendoj.ramajudicial.gov.co" },
    { name: "Juzgado 002 Civil Municipal de Ibagué", department: "Tolima", city: "Ibagué", area: "Civil", email: "" },
  ];
  assert.equal((await admin.call("POST", "/courts/import", { rows })).status, 200);
  const courts = (await admin.call("GET", "/courts?all=1")).body;
  const c1 = courts.find((c) => c.name.includes("001")), c2 = courts.find((c) => c.name.includes("002"));
  const base = { client_id: client.id, process_type_id: type.id, office_id: office, title: "Caso" };
  // Directory e-mail fills the case when nothing is typed.
  const k1 = (await admin.call("POST", "/cases", { ...base, court_id: c1.id })).body;
  assert.equal(k1.court_email, c1.email);
  // A typed e-mail wins and survives a save that does not send it.
  const k2 = (await admin.call("POST", "/cases", { ...base, court_id: c2.id, court_email: "Manual@Despacho.gov.co" })).body;
  assert.equal(k2.court_email, "manual@despacho.gov.co");
  const k2b = (await admin.call("PUT", `/cases/${k2.id}`, { title: "Otro" })).body;
  assert.equal(k2b.court_email, "manual@despacho.gov.co");
  assert.equal((await admin.call("GET", "/courts?all=1")).body.find((c) => c.id === c2.id).email, "", "not saved in the directory unless asked");
  // Court not in the directory: typed e-mail kept on the case.
  const k3 = (await admin.call("POST", "/cases", { ...base, court_name: "Juzgado de otro lugar", court_email: "otro@lugar.gov.co" })).body;
  assert.equal(k3.court_email, "otro@lugar.gov.co");
  // Invalid e-mail rejected.
  assert.equal((await admin.call("POST", "/cases", { ...base, court_name: "X", court_email: "no-es-correo" })).status, 400);
  // «Guardar también en el despacho» fills the directory only when empty.
  await admin.call("PUT", `/cases/${k2.id}`, { court_id: c2.id, court_email: "manual@despacho.gov.co", save_court_email: true });
  assert.equal((await admin.call("GET", "/courts?all=1")).body.find((c) => c.id === c2.id).email, "manual@despacho.gov.co");
  await admin.call("PUT", `/cases/${k1.id}`, { court_id: c1.id, court_email: "otro@x.co", save_court_email: true });
  assert.equal((await admin.call("GET", "/courts?all=1")).body.find((c) => c.id === c1.id).email, c1.email, "an existing directory e-mail is never overwritten");
});
