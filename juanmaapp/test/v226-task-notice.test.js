import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { setTransports } from "../src/notify.js";
import { taskNotice } from "../src/case-meta.js";

const sent = [], whats = [];
let srv, admin, office, laura, k;
before(async () => {
  setTransports({
    mail: { sendMail: async (m) => { sent.push(m); return { messageId: "<x@test>" }; } },
    whatsapp: async (to, text) => { whats.push({ to, text }); return { channel: "whatsapp", ok: true, detail: "+57" + to }; },
  });
  srv = await startServer(); admin = await srv.setup();
  office = (await admin.call("GET", "/admin/offices")).body[0].id;
  laura = (await admin.call("POST", "/admin/users", { name: "Laura Gómez", email: "laura@firma.co", role: "Abogado", office_ids: [office], password: "tribunal-azul-2026" })).body;
  srv.db.prepare("UPDATE users SET phone = '3001234567' WHERE id = ?").run(laura.id);
  const client = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Ana", last_names: "Ruiz", id_type: "CC", id_number: "52111299", office_id: office })).body;
  const type = (await admin.call("GET", "/catalog")).body[0].types[0];
  k = (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: type.id, office_id: office })).body;
});
after(() => srv.close());

test("the notice text names the hearing, the date, the place and the message", () => {
  const n = taskNotice({ kind: "audiencia", title: "Audiencia inicial", due_at: "2030-02-01 09:00", location: "Sala 3", client_name: "Ana Ruiz", type_name: "Laboral" },
    { to: "Laura", by: "Gerente", message: "Llevar el poder", link: "https://app/#expediente-1" });
  assert.match(n.subject, /^Audiencia: Audiencia inicial · 2030-02-01 09:00$/);
  for (const part of ["Hola, Laura.", "Gerente le notifica esta audiencia", "Fecha y hora: 2030-02-01 09:00", "Lugar o enlace: Sala 3", "Mensaje: Llevar el poder", "https://app/#expediente-1"])
    assert.ok(n.text.includes(part), part);
  assert.doesNotMatch(n.text, /\n{3,}/);
});

test("creating a hearing with «Notificar al asignado» sends e-mail, WhatsApp and the bell, and logs it", async () => {
  const r = await admin.call("POST", "/tasks", { case_id: k.id, kind: "audiencia", title: "Audiencia de trámite", due_at: "2030-03-01 08:30", location: "Sala 5",
    assigned_user_id: laura.id, notify: { email: true, whatsapp: true, message: "Revisar pruebas" } });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.notice.results.map((x) => [x.channel, x.ok]), [["app", true], ["email", true], ["whatsapp", true]]);
  assert.equal(sent.at(-1).to, "laura@firma.co");
  assert.match(sent.at(-1).subject, /Audiencia: Audiencia de trámite/);
  assert.match(sent.at(-1).text, /Mensaje: Revisar pruebas/);
  assert.equal(whats.at(-1).to, "3001234567");
  const notes = srv.db.prepare("SELECT * FROM notifications WHERE user_id = ?").all(laura.id);
  assert.equal(notes.length, 1, "one bell notice, not two");
  assert.match(notes[0].title, /le notificó: Audiencia/);
  const log = (await admin.call("GET", `/task-log?caseId=${k.id}`)).body;
  assert.ok(log.some((x) => x.action === "notificada" && /A Laura Gómez por App \(enviado\), correo \(enviado\), WhatsApp \(enviado\)/.test(x.detail)));
});

test("without the box only the bell notice goes, as before; «Notificar» resends later", async () => {
  const before = sent.length;
  const t = (await admin.call("POST", "/tasks", { case_id: k.id, title: "Preparar alegatos", due_at: "2030-03-02 17:00", assigned_user_id: laura.id })).body;
  assert.equal(t.notice, undefined);
  assert.equal(sent.length, before);
  const r = await admin.call("POST", `/tasks/${t.id}/notify`, { email: true });
  assert.equal(r.status, 200);
  assert.equal(sent.length, before + 1);
  assert.equal(r.body.to.email, "laura@firma.co");
});

test("a task with nobody in charge cannot be notified; a closed one neither", async () => {
  const t = (await admin.call("POST", "/tasks", { case_id: k.id, title: "Sin responsable", due_at: "2030-03-03 17:00" })).body;
  const r = await admin.call("POST", `/tasks/${t.id}/notify`, {});
  assert.equal(r.status, 400);
  assert.match(r.body.error, /no tiene funcionario asignado/);
  await admin.call("PUT", `/tasks/${t.id}`, { status: "hecha" });
  assert.equal((await admin.call("POST", `/tasks/${t.id}/notify`, {})).status, 400);
  // The case's responsible gets it when the task has no assignee of its own.
  await admin.call("PUT", `/cases/${k.id}`, { assigned_user_id: laura.id });
  const t2 = (await admin.call("POST", "/tasks", { case_id: k.id, title: "Para el responsable", due_at: "2030-03-04 17:00", notify: { email: false } })).body;
  assert.equal(t2.notice.to.id, laura.id);
  assert.deepEqual(t2.notice.results.map((x) => x.channel), ["app"]);
});
