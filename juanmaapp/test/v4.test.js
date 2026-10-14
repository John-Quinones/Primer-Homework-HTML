import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { setFetch } from "../src/ramajudicial.js";
import { setTransports } from "../src/notify.js";
import { taskReminders, bogota, buildReport, startScheduler } from "../src/monitor.js";

process.env.RAMA_PAUSE_MS = "0";
let srv, admin, ibague, lab;
before(async () => {
  srv = await startServer();
  admin = await srv.setup();
  ibague = (await admin.call("GET", "/admin/offices")).body[0];
  lab = (await admin.call("GET", "/catalog")).body.find((c) => c.name === "Laboral");
});
after(() => srv.close());

test("courts import normalizes places, infers areas and filters by department, city and area", async () => {
  const rows = [
    ...[1, 2, 3, 4, 5, 6].map((n) => ({ name: `Juzgado 00${n} Laboral del Circuito de Ibagué`, department: "TOLIMA", city: "IBAGUE", email: `j0${n}lctoiba@cendoj.ramajudicial.gov.co` })),
    { name: "Juzgado 001 Civil Municipal de Ibagué", department: "Tolima", city: "Ibagué", email: "j01cmpalibague@cendoj.ramajudicial.gov.co" },
    { name: "Juzgado 001 Laboral del Circuito de Neiva", department: "Huila", city: "Neiva", email: "j01lcneiva@cendoj.ramajudicial.gov.co" },
    { name: "Sin departamento", department: "Atlantida", city: "X" },
  ];
  const r = await admin.call("POST", "/courts/import", { rows });
  assert.deepEqual([r.body.created, r.body.updated, r.body.skipped.length], [8, 0, 1]);
  const again = await admin.call("POST", "/courts/import", { rows: rows.slice(0, 2) });
  assert.equal(again.body.updated, 2);
  const lab6 = (await admin.call("GET", "/courts?department=Tolima&city=Ibagu%C3%A9&area=Laboral")).body;
  assert.equal(lab6.length, 6);
  assert.equal(lab6[0].city_code, "73001");
  assert.equal((await admin.call("GET", "/courts?department=Tolima")).body.length, 7);
  assert.equal((await admin.call("GET", "/courts?department=Huila&area=Laboral")).body.length, 1);
});

let caseId, client;
test("a case with a 23-digit radicado gets department and city; court fills name and e-mail", async () => {
  client = (await admin.call("POST", "/clients", { full_name: "Pedro Pérez", department: "TOLIMA", city: "ibague" })).body;
  assert.deepEqual([client.department, client.city], ["Tolima", "Ibagué"]);
  assert.equal((await admin.call("POST", "/clients", { full_name: "X", department: "Atlantida" })).status, 400);
  const court = (await admin.call("GET", "/courts?city=Ibagu%C3%A9&area=Laboral")).body[0];
  assert.equal((await admin.call("POST", "/cases", { client_id: client.id, process_type_id: lab.types[0].id, radicado: "123" })).status, 400);
  const k = (await admin.call("POST", "/cases", {
    client_id: client.id, process_type_id: lab.types[0].id, radicado: "73001-31-05-001-2023-00123-00", court_id: court.id,
    assigned_user_id: (await admin.call("GET", "/auth/status")).body.user.id,
  })).body;
  caseId = k.id;
  assert.equal(k.radicado, "73001310500120230012300");
  assert.deepEqual([k.department, k.city, k.area, k.court_name, k.monitor], ["Tolima", "Ibagué", "Laboral", court.name, 1]);
  assert.equal(k.court_email, court.email);
});

test("tasks and hearings: CRUD, scope and reminders once per window", async () => {
  const soon = bogota(new Date(Date.now() + 20 * 3600 * 1000));
  const t = await admin.call("POST", "/tasks", { case_id: caseId, kind: "audiencia", title: "Audiencia inicial", due_at: soon, location: "Sala 3", remind_days: [1, 3] });
  assert.equal(t.status, 201);
  assert.deepEqual(t.body.remind_days, [3, 1]);
  assert.equal((await admin.call("POST", "/tasks", { case_id: caseId, title: "X", due_at: "mañana" })).status, 400);
  assert.equal((await admin.call("GET", `/tasks?caseId=${caseId}`)).body.length, 1);
  const first = taskReminders(srv.db);
  const second = taskReminders(srv.db);
  assert.equal(first, 2, "1-day and 3-day windows are both open");
  assert.equal(second, 0, "reminders fire once");
  const notes = (await admin.call("GET", "/notifications")).body;
  assert.ok(notes.items.some((n) => n.title.startsWith("Audiencia mañana")));
  assert.ok(notes.unread >= 2);
  await admin.call("POST", "/notifications/read", {});
  assert.equal((await admin.call("GET", "/notifications")).body.unread, 0);
  const done = await admin.call("PUT", `/tasks/${t.body.id}`, { status: "hecha" });
  assert.equal(done.body.status, "hecha");
  assert.ok(done.body.done_at);
});

test("Rama Judicial check: baseline first, then only new actions count; report and delivery", async () => {
  let acts = [
    { idRegActuacion: 1, fechaActuacion: "2026-09-01T00:00:00", actuacion: "Radicación de proceso", anotacion: "" },
    { idRegActuacion: 2, fechaActuacion: "2026-09-10T00:00:00", actuacion: "Auto admite demanda", anotacion: "Notificar" },
  ];
  const calls = [];
  setFetch(async (url) => {
    calls.push(url);
    const body = url.includes("NumeroRadicacion")
      ? { procesos: [{ idProceso: 999, llaveProceso: "73001310500120230012300", despacho: "JUZGADO 001 LABORAL", fechaUltimaActuacion: "2026-09-10" }] }
      : { actuaciones: acts, paginacion: { cantidadPaginas: 1 } };
    return { ok: true, json: async () => body };
  });
  const c1 = (await admin.call("POST", "/monitor/check", { case_ids: [caseId] })).body;
  assert.deepEqual([c1.ok, c1.newCount], [1, 0]);
  assert.ok(calls[0].includes("numero=73001310500120230012300"));
  await new Promise((r) => setTimeout(r, 1100)); // separate check timestamps
  acts = [{ idRegActuacion: 3, fechaActuacion: "2026-10-13T00:00:00", actuacion: "Fija fecha de audiencia", anotacion: "Audiencia el 20 de noviembre" }, ...acts];
  const c2 = (await admin.call("POST", "/monitor/check", { case_ids: [caseId] })).body;
  assert.equal(c2.newCount, 1);
  assert.equal(calls.filter((u) => u.includes("NumeroRadicacion")).length, 1, "process id is cached");
  const list = (await admin.call("GET", "/monitor/cases")).body;
  assert.equal(list[0].new_7d, 1);
  assert.equal(list[0].last_action_date, "2026-10-13");
  assert.equal((await admin.call("GET", `/monitor/cases/${caseId}/actuaciones`)).body.length, 3);

  // Error path is recorded, not thrown.
  setFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));
  const c3 = (await admin.call("POST", "/monitor/check", { case_ids: [caseId] })).body;
  assert.equal(c3.ok, 0);
  assert.match(c3.results[0].error, /503/);

  // Preferences and manual report through stubbed channels.
  const sent = [];
  setTransports({
    mail: { sendMail: async (m) => { sent.push(["email", m.to, m.subject]); } },
    whatsapp: async (phone, text) => { sent.push(["whatsapp", phone, text.slice(0, 20)]); return { channel: "whatsapp", ok: true, detail: phone }; },
  });
  process.env.SMTP_HOST = "smtp.test"; process.env.MAIL_FROM = "app@firma.co";
  assert.equal((await admin.call("PUT", "/monitor/prefs", { hours: ["07:00", "13:00", "09:00"], by_whatsapp: true, whatsapp: "123" })).status, 400);
  const prefs = (await admin.call("PUT", "/monitor/prefs", { hours: ["07:00", "13:00", "09:00"], by_email: true, by_whatsapp: true, whatsapp: "300 123 4567", scope: "mine" })).body;
  assert.deepEqual(prefs.hours, ["07:00", "13:00"]);
  const rep = (await admin.call("POST", "/monitor/report", {})).body;
  assert.equal(rep.newCount, 1);
  assert.match(rep.text, /Fija fecha de audiencia/);
  assert.match(rep.text, /NO SE PUDIERON CONSULTAR/);
  assert.deepEqual(rep.channels.map((c) => [c.channel, c.ok]), [["email", true], ["whatsapp", true]]);
  assert.deepEqual(sent.map((x) => x[0]), ["email", "whatsapp"]);
  assert.equal(sent[0][1], "gerencia@firma.co");
  // The next report starts after this one: the same action is not repeated.
  assert.equal(buildReport(srv.db, prefs.user_id).newCount, 0);
  assert.equal((await admin.call("GET", "/monitor/log")).body.length, 1);
});

test("custom roles and per-user permission checklist", async () => {
  assert.equal((await admin.call("POST", "/admin/roles", { name: "Abogado" })).status, 409);
  const role = await admin.call("POST", "/admin/roles", { name: "Practicante", copy_from: "Asistente" });
  assert.equal(role.status, 201);
  assert.ok(role.body.permissions.includes("clients.write"));
  const u = (await admin.call("POST", "/admin/users", { name: "Pra", email: "pra@firma.co", role: "Practicante", office_ids: [ibague.id], password: "clave-segura-3" })).body;
  assert.equal(u.role, "Practicante");
  assert.equal((await admin.call("DELETE", "/admin/roles/Practicante")).status, 409, "role in use");
  assert.equal((await admin.call("DELETE", "/admin/roles/Abogado")).status, 409, "built-in");
  // Custom checklist replaces the role's permissions for this user only.
  const custom = (await admin.call("PUT", `/admin/users/${u.id}`, { custom_permissions: true, permissions: ["reports.view", "nope"] })).body;
  assert.deepEqual(custom.permissions, ["reports.view"]);
  const pra = await srv.login("pra@firma.co", "clave-segura-3");
  assert.equal((await pra.call("POST", "/clients", { full_name: "X" })).status, 403);
  assert.equal((await pra.call("GET", "/reports/clientes")).status, 200);
  // Renaming a custom role moves its users.
  await admin.call("PUT", "/admin/users/" + u.id, { custom_permissions: false });
  const ren = await admin.call("PUT", "/admin/roles/Practicante", { name: "Judicante" });
  assert.equal(ren.body.role, "Judicante");
  assert.equal((await admin.call("GET", "/admin/users")).body.find((x) => x.id === u.id).role, "Judicante");
  const roles = (await admin.call("GET", "/admin/roles")).body;
  assert.ok(roles.roles.includes("Judicante"));
  assert.ok(roles.matrix.Abogado.includes("processes.consult"));
});

test("scheduler sends reports at the chosen hour only, once", async () => {
  const before = (await admin.call("GET", "/monitor/log")).body.length;
  const sched = startScheduler(srv.db, { intervalMs: 3600000 });
  const at = (hhmm) => new Date(Date.parse(`2026-10-15T${hhmm}:00-05:00`));
  await sched.tick(at("12:00"));
  assert.equal((await admin.call("GET", "/monitor/log")).body.length, before, "12:00 is not a report hour");
  await sched.tick(at("13:00"));
  await sched.tick(at("13:00"));
  const log = (await admin.call("GET", "/monitor/log")).body;
  assert.equal(log.length, before + 1);
  assert.equal(log[0].trigger, "13:00");
  await sched.tick(at("17:00"));
  assert.equal((await admin.call("GET", "/monitor/log")).body.length, before + 1, "17:00 was not chosen");
  sched.stop();
});
