import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import PizZip from "pizzip";
import { startServer } from "./helpers.js";
import { fieldDocValue, cleanCaseFields, fieldTypeFor } from "../src/case-meta.js";

// The page's Word helpers, loaded as the browser loads them.
const require = createRequire(import.meta.url);
const window = { PizZip, docxtemplater: require("docxtemplater") };
vm.runInNewContext(readFileSync(new URL("../public/docx.js", import.meta.url), "utf8"), { window, atob, btoa });
const D = window.JuanmaDocx;
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
function word(paragraphs, header = "") {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  const p = (runs) => `<w:p>${runs.map((r) => `<w:r>${r.b ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${r.t}</w:t></w:r>`).join("")}</w:p>`;
  zip.file("word/document.xml", `<w:document ${W}><w:body>${paragraphs.map(p).join("")}</w:body></w:document>`);
  if (header) zip.file("word/header1.xml", `<w:hdr ${W}>${p([{ t: header }])}</w:hdr>`);
  return zip.generate({ type: "uint8array" });
}
const text = (bytes, part = "word/document.xml") => new PizZip(bytes).file(part).asText().replace(/<[^>]+>/g, "");

test("a minuta written with a client's data: the data become markers, also split across runs and in the header", () => {
  const bytes = word([
    [{ t: "Ibagué, 16 de octubre de 2026" }],
    [{ t: "la señora " }, { t: "GLADYS VERA", b: true }, { t: " MORALES", b: true }, { t: " CC. No.65.760.174 de Ibagué, hijo EDWIN ALBERTO RUBIANO VERA." }],
    [{ t: "Fallecido el 21 de abril de 2026; la señora Gladys Vera Morales pide." }],
  ], "Solicitud de GLADYS VERA MORALES Vs. COLFONDOS");
  const data = { "cliente.nombre": "Gladys Vera Morales", "cliente.documento": "65760174", "cliente.ciudad": "Ibagué" };
  const wanted = D.caseTexts(data);
  assert.ok(!wanted.some((w) => w.key === "cliente.ciudad"), "a city is too common to look for");
  const found = D.docxFind(bytes, wanted.map((w) => w.text));
  const name = found.find((f) => f.text === "Gladys Vera Morales");
  assert.equal(name.count, 3);
  assert.deepEqual([...name.as].sort(), ["GLADYS VERA MORALES", "Gladys Vera Morales"]);
  assert.equal(found.find((f) => f.text === "65.760.174").count, 1);
  assert.deepEqual([...D.docxDates(bytes)], ["Ibagué, 16 de octubre de 2026", "21 de abril de 2026"]);
  const items = [
    ...name.as.map((as) => ({ text: as, marker: D.markerFor("cliente.nombre", as) })),
    { text: "65.760.174", marker: "cliente.documento|puntos" },
    { text: "Ibagué, 16 de octubre de 2026", marker: "fecha.ciudad_y_fecha" },
    { text: "EDWIN ALBERTO RUBIANO VERA", marker: "campo.Nombres y apellidos del afiliado fallecido|mayúsculas" },
    { text: "21 de abril de 2026", marker: "campo.Fecha del fallecimiento" },
  ];
  const r = D.docxReplace(bytes, items);
  assert.equal(r.count, 7);
  assert.match(text(r.bytes), /la señora \{\{cliente\.nombre\|mayúsculas\}\} CC\. No\.\{\{cliente\.documento\|puntos\}\} de Ibagué/);
  assert.match(text(r.bytes, "word/header1.xml"), /Solicitud de \{\{cliente\.nombre\|mayúsculas\}\} Vs\./);
  // The bold of the name stays: the marker sits in the run where the name started.
  assert.match(new PizZip(r.bytes).file("word/document.xml").asText(), /<w:b\/><\/w:rPr><w:t xml:space="preserve">\{\{cliente\.nombre\|mayúsculas\}\}/);
  assert.deepEqual([...D.docxVariables(r.bytes)].sort(), ["campo.Fecha del fallecimiento", "campo.Nombres y apellidos del afiliado fallecido", "cliente.documento", "cliente.nombre", "fecha.ciudad_y_fecha"].sort());
});

test("formats: capitals and dotted numbers; text templates too", async () => {
  const bytes = word([[{ t: "{{cliente.nombre|mayúsculas}} C.C. {{cliente.documento|puntos}} y {{campo.X}}" }]]);
  const out = new Uint8Array(await D.fillDocx(bytes, { "cliente.nombre": "Gladys Vera Morales", "cliente.documento": "65760174" }).arrayBuffer());
  assert.equal(text(out), "GLADYS VERA MORALES C.C. 65.760.174 y [FILL: campo.X]");
  assert.equal(D.fillText("{{cliente.documento|puntos}} {{cliente.nombre}}", { "cliente.documento": "1110513105" }, { "cliente.nombre": "Nombre" }), "1.110.513.105 [FILL: Nombre]");
  assert.deepEqual([...D.textVariables("{{a|mayúsculas}} {{a}} {{b|puntos}}")], ["a", "b"]);
});

test("helpers for the minuta's own data", () => {
  assert.equal(fieldTypeFor("Fecha del fallecimiento"), "date");
  assert.equal(fieldTypeFor("Nombres y apellidos del afiliado fallecido"), "text");
  assert.equal(fieldDocValue({ field_type: "date" }, "2026-04-21"), "21 de abril de 2026");
  assert.equal(fieldDocValue({ field_type: "text" }, "2026-04-21"), "2026-04-21");
  assert.equal(typeof cleanCaseFields([{ label: "Fecha del fallecimiento", value: "21/04/2026" }]), "string");
  assert.equal(typeof cleanCaseFields([{ label: "a {{b}}", value: "x" }]), "string");
});

let srv, admin, office, caseId, catId;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  office = (await admin.call("GET", "/admin/offices")).body[0].id;
  const cat = (await admin.call("POST", "/categories", { name: "Pensión de Sobreviviente" })).body;
  catId = cat.id;
  const type = (await admin.call("POST", `/categories/${cat.id}/types`, { name: "Pensión de Sobreviviente" })).body;
  const cl = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Ana", last_names: "Prueba Local", id_type: "CC", id_number: "1234567", office_id: office })).body;
  caseId = (await admin.call("POST", "/cases", { client_id: cl.id, process_type_id: type.id, counterparty: "Fondo de prueba", office_id: office })).body.id;
});
after(() => srv.close());

test("the minuta's own data are kept in the case; only Gerencia adds a field the type lacks", async () => {
  const fields = [{ label: "Nombres y apellidos del afiliado fallecido", value: "Pedro Prueba" }, { label: "Fecha del fallecimiento", value: "2026-04-21" }];
  await admin.call("POST", "/admin/users", { name: "Asistente Minutas", email: "asis@firma.co", role: "Director Jurídico", office_ids: [office],
    password: "tribunal-azul-2026", custom_permissions: true, permissions: ["cases.write", "cases.read", "drafts.generate", "clients.read"] });
  const a = await srv.login("asis@firma.co", "tribunal-azul-2026");
  await a.call("POST", "/auth/password", { current: "tribunal-azul-2026", next: "tribunal-verde-2026" });
  const refused = await a.call("PUT", `/cases/${caseId}/fields`, { fields });
  assert.equal(refused.status, 403);
  assert.match(refused.body.error, /Solo Gerencia/);
  const r = await admin.call("PUT", `/cases/${caseId}/fields`, { fields });
  assert.equal(r.status, 200);
  const cat = (await admin.call("GET", "/catalog")).body.find((c) => c.id === catId);
  const date = cat.fields.find((f) => f.label === "Fecha del fallecimiento");
  assert.equal(date.field_type, "date");
  const data = (await admin.call("GET", `/templates/data?caseId=${caseId}`)).body;
  assert.equal(data["campo.Fecha del fallecimiento"], "21 de abril de 2026");
  assert.equal(data["campo.Nombres y apellidos del afiliado fallecido"], "Pedro Prueba");
  // With the fields in place, whoever edits cases fills them; nothing else of the case changes.
  const ok = await a.call("PUT", `/cases/${caseId}/fields`, { fields: [{ label: "nombres y apellidos del afiliado FALLECIDO", value: "Pedro Pablo Prueba" }] });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.counterparty, "Fondo de prueba");
  assert.equal(Object.keys(ok.body.field_values).length, 2);
  assert.equal((await admin.call("GET", "/catalog")).body.find((c) => c.id === catId).fields.length, 2, "no duplicated field");
  assert.equal((await admin.call("PUT", `/cases/${caseId}/fields`, { fields: [{ label: "Fecha del fallecimiento", value: "ayer" }] })).status, 400);
});
