// Version 2.2.58: consecutive numbers for contracts (from 2.326) and powers (from 10.222); footer with the user who generated the document.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import PizZip from "pizzip";
import { DOC_START, docKindOf, formatDocNumber, nextDocNumber } from "../src/doc-numbers.js";
import { startServer } from "./helpers.js";
import { startLink } from "./link-backend.js";

test("numbers start at 2.326 / 10.222, then follow; thousands dots", () => {
  assert.deepEqual(DOC_START, { contrato: 2326, poder: 10222 });
  assert.equal(nextDocNumber(null, "contrato"), 2326);
  assert.equal(nextDocNumber(2326, "contrato"), 2327);
  assert.equal(nextDocNumber(5, "poder"), 10222);
  assert.equal(formatDocNumber(10223), "10.223");
  assert.equal(formatDocNumber(2326), "2.326");
  assert.equal(docKindOf("Contrato"), "contrato");
  assert.equal(docKindOf("Poder"), "poder");
  assert.equal(docKindOf("Demanda"), "");
});

let srv, sides;
before(async () => {
  srv = await startServer();
  const admin = await srv.setup();
  const link = await startLink();
  await link.call("POST", "/auth/setup", { name: "Gerente General", email: "gerencia@firma.co" });
  sides = { server: admin.call, link: link.call };
});
after(() => srv.close());

test("server and link issue the same consecutive numbers, saved in the case or not", async () => {
  const out = {};
  for (const [name, call] of Object.entries(sides)) {
    const a = (await call("POST", "/doc-numbers", { kind: "contrato", template_name: "Contrato", action: "docx" })).body;
    const b = (await call("POST", "/doc-numbers", { kind: "contrato", action: "pdf" })).body;
    const p = (await call("POST", "/doc-numbers", { kind: "poder", action: "docx" })).body;
    const bad = await call("POST", "/doc-numbers", { kind: "demanda" });
    out[name] = [a.label, b.label, p.label, bad.status];
  }
  assert.deepEqual(out.server, ["2.326", "2.327", "10.222", 400]);
  assert.deepEqual(out.link, out.server);
});

// The footer names who generated the document.
const require = createRequire(import.meta.url);
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const win = (name) => ({ PizZip, docxtemplater: require("docxtemplater"), JuanmaGeneratedBy: () => name });
function load(name) {
  const window = win(name);
  vm.runInNewContext(readFileSync(new URL("../public/docx.js", import.meta.url), "utf8"), { window, atob, btoa });
  return window.JuanmaDocx;
}
function word({ footer }) {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("word/document.xml", `<w:document ${W} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>Contrato No.{{documento.numero}}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);
  zip.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  if (footer) zip.file("word/footer1.xml", `<w:ftr ${W}><w:p><w:r><w:t>Pie original</w:t></w:r></w:p></w:ftr>`);
  return zip.generate({ type: "uint8array" });
}
const files = async (blob) => new PizZip(new Uint8Array(await blob.arrayBuffer()));

test("the Word's own footer keeps its text and gets «Documento generado por»", async () => {
  const z = await files(load("Ana Torres").fillDocx(word({ footer: true }), { "documento.numero": "2.326" }));
  const f = z.file("word/footer1.xml").asText();
  assert.match(f, /Pie original/);
  assert.match(f, /Documento generado por: Ana Torres/);
  assert.match(z.file("word/document.xml").asText(), /Contrato No\.2\.326/);
});

test("a Word without footer gets one", async () => {
  const z = await files(load("Ana Torres").fillDocx(word({ footer: false }), { "documento.numero": "2.327" }));
  const names = Object.keys(z.files).filter((n) => /^word\/footer\d*\.xml$/.test(n));
  assert.equal(names.length, 1);
  assert.match(z.file(names[0]).asText(), /Documento generado por: Ana Torres/);
  assert.match(z.file("word/document.xml").asText(), /<w:footerReference/);
});

test("no user name: the document comes out as before", async () => {
  const z = await files(load("").fillDocx(word({ footer: true }), { "documento.numero": "1" }));
  assert.ok(!/generado por/.test(z.file("word/footer1.xml").asText()));
});

// Version 2.2.60: a minuta without the marker still shows the number at the top.
function plain() {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("word/document.xml", `<w:document ${W}><w:body><w:p><w:r><w:t>Texto</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generate({ type: "uint8array" });
}
test("a minuta without {{documento.numero}} gets «Contrato No. 2.326» at the top; with the marker it is not repeated", async () => {
  const D = load("Ana Torres");
  const a = (await files(D.fillDocx(plain(), { "documento.numero": "2.326", "documento.clase": "Contrato" }))).file("word/document.xml").asText();
  assert.match(a, /<w:body><w:p>.*Contrato No\. 2\.326/);
  const b = (await files(D.fillDocx(word({ footer: false }), { "documento.numero": "2.326", "documento.clase": "Contrato" }))).file("word/document.xml").asText();
  assert.equal(b.split("2.326").length - 1, 1);
  const c = (await files(D.fillDocx(plain(), { "documento.numero": "(se asigna al generar)" }))).file("word/document.xml").asText();
  assert.ok(!/No\. /.test(c));
});
