// Version 2.2.65: categories of «Memoriales». CRUD (Gerencia only), starter categories, a Memorial template belongs to one category,
// same behaviour on the server and the published link, and the additive migration keeps every template.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { startServer } from "./helpers.js";
import { startLink } from "./link-backend.js";
import { MEMORIAL_CATEGORIES_SCHEMA, addMemorialColumn } from "../src/memorial-categories-routes.js";

let srv, admin, sides, office;
before(async () => {
  srv = await startServer();
  admin = await srv.setup();
  office = (await admin.call("GET", "/admin/offices")).body[0].id;
  const link = await startLink();
  await link.call("POST", "/auth/setup", { name: "Gerente General", email: "gerencia@firma.co" });
  sides = { server: admin.call, link: link.call };
});
after(() => srv.close());

async function same(scenario) {
  const out = {};
  for (const [name, call] of Object.entries(sides)) out[name] = await scenario(call);
  assert.deepEqual(out.link, out.server);
  return out.server;
}
const strip = (list) => list.map(({ id, created_at, updated_at, created_by, ...x }) => x);

test("starter categories exist once, then CRUD, order, deactivate and delete behave the same on server and link", async () => {
  const out = await same(async (call) => {
    const start = (await call("GET", "/memorial-categories")).body;
    const a = (await call("POST", "/memorial-categories", { title: " Solicitud de copias ", description: " Pedir copias " })).body;
    const dup = await call("POST", "/memorial-categories", { title: "solicitud  de COPIAS" });
    const empty = await call("POST", "/memorial-categories", { title: " " });
    const edited = (await call("PUT", `/memorial-categories/${a.id}`, { title: "Solicitud de copias simples" })).body;
    const ordered = await call("PUT", "/memorial-categories/order", { ids: [a.id, start[0].id] });
    const badOrder = await call("PUT", "/memorial-categories/order", { ids: [a.id, a.id] });
    const off = (await call("PUT", `/memorial-categories/${start[2].id}`, { is_active: false })).body;
    const active = (await call("GET", "/memorial-categories")).body;
    const every = (await call("GET", "/memorial-categories?all=1")).body;
    const removed = await call("DELETE", `/memorial-categories/${a.id}`);
    return { start: strip(start), a: strip([a])[0], dup: dup.status, empty: empty.status, edited: edited.title, ordered: ordered.body.map((x) => x.title), badOrder: badOrder.status,
      off: off.is_active, active: active.map((x) => x.title), every: every.length, removed: removed.body.deleted };
  });
  assert.deepEqual(out.start.map((x) => x.title), ["Solicitud de impulso", "Solicitud de link", "Requerimiento"]);
  assert.equal(out.dup, 400); assert.equal(out.empty, 400); assert.equal(out.badOrder, 400);
  assert.equal(out.edited, "Solicitud de copias simples");
  assert.equal(out.ordered[0], "Solicitud de copias simples");
  assert.equal(out.off, false);
  assert.equal(out.active.includes("Requerimiento"), false);
  assert.equal(out.every, 4);
  assert.equal(out.removed, true);
});

test("a Memorial template keeps its category; a category with templates is only deactivated; other template categories drop it", async () => {
  const out = await same(async (call) => {
    const cats = (await call("GET", "/memorial-categories?all=1")).body;
    const impulso = cats.find((c) => c.title === "Solicitud de impulso");
    const t = (await call("POST", "/templates", { name: "Impulso procesal", category: "Memorial", body: "Señor Juez {{cliente.nombre}}", memorial_category_id: impulso.id })).body;
    const other = (await call("POST", "/templates", { name: "Un poder", category: "Poder", body: "Poder {{cliente.nombre}}", memorial_category_id: impulso.id })).body;
    const bad = await call("POST", "/templates", { name: "Mala", category: "Memorial", body: "x", memorial_category_id: 99999 });
    const listed = (await call("GET", "/templates")).body.filter((x) => x.id === t.id || x.id === other.id).map((x) => [x.name, x.memorial_category_id === impulso.id]);
    const del = await call("DELETE", `/memorial-categories/${impulso.id}`);
    const moved = (await call("PUT", `/templates/${t.id}`, { category: "Contrato" })).body;
    return { listed, bad: bad.status, del: del.body.deactivated, movedCat: moved.memorial_category_id };
  });
  assert.deepEqual(out.listed, [["Impulso procesal", true], ["Un poder", false]]);
  assert.equal(out.bad, 400);
  assert.equal(out.del, true);
  assert.equal(out.movedCat, null);
});

test("the migration only adds: old templates stay and read as «sin categoría»", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE document_templates (id INTEGER PRIMARY KEY, name TEXT, category TEXT)");
  db.prepare("INSERT INTO document_templates (name, category) VALUES ('Derecho de petición', 'Memorial')").run();
  db.exec(MEMORIAL_CATEGORIES_SCHEMA); addMemorialColumn(db); addMemorialColumn(db);
  assert.deepEqual(db.prepare("SELECT name, memorial_category_id FROM document_templates").all().map((r) => ({ ...r })), [{ name: "Derecho de petición", memorial_category_id: null }]);
});

test("only Gerencia assigns a template to a memorial category (the Director Jurídico can still manage templates)", async () => {
  const cat = (await admin.call("GET", "/memorial-categories")).body[0];
  const t = (await admin.call("POST", "/templates", { name: "Memorial base", category: "Memorial", body: "x", memorial_category_id: cat.id })).body;
  await admin.call("POST", "/admin/users", { name: "Directora Memoriales", email: "dirmem@firma.co", role: "Director Jurídico", office_ids: [office],
    password: "tribunal-azul-2026", custom_permissions: true, permissions: ["templates.manage", "drafts.generate", "cases.write"] });
  const d = await srv.login("dirmem@firma.co", "tribunal-azul-2026");
  await d.call("POST", "/auth/password", { current: "tribunal-azul-2026", next: "tribunal-verde-2026" });
  assert.equal((await d.call("POST", "/templates", { name: "Otro memorial", category: "Memorial", body: "y", memorial_category_id: cat.id })).status, 400);
  assert.equal((await d.call("POST", "/templates", { name: "Otro memorial", category: "Memorial", body: "y" })).status, 201);
  assert.equal((await d.call("PUT", `/templates/${t.id}`, { memorial_category_id: "" })).status, 400);
  assert.equal((await d.call("PUT", `/templates/${t.id}`, { name: "Memorial base 2", memorial_category_id: cat.id })).body.memorial_category_id, cat.id);
  assert.equal((await d.call("POST", "/memorial-categories", { title: "Nueva" })).status, 403);
});

test("v2.2.68: each category carries its text (same on server and link) and the old table gets the column without losing rows", async () => {
  const out = await same(async (call) => {
    const a = (await call("POST", "/memorial-categories", { title: "Con texto", clause: " Solicito a {{cliente.nombre}}\r\n\r\n\r\nimpulso. " })).body;
    const e = (await call("PUT", `/memorial-categories/${a.id}`, { description: "x" })).body;
    const long = await call("POST", "/memorial-categories", { title: "Larga", clause: "x".repeat(8001) });
    const plain = (await call("POST", "/memorial-categories", { title: "Sin texto" })).body;
    return { clause: a.clause, kept: e.clause, long: long.status, plain: plain.clause };
  });
  assert.equal(out.clause, "Solicito a {{cliente.nombre}}\n\nimpulso.");
  assert.equal(out.kept, out.clause);
  assert.equal(out.long, 400);
  assert.equal(out.plain, "");
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE document_templates (id INTEGER PRIMARY KEY)");
  db.exec("CREATE TABLE memorial_categories (id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', is_active INTEGER NOT NULL DEFAULT 1, display_order INTEGER NOT NULL DEFAULT 0, created_by INTEGER, created_at TEXT, updated_at TEXT)");
  db.prepare("INSERT INTO memorial_categories (title) VALUES ('Solicitud de impulso')").run();
  addMemorialColumn(db); addMemorialColumn(db);
  assert.deepEqual(db.prepare("SELECT title, clause FROM memorial_categories").all().map((r) => ({ ...r })), [{ title: "Solicitud de impulso", clause: "" }]);
});
