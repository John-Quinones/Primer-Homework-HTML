import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { clientMatches } from "../src/person.js";

let srv, admin;
before(async () => { srv = await startServer(); admin = await srv.setup(); });
after(() => srv.close());

test("client search ignores accents, case, word order and dots in documents", () => {
  const c = { full_name: "Eduardo Alfredo Urueña López", first_names: "Eduardo Alfredo", last_names: "Urueña López", id_number: "14296116", city: "Ibagué", department: "Tolima" };
  assert.ok(clientMatches(c, "lopez eduardo"));
  assert.ok(clientMatches(c, "URUENA"));
  assert.ok(clientMatches(c, "14.296.116"));
  assert.ok(clientMatches(c, "urueña", "last"));
  assert.ok(!clientMatches(c, "urueña", "first"));
  assert.ok(clientMatches(c, "eduardo", "first"));
  assert.ok(clientMatches(c, "4296", "doc"));
  assert.ok(!clientMatches(c, "eduardo", "doc"));
  assert.ok(clientMatches(c, "ibague", "city"));
  assert.ok(!clientMatches(c, "neiva"));
});

test("GET /clients searches by field", async () => {
  await admin.call("POST", "/clients", { person_type: "natural", first_names: "María José", last_names: "Torres de Cifuentes", id_type: "CC", id_number: "38.555.111", city: "Ibagué" });
  await admin.call("POST", "/clients", { person_type: "natural", first_names: "Torres", last_names: "Gómez", id_type: "CC", id_number: "1110222333" });
  const names = async (q, by = "") => (await admin.call("GET", `/clients?${new URLSearchParams({ q, by })}`)).body.map((c) => c.full_name).sort();
  assert.deepEqual(await names("torres", "last"), ["María José Torres de Cifuentes"]);
  assert.deepEqual(await names("torres", "first"), ["Torres Gómez"]);
  assert.deepEqual(await names("torres"), ["María José Torres de Cifuentes", "Torres Gómez"]);
  assert.deepEqual(await names("38555111", "doc"), ["María José Torres de Cifuentes"]);
  assert.deepEqual(await names("cifuentes maria"), ["María José Torres de Cifuentes"]);
});

test("cartera shows the exact total each client has paid, with or without charges", async () => {
  const c = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Pago", last_names: "Manual", id_number: "555" })).body;
  const r = await admin.call("POST", "/payments/receipts", { client_id: c.id, amount: 1500000, paid_on: "2025-03-01", method: "Efectivo", concept: "Pago anterior" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await admin.call("POST", "/payments/receipts", { client_id: c.id, amount: 500000, paid_on: "2025-04-01", method: "Transferencia", concept: "Abono" });
  const sum = (await admin.call("GET", "/payments/summary")).body;
  const row = sum.clients.find((x) => x.client_id === c.id);
  assert.equal(row.received, 2000000);
  assert.equal(row.credit, 2000000);
  assert.ok(sum.received_total >= 2000000);
});
