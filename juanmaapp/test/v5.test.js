import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import PizZip from "pizzip";
import { startServer } from "./helpers.js";
import { SEED_TEMPLATES } from "../src/templates-seed.js";

let srv, admin, lab;
before(async () => {
  srv = await startServer();
  admin = await srv.setup();
  lab = (await admin.call("GET", "/catalog")).body.find((c) => c.name === "Laboral");
});
after(() => srv.close());

let ordinario, primera;
test("second-order sub-processes: two levels, path names, same name under different parents", async () => {
  ordinario = lab.types.find((t) => t.name === "Ordinario Laboral de Primera Instancia");
  const ejecutivo = lab.types.find((t) => t.name === "Ejecutivo Laboral");
  primera = (await admin.call("POST", `/categories/${lab.id}/types`, { name: "Con medidas cautelares", parent_id: ordinario.id })).body;
  assert.equal(primera.parent_id, ordinario.id);
  assert.equal((await admin.call("POST", `/categories/${lab.id}/types`, { name: "Con medidas cautelares", parent_id: ejecutivo.id })).status, 201, "same name, other parent");
  assert.equal((await admin.call("POST", `/categories/${lab.id}/types`, { name: "Con medidas cautelares", parent_id: ordinario.id })).status, 409);
  assert.equal((await admin.call("POST", `/categories/${lab.id}/types`, { name: "Nieto", parent_id: primera.id })).status, 400, "only two levels");
  const client = (await admin.call("POST", "/clients", { full_name: "Ana Ruiz" })).body;
  const k = (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: primera.id, title: "Salarios" })).body;
  assert.equal(k.type_name, "Ordinario Laboral de Primera Instancia › Con medidas cautelares");
  const cat = (await admin.call("GET", "/catalog")).body.find((c) => c.id === lab.id);
  assert.equal(cat.types.find((t) => t.id === ordinario.id).uses, 1, "a child's case counts for its parent");
  // Deleting a parent whose child has cases is refused.
  assert.equal((await admin.call("DELETE", `/types/${ordinario.id}`)).status, 409);
});

test("sub-processes can be reordered by hand and by usage", async () => {
  const top = lab.types.filter((t) => !t.parent_id).map((t) => t.id);
  const reversed = [...top].reverse();
  assert.equal((await admin.call("PUT", `/categories/${lab.id}/order`, { type_ids: reversed })).status, 200);
  let cat = (await admin.call("GET", "/catalog")).body.find((c) => c.id === lab.id);
  assert.deepEqual(cat.types.filter((t) => !t.parent_id).map((t) => t.id), reversed);
  assert.equal((await admin.call("PUT", `/categories/${lab.id}/order`, { type_ids: [top[0], primera.id] })).status, 400, "mixed levels");
  await admin.call("POST", `/categories/${lab.id}/sort-by-usage`);
  cat = (await admin.call("GET", "/catalog")).body.find((c) => c.id === lab.id);
  assert.equal(cat.types.filter((t) => !t.parent_id)[0].id, ordinario.id, "most used first");
  const cats = (await admin.call("GET", "/catalog")).body.map((c) => c.id);
  await admin.call("PUT", "/category-order", { ids: [...cats].reverse() });
  assert.deepEqual((await admin.call("GET", "/catalog")).body.map((c) => c.id), [...cats].reverse());
});

test("templates: starter set, case data, uploads, permissions", async () => {
  const list = (await admin.call("GET", "/templates")).body;
  assert.deepEqual(list.map((t) => t.category).sort(), SEED_TEMPLATES.map((t) => t.category).sort());
  const poder = list.find((t) => t.category === "Poder");
  assert.match((await admin.call("GET", `/templates/${poder.id}`)).body.body, /\{\{cliente\.nombre\}\}/);

  // Case data fills variables; missing ones are absent so the page shows [FILL].
  const me = (await admin.call("GET", "/auth/status")).body.user;
  await admin.call("PUT", `/admin/users/${me.id}`, { professional_card: "123.456" });
  const k = (await admin.call("GET", "/cases")).body[0];
  const data = (await admin.call("GET", `/templates/data?caseId=${k.id}`)).body;
  assert.equal(data["cliente.nombre"], "Ana Ruiz");
  assert.equal(data["expediente.subproceso"], "Ordinario Laboral de Primera Instancia › Con medidas cautelares");
  assert.equal(data["abogado.tarjeta_profesional"], "123.456");
  assert.match(data["fecha.hoy"], /^\d{1,2} de [a-z]+ de \d{4}$/);
  assert.ok(!("cliente.correo" in data));
  assert.equal((await admin.call("GET", "/templates/data?caseId=9999")).status, 404);

  // Text and Word uploads.
  const md = await admin.call("POST", "/templates", { name: "Memorial simple", category: "Memorial", body: "Señor juez: {{expediente.despacho}}" });
  assert.equal(md.status, 201);
  assert.equal((await admin.call("POST", "/templates", { name: "X", category: "Inventada", body: "x" })).status, 400);
  const zip = new PizZip();
  zip.file("word/document.xml", "<w:document><w:body><w:p><w:r><w:t>{{cliente.nombre}}</w:t></w:r></w:p></w:body></w:document>");
  const b64 = zip.generate({ type: "base64" });
  const docx = await admin.call("POST", "/templates", { name: "Poder de la firma", category: "Poder", filename: "poder.docx", file_base64: b64 });
  assert.equal(docx.status, 201);
  assert.equal(docx.body.format, "docx");
  assert.equal((await admin.call("GET", `/templates/${docx.body.id}/file`)).body.base64, b64);
  assert.equal((await admin.call("POST", "/templates", { name: "Malo", category: "Poder", filename: "x.docx", file_base64: Buffer.from("hola").toString("base64") })).status, 400);
  const upd = await admin.call("PUT", `/templates/${md.body.id}`, { body: "Nuevo {{fecha.hoy}}" });
  assert.equal(upd.body.body, "Nuevo {{fecha.hoy}}");

  // An Abogado can use templates but not manage them.
  const ibague = (await admin.call("GET", "/admin/offices")).body[0];
  await admin.call("POST", "/admin/users", { name: "Abo", email: "abo@firma.co", role: "Abogado", office_ids: [ibague.id], password: "clave-segura-7" });
  const abo = await srv.login("abo@firma.co", "clave-segura-7");
  assert.equal((await abo.call("GET", "/templates")).status, 200);
  assert.equal((await abo.call("POST", "/templates", { name: "Y", category: "Otro", body: "y" })).status, 403);
  assert.equal((await abo.call("DELETE", `/templates/${md.body.id}`)).status, 403);
  assert.equal((await admin.call("DELETE", `/templates/${md.body.id}`)).status, 204);
  const roles = (await admin.call("GET", "/admin/roles")).body;
  assert.ok(roles.matrix["Director Jurídico"].includes("templates.manage"));
  assert.ok(!roles.matrix.Abogado.includes("templates.manage"));
});

test("generate accepts LAWSUIT with a base template and rejects unknown types", async () => {
  assert.equal((await admin.call("POST", "/generate", { documentType: "OTRO" })).status, 400);
  // Without an API key the request passes validation and ends with an NDJSON error event from the model call.
  const res = await fetch(srv.base + "/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-JuanMa": "1", Cookie: admin.cookie },
    body: JSON.stringify({ documentType: "LAWSUIT", template: "Señor juez {{expediente.despacho}}" }),
  });
  assert.equal(res.status, 200);
  const events = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(events.at(-1).type, "error");
});
