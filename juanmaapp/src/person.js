// Client names: natural persons (first names + last names, each word with an
// initial capital) and legal entities (business name + NIT). Shared by the
// server, the published link and the Excel importer (served in /shared.js).

// Joining words stay in lower case inside a name: "Martha Torres de Cifuentes".
export const PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "do", "dos", "van", "von", "mc"]);

const capWord = (w) => w.split(/([-'’])/).map((p) => (/^[-'’]$/.test(p) || !p ? p : p.charAt(0).toLocaleUpperCase("es") + p.slice(1))).join("");

/** "jOHN FREDY de la ROSA" → "John Fredy de la Rosa" (any mix of upper and lower case). */
export function properName(s) {
  const words = String(s ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("es").split(" ").filter(Boolean);
  return words.map((w, i) => (i > 0 && PARTICLES.has(w) ? w : capWord(w))).join(" ");
}

// Words that mark a company or public body, used only to guess the type of
// records that arrive with a single name (old data, Excel imports).
const COMPANY = /\b(s\.?\s?a\.?\s?s\.?|s\.?\s?a\.?|ltda\.?|limitada|e\.?\s?u\.?|s\.?\s?en\s?c\.?|cooperativa|coomul\w*|fundaci[oó]n|corporaci[oó]n|asociaci[oó]n|sociedad|empresa|banco|ministerio|polic[ií]a|ej[eé]rcito|naci[oó]n|instituto|caja|alcald[ií]a|gobernaci[oó]n|universidad|cl[ií]nica|hospital|eps|ips|fondo|administradora|direcci[oó]n|superintendencia|municipio|consorcio|uni[oó]n temporal|inversiones|comercializadora|constructora|urbanizadora|sucursal|cremil|colpensiones)\b/i;

export function looksLikeCompany(name, idType = "") {
  return String(idType).toUpperCase() === "NIT" || COMPANY.test(String(name ?? ""));
}

/**
 * Split a full name into first names and last names. Colombian names usually
 * end with two last names: 2 words → 1 + 1, 3 → 1 + 2, 4 or more → rest + 2.
 * Joining words travel with the word after them ("de Cifuentes").
 */
export function splitFullName(full) {
  const words = properName(full).split(" ").filter(Boolean);
  const tokens = [];
  let pending = [];
  for (const w of words) {
    if (PARTICLES.has(w.toLowerCase()) && tokens.length) { pending.push(w); continue; }
    tokens.push([...pending, w].join(" "));
    pending = [];
  }
  if (pending.length) tokens.push(pending.join(" "));
  const n = tokens.length;
  if (n <= 1) return { first_names: tokens.join(" "), last_names: "" };
  const cut = n === 2 ? 1 : n === 3 ? 1 : n - 2;
  return { first_names: tokens.slice(0, cut).join(" "), last_names: tokens.slice(cut).join(" ") };
}

/**
 * Normalize the name fields of a client from a form or an import.
 * Natural person: first_names + last_names (or a full_name to split), each in proper case.
 * Legal entity: full_name is the business name as written, id_type is NIT.
 * Returns { person_type, first_names, last_names, full_name, id_type, legal_rep } or throws a message.
 */
export function personFields(b, existing = {}) {
  const has = (k) => b[k] !== undefined && b[k] !== null;
  const text = (v) => String(v ?? "").trim().replace(/\s+/g, " ");
  let type = has("person_type") ? (b.person_type === "juridica" ? "juridica" : "natural") : existing.person_type || "";
  const givenFull = has("full_name") ? text(b.full_name) : "";
  if (!type) type = looksLikeCompany(givenFull || existing.full_name, has("id_type") ? b.id_type : existing.id_type) ? "juridica" : "natural";
  if (type === "juridica") {
    const name = givenFull || (has("business_name") ? text(b.business_name) : "") || (existing.person_type === "juridica" ? existing.full_name : "");
    if (!name) throw new Error("Escriba la razón social.");
    return { person_type: "juridica", first_names: "", last_names: "", full_name: name, id_type: "NIT",
      legal_rep: properName(has("legal_rep") ? b.legal_rep : existing.legal_rep || "") };
  }
  let first = has("first_names") ? properName(b.first_names) : null;
  let last = has("last_names") ? properName(b.last_names) : null;
  if (first === null && last === null) {
    if (givenFull) ({ first_names: first, last_names: last } = splitFullName(givenFull));
    else { first = properName(existing.first_names); last = properName(existing.last_names); }
  }
  first = first ?? properName(existing.first_names);
  last = last ?? properName(existing.last_names);
  if (!first) throw new Error("Escriba los nombres del cliente.");
  let idType = text(has("id_type") ? b.id_type : existing.id_type || "CC").toUpperCase() || "CC";
  return { person_type: "natural", first_names: first, last_names: last, full_name: `${first} ${last}`.trim(), id_type: idType, legal_rep: "" };
}

// ----- Client search: by any field, by first names, last names, document or city -----
const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const words = (s) => fold(s).split(/[^a-z0-9ñ]+/).filter(Boolean);

/**
 * True when a client matches the search. Accents, upper/lower case and word
 * order do not matter ("lopez eduardo" finds "Eduardo Alfredo Urueña López");
 * documents compare digits only ("14.296.116" finds 14296116).
 * by: "" (everything) | "first" | "last" | "doc" | "city".
 */
export function clientMatches(c, q, by = "") {
  const text = String(q ?? "").trim();
  if (!text) return true;
  const digits = text.replace(/\D/g, "");
  const docHit = digits.length >= 3 && String(c.id_number ?? "").replace(/\D/g, "").includes(digits);
  if (by === "doc") return docHit;
  const fields = { first: [c.first_names], last: [c.last_names], city: [c.city, c.department] }[by]
    || [c.full_name, c.first_names, c.last_names, c.legal_rep, c.city, c.email, c.phone];
  const hay = words(fields.filter(Boolean).join(" ")).join(" ");
  const ok = words(text).every((w) => hay.split(" ").some((h) => h.startsWith(w)) || (w.length >= 4 && hay.includes(w)));
  return ok || (!by && docHit);
}
