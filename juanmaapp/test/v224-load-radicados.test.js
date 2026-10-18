import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

let srv, admin, office;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  office = (await admin.call("GET", "/admin/offices")).body[0].id;
});
after(() => srv.close());

test("«Cargar radicados» saves 23 digits, fills the place, turns the consultation on and refuses repeats", async () => {
  const client = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Marta", last_names: "León", id_type: "CC", id_number: "52111299", office_id: office })).body;
  const type = (await admin.call("GET", "/catalog")).body[0].types[0];
  const a = (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: type.id, office_id: office, title: "Uno" })).body;
  const b = (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: type.id, office_id: office, title: "Dos" })).body;
  assert.equal(a.radicado, "");

  const short = await admin.call("PUT", `/cases/${a.id}/radicado`, { radicado: "73-001-40-03" });
  assert.equal(short.status, 400);
  assert.match(short.body.error, /23 dígitos/);

  const set = await admin.call("PUT", `/cases/${a.id}/radicado`, { radicado: "73-001-40-03-002-2008-00664-00" });
  assert.equal(set.status, 200);
  assert.equal(set.body.radicado, "73001400300220080066400");
  assert.equal(set.body.monitor, 0, "saving a radicado does not turn the consultation on (v2.38)");
  assert.equal(set.body.department, "Tolima");
  assert.equal(set.body.title, "Uno");

  const dup = await admin.call("PUT", `/cases/${b.id}/radicado`, { radicado: "73001400300220080066400" });
  assert.equal(dup.status, 400);
  assert.match(dup.body.error, /ya está en el expediente «Uno»/);

  // A saved radicado is not overwritten without confirmation.
  const other = "73001400300220090012300";
  const noConfirm = await admin.call("PUT", `/cases/${a.id}/radicado`, { radicado: other });
  assert.equal(noConfirm.status, 400);
  assert.match(noConfirm.body.error, /Confirme/);
  assert.equal((await admin.call("GET", `/cases/${a.id}`)).body.radicado, "73001400300220080066400");
  const changed = await admin.call("PUT", `/cases/${a.id}/radicado`, { radicado: other, replace: true });
  assert.equal(changed.body.radicado, other);
  assert.equal((await admin.call("PUT", `/cases/${a.id}/radicado`, { radicado: other })).status, 200); // same value: no change

  const log = (await admin.call("GET", `/audit?caseId=${a.id}`)).body;
  assert.ok(log.some((e) => /\(radicado\)/.test(e.summary)));
});

test("version 2.38: the automatic consultation turns on only with its box", async () => {
  const client = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Rosa", last_names: "Díaz", id_type: "CC", id_number: "52111300", office_id: office })).body;
  const type = (await admin.call("GET", "/catalog")).body[0].types[0];
  const plain = (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: type.id, office_id: office, radicado: "73001400300220100012300" })).body;
  assert.equal(plain.monitor, 0);
  const ticked = (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: type.id, office_id: office, radicado: "73001400300220100012400", monitor: true })).body;
  assert.equal(ticked.monitor, 1);
  // A partial update keeps the box as it was.
  assert.equal((await admin.call("PUT", `/cases/${ticked.id}`, { title: "Otro" })).body.monitor, 1);
  const c = (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: type.id, office_id: office })).body;
  assert.equal((await admin.call("PUT", `/cases/${c.id}/radicado`, { radicado: "73001400300220100012500", monitor: true })).body.monitor, 1);
});
