import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

// Version 2.11: Gerencia hides a user; everything that user does reads "Asistente",
// and only the hidden-users password shows who it is.
let srv, admin, sofia, laura, sofiaId, caseId;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  const office = (await admin.call("GET", "/admin/offices")).body[0].id;
  sofiaId = (await admin.call("POST", "/admin/users", { name: "Sofía Rincón", email: "sofia@firma.co", role: "Abogado", office_ids: [office], password: "tribunal-verde-2026" })).body.id;
  await admin.call("POST", "/admin/users", { name: "Laura Gómez", email: "laura@firma.co", role: "Abogado", office_ids: [office], password: "tribunal-azul-2026" });
  sofia = await srv.login("sofia@firma.co", "tribunal-verde-2026");
  laura = await srv.login("laura@firma.co", "tribunal-azul-2026");
  const c = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Marco", last_names: "Pineda", id_number: "9" })).body;
  const type = (await admin.call("GET", "/catalog")).body.flatMap((x) => x.types)[0].id;
  caseId = (await admin.call("POST", "/cases", { client_id: c.id, process_type_id: type, title: "Ordinario", assigned_user_id: sofiaId })).body.id;
});
after(() => srv.close());

test("only Gerencia hides, and only after creating the hidden-users password", async () => {
  assert.equal((await admin.call("PUT", `/admin/users/${sofiaId}/hidden`, { hidden: true })).status, 409);
  assert.equal((await laura.call("POST", "/admin/hidden-users/password", { next: "reserva-privada-2026" })).status, 403);
  assert.equal((await admin.call("POST", "/admin/hidden-users/password", { next: "1234567890" })).status, 400);
  assert.equal((await admin.call("POST", "/admin/hidden-users/password", { next: "reserva-privada-2026" })).status, 204);
  assert.equal((await admin.call("PUT", `/admin/users/${sofiaId}/hidden`, { hidden: true })).status, 200);
  const st = (await admin.call("GET", "/admin/hidden-users")).body;
  assert.equal(st.count, 1);
  assert.equal(st.unlocked, false);
  // Changing it needs the current one.
  assert.equal((await admin.call("POST", "/admin/hidden-users/password", { current: "otra-cosa-123", next: "reserva-nueva-2026" })).status, 403);
});

test("a hidden user leaves the list and reads Asistente everywhere else", async () => {
  const list = (await admin.call("GET", "/admin/users")).body;
  assert.ok(!list.some((u) => u.id === sofiaId));
  assert.equal((await admin.call("PUT", `/admin/users/${sofiaId}`, { name: "X" })).status, 404);
  const dir = (await laura.call("GET", "/admin/users/directory")).body.find((u) => u.id === sofiaId);
  assert.equal(dir.name, "Asistente");
  assert.equal(dir.role, "Asistente");
  assert.equal((await laura.call("GET", `/cases/${caseId}`)).body.assigned_name, "Asistente");
  // What she does now.
  const t = await sofia.call("POST", "/tasks", { case_id: caseId, kind: "tarea", title: "Llamar al cliente", due_at: "2030-01-10 09:00", assigned_user_id: sofiaId });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  const task = (await laura.call("GET", `/tasks?caseId=${caseId}`)).body.find?.((x) => x.id === t.body.id) || t.body;
  assert.equal(task.created_by_name, "Asistente");
  const log = (await admin.call("GET", "/audit")).body;
  const mine = log.filter((e) => e.user_id === sofiaId);
  assert.ok(mine.length);
  assert.ok(mine.every((e) => e.user_name === "Asistente"));
  assert.ok(!JSON.stringify(log).includes("Sofía"), "the real name never shows while locked");
  // Searching her real name finds nothing.
  assert.equal((await admin.call("GET", "/audit?q=Sof%C3%ADa")).body.filter((e) => e.user_id === sofiaId).length, 0);
  // She sees her own name in her session.
  assert.equal((await sofia.call("GET", "/auth/status")).body.user.name, "Sofía Rincón");
});

test("the password shows the hidden user and the real author for 15 minutes", async () => {
  assert.equal((await admin.call("POST", "/admin/hidden-users/unlock", { password: "mala-clave-000" })).status, 403);
  assert.equal((await laura.call("POST", "/admin/hidden-users/unlock", { password: "reserva-privada-2026" })).status, 403);
  assert.equal((await admin.call("POST", "/admin/hidden-users/unlock", { password: "reserva-privada-2026" })).status, 200);
  const u = (await admin.call("GET", "/admin/users")).body.find((x) => x.id === sofiaId);
  assert.equal(u.name, "Sofía Rincón");
  assert.equal(u.hidden, true);
  const e = (await admin.call("GET", "/audit")).body.find((x) => x.user_id === sofiaId);
  assert.equal(e.user_name, "Sofía Rincón (oculto)");
  // Other people still see Asistente.
  assert.equal((await laura.call("GET", "/admin/users/directory")).body.find((x) => x.id === sofiaId).name, "Asistente");
  await admin.call("POST", "/admin/hidden-users/lock");
  assert.ok(!(await admin.call("GET", "/admin/users")).body.some((x) => x.id === sofiaId));
});

test("showing her again needs the password; nothing is deleted", async () => {
  assert.equal((await admin.call("PUT", `/admin/users/${sofiaId}/hidden`, { hidden: false })).status, 404);
  await admin.call("POST", "/admin/hidden-users/unlock", { password: "reserva-privada-2026" });
  assert.equal((await admin.call("PUT", `/admin/users/${sofiaId}/hidden`, { hidden: false })).status, 200);
  await admin.call("POST", "/admin/hidden-users/lock");
  assert.equal((await laura.call("GET", `/cases/${caseId}`)).body.assigned_name, "Sofía Rincón");
  assert.ok((await admin.call("GET", "/admin/users")).body.some((x) => x.id === sofiaId));
  const log = (await admin.call("GET", "/audit")).body;
  assert.ok(log.some((x) => x.action === "Ocultó un usuario"));
  assert.ok(log.some((x) => x.action === "Volvió a mostrar un usuario"));
});
