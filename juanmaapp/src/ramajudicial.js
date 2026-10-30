// Client for the Rama Judicial's Consulta Nacional Unificada de Procesos
// (CPNU). The service is public but undocumented, so field names are read
// case-insensitively and every call has a timeout. Override the base URL with
// RAMA_API_BASE if the service moves.
const BASE = process.env.RAMA_API_BASE || "https://consultaprocesos.ramajudicial.gov.co:448/api/v2";
const TIMEOUT_MS = 20000;
const RETRY_MS = Number(process.env.RAMA_RETRY_MS ?? 1500);
/** What the user sees when the portal lists nothing: an empty list is not proof that the process does not exist. */
export const NOT_LISTED_MSG = "La consulta a la Rama Judicial no devolvió ningún proceso para este radicado. Puede que el portal aún no lo muestre o que haya rechazado la consulta desde el servidor; no significa que no exista.";

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
    try { return await res.json(); }
    catch { throw new Error("La Rama Judicial devolvió una respuesta que no es la esperada (posible bloqueo del portal)."); }
  } catch (err) {
    if (err.name === "AbortError") throw new Error("La Rama Judicial no respondió a tiempo.");
    throw err.message?.startsWith("La Rama") ? err : new Error(`No se pudo consultar la Rama Judicial: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

const day = (v) => (v ? String(v).slice(0, 10) : "");

// The key of a process is the 23-digit radicado; the last two digits (the appeal instance) can differ, so the first 21 count too.
const sameRadicado = (key, digits) => { const k = String(key).replace(/\D/g, ""); return !k || k === digits || (k.length >= 21 && k.slice(0, 21) === digits.slice(0, 21)); };

/** Processes registered under a 23-digit radicado. An empty list is retried once before it is believed. */
export async function findByRadicado(radicado) {
  const digits = String(radicado).replace(/\D/g, "");
  const url = `${BASE}/Procesos/Consulta/NumeroRadicacion?numero=${encodeURIComponent(digits)}&SoloActivos=false&pagina=1`;
  let list = pick(await getJson(url), "procesos") || [];
  if (!list.length) {
    await new Promise((r) => setTimeout(r, RETRY_MS));
    list = pick(await getJson(url), "procesos") || [];
  }
  return list.filter((p) => sameRadicado(pick(p, "llaveProceso") ?? "", digits)).map((p) => ({
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

/** Details of a process; "ponente" is the judge (or reporting magistrate) in charge. */
export async function processDetail(processId) {
  const d = await getJson(`${BASE}/Proceso/Detalle/${encodeURIComponent(processId)}`);
  return {
    judge: String(pick(d, "ponente") ?? "").replace(/\s+/g, " ").trim(),
    court: String(pick(d, "despacho") ?? "").trim(),
  };
}

/** Judge of the process under a radicado (latest one when several share it): { judge, court } or null. */
export async function judgeByRadicado(radicado) {
  const digits = String(radicado).replace(/\D/g, "");
  const found = await findByRadicado(digits);
  if (!found.length) return null;
  found.sort((a, b) => (b.lastAction || "").localeCompare(a.lastAction || ""));
  const d = await processDetail(found[0].id);
  return { judge: d.judge, court: d.court || found[0].court };
}
