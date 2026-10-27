import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { setFetch as setRama } from "../src/ramajudicial.js";
import { setTransports } from "../src/notify.js";
import { setFetch as setPub, setPdfText, findInText, listDocuments, dateOf, despachoCode, checkPublicaciones } from "../src/publicaciones.js";
import { getSchedule, runCycle, buildReport } from "../src/monitor.js";

process.env.RAMA_PAUSE_MS = "0";
const RAD = "73001310500120230012300";
let srv, admin, caseId;
before(async () => {
  srv = await startServer();
  admin = await srv.setup();
  setTransports({ email: async () => ({ ok: true }), whatsapp: async () => ({ ok: true }) });
  const client = (await admin.call("POST", "/clients", { full_name: "Ana Gómez" })).body;
  const cat = (await admin.call("GET", "/catalog")).body.find((c) => c.name === "Laboral");
  const k = (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: cat.id, title: "Ordinario", radicado: RAD })).body;
  caseId = k.id;
  await admin.call("PUT", `/monitor/cases/${caseId}/monitor`, { monitor: true });
});
after(() => srv.close());

test("the schedule defaults to 7:00 and 16:00; only Gerencia changes it and bad hours are dropped", async () => {
  assert.deepEqual(getSchedule(srv.db).hours, ["07:00", "16:00"]);
  const r = await admin.call("PUT", "/monitor/schedule", { enabled: true, hours: ["16:30", "07:00", "25:00", "07:00"] });
  assert.deepEqual(r.body.hours, ["07:00", "16:30"]);
  assert.equal((await admin.call("PUT", "/monitor/schedule", { enabled: true, hours: [] })).status, 400);
  await admin.call("PUT", "/monitor/schedule", { enabled: true, hours: ["07:00", "16:00"] });
});

test("the despacho is the first 12 digits and the radicado is found with or without separators", () => {
  assert.equal(despachoCode(RAD), "730013105001");
  assert.ok(findInText("Proceso 73001-31-05-001-2023-00123-00 ANA GOMEZ", RAD));
  assert.ok(findInText("73001310500120230012300", RAD));
  assert.ok(findInText("Despacho 730013105001 ... 2023 00123 Ordinario", RAD));
  assert.equal(findInText("2023 00123 sin despacho", RAD), "", "short form needs the despacho in the text");
  assert.equal(findInText("73001-31-05-001-2023-00124-00", RAD), "");
  assert.equal(dateOf("Estado 27-10-2026.pdf"), "2026-10-27");
  const docs = listDocuments('<a href="/documents/1/Estado%202026-10-26.pdf/u1">Estado 26-10-2026</a><a href="/documents/1/e2.pdf/u2">Estado 2026-10-27</a><a href="/x">no</a>', "https://p.test/web/x");
  assert.deepEqual(docs.map((d) => d.fecha), ["2026-10-27", "2026-10-26"]);
});

test("publicaciones: reads each PDF once, saves the mention once, and it reaches the report", async () => {
  process.env.PUBLICACIONES_URL = "https://p.test/despacho/{codigo}";
  let pdfReads = 0;
  setPub(async (url) => url.startsWith("https://p.test/despacho/")
    ? { ok: true, text: async () => '<a href="/documents/9/estado.pdf/abc">Estado 2026-10-27</a>' }
    : (pdfReads++, { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  setPdfText(async () => "ESTADO 27 oct. Proceso 73001-31-05-001-2023-00123-00 ANA GOMEZ auto fija fecha");
  const a = await checkPublicaciones(srv.db, [caseId]);
  assert.deepEqual([a.docs, a.found], [1, 1]);
  const b = await checkPublicaciones(srv.db, [caseId]);
  assert.deepEqual([b.docs, b.found, pdfReads], [0, 0, 1]);
  assert.match(buildReport(srv.db, 1).text, /PUBLICACIONES PROCESALES[\s\S]*estado\.pdf/);
});

test("a failing portal is reported without stopping the cycle", async () => {
  setPub(async () => ({ ok: false, status: 403 }));
  srv.db.prepare("DELETE FROM publicaciones_docs").run();
  const r = await checkPublicaciones(srv.db, [caseId]);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].error, /403/);
});

test("«Consultar ahora» (Gerencia) runs the whole cycle once and logs it", async () => {
  setRama(async () => ({ ok: true, json: async () => ({ procesos: [], actuaciones: [] }) }));
  const r = await admin.call("POST", "/monitor/run-now", {});
  assert.equal(r.body.started, true);
  const done = await runCycle(srv.db, "manual");
  assert.equal(done.trigger, "manual");
  const s = (await admin.call("GET", "/monitor/schedule")).body;
  assert.equal(s.running, false);
  assert.equal(s.last.cases, 1);
  assert.ok((await admin.call("GET", "/monitor/log")).body.some((l) => l.trigger === "manual"));
  delete process.env.PUBLICACIONES_URL;
});

test("pdfText reads the text layer of a real PDF", async () => {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const { pdfText } = await import("../src/publicaciones.js");
  const doc = await PDFDocument.create();
  doc.addPage().drawText("Radicado 73001-31-05-001-2023-00123-00", { x: 20, y: 700, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
  assert.ok(findInText(await pdfText(Buffer.from(await doc.save())), RAD));
});
