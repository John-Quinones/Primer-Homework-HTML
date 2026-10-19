import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import PizZip from "pizzip";
import { startServer } from "./helpers.js";
import { processVariables } from "../src/case-meta.js";

const require = createRequire(import.meta.url);
const window = { PizZip, docxtemplater: require("docxtemplater") };
vm.runInNewContext(readFileSync(new URL("../public/docx.js", import.meta.url), "utf8"), { window, atob, btoa });
const D = window.JuanmaDocx;

test("class of process and radicado, nothing for a criminal case", () => {
  const l = processVariables("Laboral", "Laboral", "Ordinario Laboral de Primera Instancia", "73-001-31-05-001-2026-00123-00");
  assert.equal(l["expediente.proceso_linea"], "Proceso Ordinario Laboral de Primera Instancia. Radicación No. 73-001-31-05-001-2026-00123-00");
  assert.equal(processVariables("Familia", "", "Unión Marital de Hecho", "")["expediente.proceso_linea"], "Proceso Unión Marital de Hecho");
  assert.equal(processVariables("Civil", "", "Ejecutivo › Singular", "1")["expediente.clase_proceso"], "Ejecutivo Singular");
  for (const v of Object.values(processVariables("Penal", "Penal", "Representación de Víctima", "73001"))) assert.equal(v, "");
});

test("a text template drops an optional line when its datum is empty", () => {
  const t = "Asunto\n\n{{#a}}**Referencia:** {{a}}\n\n{{/a}}Hechos {{b}}";
  assert.equal(D.fillText(t, { a: "X", b: "1" }), "Asunto\n\n**Referencia:** X\n\nHechos 1");
  assert.equal(D.fillText(t, { a: "", b: "1" }), "Asunto\n\nHechos 1");
  assert.deepEqual([...D.textOptional(t)], ["a"]);
});

let srv, admin;
before(async () => { srv = await startServer(); admin = await srv.setup(); });
after(() => srv.close());

test("the starter poder and petición carry the process line", async () => {
  const list = (await admin.call("GET", "/templates")).body;
  for (const name of ["Poder especial", "Derecho de petición"]) {
    const body = (await admin.call("GET", `/templates/${list.find((t) => t.name === name).id}`)).body.body;
    assert.ok(body.includes("{{#expediente.proceso_linea}}**Referencia:** {{expediente.proceso_linea}}"), name);
    assert.equal(body.includes("**Radicado:** {{expediente.radicado}}"), false);
  }
  const lab = (await admin.call("GET", "/catalog")).body.find((c) => c.name === "Laboral");
  const cl = (await admin.call("POST", "/clients", { full_name: "Ana Ruiz" })).body;
  const k = (await admin.call("POST", "/cases", { client_id: cl.id, process_type_id: lab.types[0].id, radicado: "73001310500120260012300" })).body;
  const d = (await admin.call("GET", `/templates/data?caseId=${k.id}`)).body;
  assert.match(d["expediente.proceso_linea"], /^Proceso .+\. Radicación No\. /);
  const pen = (await admin.call("GET", "/catalog")).body.find((c) => c.name === "Penal");
  const k2 = (await admin.call("POST", "/cases", { client_id: cl.id, process_type_id: pen.types[0].id })).body;
  assert.ok(!(await admin.call("GET", `/templates/data?caseId=${k2.id}`)).body["expediente.proceso_linea"], "penal: empty");
});
