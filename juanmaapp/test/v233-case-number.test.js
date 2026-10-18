import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer } from "./helpers.js";
import { openDb } from "../src/db.js";

let srv, admin, office;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  office = (await admin.call("GET", "/admin/offices")).body[0].id;
});
after(() => srv.close());

test("the case number is saved with the case and edited by the responsible funcionario even without cases.write", async () => {
  const mk = (name, email) => admin.call("POST", "/admin/users", { name, email, role: "Director Contable", office_ids: [office], password: "tribunal-azul-2026" });
  const assigned = (await mk("Laura Gómez", "laura@firma.co")).body;
  await mk("Pedro Ruiz", "pedro@firma.co");
  const client = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Ana", last_names: "Ruiz", id_type: "CC", id_number: "52111222", office_id: office })).body;
  const type = (await admin.call("GET", "/catalog")).body[0].types[0];
  const k = (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: type.id, office_id: office, title: "Pensión", case_number: "  730014189002201601179 ", assigned_user_id: assigned.id })).body;
  assert.equal(k.case_number, "730014189002201601179");
  const kept = await admin.call("PUT", `/cases/${k.id}`, { title: "Pensión de vejez" });
  assert.equal(kept.body.case_number, "730014189002201601179", "a PUT without case_number keeps it");

  const laura = await srv.login("laura@firma.co", "tribunal-azul-2026");
  assert.equal((await laura.call("PUT", `/cases/${k.id}`, { title: "x" })).status, 403, "the role cannot edit the case");
  const set = await laura.call("PUT", `/cases/${k.id}/number`, { case_number: "2016-01179" });
  assert.equal(set.status, 200);
  assert.equal(set.body.case_number, "2016-01179");
  assert.equal(set.body.title, "Pensión de vejez");

  const pedro = await srv.login("pedro@firma.co", "tribunal-azul-2026");
  const refused = await pedro.call("PUT", `/cases/${k.id}/number`, { case_number: "1" });
  assert.equal(refused.status, 403);
  assert.match(refused.body.error, /funcionario asignado/);
  assert.equal((await admin.call("GET", `/cases/${k.id}`)).body.case_number, "2016-01179");
  assert.ok((await admin.call("GET", `/audit?caseId=${k.id}`)).body.some((e) => /\(número de expediente\)/.test(e.summary)));
});

test("an older database copies «Radicado (como venía)» into the case number once and keeps the field", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "jm-number-"));
  const file = path.join(dir, "old.db");
  try {
    let db = openDb(file);
    const catId = db.prepare("INSERT INTO process_categories (name) VALUES ('Prueba v2.33')").run().lastInsertRowid;
    const typeId = db.prepare("INSERT INTO process_types (category_id, name) VALUES (?, 'Ordinario')").run(catId).lastInsertRowid;
    const fieldId = db.prepare("INSERT INTO custom_fields (category_id, label, field_type) VALUES (?, 'Radicado (como venía)', 'text')").run(catId).lastInsertRowid;
    const officeId = db.prepare("SELECT id FROM offices LIMIT 1").get()?.id ?? db.prepare("INSERT INTO offices (name) VALUES ('Ibagué')").run().lastInsertRowid;
    const clientId = db.prepare("INSERT INTO clients (full_name, office_id) VALUES ('Ana Ruiz', ?)").run(officeId).lastInsertRowid;
    const add = (values) => db.prepare("INSERT INTO cases (client_id, process_type_id, field_values, office_id) VALUES (?, ?, ?, ?)").run(clientId, typeId, JSON.stringify(values), officeId).lastInsertRowid;
    const withOld = add({ [fieldId]: "730014189002201601179" }), without = add({});
    db.exec("ALTER TABLE cases DROP COLUMN case_number"); // as before version 2.33
    db.close();

    db = openDb(file);
    const row = (id) => db.prepare("SELECT case_number, field_values FROM cases WHERE id = ?").get(id);
    assert.equal(row(withOld).case_number, "730014189002201601179");
    assert.equal(JSON.parse(row(withOld).field_values)[fieldId], "730014189002201601179", "the imported field stays");
    assert.equal(row(without).case_number, "");
    db.prepare("UPDATE cases SET case_number = '' WHERE id = ?").run(withOld); // a number cleared later is not filled again
    db.close();
    db = openDb(file);
    assert.equal(row(withOld).case_number, "");
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
