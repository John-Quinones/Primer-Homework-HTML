import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { setFetch } from "../src/ramajudicial.js";
import { setProbeFetch } from "../src/portal-check.js";

let srv, admin, caseId;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  const lab = (await admin.call("GET", "/catalog")).body.find((c) => c.name === "Laboral");
  const c = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Ana", last_names: "Rojas", id_number: "5" })).body;
  caseId = (await admin.call("POST", "/cases", { client_id: c.id, process_type_id: lab.types[0].id, radicado: "73001310500120230012300" })).body.id;
});
after(() => srv.close());

test("one request consults every platform: automatic ones now, the rest listed with the reason", async () => {
  setFetch(async (url) => ({ ok: true, json: async () => (url.includes("NumeroRadicacion")
    ? { procesos: [{ idProceso: 7, llaveProceso: "73001310500120230012300", despacho: "JUZGADO 001 LABORAL", fechaUltimaActuacion: "2026-09-10" }] }
    : { actuaciones: [{ idRegActuacion: 1, fechaActuacion: "2026-09-10T00:00:00", actuacion: "Auto admite demanda", anotacion: "" }], paginacion: { cantidadPaginas: 1 } }) }));
  const r = (await admin.call("POST", `/monitor/cases/${caseId}/check-all`)).body;
  assert.deepEqual(r.portals.map((p) => p.id).sort(), ["cpnu", "publicaciones", "samai", "siugj", "tyba"]);
  const cpnu = r.portals.find((p) => p.id === "cpnu");
  assert.equal(cpnu.mode, "auto");
  assert.equal(cpnu.ok, true);
  for (const p of r.portals.filter((x) => x.id !== "cpnu")) {
    assert.equal(p.mode, "manual");
    assert.ok(p.detail.length > 10, `${p.id} says why it is not automatic`);
  }
  assert.equal((await admin.call("GET", `/monitor/cases/${caseId}/actuaciones`)).body.length, 1);
});

test("connection test with the portals reports status and captcha, for Gerencia", async () => {
  setProbeFetch(async (url) => ({ status: 200, text: async () => (url.includes("Justicia21") ? "<title>TYBA</title><form><div class='g-recaptcha'></div>" : "<title>Portal</title><form></form>") }));
  const r = (await admin.call("GET", "/monitor/portal-probe")).body;
  assert.equal(r.length, 5);
  assert.equal(r.find((x) => x.id === "tyba").captcha, true);
  assert.equal(r.find((x) => x.id === "samai").captcha, false);
});
