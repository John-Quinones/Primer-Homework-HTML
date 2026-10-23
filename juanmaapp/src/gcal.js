// Google Calendar, read only (version 2.2.27): Mony reads the private iCal address of each calendar
// (Google Calendar → Settings → "Secret address in iCal format") so it can list the events and warn about overlaps.
// The addresses are secrets and live only in the server's environment: GCAL_ICAL_URLS="Name|https://calendar.google.com/…/basic.ics, …".
// Only https://calendar.google.com addresses are fetched. Nothing is ever written to Google.
const TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 8000;
let fetchImpl = (url, opts) => fetch(url, opts);
/** Tests swap in a stub fetch. */
export function setGcalFetch(fn) { fetchImpl = fn; }
const cache = new Map();
export const clearGcalCache = () => cache.clear();

export function feeds(env = process.env) {
  return String(env.GCAL_ICAL_URLS ?? "").split(/[\n,]+/).map((x) => x.trim()).filter(Boolean).map((x, i) => {
    const bar = x.indexOf("|");
    const name = bar > 0 && !/^https?:/i.test(x.slice(0, bar)) ? x.slice(0, bar).trim() : `Calendario ${i + 1}`;
    const url = bar > 0 && !/^https?:/i.test(x.slice(0, bar)) ? x.slice(bar + 1).trim() : x;
    return { name, url };
  }).filter((f) => { try { const u = new URL(f.url); return u.protocol === "https:" && u.hostname === "calendar.google.com"; } catch { return false; } });
}
export const gcalConfigured = () => feeds().length > 0;

const pad = (n) => String(n).padStart(2, "0");
const fmt = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const BOGOTA = 5 * 3600000; // UTC-5, no daylight saving

/** Wall-clock parts in time zone tz → UTC ms (two passes handle the offset). */
function zonedToUtc(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  try {
    const offset = (t) => {
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t;
    };
    const o1 = offset(guess);
    return guess - offset(guess - o1);
  } catch { return guess + BOGOTA; }
}

/** ICS date value → { utc ms, allDay }. */
function icsDate(value, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(value).trim());
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (m[4] === undefined) return { ms: Date.UTC(y, mo - 1, d) + BOGOTA, allDay: true }; // midnight Bogotá
  const h = +m[4], mi = +m[5];
  if (m[7]) return { ms: Date.UTC(y, mo - 1, d, h, mi), allDay: false };
  const tz = /TZID=([^;:]+)/i.exec(params || "")?.[1] || "America/Bogota";
  return { ms: zonedToUtc(y, mo, d, h, mi, tz), allDay: false };
}

const unescapeText = (s) => String(s).replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

/** Parse the VEVENTs of an ICS text. */
export function parseIcs(text) {
  const lines = String(text).replace(/\r/g, "").replace(/\n[ \t]/g, "").split("\n");
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = { exdates: [] }; continue; }
    if (line === "END:VEVENT") { if (cur?.start) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const head = line.slice(0, colon), value = line.slice(colon + 1);
    const name = head.split(";")[0].toUpperCase(), params = head.slice(name.length);
    if (name === "UID") cur.uid = value;
    else if (name === "SUMMARY") cur.summary = unescapeText(value);
    else if (name === "LOCATION") cur.location = unescapeText(value);
    else if (name === "STATUS") cur.status = value.toUpperCase();
    else if (name === "DTSTART") { const d = icsDate(value, params); if (d) { cur.start = d.ms; cur.allDay = d.allDay; } }
    else if (name === "DTEND") { const d = icsDate(value, params); if (d) cur.end = d.ms; }
    else if (name === "RRULE") cur.rrule = Object.fromEntries(value.split(";").map((p) => p.split("=")));
    else if (name === "EXDATE") for (const v of value.split(",")) { const d = icsDate(v, params); if (d) cur.exdates.push(d.ms); }
    else if (name === "RECURRENCE-ID") { const d = icsDate(value, params); if (d) cur.recurrenceId = d.ms; }
  }
  for (const e of events) if (!e.end) e.end = e.start + (e.allDay ? 86400000 : 3600000);
  return events;
}

const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
/** Instances (start ms) of a recurring event inside [from, to]; supports DAILY, WEEKLY(+BYDAY), MONTHLY, YEARLY with INTERVAL, COUNT, UNTIL. */
function occurrences(e, from, to) {
  const r = e.rrule, step = Math.max(1, Number(r.INTERVAL) || 1);
  const until = r.UNTIL ? icsDate(r.UNTIL, "")?.ms ?? Infinity : Infinity;
  const max = Number(r.COUNT) || Infinity;
  const out = [];
  const first = new Date(e.start - BOGOTA); // Bogotá wall-clock fields read as UTC
  let n = 0;
  const push = (ms) => { n++; if (ms >= e.start && ms <= until && n <= max && ms <= to && ms + (e.end - e.start) >= from) out.push(ms); return ms > to || ms > until || n >= max; };
  const LIMIT = 4000;
  if (r.FREQ === "DAILY") for (let i = 0; i < LIMIT; i++) { if (push(e.start + i * step * 86400000)) break; }
  else if (r.FREQ === "WEEKLY") {
    const byday = (r.BYDAY ? r.BYDAY.split(",").map((x) => DAYS[x.slice(-2)]) : [first.getUTCDay()]).filter((x) => x !== undefined).sort();
    const weekStart = e.start - ((first.getUTCDay() + 7) % 7) * 86400000;
    outer: for (let w = 0; w < LIMIT; w++) for (const d of byday) { const ms = weekStart + (w * step * 7 + d) * 86400000; if (ms < e.start) continue; if (push(ms)) break outer; }
  } else if (r.FREQ === "MONTHLY" || r.FREQ === "YEARLY") {
    const months = r.FREQ === "YEARLY" ? 12 * step : step;
    for (let i = 0; i < LIMIT; i++) {
      const d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i * months, first.getUTCDate(), first.getUTCHours(), first.getUTCMinutes()));
      if (d.getUTCDate() !== first.getUTCDate()) continue; // e.g. the 31st in a short month
      if (push(d.getTime() + BOGOTA)) break;
    }
  } else push(e.start);
  return out;
}

/** Events of a parsed calendar between two Bogotá wall-clock strings "YYYY-MM-DD HH:MM". */
export function eventsBetween(events, fromLocal, toLocal, calendar = "") {
  const from = Date.parse(fromLocal.replace(" ", "T") + ":00Z") + BOGOTA, to = Date.parse(toLocal.replace(" ", "T") + ":00Z") + BOGOTA;
  const overridden = new Set(events.filter((e) => e.recurrenceId).map((e) => `${e.uid}|${e.recurrenceId}`));
  const out = [];
  for (const e of events) {
    if (e.status === "CANCELLED") continue;
    const dur = e.end - e.start;
    const starts = e.rrule && !e.recurrenceId ? occurrences(e, from, to).filter((s) => !e.exdates.includes(s) && !overridden.has(`${e.uid}|${s}`)) : [e.start];
    for (const s of starts) if (s <= to && s + dur > from) out.push({ calendario: calendar, titulo: e.summary || "(sin título)", cuando: e.allDay ? fmt(s - BOGOTA).slice(0, 10) + " (todo el día)" : fmt(s - BOGOTA),
      hasta: e.allDay ? undefined : fmt(s + dur - BOGOTA), inicio: s - BOGOTA, fin: s + dur - BOGOTA, lugar: e.location || undefined });
  }
  return out.sort((a, b) => a.inicio - b.inicio);
}

async function load(feed) {
  const hit = cache.get(feed.url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.events;
  const res = await fetchImpl(feed.url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "text/calendar" } });
  if (!res.ok) throw new Error(`Google respondió ${res.status}`);
  const events = parseIcs(await res.text());
  cache.set(feed.url, { at: Date.now(), events });
  return events;
}

/** Events of every configured calendar between two Bogotá wall-clock strings; { configured, events, errors }. Never throws. */
export async function googleEvents(fromLocal, toLocal) {
  const fs = feeds();
  const result = { configured: fs.length > 0, events: [], errors: [] };
  await Promise.all(fs.map(async (f) => {
    try { result.events.push(...eventsBetween(await load(f), fromLocal, toLocal, f.name)); }
    catch (err) { result.errors.push(`${f.name}: ${String(err.message || "sin respuesta").slice(0, 100)}`); }
  }));
  result.events.sort((a, b) => a.inicio - b.inicio);
  return result;
}
