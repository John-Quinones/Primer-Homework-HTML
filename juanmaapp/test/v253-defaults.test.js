// Version 2.53 (user's rule): gender from the first names, Ibagué (Tolima) as the default place and
// John Quiñones as the default responsible. Existing data is only filled where empty, once, after a copy.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "../src/db.js";
import { genderFromName, defaultsPlan, defaultResponsible, homePlace } from "../src/record-rules.js";
import { startServer } from "./helpers.js";
import { startLink } from "./link-backend.js";

const dir = mkdtempSync(path.join(tmpdir(), "v253-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("gender from the first names: the first known name decides, uncommon names stay empty", () => {
  assert.equal(genderFromName("María José"), "mujer");
  assert.equal(genderFromName("José María"), "hombre");
  assert.equal(genderFromName("Yoslin Alejandra"), "mujer");
  assert.equal(genderFromName("Jhojan Andrés"), "hombre");
  assert.equal(genderFromName("Dany"), "");
  assert.equal(genderFromName(""), "");
});

test("only empty data is planned; what is set stays", () => {
  assert.deepEqual(homePlace({ department: "", city: "" }), { department: "Tolima", city: "Ibagué" });
  assert.deepEqual(homePlace({ department: "Tolima", city: "" }), { city: "Ibagué" });
  assert.deepEqual(homePlace({ department: "Huila", city: "" }), {});
  assert.deepEqual(homePlace({ department: "Tolima", city: "Espinal" }), {});
  const plan = defaultsPlan([
    { id: 1, first_names: "Gladys", person_type: "natural", gender: "", department: "", city: "" },
    { id: 2, first_names: "Carlos", person_type: "natural", gender: "mujer", department: "Huila", city: "Neiva" },
    { id: 3, full_name: "Inversiones S.A.S.", person_type: "juridica", gender: "", department: "Tolima", city: "Ibagué" },
    { id: 4, first_names: "Dany", full_name: "Dany Gutierrez", person_type: "natural", gender: "", department: "Tolima", city: "Ibagué" },
  ], [{ id: 10, assigned_user_id: null }, { id: 11, assigned_user_id: 7 }], () => 5);
  assert.deepEqual(plan.clients, [{ id: 1, set: { department: "Tolima", city: "Ibagué", gender: "mujer" } }]);
  assert.deepEqual(plan.cases, [{ id: 10, assigned_user_id: 5 }]);
  assert.deepEqual(plan.undecided, [{ id: 4, name: "Dany Gutierrez" }]);
  assert.equal(defaultResponsible([{ id: 1, name: "Ana", active: true }, { id: 2, name: "John Quiñones", active: true }]), 2);
  assert.equal(defaultResponsible([{ id: 2, name: "John Quiñones", active: false }]), null);
});

test("server: the fill runs once on existing data, after a copy, and keeps a log", () => {
  const file = path.join(dir, "juanmaapp.db");
  let db = openDb(file);
  const office = db.prepare("SELECT id FROM offices WHERE is_main = 1").get().id;
  const john = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES ('John Quinones', 'gerencia@x.co', 'x', 'Gerencia')").run().lastInsertRowid;
  const other = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES ('Ana Ruiz', 'ana@x.co', 'x', 'Abogado')").run().lastInsertRowid;
  db.prepare("INSERT INTO user_offices (user_id, office_id) VALUES (?, ?), (?, ?)").run(john, office, other, office);
  const add = db.prepare("INSERT INTO clients (full_name, first_names, last_names, id_number, person_type, gender, department, city, office_id) VALUES (?, ?, ?, ?, 'natural', ?, ?, ?, ?)");
  const gladys = add.run("Gladys Vera", "Gladys", "Vera", "1", "", "", "", office).lastInsertRowid;
  const carlos = add.run("Carlos Paz", "Carlos", "Paz", "2", "mujer", "Huila", "Neiva", office).lastInsertRowid;
  const type = db.prepare("SELECT id FROM process_types LIMIT 1").get().id;
  const addCase = db.prepare("INSERT INTO cases (client_id, process_type_id, field_values, office_id, assigned_user_id) VALUES (?, ?, '{}', ?, ?)");
  const free = addCase.run(gladys, type, office, null).lastInsertRowid;
  const taken = addCase.run(carlos, type, office, other).lastInsertRowid;
  db.prepare("DELETE FROM app_flags WHERE key = 'defaults-v2-53'").run(); // as a database from before 2.53
  db.close();

  db = openDb(file);
  const row = (id) => db.prepare("SELECT gender, department, city FROM clients WHERE id = ?").get(id);
  assert.deepEqual({ ...row(gladys) }, { gender: "mujer", department: "Tolima", city: "Ibagué" });
  assert.deepEqual({ ...row(carlos) }, { gender: "mujer", department: "Huila", city: "Neiva" }, "set data stays as it was");
  const owner = (id) => db.prepare("SELECT assigned_user_id FROM cases WHERE id = ?").get(id).assigned_user_id;
  assert.equal(owner(free), Number(john));
  assert.equal(owner(taken), Number(other), "a case with a responsible keeps it");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM defaults_log").get().n, 4);
  assert.ok(readdirSync(path.join(dir, "respaldos")).some((f) => f.endsWith(".db")), "a copy was made before filling");
  // Once: a value cleared later is not filled again on the next start.
  db.prepare("UPDATE clients SET city = '' WHERE id = ?").run(gladys);
  db.close();
  db = openDb(file);
  assert.equal(row(gladys).city, "");
  db.close();
});

test("link: the same fill on the saved data, once", async () => {
  const link = await startLink();
  await link.call("POST", "/auth/setup", { name: "John Quiñones", email: "gerencia@firma.co" });
  const type = (await link.call("GET", "/catalog")).body.find((c) => c.types.length).types[0].id;
  const c = (await link.call("POST", "/clients", { full_name: "Luz Mery Rojas", department: "Huila", city: "Neiva" })).body;
  await link.call("POST", "/cases", { client_id: c.id, process_type_id: type });
  const state = JSON.parse(await link.backend.exportData());
  // As data saved before 2.53: no gender, no place, no responsible.
  delete state.info.defaults253;
  state.clients.push({ ...state.clients[0], id: 99, full_name: "Jose Pérez", first_names: "Jose", last_names: "Pérez", gender: undefined, department: "", city: "" });
  state.cases[0].assigned_user_id = null;
  const again = await startLink({ state });
  const john = state.users[0].id;
  const clients = (await again.call("POST", "/auth/login", { email: "gerencia@firma.co" }), (await again.call("GET", "/clients")).body);
  assert.deepEqual(pickPlace(clients.find((x) => x.id === 99)), { gender: "hombre", department: "Tolima", city: "Ibagué" });
  assert.deepEqual(pickPlace(clients.find((x) => x.id === c.id)), { gender: "mujer", department: "Huila", city: "Neiva" });
  assert.equal((await again.call("GET", "/cases")).body[0].assigned_user_id, john);
});

const pickPlace = (c) => ({ gender: c.gender, department: c.department, city: c.city });

test("new clients and cases get the defaults on both sides", async () => {
  const srv = await startServer();
  try {
    const server = srv.session();
    await server.call("POST", "/auth/setup", { name: "John Quiñones", email: "gerencia@firma.co", password: "clave-segura-1" });
    const link = await startLink();
    await link.call("POST", "/auth/setup", { name: "John Quiñones", email: "gerencia@firma.co" });
    const sides = { server: server.call, link: link.call };
    const out = {};
    for (const [name, call] of Object.entries(sides)) {
      const me = (await call("GET", "/admin/users")).body[0];
      const type = (await call("GET", "/catalog")).body.find((c) => c.types.length).types[0].id;
      const c = (await call("POST", "/clients", { full_name: "Adriana López", id_number: "123" })).body;
      const k = (await call("POST", "/cases", { client_id: c.id, process_type_id: type })).body;
      out[name] = { gender: c.gender, department: c.department, city: c.city, responsible: k.assigned_user_id === me.id, name: k.assigned_name };
    }
    assert.deepEqual(out.link, out.server);
    assert.deepEqual(out.server, { gender: "mujer", department: "Tolima", city: "Ibagué", responsible: true, name: "John Quiñones" });
  } finally { srv.close(); }
});
