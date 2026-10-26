// Version 2.2.57: «el / al / del PODERDANTE» of the services contract follows the client's gender.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import PizZip from "pizzip";
import { genderWords } from "../src/case-meta.js";

const require = createRequire(import.meta.url);
const sandbox = { window: {}, TextEncoder, TextDecoder };
sandbox.window.PizZip = PizZip; sandbox.window.docxtemplater = require("docxtemplater");
vm.runInNewContext(readFileSync(new URL("../public/docx.js", import.meta.url), "utf8"), { ...sandbox, document: undefined, self: sandbox.window }, {});
const D = sandbox.window.JuanmaDocx;

function word(text) {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("word/document.xml", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generate({ type: "uint8array" });
}

test("«al» and «del» words by gender", () => {
  assert.deepEqual([genderWords("hombre")["cliente.al"], genderWords("hombre")["cliente.del"]], ["al", "del"]);
  assert.deepEqual([genderWords("mujer")["cliente.al"], genderWords("mujer")["cliente.del"]], ["a la", "de la"]);
});

test("finds the articles before PODERDANTE, skips words already inside a marker, and the Word follows the gender", async () => {
  const bytes = word("EL PODERDANTE y del Poderdante; entregar al PODERDANTE. {{cliente.identificado}} como aparece.");
  const found = D.docxGenderWords(bytes, []);
  assert.deepEqual([...found.map((x) => x.marker)], ["cliente.el|mayúsculas", "cliente.del", "cliente.al"]);
  const { bytes: out } = D.docxReplaceAt(bytes, found);
  const text = async (g) => new PizZip(new Uint8Array(await D.fillDocx(out, { ...genderWords(g) }).arrayBuffer())).file("word/document.xml").asText().replace(/<[^>]+>/g, "");
  assert.equal(await text("mujer"), "LA PODERDANTE y de la Poderdante; entregar a la PODERDANTE. identificada como aparece.");
  assert.equal(await text("hombre"), "EL PODERDANTE y del Poderdante; entregar al PODERDANTE. identificado como aparece.");
});
