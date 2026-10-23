// Version 2.87: a client can be sent to «Archivo provisional» / «Archivo definitivo» and back to activo,
// the same on the server and the published link. Nothing else changes.
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

test("archive state: activo by default, provisional, definitivo, back to activo; edits keep it", async () => {
  const out = await same(async (call) => {
    const c = (await call("POST", "/clients", { full_name: "Ana Archivo", id_number: "8001" })).body;
    const states = [c.archive_status];
    for (const status of ["Archivo provisional", "Archivo definitivo", ""]) states.push((await call("PUT", `/clients/${c.id}/archive`, { status })).body.archive_status);
    await call("PUT", `/clients/${c.id}/archive`, { status: "Archivo provisional" });
    states.push((await call("PUT", `/clients/${c.id}`, { phone: "3001112233" })).body.archive_status);
    const list = (await call("GET", "/clients")).body.find((x) => x.id === c.id);
    states.push(list.archive_status, (await call("PUT", `/clients/${c.id}/archive`, { status: "Cerrado" })).status);
    return states;
  });
  assert.deepEqual(out, ["", "Archivo provisional", "Archivo definitivo", "", "Archivo provisional", "Archivo provisional", 400]);
});

test("archiving a client leaves its cases untouched", async () => {
  const out = await same(async (call) => {
    const c = (await call("POST", "/clients", { full_name: "Beto Casos", id_number: "8002" })).body;
    const type = (await call("GET", "/catalog")).body.find((g) => g.types.length).types[0].id;
    const k = (await call("POST", "/cases", { client_id: c.id, process_type_id: type })).body;
    await call("PUT", `/clients/${c.id}/archive`, { status: "Archivo definitivo" });
    const after = (await call("GET", `/cases/${k.id}`)).body;
    return [k.status, after.status, (await call("GET", `/cases?clientId=${c.id}`)).body.length];
  });
  assert.deepEqual(out, ["Activo", "Activo", 1]);
});
