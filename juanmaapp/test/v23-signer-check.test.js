import { test } from "node:test";
import assert from "node:assert/strict";
import { signerProblem, signersProblem, mobileDigits } from "../src/person.js";

test("change 61: signer document and mobile must look real", () => {
  const lina = { name: "Lina Rojas", email: "rojas.lina2014@gmail.com", otp_channel: "email" };
  assert.equal(signerProblem({ ...lina, id_number: "5555", phone: "3001234567" }).field, "id_number");
  assert.equal(signerProblem({ ...lina, id_number: "52.123.456", phone: "5555" }).field, "phone");
  assert.equal(signerProblem({ ...lina, id_number: "3001234567", phone: "300 123 4567" }).field, "phone", "same number twice");
  assert.equal(signerProblem({ ...lina, id_number: "52.123.456", phone: "+57 300 123 4567" }), null);
  assert.equal(signerProblem({ ...lina, id_number: "AB123456" }), null, "passport");
  assert.equal(signerProblem({ name: "Lina Rojas", otp_channel: "whatsapp" }, { remote: true }).field, "phone");
  assert.equal(signerProblem({ name: "Lina Rojas", email: "mal@", otp_channel: "email" }).field, "email");
  const dup = signersProblem([{ ...lina, id_number: "52123456" }, { name: "Otra Persona", id_number: "52.123.456" }]);
  assert.deepEqual([dup.index, dup.field], [1, "id_number"]);
  assert.equal(mobileDigits("300 123 4567"), "573001234567");
  assert.equal(mobileDigits("+1 212 555 0100"), "12125550100");
  assert.equal(mobileDigits("5555"), "");
});
