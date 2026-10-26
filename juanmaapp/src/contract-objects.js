// Contract objects (version 2.2.46): the «Objetos contractuales» Gerencia configures for the services contract
// (Reintegro laboral, Proceso ejecutivo, …). When a contract is made the user ticks one or more, and their clauses
// are merged into the {{OBJETOS_CONTRACTUALES}} marker of the Word template. Shared by the server and the published link.

export const OBJECTS_KEY = "OBJETOS_CONTRACTUALES";
export const OBJECTS_LABEL = "Objetos contractuales (marque en la lista)";
export const MAX_TITLE = 120;
export const MAX_CLAUSE = 8000;

// Same invisible mark docx.js uses: what sits between two marks comes out highlighted in yellow in Word.
const MISS = "⁣";

const clean = (s) => String(s ?? "").replace(/\r\n?/g, "\n").trim();
const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Validates a create/update body. `existing` is the stored row on update (omitted fields keep their value);
 * `others` are the other objects, to refuse a repeated title. Returns { title, clause, is_active } or an error text.
 */
export function objectValues(body, existing = null, others = []) {
  const b = body ?? {};
  const title = "title" in b ? String(b.title ?? "").replace(/\s+/g, " ").trim() : existing?.title ?? "";
  const clause = "clause" in b ? clean(b.clause).replace(/\n{3,}/g, "\n\n") : existing?.clause ?? "";
  const active = "is_active" in b ? !!b.is_active : existing ? !!existing.is_active : true;
  if (!title) return "Escriba el título del objeto contractual.";
  if (title.length > MAX_TITLE) return `El título debe tener máximo ${MAX_TITLE} caracteres.`;
  if (!clause) return "Escriba la cláusula de este objeto contractual.";
  if (clause.length > MAX_CLAUSE) return `La cláusula debe tener máximo ${MAX_CLAUSE} caracteres.`;
  if (others.some((o) => fold(o.title) === fold(title))) return "Ya existe un objeto contractual con ese título.";
  return { title, clause, is_active: active ? 1 : 0 };
}

/** Objects in the order of the checklist. */
export const sortObjects = (list) => list.slice().sort((a, b) => (a.display_order - b.display_order) || (a.id - b.id));

// Data written inside a clause ({{cliente.nombre}}): filled from the document's values; a missing one is highlighted.
function fillClause(text, values) {
  return text.replace(/\{\{\s*([^{}|]+?)\s*\}\}/g, (_, key) => {
    const v = values[key];
    return v === undefined || v === null || String(v).trim() === "" ? `${MISS}[FILL: ${key}]${MISS}` : String(v);
  });
}

const bullet = (i) => `${i < 26 ? String.fromCharCode(65 + i) : i + 1}) `;

/**
 * The text for {{OBJETOS_CONTRACTUALES}} from the ticked objects (already in checklist order).
 * One object: its clause as written. Several: one per paragraph, A) … B) … with a blank line between.
 * Returns "" when nothing is ticked, so the Word shows the missing-data mark.
 */
export function mergeObjects(objects, values = {}) {
  const texts = objects.map((o) => fillClause(clean(o.clause), values)).filter(Boolean);
  if (!texts.length) return "";
  if (texts.length === 1) return texts[0];
  return "\n" + texts.map((t, i) => bullet(i) + t.replace(/\n{2,}/g, "\n")).join("\n\n");
}
