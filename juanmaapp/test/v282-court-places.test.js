import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { canonicalDepartment, cityFromText } from "../src/places.js";

let srv, admin;
before(async () => { srv = await startServer(); admin = await srv.setup(); });
after(() => srv.close());

test("department abbreviations and messy cells from the official file are recognized", () => {
  for (const v of ["N. De Santander", "N. de Santander", "Norte de Santander", "Norte Santander", "NORTE DE SANTANDER", "N de S"]) assert.equal(canonicalDepartment(v), "Norte de Santander", v);
  assert.equal(canonicalDepartment("Bogotá D.C."), "Bogotá, D.C.");
  assert.equal(canonicalDepartment("Valle"), "Valle del Cauca");
  assert.equal(canonicalDepartment("906 Y 1098) - Cundinamarca - Mosquera"), "Cundinamarca");
  assert.equal(canonicalDepartment("Santander"), "Santander");
  assert.equal(canonicalDepartment("Narnia"), "");
  assert.equal(cityFromText("906 Y 1098) - Cundinamarca - Mosquera", "Cundinamarca"), "Mosquera");
});

test("import keeps the skipped rows' reason, recovers messy cells and a re-import adds no duplicates", async () => {
  const rows = [
    { rowNumber: 2, name: "Juzgado 001 Civil Municipal", department: "906 Y 1098) - Cundinamarca - Mosquera", city: "", area: "Civil" },
    { rowNumber: 3, name: "Juzgado 001 Civil Municipal de Cúcuta", department: "N. De Santander", city: "Cúcuta", area: "Civil" },
    { rowNumber: 4, name: "Juzgado X", department: "Narnia", city: "" },
  ];
  const a = (await admin.call("POST", "/courts/import", { rows })).body;
  assert.deepEqual([a.created, a.updated, a.skipped.length], [2, 0, 1]);
  assert.match(a.skipped[0].reason, /Narnia/);
  const b = (await admin.call("POST", "/courts/import", { rows })).body;
  assert.deepEqual([b.created, b.updated], [0, 2]);
  const list = (await admin.call("GET", "/courts?department=Cundinamarca")).body;
  assert.equal(list.find((c) => c.name === "Juzgado 001 Civil Municipal").city, "Mosquera");
});
