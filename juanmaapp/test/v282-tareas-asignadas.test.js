import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

let srv, admin, laura, k, taskId;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  const o1 = (await admin.call("GET", "/admin/offices")).body[0].id;
  const o2 = (await admin.call("POST", "/admin/offices", { name: "Oficina Bogotá" })).body.id;
  laura = (await admin.call("POST", "/admin/users", { name: "Laura Gómez", email: "laura@firma.co", role: "Abogado", office_ids: [o1], password: "tribunal-azul-2026" })).body;
  const client = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Ana", last_names: "Ruiz", id_type: "CC", id_number: "52111299", office_id: o1 })).body;
  const type = (await admin.call("GET", "/catalog")).body[0].types[0];
  k = (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: type.id, office_id: o1 })).body;
  taskId = (await admin.call("POST", "/tasks", { case_id: k.id, kind: "recurso", title: "Enviar Peticion", due_at: "2026-10-19 17:00", assigned_user_id: laura.id })).body.id;
  // The case later moves to an office the assignee cannot open (the task stays assigned to her).
  srv.db.prepare("UPDATE cases SET office_id = ? WHERE id = ?").run(o2, k.id);
});
after(() => srv.close());

test("a task assigned to someone is in their list even if the case is in another office", async () => {
  const me = await srv.login("laura@firma.co", "tribunal-azul-2026");
  const mine = (await me.call("GET", "/tasks?mine=1&status=pendiente")).body;
  assert.deepEqual(mine.map((t) => t.id), [taskId]);
  assert.equal(mine[0].status, "pendiente");
  assert.equal(mine[0].due_at, "2026-10-19 17:00");
});

test("the assignee can mark it as fulfilled or not fulfilled, and edit it, but cannot reassign it", async () => {
  const me = await srv.login("laura@firma.co", "tribunal-azul-2026");
  const bad = await me.call("PUT", `/tasks/${taskId}`, { title: "Otro título", assigned_user_id: null });
  assert.equal(bad.status, 403);
  assert.equal((await me.call("PUT", `/tasks/${taskId}`, { title: "Otro título" })).status, 200);
  const no = await me.call("PUT", `/tasks/${taskId}`, { status: "cancelada", done_notes: "No se alcanzó" });
  assert.equal(no.status, 200);
  assert.equal(no.body.status, "cancelada");
  const back = await me.call("PUT", `/tasks/${taskId}`, { status: "hecha", done_notes: "Enviada" });
  assert.equal(back.body.status, "hecha");
  assert.equal(back.body.done_by_name, "Laura Gómez");
});

test("someone else without office access still does not see the task", async () => {
  const o3 = (await admin.call("POST", "/admin/offices", { name: "Oficina Cali" })).body.id;
  await admin.call("POST", "/admin/users", { name: "Pedro Soto", email: "pedro@firma.co", role: "Abogado", office_ids: [o3], password: "tribunal-azul-2026" });
  const p = await srv.login("pedro@firma.co", "tribunal-azul-2026");
  assert.deepEqual((await p.call("GET", "/tasks")).body, []);
  assert.equal((await p.call("PUT", `/tasks/${taskId}`, { status: "cancelada" })).status, 404);
});
