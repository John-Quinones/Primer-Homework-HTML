// Version 2.56: where the client's ID card was issued (department and city), optional, official
// DIVIPOLA names, the same on the server and the published link, and available to templates.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer } from "./helpers.js";
import { startLink } from "./link-backend.js";
import { idPlaceVariables } from "../src/case-meta.js";
import { openDb } from "../src/db.js";

let srv, sides;
before(async () => {
  srv = await startServer();
  const link = await startLink();
  const server = await srv.setup();
  await link.call("POST", "/auth/setup", { name: "Gerente General", email: "gerencia@firma.co" });
  sides = { server: server.call, link: link.call };
});
after(() => srv.close());

const KEYS = ["id_department", "id_city", "department", "city"];
const pick = (o) => Object.fromEntries(KEYS.map((k) => [k, o?.[k]]));
async function same(scenario) {
  const out = {};
  for (const [name, call] of Object.entries(sides)) out[name] = await scenario(call);
  assert.deepEqual(out.link, out.server);
  return out.server;
}

test("place of issue: official names, optional, not filled by default", async () => {
  const out = await same(async (call) => {
    const a = (await call("POST", "/clients", { full_name: "Ana Expedición", id_number: "9001", id_department: "cundinamarca", id_city: "FUSAGASUGA" })).body;
    const b = (await call("POST", "/clients", { full_name: "Luis Sin Lugar", id_number: "9002" })).body;
    const bog = (await call("POST", "/clients", { full_name: "Rosa Bogotana", id_number: "9003", id_department: "bogota", id_city: "bogota" })).body;
    const bad = await call("POST", "/clients", { full_name: "Pedro Error", id_number: "9004", id_department: "Narnia" });
    // a later edit that leaves the fields out keeps them
    const kept = (await call("PUT", `/clients/${a.id}`, { phone: "3001112233" })).body;
    const company = (await call("POST", "/clients", { person_type: "juridica", business_name: "Empresa SAS", nit: "900123456-7", id_department: "Tolima", id_city: "Ibagué" })).body;
    return { a: pick(a), b: pick(b), bog: pick(bog), bad: [bad.status, bad.body.error], kept: pick(kept), company: pick(company) };
  });
  assert.deepEqual([out.a.id_department, out.a.id_city], ["Cundinamarca", "Fusagasugá"]);
  assert.deepEqual([out.b.id_department, out.b.id_city], ["", ""], "no default place of issue");
  assert.deepEqual([out.b.department, out.b.city], ["Tolima", "Ibagué"], "the residence default stays as before");
  assert.deepEqual([out.bog.id_department, out.bog.id_city], ["Bogotá, D.C.", "Bogotá, D.C."]);
  assert.equal(out.bad[0], 400);
  assert.deepEqual([out.kept.id_department, out.kept.id_city], ["Cundinamarca", "Fusagasugá"]);
  assert.deepEqual([out.company.id_department, out.company.id_city], ["", ""], "companies have no ID card");
});

test("templates get {{cliente.expedicion}}, its city and its department", async () => {
  assert.deepEqual(idPlaceVariables({ id_city: "Ibagué", id_department: "Tolima" }),
    { "cliente.expedicion": "Ibagué (Tolima)", "cliente.expedicion_ciudad": "Ibagué", "cliente.expedicion_departamento": "Tolima" });
  assert.equal(idPlaceVariables({ id_city: "Bogotá, D.C.", id_department: "Bogotá, D.C." })["cliente.expedicion"], "Bogotá, D.C.");
  assert.equal(idPlaceVariables({})["cliente.expedicion"], "");
  await same(async (call) => {
    const c = (await call("POST", "/clients", { full_name: "Carlos Chocoano", id_number: "9010", id_department: "choco", id_city: "quibdo" })).body;
    const type = (await call("GET", "/catalog")).body.find((g) => g.types.length).types[0].id;
    const k = (await call("POST", "/cases", { client_id: c.id, process_type_id: type })).body;
    const d = (await call("GET", `/templates/data?caseId=${k.id}`)).body;
    assert.equal(d["cliente.expedicion"], "Quibdó (Chocó)");
    return [d["cliente.expedicion"], d["cliente.expedicion_ciudad"], d["cliente.expedicion_departamento"]];
  });
});

test("migration only adds two empty columns: existing clients keep every value", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "jm-256-"));
  try {
    const file = path.join(dir, "old.db");
    let db = openDb(file);
    db.exec("ALTER TABLE clients DROP COLUMN id_department; ALTER TABLE clients DROP COLUMN id_city");
    db.prepare("INSERT INTO clients (office_id, full_name, first_names, last_names, id_type, id_number, department, city, gender) VALUES (1, 'Gladys Vera Morales', 'Gladys', 'Vera Morales', 'CC', '38000111', 'Tolima', 'Ibagué', 'mujer')").run();
    const before = db.prepare("SELECT * FROM clients").all();
    db.close();
    db = openDb(file);
    const after = db.prepare("SELECT * FROM clients").all();
    assert.equal(after.length, before.length);
    for (const [i, row] of before.entries()) {
      assert.deepEqual({ ...after[i], id_department: undefined, id_city: undefined }, { ...row, id_department: undefined, id_city: undefined });
      assert.deepEqual([after[i].id_department, after[i].id_city], ["", ""]);
    }
    assert.equal(readdirSync(path.join(dir, "respaldos")).filter((f) => f.endsWith(".db")).length, 1, "a copy was made before the columns were added");
    assert.equal(db.prepare("SELECT trigger FROM backup_log ORDER BY id DESC").get().trigger, "antes-v2.56");
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
