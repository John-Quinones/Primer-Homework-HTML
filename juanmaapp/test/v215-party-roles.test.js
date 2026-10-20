import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanParties, sideRoles } from "../src/case-meta.js";

test("each party keeps its role and the role decides the side", () => {
  const { parties } = cleanParties([
    { side: "activa", role: "Demandado", name: "Banco X" },
    { side: "pasiva", role: "denunciante", name: "Ana" },
    { side: "pasiva", name: "Parte antigua sin rol" },
  ]);
  assert.deepEqual(parties.map((p) => [p.side, p.role]), [["pasiva", "Demandado"], ["activa", "Denunciante"], ["pasiva", undefined]]);
});

test("unknown roles are refused", () => {
  assert.match(cleanParties([{ side: "activa", role: "Testigo falso", name: "X" }]).error, /Rol de la parte/);
});

test("role lists follow the process and keep the others available", () => {
  const penal = sideRoles("Penal");
  assert.deepEqual(penal.activa, ["Denunciante", "Víctima"]);
  assert.deepEqual(penal.pasiva, ["Denunciado", "Indiciado", "Acusado", "Procesado"]);
  const conc = sideRoles("Conciliación");
  assert.deepEqual([conc.activa, conc.pasiva], [["Convocante"], ["Convocado"]]);
  assert.equal(cleanParties([{ side: "pasiva", role: "Querellado", name: "X" }]).error, undefined); // older cases keep their role
  const civil = sideRoles("Civil");
  assert.deepEqual([civil.activa, civil.pasiva], [["Demandante"], ["Demandado"]]);
  assert.ok(civil.others.includes("Denunciado"));
});
