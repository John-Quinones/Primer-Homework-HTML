import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { setFetch } from "../src/ramajudicial.js";

let srv, admin, caseId, noRad;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  const civ = (await admin.call("GET", "/catalog")).body[0];
  const c = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Luis", last_names: "Prada", id_number: "77" })).body;
  caseId = (await admin.call("POST", "/cases", { client_id: c.id, process_type_id: civ.types[0].id, radicado: "73001400300220240012300" })).body.id;
  noRad = (await admin.call("POST", "/cases", { client_id: c.id, process_type_id: civ.types[0].id })).body.id;
});
after(() => srv.close());

test("«Consultar en Rama Judicial» brings the process and its actuaciones now and keeps them", async () => {
  setFetch(async (url) => ({ ok: true, json: async () => (url.includes("/Detalle/") ? { ponente: "MARÍA PÉREZ  GÓMEZ" } : url.includes("NumeroRadicacion")
    ? { procesos: [{ idProceso: 9, llaveProceso: "73001400300220240012300", despacho: "JUZGADO 002 CIVIL MUNICIPAL DE IBAGUÉ", departamento: "TOLIMA", fechaProceso: "2024-03-01T00:00:00", fechaUltimaActuacion: "2026-10-01", sujetosProcesales: "Demandante: LUIS PRADA" }] }
    : { actuaciones: [
      { idRegActuacion: 2, fechaActuacion: "2026-10-01T00:00:00", actuacion: "Fijación estado", anotacion: "Auto que decreta pruebas" },
      { idRegActuacion: 1, fechaActuacion: "2024-03-05T00:00:00", actuacion: "Auto admite demanda", anotacion: "" }], paginacion: { cantidadPaginas: 1 } }) }));
  const r = (await admin.call("POST", `/monitor/cases/${caseId}/rama`)).body;
  assert.equal(r.ok, true);
  assert.equal(r.first, true, "first query of this process");
  assert.match(r.url, /consultaprocesos\.ramajudicial\.gov\.co/);
  assert.equal(r.processes[0].court, "JUZGADO 002 CIVIL MUNICIPAL DE IBAGUÉ");
  assert.equal(r.processes[0].judge, "MARÍA PÉREZ GÓMEZ");
  assert.equal(r.processes[0].parties, "Demandante: LUIS PRADA");
  assert.deepEqual(r.acts.map((a) => a.actuacion), ["Fijación estado", "Auto admite demanda"]);
  assert.equal((await admin.call("GET", `/monitor/cases/${caseId}/actuaciones`)).body.length, 2);
});

test("the Rama Judicial failing is reported, not hidden", async () => {
  setFetch(async () => ({ ok: false, status: 503 }));
  const r = (await admin.call("POST", `/monitor/cases/${caseId}/rama`)).body;
  assert.equal(r.ok, false);
  assert.match(r.error, /503/);
  assert.equal(r.acts.length, 2, "the saved actuaciones stay");
});

test("a case without radicado says so", async () => {
  const r = (await admin.call("POST", `/monitor/cases/${noRad}/rama`)).body;
  assert.equal(r.ok, false);
  assert.match(r.error, /no tiene radicado/);
});
