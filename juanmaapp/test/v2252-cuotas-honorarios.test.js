// Version 2.2.52: the fixed fee paid in installments; the balance is one last installment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { feeTerms, installmentPlan, parseInstallments, serializeInstallments } from "../src/ledger.js";

const D = ["2026-11-05", "2026-12-05", "2027-01-05", "2027-02-05"];

test("balance becomes one last installment", () => {
  const plan = installmentPlan(10000000, { n: 3, value: 3000000, dates: D });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.rows.map((r) => [r.name, r.amount]), [["Primera cuota", 3000000], ["Segunda cuota", 3000000], ["Tercera cuota", 3000000], ["Cuota final (saldo)", 1000000]]);
  assert.equal(plan.balance, 1000000);
});
test("exact division has no extra installment; a sum above the total is refused; a missing date is not ok", () => {
  assert.equal(installmentPlan(9000000, { n: 3, value: 3000000, dates: D }).rows.length, 3);
  assert.equal(installmentPlan(5000000, { n: 3, value: 3000000, dates: D }).over, true);
  assert.equal(installmentPlan(10000000, { n: 3, value: 3000000, dates: D.slice(0, 3) }).ok, false);
});
test("text round trip and the Word markers", () => {
  const text = serializeInstallments({ n: 2, value: 4000000, dates: D.slice(0, 3) });
  assert.deepEqual(parseInstallments(text), { n: 2, value: 4000000, dates: D.slice(0, 3), advance: 0, advanceDate: "" });
  const t = feeTerms("Mixto", "$10.000.000", "35%", text);
  assert.equal(t["honorarios.numero_cuotas"], "tres (3)");
  assert.equal(t["honorarios.cuotas"].split("\n").length, 3); // one line per installment
  assert.match(t["honorarios.cuotas"], /^Primera cuota: \$4\.000\.000 \(cuatro millones de pesos m\/cte\.\), el 5 de noviembre de 2026\./);
  assert.match(t["honorarios.cuotas"], /Cuota final \(saldo\): \$2\.000\.000/);
});
test("only with Honorarios or Mixto; off or incomplete gives no installments", () => {
  const text = serializeInstallments({ n: 2, value: 4000000, dates: D });
  assert.equal(feeTerms("Cuota de litis", "", "35%", text)["honorarios.cuotas"], undefined);
  assert.equal(feeTerms("Honorarios", "$10.000.000", "", "no")["honorarios.cuotas"], undefined);
  assert.equal(feeTerms("Honorarios", "$10.000.000", "", "2 | 4000000 | ")["honorarios.cuotas"], undefined);
});

// Version 2.3.18 (John): advance («anticipo») typed by hand, then installments, then the balance.
test("advance first, then installments, then the balance", () => {
  const text = serializeInstallments({ n: 2, value: 3000000, dates: D.slice(0, 3), advance: 1000000, advanceDate: "2026-10-30" });
  assert.deepEqual(parseInstallments(text), { n: 2, value: 3000000, dates: D.slice(0, 3), advance: 1000000, advanceDate: "2026-10-30" });
  const plan = installmentPlan(10000000, text);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.rows.map((r) => [r.name, r.amount]), [["Anticipo", 1000000], ["Primera cuota", 3000000], ["Segunda cuota", 3000000], ["Cuota final (saldo)", 3000000]]);
  const t = feeTerms("Honorarios", "$10.000.000", "", text);
  assert.equal(t["honorarios.numero_cuotas"], "tres (3)"); // the advance is not an installment
  assert.match(t["honorarios.anticipo"], /^\$1\.000\.000 \(un millón de pesos m\/cte\.\)$/);
  assert.equal(t["honorarios.anticipo_fecha"], "30 de octubre de 2026");
  assert.match(t["honorarios.cuotas"].split("\n")[0], /^Anticipo: \$1\.000\.000/);
});
test("advance alone leaves the balance as the final installment; advance above the total is refused; no advance date is not ok", () => {
  const plan = installmentPlan(5000000, { n: 0, value: 0, dates: ["2026-12-01"], advance: 2000000, advanceDate: "2026-10-30" });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.rows.map((r) => r.name), ["Anticipo", "Cuota final (saldo)"]);
  assert.equal(installmentPlan(1000000, { n: 0, value: 0, dates: [], advance: 2000000, advanceDate: "2026-10-30" }).over, true);
  assert.equal(installmentPlan(5000000, { n: 1, value: 1000000, dates: D, advance: 1000000, advanceDate: "" }).ok, false);
});
