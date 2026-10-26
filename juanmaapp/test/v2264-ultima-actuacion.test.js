// Version 2.2.64: {{actuacion.ultima*}} (last Rama Judicial actuación saved in the case) and {{expediente.demandantes}}.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lastActuacionVariables, plaintiffNames } from "../src/case-meta.js";

test("last actuación: newest by date, ties by last saved; nothing without actuaciones", () => {
  assert.deepEqual(lastActuacionVariables([]), {});
  assert.deepEqual(lastActuacionVariables(null), {});
  const v = lastActuacionVariables([
    { id: 1, fecha: "2023-07-28", actuacion: "Auto admite recurso", anotacion: "" },
    { id: 3, fecha: "2026-03-09", actuacion: "Fijacion estado", anotacion: "Estado No. 12" },
    { id: 2, fecha: "2026-03-09", actuacion: "Registro de proyecto", anotacion: "" },
  ]);
  assert.equal(v["actuacion.ultima"], "Fijacion estado");
  assert.equal(v["actuacion.ultima_fecha"], "9 de marzo de 2026");
  assert.equal(v["actuacion.ultima_anotacion"], "Estado No. 12");
  assert.equal(v["actuacion.ultima_linea"], "Fijacion estado (Estado No. 12), de fecha 9 de marzo de 2026");
});

test("plaintiff names", () => {
  assert.equal(plaintiffNames([]), "");
  assert.equal(plaintiffNames([{ side: "activa", name: "Ana" }, { side: "pasiva", name: "X" }]), "Ana");
  assert.equal(plaintiffNames(JSON.stringify([{ side: "activa", name: "Ana" }, { side: "activa", name: "Luis" }])), "Ana y Luis");
  assert.equal(plaintiffNames([{ side: "activa", name: "Ana" }, { side: "activa", name: "Luis" }, { side: "activa", name: "Eva" }]), "Ana y otros");
});
