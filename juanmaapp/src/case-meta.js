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
