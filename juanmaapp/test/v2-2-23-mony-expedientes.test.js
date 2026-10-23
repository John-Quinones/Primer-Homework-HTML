// Version 2.2.23: Mony finds a client's expedientes, a case by folder number and reports on it (read-only).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { runTool, cardFor, TOOLS } from "../src/mony.js";
import { setFetch } from "../src/ramajudicial.js";

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

setFetch(async () => { throw new Error("sin red"); }); // the Rama Judicial never answers in tests
test("consultar_estado_proceso works by folder or client without a radicado (saved data, no error)", async () => {
  const ctx = { db, user };
  const f = await runTool("consultar_estado_proceso", { carpeta: "39" }, ctx);
  assert.equal(f.caso_id, caseA);
  assert.match(f.aviso, /datos guardados/);
  assert.equal(f.tareas_pendientes.length, 2);
  const c = await runTool("consultar_estado_proceso", { cliente: "Marta Rojas" }, ctx);
  assert.match(c.aviso, /datos guardados/);
  const many = await runTool("consultar_estado_proceso", { cliente: "Prada" }, ctx);
  assert.equal(many.total, 2);
  assert.equal(cardFor("consultar_estado_proceso", { carpeta: "39" }, f).type, "expediente");
  await assert.rejects(runTool("consultar_estado_proceso", {}, ctx), /carpeta/);
});

test("preparar_whatsapp and preparar_correo only draft: client phone/e-mail, card, nothing sent", async () => {
  const ctx = { db, user };
  db.prepare("UPDATE clients SET phone = '3001234567', email = 'marta@example.com' WHERE full_name LIKE 'Marta%'").run();
  const w = await runTool("preparar_whatsapp", { cliente: "Marta Rojas", mensaje: "Buenos días, le informamos que su proceso avanza." }, ctx);
  assert.equal(w.telefono, "573001234567");
  assert.match(w.estado, /no se ha enviado/);
  assert.deepEqual(cardFor("preparar_whatsapp", {}, w), { type: "whatsapp", title: "Marta Rojas", phone: "573001234567", text: w.texto });
  await assert.rejects(runTool("preparar_whatsapp", { cliente: "Luis Prada", mensaje: "Hola" }, ctx), /no tiene teléfono/);
  await assert.rejects(runTool("preparar_whatsapp", { cliente: "Marta", mensaje: "" }, ctx), /texto/);
  const m = await runTool("preparar_correo", { cliente: "Marta Rojas", asunto: "Estado del proceso", mensaje: "Cordial saludo…" }, ctx);
  assert.equal(m.para, "marta@example.com");
  assert.equal(cardFor("preparar_correo", {}, m).type, "correo");
  await assert.rejects(runTool("preparar_correo", { cliente: "Luis Prada", asunto: "a", mensaje: "b" }, ctx), /no tiene correo/);
  await assert.rejects(runTool("preparar_correo", { para: "mal", asunto: "a", mensaje: "b" }, ctx), /no es válida/);
});

test("agenda: consult, propose (never saves), overlaps and the card", async () => {
  const ctx = { db, user };
  const tasks = (await admin.call("GET", "/tasks")).body;
  const pending = tasks.find((t) => t.title === "Llamar al cliente");
  const list = await runTool("consultar_agenda", { desde: "2099-01-01", hasta: "2099-01-31" }, ctx);
  assert.equal(list.eventos[0].titulo, "Llamar al cliente");
  const p = await runTool("proponer_cambio_agenda", { accion: "crear", caso_id: caseA, tipo: "audiencia", titulo: "Audiencia inicial", fecha_hora: "2099-01-10 09:30" }, ctx);
  assert.equal(p.hay_cruce, true); // 09:00 task is within the hour
  assert.equal(p.cambios.kind, "audiencia");
  const free = await runTool("proponer_cambio_agenda", { accion: "crear", caso_id: caseA, titulo: "Audiencia", fecha_hora: "2099-01-10 14:00" }, ctx);
  assert.equal(free.hay_cruce, false);
  const mv = await runTool("proponer_cambio_agenda", { accion: "posponer", tarea_id: pending.id, dias: 7 }, ctx);
  assert.equal(mv.cambios.due_at, "2099-01-17 09:00");
  assert.equal(cardFor("proponer_cambio_agenda", {}, mv).type, "agenda");
  await assert.rejects(runTool("proponer_cambio_agenda", { accion: "crear", caso_id: caseA, titulo: "x", fecha_hora: "2001-01-01 10:00" }, ctx), /ya pasó/);
  await assert.rejects(runTool("proponer_cambio_agenda", { accion: "crear", titulo: "x", fecha_hora: "2099-01-01 10:00" }, ctx), /expediente/);
  assert.equal((await admin.call("GET", "/tasks")).body.length, tasks.length); // nothing was saved
});
