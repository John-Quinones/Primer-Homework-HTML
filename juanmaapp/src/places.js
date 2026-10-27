// Colombian departments and municipalities (DANE DIVIPOLA) and judicial areas.
// The rules live in place-rules.js, shared with the published link.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { properName } from "./person.js";
import { makePlaces } from "./place-rules.js";

export { AREAS, inferArea, normalizeRadicado, registerAreas } from "./place-rules.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DIVIPOLA = JSON.parse(readFileSync(path.join(here, "..", "public", "data", "divipola.json"), "utf8"));

export const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export const { canonicalDepartment, canonicalCity, placeFromRadicado, cityFromText } = makePlaces(DIVIPOLA, properName);

export function cityCode(city, department) {
  const dep = DIVIPOLA.departamentos.find((d) => d.name === department)?.code;
  return DIVIPOLA.municipios.find((m) => m.name === city && (!dep || m.dep === dep))?.code || "";
}
