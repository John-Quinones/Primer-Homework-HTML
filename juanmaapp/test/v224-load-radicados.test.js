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
  assert.equal(set.body.monitor, 1);
  assert.equal(set.body.department, "Tolima");
  assert.equal(set.body.title, "Uno");
  assert.ok((await admin.call("GET", "/monitor/cases")).body.some((k) => k.id === a.id));

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
