import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { courtCircuit, courtMatches } from "../src/case-meta.js";

let srv, admin;
before(async () => { srv = await startServer(); admin = await srv.setup(); });
after(() => srv.close());

test("circuit comes from the file's column or from the court's name", () => {
  assert.equal(courtCircuit("Juzgado 003 Civil del Circuito de Ibagué"), "Ibagué");
  assert.equal(courtCircuit("Juzgado 001 Promiscuo Municipal de Alvarado", "Circuito de Ibagué"), "Ibagué");
  assert.equal(courtCircuit("Juzgado 002 Civil Municipal de Ibagué"), "");
  assert.ok(courtMatches({ department: "Tolima", city: "Alvarado", circuit: "Ibagué", area: "Promiscuo" }, { department: "Tolima", city: "Ibague", area: "Civil" }));
  assert.ok(!courtMatches({ department: "Tolima", city: "Ibagué", circuit: "", area: "Laboral" }, { city: "Ibagué", area: "Civil" }));
});

test("courts are segmented by department, city or circuit, and area", async () => {
  const rows = [
    { name: "Juzgado 003 Civil del Circuito de Ibagué", department: "Tolima", city: "Ibagué" },
    { name: "Juzgado 002 Civil Municipal de Ibagué", department: "Tolima", city: "Ibagué" },
    { name: "Juzgado 001 Laboral del Circuito de Ibagué", department: "Tolima", city: "Ibagué" },
    { name: "Juzgado 001 Promiscuo Municipal de Alvarado", department: "Tolima", city: "Alvarado", circuit: "Ibagué" },
    { name: "Juzgado 001 Civil del Circuito de Espinal", department: "Tolima", city: "Espinal" },
    { name: "Juzgado 001 Civil Municipal de Neiva", department: "Huila", city: "Neiva" },
  ];
  const imp = await admin.call("POST", "/courts/import", { rows });
  assert.equal(imp.body.created, 6);
  const get = async (q) => (await admin.call("GET", `/courts?${new URLSearchParams(q)}`)).body.map((c) => c.name).sort();
  assert.deepEqual(await get({ department: "Tolima", city: "Ibagué", area: "Civil" }), [
    "Juzgado 001 Promiscuo Municipal de Alvarado", "Juzgado 002 Civil Municipal de Ibagué", "Juzgado 003 Civil del Circuito de Ibagué"]);
  assert.deepEqual(await get({ department: "Tolima", city: "Ibagué", area: "Laboral" }), [
    "Juzgado 001 Laboral del Circuito de Ibagué", "Juzgado 001 Promiscuo Municipal de Alvarado"]);
  assert.equal((await get({ department: "Tolima" })).length, 5);
  assert.deepEqual(await get({ department: "Huila", area: "Civil" }), ["Juzgado 001 Civil Municipal de Neiva"]);
});

test("a Word template can get a new file (its blanks turned into variables)", async () => {
  const pk = Buffer.from("PK\u0003\u0004 first").toString("base64");
  const t = await admin.call("POST", "/templates", { name: "Poder minuta", category: "Poder", filename: "poder.docx", file_base64: pk });
  assert.equal(t.status, 201);
  const next = Buffer.from("PK\u0003\u0004 second").toString("base64");
  const u = await admin.call("PUT", `/templates/${t.body.id}`, { file_base64: next, description: "Minuta de Word · 3 dato(s)" });
  assert.equal(u.status, 200);
  const f = await admin.call("GET", `/templates/${t.body.id}/file`);
  assert.equal(f.body.base64, next);
  assert.equal((await admin.call("PUT", `/templates/${t.body.id}`, { file_base64: Buffer.from("nope").toString("base64") })).status, 400);
});
