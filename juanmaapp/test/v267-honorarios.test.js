import { test } from "node:test";
import assert from "node:assert/strict";
import { feeTerms, fmtPesos, numeroEnLetras, pesosEnLetras, pesosFromText } from "../src/ledger.js";

test("a typed amount becomes «$2.000» whatever way it was typed", () => {
  for (const typed of ["2000", "$2000", "$ 2.000", "2,000", "2.000,00"]) assert.equal(fmtPesos(pesosFromText(typed)), "$2.000", typed);
  assert.equal(fmtPesos(pesosFromText("10000000")), "$10.000.000");
  assert.equal(pesosFromText("abc"), null);
  assert.equal(pesosFromText(""), null);
  assert.equal(pesosFromText("0"), null);
});

test("numbers in words: the refactor keeps the receipts' wording", () => {
  assert.equal(numeroEnLetras(35), "treinta y cinco");
  assert.equal(pesosEnLetras(10000000), "Diez millones de pesos m/cte.");
  assert.equal(pesosEnLetras(1), "Un peso m/cte.");
  assert.equal(pesosEnLetras(21000), "Veintiún mil pesos m/cte.");
});

test("«Honorarios» gives only the fixed fee, in number and words", () => {
  assert.deepEqual(feeTerms("Honorarios", "2000", "5000000"), {
    "honorarios.fijo": "$2.000 (dos mil pesos m/cte.)", "honorarios.modalidad": "honorarios fijos" });
});

test("«Cuota de litis» is always a percentage (version 2.2.51), never pesos or the fixed fee", () => {
  const ok = { "honorarios.litis_porcentaje": "treinta y cinco por ciento (35 %)", "honorarios.modalidad": "cuota de litis" };
  for (const typed of ["35%", "35", "35 por ciento", " 35 % "]) assert.deepEqual(feeTerms("Cuota de litis", "2000", typed), ok, typed);
  assert.deepEqual(feeTerms("Cuota de litis", "", "$5000000"), {});
  assert.deepEqual(feeTerms("Cuota de litis", "", "$40"), {});
});

test("«Mixto» needs both amounts; with one missing nothing says the modality (the Word shows it as missing)", () => {
  const both = feeTerms("Mixto", "$10.000.000", "35%");
  assert.equal(both["honorarios.modalidad"], "honorarios fijos y cuota de litis");
  assert.equal(both["honorarios.fijo"], "$10.000.000 (diez millones de pesos m/cte.)");
  assert.equal(both["honorarios.litis_porcentaje"], "treinta y cinco por ciento (35 %)");
  assert.equal(feeTerms("Mixto", "2000", "")["honorarios.modalidad"], undefined);
  assert.equal(feeTerms("Mixto", "", "35%")["honorarios.modalidad"], undefined);
  assert.deepEqual(feeTerms("", "2000", "35%"), {});
  assert.deepEqual(feeTerms("Cuota de litis", "", "150%"), {});
});
