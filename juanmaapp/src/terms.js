// Judicial terms in Colombia (version 2.2.8): business days of the Rama Judicial.
// Not business days: Saturdays, Sundays, national holidays (Ley 51 de 1983, "Ley
// Emiliani") and, unless told otherwise, the collective judicial vacation
// (20 December to 10 January). Pure code, no network and no AI: the same input
// always gives the same date. It is a working tool: the attorney in charge
// confirms every term against the law and the court's own calendar.
const DAY_MS = 86400000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const utc = (y, m, d) => Date.UTC(y, m - 1, d);
const dow = (ms) => new Date(ms).getUTCDay(); // 0 Sunday … 6 Saturday
const NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Easter Sunday (Gregorian computus), as ms UTC. */
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(y, month, day);
}
/** Ley Emiliani: a holiday that is not on a Monday moves to the next Monday. */
const toMonday = (ms) => { const w = dow(ms); return w === 1 ? ms : ms + ((8 - w) % 7) * DAY_MS; };

const cache = new Map();
/** Map "YYYY-MM-DD" → name of the national holidays of a year. */
export function holidays(y) {
  if (cache.has(y)) return cache.get(y);
  const E = easter(y), out = new Map();
  const add = (ms, name) => out.set(ymd(ms), name);
  add(utc(y, 1, 1), "Año Nuevo");
  add(toMonday(utc(y, 1, 6)), "Reyes Magos");
  add(toMonday(utc(y, 3, 19)), "San José");
  add(E - 3 * DAY_MS, "Jueves Santo");
  add(E - 2 * DAY_MS, "Viernes Santo");
  add(utc(y, 5, 1), "Día del Trabajo");
  add(toMonday(E + 39 * DAY_MS), "Ascensión del Señor");
  add(toMonday(E + 60 * DAY_MS), "Corpus Christi");
  add(toMonday(E + 68 * DAY_MS), "Sagrado Corazón");
  add(toMonday(utc(y, 6, 29)), "San Pedro y San Pablo");
  add(utc(y, 7, 20), "Independencia de Colombia");
  add(utc(y, 8, 7), "Batalla de Boyacá");
  add(toMonday(utc(y, 8, 15)), "Asunción de la Virgen");
  add(toMonday(utc(y, 10, 12)), "Día de la Raza");
  add(toMonday(utc(y, 11, 1)), "Todos los Santos");
  add(toMonday(utc(y, 11, 11)), "Independencia de Cartagena");
  add(utc(y, 12, 8), "Inmaculada Concepción");
  add(utc(y, 12, 25), "Navidad");
  cache.set(y, out);
  return out;
}

/** Why a day does not count, or null when it is a business day. */
export function nonBusinessReason(ms, { vacancy = true } = {}) {
  const w = dow(ms);
  if (w === 0 || w === 6) return NAMES[w];
  const h = holidays(new Date(ms).getUTCFullYear()).get(ymd(ms));
  if (h) return `festivo: ${h}`;
  if (vacancy) {
    const d = new Date(ms), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    if ((m === 12 && day >= 20) || (m === 1 && day <= 10)) return "vacancia judicial (20 de diciembre a 10 de enero)";
  }
  return null;
}

/**
 * Deadline of a term counted in days. The count starts on the day after `from`
 * (art. 118 CGP: the day of the notification does not count) and the last day is
 * the N-th counted day. kind "habiles" skips non-business days; "calendario"
 * counts every day and, if the last day is not a business day, moves it to the next
 * business day. Returns { deadline, skipped, assumptions } or throws a message for the user.
 */
export function addJudicialDays(from, days, { kind = "habiles", vacancy = true } = {}) {
  if (!DATE.test(String(from)) || Number.isNaN(Date.parse(from))) throw new Error("La fecha debe ir como AAAA-MM-DD.");
  if (!Number.isInteger(days) || days < 1 || days > 1000) throw new Error("Los días del término deben ser un número entero entre 1 y 1000.");
  if (!["habiles", "calendario"].includes(kind)) throw new Error('El tipo de día debe ser "habiles" o "calendario".');
  const skipped = [];
  let cur = Date.parse(from), n = 0;
  while (n < days) {
    cur += DAY_MS;
    const why = nonBusinessReason(cur, { vacancy });
    if (kind === "habiles" && why) { skipped.push({ date: ymd(cur), reason: why }); continue; }
    n++;
  }
  if (kind === "calendario") {
    while (nonBusinessReason(cur, { vacancy })) { skipped.push({ date: ymd(cur), reason: nonBusinessReason(cur, { vacancy }) }); cur += DAY_MS; }
  }
  return { deadline: ymd(cur), weekday: NAMES[dow(cur)], skipped };
}
