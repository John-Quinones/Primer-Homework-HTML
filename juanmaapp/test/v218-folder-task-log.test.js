import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { folderKey, nextFolder, taskLogEvents } from "../src/case-meta.js";

let srv, admin, office;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  office = (await admin.call("GET", "/admin/offices")).body[0].id;
});
after(() => srv.close());

test("folder numbers compare loosely and the next free one follows the highest", () => {
  assert.equal(folderKey(" Carpeta 045-A "), folderKey("045a"));
  assert.notEqual(folderKey("45"), folderKey("450"));
  assert.equal(nextFolder(["12", "7", "A-3", ""]), "13");
  assert.equal(nextFolder([]), "1");
});

test("the client screen assigns and edits folder numbers; other data stays and duplicates are refused", async () => {
  const client = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Ana", last_names: "Ruiz", id_type: "CC", id_number: "52111223", office_id: office })).body;
  const cat = (await admin.call("GET", "/catalog")).body[0];
  const type = cat.types[0];
  const extra = (await admin.call("POST", `/categories/${cat.id}/fields`, { label: "Juzgado de origen", field_type: "text" })).body;
  const a = (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: type.id, office_id: office, title: "Uno", field_values: { [extra.id]: "Primero civil" } })).body;
  const b = (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: type.id, office_id: office, title: "Dos" })).body;

  // No "No. Carpeta" field yet: the first number creates it, other values stay.
  const set = await admin.call("PUT", `/cases/${a.id}/folder`, { folder: "120" });
  assert.equal(set.status, 200);
  const folderField = (await admin.call("GET", "/catalog")).body[0].fields.find((f) => f.label === "No. Carpeta");
  assert.ok(folderField);
  assert.equal(set.body.field_values[folderField.id], "120");
  assert.equal(set.body.field_values[extra.id], "Primero civil");
  assert.equal(set.body.title, "Uno");

  assert.equal((await admin.call("GET", "/folders/next")).body.next, "121");
  const dup = await admin.call("PUT", `/cases/${b.id}/folder`, { folder: " 120 " });
  assert.equal(dup.status, 400);
  assert.match(dup.body.error, /ya está asignada/);

  const edit = await admin.call("PUT", `/cases/${a.id}/folder`, { folder: "121" });
  assert.equal(edit.body.field_values[folderField.id], "121");
  assert.equal((await admin.call("PUT", `/cases/${b.id}/folder`, { folder: "120" })).status, 200);
  const log = (await admin.call("GET", `/audit?caseId=${a.id}`)).body;
  assert.ok(log.some((e) => /número de carpeta/.test(e.summary)));
});

test("every task change is logged with who and when; the log is append-only and filters by user", async () => {
  const laura = (await admin.call("POST", "/admin/users", { name: "Laura Gómez", email: "laura@firma.co", role: "Abogado", office_ids: [office], password: "tribunal-azul-2026" })).body;
  const client = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Luis", last_names: "Paz", id_type: "CC", id_number: "52111224", office_id: office })).body;
  const type = (await admin.call("GET", "/catalog")).body[0].types[0];
  const k = (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: type.id, office_id: office })).body;

  // A task from before version 2.18 keeps only who created and closed it.
  const me = srv.db.prepare("SELECT id FROM users WHERE email = ?").get("gerencia@firma.co").id;
  srv.db.prepare("INSERT INTO tasks (case_id, title, due_at, status, created_by, created_at, done_at, done_by) VALUES (?, 'Tarea vieja', '2026-01-10 10:00', 'hecha', ?, '2026-01-05 15:00:00', '2026-01-09 16:00:00', ?)").run(k.id, me, me);

  const t = (await admin.call("POST", "/tasks", { case_id: k.id, title: "Radicar demanda", due_at: "2030-01-10 17:00" })).body;
  await admin.call("PUT", `/tasks/${t.id}`, { assigned_user_id: laura.id, due_at: "2030-01-12 17:00" });
  const lauraS = await srv.login("laura@firma.co", "tribunal-azul-2026");
  await lauraS.call("PUT", `/tasks/${t.id}`, { status: "hecha", done_notes: "Radicada en línea" });
  await admin.call("PUT", `/tasks/${t.id}`, { status: "pendiente" });
  await admin.call("DELETE", `/tasks/${t.id}`);

  const all = (await admin.call("GET", `/task-log?caseId=${k.id}`)).body;
  const actions = all.filter((r) => r.task_id === t.id).map((r) => r.action).reverse();
  assert.deepEqual(actions, ["creada", "reprogramada", "reasignada", "hecha", "reabierta", "eliminada"]);
  const done = all.find((r) => r.action === "hecha" && r.task_id === t.id);
  assert.equal(done.user_name, "Laura Gómez");
  assert.equal(done.detail, "Radicada en línea");
  assert.match(done.at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  const old = all.filter((r) => r.title === "Tarea vieja");
  assert.deepEqual(old.map((r) => r.action).sort(), ["creada", "hecha"]);
  assert.ok(old.every((r) => r.earlier));

  const byLaura = (await admin.call("GET", `/task-log?caseId=${k.id}&userId=${laura.id}`)).body;
  assert.ok(byLaura.length && byLaura.every((r) => r.user_id === laura.id || r.assigned_user_id === laura.id));
  assert.throws(() => srv.db.prepare("DELETE FROM task_log").run(), /no se borra/);
  assert.throws(() => srv.db.prepare("UPDATE task_log SET action = 'x'").run(), /no se modifica/);
});

test("task events name what changed", () => {
  const base = { id: 1, case_id: 1, kind: "oficio", title: "Oficio", due_at: "2030-01-01 10:00", status: "pendiente", assigned_user_id: null };
  assert.deepEqual(taskLogEvents(base, { ...base, delivered_at: "2030-01-02" }).map((e) => e.action), ["entregada"]);
  assert.deepEqual(taskLogEvents(base, { ...base, title: "Oficio a la EPS", status: "cancelada" }).map((e) => e.action), ["editada", "cancelada"]);
});
