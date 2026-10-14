// Client for the Rama Judicial's Consulta Nacional Unificada de Procesos
// (CPNU). The service is public but undocumented, so field names are read
// case-insensitively and every call has a timeout. Override the base URL with
// RAMA_API_BASE if the service moves.
const BASE = process.env.RAMA_API_BASE || "https://consultaprocesos.ramajudicial.gov.co:448/api/v2";
const TIMEOUT_MS = 20000;

let fetchImpl = (...a) => fetch(...a);
/** Tests swap in a stub. */
export function setFetch(fn) { fetchImpl = fn; }

// Read a field regardless of the casing the service uses.
export function pick(obj, ...names) {
  if (!obj || typeof obj !== "object") return undefined;
  const keys = Object.keys(obj);
  for (const n of names) {
    const k = keys.find((x) => x.toLowerCase() === n.toLowerCase());
    if (k !== undefined && obj[k] !== null && obj[k] !== undefined) return obj[k];
  }
  return undefined;
}

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`La Rama Judicial respondió ${res.status}.`);
    return await res.json();
  } catch (err) {
    if (err.name === "AbortError") throw new Error("La Rama Judicial no respondió a tiempo.");
    throw err.message?.startsWith("La Rama") ? err : new Error(`No se pudo consultar la Rama Judicial: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

const day = (v) => (v ? String(v).slice(0, 10) : "");

/** Processes registered under a 23-digit radicado. */
export async function findByRadicado(radicado) {
  const data = await getJson(`${BASE}/Procesos/Consulta/NumeroRadicacion?numero=${encodeURIComponent(radicado)}&SoloActivos=false&pagina=1`);
  const list = pick(data, "procesos") || [];
  return list.map((p) => ({
    id: String(pick(p, "idProceso") ?? ""),
    radicado: String(pick(p, "llaveProceso") ?? ""),
    court: String(pick(p, "despacho") ?? "").trim(),
    department: String(pick(p, "departamento") ?? "").trim(),
    filed: day(pick(p, "fechaProceso")),
    lastAction: day(pick(p, "fechaUltimaActuacion")),
    parties: String(pick(p, "sujetosProcesales") ?? "").trim(),
  })).filter((p) => p.id);
}

/** All actions (actuaciones) of a process, newest first. */
export async function actuaciones(processId, { maxPages = 5 } = {}) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await getJson(`${BASE}/Proceso/Actuaciones/${encodeURIComponent(processId)}?pagina=${page}`);
    for (const a of pick(data, "actuaciones") || []) {
      const fecha = day(pick(a, "fechaActuacion"));
      const actuacion = String(pick(a, "actuacion") ?? "").trim();
      const anotacion = String(pick(a, "anotacion") ?? "").trim();
      const id = pick(a, "idRegActuacion", "consActuacion");
      out.push({
        key: id !== undefined ? String(id) : `${fecha}|${actuacion}|${anotacion}`.slice(0, 300),
        fecha, actuacion, anotacion,
        fecha_inicial: day(pick(a, "fechaInicial")), fecha_final: day(pick(a, "fechaFinal")),
      });
    }
    const pages = Number(pick(pick(data, "paginacion") || {}, "cantidadPaginas")) || 1;
    if (page >= pages) break;
  }
  return out;
}
