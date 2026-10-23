// Mony's read-only case lookups (version 2.2.21): a client's expedientes, a case by folder
// number («No. Carpeta») and the process report with the pending tasks and actuaciones.
// Only SELECTs: nothing is saved. Offices outside the user's scope stay invisible.
import { scopeOf } from "./auth.js";
import { typePath } from "./sql.js";
import { taskFollowUp, utcToBogota } from "./case-meta.js";

const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const digits = (v) => String(v ?? "").replace(/\D/g, "");
const isFolderLabel = (label) => /^(n|no|nro|num|numero)?(de)?carpeta$/.test(fold(label).replace(/[^a-z]/g, ""));
const bogotaNow = (now = Date.now()) => new Date(now - 5 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
const MAX_LIST = 15;

function loadCases(db, user) {
  const sc = scopeOf(user);
  const rows = db.prepare(`
    SELECT k.id, k.client_id, k.title, k.status, k.counterparty, k.facts, k.field_values, k.office_id, k.assigned_user_id,
      k.radicado, k.case_number, k.court_name, k.department, k.city, k.parties, k.judge_name, k.updated_at,
      ${typePath("t")} AS type_name, t.category_id, g.name AS category_name,
      c.full_name AS client_name, c.id_type, c.id_number, u.name AS responsible
    FROM cases k
    JOIN process_types t ON t.id = k.process_type_id
    JOIN process_categories g ON g.id = t.category_id
    JOIN clients c ON c.id = k.client_id
    LEFT JOIN users u ON u.id = k.assigned_user_id`).all()
    .filter((k) => sc === null || sc.includes(k.office_id));
  const folderIds = new Map(); // category id → ids of its folder fields
  for (const f of db.prepare("SELECT id, category_id, label FROM custom_fields").all()) {
    if (!isFolderLabel(f.label)) continue;
    if (!folderIds.has(f.category_id)) folderIds.set(f.category_id, []);
    folderIds.get(f.category_id).push(String(f.id));
  }
  for (const k of rows) {
    let values = {};
    try { values = JSON.parse(k.field_values || "{}"); } catch { /* keep empty */ }
    k.folder = (folderIds.get(k.category_id) || []).map((id) => String(values[id] ?? "").trim()).find(Boolean) || "";
  }
  return rows;
}

const sameFolder = (a, b) => {
  const x = fold(a).replace(/\s+/g, ""), y = fold(b).replace(/\s+/g, "");
  if (!x || !y) return false;
  if (x === y) return true;
  const nx = digits(x), ny = digits(y);
  return !!nx && nx === ny && /^\D*\d+\D*$/.test(x) && /^\D*\d+\D*$/.test(y);
};

const brief = (k) => ({
  caso_id: k.id, carpeta: k.folder || null, cliente: k.client_name, documento_cliente: [k.id_type, k.id_number].filter(Boolean).join(" "),
  proceso: k.type_name, titulo: k.title, estado: k.status, radicado: k.radicado || null, despacho: k.court_name || null,
  contraparte: k.counterparty || null, responsable: k.responsible || null,
});

/** buscar_expedientes: by client (name or document), folder number, radicado or status. */
export function findCases(db, user, input = {}) {
  const all = loadCases(db, user);
  const client = fold(input.cliente), doc = digits(input.documento), folder = String(input.carpeta ?? "").trim();
  const rad = digits(input.radicado), status = fold(input.estado), who = fold(input.responsable);
  if (!client && !doc && !folder && !rad && !status && !who) throw new Error("Indica al menos un cliente, documento, número de carpeta, radicado, estado o responsable.");
  const words = client.split(/\s+/).filter(Boolean);
  const found = all.filter((k) => {
    if (words.length && !words.every((w) => fold(k.client_name).includes(w))) return false;
    if (doc && digits(k.id_number) !== doc) return false;
    if (folder && !sameFolder(k.folder, folder)) return false;
    if (rad && !(digits(k.radicado).includes(rad) || digits(k.case_number).includes(rad))) return false;
    if (status && !fold(k.status).includes(status)) return false;
    if (who && !fold(k.responsible).includes(who)) return false;
    return true;
  }).sort((a, b) => (Number(digits(a.folder)) || 1e12) - (Number(digits(b.folder)) || 1e12) || a.id - b.id);
  return { total: found.length, expedientes: found.slice(0, MAX_LIST).map(brief),
    nota: found.length > MAX_LIST ? `Se muestran ${MAX_LIST} de ${found.length}; afina la búsqueda.` : found.length ? undefined : "No hay expedientes con esos datos en la App." };
}

/** informe_expediente: one case in full, by id or folder number. */
export function caseReport(db, user, input = {}, now = Date.now()) {
  const all = loadCases(db, user);
  let k = null;
  if (input.caso_id) k = all.find((x) => x.id === Number(input.caso_id)) || null;
  else if (String(input.carpeta ?? "").trim()) {
    const m = all.filter((x) => sameFolder(x.folder, input.carpeta));
    if (m.length > 1) throw new Error(`Hay ${m.length} expedientes con la carpeta ${input.carpeta}; usa buscar_expedientes y elige el caso_id.`);
    k = m[0] || null;
  } else throw new Error("Indica el caso_id o el número de carpeta.");
  if (!k) throw new Error("El expediente no existe o este usuario no puede verlo.");
  const today = bogotaNow(now);
  const tasks = db.prepare(`
    SELECT t.*, u.name AS assigned_name FROM tasks t LEFT JOIN users u ON u.id = COALESCE(t.assigned_user_id, ?)
    WHERE t.case_id = ? ORDER BY t.due_at`).all(k.assigned_user_id, k.id);
  const pending = tasks.filter((t) => t.status === "pendiente").map((t) => {
    const f = taskFollowUp(t, today);
    return { tipo: t.kind, titulo: t.title, vence: t.due_at, seguimiento: f.label, responsable: t.assigned_name || null,
      entregado: t.delivered_at || undefined, notas: t.notes ? t.notes.slice(0, 300) : undefined };
  });
  const acts = db.prepare("SELECT fecha, actuacion, anotacion, found_at FROM actuaciones WHERE case_id = ? ORDER BY fecha DESC, id DESC LIMIT 8").all(k.id)
    .map((a) => ({ fecha: a.fecha, actuacion: a.actuacion, anotacion: a.anotacion.slice(0, 400), registrada: utcToBogota(a.found_at) }));
  const check = db.prepare("SELECT checked_at, ok, error FROM process_checks WHERE case_id = ? ORDER BY id DESC LIMIT 1").get(k.id);
  let parties = [];
  try { parties = JSON.parse(k.parties || "[]").map((p) => ({ lado: p.side, nombre: p.name, documento: p.id_number || undefined, nuestro: !!p.ours })); } catch { /* none */ }
  return {
    ...brief(k), numero_expediente: k.radicado || k.case_number || null, ciudad: [k.city, k.department].filter(Boolean).join(", ") || null,
    juez: k.judge_name || null, hechos: k.facts ? k.facts.slice(0, 1200) : null, partes: parties,
    tareas_pendientes: pending, tareas_vencidas: pending.filter((t) => t.seguimiento.includes("encid")).length,
    tareas_cumplidas: tasks.filter((t) => t.status === "hecha").length,
    actuaciones_guardadas: acts, ultima_consulta_rama: check ? { fecha: utcToBogota(check.checked_at), ok: !!check.ok, error: check.error || undefined } : null,
    fuente: "Base de datos de la App (actuaciones guardadas de la Rama Judicial); para el estado al día usa consultar_estado_proceso con el caso_id.",
  };
}
