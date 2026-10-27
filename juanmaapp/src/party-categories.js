// Party categories (version 2.2.89): the roles a client or another party can have in a process (Demandante, Ejecutante, Peticionario,
// Accionante, Denunciante…) and the conditions of the client (Cliente afiliado, Curador ad-litem). Gerencia sets them up; the case form
// reads them. Each role has its singular and plural name (the column title of «Partes del proceso»), its side and, optionally, its pair on the
// other side (Ejecutante ↔ Ejecutado). Shared by the server and the published link.

export const MAX_TITLE = 60;
const SIDES = ["activa", "pasiva"];

// [title, plural, side, pair title]. Created once; Gerencia adds, renames (while unused), orders, deactivates freely.
export const DEFAULT_ROLES = [
  ["Demandante", "Demandantes", "activa", "Demandado"], ["Demandado", "Demandados", "pasiva", "Demandante"],
  ["Ejecutante", "Ejecutantes", "activa", "Ejecutado"], ["Ejecutado", "Ejecutados", "pasiva", "Ejecutante"],
  ["Convocante", "Convocantes", "activa", "Convocado"], ["Convocado", "Convocados", "pasiva", "Convocante"],
  ["Accionante", "Accionantes", "activa", "Accionado"], ["Accionado", "Accionados", "pasiva", "Accionante"],
  ["Denunciante", "Denunciantes", "activa", "Denunciado"], ["Denunciado", "Denunciados", "pasiva", "Denunciante"],
  ["Peticionario", "Peticionarios", "activa", ""], ["Reclamante", "Reclamantes", "activa", ""],
  ["Víctima", "Víctimas", "activa", ""], ["Indiciado", "Indiciados", "pasiva", ""], ["Acusado", "Acusados", "pasiva", ""], ["Procesado", "Procesados", "pasiva", ""],
];
// Roles older cases may carry: kept (so nothing is lost) but not offered.
export const LEGACY_ROLES = [["Querellante", "Querellantes", "activa"], ["Querellado", "Querellados", "pasiva"], ["Defendido", "Defendidos", "pasiva"]];
// Conditions of the client; each one is stored in a column of the case (flag), so they can be renamed but not created.
export const DEFAULT_CONDITIONS = [["Cliente afiliado", "Clientes afiliados", "affiliated"], ["Curador ad-litem", "Curadores ad-litem", "ad_litem"]];

const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** How many cases use a role (as the client's role or in the list of parties). `cases`: [{ client_role, parties }] (parties as text or list). */
export function categoryUses(title, cases) {
  let n = 0;
  for (const k of cases) {
    let list = k.parties;
    if (typeof list === "string") { try { list = JSON.parse(list); } catch { list = []; } }
    if (k.client_role === title || (Array.isArray(list) && list.some((p) => p?.role === title))) n += 1;
  }
  return n;
}

/**
 * Validates a create/update body. `existing`: the stored row on update; `others`: the other categories; `uses`: how many cases use the
 * existing role. Returns the values or an error text.
 */
export function categoryValues(body, existing = null, others = [], uses = 0) {
  const b = body ?? {};
  const cond = existing?.kind === "condicion";
  const title = "title" in b ? String(b.title ?? "").replace(/\s+/g, " ").trim() : existing?.title ?? "";
  let plural = "plural" in b ? String(b.plural ?? "").replace(/\s+/g, " ").trim() : existing?.plural ?? "";
  const side = cond ? "" : "side" in b ? String(b.side ?? "") : existing?.side ?? "";
  const active = "is_active" in b ? !!b.is_active : existing ? !!existing.is_active : true;
  if (!title) return "Escriba el nombre de la categoría.";
  if (title.length > MAX_TITLE) return `El nombre debe tener máximo ${MAX_TITLE} caracteres.`;
  if (!plural) plural = `${title}s`;
  if (plural.length > MAX_TITLE) return `El plural debe tener máximo ${MAX_TITLE} caracteres.`;
  if (others.some((o) => fold(o.title) === fold(title))) return "Ya existe una categoría con ese nombre.";
  if (!cond && !SIDES.includes(side)) return "Indique si la categoría es de la parte activa (la que demanda o pide) o de la pasiva.";
  let pair_id = cond ? null : "pair_id" in b ? (b.pair_id ? Number(b.pair_id) : null) : existing?.pair_id ?? null;
  if (pair_id) {
    const p = others.find((o) => o.id === pair_id && o.kind !== "condicion");
    if (!p) return "La categoría pareja no existe.";
    if (p.side === side) return "La pareja debe ser de la otra parte (activa con pasiva).";
  }
  if (existing && !cond && uses > 0 && (fold(title) !== fold(existing.title) || title !== existing.title || side !== existing.side)) {
    return `«${existing.title}» ya está en ${uses} expediente(s): su nombre y su parte no se pueden cambiar (se perdería la marca). Cambie solo el plural, o desactívela y cree otra.`;
  }
  return { title, plural, side, pair_id, is_active: active ? 1 : 0 };
}

/** Categories in the order Gerencia chose. */
export const sortCategories = (list) => list.slice().sort((a, b) => (a.display_order - b.display_order) || (a.id - b.id));
