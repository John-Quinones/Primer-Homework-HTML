import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer } from "./helpers.js";
import { openDb } from "../src/db.js";
import { taskFollowUp } from "../src/case-meta.js";
import { addBusinessDays } from "../src/ledger.js";

let srv, admin, caseId, laura, lauraId;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  const office = (await admin.call("GET", "/admin/offices")).body[0].id;
  lauraId = (await admin.call("POST", "/admin/users", { name: "Laura Gómez", email: "laura@firma.co", role: "Abogado", office_ids: [office], password: "laura-clave-2026" })).body.id;
  laura = await srv.login("laura@firma.co", "laura-clave-2026");
  const c = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Marco", last_names: "Pineda", id_number: "9" })).body;
  const type = (await admin.call("GET", "/catalog")).body.flatMap((x) => x.types)[0].id;
  caseId = (await admin.call("POST", "/cases", { client_id: c.id, process_type_id: type, title: "Ordinario" })).body.id;
});
after(() => srv.close());

test("old task tables gain the new kinds and follow-up columns without losing rows", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "jm-")), "old.db");
  let db = openDb(file);
  db.exec("PRAGMA foreign_keys = OFF; DROP TABLE tasks;");
  db.exec(`CREATE TABLE tasks (id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'tarea' CHECK (kind IN ('tarea','audiencia','termino')),
    title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', due_at TEXT NOT NULL, location TEXT NOT NULL DEFAULT '', assigned_user_id INTEGER, remind_days TEXT NOT NULL DEFAULT '[1]',
    status TEXT NOT NULL DEFAULT 'pendiente', created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), done_at TEXT)`);
  db.exec("INSERT INTO tasks (id, case_id, kind, title, due_at) VALUES (7, 999, 'audiencia', 'Audiencia inicial', '2026-11-05 09:00')");
  db.close();
  db = openDb(file);
  const row = db.prepare("SELECT * FROM tasks WHERE id = 7").get();
  assert.equal(row.title, "Audiencia inicial");
  assert.equal(row.response_at, "");
  db.exec("PRAGMA foreign_keys = OFF");
  db.prepare("INSERT INTO tasks (case_id, kind, title, due_at) VALUES (999, 'oficio', 'Oficio a la EPS', '2026-11-05 17:00')").run();
  db.close();
});

test("a task assigned to a funcionario reaches their bell with a link to the case, and records who fulfilled it", async () => {
  const t = (await admin.call("POST", "/tasks", { case_id: caseId, kind: "recurso", title: "Apelación del auto", due_at: "2026-10-20 17:00", assigned_user_id: lauraId })).body;
  assert.equal(t.kind, "recurso");
  const bell = (await laura.call("GET", "/notifications")).body.items;
  const n = bell.find((x) => x.kind === "asignada");
  assert.ok(n, "assignee notified");
  assert.match(n.title, /Recurso · Apelación del auto/);
  assert.equal(n.link, `#expediente-${caseId}`);
  const mine = (await admin.call("GET", `/tasks?userId=${lauraId}`)).body;
  assert.deepEqual(mine.map((x) => x.id), [t.id]);
  const done = (await laura.call("PUT", `/tasks/${t.id}`, { status: "hecha", done_notes: "Radicado por correo" })).body;
  assert.equal(done.done_by_name, "Laura Gómez");
  assert.equal(done.done_notes, "Radicado por correo");
});

test("an oficio tracks delivery and answer; the answer closes it", async () => {
  const o = (await admin.call("POST", "/tasks", { case_id: caseId, kind: "oficio", title: "Oficio a la EPS", due_at: "2026-10-30 17:00", delivered_at: "2026-10-15" })).body;
  assert.equal(o.status, "pendiente");
  assert.equal(o.delivered_at, "2026-10-15");
  const r = (await admin.call("PUT", `/tasks/${o.id}`, { response_at: "2026-10-28", response_notes: "Remitió historia clínica" })).body;
  assert.equal(r.status, "hecha");
  assert.equal(taskFollowUp(r, "2026-10-29 08:00").key, "a_tiempo");
  const plain = (await admin.call("POST", "/tasks", { case_id: caseId, kind: "tarea", title: "x", due_at: "2026-10-30 17:00", delivered_at: "2026-10-15" })).body;
  assert.equal(plain.delivered_at, "", "only oficios, peticiones and requerimientos carry delivery data");
});

test("follow-up states and the 15 business days of a petition", () => {
  assert.equal(taskFollowUp({ kind: "tarea", status: "pendiente", due_at: "2026-10-10 17:00" }, "2026-10-15 08:00").key, "vencida");
  assert.equal(taskFollowUp({ kind: "tarea", status: "pendiente", due_at: "2026-10-16 17:00" }, "2026-10-15 08:00").key, "por_vencer");
  assert.equal(taskFollowUp({ kind: "tarea", status: "hecha", due_at: "2026-10-10 17:00", done_at: "2026-10-11 15:00:00" }, "2026-10-15 08:00").key, "tarde");
  assert.equal(addBusinessDays("2026-10-15", 15), "2026-11-06", "skips weekends and the 2 November holiday");
});

test("terms set by the user: business days skip holidays and, for court terms, the vacancia judicial", async () => {
  assert.equal(addBusinessDays("2026-12-17", 3, { judicial: true }), "2027-01-13", "20 Dec–10 Jan and the 11 Jan holiday do not count");
  assert.equal(addBusinessDays("2026-12-17", 3), "2026-12-22", "administrative terms run in December");
  assert.equal(addBusinessDays("2026-03-27", 3, { judicial: true }), "2026-04-08", "Holy Week does not count");
  assert.equal(addBusinessDays("2026-10-16", 2, { unit: "calendario" }), "2026-10-19", "a calendar term ending on Sunday moves to Monday");
  const t = (await admin.call("POST", "/tasks", { case_id: caseId, kind: "termino", title: "Contestar demanda", due_at: "2026-11-13 17:00",
    term_from: "2026-10-15", term_days: 20, term_unit: "habiles", term_label: "Contestar demanda (verbal) (CGP art. 369)" })).body;
  assert.equal(t.term_days, 20);
  assert.equal(t.term_label, "Contestar demanda (verbal) (CGP art. 369)");
  const cleared = (await admin.call("PUT", `/tasks/${t.id}`, { term_days: "" })).body;
  assert.equal(cleared.term_days, null);
  assert.equal(cleared.term_from, "", "no days, no term");
});
