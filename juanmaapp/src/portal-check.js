// One request, every platform (change 55): the case is consulted in all the portals that
// allow it automatically, and the answer lists every portal with what happened, so the
// user does not consult them one by one. Today only the national query (Justicia Siglo XXI,
// CPNU) has a public service; a portal joins the automatic list when an adapter is added here.
import { PORTALS, portalOrder } from "./portals.js";
import { checkCase } from "./monitor.js";

const ADAPTERS = {
  cpnu: (db, k) => checkCase(db, k.id),
};

/** { caseId, newCount, portals: [{ id, name, url, mode: "auto"|"manual", ok, newCount, detail, suggested }] } */
export async function checkAllPortals(db, caseId) {
  const k = db.prepare(`SELECT k.*, g.name AS category_name FROM cases k JOIN process_types t ON t.id = k.process_type_id
    JOIN process_categories g ON g.id = t.category_id WHERE k.id = ?`).get(caseId);
  const order = portalOrder(k.radicado, k.category_name);
  const portals = [];
  for (const id of order) {
    const p = PORTALS.find((x) => x.id === id);
    const base = { id, name: p.name, url: p.url, suggested: id === order[0] };
    if (ADAPTERS[id] && k.radicado) {
      const r = await ADAPTERS[id](db, k);
      portals.push({ ...base, mode: "auto", ok: r.ok, newCount: r.newCount, detail: r.ok ? (r.newCount ? `${r.newCount} actuación(es) nueva(s).` : "Consultado: sin actuaciones nuevas.") : r.error });
    } else {
      portals.push({ ...base, mode: "manual", ok: null, newCount: 0,
        detail: ADAPTERS[id] ? "Agregue el radicado para consultarlo en automático." : p.manual });
    }
  }
  return { caseId, newCount: portals.reduce((a, x) => a + (x.newCount || 0), 0), portals };
}

/**
 * Connection test from the server (Gerencia): what each portal answers, so the next adapters
 * can be built on facts. Only public pages are requested, once each.
 */
let fetchImpl = (...a) => fetch(...a);
export const setProbeFetch = (f) => { fetchImpl = f; };
export async function probePortals() {
  const out = [];
  for (const p of PORTALS) {
    const t0 = Date.now();
    try {
      const res = await fetchImpl(p.url, { headers: { "User-Agent": "TecjuridicosApp/1.0 (consulta de procesos)" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
      const html = await res.text();
      out.push({ id: p.id, name: p.name, url: p.url, status: res.status, ms: Date.now() - t0, bytes: html.length,
        captcha: /recaptcha|hcaptcha|captcha/i.test(html), forms: (html.match(/<form\b/gi) || []).length,
        title: (html.match(/<title[^>]*>([^<]{0,120})/i)?.[1] || "").trim(),
        apiHints: [...new Set((html.match(/["'](\/?(?:api|services?|ws|ajax)\/[\w./-]{2,80})["']/gi) || []).map((x) => x.slice(1, -1)))].slice(0, 12) });
    } catch (err) {
      out.push({ id: p.id, name: p.name, url: p.url, status: 0, ms: Date.now() - t0, error: err.message });
    }
  }
  return out;
}
