// Colombian departments and municipalities (DANE DIVIPOLA) and judicial areas.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { properName } from "./person.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DIVIPOLA = JSON.parse(readFileSync(path.join(here, "..", "public", "data", "divipola.json"), "utf8"));

const depByCode = new Map(DIVIPOLA.departamentos.map((d) => [d.code, d.name]));
const munByCode = new Map(DIVIPOLA.municipios.map((m) => [m.code, m]));

export const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Canonical department name, or "" if unknown. Accepts "TOLIMA", "tolima", "Bogotá D.C."... */
export function canonicalDepartment(name) {
  const n = norm(name).replace(/[.,]/g, "");
  if (!n) return "";
  const hit = DIVIPOLA.departamentos.find((d) => norm(d.name).replace(/[.,]/g, "") === n);
  if (hit) return hit.name;
  if (n.startsWith("bogota")) return "Bogotá, D.C.";
  if (n.startsWith("san andres") || n.startsWith("archipielago")) return depByCode.get("88");
  if (n.startsWith("valle")) return "Valle del Cauca";
  if (n === "guajira") return "La Guajira";
  return "";
}

/** Canonical municipality name within a department ("IBAGUE" → "Ibagué"), or the input in proper case if not found. */
export function canonicalCity(name, department) {
  const n = norm(name).replace(/[.,]/g, "");
  if (!n) return "";
  const dep = DIVIPOLA.departamentos.find((d) => d.name === department)?.code;
  const hit = DIVIPOLA.municipios.find((m) => (!dep || m.dep === dep) && norm(m.name).replace(/[.,]/g, "") === n);
  if (hit) return hit.name;
  if (n.startsWith("bogota")) return "Bogotá, D.C.";
  return properName(name);
}

/** Department and city from a 23-digit radicado: its first five digits are the DANE municipality code. */
export function placeFromRadicado(radicado) {
  const m = munByCode.get(String(radicado).slice(0, 5));
  return m ? { department: depByCode.get(m.dep), city: m.name, city_code: m.code } : null;
}

export function cityCode(city, department) {
  const dep = DIVIPOLA.departamentos.find((d) => d.name === department)?.code;
  return DIVIPOLA.municipios.find((m) => m.name === city && (!dep || m.dep === dep))?.code || "";
}

/** Keep digits only; a valid radicado has exactly 23. */
export function normalizeRadicado(r) {
  return String(r ?? "").replace(/\D/g, "");
}

export const AREAS = [
  "Civil", "Laboral", "Penal", "Familia", "Administrativo", "Promiscuo", "Ejecución de Penas",
  "Pequeñas Causas y Competencia Múltiple", "Restitución de Tierras", "Penal para Adolescentes", "Constitucional", "Otro",
];

// Order matters: the most specific wording wins.
const AREA_RULES = [
  [/ejecucion de penas/, "Ejecución de Penas"],
  [/pequenas causas|competencia multiple/, "Pequeñas Causas y Competencia Múltiple"],
  [/restitucion de tierras/, "Restitución de Tierras"],
  [/adolescente/, "Penal para Adolescentes"],
  [/administrativ|contencioso/, "Administrativo"],
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
