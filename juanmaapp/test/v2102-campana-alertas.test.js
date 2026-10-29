import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { taskReminders } from "../src/monitor.js";
import { bellShows } from "../src/case-meta.js";
import { auditSystem } from "../src/audit.js";

let srv, admin, k, uid;
const bell = async () => (await admin.call("GET", "/notifications")).body;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  const o1 = (await admin.call("GET", "/admin/offices")).body[0].id;
  uid = srv.db.prepare("SELECT id FROM users LIMIT 1").get().id;
  const client = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Ana", last_names: "Ruiz", id_type: "CC", id_number: "52111299", office_id: o1 })).body;
  const type = (await admin.call("GET", "/catalog")).body[0].types[0];
  k = (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: type.id, office_id: o1 })).body;
});
after(() => srv.close());

test("a resolved task leaves the bell and stays in the case history; nothing is deleted", async () => {
  const t = (await admin.call("POST", "/tasks", { case_id: k.id, kind: "tarea", title: "Enviar oficio", due_at: "2026-10-30 17:00", remind_days: [1] })).body;
  taskReminders(srv.db, new Date("2026-10-30T00:00:00Z")); // 19:00 Bogotá the day before: reminder fires
  taskReminders(srv.db, new Date("2026-10-31T00:00:00Z")); // past due: «vencida» fires
  const before = await bell();
  assert.equal(before.items.filter((n) => n.title.includes("Enviar oficio")).length, 2);
  await admin.call("PUT", `/tasks/${t.id}`, { status: "hecha", done_notes: "Enviado" });
  const after = await bell();
  assert.equal(after.items.filter((n) => n.title.includes("Enviar oficio")).length, 0);
  assert.equal(srv.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE key LIKE ?").get(`task:${t.id}:%`).n, 2);
  const log = (await admin.call("GET", `/task-log?caseId=${k.id}`)).body;
  assert.ok(log.some((x) => x.task_id === t.id && x.action === "hecha" && x.detail === "Enviado"));
});

test("not fulfilled also clears the alerts; reopening brings them back", async () => {
  const t = (await admin.call("POST", "/tasks", { case_id: k.id, kind: "termino", title: "Contestar", due_at: "2020-01-02 10:00" })).body;
  taskReminders(srv.db, new Date());
  assert.equal((await bell()).items.filter((n) => n.title.includes("Contestar")).length, 1);
  await admin.call("PUT", `/tasks/${t.id}`, { status: "cancelada", done_notes: "Se venció" });
  assert.equal((await bell()).items.filter((n) => n.title.includes("Contestar")).length, 0);
  await admin.call("PUT", `/tasks/${t.id}`, { status: "pendiente" });
  assert.equal((await bell()).items.filter((n) => n.title.includes("Contestar")).length, 1);
});

test("hearing alerts disappear when the date arrives; a pending deadline's «vencida» stays", () => {
  const due = Date.parse("2026-11-10T15:00:00Z");
  const rem = { key: "task:5:1", kind: "audiencia", read_at: null }, over = { key: "task:5:overdue", kind: "vencida", read_at: null };
  assert.equal(bellShows(rem, { kind: "audiencia", status: "pendiente" }, due - 1000, due), true);
  assert.equal(bellShows(rem, { kind: "audiencia", status: "pendiente" }, due, due), false);
  assert.equal(bellShows(over, { kind: "audiencia", status: "pendiente" }, due + 1000, due), false);
  assert.equal(bellShows({ ...rem, kind: "termino" }, { kind: "termino", status: "pendiente" }, due + 1000, due), false);
  assert.equal(bellShows(over, { kind: "termino", status: "pendiente" }, due + 1000, due), true);
  assert.equal(bellShows(over, { kind: "termino", status: "hecha" }, due + 1000, due), false);
});

test("v2.3.0: the bell holds only tasks and hearings; the rest goes to the Bitácora", async () => {
  for (const kind of ["actuacion", "reporte", "firma", "acuse", "respaldo", "chat", "autorizacion"])
    assert.equal(bellShows({ key: null, kind, read_at: null }, null, 0, 0), false, kind);
  assert.equal(bellShows({ key: null, kind: "asignada", read_at: null }, null, 0, 0), true);
  srv.db.prepare("INSERT INTO notifications (user_id, kind, title, body, link) VALUES (?, 'firma', 'Ana firmó', '', '#firmas')").run(uid);
  assert.equal((await bell()).items.filter((n) => n.kind === "firma").length, 0);
  auditSystem(srv.db, { action: "Registró", module: "Firmas", entity: "firma", summary: "Ana firmó «Poder»" });
  const log = (await admin.call("GET", "/audit?q=Ana")).body;
  const rows = log.items || log;
  assert.ok(rows.some((e) => e.summary.includes("Ana firmó") && e.user_name === "Sistema"));
});

test("assignment notices clear too", async () => {
  const t = (await admin.call("POST", "/tasks", { case_id: k.id, kind: "tarea", title: "Revisar", due_at: "2030-01-02 10:00", assigned_user_id: uid })).body;
  await admin.call("POST", `/tasks/${t.id}/notify`, {});
  await admin.call("PUT", `/tasks/${t.id}`, { status: "hecha" });
  assert.equal((await bell()).items.filter((n) => n.title.includes("Revisar")).length, 0);
});
