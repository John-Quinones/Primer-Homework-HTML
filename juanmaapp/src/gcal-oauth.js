// Google Calendar with OAuth (version 2.2.29): the firm's management connects its Google accounts once (Configuración →
// «Conectar Google») and Mony can then list, create, move and delete events there, always after the person confirms.
// The refresh token is stored encrypted (AES-256-GCM, key from GCAL_TOKEN_KEY); the client id and secret come from the
// server environment (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET). Only Gerencia connects, sees or changes these calendars.
import crypto from "node:crypto";
import express from "express";
import { publicBase } from "./public-url.js";

const env = () => process.env;
let fetchImpl = (url, opts) => fetch(url, opts);
/** Tests swap in a stub fetch (Google's token and calendar endpoints). */
export function setGoogleFetch(fn) { fetchImpl = fn; }

const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"];
const BOGOTA = 5 * 3600000;
const pad = (n) => String(n).padStart(2, "0");
const fmt = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const LOCAL = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const toRfc = (local) => `${local.replace(" ", "T")}:00-05:00`;

export const oauthReady = () => !!(env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET && String(env().GCAL_TOKEN_KEY || "").length >= 16);
const isGerencia = (user) => user?.role === "Gerencia";

// ----- token storage -----
const key = () => crypto.createHash("sha256").update(`gcal:${env().GCAL_TOKEN_KEY}`).digest();
export function seal(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64url")).join(".");
}
export function unseal(blob) {
  const [iv, tag, ct] = String(blob).split(".").map((x) => Buffer.from(x, "base64url"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
export const accounts = (db) => db.prepare("SELECT id, email, calendar_id, connected_at FROM gcal_accounts ORDER BY id").all();

const access = new Map(); // account id → { token, exp }
async function accessToken(db, id) {
  const hit = access.get(id);
  if (hit && hit.exp > Date.now() + 60000) return hit.token;
  const row = db.prepare("SELECT refresh_enc FROM gcal_accounts WHERE id = ?").get(id);
  if (!row) throw new Error("La cuenta de Google no está conectada.");
  const res = await fetchImpl("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(10000),
    body: new URLSearchParams({ client_id: env().GOOGLE_CLIENT_ID, client_secret: env().GOOGLE_CLIENT_SECRET, refresh_token: unseal(row.refresh_enc), grant_type: "refresh_token" }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(j.error === "invalid_grant" ? "Google ya no acepta la conexión: vuelva a conectar la cuenta en Configuración." : `Google respondió ${res.status}`);
  access.set(id, { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
  return j.access_token;
}
async function call(db, id, method, path, body) {
  const acc = db.prepare("SELECT calendar_id FROM gcal_accounts WHERE id = ?").get(id);
  if (!acc) throw new Error("La cuenta de Google no está conectada.");
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(acc.calendar_id)}${path}`;
  const res = await fetchImpl(url, { method, headers: { Authorization: `Bearer ${await accessToken(db, id)}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
  if (res.status === 204) return {};
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error?.message ? `Google: ${String(j.error.message).slice(0, 150)}` : `Google respondió ${res.status}`);
  return j;
}

const mapEvent = (e, acc) => {
  const allDay = !!e.start?.date;
  const s = allDay ? Date.parse(e.start.date + "T00:00:00Z") : Date.parse(e.start?.dateTime), f = allDay ? Date.parse(e.end.date + "T00:00:00Z") : Date.parse(e.end?.dateTime);
  const inicio = allDay ? s : s - BOGOTA, fin = allDay ? f : f - BOGOTA; // wall-clock Bogotá read as UTC, like the iCal reader
  return { id: e.id, cuenta_id: acc.id, calendario: acc.email, titulo: e.summary || "(sin título)", cuando: allDay ? `${e.start.date} (todo el día)` : fmt(inicio),
    hasta: allDay ? undefined : fmt(fin), inicio, fin, lugar: e.location || undefined };
};

/** Events of every connected account between two Bogotá wall-clock strings. Never throws: { events, errors }. */
export async function oauthEvents(db, fromLocal, toLocal) {
  const out = { events: [], errors: [] };
  if (!oauthReady()) return out;
  await Promise.all(accounts(db).map(async (acc) => {
    try {
      const q = new URLSearchParams({ timeMin: new Date(Date.parse(fromLocal.replace(" ", "T") + ":00Z") + BOGOTA).toISOString(), timeMax: new Date(Date.parse(toLocal.replace(" ", "T") + ":00Z") + BOGOTA).toISOString(),
        singleEvents: "true", orderBy: "startTime", maxResults: "100" });
      const j = await call(db, acc.id, "GET", `/events?${q}`);
      out.events.push(...(j.items || []).filter((e) => e.status !== "cancelled").map((e) => mapEvent(e, acc)));
    } catch (err) { out.errors.push(`${acc.email}: ${String(err.message || "sin respuesta").slice(0, 120)}`); }
  }));
  out.events.sort((a, b) => a.inicio - b.inicio);
  return out;
}

const body = (b) => {
  const out = {};
  if (b.titulo !== undefined) out.summary = String(b.titulo).slice(0, 300);
  if (b.lugar !== undefined) out.location = String(b.lugar).slice(0, 300);
  if (b.descripcion !== undefined) out.description = String(b.descripcion).slice(0, 4000);
  if (b.inicio) { if (!LOCAL.test(b.inicio)) throw new Error("Fecha de inicio no válida (AAAA-MM-DD HH:MM)."); out.start = { dateTime: toRfc(b.inicio), timeZone: "America/Bogota" }; }
  if (b.fin) { if (!LOCAL.test(b.fin)) throw new Error("Fecha de fin no válida (AAAA-MM-DD HH:MM)."); out.end = { dateTime: toRfc(b.fin), timeZone: "America/Bogota" }; }
  return out;
};
export async function getEvent(db, accountId, eventId) {
  return mapEvent(await call(db, accountId, "GET", `/events/${encodeURIComponent(eventId)}`), accounts(db).find((a) => a.id === accountId));
}
export async function createEvent(db, accountId, b) {
  const data = body(b);
  if (!data.summary || !data.start || !data.end) throw new Error("Faltan el título, el inicio y el fin.");
  return mapEvent(await call(db, accountId, "POST", "/events", { ...data, reminders: { useDefault: true } }), accounts(db).find((a) => a.id === accountId));
}
export async function updateEvent(db, accountId, eventId, b) {
  return mapEvent(await call(db, accountId, "PATCH", `/events/${encodeURIComponent(eventId)}`, body(b)), accounts(db).find((a) => a.id === accountId));
}
export async function deleteEvent(db, accountId, eventId) { await call(db, accountId, "DELETE", `/events/${encodeURIComponent(eventId)}`); }

// ----- routes (/api/gcal) -----
const states = new Map(); // anti-forgery state → { userId, exp }
export function gcalRouter(db) {
  const r = express.Router();
  r.use((req, res, next) => (isGerencia(req.user) ? next() : res.status(403).json({ error: "Solo Gerencia maneja Google Calendar." })));
  const redirectUri = (req) => `${publicBase(req)}/api/gcal/callback`;

  r.get("/status", (req, res) => res.json({ ready: oauthReady(), missing: [!env().GOOGLE_CLIENT_ID && "GOOGLE_CLIENT_ID", !env().GOOGLE_CLIENT_SECRET && "GOOGLE_CLIENT_SECRET",
    String(env().GCAL_TOKEN_KEY || "").length < 16 && "GCAL_TOKEN_KEY"].filter(Boolean), redirect_uri: (() => { try { return redirectUri(req); } catch { return ""; } })(), accounts: accounts(db) }));

  r.get("/connect", (req, res) => {
    if (!oauthReady()) return res.status(400).json({ error: "Faltan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET o GCAL_TOKEN_KEY en el servidor (AZURE.md, paso 10)." });
    const state = crypto.randomBytes(24).toString("base64url");
    states.set(state, { userId: req.user.id, exp: Date.now() + 10 * 60000 });
    for (const [k, v] of states) if (v.exp < Date.now()) states.delete(k);
    const q = new URLSearchParams({ client_id: env().GOOGLE_CLIENT_ID, redirect_uri: redirectUri(req), response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: "consent select_account", state });
    res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` });
  });

  r.get("/callback", async (req, res) => {
    const back = (msg) => res.redirect(`/?gcal=${encodeURIComponent(msg)}#configuracion`);
    try {
      const st = states.get(String(req.query.state || ""));
      states.delete(String(req.query.state || ""));
      if (req.query.error) return back(`Google no autorizó: ${String(req.query.error).slice(0, 60)}`);
      if (!st || st.exp < Date.now() || st.userId !== req.user.id) return back("La conexión expiró; vuelva a intentarlo.");
      const tok = await fetchImpl("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(10000),
        body: new URLSearchParams({ code: String(req.query.code || ""), client_id: env().GOOGLE_CLIENT_ID, client_secret: env().GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri(req), grant_type: "authorization_code" }) });
      const j = await tok.json().catch(() => ({}));
      if (!tok.ok || !j.access_token) return back("Google rechazó el código de autorización.");
      const email = String(JSON.parse(Buffer.from(String(j.id_token || "").split(".")[1] || "e30", "base64url").toString("utf8")).email || "").toLowerCase();
      if (!email) return back("No se pudo leer el correo de la cuenta de Google.");
      const old = db.prepare("SELECT id, refresh_enc FROM gcal_accounts WHERE email = ?").get(email);
      if (!j.refresh_token && !old) return back("Google no entregó el permiso permanente; quite el acceso de la App en myaccount.google.com/permissions y conecte de nuevo.");
      if (old) db.prepare("UPDATE gcal_accounts SET refresh_enc = ?, connected_at = datetime('now') WHERE id = ?").run(j.refresh_token ? seal(j.refresh_token) : old.refresh_enc, old.id);
      else db.prepare("INSERT INTO gcal_accounts (email, refresh_enc, created_by) VALUES (?, ?, ?)").run(email, seal(j.refresh_token), req.user.id);
      access.clear();
      back(`Conectada: ${email}`);
    } catch (err) { back("No se pudo conectar: " + String(err.message || "error").slice(0, 80)); }
  });

  r.delete("/accounts/:id", async (req, res) => {
    const acc = db.prepare("SELECT id, refresh_enc FROM gcal_accounts WHERE id = ?").get(Number(req.params.id));
    if (!acc) return res.status(404).json({ error: "La cuenta no existe." });
    try { await fetchImpl("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: unseal(acc.refresh_enc) }), signal: AbortSignal.timeout(8000) }); } catch { /* the local copy is removed anyway */ }
    db.prepare("DELETE FROM gcal_accounts WHERE id = ?").run(acc.id); access.delete(acc.id);
    res.json({ ok: true });
  });

  const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (err) { res.status(400).json({ error: String(err.message || "Error con Google Calendar.").slice(0, 200) }); } };
  const acct = (req) => { const id = Number(req.body?.account_id ?? req.query.account_id); if (!db.prepare("SELECT 1 FROM gcal_accounts WHERE id = ?").get(id)) throw new Error("Cuenta de Google no conectada."); return id; };
  r.get("/events", wrap((req) => oauthEvents(db, String(req.query.from || ""), String(req.query.to || ""))));
  r.post("/events", wrap((req) => createEvent(db, acct(req), req.body)));
  r.patch("/events/:eid", wrap((req) => updateEvent(db, acct(req), req.params.eid, req.body)));
  r.delete("/events/:eid", wrap(async (req) => { await deleteEvent(db, acct(req), req.params.eid); return { ok: true }; }));
  return r;
}
