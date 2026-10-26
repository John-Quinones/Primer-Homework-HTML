// Version 2.2.46: «Objetos contractuales» of the services contract (CRUD, Gerencia-only, clause merge into the Word).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import PizZip from "pizzip";
import { startServer } from "./helpers.js";
import { startLink } from "./link-backend.js";
import { asGlobal } from "../src/browser-module.js";

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

test("CRUD: create, edit, order, deactivate, same on the server and the link", async () => {
  const out = await same(async (call) => {
    const a = (await call("POST", "/contract-objects", { title: "  Reintegro laboral ", clause: "Obtener el reintegro del PODERDANTE.\r\n\r\n\r\nCon pago de salarios." })).body;
    const b = (await call("POST", "/contract-objects", { title: "Proceso ejecutivo", clause: "Cobrar la obligación." })).body;
    const c = (await call("POST", "/contract-objects", { title: "Demanda laboral", clause: "Reclamar prestaciones." })).body;
    const dup = await call("POST", "/contract-objects", { title: "reintegro  LABORAL", clause: "otra" });
    const empty = await call("POST", "/contract-objects", { title: "Sin cláusula", clause: "  " });
    const edited = (await call("PUT", `/contract-objects/${b.id}`, { title: "Proceso ejecutivo laboral" })).body;
    const clash = await call("PUT", `/contract-objects/${b.id}`, { title: "Demanda laboral" });
    const ordered = await call("PUT", "/contract-objects/order", { ids: [c.id, a.id] });
    const badOrder = await call("PUT", "/contract-objects/order", { ids: [c.id, c.id] });
    const off = (await call("PUT", `/contract-objects/${a.id}`, { is_active: false })).body;
    const active = (await call("GET", "/contract-objects")).body;
    const every = (await call("GET", "/contract-objects?all=1")).body;
    const removed = await call("DELETE", `/contract-objects/${c.id}`);
    const gone = await call("DELETE", `/contract-objects/${c.id}`);
    return { a: strip([a]), dup: dup.status, empty: empty.status, edited: strip([edited]), clash: clash.status, ordered: [ordered.status, ordered.body.map((o) => o.title)],
      badOrder: badOrder.status, off: off.is_active, active: active.map((o) => o.title), every: every.map((o) => [o.title, o.is_active]), removed: [removed.status, { ...removed.body, id: 0 }], gone: gone.status };
  });
  assert.equal(out.a[0].clause, "Obtener el reintegro del PODERDANTE.\n\nCon pago de salarios.");
  assert.equal(out.a[0].title, "Reintegro laboral");
  assert.equal(out.a[0].display_order, 1);
  assert.equal(out.dup, 400); assert.equal(out.empty, 400); assert.equal(out.clash, 400); assert.equal(out.badOrder, 400);
  assert.deepEqual(out.ordered[1], ["Demanda laboral", "Reintegro laboral", "Proceso ejecutivo laboral"]);
  assert.deepEqual(out.active, ["Demanda laboral", "Proceso ejecutivo laboral"]);
  assert.equal(out.every.length, 3);
  assert.equal(out.removed[1].deleted, true);
  assert.equal(out.gone, 404);
});

test("uses are recorded per generated contract; an object already used is only deactivated, never lost", async () => {
  const out = await same(async (call) => {
    const o1 = (await call("POST", "/contract-objects", { title: "Uno U", clause: "Cláusula uno." })).body;
    const o2 = (await call("POST", "/contract-objects", { title: "Dos U", clause: "Cláusula dos." })).body;
    const cl = (await call("POST", "/clients", { full_name: "Cliente Usos", id_number: "7001" })).body;
    const cat = (await call("GET", "/catalog")).body.categories?.[0] ?? (await call("GET", "/catalog")).body[0];
    const type = cat.types?.[0] ?? cat.children?.[0];
    const k = (await call("POST", "/cases", { client_id: cl.id, process_type_id: type.id, title: "Caso usos" })).body;
    const none = await call("POST", "/contract-objects/uses", { object_ids: [], case_id: k.id });
    const rec = await call("POST", "/contract-objects/uses", { object_ids: [o2.id, o1.id], case_id: k.id, action: "save", template_id: 1 });
    const unknown = await call("POST", "/contract-objects/uses", { object_ids: [999999999] });
    const read = (await call("GET", `/contract-objects/uses?case_id=${k.id}`)).body;
    const del = await call("DELETE", `/contract-objects/${o1.id}`);
    const after = (await call("GET", "/contract-objects?all=1")).body.filter((o) => o.id === o1.id).map((o) => [o.is_active, o.uses]);
    const blocked = await call("POST", "/contract-objects/uses", { object_ids: [o1.id], case_id: k.id });
    return { none: none.status, rec: [rec.status, rec.body.objects.map((o) => o.title)], unknown: unknown.status, read: read.map((b) => [b.action, b.objects.map((o) => o.title)]),
      del: { ...del.body, id: 0 }, after, blocked: blocked.status };
  });
  assert.equal(out.none, 400); assert.equal(out.unknown, 400);
  assert.deepEqual(out.rec, [201, ["Uno U", "Dos U"]]);
  assert.deepEqual(out.read, [["save", ["Uno U", "Dos U"]]]);
  assert.deepEqual(out.del, { id: 0, deleted: false, deactivated: true });
  assert.deepEqual(out.after, [[false, 1]]);
  assert.equal(out.blocked, 400);
});

test("RBAC: only Gerencia manages; other roles (even with templates.manage) only read the active list", async () => {
  const o = (await admin.call("POST", "/contract-objects", { title: "Solo Gerencia A", clause: "Texto A." })).body;
  const off = (await admin.call("POST", "/contract-objects", { title: "Solo Gerencia B", clause: "Texto B.", is_active: false })).body;
  const mk = async (role, email, extra = {}) => {
    await admin.call("POST", "/admin/users", { name: role + " X", email, role, office_ids: [office], password: "tribunal-azul-2026", ...extra });
    const s = await srv.login(email, "tribunal-azul-2026");
    await s.call("POST", "/auth/password", { current: "tribunal-azul-2026", next: "tribunal-verde-2026" });
    return s;
  };
  const director = await mk("Director Jurídico", "dirobj@firma.co");
  const abogado = await mk("Abogado", "aboobj@firma.co");
  const dep = await mk("Dependiente Judicial", "depobj@firma.co");
  for (const u of [director, abogado]) {
    const list = (await u.call("GET", "/contract-objects?all=1")).body;
    assert.ok(list.some((x) => x.id === o.id));
    assert.ok(!list.some((x) => x.id === off.id), "inactive objects are not offered");
    assert.equal((await u.call("POST", "/contract-objects", { title: "Intruso", clause: "x" })).status, 403);
    assert.equal((await u.call("PUT", `/contract-objects/${o.id}`, { title: "Cambiado" })).status, 403);
    assert.equal((await u.call("PUT", "/contract-objects/order", { ids: [o.id] })).status, 403);
    assert.equal((await u.call("DELETE", `/contract-objects/${o.id}`)).status, 403);
    assert.equal((await u.call("POST", "/contract-objects/uses", { object_ids: [off.id] })).status, 400);
  }
  assert.equal((await dep.call("GET", "/contract-objects")).status, 403, "no permission to draft documents");
  assert.equal((await admin.call("GET", `/contract-objects?all=1`)).body.find((x) => x.id === o.id).title, "Solo Gerencia A");
});

// ----- merging the clauses into the Word -----
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
  const blob = D.fillDocx(bytes, data, { OBJETOS_CONTRACTUALES: "Objetos contractuales" });
  const xml = new PizZip(new Uint8Array(await blob.arrayBuffer())).file("word/document.xml").asText();
  return { xml, lines: xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g).map((p) => p.replace(/<w:br\/>/g, "\n").replace(/<[^>]+>/g, "")) };
};
const tpl = word(["PRIMERA: El presente contrato tiene por objeto: {{OBJETOS_CONTRACTUALES}}", "SEGUNDA: otra."]);
const A = { id: 1, clause: "Obtener el reintegro de {{cliente.nombre}}." }, B = { id: 2, clause: "Cobrar la obligación." }, C = { id: 3, clause: "Reclamar prestaciones.\n\nCon indexación." };

test("merge: one clause as written; several as A), B), C) in order; nothing ticked leaves it empty", () => {
  assert.equal(CO.mergeObjects([B]), "Cobrar la obligación.");
  assert.equal(CO.mergeObjects([A, B, C], { "cliente.nombre": "Ana" }), "\nA) Obtener el reintegro de Ana.\n\nB) Cobrar la obligación.\n\nC) Reclamar prestaciones.\nCon indexación.");
  assert.equal(CO.mergeObjects([]), "");
  assert.match(CO.mergeObjects([A]), /\[FILL: cliente\.nombre\]/);
});

test("the Word keeps its paragraphs and font; the ticked clauses land at the marker; unticked shows the missing mark", async () => {
  assert.deepEqual([...D.docxVariables(tpl)], ["OBJETOS_CONTRACTUALES"]);
  const one = await filled(tpl, { OBJETOS_CONTRACTUALES: CO.mergeObjects([B]) });
  assert.deepEqual(one.lines, ["PRIMERA: El presente contrato tiene por objeto: Cobrar la obligación.", "SEGUNDA: otra."]);
  const many = await filled(tpl, { OBJETOS_CONTRACTUALES: CO.mergeObjects([A, B], { "cliente.nombre": "Ana" }) });
  assert.equal(many.lines.length, 2, "same paragraphs, clauses separated by line breaks");
  assert.match(many.lines[0], /objeto: \nA\) Obtener el reintegro de Ana\.\n\nB\) Cobrar la obligación\.$/);
  assert.ok(many.xml.includes("Century Gothic"));
  const none = await filled(tpl, {});
  assert.match(none.lines[0], /\[FILL: Objetos contractuales\]/);
  assert.ok(none.xml.includes('w:highlight w:val="yellow"'));
  const missing = await filled(tpl, { OBJETOS_CONTRACTUALES: CO.mergeObjects([A]) });
  assert.ok(missing.xml.includes('w:highlight w:val="yellow"'), "a datum missing inside a clause is highlighted too");
});
