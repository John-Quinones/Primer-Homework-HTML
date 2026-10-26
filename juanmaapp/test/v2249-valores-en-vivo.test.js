// Version 2.2.49: place values shown while an amount is typed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { placeValues } from "../src/ledger.js";

test("place values: highest first, zeros left out, singular for 1", () => {
  assert.equal(placeValues(10000), "1 decena de mil");
  assert.equal(placeValues(2500000), "2 unidades de millón · 5 centenas de mil");
  assert.equal(placeValues(1234), "1 unidad de mil · 2 centenas · 3 decenas · 4 unidades");
  assert.equal(placeValues(1000000), "1 unidad de millón");
  assert.equal(placeValues(100), "1 centena");
  assert.equal(placeValues(0), "");
  assert.equal(placeValues(null), "");
});
