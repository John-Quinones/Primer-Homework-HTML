import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

let srv, admin, contable, k, t;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  const office = (await admin.call("GET", "/admin/offices")).body[0].id;
  const pw = "tribunal-azul-2026";
  await admin.call("POST", "/admin/users", { name: "Carlos Mora", email: "carlos@firma.co", role: "Director Contable", office_ids: [office], password: pw });
  const client = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Ana", last_names: "Ruiz", id_type: "CC", id_number: "52111299", office_id: office })).body;
  const type = (await admin.call("GET", "/catalog")).body[0].types[0];
  k = (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: type.id, office_id: office })).body;
  t = (await admin.call("POST", "/tasks", { case_id: k.id, title: "Tarea por borrar", due_at: "2030-03-02 17:00" })).body;
  contable = await srv.login("carlos@firma.co", pw);
});
after(() => srv.close());

test("only Gerencia deletes a task, and the history keeps the deletion", async () => {
  assert.equal((await contable.call("DELETE", `/tasks/${t.id}`)).status, 403);
  assert.equal(srv.db.prepare("SELECT COUNT(*) n FROM tasks WHERE id = ?").get(t.id).n, 1);
  assert.equal((await admin.call("DELETE", `/tasks/${t.id}`)).status, 204);
  assert.equal(srv.db.prepare("SELECT COUNT(*) n FROM tasks WHERE id = ?").get(t.id).n, 0);
  const log = (await admin.call("GET", `/task-log?caseId=${k.id}`)).body.map((x) => x.action);
  assert.ok(log.includes("eliminada"), log.join());
});
