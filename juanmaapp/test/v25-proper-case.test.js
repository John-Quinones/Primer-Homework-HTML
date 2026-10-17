import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { properName, properAddress, properPhone } from "../src/person.js";
import { canonicalCity } from "../src/places.js";

let srv, admin;
before(async () => { srv = await startServer(); admin = await srv.setup(); });
after(() => srv.close());

test("names, cities and addresses in proper case whatever the user types", () => {
  assert.equal(properName("JOHN"), "John");
  assert.equal(properName("john"), "John");
  assert.equal(canonicalCity("IBAGUE", "Tolima"), "Ibagué");
  assert.equal(canonicalCity("ibague", ""), "Ibagué");
  assert.equal(canonicalCity("VEREDA EL TOTUMO", "Tolima"), "Vereda El Totumo");
  assert.equal(properAddress("CRA 5 no 12b-30 BARRIO la POLA"), "Cra 5 No. 12B-30 Barrio La Pola");
  assert.equal(properAddress("calle DE LA paz # 4-56 apto 301"), "Calle de la Paz # 4-56 Apto 301");
  assert.equal(properAddress("VIA A ARMENIA KM 5"), "Via a Armenia Km 5");
});

test("clients and offices are saved with the city's accent and the address in proper case", async () => {
  const r = await admin.call("POST", "/clients", { person_type: "natural", first_names: "JOHN", last_names: "quiñones", department: "tolima", city: "IBAGUE", address: "CALLE 10 no 3-45 barrio BELÉN" });
  assert.equal(r.status, 201);
  assert.equal(r.body.full_name, "John Quiñones");
  assert.equal(r.body.city, "Ibagué");
  assert.equal(r.body.address, "Calle 10 No. 3-45 Barrio Belén");
  const o = await admin.call("POST", "/admin/offices", { name: "Sede Espinal", department: "Tolima", city: "espinal", address: "carrera 6 # 8-20" });
  assert.equal(o.body.address, "Carrera 6 # 8-20");
});

test("phones: mobile 322 253 1327 and landline 608 261 4172 however they are typed", async () => {
  for (const x of ["3222531327", "322-253-1327", "+57 322 253 1327", "573222531327", "(322) 2531327"]) assert.equal(properPhone(x), "322 253 1327");
  for (const x of ["6082614172", "608-261-4172", "+57 (608) 261 4172"]) assert.equal(properPhone(x), "608 261 4172");
  assert.equal(properPhone("+1 305 555 1234"), "+1 305 555 1234");
  assert.equal(properPhone("2614172"), "2614172");
  const r = await admin.call("POST", "/clients", { person_type: "natural", first_names: "Ana", last_names: "Ruiz", phone: "322-253-1327" });
  assert.equal(r.body.phone, "322 253 1327");
  const o = await admin.call("POST", "/admin/offices", { name: "Sede Melgar", department: "Tolima", city: "Melgar", phone: "6082614172" });
  assert.equal(o.body.phone, "608 261 4172");
});
