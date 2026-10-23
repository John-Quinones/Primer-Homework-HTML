// Version 2.85: the court written by hand in a case is recognised as the directory court (expedientes filter).
import { test } from "node:test";
import assert from "node:assert/strict";
import { sameCourtName } from "../src/case-meta.js";

const laboral = { name: "Juzgado 002 Laboral del Circuito de Ibagué", department: "Tolima", city: "Ibagué", circuit: "Ibagué" };
const admin = { name: "Juzgado 005 Administrativo de Ibagué", department: "Tolima", city: "Ibagué", circuit: "Ibagué" };

test("hand-written names match the directory court, ignoring accents, case, zeros, ordinals and place", () => {
  assert.ok(sameCourtName("Juzgado 02 Laboral Circuito - Tolima - Ibagué", laboral));
  assert.ok(sameCourtName("JUZGADO SEGUNDO LABORAL", laboral));
  assert.ok(sameCourtName("juzgado 05 administrativo de ibague", admin));
  assert.ok(sameCourtName("Juzgado 5 Administrativo del Circuito de Ibagué", admin));
});

test("other courts do not match", () => {
  assert.ok(!sameCourtName("Juzgado 02 Civil Municipal", laboral));
  assert.ok(!sameCourtName("Juzgado 02 Laboral Municipal", laboral));
  assert.ok(!sameCourtName("Juzgado 03 Laboral", laboral));
  assert.ok(!sameCourtName("", laboral));
});
