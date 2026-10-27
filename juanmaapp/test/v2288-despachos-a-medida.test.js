import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

let srv, admin;
before(async () => { srv = await startServer(); admin = await srv.setup(); });
after(() => srv.close());

const official = { name: "Juzgado 001 Civil Municipal de Ibagué", department: "Tolima", city: "Ibagué", area: "Civil", email: "j01@cendoj.ramajudicial.gov.co" };
const byHand = { name: "Grupo de Control Disciplinario Interno", department: "Tolima", city: "Ibagué", area: "Disciplinario Interno", email: "gcdi@policia.gov.co", phone: "608 1" };

test("Gerencia creates a court by hand; it shows in the case picker and the official Excel neither duplicates nor overwrites it", async () => {
  await admin.call("POST", "/courts/import", { rows: [official] });
  const made = await admin.call("POST", "/courts", byHand);
  assert.equal(made.status, 201);
  assert.equal(made.body.custom, 1);
  const list = async (area) => (await admin.call("GET", `/courts?${new URLSearchParams({ department: "Tolima", city: "Ibagué", area })}`)).body.map((c) => c.name);
  assert.deepEqual(await list("Disciplinario Interno"), [byHand.name]);
  assert.equal((await admin.call("POST", "/courts", byHand)).status, 409);

  // The Excel brings the same name with another area and no e-mail: name, area and e-mail stay as typed.
  const out = (await admin.call("POST", "/courts/import", { rows: [official, { ...byHand, area: "Civil", email: "", phone: "999", address: "Calle 1" }] })).body;
  assert.equal(out.created, 0);
  const after = (await admin.call("GET", "/courts?q=Control Disciplinario")).body;
  assert.equal(after.length, 1);
  assert.equal(after[0].area, "Disciplinario Interno");
  assert.equal(after[0].email, "gcdi@policia.gov.co");
  assert.equal(after[0].phone, "608 1");
  assert.equal(after[0].address, "Calle 1");
  // Replacing the whole directory keeps the hand-made one.
  await admin.call("POST", "/courts/import", { rows: [official], replace: true });
  assert.equal((await admin.call("GET", "/courts?q=Control Disciplinario")).body.length, 1);
});

test("edit and switch off a hand-made court; official ones are not editable; the administrator adds an area", async () => {
  const c = (await admin.call("GET", "/courts?q=Control Disciplinario")).body[0];
  const ed = await admin.call("PUT", `/courts/${c.id}`, { ...byHand, name: "Grupo de Control Disciplinario Interno MEBOG" });
  assert.equal(ed.body.name, "Grupo de Control Disciplinario Interno MEBOG");
  const off = (await admin.call("GET", "/courts?q=official-none")).body;
  assert.equal(off.length, 0);
  await admin.call("PUT", `/courts/${c.id}/active`, { active: false });
  assert.equal((await admin.call("GET", "/courts?q=Control Disciplinario")).body.length, 0);
  assert.equal((await admin.call("GET", "/courts?q=Control Disciplinario&all=1")).body[0].active, 0);
  await admin.call("PUT", `/courts/${c.id}/active`, { active: true });
  assert.equal((await admin.call("GET", "/courts?q=Control Disciplinario")).body.length, 1);

  const o = (await admin.call("GET", "/courts?q=001 Civil Municipal de Ibagué")).body[0];
  assert.equal((await admin.call("PUT", `/courts/${o.id}`, byHand)).status, 400);
  assert.equal((await admin.call("PUT", `/courts/${o.id}/active`, { active: false })).status, 400);

  assert.equal((await admin.call("POST", "/courts", { ...byHand, name: "Juzgado 3 Penal Militar", area: "Control Interno" })).status, 400);
  assert.equal((await admin.call("POST", "/courts/areas", { name: "Control Interno" })).status, 201);
  assert.ok((await admin.call("GET", "/courts/meta")).body.areas.includes("Control Interno"));
  assert.equal((await admin.call("POST", "/courts", { ...byHand, name: "Juzgado 3 Penal Militar", area: "Control Interno" })).status, 201);
});
