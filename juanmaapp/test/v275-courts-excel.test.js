import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

let srv, admin;
before(async () => { srv = await startServer(); admin = await srv.setup(); });
after(() => srv.close());

const rows = [
  { name: "Juzgado 001 Civil Municipal de Cartagena", department: "Bolívar", city: "Cartagena", area: "Civil", email: "J01CM@cendoj.ramajudicial.gov.co" },
  { name: "Juzgado 002 Civil del Circuito de Cartagena", department: "Bolívar", city: "Cartagena", area: "Juzgado Civil", email: "j02cc@cendoj.ramajudicial.gov.co" },
  { name: "Juzgado 001 Penal Municipal de Cartagena", department: "Bolívar", city: "Cartagena", area: "Penal", email: "j01pm@cendoj.ramajudicial.gov.co" },
  { name: "Juzgado 003 de Familia de Cartagena", department: "Bolívar", city: "Cartagena", area: "Familia", email: "j03f@cendoj.ramajudicial.gov.co" },
  { name: "Juzgado 001 Laboral del Circuito de Cartagena", department: "Bolívar", city: "Cartagena", area: "", email: "j01l@cendoj.ramajudicial.gov.co" },
  { name: "Juzgado 001 Civil Municipal de Magangué", department: "Bolívar", city: "Magangué", area: "Civil", email: "" },
];

test("directory from Excel: Civil, Penal and Otros by department and city; reloading adds no duplicates and keeps e-mails", async () => {
  const out = (await admin.call("POST", "/courts/import", { rows })).body;
  assert.equal(out.created, 6);
  const names = async (area) => (await admin.call("GET", `/courts?${new URLSearchParams({ department: "Bolívar", city: "Cartagena de Indias", area })}`)).body.map((c) => c.name);
  assert.deepEqual((await names("Civil")).sort(), ["Juzgado 001 Civil Municipal de Cartagena", "Juzgado 002 Civil del Circuito de Cartagena"]);
  assert.deepEqual(await names("Penal"), ["Juzgado 001 Penal Municipal de Cartagena"]);
  assert.deepEqual((await names("Otros")).sort(), ["Juzgado 001 Laboral del Circuito de Cartagena", "Juzgado 003 de Familia de Cartagena"]);

  // Same file again, one row without e-mail: nothing duplicated, the saved e-mail stays.
  const again = (await admin.call("POST", "/courts/import", { rows: rows.map((r, i) => (i === 0 ? { ...r, email: "" } : r)) })).body;
  assert.equal(again.created, 0);
  assert.equal(again.updated, 6);
  const first = (await admin.call("GET", "/courts?q=001 Civil Municipal de Cartagena")).body[0];
  assert.equal(first.email, "j01cm@cendoj.ramajudicial.gov.co");
  assert.equal((await admin.call("GET", "/courts/meta")).body.total, 6);
});

test("«Cartagena» in the file is the municipality «Cartagena de Indias»; a court loaded before with the short city is updated, not duplicated", async () => {
  const one = { name: "Juzgado 009 Civil Municipal de Cartagena", department: "Bolívar", city: "CARTAGENA", area: "Civil", email: "j09@cendoj.ramajudicial.gov.co" };
  await admin.call("POST", "/courts/import", { rows: [one] });
  const c = (await admin.call("GET", "/courts?q=009 Civil Municipal de Cartagena")).body;
  assert.equal(c.length, 1);
  assert.equal(c[0].city, "Cartagena de Indias");
  const list = (await admin.call("GET", `/courts?${new URLSearchParams({ department: "Bolívar", city: "Cartagena de Indias", area: "Civil" })}`)).body;
  assert.ok(list.some((x) => x.name === one.name));
});

test("every area of law is configured: the area column is read from «Corporación o Área» or from the court's name", async () => {
  const mk = (name, area) => ({ name: `${name} de Cartagena`, department: "Bolívar", city: "Cartagena", area });
  await admin.call("POST", "/courts/import", { rows: [
    mk("Juzgado 001 Comercial", "Comercial"), mk("Juzgado 001 Agrario", ""), mk("Tribunal Administrativo", "Contencioso Administrativo"),
    mk("Juzgado 004 Laboral", "Laboral"), mk("Juzgado de Ejecución de Penas", ""), mk("Sala Disciplinaria", ""),
  ] });
  const by = async (n) => (await admin.call("GET", `/courts?q=${encodeURIComponent(n)}`)).body[0].area;
  assert.equal(await by("001 Comercial"), "Comercial");
  assert.equal(await by("001 Agrario"), "Agrario");
  assert.equal(await by("Tribunal Administrativo"), "Administrativo");
  assert.equal(await by("004 Laboral"), "Laboral");
  assert.equal(await by("Ejecución de Penas"), "Ejecución de Penas");
  assert.equal(await by("Disciplinaria"), "Disciplinario");
});
