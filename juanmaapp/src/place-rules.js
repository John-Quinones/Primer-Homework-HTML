// Department, city and radicado place rules, one copy for the server (src/places.js)
// and the published link (public/demo-backend.js). Dependency-free: each side passes
// the DIVIPOLA list it already has and its properName to makePlaces.

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const bare = (s) => norm(s).replace(/[.,]/g, "");

export function makePlaces(divipola, properName) {
  const depByCode = new Map(divipola.departamentos.map((d) => [d.code, d.name]));
  const munByCode = new Map(divipola.municipios.map((m) => [m.code, m]));

  /** Canonical department name, or "" if unknown. Accepts "TOLIMA", "tolima", "Bogotá D.C."... */
  function canonicalDepartment(name) {
    const n = bare(name);
    if (!n) return "";
    const hit = divipola.departamentos.find((d) => bare(d.name) === n);
    if (hit) return hit.name;
    if (n.startsWith("bogota")) return "Bogotá, D.C.";
    if (n.startsWith("san andres") || n.startsWith("archipielago")) return depByCode.get("88") || "";
    if (n.startsWith("valle")) return "Valle del Cauca";
    if (n === "guajira") return "La Guajira";
    // v2.84: abbreviations and messy cells from the official file ("N. De Santander", "Norte Santander", "N de S").
    if (/^(n|nte|norte)( de)?( s| sder| santander)$/.test(n)) return divipola.departamentos.find((d) => bare(d.name) === "norte de santander")?.name || "";
    // A cell with more text around the name ("906 Y 1098) - Cundinamarca - Mosquera"): the longest department named in it.
    const words = ` ${n.replace(/[^a-z0-9ñ]+/g, " ").trim()} `;
    let found = "";
    for (const d of divipola.departamentos) {
      const b = ` ${bare(d.name).replace(/[^a-z0-9ñ]+/g, " ").trim()} `;
      if (words.includes(b) && b.length > found.length) found = d.name;
    }
    return found;
  }

  /** Municipality of a department named inside free text ("… - Cundinamarca - Mosquera" → "Mosquera"), or "". */
  function cityFromText(text, department) {
    const dep = divipola.departamentos.find((d) => d.name === department)?.code;
    const words = ` ${bare(text).replace(/[^a-z0-9ñ]+/g, " ").trim()} `;
    let found = "";
    for (const m of divipola.municipios) {
      if (dep && m.dep !== dep) continue;
      const b = ` ${bare(m.name).replace(/[^a-z0-9ñ]+/g, " ").trim()} `;
      if (words.includes(b) && b.length > found.length) found = m.name;
    }
    return found;
  }

  /** Canonical municipality name within a department ("IBAGUE" → "Ibagué"), or the input in proper case if not found. */
  function canonicalCity(name, department) {
    const n = bare(name);
    if (!n) return "";
    const dep = divipola.departamentos.find((d) => d.name === department)?.code;
    const hit = divipola.municipios.find((m) => (!dep || m.dep === dep) && bare(m.name) === n);
    if (hit) return hit.name;
    if (n.startsWith("bogota")) return "Bogotá, D.C.";
    // v2.75: the directory says «Cartagena», DIVIPOLA says «Cartagena de Indias»: one municipality of the department that starts with «<name> de».
    const longer = divipola.municipios.filter((m) => (!dep || m.dep === dep) && bare(m.name).startsWith(n + " de "));
    if (longer.length === 1) return longer[0].name;
    return properName(name);
  }

  /** Department and city from a 23-digit radicado: its first five digits are the DANE municipality code. */
  function placeFromRadicado(radicado) {
    const m = munByCode.get(String(radicado).slice(0, 5));
    return m ? { department: depByCode.get(m.dep), city: m.name, city_code: m.code } : null;
  }

  return { canonicalDepartment, canonicalCity, placeFromRadicado, cityFromText };
}

/** Keep digits only; a valid radicado has exactly 23. */
export function normalizeRadicado(r) {
  return String(r ?? "").replace(/\D/g, "");
}

export const AREAS = [
  "Civil", "Laboral", "Penal", "Familia", "Administrativo", "Promiscuo", "Ejecución de Penas",
  "Pequeñas Causas y Competencia Múltiple", "Restitución de Tierras", "Penal para Adolescentes", "Constitucional", "Comercial", "Agrario", "Tributario", "Disciplinario", "Ambiental", "Disciplinario Interno", "Penal Militar", "Otro", "Otros",
];

/** Areas added by the administrator (court_areas table); joins the shared list in place so every rule sees it. */
export function registerAreas(names) {
  for (const n of names) if (n && !AREAS.includes(n)) AREAS.splice(Math.max(0, AREAS.indexOf("Otro")), 0, n);
}

// Order matters: the most specific wording wins.
const AREA_RULES = [
  [/ejecucion de penas/, "Ejecución de Penas"],
  [/pequenas causas|competencia multiple/, "Pequeñas Causas y Competencia Múltiple"],
  [/restitucion de tierras/, "Restitución de Tierras"],
  [/penal militar|justicia penal militar/, "Penal Militar"],
  [/control disciplinario interno|disciplinario interno/, "Disciplinario Interno"],
  [/adolescente/, "Penal para Adolescentes"],
  [/administrativ|contencioso/, "Administrativo"],
  [/comercial|mercantil|sociedades/, "Comercial"],
  [/agrari/, "Agrario"],
  [/tributari|fiscal|impuestos/, "Tributario"],
  [/disciplinari/, "Disciplinario"],
  [/ambiental/, "Ambiental"],
  [/laboral/, "Laboral"],
  [/familia/, "Familia"],
  [/promiscuo/, "Promiscuo"],
  [/penal|control de garantias|conocimiento/, "Penal"],
  [/civil/, "Civil"],
  [/constitucional/, "Constitucional"],
];

/** Judicial area from an explicit value or, failing that, from the court's name. */
export function inferArea(name, explicit = "") {
  const e = norm(explicit);
  if (e) {
    const direct = AREAS.find((a) => norm(a) === e);
    if (direct) return direct;
    for (const [re, area] of AREA_RULES) if (re.test(e)) return area;
  }
  const n = norm(name);
  for (const [re, area] of AREA_RULES) if (re.test(n)) return area;
  return "Otro";
}
