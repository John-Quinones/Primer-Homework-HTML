import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "../src/db.js";
import { radicadosFromNumbers } from "../src/case-meta.js";

test("a 21-digit case number + 00 becomes the radicado once; repeats and saved radicados are left alone", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "jm-rad00-"));
  const file = path.join(dir, "old.db");
  try {
    let db = openDb(file);
    const catId = db.prepare("INSERT INTO process_categories (name) VALUES ('Prueba v2.35')").run().lastInsertRowid;
    const typeId = db.prepare("INSERT INTO process_types (category_id, name) VALUES (?, 'Ordinario')").run(catId).lastInsertRowid;
    const fieldId = db.prepare("INSERT INTO custom_fields (category_id, label, field_type) VALUES (?, 'Radicado (como venía)', 'text')").run(catId).lastInsertRowid;
    const officeId = db.prepare("SELECT id FROM offices LIMIT 1").get()?.id ?? db.prepare("INSERT INTO offices (name) VALUES ('Ibagué')").run().lastInsertRowid;
    const clientId = db.prepare("INSERT INTO clients (full_name, office_id) VALUES ('Ana Ruiz', ?)").run(officeId).lastInsertRowid;
    const add = (old, radicado = "") => db.prepare("INSERT INTO cases (client_id, process_type_id, field_values, office_id, radicado) VALUES (?, ?, ?, ?, ?)")
      .run(clientId, typeId, JSON.stringify(old ? { [fieldId]: old } : {}), officeId, radicado).lastInsertRowid;
    const a = add("730014189002201601179"), twin = add("730014189002201601179"), saved = add("730013333008201500278", "73001333300820150027801"), odd = add("2016-01179");
    db.exec("ALTER TABLE cases DROP COLUMN case_number; DELETE FROM app_flags WHERE key = 'radicado-from-number'"); // as before version 2.33
    db.close();

    db = openDb(file);
    const row = (id) => db.prepare("SELECT radicado, monitor, department, city, case_number FROM cases WHERE id = ?").get(id);
    assert.deepEqual({ ...row(a) }, { radicado: "73001418900220160117900", monitor: 1, department: "Tolima", city: "Ibagué", case_number: "730014189002201601179" });
    assert.equal(row(twin).radicado, "", "the same radicado is not given to a second case");
    assert.equal(row(saved).radicado, "73001333300820150027801", "a saved radicado stays");
    assert.equal(row(odd).radicado, "");
    db.prepare("UPDATE cases SET radicado = '' WHERE id = ?").run(a); // cleared later: not filled again
    db.close();
    db = openDb(file);
    assert.equal(row(a).radicado, "");
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("radicadosFromNumbers reports the repeated numbers it skipped", () => {
  const r = radicadosFromNumbers([{ id: 1, case_number: "730014189002201601179", radicado: "" }, { id: 2, case_number: "730014189002201601179", radicado: "" }]);
  assert.deepEqual(r.out, [{ id: 1, radicado: "73001418900220160117900" }]);
  assert.deepEqual(r.skipped, [{ id: 2, radicado: "73001418900220160117900" }]);
});
