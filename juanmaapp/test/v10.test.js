import { test } from "node:test";
import assert from "node:assert/strict";
import { PORTALS, portalOrder, radicadoDigits } from "../src/portals.js";
import { asGlobal } from "../src/browser-module.js";

test("portals: the five official sites (Siglo XXI, TYBA, SIUGJ, Publicaciones, SAMAI), each with a how-to", () => {
  assert.deepEqual(PORTALS.map((p) => p.id), ["cpnu", "tyba", "siugj", "publicaciones", "samai"]);
  for (const p of PORTALS) assert.match(p.url, /^https:\/\/[a-z.]+\.gov\.co\//);
  assert.deepEqual(PORTALS.filter((p) => p.auto).map((p) => p.id), ["cpnu"]);
});

test("portals: administrative radicados go to SAMAI first, the rest to the Rama Judicial", () => {
  assert.equal(radicadoDigits("73001-33-33-004-2019-00123-00"), "73001333300420190012300");
  assert.equal(radicadoDigits("123"), "");
  assert.equal(portalOrder("73001-33-33-004-2019-00123-00")[0], "samai");
  assert.equal(portalOrder("73001233300020200015600")[0], "samai");
  assert.equal(portalOrder("11001031500020211095200")[0], "samai");
  assert.equal(portalOrder("73001310300120190012300")[0], "cpnu");
  assert.equal(portalOrder("")[0], "cpnu");
  assert.equal(portalOrder("", "Administrativo")[0], "samai", "no radicado: the process type decides");
  assert.equal(portalOrder("73001310500120250012300")[0], "siugj", "labor case filed in 2025");
  assert.equal(portalOrder("73001310500120230012300")[0], "cpnu", "older labor case");
});

test("portals: served to the page as a global", () => {
  const js = asGlobal(new URL("../src/portals.js", import.meta.url).pathname, "JuanmaPortals");
  const window = {};
  new Function("window", js)(window);
  assert.equal(window.JuanmaPortals.portalOrder("73001333300420190012300")[0], "samai");
});

test("decision: autos and sentencias are read from the actuación, other records are not", async () => {
  const { decisionOf } = await import("../src/decision.js");
  assert.deepEqual(decisionOf({ actuacion: "AUTO ADMITE DEMANDA", anotacion: "SE ADMITE Y SE ORDENA NOTIFICAR" }),
    { kind: "Auto", text: "Auto admite demanda: SE ADMITE Y SE ORDENA NOTIFICAR" });
  assert.deepEqual(decisionOf({ actuacion: "Sentencia de primera instancia", anotacion: "Actuación registrada el 10/09/2026 a las 10:15:02." }),
    { kind: "Sentencia", text: "Sentencia de primera instancia" });
  assert.equal(decisionOf({ actuacion: "Auto libra mandamiento de pago", anotacion: "" }).kind, "Auto");
  for (const actuacion of ["Recepción memorial", "Radicación de proceso", "Al despacho", "Fijacion estado", "Constancia secretarial"]) {
    assert.equal(decisionOf({ actuacion, anotacion: "auto" }), null, actuacion);
  }
});

test("decision: a fijación de estado points to the auto it notifies", async () => {
  const { withDecisions } = await import("../src/decision.js");
  const out = withDecisions([
    { fecha: "2026-10-02", actuacion: "Fijacion estado", anotacion: "Actuación registrada el 02/10/2026", fecha_inicial: "2026-10-03", fecha_final: "2026-10-03" },
    { fecha: "2026-10-01", actuacion: "Auto inadmite demanda", anotacion: "Concede 5 días para subsanar" },
    { fecha: "2026-09-01", actuacion: "Auto admite reforma", anotacion: "" },
    { fecha: "2026-08-01", actuacion: "Fijacion estado", anotacion: "" },
  ]);
  assert.equal(out[0].decision, "Auto inadmite demanda: Concede 5 días para subsanar");
  assert.equal(out[0].notified, "Fijacion estado 2026-10-03");
  assert.equal(out[1].notified, "Fijacion estado 2026-10-03");
  assert.equal(out[2].notified, "");
  assert.equal(out[3].decision, "", "no decision in the 15 days before");
});
