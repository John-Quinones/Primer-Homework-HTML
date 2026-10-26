// Version 2.2.47: «Clases de poder» of the power of attorney. Same mechanism as the contract objects, told apart by `kind`
// (CRUD, Gerencia-only, kinds never mix, clause merge into {{CLASES_DE_PODER}}, additive migration of the 2.2.46 tables).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import PizZip from "pizzip";
import { startServer } from "./helpers.js";
import { startLink } from "./link-backend.js";
import { asGlobal } from "../src/browser-module.js";
import { addKindColumns, CONTRACT_OBJECTS_SCHEMA } from "../src/contract-objects-routes.js";

const require = createRequire(import.meta.url);
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

test("CRUD of power classes: create, edit, order, deactivate, delete; same on the server and the link", async () => {
  const out = await same(async (call) => {
    const a = (await call("POST", "/power-classes", { title: " Poder para Proceso Ejecutivo ", description: "  Cobro de obligaciones ", content_template: "para que inicie proceso ejecutivo.\r\n\r\n\r\nY lo lleve hasta su terminación." })).body;
    const b = (await call("POST", "/power-classes", { title: "Poder Laboral", clause: "para que adelante el proceso ordinario laboral." })).body;
    const c = (await call("POST", "/power-classes", { title: "Poder de Familia", clause: "para que promueva proceso de familia." })).body;
    const dup = await call("POST", "/power-classes", { title: "poder  LABORAL", clause: "otra" });
    const empty = await call("POST", "/power-classes", { title: "Sin facultades", clause: " " });
    const long = await call("POST", "/power-classes", { title: "Larga", clause: "x", description: "d".repeat(301) });
    const edited = (await call("PUT", `/power-classes/${b.id}`, { title: "Poder Laboral Ordinario", description: "Laboral" })).body;
    const clash = await call("PUT", `/power-classes/${b.id}`, { title: "Poder de Familia" });
    const ordered = await call("PUT", "/power-classes/order", { ids: [c.id, a.id] });
    const badOrder = await call("PUT", "/power-classes/order", { ids: [c.id, c.id] });
    const off = (await call("PUT", `/power-classes/${a.id}`, { is_active: false })).body;
    const active = (await call("GET", "/power-classes")).body;
    const every = (await call("GET", "/power-classes?all=1")).body;
    const removed = await call("DELETE", `/power-classes/${c.id}`);
    const gone = await call("DELETE", `/power-classes/${c.id}`);
    return { a: strip([a]), dup: dup.status, empty: empty.status, long: long.status, edited: strip([edited]), clash: clash.status, ordered: [ordered.status, ordered.body.map((o) => o.title)],
      badOrder: badOrder.status, off: off.is_active, active: active.map((o) => o.title), every: every.map((o) => [o.title, o.is_active]), removed: [removed.status, { ...removed.body, id: 0 }], gone: gone.status };
  });
  assert.equal(out.a[0].clause, "para que inicie proceso ejecutivo.\n\nY lo lleve hasta su terminación.");
  assert.equal(out.a[0].title, "Poder para Proceso Ejecutivo");
  assert.equal(out.a[0].description, "Cobro de obligaciones");
  assert.equal(out.a[0].kind, "poder");
  assert.equal(out.a[0].display_order, 1);
  for (const k of ["dup", "empty", "long", "clash", "badOrder"]) assert.equal(out[k], 400, k);
  assert.deepEqual(out.ordered[1], ["Poder de Familia", "Poder para Proceso Ejecutivo", "Poder Laboral Ordinario"]);
  assert.deepEqual(out.active, ["Poder de Familia", "Poder Laboral Ordinario"]);
  assert.equal(out.every.length, 3);
  assert.equal(out.removed[1].deleted, true);
  assert.equal(out.gone, 404);
});

test("the two lists never mix: same title in both, ids of one are unknown to the other", async () => {
  const out = await same(async (call) => {
    const o = (await call("POST", "/contract-objects", { title: "Reintegro", clause: "Cláusula de contrato." })).body;
    const p = (await call("POST", "/power-classes", { title: "Reintegro", clause: "Facultades de poder." })).body;
    const cross = await call("PUT", `/power-classes/${o.id}`, { title: "Cambiado" });
    const crossDel = await call("DELETE", `/contract-objects/${p.id}`);
    const crossUse = await call("POST", "/power-classes/uses", { object_ids: [o.id] });
    return { cross: cross.status, crossDel: crossDel.status, crossUse: crossUse.status,
      contratos: (await call("GET", "/contract-objects")).body.map((x) => x.title), poderes: (await call("GET", "/power-classes")).body.map((x) => x.title).filter((t) => t === "Reintegro") };
  });
  assert.equal(out.cross, 404); assert.equal(out.crossDel, 404); assert.equal(out.crossUse, 400);
  assert.ok(out.contratos.includes("Reintegro"));
  assert.deepEqual(out.poderes, ["Reintegro"]);
});

test("uses are kept per generated power; one already used is only deactivated", async () => {
  const out = await same(async (call) => {
    const o1 = (await call("POST", "/power-classes", { title: "Uso Uno", clause: "Facultad uno." })).body;
    const o2 = (await call("POST", "/power-classes", { title: "Uso Dos", clause: "Facultad dos." })).body;
    const cl = (await call("POST", "/clients", { full_name: "Cliente Poder", id_number: "7002" })).body;
    const cat = (await call("GET", "/catalog")).body.categories?.[0] ?? (await call("GET", "/catalog")).body[0];
    const type = cat.types?.[0] ?? cat.children?.[0];
    const k = (await call("POST", "/cases", { client_id: cl.id, process_type_id: type.id, title: "Caso poder" })).body;
    const none = await call("POST", "/power-classes/uses", { object_ids: [], case_id: k.id });
    const rec = await call("POST", "/power-classes/uses", { object_ids: [o2.id, o1.id], case_id: k.id, action: "docx" });
    const read = (await call("GET", `/power-classes/uses?case_id=${k.id}`)).body;
    const contractRead = (await call("GET", `/contract-objects/uses?case_id=${k.id}`)).body;
    const del = await call("DELETE", `/power-classes/${o1.id}`);
    const after = (await call("GET", "/power-classes?all=1")).body.filter((o) => o.id === o1.id).map((o) => [o.is_active, o.uses]);
    return { none: none.status, rec: [rec.status, rec.body.objects.map((o) => o.title)], read: read.map((b) => [b.action, b.objects.map((o) => o.title)]), contractRead, del: { ...del.body, id: 0 }, after };
  });
  assert.equal(out.none, 400);
  assert.deepEqual(out.rec, [201, ["Uso Uno", "Uso Dos"]]);
  assert.deepEqual(out.read, [["docx", ["Uso Uno", "Uso Dos"]]]);
  assert.deepEqual(out.contractRead, [], "contract history does not show power classes");
  assert.deepEqual(out.del, { id: 0, deleted: false, deactivated: true });
  assert.deepEqual(out.after, [[false, 1]]);
});

test("RBAC: only Gerencia manages power classes; other roles read the active list; no permission to draft = no access", async () => {
  const o = (await admin.call("POST", "/power-classes", { title: "Solo Gerencia P", clause: "Texto P." })).body;
  const off = (await admin.call("POST", "/power-classes", { title: "Solo Gerencia Q", clause: "Texto Q.", is_active: false })).body;
  const mk = async (role, email) => {
    await admin.call("POST", "/admin/users", { name: role + " P", email, role, office_ids: [office], password: "tribunal-azul-2026" });
    const s = await srv.login(email, "tribunal-azul-2026");
    await s.call("POST", "/auth/password", { current: "tribunal-azul-2026", next: "tribunal-verde-2026" });
    return s;
  };
  const director = await mk("Director Jurídico", "dirpod@firma.co");
  const abogado = await mk("Abogado", "abopod@firma.co");
  const dep = await mk("Dependiente Judicial", "deppod@firma.co");
  for (const u of [director, abogado]) {
    const list = (await u.call("GET", "/power-classes?all=1")).body;
    assert.ok(list.some((x) => x.id === o.id));
    assert.ok(!list.some((x) => x.id === off.id), "inactive classes are not offered");
    assert.equal((await u.call("POST", "/power-classes", { title: "Intruso", clause: "x" })).status, 403);
    assert.equal((await u.call("PUT", `/power-classes/${o.id}`, { title: "Cambiado" })).status, 403);
    assert.equal((await u.call("PUT", "/power-classes/order", { ids: [o.id] })).status, 403);
    assert.equal((await u.call("DELETE", `/power-classes/${o.id}`)).status, 403);
    assert.equal((await u.call("POST", "/power-classes/uses", { object_ids: [off.id] })).status, 400);
  }
  assert.equal((await dep.call("GET", "/power-classes")).status, 403);
  assert.equal((await admin.call("GET", "/power-classes?all=1")).body.find((x) => x.id === o.id).title, "Solo Gerencia P");
});

test("migration: 2.2.46 tables with data get kind/description added, rows kept as contrato, nothing lost", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE contract_objects (id INTEGER PRIMARY KEY, title TEXT NOT NULL, clause TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, display_order INTEGER NOT NULL DEFAULT 0, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE contract_object_uses (id INTEGER PRIMARY KEY, batch TEXT NOT NULL, object_id INTEGER NOT NULL, object_title TEXT NOT NULL, case_id INTEGER, template_id INTEGER, document_id INTEGER, action TEXT NOT NULL DEFAULT '', created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  db.prepare("INSERT INTO contract_objects (title, clause, display_order) VALUES ('Reintegro', 'Cláusula real', 1)").run();
  db.prepare("INSERT INTO contract_object_uses (batch, object_id, object_title) VALUES ('b1', 1, 'Reintegro')").run();
  for (let i = 0; i < 2; i++) { db.exec(CONTRACT_OBJECTS_SCHEMA); addKindColumns(db); } // twice: harmless
  assert.deepEqual({ ...db.prepare("SELECT title, clause, kind, description FROM contract_objects").get() }, { title: "Reintegro", clause: "Cláusula real", kind: "contrato", description: "" });
  assert.equal(db.prepare("SELECT kind FROM contract_object_uses").get().kind, "contrato");
  db.close();
});

// ----- merging the powers into the Word -----
const window = { PizZip, docxtemplater: require("docxtemplater") };
vm.runInNewContext(readFileSync(new URL("../public/docx.js", import.meta.url), "utf8"), { window, atob, btoa });
const D = window.JuanmaDocx;
const CO = vm.runInNewContext(`${asGlobal(new URL("../src/contract-objects.js", import.meta.url).pathname, "X")}\nwindow.X`, { window: {} });
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
function word(paragraphs) {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("word/document.xml", `<w:document ${W}><w:body>${paragraphs.map((t) => `<w:p><w:r><w:rPr><w:rFonts w:ascii="Century Gothic"/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  return zip.generate({ type: "uint8array" });
}
const filled = async (bytes, data) => {
  const blob = D.fillDocx(bytes, data, { CLASES_DE_PODER: "Clases de poder" });
  const xml = new PizZip(new Uint8Array(await blob.arrayBuffer())).file("word/document.xml").asText();
  return { xml, lines: xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g).map((p) => p.replace(/<w:br\/>/g, "\n").replace(/<[^>]+>/g, "")) };
};
const tpl = word(["…Abogado en ejercicio, {{CLASES_DE_PODER}}", "En ejercicio del poder conferido, mi apoderado queda facultado para recibir."]);
const A = { id: 1, clause: "para que inicie proceso ejecutivo contra {{campo.Deudor}}." }, B = { id: 2, clause: "para que adelante proceso laboral." }, C = { id: 3, clause: "para que promueva proceso de familia.\n\nCon alimentos." };

test("power markers are known to the Word reader and the variable list", () => {
  assert.deepEqual([...CO.POWER_KEYS], ["CLASES_DE_PODER", "FACULTADES_ESPECIFICAS"]);
  assert.deepEqual([...D.docxVariables(tpl)], ["CLASES_DE_PODER"]);
});

test("merge: one class as written; several as A), B), C) in order; none leaves the missing mark; Word keeps paragraphs and font", async () => {
  assert.equal(CO.mergeObjects([B]), "para que adelante proceso laboral.");
  const text = CO.mergeObjects([A, B, C], { "campo.Deudor": "Pérez" });
  assert.equal(text, "\nA) para que inicie proceso ejecutivo contra Pérez.\n\nB) para que adelante proceso laboral.\n\nC) para que promueva proceso de familia.\nCon alimentos.");
  const one = await filled(tpl, { CLASES_DE_PODER: CO.mergeObjects([B]) });
  assert.deepEqual(one.lines, ["…Abogado en ejercicio, para que adelante proceso laboral.", "En ejercicio del poder conferido, mi apoderado queda facultado para recibir."]);
  const many = await filled(tpl, { CLASES_DE_PODER: text });
  assert.equal(many.lines.length, 2);
  assert.match(many.lines[0], /ejercicio, \nA\) para que inicie proceso ejecutivo contra Pérez\.\n\nB\) /);
  assert.ok(many.xml.includes("Century Gothic"));
  const none = await filled(tpl, {});
  assert.match(none.lines[0], /\[FILL: Clases de poder\]/);
  assert.ok(none.xml.includes('w:highlight w:val="yellow"'));
  const missing = await filled(tpl, { CLASES_DE_PODER: CO.mergeObjects([A]) });
  assert.ok(missing.xml.includes('w:highlight w:val="yellow"'), "a datum missing inside a class is highlighted");
});

test("a Poder Word without the marker: the marker goes in a new paragraph after the chosen one, with that paragraph's format", async () => {
  const plain = word(["Señores", "…Abogado en ejercicio, para que promueva el recurso.", "Respetuosamente,"]);
  assert.deepEqual([...D.docxParagraphs(plain).map((p) => p.index)], [0, 1, 2]);
  assert.deepEqual([...D.docxVariables(plain)], []);
  const withMarker = D.docxInsertParagraph(plain, 1, "CLASES_DE_PODER");
  assert.deepEqual([...D.docxVariables(withMarker)], ["CLASES_DE_PODER"]);
  const out = await filled(withMarker, { CLASES_DE_PODER: CO.mergeObjects([B]) });
  assert.deepEqual(out.lines, ["Señores", "…Abogado en ejercicio, para que promueva el recurso.", "para que adelante proceso laboral.", "Respetuosamente,"]);
  assert.ok(out.xml.includes("Century Gothic"));
  assert.throws(() => D.docxInsertParagraph(plain, 9, "CLASES_DE_PODER"));
});
