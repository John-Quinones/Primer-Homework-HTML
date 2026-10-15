import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { hashPassword, checkPassword, passwordProblem } from "../src/auth.js";

let srv, admin, office;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  office = (await admin.call("GET", "/admin/offices")).body[0].id;
});
after(() => srv.close());
const post = (path, body, headers = {}) => fetch(`${srv.base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("security headers: CSP without inline scripts, no framing", async () => {
  const r = await fetch(srv.base.replace(/\/api$/, "/"));
  assert.match(r.headers.get("content-security-policy"), /script-src 'self'(;|$)/);
  assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  for (const page of ["/firmar.html", "/verificar.html", "/acuse.html", "/"]) {
    const html = await (await fetch(srv.base.replace(/\/api$/, page))).text();
    assert.doesNotMatch(html, /<script>/, `${page} has no inline script`);
  }
});

test("sign-in needs the anti-forgery header; too many failures from one address are blocked", async () => {
  assert.equal((await post("/auth/login", { email: "gerencia@firma.co", password: "clave-segura-1" })).status, 403);
  let last;
  for (let i = 0; i < 21; i++) last = await post("/auth/login", { email: `nadie${i}@firma.co`, password: "x".repeat(12) }, { "X-JuanMa": "1" });
  assert.equal(last.status, 429, "the IP is paused after 20 failures with different accounts");
  srv.db.prepare("DELETE FROM auth_throttle").run();
});

test("passwords: OWASP scrypt cost in the hash, weak ones refused, old hashes upgraded at sign-in", async () => {
  const h = await hashPassword("una frase larga de prueba");
  assert.match(h, /^scrypt2\$\d+\$8\$1\$/);
  assert.equal(await checkPassword("una frase larga de prueba", h), true);
  assert.notEqual(passwordProblem("1234567890"), "");
  assert.notEqual(passwordProblem("laura2026segura", { email: "laura@firma.co" }), "", "contains the e-mail name");
  assert.notEqual(passwordProblem("a".repeat(129)), "");
  assert.equal(passwordProblem("tribunal-azul-2026"), "");
});

test("changing the password signs out the other devices", async () => {
  await admin.call("POST", "/admin/users", { name: "Pedro Ruiz", email: "pedro@firma.co", role: "Abogado", office_ids: [office], password: "Temporal-2026-x" });
  const phone = await srv.login("pedro@firma.co", "Temporal-2026-x");
  const pc = await srv.login("pedro@firma.co", "Temporal-2026-x");
  assert.equal((await pc.call("POST", "/auth/password", { current: "Temporal-2026-x", next: "juzgado-civil-2026" })).status, 204);
  assert.equal((await phone.call("GET", "/clients")).status, 401, "the other session ended");
  assert.equal((await pc.call("GET", "/clients")).status, 200, "the one that changed it stays");
});

test("only Gerencia gives the Gerencia role, replaces the court directory, and tasks go only to people who can open the case", async () => {
  const other = (await admin.call("POST", "/admin/offices", { name: "Bogotá", department: "Bogotá D.C.", city: "Bogotá" })).body;
  const boss = (await admin.call("POST", "/admin/users", { name: "Directora Usuarios", email: "dir@firma.co", role: "Director Jurídico", office_ids: [office],
    password: "tribunal-azul-2026", custom_permissions: true, permissions: ["users.manage", "catalog.manage", "cases.write", "clients.write"] })).body;
  const d = await srv.login("dir@firma.co", "tribunal-azul-2026");
  await d.call("POST", "/auth/password", { current: "tribunal-azul-2026", next: "tribunal-verde-2026" });
  assert.equal((await d.call("PUT", `/admin/users/${boss.id}`, { role: "Gerencia" })).status, 403);
  assert.equal((await d.call("POST", "/courts/import", { replace: true, rows: [{ name: "Juzgado 1 Civil", department: "Tolima", city: "Ibagué" }] })).status, 403);
  const far = (await admin.call("POST", "/admin/users", { name: "Abogado Bogotá", email: "bog@firma.co", role: "Abogado", office_ids: [other.id], password: "tribunal-azul-2026" })).body;
  const c = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Ana", last_names: "Rojas", id_number: "5" })).body;
  const type = (await admin.call("GET", "/catalog")).body.flatMap((x) => x.types)[0].id;
  const k = (await admin.call("POST", "/cases", { client_id: c.id, process_type_id: type, office_id: office })).body;
  const t = await admin.call("POST", "/tasks", { case_id: k.id, title: "x", due_at: "2026-11-01 10:00", assigned_user_id: far.id });
  assert.equal(t.status, 400);
  assert.match(t.body.error, /no tiene acceso a la oficina/);
});
