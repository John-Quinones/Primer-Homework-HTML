import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { rmSync } from "node:fs";
import { startServer } from "./helpers.js";
import { openDb } from "../src/db.js";

let srv, admin;
before(async () => { srv = await startServer(); admin = await srv.setup(); });
after(() => srv.close());

test("natural person: first and last names apart, always with initial capitals", async () => {
  const r = await admin.call("POST", "/clients", { person_type: "natural", first_names: "jOHN  fREDY", last_names: "QUIÑONES montaña", id_type: "CC", id_number: " 17 418 999 " });
  assert.equal(r.status, 201);
  assert.equal(r.body.first_names, "John Fredy");
  assert.equal(r.body.last_names, "Quiñones Montaña");
  assert.equal(r.body.full_name, "John Fredy Quiñones Montaña");
  assert.equal(r.body.id_number, "17418999");
  const u = await admin.call("PUT", `/clients/${r.body.id}`, { last_names: "TORRES DE CIFUENTES" });
  assert.equal(u.body.full_name, "John Fredy Torres de Cifuentes");
  assert.equal((await admin.call("POST", "/clients", { person_type: "natural", first_names: " ", last_names: "Pérez" })).status, 400);
});

test("legal entity: business name and NIT, no first or last names", async () => {
  const r = await admin.call("POST", "/clients", { person_type: "juridica", full_name: "Inversiones del Tolima S.A.S.", id_type: "CC", id_number: "900123456-7", legal_rep: "PEDRO PÉREZ" });
  assert.equal(r.status, 201);
  assert.equal(r.body.id_type, "NIT");
  assert.equal(r.body.full_name, "Inversiones del Tolima S.A.S.");
  assert.equal(r.body.first_names, "");
  assert.equal(r.body.legal_rep, "Pedro Pérez");
  assert.equal((await admin.call("POST", "/clients", { person_type: "juridica", full_name: "" })).status, 400);
});

test("a single full name (imports, older records) is split; company names are recognized", async () => {
  const a = await admin.call("POST", "/clients", { full_name: "MARTHA EDILMA TORRES DE CIFUENTES" });
  assert.deepEqual([a.body.person_type, a.body.first_names, a.body.last_names], ["natural", "Martha Edilma", "Torres de Cifuentes"]);
  const b = await admin.call("POST", "/clients", { full_name: "URBANIZADORA APARCO S.A.S.", id_number: "901397980" });
  assert.deepEqual([b.body.person_type, b.body.id_type], ["juridica", "NIT"]);
});

test("existing clients are migrated once: names split, companies marked", () => {
  // An older database: clients with a single name.
  const file = `/tmp/jm-mig-${process.pid}.db`;
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE clients (id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, id_type TEXT NOT NULL DEFAULT 'CC', id_number TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  old.prepare("INSERT INTO clients (full_name) VALUES (?), (?)").run("YANETH URUEÑA YARA", "POLICIA NACIONAL");
  old.close();
  const db2 = openDb(file);
  const rows = db2.prepare("SELECT full_name, person_type, first_names, last_names, id_type FROM clients ORDER BY id").all().map((r) => ({ ...r }));
  db2.close();
  rmSync(file, { force: true });
  assert.deepEqual(rows[0], { full_name: "Yaneth Urueña Yara", person_type: "natural", first_names: "Yaneth", last_names: "Urueña Yara", id_type: "CC" });
  assert.deepEqual(rows[1], { full_name: "POLICIA NACIONAL", person_type: "juridica", first_names: "", last_names: "", id_type: "NIT" });
});
