import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import PizZip from "pizzip";

const require = createRequire(import.meta.url);
const window = { PizZip, docxtemplater: require("docxtemplater") };
vm.runInNewContext(readFileSync(new URL("../public/docx.js", import.meta.url), "utf8"), { window, atob, btoa });
const D = window.JuanmaDocx;
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const RPR = '<w:rPr><w:rFonts w:ascii="Century Gothic"/><w:b/><w:sz w:val="24"/><w:u w:val="single"/></w:rPr>';
function word(body, header = "") {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>');
  zip.file("word/document.xml", `<w:document ${W}><w:body>${body}</w:body></w:document>`);
  if (header) zip.file("word/header1.xml", `<w:hdr ${W}>${header}</w:hdr>`);
  return zip.generate({ type: "uint8array" });
}
const part = async (blob, name = "word/document.xml") => new PizZip(new Uint8Array(await blob.arrayBuffer())).file(name).asText();

test("a missing datum is highlighted in yellow with the run's own font; filled data and the rest stay as they were", async () => {
  const bytes = word(`<w:p><w:r>${RPR}<w:t xml:space="preserve">Señora {{cliente.nombre|mayúsculas}}, hijo {{campo.Afiliado}} q.e.p.d.</w:t></w:r></w:p>`,
    `<w:p><w:r><w:t>Vs. {{destinatario.entidad}}</w:t></w:r></w:p>`);
  const out = D.fillDocx(bytes, { "cliente.nombre": "Gladys Vera" }, { "campo.Afiliado": "Nombre del afiliado", "destinatario.entidad": "Entidad" });
  const x = await part(out);
  assert.equal(x.replace(/<[^>]+>/g, ""), "Señora GLADYS VERA, hijo [FILL: Nombre del afiliado] q.e.p.d.");
  // Three runs: before, the highlighted gap (same font, bold, size; highlight before <w:u>), after.
  const runs = [...x.matchAll(/<w:r>([\s\S]*?)<\/w:r>/g)].map((m) => m[1]);
  assert.equal(runs.length, 3);
  assert.match(runs[1], /<w:rFonts w:ascii="Century Gothic"\/><w:b\/><w:sz w:val="24"\/><w:highlight w:val="yellow"\/><w:u w:val="single"\/>/);
  assert.match(runs[1], /\[FILL: Nombre del afiliado\]/);
  assert.ok(!/highlight/.test(runs[0] + runs[2]), "only the missing datum is highlighted");
  assert.ok(!x.includes("⁣"));
  // Headers too; a run without properties gets them.
  assert.match(await part(out, "word/header1.xml"), /<w:r><w:rPr><w:highlight w:val="yellow"\/><\/w:rPr><w:t xml:space="preserve">\[FILL: Entidad\]<\/w:t><\/w:r>/);
});

test("nothing missing: the Word comes out with no highlight added", async () => {
  const bytes = word(`<w:p><w:r>${RPR}<w:t>{{cliente.nombre}}</w:t></w:r></w:p>`);
  const x = await part(D.fillDocx(bytes, { "cliente.nombre": "Ana" }));
  assert.ok(!/highlight/.test(x));
  assert.equal(x.replace(/<[^>]+>/g, ""), "Ana");
});
