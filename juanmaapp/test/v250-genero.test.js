import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import PizZip from "pizzip";
import { startServer } from "./helpers.js";
import { normGender, genderWords, guessGender, GENDER_KEYS } from "../src/case-meta.js";

// The page's Word helpers, loaded as the browser loads them.
const require = createRequire(import.meta.url);
const window = { PizZip, docxtemplater: require("docxtemplater") };
vm.runInNewContext(readFileSync(new URL("../public/docx.js", import.meta.url), "utf8"), { window, atob, btoa });
const D = window.JuanmaDocx;
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
function word(paragraphs) {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  // each paragraph is a list of runs, so a word can be split across runs like Word does
  zip.file("word/document.xml", `<w:document ${W}><w:body>${paragraphs.map((runs) => `<w:p>${runs.map((t) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`).join("")}</w:p>`).join("")}</w:body></w:document>`);
  return zip.generate({ type: "uint8array" });
}
const text = async (blob) => new PizZip(new Uint8Array(await blob.arrayBuffer())).file("word/document.xml").asText().replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").trim().split("\n");

test("gender words: hombre and mujer, anything else leaves them to be completed", () => {
  assert.deepEqual(["Hombre", "hombre", "M", "H", "Masculino"].map(normGender), Array(5).fill("hombre"));
  assert.deepEqual(["Mujer", "mujer", "F", "femenino"].map(normGender), Array(4).fill("mujer"));
  assert.equal(normGender("otro"), "");
  assert.deepEqual(genderWords(""), {});
  const m = genderWords("Hombre"), f = genderWords("mujer");
  assert.deepEqual([m["cliente.suscrito"], m["cliente.identificado"], m["cliente.domiciliado"]], ["el suscrito", "identificado", "domiciliado"]);
  assert.deepEqual([f["cliente.suscrito"], f["cliente.identificado"], f["cliente.domiciliado"]], ["la suscrita", "identificada", "domiciliada"]);
  for (const k of GENDER_KEYS) assert.ok(m[k] && f[k], k);
});

test("the name only suggests a gender", () => {
  assert.deepEqual(["Gladys Vera", "Carmen", "Dayana", "John Fredy", "Edwin", "José Luis", "Matías"].map(guessGender),
    ["mujer", "mujer", "mujer", "hombre", "hombre", "hombre", "hombre"]);
  assert.equal(guessGender(""), "");
});

// The poder of the firm: the client's words follow the gender, the lawyer's «identificado» does not.
const poder = word([
  ["GLADYS VERA MORALES, mayor de edad, ", "domiciliada y residente en Ibagué (Tolima), identificad", "a", " civilmente, confiero poder al Dr. JOHN QUIÑONES identificado con la cédula No.17.418.999."],
  ["Sírvase reconocerle personería. ", "La", " suscrit", "a", " recibe notificaciones en el móvil."],
  ["LA SUSCRITA y la suscrita; el suscrito, identificado(a) con y domiciliado/a en."],
  ["Que se reconozca a favor de mi poderdante, ", "señor", "a", " Gladys Vera, y de mi poderdante, Señor(a) X, el pago."],
  ["El señor Pedro murió; la ", "señor", "a {{cliente.nombre}} y mi poderdante, la señora Z."],
]);

test("finds the gendered words once each, split across runs, with the lawyer's left unmarked", () => {
  const g = [...D.docxGenderWords(poder, ["John Quiñones"])];
  assert.deepEqual([...g.map((x) => x.text)], ["domiciliada", "identificada", "identificado", "La suscrita", "LA SUSCRITA", "la suscrita", "el suscrito", "identificado(a)", "domiciliado/a", "señora", "Señor(a)", "la señora", "la señora"]);
  assert.deepEqual([...g.map((x) => x.client)], [true, true, false, true, true, true, true, true, true, true, true, true, true]);
  assert.deepEqual([...g.map((x) => x.marker)], ["cliente.domiciliado", "cliente.identificado", "cliente.identificado", "cliente.suscrito|inicial",
    "cliente.suscrito|mayúsculas", "cliente.suscrito", "cliente.suscrito", "cliente.identificado", "cliente.domiciliado", "cliente.senor", "cliente.senor|inicial", "cliente.el_senor", "cliente.el_senor"]);
});

test("the Word is prepared once and then follows each client's gender", async () => {
  const g = D.docxGenderWords(poder, ["John Quiñones"]);
  const { bytes, count } = D.docxReplaceAt(poder, g.filter((x) => x.client));
  assert.equal(count, 12);
  const base = { "cliente.nombre": "x" };
  const hombre = await text(D.fillDocx(bytes, { ...base, ...genderWords("hombre") }));
  const mujer = await text(D.fillDocx(bytes, { ...base, ...genderWords("mujer") }));
  assert.equal(hombre[0], "GLADYS VERA MORALES, mayor de edad, domiciliado y residente en Ibagué (Tolima), identificado civilmente, confiero poder al Dr. JOHN QUIÑONES identificado con la cédula No.17.418.999.");
  assert.equal(mujer[0], hombre[0].replace("domiciliado", "domiciliada").replace("identificado civ", "identificada civ"));
  assert.equal(hombre[1], "Sírvase reconocerle personería. El suscrito recibe notificaciones en el móvil.");
  assert.equal(mujer[1], "Sírvase reconocerle personería. La suscrita recibe notificaciones en el móvil.");
  assert.equal(mujer[2], "LA SUSCRITA y la suscrita; la suscrita, identificada con y domiciliada en.");
  assert.equal(hombre[3], "Que se reconozca a favor de mi poderdante, señor Gladys Vera, y de mi poderdante, Señor X, el pago.");
  assert.equal(mujer[3], "Que se reconozca a favor de mi poderdante, señora Gladys Vera, y de mi poderdante, Señora X, el pago.");
  // gender not known: the datum is asked for, the words are not guessed
  assert.match((await text(D.fillDocx(bytes, base, { "cliente.suscrito": "Género del cliente" })))[1], /\[FILL: Género del cliente\] recibe/);
});

let srv, admin, caseId, clientId;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  const lab = (await admin.call("GET", "/catalog")).body.find((c) => c.name === "Laboral");
  const cl = (await admin.call("POST", "/clients", { full_name: "Gladys Vera Morales", id_type: "CC", id_number: "65760174" })).body;
  clientId = cl.id;
  caseId = (await admin.call("POST", "/cases", { client_id: cl.id, process_type_id: lab.types[0].id })).body.id;
});
after(() => srv.close());

test("the client's gender is saved, changed alone, and feeds the documents", async () => {
  // Version 2.53 (user's rule): without a gender, the first name gives it («Gladys» → mujer).
  assert.equal((await admin.call("GET", `/clients/${clientId}`)).body.gender, "mujer", "the gender comes from the first name");
  const put = await admin.call("PUT", `/clients/${clientId}`, { gender: "Mujer" });
  assert.equal(put.status, 200);
  assert.equal(put.body.gender, "mujer");
  assert.equal(put.body.full_name, "Gladys Vera Morales", "the rest of the client is untouched");
  const data = (await admin.call("GET", `/templates/data?caseId=${caseId}`)).body;
  assert.deepEqual([data["cliente.genero"], data["cliente.suscrito"], data["cliente.identificado"], data["cliente.domiciliado"]], ["Mujer", "la suscrita", "identificada", "domiciliada"]);
  assert.equal((await admin.call("PUT", `/clients/${clientId}`, { notes: "otra nota" })).body.gender, "mujer", "a save without gender keeps it");
  assert.equal((await admin.call("PUT", `/clients/${clientId}`, { gender: "Hombre" })).body.gender, "hombre", "the office can always change it");
  assert.equal((await admin.call("PUT", `/clients/${clientId}`, { gender: "no sé" })).body.gender, "mujer", "an unknown value goes back to the name's");
  const dany = (await admin.call("POST", "/clients", { full_name: "Zuley Gutierrez", id_type: "CC", id_number: "1110222333" })).body;
  assert.equal(dany.gender, "", "an uncommon name is left for the office");
  assert.equal(Object.keys((await admin.call("GET", `/templates/data?caseId=${(await admin.call("POST", "/cases", { client_id: dany.id, process_type_id: (await admin.call("GET", `/cases/${caseId}`)).body.process_type_id })).body.id}`)).body).some((k) => k === "cliente.suscrito"), false);
});

test("the starter templates use the client's gender but not the funcionario's", async () => {
  const list = (await admin.call("GET", "/templates")).body;
  const bodies = [];
  for (const t of list) bodies.push((await admin.call("GET", `/templates/${t.id}`)).body.body || "");
  const all = bodies.join("\n");
  assert.ok(all.includes("{{cliente.nombre}}**, {{cliente.identificado}}") || all.includes("{{cliente.identificado}}"));
  assert.ok(all.includes("{{cliente.domiciliado}}"));
  assert.equal(/cliente\.(nombre|documento)[^\n]{0,80}(identificado|domiciliado)\(a\)/.test(all), false, "no client left with (a)");
  assert.ok(all.includes("**[FILL: Nombre completo del funcionario o contratista]**, identificado(a)"), "the funcionario's wording stays");
});
