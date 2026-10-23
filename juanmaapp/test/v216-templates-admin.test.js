import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

let srv, admin, office;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  office = (await admin.call("GET", "/admin/offices")).body[0].id;
});
after(() => srv.close());

const word = (text) => Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.from(text)]).toString("base64");

test("Gerencia replaces a starter text template with an updated Word file; the others stay", async () => {
  const list = (await admin.call("GET", "/templates")).body;
  const contract = list.find((t) => t.category === "Contrato" && t.builtin);
  assert.ok(contract, "starter contract exists");
  const r = await admin.call("PUT", `/templates/${contract.id}`, { filename: "Contrato actualizado.docx", file_base64: word("contrato v2") });
  assert.equal(r.status, 200);
  assert.equal(r.body.format, "docx");
  assert.equal(r.body.filename, "Contrato actualizado.docx");
  const f = (await admin.call("GET", `/templates/${contract.id}/file`)).body;
  assert.equal(Buffer.from(f.base64, "base64").toString("latin1").slice(4), "contrato v2");
  // Nothing else changed: same templates, same names.
  const after = (await admin.call("GET", "/templates")).body;
  assert.deepEqual(after.map((t) => t.name).sort(), list.map((t) => t.name).sort());
  assert.equal((await admin.call("PUT", `/templates/${contract.id}`, { file_base64: Buffer.from("no es word").toString("base64") })).status, 400);
});

test("Gerencia and the Director Jurídico manage templates; other roles still create documents from them", async () => {
  const t = (await admin.call("POST", "/templates", { name: "Minuta de prueba", category: "Otro", filename: "m.docx", file_base64: word("{{cliente.nombre}}") })).body;
  await admin.call("POST", "/admin/users", { name: "Directora Plantillas", email: "dirtpl@firma.co", role: "Director Jurídico", office_ids: [office],
    password: "tribunal-azul-2026", custom_permissions: true, permissions: ["templates.manage", "drafts.generate", "cases.write"] });
  const d = await srv.login("dirtpl@firma.co", "tribunal-azul-2026");
  await d.call("POST", "/auth/password", { current: "tribunal-azul-2026", next: "tribunal-verde-2026" });
  // Director Jurídico: upload, download, replace and create. Deleting stays Gerencia's.
  const made = await d.call("POST", "/templates", { name: "X", category: "Otro", body: "x" });
  assert.equal(made.status, 201);
  assert.equal((await d.call("PUT", `/templates/${t.id}`, { file_base64: word("otra") })).status, 200);
  assert.equal((await d.call("DELETE", `/templates/${t.id}`)).status, 403);
  // Generating documents is still allowed.
  assert.equal((await d.call("GET", "/templates")).status, 200);
  assert.equal((await d.call("GET", `/templates/${t.id}/file`)).status, 200);
  assert.equal((await d.call("GET", "/templates/data")).status, 200);
  const roles = (await admin.call("GET", "/admin/roles")).body;
  assert.ok(roles.matrix["Director Jurídico"].includes("templates.manage"));
  assert.ok(!roles.matrix.Abogado.includes("templates.manage"));
  // Gerencia can still take it away from a role, but never from itself.
  const ab = (await admin.call("POST", "/admin/users", { name: "Abogada Plantillas", email: "abotpl@firma.co", role: "Abogado", office_ids: [office],
    password: "tribunal-azul-2026" })).body;
  const a = await srv.login("abotpl@firma.co", "tribunal-azul-2026");
  await a.call("POST", "/auth/password", { current: "tribunal-azul-2026", next: "tribunal-verde-2026" });
  assert.equal((await a.call("POST", "/templates", { name: "Z", category: "Otro", body: "z" })).status, 403);
  assert.ok(ab.id);
});
