import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { setFetch } from "../src/ramajudicial.js";

let srv, admin, office;
before(async () => {
  srv = await startServer(); admin = await srv.setup();
  office = (await admin.call("GET", "/admin/offices")).body[0].id;
});
after(() => { setFetch((...a) => fetch(...a)); srv.close(); });

test("judge of the court: Rama Judicial «ponente», directory and other cases; the case keeps the chosen or typed name", async () => {
  await admin.call("POST", "/courts/import", { rows: [
    { name: "Juzgado 002 Civil Municipal de Ibagué", department: "Tolima", city: "Ibagué", email: "j02cmpalibague@cendoj.ramajudicial.gov.co", judge: "Ana  Ruiz" },
  ] });
  const court = (await admin.call("GET", "/courts?q=002 Civil")).body[0];
  assert.equal(court.judge, "Ana Ruiz");

  const calls = [];
  setFetch(async (url) => {
    calls.push(url);
    const body = url.includes("NumeroRadicacion")
      ? { procesos: [{ idProceso: 555, llaveProceso: "73001400300220080066400", despacho: "JUZGADO 002 CIVIL MUNICIPAL DE IBAGUÉ", fechaUltimaActuacion: "2026-09-10" }] }
      : { idRegProceso: 555, despacho: "JUZGADO 002 CIVIL MUNICIPAL DE IBAGUÉ", ponente: "CARLOS  ANDRÉS PÉREZ" };
    return { ok: true, json: async () => body };
  });
  const s = (await admin.call("GET", `/courts/judge?court_id=${court.id}&radicado=73-001-40-03-002-2008-00664-00`)).body;
  assert.equal(s.rama.judge, "CARLOS ANDRÉS PÉREZ");
  assert.equal(s.directory, "Ana Ruiz");
  assert.ok(calls.some((u) => u.endsWith("/Proceso/Detalle/555")));

  // Short radicado: no lookup, a hint instead.
  const n = calls.length;
  const short = (await admin.call("GET", `/courts/judge?court_id=${court.id}&radicado=7300`)).body;
  assert.equal(short.rama, null);
  assert.match(short.rama_error, /23 dígitos/);
  assert.equal(calls.length, n);

  // Service down: the message comes back, the form still lets the user type.
  setFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));
  assert.match((await admin.call("GET", `/courts/judge?court_id=${court.id}&radicado=73001400300220080066400`)).body.rama_error, /503/);

  const client = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Marta", last_names: "León", id_type: "CC", id_number: "52111298", office_id: office })).body;
  const type = (await admin.call("GET", "/catalog")).body[0].types[0];
  const k = (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: type.id, office_id: office, court_id: court.id, judge_name: "Carlos Andrés Pérez" })).body;
  assert.equal(k.judge_name, "Carlos Andrés Pérez");
  // A partial update keeps it; an explicit one changes it.
  assert.equal((await admin.call("PUT", `/cases/${k.id}`, { title: "Ejecutivo" })).body.judge_name, "Carlos Andrés Pérez");
  assert.equal((await admin.call("PUT", `/cases/${k.id}`, { judge_name: "Luisa Gómez" })).body.judge_name, "Luisa Gómez");
  assert.deepEqual((await admin.call("GET", `/courts/judge?court_id=${court.id}`)).body.others, ["Luisa Gómez"]);
});
