// Version 2.75: «Nuevo expediente» opened after «Editar expediente» saved over the edited case (of another client).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startServer } from "./helpers.js";
import { startLink } from "./link-backend.js";

let srv, sides;
before(async () => {
  srv = await startServer();
  const server = await srv.setup();
  const link = await startLink();
  await link.call("POST", "/auth/setup", { name: "Gerente General", email: "gerencia@firma.co" });
  sides = { server: server.call, link: link.call };
});
after(() => srv.close());

test("a case is never moved to, or overwritten with the data of, another client", async () => {
  for (const [name, call] of Object.entries(sides)) {
    const type = (await call("GET", "/catalog")).body[0].types[0];
    const a = (await call("POST", "/clients", { person_type: "natural", first_names: "Rosmira", last_names: "Uno", id_number: "1001" })).body;
    const b = (await call("POST", "/clients", { person_type: "natural", first_names: "Jose", last_names: "Dos", id_number: "1002" })).body;
    const k = (await call("POST", "/cases", { client_id: a.id, process_type_id: type.id, title: "Caso A" })).body;
    // the stale form sends client B with the id of A's case
    const bad = await call("PUT", `/cases/${k.id}`, { client_id: b.id, process_type_id: type.id, title: "Caso B" });
    assert.equal(k.client_id, a.id, name);
    assert.equal(bad.status, 400, name);
    const lst0 = (await call("GET", "/cases")).body; const lst = Array.isArray(lst0) ? lst0 : lst0.cases ?? lst0.items ?? []; if (!Array.isArray(lst)) console.log(name, JSON.stringify(lst).slice(0,200));
    const after = (await call("GET", "/cases")).body.find((x) => x.id === k.id);
    assert.equal(after.title, "Caso A", name);
    assert.equal(after.client_id, a.id, name);
    // a normal edit (same client) still works
    const ok = await call("PUT", `/cases/${k.id}`, { client_id: a.id, process_type_id: type.id, title: "Caso A editado" });
    assert.equal(ok.status, 200, name);
    assert.equal(ok.body.title, "Caso A editado", name);
  }
});

test("openDialog clears hidden fields (the record id) so «Nuevo» never reuses the last «Editar»", () => {
  const src = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("function openDialog("), src.indexOf("// ---------- Change 64"));
  assert.match(fn, /input\[type=hidden\]/);
  assert.ok(fn.indexOf("input[type=hidden]") < fn.indexOf("Object.entries(values)"));
});
