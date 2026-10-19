// Version 2.61: client «afiliado» and case «curador ad-litem», optional, the same on the server and the published link.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer } from "./helpers.js";
import { startLink } from "./link-backend.js";
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

async function same(scenario) {
  const out = {};
  for (const [name, call] of Object.entries(sides)) out[name] = await scenario(call);
  assert.deepEqual(out.link, out.server);
  return out.server;
}

test("client affiliated: off by default, kept when a later edit leaves it out", async () => {
  const out = await same(async (call) => {
    const a = (await call("POST", "/clients", { full_name: "Ana Afiliada", id_number: "7001", affiliated: true })).body;
    const b = (await call("POST", "/clients", { full_name: "Luis Libre", id_number: "7002" })).body;
    const kept = (await call("PUT", `/clients/${a.id}`, { phone: "3001112233" })).body;
    const off = (await call("PUT", `/clients/${a.id}`, { affiliated: false })).body;
    return [!!a.affiliated, !!b.affiliated, !!kept.affiliated, !!off.affiliated];
  });
  assert.deepEqual(out, [true, false, true, false]);
});

test("case ad-litem: off by default, kept by edits that leave it out", async () => {
  const out = await same(async (call) => {
    const c = (await call("POST", "/clients", { full_name: "Carlos Cliente", id_number: "7010" })).body;
    const type = (await call("GET", "/catalog")).body.find((g) => g.types.length).types[0].id;
    const a = (await call("POST", "/cases", { client_id: c.id, process_type_id: type, ad_litem: true, client_role: "Demandado" })).body;
    const b = (await call("POST", "/cases", { client_id: c.id, process_type_id: type })).body;
    const kept = (await call("PUT", `/cases/${a.id}`, { title: "Nuevo asunto" })).body;
    const off = (await call("PUT", `/cases/${a.id}`, { ad_litem: false })).body;
    return [a.ad_litem, b.ad_litem, kept.ad_litem, off.ad_litem, a.client_role];
  });
  assert.deepEqual(out, [true, false, true, false, "Demandado"]);
});

test("migration adds the columns without touching rows and makes a copy first", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "jm-261-"));
  try {
    const file = path.join(dir, "old.db");
    let db = openDb(file);
    db.exec("ALTER TABLE clients DROP COLUMN affiliated; ALTER TABLE cases DROP COLUMN ad_litem");
    db.prepare("INSERT INTO clients (office_id, full_name, first_names, last_names, id_type, id_number, department, city) VALUES (1, 'Gladys Vera Morales', 'Gladys', 'Vera Morales', 'CC', '38000111', 'Tolima', 'Ibagué')").run();
    const before = db.prepare("SELECT * FROM clients").all();
    db.close();
    db = openDb(file);
    const after = db.prepare("SELECT * FROM clients").all();
    for (const [i, row] of before.entries()) assert.deepEqual({ ...after[i], affiliated: undefined }, { ...row, affiliated: undefined });
    assert.equal(after[0].affiliated, 0);
    assert.equal(readdirSync(path.join(dir, "respaldos")).filter((f) => f.endsWith(".db")).length, 1);
    assert.equal(db.prepare("SELECT trigger FROM backup_log ORDER BY id DESC").get().trigger, "antes-v2.61");
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
