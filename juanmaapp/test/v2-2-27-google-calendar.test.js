// Version 2.2.27: Mony reads Google Calendar through the secret iCal address (read only, Gerencia only).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { runTool } from "../src/mony.js";
import { feeds, parseIcs, eventsBetween, setGcalFetch, clearGcalCache, googleEvents } from "../src/gcal.js";

const URL1 = "https://calendar.google.com/calendar/ical/egrpanama%40gmail.com/private-abc/basic.ics";
const ICS = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT", "UID:a1", "DTSTART:20261026T140000Z", "DTEND:20261026T150000Z", "SUMMARY:Audiencia en Ibagué\\, sala 3", "END:VEVENT", // 09:00-10:00 Bogotá
  "BEGIN:VEVENT", "UID:a2", "DTSTART;TZID=America/Bogota:20261027T153000", "DTEND;TZID=America/Bogota:20261027T163000", "SUMMARY:Reunión", "END:VEVENT",
  "BEGIN:VEVENT", "UID:a3", "DTSTART;VALUE=DATE:20261028", "DTEND;VALUE=DATE:20261029", "SUMMARY:Viaje", "END:VEVENT",
  "BEGIN:VEVENT", "UID:a4", "DTSTART;TZID=America/Bogota:20261019T080000", "DTEND;TZID=America/Bogota:20261019T083000", "RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE;TZID=America/Bogota:20261102T080000", "SUMMARY:Comité semanal", "END:VEVENT",
  "BEGIN:VEVENT", "UID:a5", "DTSTART:20261026T143000Z", "STATUS:CANCELLED", "SUMMARY:Cancelado", "END:VEVENT",
  "END:VCALENDAR"].join("\r\n");

before(() => { process.env.GCAL_ICAL_URLS = `Gerencia|${URL1}, https://evil.example/x.ics`; setGcalFetch(async () => ({ ok: true, text: async () => ICS })); clearGcalCache(); });
after(() => { delete process.env.GCAL_ICAL_URLS; });

test("only calendar.google.com addresses are used", () => {
  assert.deepEqual(feeds().map((f) => f.name), ["Gerencia"]);
});
test("parse: UTC, zone, all-day, weekly rule with a skipped date, cancelled", () => {
  const ev = parseIcs(ICS);
  const day = eventsBetween(ev, "2026-10-26 00:00", "2026-11-09 23:59", "G");
  const byTitle = Object.fromEntries(day.map((e) => [e.titulo, e]));
  assert.equal(byTitle["Audiencia en Ibagué, sala 3"].cuando, "2026-10-26 09:00");
  assert.equal(byTitle["Reunión"].cuando, "2026-10-27 15:30");
  assert.match(byTitle["Viaje"].cuando, /^2026-10-28 \(todo el día\)/);
  assert.equal(day.filter((e) => e.titulo === "Comité semanal").map((e) => e.cuando).join("|"), "2026-10-26 08:00|2026-11-09 08:00"); // Nov 2 skipped
  assert.ok(!byTitle["Cancelado"]);
});
test("Mony lists Google events and flags overlaps for Gerencia only", async () => {
  const srv = await startServer(); const admin = await srv.setup();
  try {
    const cat = (await admin.call("GET", "/catalog")).body[0];
    const c = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Ana", last_names: "Gil", id_number: "55" })).body;
    const caseId = (await admin.call("POST", "/cases", { client_id: c.id, process_type_id: cat.types[0].id })).body.id;
    const gerencia = { id: 1, role: "Gerencia", permissions: ["scope.all"] };
    const list = await runTool("consultar_agenda", { desde: "2026-10-26", hasta: "2026-10-26" }, { db: srv.db, user: gerencia });
    assert.ok(list.google_calendar.eventos.some((e) => e.titulo.startsWith("Audiencia en Ibagué")));
    const p = await runTool("proponer_cambio_agenda", { accion: "crear", caso_id: caseId, titulo: "Audiencia", fecha_hora: "2026-12-01 09:30" }, { db: srv.db, user: gerencia });
    assert.equal(p.hay_cruce, false);
    const q = await runTool("proponer_cambio_agenda", { accion: "crear", caso_id: caseId, titulo: "Audiencia", fecha_hora: "2026-10-26 09:30" }, { db: srv.db, user: gerencia });
    assert.equal(q.hay_cruce, true);
    assert.match(q.cruces_en_google[0].calendario, /Google/);
    const other = { id: 2, role: "Abogado", permissions: ["scope.all"] };
    const l2 = await runTool("consultar_agenda", { desde: "2026-10-26", hasta: "2026-10-26" }, { db: srv.db, user: other });
    assert.equal(l2.google_calendar, undefined);
  } finally { srv.close(); }
});
test("a Google failure never breaks the agenda", async () => {
  clearGcalCache(); setGcalFetch(async () => { throw new Error("sin red"); });
  const g = await googleEvents("2026-10-26 00:00", "2026-10-27 00:00");
  assert.equal(g.events.length, 0);
  assert.match(g.errors[0], /sin red/);
});
