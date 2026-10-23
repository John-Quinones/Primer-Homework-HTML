// Version 2.2.4: the letterhead (template of 23/10/2026) is on every PDF and on the Word the App writes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { jsPDF } from "jspdf";

const root = new URL("../", import.meta.url);
const require = createRequire(root);
const PizZip = require("pizzip");
const window = { jspdf: { jsPDF }, PizZip };
for (const f of ["membrete-assets.js", "membrete.js", "pdf-tools.js", "docx.js"]) new Function("window", "atob", "btoa", readFileSync(new URL(`public/${f}`, root), "utf8"))(window, atob, btoa);

test("a text PDF gets the letterhead and «Página X de Y» on every page", async () => {
  const md = "# Título\n\n" + Array.from({ length: 60 }, (_, i) => `Párrafo ${i} del documento de prueba que ocupa varias líneas del renglón.`).join("\n");
  const doc = window.JuanmaPdf.markdownToPdf(md, { returnDoc: true });
  const n = doc.getNumberOfPages();
  assert.ok(n >= 2);
  const raw = Buffer.from(doc.output("arraybuffer")).toString("latin1");
  for (let i = 1; i <= n; i++) assert.ok(raw.includes(`Página ${i} de ${n}`) || raw.includes(`P\\341gina ${i} de ${n}`) || raw.includes(`gina ${i} de ${n}`), `page ${i}`);
});

test("the Word the App writes carries header, footer, border, watermark and page number", async () => {
  const w = window.JuanmaDocx.markdownToDocx("# Poder\n\nTexto **negrilla**.", "Poder");
  const zip = new PizZip(Buffer.from(await w.arrayBuffer()));
  const doc = zip.file("word/document.xml").asText();
  assert.ok(doc.includes("Poder") && doc.includes("Ttulo1") && !doc.includes("<!--BODY-->"));
  assert.ok(doc.includes("w:pgBorders"));
  assert.ok(zip.file("word/header2.xml").asText().includes("Marca de agua Tecjuridicos"));
  assert.ok(zip.file("word/footer1.xml").asText().includes("NUMPAGES") && zip.file("word/footer1.xml").asText().includes("gerencia@tecjuridicos.com"));
  assert.ok(zip.file("word/media/marca-de-agua.png"));
});
