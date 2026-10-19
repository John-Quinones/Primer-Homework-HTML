import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import PizZip from "pizzip";

// The page's Word helpers, loaded as the browser loads them.
const require = createRequire(import.meta.url);
const window = { PizZip, docxtemplater: require("docxtemplater") };
vm.runInNewContext(readFileSync(new URL("../public/docx.js", import.meta.url), "utf8"), { window, atob, btoa });
const D = window.JuanmaDocx;
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
function word(paragraphs) {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("word/document.xml", `<w:document ${W}><w:body>${paragraphs.map((t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  return zip.generate({ type: "uint8array" });
}
const lines = async (blob) => {
  const xml = new PizZip(new Uint8Array(await blob.arrayBuffer())).file("word/document.xml").asText();
  return xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g).map((p) => p.replace(/<w:br\/>/g, "\n").replace(/<[^>]+>/g, ""));
};

// The poder ante la Fiscalía (version 2.46): radicado, fiscalía and e-mail are optional passages.
const poder = word([
  "Señores",
  "FISCALÍA GENERAL DE LA NACIÓN",
  "{{#campo.Despacho fiscal}}",
  "{{campo.Despacho fiscal|líneas}}",
  "{{/campo.Despacho fiscal}}",
  "Ciudad.",
  "Ref.: Poder.{{#campo.Radicado proceso penal}} Proceso penal radicado No. {{campo.Radicado proceso penal}}.{{/campo.Radicado proceso penal}}",
  "{{cliente.nombre|mayúsculas}} recibe notificaciones en el móvil No.{{cliente.telefono}}{{#campo.Correo para notificaciones}} y al correo electrónico {{campo.Correo para notificaciones}}{{/campo.Correo para notificaciones}}. Para su aceptación",
]);

test("optional passages: listed once as plain data, and known as optional", () => {
  assert.deepEqual([...D.docxVariables(poder)], ["campo.Despacho fiscal", "campo.Radicado proceso penal", "cliente.nombre", "cliente.telefono", "campo.Correo para notificaciones"]);
  assert.deepEqual([...D.docxOptional(poder)].sort(), ["campo.Correo para notificaciones", "campo.Despacho fiscal", "campo.Radicado proceso penal"]);
  assert.deepEqual([...D.docxLineVars(poder)], ["campo.Despacho fiscal"]);
});

test("optional passages left empty disappear, with no [FILL] and no empty line", async () => {
  const out = await lines(D.fillDocx(poder, { "cliente.nombre": "Gladys Vera Morales", "cliente.telefono": "322 253 1327" }));
  assert.deepEqual(out, ["Señores", "FISCALÍA GENERAL DE LA NACIÓN", "Ciudad.", "Ref.: Poder.",
    "GLADYS VERA MORALES recibe notificaciones en el móvil No.322 253 1327. Para su aceptación"]);
});

test("optional passages with their data are printed; «;» puts each fiscalía on its own line", async () => {
  const out = await lines(D.fillDocx(poder, {
    "cliente.nombre": "Gladys Vera Morales", "cliente.telefono": "322 253 1327",
    "campo.Despacho fiscal": "FISCALÍA 60 LOCAL ESPINAL; FISCALÍA 11 SECCIONAL DE VIDA DE IBAGUÉ",
    "campo.Radicado proceso penal": "730016000450202600123", "campo.Correo para notificaciones": "correo@ejemplo.com",
  }));
  assert.equal(out[2], "FISCALÍA 60 LOCAL ESPINAL\nFISCALÍA 11 SECCIONAL DE VIDA DE IBAGUÉ");
  assert.equal(out[4], "Ref.: Poder. Proceso penal radicado No. 730016000450202600123.");
  assert.match(out[5], /No\.322 253 1327 y al correo electrónico correo@ejemplo\.com\. Para su aceptación$/);
});

test("a required datum that is missing still shows [FILL: …]", async () => {
  const out = await lines(D.fillDocx(poder, {}));
  assert.match(out.at(-1), /^\[FILL: cliente\.nombre\] recibe notificaciones en el móvil No\.\[FILL: cliente\.telefono\]\. Para/);
});

// Version 2.48: Word made the e-mail a link; an empty optional passage ending inside it broke the file.
test("an optional passage that ends inside a Word link gives a valid file", async () => {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("word/document.xml", `<w:document ${W} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p>`
    + '<w:r><w:t xml:space="preserve">móvil No.322{{#campo.Correo}} y al correo </w:t></w:r>'
    + '<w:hyperlink r:id="rId9"><w:r><w:t>{{campo.Correo}}{{/campo.Correo}}</w:t></w:r></w:hyperlink>'
    + '<w:r><w:t xml:space="preserve">. Para</w:t></w:r></w:p></w:body></w:document>');
  const bytes = zip.generate({ type: "uint8array" });
  for (const data of [{}, { "campo.Correo": "a@b.co" }]) {
    const xml = new PizZip(new Uint8Array(await D.fillDocx(bytes, data).arrayBuffer())).file("word/document.xml").asText();
    const stack = [];
    for (const t of xml.matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) if (!t[3]) { if (!t[1]) stack.push(t[2]); else assert.equal(stack.pop(), t[2]); }
    assert.equal(stack.length, 0);
    assert.equal(xml.replace(/<[^>]+>/g, ""), data["campo.Correo"] ? "móvil No.322 y al correo a@b.co. Para" : "móvil No.322. Para");
  }
});
