// Version 2.2.39: more phone numbers per client, the same on the server and the published link.
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

test("extra phones: formatted, no repeats, kept when an edit leaves them out, searchable", async () => {
  const out = await same(async (call) => {
    const a = (await call("POST", "/clients", { full_name: "Ana Teléfonos", id_number: "8101", phone: "3001112233",
      extra_phones: [{ label: " Esposa ", phone: "3222531327" }, { label: "Dup", phone: "322 253 1327" }, { label: "", phone: "" }, { label: "Trabajo", phone: "608 261 4172" }] })).body;
    const none = (await call("POST", "/clients", { full_name: "Luis Sin", id_number: "8102" })).body;
    const kept = (await call("PUT", `/clients/${a.id}`, { notes: "x" })).body;
    const found = (await call("GET", "/clients?q=253 1327")).body.map((c) => c.id === a.id);
    const cleared = (await call("PUT", `/clients/${a.id}`, { extra_phones: [] })).body;
    return [JSON.parse(a.extra_phones), none.extra_phones, kept.extra_phones === a.extra_phones, kept.phone, found, cleared.extra_phones];
  });
  assert.deepEqual(out[0], [{ label: "Esposa", phone: "322 253 1327" }, { label: "Trabajo", phone: "608 261 4172" }]);
  assert.equal(out[1], "");
  assert.equal(out[2], true);
  assert.equal(out[3], "300 111 2233");
  assert.deepEqual(out[4], [true]);
  assert.equal(out[5], "");
});

test("extra phones: more than 10 is refused", async () => {
  await same(async (call) => {
    const many = Array.from({ length: 11 }, (_, i) => ({ label: "", phone: `31000000${String(i).padStart(2, "0")}` }));
    const r = await call("POST", "/clients", { full_name: "Muchos", id_number: "8103", extra_phones: many });
    assert.equal(r.status, 400);
    return r.status;
  });
});
