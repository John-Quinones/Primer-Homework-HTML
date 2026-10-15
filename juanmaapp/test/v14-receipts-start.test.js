import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { nextReceiptNumber, collectionWindow, colombianHolidays } from "../src/ledger.js";

let srv, admin;
before(async () => { srv = await startServer(); admin = await srv.setup(); });
after(() => srv.close());

test("receipts are numbered consecutively from 1155", async () => {
  const c = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Recibo", last_names: "Prueba", id_number: "1" })).body;
  assert.equal((await admin.call("GET", "/payments/settings")).body.receipt_next, 1155);
  const a = await admin.call("POST", "/payments/receipts", { client_id: c.id, amount: 100000, paid_on: "2026-10-01", method: "Efectivo" });
  const b = await admin.call("POST", "/payments/receipts", { client_id: c.id, amount: 50000, paid_on: "2026-10-02", method: "Efectivo" });
  assert.deepEqual([a.body.number, b.body.number], [1155, 1156]);
  await admin.call("PUT", "/payments/settings", { receipt_start: 1000 });
  assert.equal((await admin.call("GET", "/payments/settings")).body.receipt_next, 1157, "never goes back");
  assert.equal(nextReceiptNumber(0, 1155), 1155);
});

test("Ley 2300 de 2023 collection window and Colombian holidays", () => {
  assert.ok(colombianHolidays(2026).has("2026-05-18"), "Ascensión moved to Monday");
  assert.ok(!collectionWindow("2026-10-18 10:00").ok, "Sunday");
  assert.ok(!collectionWindow("2026-10-12 10:00").ok, "Día de la Raza");
  assert.ok(!collectionWindow("2026-10-17 15:30").ok, "Saturday after 3 p.m.");
  assert.ok(collectionWindow("2026-10-17 09:00").ok);
  assert.ok(!collectionWindow("2026-10-15 19:05").ok);
  assert.ok(collectionWindow("2026-10-15 07:00").ok);
});
