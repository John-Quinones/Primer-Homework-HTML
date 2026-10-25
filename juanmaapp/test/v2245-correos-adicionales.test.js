// Version 2.2.45: more emails per client, the same on the server and the published link.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { startLink } from "./link-backend.js";

let srv, sides;
before(async () => {
  srv = await startServer();
  const link = await startLink();
  const server = await srv.setup();
  await link.call("POST", "/auth/setup", { name: "Gerente General", email: "gerencia@firma.co" });
  sides = { server: server.call, link: link.call };
});
after(() => srv.close());

async function same(scenario) {
  const out = {};
  for (const [name, call] of Object.entries(sides)) out[name] = await scenario(call);
  assert.deepEqual(out.link, out.server);
  return out.server;
}

test("extra emails: lowercase, no repeats, kept when an edit leaves them out, searchable, main email untouched", async () => {
  const out = await same(async (call) => {
    const a = (await call("POST", "/clients", { full_name: "Ana Correos", id_number: "9101", email: "ana@correo.com",
      extra_emails: [{ label: " Esposo ", email: "Pedro@Correo.com" }, { label: "Dup", email: "pedro@correo.com" }, { label: "", email: "" }, { label: "Trabajo", email: "ana@empresa.co" }] })).body;
    const none = (await call("POST", "/clients", { full_name: "Luis Sin", id_number: "9102" })).body;
    const kept = (await call("PUT", `/clients/${a.id}`, { notes: "x" })).body;
    const found = (await call("GET", "/clients?q=empresa")).body.map((c) => c.id === a.id);
    const cleared = (await call("PUT", `/clients/${a.id}`, { extra_emails: [] })).body;
    return [JSON.parse(a.extra_emails), none.extra_emails, kept.extra_emails === a.extra_emails, kept.email, found, cleared.extra_emails];
  });
  assert.deepEqual(out[0], [{ label: "Esposo", email: "pedro@correo.com" }, { label: "Trabajo", email: "ana@empresa.co" }]);
  assert.equal(out[1], "");
  assert.equal(out[2], true);
  assert.equal(out[3], "ana@correo.com");
  assert.deepEqual(out[4], [true]);
  assert.equal(out[5], "");
});

test("extra emails: invalid format and more than 10 are refused", async () => {
  await same(async (call) => {
    const bad = await call("POST", "/clients", { full_name: "Malo", id_number: "9103", extra_emails: [{ email: "no-es-correo" }] });
    assert.equal(bad.status, 400);
    const many = Array.from({ length: 11 }, (_, i) => ({ label: "", email: `a${i}@correo.com` }));
    const r = await call("POST", "/clients", { full_name: "Muchos", id_number: "9104", extra_emails: many });
    assert.equal(r.status, 400);
    return [bad.status, r.status];
  });
});
