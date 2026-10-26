// Memorial categories (version 2.2.65): the groups Gerencia sets up inside «Memoriales» (Solicitud de impulso, Solicitud de link,
// Requerimiento, …). Each Word template of category «Memorial» may belong to one of them. Shared by the server and the published link.

export const MAX_TITLE = 120;
export const MAX_DESCRIPTION = 300;
// Created once, only when the firm has none yet; Gerencia renames, orders, deactivates or deletes them freely.
export const DEFAULT_TITLES = ["Solicitud de impulso", "Solicitud de link", "Requerimiento"];

const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Validates a create/update body; `existing` is the stored row on update, `others` the other categories (a repeated title is refused). */
export function categoryValues(body, existing = null, others = []) {
  const b = body ?? {};
  const title = "title" in b ? String(b.title ?? "").replace(/\s+/g, " ").trim() : existing?.title ?? "";
  const description = "description" in b ? String(b.description ?? "").replace(/\s+/g, " ").trim() : existing?.description ?? "";
  const active = "is_active" in b ? !!b.is_active : existing ? !!existing.is_active : true;
  if (!title) return "Escriba el nombre de la categoría de memoriales.";
  if (title.length > MAX_TITLE) return `El nombre debe tener máximo ${MAX_TITLE} caracteres.`;
  if (description.length > MAX_DESCRIPTION) return `La descripción debe tener máximo ${MAX_DESCRIPTION} caracteres.`;
  if (others.some((o) => fold(o.title) === fold(title))) return "Ya existe una categoría de memoriales con ese nombre.";
  return { title, description, is_active: active ? 1 : 0 };
}

/** Categories in the order Gerencia chose. */
export const sortCategories = (list) => list.slice().sort((a, b) => (a.display_order - b.display_order) || (a.id - b.id));
