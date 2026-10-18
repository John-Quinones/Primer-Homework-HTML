import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { caseRecipient, recipientText, recipientInline, officialTitle, recipientPrompt } from "../src/case-meta.js";

let srv, admin, office;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  office = (await admin.call("GET", "/admin/offices")).body[0].id;
});
after(() => srv.close());

test("the addressee of a case: the judge of its court first, then the official saved for the entity", () => {
  const court = "Juzgado 002 Civil Municipal de Ibagué";
  const k = { court_name: court, court_email: "j02cmibague@cendoj.ramajudicial.gov.co", judge_name: "Ana María Pérez Rojas", city: "Ibagué", counterparty: "Colpensiones" };
  const r = caseRecipient(k, []);
  assert.equal(r.source, "expediente");
  assert.equal(r.title, "Juez");
  assert.equal(recipientText(r), `Señor(a)\nAna María Pérez Rojas\nJuez\n${court}\nCorreo: j02cmibague@cendoj.ramajudicial.gov.co\nE. S. D.`);
  const saved = [{ entity: "COLPENSIONES", treatment: "Doctor", name: "Jaime Dussán", title: "Presidente", email: "notificaciones@colpensiones.gov.co", city: "Bogotá" }];
  const p = caseRecipient(k, saved, "colpensiones");
  assert.deepEqual([p.source, p.name, p.title, p.email], ["directorio", "Jaime Dussán", "Presidente", "notificaciones@colpensiones.gov.co"]);
  assert.equal(recipientInline(p), "Doctor Jaime Dussán, Presidente, COLPENSIONES, Bogotá");
  // A court with no judge recorded and nothing saved: entity and title only, the name is left to type.
  const none = caseRecipient({ court_name: "Tribunal Superior de Ibagué" }, []);
  assert.deepEqual([none.name, none.title, none.source], ["", "Magistrado(a) ponente", ""]);
  assert.equal(officialTitle("Alcaldía de Ibagué"), "Alcalde(sa)");
  assert.deepEqual(recipientPrompt({}), []);
  assert.match(recipientPrompt(r)[0], /Señor\(a\) Ana María Pérez Rojas, Juez, Juzgado 002/);
});

test("officials per entity are saved once per entity, fill the templates and only Gerencia deletes them", async () => {
  const a = await admin.call("POST", "/authorities", { entity: "Colpensiones", treatment: "Doctora", name: "Laura Ríos", title: "Directora de Prestaciones Económicas", email: "notificaciones@colpensiones.gov.co" });
  assert.equal(a.status, 201);
  const again = await admin.call("POST", "/authorities", { entity: "COLPENSIONES ", name: "Laura Ríos Gómez", title: "Directora de Prestaciones Económicas" });
  assert.equal(again.body.id, a.body.id, "same entity updates its official");
  assert.equal(again.body.name, "Laura Ríos Gómez");
  assert.equal((await admin.call("GET", "/authorities")).body.length, 1);
  assert.equal((await admin.call("POST", "/authorities", { entity: " " })).status, 400);
  assert.equal((await admin.call("POST", "/authorities", { entity: "EPS", email: "no-es-correo" })).status, 400);

  const client = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Ana", last_names: "Ruiz", id_type: "CC", id_number: "52111222", office_id: office })).body;
  const type = (await admin.call("GET", "/catalog")).body[0].types[0];
  const k = (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: type.id, office_id: office, title: "Pensión", counterparty: "Colpensiones" })).body;
  const v = (await admin.call("GET", `/templates/data?caseId=${k.id}`)).body;
  assert.equal(v["destinatario.nombre"], "Laura Ríos Gómez");
  assert.equal(v["destinatario.tratamiento"], "Señor(a)", "the second save did not send a treatment");
  assert.match(v["destinatario.bloque"], /^Señor\(a\)\nLaura Ríos Gómez\nDirectora de Prestaciones Económicas\nCOLPENSIONES$/, "the last save names the entity as typed");

  const lawyer = (await admin.call("POST", "/admin/users", { name: "Pedro Mora", email: "pedro@firma.co", role: "Abogado", office_ids: [office], password: "tribunal-azul-2026" })).body;
  const p = await srv.login("pedro@firma.co", "tribunal-azul-2026");
  assert.ok(lawyer.id);
  assert.equal((await p.call("PUT", `/authorities/${a.body.id}`, { entity: "Colpensiones", name: "Laura Ríos" })).status, 200);
  assert.equal((await p.call("DELETE", `/authorities/${a.body.id}`)).status, 403);
  assert.equal((await admin.call("DELETE", `/authorities/${a.body.id}`)).status, 204);
  assert.equal((await admin.call("GET", "/authorities")).body.length, 0);
});

test("the addressee carries the authority's address and e-mail (version 2.30)", async () => {
  const r = caseRecipient({ court_name: "Juzgado 001 Civil Municipal de Ibagué", court_email: "j01cmiba@cendoj.ramajudicial.gov.co",
    court_address: "Carrera 2 No. 8-90, Palacio de Justicia", judge_name: "Luis Pérez", city: "Ibagué" }, []);
  assert.equal(recipientText(r), "Señor(a)\nLuis Pérez\nJuez\nJuzgado 001 Civil Municipal de Ibagué\nCarrera 2 No. 8-90, Palacio de Justicia\nCorreo: j01cmiba@cendoj.ramajudicial.gov.co\nE. S. D.");
  assert.equal(recipientPrompt(r).length, 3);
  const a = await admin.call("POST", "/authorities", { entity: "Nueva EPS", name: "Marta Gil", address: "Calle 60 No. 5-20, Ibagué", email: "notificaciones@nuevaeps.com.co" });
  assert.equal(a.body.address, "Calle 60 No. 5-20, Ibagué");
  const client = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Rosa", last_names: "Peña", id_type: "CC", id_number: "65111333", office_id: office })).body;
  const type = (await admin.call("GET", "/catalog")).body[0].types[0];
  const k = (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: type.id, office_id: office, title: "Tutela salud", counterparty: "Nueva EPS" })).body;
  const v = (await admin.call("GET", `/templates/data?caseId=${k.id}`)).body;
  assert.equal(v["destinatario.direccion"], "Calle 60 No. 5-20, Ibagué");
  assert.equal(v["destinatario.correo"], "notificaciones@nuevaeps.com.co");
  assert.match(v["destinatario.bloque"], /Calle 60 No\. 5-20, Ibagué\nCorreo: notificaciones@nuevaeps\.com\.co$/);
});
