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
  penal: ["Querellante", "Querellado", "Denunciante", "Denunciado", "Víctima", "Defendido"],
  peticion: ["Peticionario"],
  reclamo: ["Reclamante"],
};
export const ALL_PARTY_ROLES = [...new Set(Object.values(PARTY_ROLES).flat())];

/** Roles offered for a category and sub-process (e.g. "Laboral", "Ejecutivo Laboral"). */
export function partyRolesFor(category, type = "") {
  const c = nrm(category), t = nrm(type);
  if (c.includes("penal")) return PARTY_ROLES.penal;
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

/** True when a court is in the department, sits in the city or belongs to its circuit, and hears the area. */
export function courtMatches(c, { department = "", city = "", area = "" } = {}) {
  if (department && plain(c.department) !== plain(department)) return false;
  if (city && plain(c.city) !== plain(city) && plain(c.circuit) !== plain(city)) return false;
  if (area && !areaIncludes(area).includes(c.area)) return false;
  return true;
}

// The case's folder number lives in a custom field called "No. Carpeta" (or "Carpeta", "N° de carpeta"…).
export const isFolderLabel = (label) => /^(n|no|nro|num|numero)?(de)?carpeta$/.test(nrm(label).replace(/[^a-z]/g, ""));

// ----- Case tasks: kinds and follow-up (change 47) -----
export const TASK_KINDS = ["tarea", "audiencia", "termino", "recurso", "requerimiento", "peticion", "oficio"];
export const TASK_KIND_LABEL = { tarea: "Tarea", audiencia: "Audiencia", termino: "Término", recurso: "Recurso", requerimiento: "Requerimiento", peticion: "Petición", oficio: "Oficio" };
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
  if (t.status === "cancelada") return { key: "cancelada", label: "Cancelada", tone: "muted" };
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
