import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

let srv, admin, contable, otro, k, t;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  const office = (await admin.call("GET", "/admin/offices")).body[0].id;
  const pw = "tribunal-azul-2026";
  const u1 = (await admin.call("POST", "/admin/users", { name: "Carlos Mora", email: "carlos@firma.co", role: "Director Contable", office_ids: [office], password: pw })).body;
  await admin.call("POST", "/admin/users", { name: "Otro Contable", email: "otro@firma.co", role: "Director Contable", office_ids: [office], password: pw });
  const client = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Ana", last_names: "Ruiz", id_type: "CC", id_number: "52111299", office_id: office })).body;
  const type = (await admin.call("GET", "/catalog")).body[0].types[0];
  k = (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: type.id, office_id: office })).body;
  t = (await admin.call("POST", "/tasks", { case_id: k.id, title: "Revisar contrato", due_at: "2030-03-02 17:00", assigned_user_id: u1.id })).body;
  contable = await srv.login("carlos@firma.co", pw);
  otro = await srv.login("otro@firma.co", pw);
});
after(() => srv.close());

test("the assignee without case permission edits title, date and notes; it is logged and reminders are redone", async () => {
  srv.db.prepare("INSERT INTO notifications (user_id, kind, title, key) VALUES (?, 'aviso', 'x', ?)").run(t.assigned_user_id, `task:${t.id}:rem1`);
  const r = await contable.call("PUT", `/tasks/${t.id}`, { title: "Revisar contrato laboral", due_at: "2030-03-09 10:00", notes: "Con anexos" });
  assert.equal(r.status, 200);
  assert.equal(r.body.title, "Revisar contrato laboral");
  assert.equal(r.body.due_at, "2030-03-09 10:00");
  const log = (await admin.call("GET", `/task-log?caseId=${k.id}`)).body.map((x) => x.action);
  assert.ok(log.includes("editada") && log.includes("reprogramada"));
  assert.equal(srv.db.prepare("SELECT COUNT(*) n FROM notifications WHERE key = ?").get(`task:${t.id}:rem1`).n, 0);
});

test("the assignee cannot reassign, and someone else without permission cannot edit", async () => {
  const me = t.assigned_user_id;
  assert.equal((await contable.call("PUT", `/tasks/${t.id}`, { title: "Otra", assigned_user_id: null })).status, 403);
  assert.equal((await contable.call("PUT", `/tasks/${t.id}`, { title: "Mismo", assigned_user_id: me })).status, 200);
  assert.equal((await otro.call("PUT", `/tasks/${t.id}`, { title: "Intruso" })).status, 403);
  assert.equal(srv.db.prepare("SELECT title FROM tasks WHERE id = ?").get(t.id).title, "Mismo");
});
