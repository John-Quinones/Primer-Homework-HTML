// Case status and the client's procedural role. Shared by the server, the
// importer and the page (served as /case-meta.js and inlined in the link).

export const STATUSES = ["Activo", "Archivo provisional", "Archivo definitivo"];
// Statuses that still move: monitored and counted as "en curso".
export const LIVE_STATUSES = ["Activo", "Archivo provisional"];

const nrm = (x) => String(x ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Map any older or imported status to one of the three. */
export function normStatus(x) {
  const n = nrm(x);
  if (!n) return "Activo";
  // Codes from the firm's previous system: 1 = activo, 2 = archivo definitivo, 3 = archivo provisional.
  if (n === "1") return "Activo";
  if (n === "2") return "Archivo definitivo";
  if (n === "3") return "Archivo provisional";
  if (n.includes("provisional")) return "Archivo provisional";
  if (/definitiv|cerrad|terminad|archivad|finalizad|archivo/.test(n)) return "Archivo definitivo";
  return "Activo";
}

export const PARTY_ROLES = {
  judicial: ["Demandante", "Demandado"],
  ejecutivo: ["Ejecutante", "Ejecutado"],
  penal: ["Denunciante", "Denunciado", "Víctima", "Indiciado", "Acusado", "Procesado"],
  conciliacion: ["Convocante", "Convocado"],
  peticion: ["Peticionario"],
  reclamo: ["Reclamante"],
};
// Version 2.64: roles that older cases may carry; still accepted, no longer offered.
const LEGACY_PARTY_ROLES = ["Querellante", "Querellado", "Defendido"];
export const ALL_PARTY_ROLES = [...new Set([...Object.values(PARTY_ROLES).flat(), ...LEGACY_PARTY_ROLES])];

/** Roles offered for a category and sub-process (e.g. "Laboral", "Ejecutivo Laboral"). */
export function partyRolesFor(category, type = "") {
  const c = nrm(category), t = nrm(type);
  if (c.includes("penal")) return PARTY_ROLES.penal;
  if (c.includes("concili") || t.includes("concili")) return PARTY_ROLES.conciliacion;
  if (t.includes("ejecutiv") || c.includes("ejecutiv")) return PARTY_ROLES.ejecutivo;
  if (c.includes("peticion")) return PARTY_ROLES.peticion;
  if (c.includes("datacredito")) return PARTY_ROLES.reclamo;
  return PARTY_ROLES.judicial;
}

/** Imported or typed role: accept close spellings ("demandada", "victima"). */
export function normPartyRole(x) {
  const n = nrm(x);
  if (!n) return "";
  return ALL_PARTY_ROLES.find((r) => nrm(r) === n) || ALL_PARTY_ROLES.find((r) => n.startsWith(nrm(r).slice(0, -1))) || null;
}

// ----- Court directory segmentation (department → city/circuit → area) -----
const plain = (x) => String(x ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();

/**
 * The judicial circuit a court belongs to: the file's own column when it has
 * one, else the city named in "… del Circuito de Ibagué". Municipal courts
 * without that information keep "" and are found by their own city.
 */
export function courtCircuit(name, given = "") {
  const g = String(given ?? "").trim().replace(/^circuito( judicial)?( de)?\s+/i, "");
  if (g) return g;
  const m = String(name ?? "").match(/circuito(?:\s+judicial)?\s+de\s+([^,;()\-–]+?)\s*(?:[,;()\-–]|$)/i);
  return m ? m[1].trim() : "";
}

// Courts that also hear an area's cases: promiscuous courts hear every area,
// small-claims courts hear minor civil cases.
const AREA_ALSO = {
  Civil: ["Promiscuo", "Pequeñas Causas y Competencia Múltiple"],
  Familia: ["Promiscuo"], Laboral: ["Promiscuo"], Penal: ["Promiscuo"],
};
export const areaIncludes = (area) => (area ? [area, ...(AREA_ALSO[area] || [])] : []);
// v2.75: «Otros» = every court that is neither Civil nor Penal (Familia, Laboral, Administrativo, promiscuos…).
const hearsArea = (c, area) => (area === "Otros" ? !["Civil", "Penal"].includes(c.area) : areaIncludes(area).includes(c.area));

/** True when a court is in the department, sits in the city or belongs to its circuit, and hears the area. */
export function courtMatches(c, { department = "", city = "", area = "" } = {}) {
  if (department && plain(c.department) !== plain(department)) return false;
  if (city && plain(c.city) !== plain(city) && plain(c.circuit) !== plain(city)) return false;
  if (area && !hearsArea(c, area)) return false;
  return true;
}

/**
 * Courts for a search. The exact city and area come first (Ibagué + Familia →
 * only Ibagué's family courts); only when none exist does it widen to the
 * circuit's courts and the ones that also hear the area (promiscuous).
 */
export function filterCourts(list, want = {}) {
  const exact = list.filter((c) => courtMatches(c, want)
    && (!want.city || plain(c.city) === plain(want.city))
    && (!want.area || (want.area === "Otros" ? hearsArea(c, "Otros") : c.area === want.area)));
  return exact.length ? exact : list.filter((c) => courtMatches(c, want));
}

// v2.83: a court written by hand in a case («Juzgado 02 Laboral Circuito - Tolima - Ibagué») is the directory court
// «Juzgado 002 Laboral del Circuito de Ibagué» when, ignoring accents, case, zeros, ordinals and the place words, they say the same.
const COURT_ORD = { primero: 1, primer: 1, segundo: 2, tercero: 3, tercer: 3, cuarto: 4, quinto: 5, sexto: 6, septimo: 7, octavo: 8, noveno: 9, decimo: 10 };
const COURT_FILLER = new Set(["juzgado", "de", "del", "la", "el", "los", "las", "y", "en", "judicial", "distrito", "departamento", "dpto"]);
const COURT_KIND = new Set(["circuito", "municipal"]);
const courtWords = (t) => plain(String(t ?? "").replace(/[-–,;()/]/g, " ")).split(" ").filter(Boolean)
  .map((w) => COURT_ORD[w] !== undefined ? String(COURT_ORD[w]) : /^\d+$/.test(w) ? String(Number(w)) : w);
export function sameCourtName(written, court) {
  const place = new Set([court.department, court.city, court.circuit].flatMap(courtWords));
  const keep = (t) => new Set(courtWords(t).filter((w) => !COURT_FILLER.has(w) && !place.has(w)));
  const a = keep(written), b = keep(court.name);
  if (!a.size || !b.size) return false;
  const only = (x, y) => [...x].filter((w) => !y.has(w));
  const da = only(a, b), db = only(b, a);
  // Same words, or one side merely lacks «circuito»/«municipal»; «Municipal» against «Circuito» are different courts.
  return (!da.length && db.every((w) => COURT_KIND.has(w))) || (!db.length && da.every((w) => COURT_KIND.has(w)));
}

// The case's folder number lives in a custom field called "No. Carpeta" (or "Carpeta", "N° de carpeta"…).
export const isFolderLabel = (label) => /^(n|no|nro|num|numero)?(de)?carpeta$/.test(nrm(label).replace(/[^a-z]/g, ""));
// Version 2.33: an Excel radicado that was not 23 digits was kept in "Radicado (como venía)";
// the user says it is the case number («Número de expediente», cases.case_number).
export const isImportedRadicadoLabel = (label) => /^radicado\s*\(como ven[ií]a\)$/i.test(String(label ?? "").trim());
/** Version 2.35 (user's rule): a 21-digit case number + "00" is the case's 23-digit radicado.
 *  For cases without radicado; a radicado already used by another case is skipped. */
export function radicadosFromNumbers(cases) {
  const used = new Set(cases.map((k) => k.radicado).filter(Boolean));
  const out = [], skipped = [];
  for (const k of cases) {
    const n = String(k.case_number ?? "").trim();
    if (k.radicado || !/^\d{21}$/.test(n)) continue;
    const radicado = `${n}00`;
    if (used.has(radicado)) { skipped.push({ id: k.id, radicado }); continue; }
    used.add(radicado);
    out.push({ id: k.id, radicado });
  }
  return { out, skipped };
}
/** Case number as typed: spaces collapsed, at most 60 characters. */
export const cleanCaseNumber = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
/** Folder numbers compare without spaces, dots or case: "Carpeta 045-A" = "045a". */
export const folderKey = (v) => nrm(v).replace(/^(n|no|nro|num|numero)?\.?\s*(de)?\s*carpeta\s*/, "").replace(/[^a-z0-9]/g, "");
/** Next free folder number: one more than the highest purely numeric one in use. */
export function nextFolder(values) {
  const nums = values.map((v) => String(v ?? "").trim()).filter((v) => /^\d{1,9}$/.test(v)).map(Number);
  return nums.length ? String(Math.max(...nums) + 1) : "1";
}

// ----- Task history (version 2.18): what each person did on each task, and when -----
export const TASK_LOG_LABEL = {
  creada: "Creó", editada: "Editó", reasignada: "Reasignó", reprogramada: "Cambió el plazo", hecha: "Marcó como hecha",
  cancelada: "Marcó como no cumplida o canceló", reabierta: "Reabrió", entregada: "Registró la entrega", respondida: "Registró la respuesta", eliminada: "Eliminó",
  notificada: "Notificó al asignado",
};
const TASK_EDIT_FIELDS = { kind: "tipo", title: "título", notes: "notas", location: "lugar", remind_days: "avisos", done_notes: "cumplimiento",
  term_from: "término", term_days: "término", term_unit: "término", term_label: "término", response_notes: "detalle de la respuesta" };
/** Events between two versions of a task (null before = created, null after = deleted). nameOf(userId) gives a person's name. */
export function taskLogEvents(before, after, nameOf = () => "") {
  const who = (id) => nameOf(id) || "un funcionario";
  if (!before) {
    const out = [{ action: "creada", detail: after.assigned_user_id ? `Asignada a ${who(after.assigned_user_id)} · plazo ${after.due_at}` : `Plazo ${after.due_at}` }];
    if (after.status !== "pendiente") out.push({ action: after.status, detail: after.done_notes || "" });
    return out;
  }
  if (!after) return [{ action: "eliminada", detail: "" }];
  const out = [];
  const same = (k) => JSON.stringify(before[k] ?? "") === JSON.stringify(after[k] ?? "");
  // Notes written while closing the task go with "Marcó como hecha", not as an edit.
  const edited = [...new Set(Object.keys(TASK_EDIT_FIELDS).filter((k) => !same(k) && !(k === "done_notes" && before.status !== after.status)).map((k) => TASK_EDIT_FIELDS[k]))];
  if (edited.length) out.push({ action: "editada", detail: `Cambió ${edited.join(", ")}` });
  if (!same("due_at")) out.push({ action: "reprogramada", detail: `De ${before.due_at} a ${after.due_at}` });
  if ((before.assigned_user_id || null) !== (after.assigned_user_id || null)) out.push({ action: "reasignada",
    detail: `${before.assigned_user_id ? `De ${who(before.assigned_user_id)}` : "Del responsable del expediente"} ${after.assigned_user_id ? `a ${who(after.assigned_user_id)}` : "al responsable del expediente"}` });
  if (after.delivered_at && !same("delivered_at")) out.push({ action: "entregada", detail: `Entregada el ${after.delivered_at}` });
  if (after.response_at && !same("response_at")) out.push({ action: "respondida", detail: [`Respuesta del ${after.response_at}`, after.response_notes].filter(Boolean).join(" · ") });
  if (before.status !== after.status) out.push({ action: after.status === "pendiente" ? "reabierta" : after.status, detail: after.status === "hecha" || after.status === "cancelada" ? after.done_notes || "" : "" });
  return out;
}

// ----- Notice to the assignee (version 2.26): same words by e-mail, WhatsApp and in the bell -----
/**
 * The message telling a funcionario about a task or hearing. `t` is a task as the API returns it,
 * `to` the person's name, `by` who sends it, `message` an optional note, `link` the case address.
 */
export function taskNotice(t, { to = "", by = "", message = "", link = "" } = {}) {
  const kind = TASK_KIND_LABEL[t.kind] || "Tarea";
  const when = t.kind === "audiencia" ? "Fecha y hora" : "Plazo";
  const caseLine = [t.client_name, t.type_name, t.radicado && `radicado ${t.radicado}`].filter(Boolean).join(" · ");
  const subject = `${kind}: ${t.title} · ${t.due_at}`;
  const text = [
    `${to ? `Hola, ${to}.` : "Hola."}`, "",
    `${by || "La oficina"} le notifica ${t.kind === "audiencia" ? "esta audiencia" : "esta tarea"} en TecjuridicosApp:`, "",
    `Tipo: ${kind}`, `Asunto: ${t.title}`, `${when}: ${t.due_at} (hora de Colombia)`,
    t.location && `Lugar o enlace: ${t.location}`, caseLine && `Expediente: ${caseLine}`, t.notes && `Notas: ${t.notes}`,
    message && "", message && `Mensaje: ${message}`, link && "", link && `Ver el expediente: ${link}`,
  ].filter((x) => x !== "" ? !!x : true).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const short = [`${kind}: ${t.title}`, `${when} ${t.due_at}`, t.location, t.client_name, message].filter(Boolean).join(" · ");
  return { subject, text, short };
}

// ----- Case tasks: kinds and follow-up (change 47) -----
export const TASK_KINDS = ["tarea", "audiencia", "termino", "recurso", "requerimiento", "peticion", "oficio"];
export const TASK_KIND_LABEL = { tarea: "Tarea", audiencia: "Audiencia", termino: "Término", recurso: "Recurso", requerimiento: "Requerimiento", peticion: "Petición", oficio: "Oficio" };
/** Task a bell notice is about, from its key ("task:ID:…", "assign:ID:…", "notice:ID:…"); null for the rest. */
export function noteTaskId(n) {
  const m = /^(?:task|assign|notice):(\d+):/.exec(n?.key || "");
  return m ? Number(m[1]) : null;
}
/**
 * Version 2.97: does a bell notice still show? Nothing is deleted, the bell just stops listing it.
 * A notice about a task disappears once the task is resolved (Cumplida / No cumplida) or deleted; the
 * reminders of an agenda item (any reminder, and everything about a hearing) disappear when its date
 * arrives; read «actuaciones nuevas» notices stop showing. `task` is the task row, or null.
 */
export function bellShows(n, task, nowMs, dueMs) {
  if (n.kind === "actuacion" && n.read_at) return false;
  const id = noteTaskId(n);
  if (id === null) return true;
  if (!task || task.status !== "pendiente") return false;
  const reached = nowMs >= dueMs;
  if (task.kind === "audiencia") return !reached;
  return !(reached && /^task:\d+:\d+$/.test(n.key));
}
/** Kinds whose answer is tracked: delivered on a date, answered (or not) by the deadline. */
export const RESPONSE_KINDS = ["oficio", "peticion", "requerimiento"];
/** Stored UTC "YYYY-MM-DD HH:MM[:SS]" → Colombia time "YYYY-MM-DD HH:MM" (UTC-5, no daylight saving). */
export const utcToBogota = (utc) => (utc ? new Date(Date.parse(String(utc).replace(" ", "T").slice(0, 19) + "Z") - 5 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") : "");

/**
 * Follow-up state of a task at `now` (Colombia time "YYYY-MM-DD HH:MM"):
 * { key, label, tone } with tone ok | warn | bad | muted.
 */
export function taskFollowUp(t, now) {
  const answered = RESPONSE_KINDS.includes(t.kind);
  if (t.status === "cancelada") return { key: "cancelada", label: "No cumplida", tone: "bad" };
  if (t.status === "hecha") {
    const when = (answered && t.response_at) || utcToBogota(t.done_at);
    const late = when && t.due_at && when.slice(0, 16) > t.due_at && !(when.length === 10 && when <= t.due_at.slice(0, 10));
    return late ? { key: "tarde", label: answered ? "Respondido fuera de plazo" : "Cumplida con retraso", tone: "warn" }
      : { key: "a_tiempo", label: answered ? "Respondido" : "Cumplida a tiempo", tone: "ok" };
  }
  if (t.due_at && t.due_at < now) return { key: "vencida", label: answered ? "Sin respuesta · plazo vencido" : "Vencida", tone: "bad" };
  const soon = t.due_at && Date.parse(t.due_at.replace(" ", "T") + "Z") - Date.parse(now.replace(" ", "T") + "Z") <= 2 * 86400000;
  if (answered) return { key: soon ? "por_vencer" : "en_plazo", label: t.delivered_at ? (soon ? "Esperando respuesta · vence pronto" : "Esperando respuesta") : "Por entregar", tone: soon ? "warn" : "muted" };
  return soon ? { key: "por_vencer", label: "Por vencer", tone: "warn" } : { key: "en_plazo", label: "En plazo", tone: "muted" };
}

// ----- Procedural terms (change 48): suggestions only; the user sets the days -----
// judicial: true → the days of vacancia judicial do not count (court terms); false → administrative (e.g. petitions).
export const LEGAL_TERMS = [
  ["Civil y familia (CGP)", [
    ["Recurso de reposición", 3, "habiles", "CGP art. 318", "recurso"],
    ["Apelación de auto o sentencia fuera de audiencia", 3, "habiles", "CGP art. 322", "recurso"],
    ["Sustentar apelación de sentencia ante el superior", 5, "habiles", "Ley 2213 art. 12", "recurso"],
    ["Recurso de súplica", 3, "habiles", "CGP art. 331", "recurso"],
    ["Interponer casación", 5, "habiles", "CGP art. 337", "recurso"],
    ["Contestar demanda (verbal)", 20, "habiles", "CGP art. 369", "termino"],
    ["Contestar demanda (verbal sumario)", 10, "habiles", "CGP art. 391", "termino"],
    ["Excepciones en proceso ejecutivo", 10, "habiles", "CGP art. 442", "termino"],
    ["Oposición en proceso monitorio", 10, "habiles", "CGP art. 421", "termino"],
    ["Subsanar la demanda", 5, "habiles", "CGP art. 90", "termino"],
    ["Descorrer traslado de excepciones (verbal)", 5, "habiles", "CGP art. 370", "termino"],
  ]],
  ["Laboral (CPTSS)", [
    ["Recurso de reposición (auto notificado por estado)", 2, "habiles", "CPTSS art. 63", "recurso"],
    ["Apelación de auto notificado por estado", 5, "habiles", "CPTSS art. 65", "recurso"],
    ["Interponer casación", 15, "habiles", "CPTSS art. 88", "recurso"],
    ["Contestar demanda ordinaria", 10, "habiles", "CPTSS art. 74", "termino"],
    ["Subsanar la demanda", 5, "habiles", "CPTSS art. 28", "termino"],
  ]],
  ["Contencioso administrativo (CPACA)", [
    ["Recurso de reposición", 3, "habiles", "CPACA art. 242 y CGP art. 318", "recurso"],
    ["Apelación de auto", 3, "habiles", "CPACA art. 244", "recurso"],
    ["Apelación de sentencia", 10, "habiles", "CPACA art. 247", "recurso"],
    ["Contestar demanda", 30, "habiles", "CPACA art. 172", "termino"],
    ["Subsanar la demanda", 10, "habiles", "CPACA art. 170", "termino"],
  ]],
  ["Tutela", [
    ["Impugnar el fallo", 3, "habiles", "Decreto 2591 art. 31", "recurso"],
    ["Cumplir el fallo (48 horas)", 2, "calendario", "Decreto 2591 art. 27", "termino"],
  ]],
  ["Actuación administrativa", [
    ["Recursos de reposición y apelación ante la entidad", 10, "habiles", "CPACA art. 76", "recurso", false],
    ["Derecho de petición (general)", 15, "habiles", "Ley 1755 art. 14", "peticion", false],
    ["Petición de documentos o información", 10, "habiles", "Ley 1755 art. 14", "peticion", false],
    ["Consulta a una autoridad", 30, "habiles", "Ley 1755 art. 14", "peticion", false],
  ]],
].map(([area, items]) => [area, items.map(([name, days, unit, norm, kind, judicial = true]) => ({ area, name, days, unit, norm, kind, judicial }))]);

// ----- Parties of the case (change 49): several plaintiffs / defendants, marking which are our clients -----
const ACTIVE_ROLES = ["Demandante", "Ejecutante", "Convocante", "Querellante", "Denunciante", "Víctima", "Peticionario", "Reclamante"];
/** "activa" for the side that sues (demandante, ejecutante…), "pasiva" for the other; "" when unknown. */
export const sideOfRole = (role) => (!role ? "" : ACTIVE_ROLES.includes(role) ? "activa" : "pasiva");
/** Plural names of each side for a process: { activa: "Demandantes", pasiva: "Demandados" }. */
export function sideLabels(category, type = "") {
  const roles = partyRolesFor(category, type);
  if (roles === PARTY_ROLES.penal) return { activa: "Denunciantes o víctimas", pasiva: "Denunciados, indiciados o procesados" };
  if (roles.length < 2) return { activa: `${roles[0]}s`, pasiva: "Entidades o contrapartes" };
  return { activa: `${roles[0]}s`, pasiva: `${roles[1]}s` };
}
/** Roles of each side for a process, the process's own first: { activa: [...], pasiva: [...], others: [...] }. */
export function sideRoles(category, type = "") {
  const own = partyRolesFor(category, type);
  return { activa: own.filter((r) => sideOfRole(r) === "activa"), pasiva: own.filter((r) => sideOfRole(r) === "pasiva"),
    others: ALL_PARTY_ROLES.filter((r) => !own.includes(r)) };
}
/** Validated list of parties; returns { parties } or { error }. */
export function cleanParties(list) {
  if (list == null) return { parties: [] };
  if (!Array.isArray(list) || list.length > 40) return { error: "Lista de partes no válida (máximo 40)." };
  const parties = [];
  for (const p of list) {
    const name = String(p?.name ?? "").trim().replace(/\s+/g, " ").slice(0, 160);
    if (!name) continue;
    // Each party may carry its own role (version 2.15); the role decides the side.
    const role = normPartyRole(p.role);
    if (role === null) return { error: `Rol de la parte no válido: ${p.role}` };
    const side = role ? sideOfRole(role) : p.side;
    if (!["activa", "pasiva"].includes(side)) return { error: "Indique si cada parte es demandante o demandada." };
    parties.push({ side, ...(role ? { role } : {}), name, id_type: String(p.id_type ?? "").trim().slice(0, 10), id_number: String(p.id_number ?? "").trim().slice(0, 30),
      ours: !!p.ours, client_id: Number.isInteger(Number(p.client_id)) && Number(p.client_id) > 0 ? Number(p.client_id) : null });
  }
  return { parties };
}

// ----- Audit log (change 50): who changed what, when, from which device -----
/** "Móvil" / "Tableta" / "PC" plus system and browser, from the User-Agent. */
export function deviceOf(ua = "") {
  const u = String(ua);
  const kind = /iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(u) ? "Tableta" : /Mobi|iPhone|iPod|Android|Windows Phone/i.test(u) ? "Móvil" : u ? "PC" : "—";
  const os = /iPhone|iPad|iPod/.test(u) ? "iOS" : /Android/.test(u) ? "Android" : /Windows/.test(u) ? "Windows" : /Mac OS X|Macintosh/.test(u) ? "macOS" : /Linux/.test(u) ? "Linux" : "";
  const browser = /Edg\//.test(u) ? "Edge" : /OPR\//.test(u) ? "Opera" : /CriOS|Chrome\//.test(u) ? "Chrome" : /FxiOS|Firefox\//.test(u) ? "Firefox" : /Safari\//.test(u) ? "Safari" : "";
  return { kind, detail: [os, browser].filter(Boolean).join(" · ") };
}
// Module and record for an API path (method + path without /api).
const AUDIT_ENTITIES = [
  [/^\/admin\/backups/, "Configuración", "copia de seguridad"],
  [/^\/cases\/(\d+)\/documents/, "Expedientes", "documento del expediente", "case"],
  [/^\/cases(?:\/(\d+))?/, "Expedientes", "expediente", "case"],
  [/^\/clients\/(\d+)\/consent/, "Clientes", "autorización de datos"],
  [/^\/clients(?:\/(\d+))?/, "Clientes", "cliente"],
  [/^\/tasks(?:\/(\d+))?/, "Agenda", "tarea"],
  [/^\/payments\/charges(?:\/(\d+))?/, "Pagos", "cobro"],
  [/^\/payments\/receipts(?:\/(\d+))?/, "Pagos", "recibo"],
  [/^\/payments/, "Pagos", "pagos"],
  [/^\/esign(?:\/(\d+))?/, "Firmas", "solicitud de firma"],
  [/^\/mail(?:\/(\d+))?/, "Correo certificado", "correo"],
  [/^\/admin\/users(?:\/(\d+))?/, "Usuarios", "usuario"],
  [/^\/admin\/roles/, "Usuarios", "rol"],
  [/^\/admin\/(matrix|permissions)/, "Usuarios", "permisos"],
  [/^\/admin\/offices(?:\/(\d+))?/, "Usuarios", "oficina"],
  [/^\/admin/, "Configuración", "ajuste"],
  [/^\/(categories|types|fields|catalog)(?:\/(\d+))?/, "Configuración", "catálogo de procesos"],
  [/^\/courts/, "Despachos", "despacho"],
  [/^\/authorities(?:\/(\d+))?/, "Despachos", "funcionario de entidad"],
  [/^\/templates/, "Documentos", "plantilla"],
  [/^\/generate/, "Documentos", "borrador"],
  [/^\/monitor\/check/, "Consulta de procesos", "consulta en la Rama Judicial"],
  [/^\/monitor/, "Consulta de procesos", "consulta"],
  [/^\/jurisprudencia/, "Jurisprudencia", "jurisprudencia"],
  [/^\/import/, "Importar", "importación"],
  [/^\/auth/, "Acceso", "cuenta"],
];
/** { module, entity, id, isCase } for a path; id is the record number in the path, if any. */
export function auditTarget(path) {
  const p = String(path).split("?")[0];
  for (const [re, module, entity, isCase] of AUDIT_ENTITIES) {
    const m = p.match(re);
    if (m) return { module, entity, id: Number(m[1] && /^\d+$/.test(m[1]) ? m[1] : m[2]) || null, isCase: !!isCase };
  }
  return { module: "Otros", entity: p.split("/")[1] || "", id: null, isCase: false };
}
export const auditVerb = (method, path) => (/^\/monitor\/check/.test(path) ? "Consultó" : /^\/mail$/.test(path) ? "Envió" : /^\/generate/.test(path) ? "Generó"
  : method === "POST" ? "Creó" : method === "DELETE" ? "Eliminó" : "Modificó");
/** Spanish names of the fields shown in the change details. */
export const AUDIT_FIELDS = {
  title: "Asunto o título", status: "Estado", client_role: "Calidad del cliente", affiliated: "Afiliado", parties: "Partes", radicado: "Radicado", case_number: "Número de expediente",
  court_name: "Despacho", judge_name: "Juez", court_email: "Correo del despacho", department: "Departamento", city: "Ciudad", area: "Área", counterparty: "Contraparte",
  facts: "Hechos", field_values: "Campos del proceso", office_id: "Oficina", assigned_user_id: "Responsable", process_type_id: "Tipo de proceso",
  monitor: "Consulta automática", full_name: "Nombre", first_names: "Nombres", last_names: "Apellidos", id_type: "Tipo de documento", id_number: "Documento",
  email: "Correo", phone: "Teléfono", address: "Dirección", notes: "Notas", legal_rep: "Representante legal", person_type: "Tipo de persona", foto: "Foto", archive_status: "Archivo del cliente",
  kind: "Tipo", due_at: "Plazo", location: "Lugar", remind_days: "Avisos", done_notes: "Cumplimiento", delivered_at: "Entregado", response_at: "Respuesta",
  response_notes: "Detalle de la respuesta", term_days: "Días del término", term_from: "Término desde", term_unit: "Clase de días", term_label: "Término",
  concept: "Concepto", amount: "Valor", due_date: "Vence", plan_label: "Cuota", voided_at: "Anulado", void_reason: "Motivo de anulación",
  entity: "Entidad", treatment: "Tratamiento", court_address: "Dirección del despacho",
  name: "Nombre", role: "Rol", active: "Activo", professional_card: "Tarjeta profesional", legal_name: "Nombre completo para firmas", id_number: "Cédula", custom_permissions: "Permisos propios",
};
/** Field-by-field differences between two rows: [{ field, label, before, after }]. */
export function auditDiff(before, after) {
  if (!before || !after) return [];
  const show = (v) => { const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return s.length > 300 ? s.slice(0, 300) + "…" : s; };
  const out = [];
  for (const k of Object.keys(AUDIT_FIELDS)) {
    if (!(k in before) && !(k in after)) continue;
    const a = show(before[k]), b = show(after[k]);
    if (a !== b) out.push({ field: k, label: AUDIT_FIELDS[k], before: a, after: b });
  }
  return out;
}

// ---------- Addressee of an e-mail, petition or letter (version 2.27) ----------
// The official's name comes from the case (the judge chosen in the case) or from
// the firm's own list of officials per entity; it is always editable before sending.
export const TREATMENTS = ["Señor(a)", "Señor", "Señora", "Doctor(a)", "Doctor", "Doctora"];

/** Comparison key of an entity name: no accents, case, punctuation or extra spaces. */
export const entityKey = (x) => nrm(x).replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();

/** Usual title of whoever heads a court or authority, from its name ("" when unknown). */
export function officialTitle(entity) {
  const n = nrm(entity);
  if (!n) return "";
  if (/^juzgado|\bjuzgado\b/.test(n)) return "Juez";
  if (/consejo de estado/.test(n)) return "Consejero(a) ponente";
  if (/tribunal|corte|sala\b|comision (nacional |seccional )?de disciplina/.test(n)) return "Magistrado(a) ponente";
  if (/fiscalia/.test(n)) return "Fiscal";
  if (/procuraduria/.test(n)) return "Procurador(a)";
  if (/personeria/.test(n)) return "Personero(a)";
  if (/notaria/.test(n)) return "Notario(a)";
  if (/alcaldia/.test(n)) return "Alcalde(sa)";
  if (/gobernacion/.test(n)) return "Gobernador(a)";
  if (/inspeccion/.test(n)) return "Inspector(a)";
  if (/comisaria/.test(n)) return "Comisario(a) de Familia";
  return "";
}
export const isJudicialEntity = (entity) => /juzgado|tribunal|corte|consejo de estado|sala\b|comision (nacional |seccional )?de disciplina/.test(nrm(entity));

/** Saved official for an entity name, from the list of officials per entity. */
export function findAuthority(list, entity) {
  const key = entityKey(entity);
  return key ? (list || []).find((a) => entityKey(a.entity) === key) || null : null;
}

/**
 * Addressee for a case: the court and the judge recorded in the case first,
 * then the official saved for that entity. `entity` overrides the case's court
 * (e.g. a petition to Colpensiones from a case before a court).
 */
export function caseRecipient(k, authorities = [], entity = "") {
  const court = String(k?.court_name || "").trim();
  const target = String(entity || "").trim() || court || String(k?.counterparty || "").trim();
  const saved = findAuthority(authorities, target);
  const sameCourt = !!court && entityKey(target) === entityKey(court);
  const judge = sameCourt ? String(k?.judge_name || "").trim() : "";
  return {
    treatment: saved?.treatment || "Señor(a)",
    name: judge || saved?.name || "",
    title: saved?.title || officialTitle(target),
    entity: saved?.entity || target,
    address: saved?.address || (sameCourt ? k?.court_address || "" : ""),
    email: (sameCourt && k?.court_email) || saved?.email || "",
    city: saved?.city || (sameCourt ? k?.city || "" : ""),
    source: judge ? "expediente" : saved?.name ? "directorio" : "",
  };
}

/** The addressee block that opens the letter: treatment, name, title, entity, address, e-mail, city. */
export function recipientLines(r) {
  if (!r || !(r.name || r.entity)) return [];
  const lines = [r.treatment || "Señor(a)"];
  if (r.name) lines.push(r.name);
  if (r.title) lines.push(r.title);
  if (r.entity) lines.push(r.entity);
  if (r.address) lines.push(r.address);
  if (r.email) lines.push(`Correo: ${r.email}`);
  if (r.city && !nrm(`${r.entity} ${r.address}`).includes(nrm(r.city))) lines.push(r.city);
  if (isJudicialEntity(r.entity)) lines.push("E. S. D.");
  return lines;
}
export const recipientText = (r) => recipientLines(r).join("\n");
/** One line for the AI engine and for a subject: "Señor(a) Ana Pérez, Juez, Juzgado …". */
export const recipientInline = (r) => (r && (r.name || r.entity)
  ? [`${r.treatment || "Señor(a)"} ${r.name || ""}`.trim(), r.title, r.entity, r.city && !nrm(r.entity).includes(nrm(r.city)) ? r.city : ""].filter(Boolean).join(", ") : "");

/** Template markers {{destinatario.*}} from an addressee. */
export function recipientVariables(r) {
  if (!r || !(r.name || r.entity)) return {};
  return {
    "destinatario.tratamiento": r.treatment || "Señor(a)", "destinatario.nombre": r.name || "", "destinatario.cargo": r.title || "",
    "destinatario.entidad": r.entity || "", "destinatario.direccion": r.address || "", "destinatario.ciudad": r.city || "", "destinatario.correo": r.email || "",
    "destinatario.bloque": recipientText(r),
  };
}

/** Lines for the drafting engine: the official the document is addressed to, as the user checked it. */
export function recipientPrompt(r) {
  if (!r || typeof r !== "object") return [];
  const t = (x) => String(x ?? "").trim().slice(0, 200);
  const line = recipientInline({ treatment: t(r.treatment), name: t(r.name), title: t(r.title), entity: t(r.entity), city: t(r.city) });
  if (!line) return [];
  return [`Addressee official (address the document to this person exactly as written; never invent another name): ${line}`,
    ...(t(r.address) ? [`Addressee postal address: ${t(r.address)}`] : []), ...(t(r.email) ? [`Addressee e-mail: ${t(r.email)}`] : [])];
}

// ----- Version 2.44: the minuta's own data saved in the case -----
// A minuta can ask for data the App has no field for (the deceased affiliate's name, document,
// place of issue, date of death). Typed once in Documentos, each one is kept in the case as a
// field of its process type ({{campo.<label>}}): the next document of that case finds it filled.
const FIELD_MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const fieldLabelKey = (label) => nrm(label).replace(/\s+/g, " ");
/** A date field writes "21 de abril de 2026" in documents; anything else as saved. */
export function fieldDocValue(field, value) {
  const v = String(value ?? "").trim();
  const m = field?.field_type === "date" && v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[3])} de ${FIELD_MONTHS[Number(m[2]) - 1]} de ${m[1]}` : v;
}
/** A label read as a date ("Fecha del fallecimiento") gets a date field. */
export const fieldTypeFor = (label) => (/^fecha\b/.test(fieldLabelKey(label)) ? "date" : "text");
/** [{label, value}] from a request: labels without {{ }} or |, at most 40 rows. Returns a message on bad input. */
export function cleanCaseFields(list) {
  if (!Array.isArray(list) || !list.length) return "No hay datos para guardar.";
  const out = [];
  for (const x of list.slice(0, 40)) {
    const label = String(x?.label ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!label || /[{}|]/.test(label)) return `Nombre de dato no válido: «${label}».`;
    let value = String(x?.value ?? "").trim().slice(0, 2000);
    if (fieldTypeFor(label) === "date" && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return `Escriba «${label}» como fecha (año-mes-día).`;
    out.push({ label, value });
  }
  return out;
}

// ----- Client's gender in documents (version 2.50): «el suscrito / identificado / domiciliado» or the feminine -----
/** "hombre" | "mujer" | "" from what a form, a file or a document field gave. */
export function normGender(v) {
  const s = nrm(v);
  if (/^(h|m|hombre|masculino|varon)$/.test(s)) return "hombre"; // «M/F» in a sex column: M = masculino
  return /^(f|mujer|femenino)$/.test(s) ? "mujer" : "";
}
/**
 * The class of process and its radicado as the poderes and peticiones write them (version 2.52):
 * «Proceso Ordinario Laboral de Primera Instancia. Radicación No. 73001…». Penal cases leave all three empty
 * (not every poder is for a criminal case), so the passage is left out.
 */
export function processVariables(category, area, typeName, radicado) {
  const penal = /penal/i.test(`${category || ""} ${area || ""}`);
  const clase = penal ? "" : String(typeName || "").replace(/\s*›\s*/g, " ").trim();
  const rad = penal || !radicado ? "" : `Radicación No. ${radicado}`;
  return {
    "expediente.clase_proceso": clase,
    "expediente.radicacion": rad,
    "expediente.proceso_linea": [clase && `Proceso ${clase}`, rad].filter(Boolean).join(". "),
  };
}
export const GENDER_LABEL = { hombre: "Hombre", mujer: "Mujer" };
/** Marker keys that change with the client's gender; the document form asks only «Género del cliente». */
export const GENDER_KEYS = ["cliente.suscrito", "cliente.suscrito_solo", "cliente.identificado", "cliente.domiciliado", "cliente.el", "cliente.senor", "cliente.el_senor", "cliente.del_senor"];
/** The gendered words for a client, or {} while the gender is unknown (the document then shows [FILL: …]). */
export function genderWords(v) {
  const g = normGender(v);
  if (!g) return {};
  const m = g === "hombre";
  return {
    "cliente.genero": GENDER_LABEL[g],
    "cliente.suscrito": m ? "el suscrito" : "la suscrita",
    "cliente.suscrito_solo": m ? "suscrito" : "suscrita",
    "cliente.identificado": m ? "identificado" : "identificada",
    "cliente.domiciliado": m ? "domiciliado" : "domiciliada",
    "cliente.el": m ? "el" : "la",
    "cliente.senor": m ? "señor" : "señora",
    "cliente.el_senor": m ? "el señor" : "la señora",
    "cliente.del_senor": m ? "del señor" : "de la señora",
  };
}
/** Where the client's ID card was issued (version 2.56): «Ibagué (Tolima)»; Bogotá alone, since its department has the same name. */
export function idPlaceVariables(c) {
  const city = String(c?.id_city ?? "").trim(), dep = String(c?.id_department ?? "").trim();
  const both = city && dep && city !== dep ? `${city} (${dep})` : city || dep;
  return { "cliente.expedicion": both, "cliente.expedicion_ciudad": city, "cliente.expedicion_departamento": dep };
}
// Common male names ending in «a» and female names that do not end in it, so the suggestion is not wrong on the obvious ones.
const MALE_A = new Set(["jose", "joshua", "luca", "bautista", "mustafa"]);
const FEMALE_OTHER = new Set(["carmen", "beatriz", "luz", "mercedes", "dolores", "ines", "isabel", "raquel", "esther", "ruth", "miriam", "yaneth", "janeth", "elizabeth", "jennifer", "yuliet", "yulieth", "nancy", "marlen", "marleny", "maryory", "rocio", "pilar", "consuelo", "soledad", "amparo", "gladys", "liliana"]);
/** Only a suggestion from the first given name; the person confirms it. Returns "hombre", "mujer" or "". */
export function guessGender(fullName) {
  const first = nrm(fullName).split(/\s+/)[0] || "";
  if (!first) return "";
  if (FEMALE_OTHER.has(first)) return "mujer";
  if (MALE_A.has(first)) return "hombre";
  if (first.endsWith("a")) return "mujer";
  return /[aeiou]$|[nslrdz]$/.test(first) ? "hombre" : "";
}
