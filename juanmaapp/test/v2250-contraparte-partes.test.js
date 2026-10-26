// Version 2.2.50: {{expediente.contraparte}} lists the defendant side of the case with each one's document.
import { test } from "node:test";
import assert from "node:assert/strict";
import { counterpartyText } from "../src/case-meta.js";

const P = (side, name, id_type = "", id_number = "", ours = false) => ({ side, name, id_type, id_number, ours });

test("one defendant: name and document", () => {
  assert.equal(counterpartyText([P("activa", "Ana"), P("pasiva", "Colpensiones", "NIT", "900.336.004-7")], "otro"), "Colpensiones (NIT 900.336.004-7)");
});
test("several: commas and «y», sin documento solo el nombre", () => {
  assert.equal(counterpartyText([P("pasiva", "A", "NIT", "1"), P("pasiva", "B"), P("pasiva", "C", "CC", "3")]), "A (NIT 1), B y C (CC 3)");
});
test("without parties on that side: the counterparty text; accepts the stored JSON", () => {
  assert.equal(counterpartyText([P("activa", "Ana")], " Colpensiones "), "Colpensiones");
  assert.equal(counterpartyText(JSON.stringify([P("pasiva", "X", "NIT", "9")]), "y"), "X (NIT 9)");
  assert.equal(counterpartyText("no json", ""), "");
});
