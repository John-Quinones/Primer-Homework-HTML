import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

let srv, admin;
before(async () => {
  srv = await startServer();
});
after(() => srv.close());

test("first run creates Gerencia; the API is closed without a session", async () => {
  const anon = srv.session();
  assert.equal((await anon.call("GET", "/auth/status")).body.setupNeeded, true);
  assert.equal((await anon.call("GET", "/clients")).status, 401);
  assert.equal((await anon.call("POST", "/auth/setup", { name: "X", email: "x@y.co", password: "corta" })).status, 400);
  admin = await srv.setup();
  const st = await admin.call("GET", "/auth/status");
  assert.equal(st.body.user.role, "Gerencia");
  assert.deepEqual(st.body.user.offices.map((o) => o.name), ["Ibagué"]);
  assert.equal((await anon.call("POST", "/auth/setup", { name: "X", email: "x@y.co", password: "clave-segura-2" })).status, 409);
});

test("mutations without the X-JuanMa header are refused (CSRF)", async () => {
  const res = await fetch(srv.base + "/clients", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: admin.cookie },
    body: JSON.stringify({ full_name: "Sin cabecera" }),
  });
  assert.equal(res.status, 403);
});

test("login rejects bad passwords and locks after 5 failures", async () => {
  for (let i = 0; i < 5; i++) assert.equal((await srv.login("gerencia@firma.co", "mala-clave-x")).loginStatus, 401);
  assert.equal((await srv.login("gerencia@firma.co", "clave-segura-1")).loginStatus, 429);
});

test("offices, users, roles and office scope", async () => {
  const ibague = (await admin.call("GET", "/admin/offices")).body[0];
  assert.equal(ibague.is_main, true);
  const bogota = (await admin.call("POST", "/admin/offices", { name: "Bogotá", city: "Bogotá" })).body;
  assert.equal((await admin.call("POST", "/admin/offices", { name: "Bogotá" })).status, 409);
  assert.equal((await admin.call("DELETE", `/admin/offices/${ibague.id}`)).status, 409);

  const mk = (name, email, role, office_ids) => admin.call("POST", "/admin/users", { name, email, role, office_ids, password: "clave-segura-9" });
  assert.equal((await mk("Sin oficina", "so@firma.co", "Abogado", [])).status, 400);
  assert.equal((await mk("Rol raro", "rr@firma.co", "Pasante", [ibague.id])).status, 400);
  const abogadoBog = (await mk("Laura Bogotá", "laura@firma.co", "Abogado", [bogota.id])).body;
  await mk("Andrés Ibagué", "andres@firma.co", "Asistente", [ibague.id]);
  await mk("Contadora", "conta@firma.co", "Director Contable", [ibague.id]);

  // Gerencia creates a client and case in each office.
  const cl1 = (await admin.call("POST", "/clients", { full_name: "Cliente Ibagué" })).body;
  const cl2 = (await admin.call("POST", "/clients", { full_name: "Cliente Bogotá", office_id: bogota.id })).body;
  assert.equal(cl1.office_name, "Ibagué");
  const lab = (await admin.call("GET", "/catalog")).body.find((c) => c.name === "Laboral");
  const t = lab.types[0].id;
  const k1 = (await admin.call("POST", "/cases", { client_id: cl1.id, process_type_id: t })).body;
  assert.equal(k1.office_name, "Ibagué");
  assert.equal((await admin.call("POST", "/cases", { client_id: cl2.id, process_type_id: t, office_id: bogota.id, assigned_user_id: (await admin.call("GET", "/admin/users")).body.find((u) => u.email === "andres@firma.co").id })).status, 400, "assignee must belong to the office");
  const k2 = (await admin.call("POST", "/cases", { client_id: cl2.id, process_type_id: t, office_id: bogota.id, assigned_user_id: abogadoBog.id })).body;
  assert.equal(k2.assigned_name, "Laura Bogotá");

  // The Bogotá lawyer sees only Bogotá.
  const laura = await srv.login("laura@firma.co", "clave-segura-9");
  assert.deepEqual((await laura.call("GET", "/clients")).body.map((c) => c.full_name), ["Cliente Bogotá"]);
  assert.deepEqual((await laura.call("GET", "/cases")).body.map((k) => k.id), [k2.id]);
  assert.equal((await laura.call("GET", `/cases/${k1.id}`)).status, 404);
  assert.equal((await laura.call("POST", "/cases", { client_id: cl2.id, process_type_id: t, office_id: ibague.id })).status, 403);
  assert.equal((await laura.call("DELETE", `/cases/${k2.id}`)).status, 403, "Abogado cannot delete cases");
  assert.equal((await laura.call("POST", "/categories", { name: "Civil" })).status, 403);
  assert.equal((await laura.call("GET", "/admin/users")).status, 403);
  assert.equal((await laura.call("GET", "/cases?mine=1")).body.length, 1);

  // Director Contable sees every office but cannot write.
  const conta = await srv.login("conta@firma.co", "clave-segura-9");
  assert.equal((await conta.call("GET", "/cases")).body.length, 2);
  assert.equal((await conta.call("POST", "/clients", { full_name: "X" })).status, 403);
  assert.equal((await conta.call("POST", "/generate", { documentType: "PETITION" })).status, 403);

  // Reports are scoped too.
  const rep = (await laura.call("GET", "/reports/expedientes")).body;
  assert.deepEqual(rep.rows.map((r) => r.client), ["Cliente Bogotá"]);
  const offices = (await conta.call("GET", "/reports/oficinas")).body;
  assert.deepEqual(offices.rows.map((r) => [r.office, r.cases]), [["Ibagué", 1], ["Bogotá", 1]]);
  assert.equal((await srv.login("andres@firma.co", "clave-segura-9")).call && (await (await srv.login("andres@firma.co", "clave-segura-9")).call("GET", "/reports/clientes")).status, 403);

  // Gerencia edits the role matrix: Asistente can now see reports.
  const asis = await admin.call("PUT", "/admin/roles/Asistente", { permissions: ["clients.write", "cases.write", "reports.view"] });
  assert.ok(asis.body.permissions.includes("reports.view"));
  const andres = await srv.login("andres@firma.co", "clave-segura-9");
  assert.equal((await andres.call("GET", "/reports/clientes")).status, 200);

  // The last active Gerencia account cannot be demoted or deactivated.
  const me = (await admin.call("GET", "/auth/status")).body.user;
  assert.equal((await admin.call("PUT", `/admin/users/${me.id}`, { active: false })).status, 409);

  // Deactivating a user ends their session.
  await admin.call("PUT", `/admin/users/${abogadoBog.id}`, { active: false });
  assert.equal((await laura.call("GET", "/cases")).status, 401);
});
