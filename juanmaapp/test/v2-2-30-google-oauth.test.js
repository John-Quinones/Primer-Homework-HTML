// Version 2.2.29: Google Calendar with OAuth: connect (Gerencia only), encrypted token, list/create/move/delete through Mony proposals.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { runTool, cardFor } from "../src/mony.js";
import { setGoogleFetch, seal, unseal } from "../src/gcal-oauth.js";
import { setGcalFetch, clearGcalCache } from "../src/gcal.js";

const calls = [];
let events = [{ id: "ev1", status: "confirmed", summary: "Reunión socios", start: { dateTime: "2026-11-02T10:00:00-05:00" }, end: { dateTime: "2026-11-02T11:00:00-05:00" } }];
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const stub = async (url, opts = {}) => {
  calls.push({ url: String(url), method: opts.method || "GET", body: opts.body && String(opts.body) });
  if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
    const p = new URLSearchParams(String(opts.body));
    if (p.get("grant_type") === "authorization_code") return json({ access_token: "at1", refresh_token: "rt-secret", expires_in: 3600, id_token: `x.${Buffer.from(JSON.stringify({ email: "Egrpanama@gmail.com" })).toString("base64url")}.y` });
    return json({ access_token: "at2", expires_in: 3600 });
  }
  if (String(url).startsWith("https://oauth2.googleapis.com/revoke")) return json({});
  if (opts.method === "POST") { const b = JSON.parse(opts.body); const e = { id: "new1", status: "confirmed", summary: b.summary, start: b.start, end: b.end }; events.push(e); return json(e); }
  if (opts.method === "PATCH") { const b = JSON.parse(opts.body); Object.assign(events[0], b.start ? { start: b.start, end: b.end } : {}); return json(events[0]); }
  if (opts.method === "DELETE") { events = events.filter((e) => !String(url).endsWith("/ev1")); return { ok: true, status: 204, json: async () => ({}) }; }
  if (/\/events\/ev1$/.test(String(url))) return json(events[0]);
  return json({ items: events });
};

let srv, admin, db;
before(async () => {
  Object.assign(process.env, { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret", GCAL_TOKEN_KEY: "una-clave-larga-de-prueba", PUBLIC_URL: "https://app.example.com" });
  delete process.env.GCAL_ICAL_URLS;
  setGoogleFetch(stub); setGcalFetch(async () => { throw new Error("no ical"); }); clearGcalCache();
  srv = await startServer(); admin = await srv.setup(); db = srv.db;
});
after(() => { srv.close(); for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GCAL_TOKEN_KEY", "PUBLIC_URL"]) delete process.env[k]; });

test("the token is stored encrypted and round-trips", () => {
  const blob = seal("rt-secret");
  assert.ok(!blob.includes("rt-secret"));
  assert.equal(unseal(blob), "rt-secret");
});
test("connect: status, consent URL, callback stores the encrypted refresh token", async () => {
  const st = (await admin.call("GET", "/gcal/status")).body;
  assert.equal(st.ready, true); assert.equal(st.redirect_uri, "https://app.example.com/api/gcal/callback");
  const url = new URL((await admin.call("GET", "/gcal/connect")).body.url);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.match(url.searchParams.get("scope"), /calendar\.events/);
  const res = await fetch(`${srv.base}/gcal/callback?code=abc&state=${url.searchParams.get("state")}`, { redirect: "manual", headers: { Cookie: admin.cookie } });
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location"), /gcal=Conectada/);
  const row = db.prepare("SELECT * FROM gcal_accounts").get();
  assert.equal(row.email, "egrpanama@gmail.com");
  assert.ok(!row.refresh_enc.includes("rt-secret"));
  // a forged state is refused
  const bad = await fetch(`${srv.base}/gcal/callback?code=abc&state=nope`, { redirect: "manual", headers: { Cookie: admin.cookie } });
  assert.match(bad.headers.get("location"), /expir/);
});
test("Mony lists Google events with ids and proposes create / move / delete without saving", async () => {
  const user = { id: 1, role: "Gerencia", permissions: ["scope.all"] };
  const list = await runTool("consultar_agenda", { desde: "2026-11-02", hasta: "2026-11-02" }, { db, user });
  assert.equal(list.google_calendar.eventos[0].evento_id, "ev1");
  const before = calls.filter((c) => c.method !== "GET" && !c.url.includes("oauth2")).length;
  const mk = await runTool("proponer_evento_google", { accion: "crear", titulo: "Audiencia", inicio: "2026-11-02 10:30" }, { db, user });
  assert.equal(mk.hay_cruce, true); // overlaps «Reunión socios»
  assert.equal(mk.cambios.fin, "2026-11-02 11:30");
  const free = await runTool("proponer_evento_google", { accion: "crear", titulo: "Audiencia", inicio: "2026-11-03 08:00" }, { db, user });
  assert.equal(free.hay_cruce, false);
  const mv = await runTool("proponer_evento_google", { accion: "mover", evento_id: "ev1", inicio: "2026-11-04 15:00" }, { db, user });
  assert.equal(mv.cambios.fin, "2026-11-04 16:00"); // keeps the one-hour length
  assert.equal(cardFor("proponer_evento_google", {}, mv).type, "google");
  assert.equal(calls.filter((c) => c.method !== "GET" && !c.url.includes("oauth2")).length, before); // nothing written yet
  await assert.rejects(runTool("proponer_evento_google", { accion: "crear", titulo: "x", inicio: "2026-11-03 08:00" }, { db, user: { ...user, role: "Abogado" } }), /Solo Gerencia/);
});
test("the confirmed card calls the API: create, move, delete (Gerencia only)", async () => {
  const acc = db.prepare("SELECT id FROM gcal_accounts").get().id;
  const made = (await admin.call("POST", "/gcal/events", { account_id: acc, titulo: "Audiencia", inicio: "2026-11-03 08:00", fin: "2026-11-03 09:00" })).body;
  assert.equal(made.titulo, "Audiencia"); assert.equal(made.cuando, "2026-11-03 08:00");
  const sent = JSON.parse(calls.filter((c) => c.method === "POST" && c.url.includes("/events"))[0].body);
  assert.equal(sent.start.dateTime, "2026-11-03T08:00:00-05:00");
  assert.equal((await admin.call("PATCH", "/gcal/events/ev1", { account_id: acc, inicio: "2026-11-04 15:00", fin: "2026-11-04 16:00" })).status, 200);
  assert.equal((await admin.call("DELETE", `/gcal/events/ev1?account_id=${acc}`)).status, 200);
  const lawyer = (await admin.call("POST", "/admin/users", { name: "Abo Gado", email: "abo@firma.co", password: "Zeta-clave-77!", role: "Abogado" }));
  if (lawyer.status < 300) {
    const other = await srv.login("abo@firma.co", "Zeta-clave-77!");
    assert.equal((await other.call("GET", "/gcal/status")).status, 403);
  }
});
test("disconnect removes the account", async () => {
  const acc = db.prepare("SELECT id FROM gcal_accounts").get().id;
  assert.equal((await admin.call("DELETE", `/gcal/accounts/${acc}`)).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM gcal_accounts").get().n, 0);
});
