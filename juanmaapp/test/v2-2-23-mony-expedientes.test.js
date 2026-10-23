// Version 2.2.23: Mony finds a client's expedientes, a case by folder number and reports on it (read-only).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { runTool, cardFor, TOOLS } from "../src/mony.js";

let srv, admin, db, caseA, caseB, user;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  const cat = (await admin.call("GET", "/catalog")).body[0];
  const c1 = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Luis", last_names: "Prada Gómez", id_number: "77123" })).body;
  const c2 = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Marta", last_names: "Rojas", id_number: "88999" })).body;
  caseA = (await admin.call("POST", "/cases", { client_id: c1.id, process_type_id: cat.types[0].id, title: "Ejecutivo Prada", radicado: "73001400300220240012300" })).body.id;
  caseB = (await admin.call("POST", "/cases", { client_id: c1.id, process_type_id: cat.types[0].id, title: "Laboral Prada" })).body.id;
  await admin.call("POST", "/cases", { client_id: c2.id, process_type_id: cat.types[0].id, title: "Caso Rojas" });
  await admin.call("PUT", `/cases/${caseA}/folder`, { folder: "39" });
  await admin.call("POST", "/tasks", { case_id: caseA, kind: "termino", title: "Contestar excepciones", due_at: "2020-01-10 09:00" });
  await admin.call("POST", "/tasks", { case_id: caseA, kind: "tarea", title: "Llamar al cliente", due_at: "2099-01-10 09:00" });
  db = srv.db; user = { id: 1, permissions: ["scope.all"], role: "Gerencia" };
});
after(() => srv.close());

test("TOOLS lists both lookups and they are read-only (SELECT only)", () => {
  assert.ok(TOOLS.some((t) => t.name === "buscar_expedientes") && TOOLS.some((t) => t.name === "informe_expediente"));
});
test("buscar_expedientes: by client name (accents ignored), document and folder", async () => {
  const ctx = { db, user: user };
  const a = await runTool("buscar_expedientes", { cliente: "prada gomez" }, ctx);
  assert.equal(a.total, 2);
  const b = await runTool("buscar_expedientes", { documento: "88999" }, ctx);
  assert.equal(b.total, 1);
  const f = await runTool("buscar_expedientes", { carpeta: "No. 39" }, ctx);
  assert.equal(f.expedientes[0].caso_id, caseA);
  assert.equal(f.expedientes[0].carpeta, "39");
  await assert.rejects(runTool("buscar_expedientes", {}, ctx), /al menos/);
});
test("informe_expediente: pending tasks with follow-up, by id and by folder; card", async () => {
  const ctx = { db, user: user };
  const r = await runTool("informe_expediente", { carpeta: "39" }, ctx);
  assert.equal(r.caso_id, caseA);
  assert.equal(r.tareas_pendientes.length, 2);
  assert.equal(r.tareas_vencidas, 1);
  assert.equal(r.tareas_pendientes[0].titulo, "Contestar excepciones");
  const card = cardFor("informe_expediente", { caso_id: caseA }, r);
  assert.equal(card.type, "expediente"); assert.equal(card.caseId, caseA);
  await assert.rejects(runTool("informe_expediente", { carpeta: "9999" }, ctx), /no existe/);
});
test("nothing is written", async () => {
  const before = db.prepare("SELECT COUNT(*) n FROM cases").get().n;
  await runTool("informe_expediente", { caso_id: caseB }, { db, user: user });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM cases").get().n, before);
});
