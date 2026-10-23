// Client and case rules, one copy for the server (src/records.js) and the
// published link (public/demo-backend.js). Dependency-free: each side passes
// `lib` with its helpers, a `fail(message)` that throws its own "400" error,
// and small lookups into its own storage (SQLite or the link's database).

const str = (v) => (v == null ? "" : String(v).trim());

// ---------- Clients ----------

/** Plain client fields a request may set (names and document type go through personFields). */
export const CLIENT_TEXT_FIELDS = ["id_number", "email", "phone", "address", "department", "city", "notes", "gender", "id_department", "id_city"];

/** Client archive states (version 2.87): "" = activo. Returns the cleaned state or fails. */
export const CLIENT_ARCHIVE_STATES = ["Archivo provisional", "Archivo definitivo", "Pendiente Pago Sentencia"];
export function clientArchive(value, fail) {
  const v = str(value);
  if (v && !CLIENT_ARCHIVE_STATES.includes(v)) fail("Estado de archivo no válido.");
  return v;
}

/** Cleaned client values from a request; fields left out keep `existing`. office_id is each side's. */
export function clientValues(body, existing, lib) {
  const v = {};
  for (const f of CLIENT_TEXT_FIELDS) v[f] = f in body ? str(body[f]) : str(existing[f]);
  // Names in proper case, split into first and last names; legal entities use their business name and NIT.
  try { Object.assign(v, lib.personFields(body, existing)); } catch (err) { lib.fail(err.message); }
  v.id_number = v.id_number.replace(/\s+/g, "");
  v.gender = v.person_type === "juridica" ? "" : lib.normGender(v.gender) || genderFromName(v.first_names);
  const department = lib.canonicalDepartment(v.department);
  if (v.department && !department) lib.fail("Departamento no reconocido.");
  v.department = department;
  v.city = lib.canonicalCity(v.city, department);
  Object.assign(v, homePlace(v));
  // Where the ID card was issued (version 2.56): optional, official DIVIPOLA names, never filled by default.
  const idDepartment = lib.canonicalDepartment(v.id_department);
  if (v.id_department && !idDepartment) lib.fail("Departamento de expedición de la cédula no reconocido.");
  v.id_department = v.person_type === "juridica" ? "" : idDepartment;
  v.id_city = v.person_type === "juridica" ? "" : lib.canonicalCity(v.id_city, idDepartment);
  v.affiliated = "affiliated" in body ? (body.affiliated ? 1 : 0) : existing.affiliated ? 1 : 0; // version 2.61
  v.address = lib.properAddress(v.address);
  v.phone = lib.properPhone(v.phone);
  return v;
}

// ----- Defaults (version 2.53, user's rule) -----
// The client's gender from the first names, Ibagué (Tolima) as the place of residence and
// John Quiñones as the case's responsible, only where the data is empty: what is set stays.

export const HOME_DEPARTMENT = "Tolima";
export const HOME_CITY = "Ibagué";

/** Ibagué (Tolima) for a client without department and city; Ibagué for Tolima without city. Returns only what to fill. */
export function homePlace(c) {
  if (!str(c.department) && !str(c.city)) return { department: HOME_DEPARTMENT, city: HOME_CITY };
  if (str(c.department) === HOME_DEPARTMENT && !str(c.city)) return { city: HOME_CITY };
  return {};
}

const MALE = new Set(("abelardo abel abraham adolfo adrian agustin alberto alcides aldemar alejandro alexander alexis alfonso alfredo alirio alonso alvaro amado anderson andres angel anibal antonio argemiro ariel armando arnulfo arturo augusto aurelio benjamin bernardo braian brayan brian bryan camilo carlos cesar cristhiam cristhian cristian cristobal daniel dario david diego dilan duvan edgar edilberto edinson edinsson edison eduardo edwin efrain elias eliecer elkin emilio enrique ernesto esteban eugenio ever fabian fabio faber federico felipe felix fernando francisco gabriel german gerardo gilberto giovanni giovanny gonzalo guillermo gustavo haiver harold hector heriberto hernan hernando hugo humberto ignacio isaac ismael ivan jaime jairo javier jeider jesus jhoan jhojan jhon jhonatan jhonny jhony joan joaquin johan john johnny jonathan jorge jose josue juan julian julio kevin leonardo leonel lisandro lorenzo luis manuel marco marcos mario martin mateo mauricio maicol maycol michael miguel moises nelson nestor nicolas norberto octavio omar orlando oscar osvaldo pablo pedro rafael ramiro ramon raul reinaldo ricardo roberto rodrigo rodolfo rogelio ruben salvador samuel santiago sebastian sebstian segundo sergio silvio simon steven stiven teodoro tomas ulises uriel veimar victor vicente walter wilmer wilson william yeison yeyson yohan yovani yovany miller dany yimmi yimmy hossman arley arely dunier").split(" ")); // the last ones: John's answer, 19/10/2026
const FEMALE = new Set(("adela adriana alba alejandra alexandra alicia amanda amparo ana andrea angela angelica antonia araceli astrid aura aurora azucena beatriz bella blanca camila carmen carolina catalina cecilia celmira cenelia claudia constanza cristina daniela deisy diana dilia dirley doris dora edilma edith edna elena elibeth elizabeth elsa elvira emilce esperanza estefania estella fabiola fanny fernanda flor gelsa gladis gladys gloria graciela heidy herlinda hilda ines isabel ivonne jazmin jenny johana judith julia juliana julieth karen katherine laura leidy lida ligia liliana lina lorena lorenza lucia lucy luisa luz magdalena maira margarita maria marcela marina marisol marly martha mayerly melba mercedes mery milena mireya monica myriam natalia nelly neyla nidia nubia olga paola patricia paula piedad pilar raquel rocio rosa rosalba rosario ruth sandra sandy sara sofia sonia stella sther susana tatiana teresa valentina valeria vanessa veronica victoria viviana yaneth yanet yasmid yasmin yenni yesenia yohana yolanda yurleidy yuliana zoraida cemida cenida").split(" "));
const nameKey = (x) => String(x ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z\s]/g, " ").trim();

/** "hombre" | "mujer" | "" from the first names: the first name the list knows decides
 * («María José» is a woman, «José María» a man). An unknown or uncommon name gives "" (left for the office). */
export function genderFromName(firstNames) {
  for (const w of nameKey(firstNames).split(/\s+/).filter(Boolean)) {
    if (MALE.has(w)) return "hombre";
    if (FEMALE.has(w)) return "mujer";
  }
  return "";
}

/** Plan of the one-time fill: which empty client fields and which cases without responsible get a value.
 * responsibleFor(case) returns the default responsible's id for that case, or null. */
export function defaultsPlan(clients, cases, responsibleFor) {
  const out = { clients: [], cases: [], undecided: [] };
  for (const c of clients) {
    const set = { ...homePlace(c) };
    if (c.person_type !== "juridica" && !str(c.gender)) {
      const g = genderFromName(c.first_names || c.full_name);
      if (g) set.gender = g; else out.undecided.push({ id: c.id, name: c.full_name });
    }
    if (Object.keys(set).length) out.clients.push({ id: c.id, set });
  }
  for (const k of cases) {
    if (k.assigned_user_id) continue;
    const id = responsibleFor(k);
    if (id) out.cases.push({ id: k.id, assigned_user_id: id });
  }
  return out;
}

/** Clients still without gender whose first names now give one (version 2.54: names the office answered). */
export function genderPlan(clients) {
  return clients.filter((c) => c.person_type !== "juridica" && !str(c.gender))
    .map((c) => ({ id: c.id, gender: genderFromName(c.first_names || c.full_name) })).filter((x) => x.gender);
}

/** The default responsible (user's rule): the active user named John Quiñones, else null. */
export function defaultResponsible(users) {
  const isJohn = (u) => { const n = nameKey(u.name).replace(/\s+/g, " "); return n === "john quinones" || n.startsWith("john quinones "); };
  return users.find((u) => u.active && isJohn(u))?.id ?? null;
}

export const PHOTO_MAX = 1_500_000; // characters of the data URL (about 1.1 MB of image)

/** Problem with a client or user photo (a JPEG/PNG/WebP data URL), or "" when it is fine. */
export function photoProblem(photo) {
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(photo)) return "La foto debe ser una imagen JPG, PNG o WebP.";
  if (photo.length > PHOTO_MAX) return "La foto es demasiado grande. Use una imagen más pequeña.";
  return "";
}

// ---------- Cases ----------

/** Place, area, court and radicado of a case. A 23-digit radicado fills the department and city
 * (its first five digits are the DANE municipality code). lib.court(id) returns the directory row or null. */
export function caseLocation(b, cur, lib) {
  const pick = (k) => (k in b ? str(b[k]) : str(cur[k]));
  const radicado = pick("radicado").replace(/\D/g, "");
  if (radicado && radicado.length !== 23) lib.fail("El radicado debe tener 23 dígitos.");
  let department = lib.canonicalDepartment(pick("department"));
  if (pick("department") && !department) lib.fail("Departamento no reconocido.");
  let city = lib.canonicalCity(pick("city"), department);
  const fromRad = radicado ? lib.placeFromRadicado(radicado) : null;
  if (fromRad && !department) { department = fromRad.department; city = city || fromRad.city; }
  const area = pick("area");
  if (area && !lib.areas.includes(area)) lib.fail("Área no válida.");
  let courtId = cur.court_id ?? null;
  if ("court_id" in b) {
    courtId = b.court_id ? Number(b.court_id) : null;
    if (courtId !== null && !(Number.isInteger(courtId) && courtId > 0)) lib.fail("El despacho no es válido.");
  }
  let courtName = pick("court_name"), courtEmail = pick("court_email");
  const court = courtId ? lib.court(courtId) || lib.fail("El despacho no existe en el directorio.") : null;
  if (court) {
    courtName = court.name;
    courtEmail = court.email;
    department ||= court.department;
    city ||= court.city;
  }
  // Version 2.38 (user's rule): only the «Consulta automática» box turns it on.
  const monitor = "monitor" in b ? (b.monitor ? 1 : 0) : cur.monitor ? 1 : 0;
  return { department, city, area: area || court?.area || "", court_id: courtId, court_name: courtName, court_email: courtEmail,
    radicado, monitor: radicado ? monitor : 0, judge_name: pick("judge_name").replace(/\s+/g, " ").slice(0, 200) };
}

/** Keep only values for the fields of the case's category; required ones must be filled. */
export function fieldValues(fields, values, fail) {
  const out = {};
  for (const f of fields) {
    const v = str(values?.[f.id] ?? values?.[String(f.id)]);
    if (f.required && !v) fail(`El campo "${f.label}" es obligatorio.`);
    if (v) out[f.id] = v;
  }
  return out;
}

/** Imported cases keep the date they were opened in the previous system: "YYYY-MM-DD 00:00:00", else null. */
export function openedAt(value) {
  const d = str(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? `${d} 00:00:00` : null;
}

/** Parties of a case: our clients are linked to their client record (given, or found by document number).
 * lib.visible(clientId) tells whether the user sees that client; lib.byDocument(digits) returns the id of a
 * visible client with that document, or null. Returns the list without the case's main client. */
export function linkParties(list, mainClientId, lib) {
  const { parties, error } = lib.cleanParties(list);
  if (error) lib.fail(error);
  const digits = (x) => String(x || "").replace(/\D/g, "");
  for (const p of parties) {
    if (p.client_id && !lib.visible(p.client_id)) p.client_id = null;
    if (p.ours && !p.client_id && digits(p.id_number).length >= 5) p.client_id = lib.byDocument(digits(p.id_number)) ?? null;
    if (!p.ours) p.client_id = null;
  }
  return parties.filter((p) => p.client_id !== mainClientId);
}

/** Case number (2.33) and radicado (2.36): whoever edits cases, or the case's responsible funcionario (user's rule). */
export function mayEditCaseIds(canWriteCases, userId, k) {
  return !!canWriteCases || (k.assigned_user_id != null && k.assigned_user_id === userId);
}

/** «Cargar radicados» (version 2.24): one radicado per case, 23 digits, used by one case only.
 * Changing or removing a saved one needs replace: true. lib.usedBy(radicado) describes the other case
 * holding it («el expediente «X» de Y», or «otro expediente»), or "" when it is free.
 * Returns null when nothing changes, else the new { radicado, monitor, department, city }. */
export function radicadoChange(cur, body, lib) {
  const radicado = str(body?.radicado).replace(/\D/g, "");
  if (radicado && radicado.length !== 23) lib.fail(`El radicado debe tener 23 dígitos (tiene ${radicado.length}).`);
  if (radicado === str(cur.radicado)) return null;
  if (cur.radicado && !body?.replace) lib.fail(`Este expediente ya tiene el radicado ${lib.formatRadicado(cur.radicado)}. Confirme si quiere cambiarlo.`);
  const other = radicado ? lib.usedBy(radicado) : "";
  if (other) lib.fail(`El radicado ${lib.formatRadicado(radicado)} ya está en ${other}.`);
  const place = radicado && !cur.department ? lib.placeFromRadicado(radicado) : null;
  // Version 2.38 (user's rule): saving a radicado never turns the automatic consultation on by itself;
  // only the box does (sent as monitor), otherwise the case keeps what it had.
  const monitor = !radicado ? 0 : body && "monitor" in body ? (body.monitor ? 1 : 0) : cur.monitor ? 1 : 0;
  return { radicado, monitor, department: place?.department || cur.department || "", city: place ? cur.city || place.city : cur.city || "" };
}

// ---------- Deleting a client or a case (version 2.2.34, user's request 23/10/2026; Gerencia only) ----------
// One rule for the server and the published link. Money is never lost with a record: a client with cases,
// charges or receipts, and a case with charges or receipts, is refused with the numbers. To delete one,
// the user types the client's name / the case's folder number; the callers make a copy first.

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const keyOf = (s) => str(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").toLowerCase();

/** kind "client": counts { cases, charges, receipts }, name; kind "case": counts { charges, receipts }, folder/radicado.
 *  Returns { expected, blockers[] }: the text to type and the reasons that forbid the deletion. */
export function deletionPlan(kind, { name = "", folder = "", radicado = "", counts }) {
  const blockers = [];
  if (kind === "client") {
    const parts = [counts.cases && plural(counts.cases, "expediente", "expedientes"), counts.charges && plural(counts.charges, "cobro", "cobros"), counts.receipts && plural(counts.receipts, "recibo", "recibos")].filter(Boolean);
    if (parts.length) blockers.push(`Tiene ${parts.join(", ")}. Un cliente con expedientes, cobros o recibos no se elimina: sus datos y su dinero no se pierden.`);
    return { expected: str(name), blockers };
  }
  const parts = [counts.charges && plural(counts.charges, "cobro", "cobros"), counts.receipts && plural(counts.receipts, "recibo", "recibos")].filter(Boolean);
  if (parts.length) blockers.push(`Tiene ${parts.join(" y ")}. Un expediente con cobros o recibos no se elimina: el dinero registrado no se pierde con el expediente.`);
  return { expected: str(folder) || str(radicado) || "ELIMINAR", blockers };
}

/** Throws (409) for a blocker, (400) when the typed text is not the expected one. */
export function checkDeletion(plan, confirm, fail409, fail400) {
  if (plan.blockers.length) fail409(`No se eliminó. ${plan.blockers.join(" ")}`);
  if (keyOf(confirm) !== keyOf(plan.expected)) fail400(`Para eliminar escriba exactamente: ${plan.expected}`);
}
