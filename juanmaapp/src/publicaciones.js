// Publicaciones Procesales (publicacionesprocesales.ramajudicial.gov.co): estados and other
// publications come as PDFs per despacho and date, never per radicado. The first 12 digits of a
// radicado are the despacho code the site lists, so the cross-check is: list the despacho's
// documents, read each PDF once, and look for the radicados of our monitored cases in its text.
// The site could not be opened from the development container (403), so the page address is
// configured with PUBLICACIONES_URL ({codigo} = the 12-digit despacho code) and Gerencia can
// test it from the server (GET /monitor/publicaciones-probe).
import { pathToFileURL } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const TIMEOUT_MS = 25000;
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const DOCS_PER_DESPACHO = 15;
export const SITE = "https://publicacionesprocesales.ramajudicial.gov.co/";

let fetchImpl = (...a) => fetch(...a);
let textImpl = pdfText;
/** Tests swap in stubs. */
export function setFetch(fn) { fetchImpl = fn; }
export function setPdfText(fn) { textImpl = fn; }

export const urlTemplate = () => process.env.PUBLICACIONES_URL || "";
export const despachoCode = (radicado) => String(radicado ?? "").replace(/\D/g, "").slice(0, 12);

/** Pattern that finds a 23-digit radicado written with or without separators, or as «año consecutivo» after the despacho. */
export function radicadoPattern(radicado) {
  const d = String(radicado ?? "").replace(/\D/g, "");
  if (d.length !== 23) return null;
  const sep = "[\\s.\\-]*";
  const full = d.split("").join(sep);
  const tail = `${d.slice(12, 16)}${sep}${d.slice(16, 21)}`; // año + consecutivo, as most estados print it
  return { full: new RegExp(full), tail: new RegExp(`(?<!\\d)${tail}(?!\\d)`), code: d.slice(0, 12) };
}

/** Does the text of a publication mention this radicado? Returns a short context snippet or "". */
export function findInText(text, radicado, despacho = "") {
  const p = radicadoPattern(radicado);
  if (!p) return "";
  const flat = String(text).replace(/\s+/g, " ");
  let m = p.full.exec(flat);
  // The short form is only trusted when the publication belongs to the same despacho.
  if (!m && (despacho === p.code || new RegExp(p.code.split("").join("[\\s.\\-]*")).test(flat))) m = p.tail.exec(flat);
  if (!m) return "";
  return flat.slice(Math.max(0, m.index - 80), m.index + m[0].length + 160).trim();
}

const decode = (s) => String(s).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** Date (YYYY-MM-DD) written in a link's text or file name, or "". */
export function dateOf(s) {
  const t = decode(s);
  let m = /(\d{4})[-_/.](\d{1,2})[-_/.](\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /(\d{1,2})[-_/.](\d{1,2})[-_/.](\d{4})/.exec(t);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
}

/** PDF / document links of a page: [{ url, title, fecha }], newest first when dates are known. */
export function listDocuments(html, base) {
  const out = new Map();
  for (const m of String(html).matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decode(m[1]);
    if (!/\.pdf(\?|\/|$)/i.test(href) && !/\/documents\//i.test(href)) continue;
    let url;
    try { url = new URL(href, base).href; } catch { continue; }
    const title = decode(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!out.has(url)) out.set(url, { url, title, fecha: dateOf(title) || dateOf(decodeURIComponent(href)) });
  }
  return [...out.values()].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
}

async function get(url, as) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { "User-Agent": "TecjuridicosApp/2 (+consulta de publicaciones)" } });
    if (!res.ok) throw new Error(`Publicaciones Procesales respondió ${res.status}.`);
    if (as === "text") return await res.text();
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_PDF_BYTES) throw new Error("El documento es demasiado grande.");
    return buf;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Publicaciones Procesales no respondió a tiempo.");
    throw err.message?.startsWith("Publicaciones") ? err : new Error(`No se pudo consultar Publicaciones Procesales: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Plain text of a PDF (text layer only; scanned PDFs without text give ""). */
export async function pdfText(buf) {
  const req = createRequire(import.meta.url);
  const dir = path.dirname(req.resolve("pdfjs-dist/package.json"));
  const pdfjs = await import(pathToFileURL(path.join(dir, "legacy/build/pdf.mjs")).href);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false, verbosity: 0 }).promise;
  const parts = [];
  for (let i = 1; i <= Math.min(doc.numPages, 200); i++) {
    const page = await doc.getPage(i);
    parts.push((await page.getTextContent()).items.map((x) => x.str).join(" "));
  }
  await doc.destroy();
  return parts.join("\n");
}

/** Address of a despacho's publications page, or "" when PUBLICACIONES_URL is not set. */
export const despachoUrl = (code) => (urlTemplate() ? urlTemplate().replace("{codigo}", encodeURIComponent(code)) : "");

/**
 * Looks for the given cases in the newest publications of their despachos and saves each mention once.
 * Returns { enabled, docs, found, errors: [{ despacho, error }] }; found = mentions new in this run.
 */
export async function checkPublicaciones(db, caseIds, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const res = { enabled: !!urlTemplate(), docs: 0, found: 0, errors: [] };
  if (!res.enabled || !caseIds.length) return res;
  const cases = db.prepare(`SELECT id, radicado FROM cases WHERE id IN (${caseIds.map(Number).join(",")}) AND length(replace(radicado, ' ', '')) >= 23`).all()
    .filter((k) => radicadoPattern(k.radicado));
  const byDespacho = new Map();
  for (const k of cases) {
    const code = despachoCode(k.radicado);
    if (!byDespacho.has(code)) byDespacho.set(code, []);
    byDespacho.get(code).push(k);
  }
  const seen = db.prepare("SELECT 1 FROM publicaciones_docs WHERE url = ?");
  const markDoc = db.prepare("INSERT OR IGNORE INTO publicaciones_docs (url, despacho, fecha, title) VALUES (?, ?, ?, ?)");
  const addHit = db.prepare("INSERT OR IGNORE INTO publicaciones (case_id, url, title, fecha, snippet) VALUES (?, ?, ?, ?, ?)");
  for (const [code, list] of byDespacho) {
    try {
      const page = despachoUrl(code);
      const docs = listDocuments(await get(page, "text"), page).slice(0, DOCS_PER_DESPACHO);
      for (const doc of docs) {
        if (seen.get(doc.url)) continue;
        const text = await textImpl(await get(doc.url, "buf"));
        res.docs++;
        for (const k of list) {
          const snippet = findInText(text, k.radicado, code);
          if (snippet && addHit.run(k.id, doc.url, doc.title, doc.fecha || today, snippet).changes) res.found++;
        }
        markDoc.run(doc.url, code, doc.fecha, doc.title);
      }
    } catch (err) {
      res.errors.push({ despacho: code, error: err.message });
    }
  }
  return res;
}

/** Forms, selects and server-call addresses of a Liferay page, to learn how the despacho filters load their lists. */
export function describeStructure(html) {
  const h = String(html);
  const attr = (tag, name) => decode(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1] ?? "");
  const forms = [...h.matchAll(/<form\b[^>]*>/gi)].map((m) => ({ id: attr(m[0], "id"), action: attr(m[0], "action").slice(0, 300), method: attr(m[0], "method") }));
  const selects = [...h.matchAll(/(<select\b[^>]*>)([\s\S]*?)<\/select>/gi)].map((m) => {
    const opts = [...m[2].matchAll(/(<option\b[^>]*>)([\s\S]*?)<\/option>/gi)];
    return { id: attr(m[1], "id"), name: attr(m[1], "name"), options: opts.length, first: opts.slice(0, 4).map((o) => `${attr(o[1], "value")} = ${decode(o[2].replace(/<[^>]+>/g, "")).trim()}`) };
  });
  const calls = new Set();
  for (const m of h.matchAll(/[^"'\s(]*(?:p_p_resource_id|p_p_lifecycle=2|serveResource|\/o\/[\w.-]+\/[\w/.-]*|\/api\/jsonws[\w/.-]*)[^"'\s)]*/gi)) { if (calls.size < 25) calls.add(decode(m[0]).slice(0, 300)); }
  const names = [...new Set([...h.matchAll(/<input\b[^>]*>/gi)].map((m) => attr(m[0], "name")).filter(Boolean))].slice(0, 40);
  return { forms, selects, inputs: names, calls: [...calls] };
}

/** What a page looks like to the reader: title, links, forms and scripts, to tell a plain list from one drawn by JavaScript. */
export function describePage(html, base) {
  const h = String(html);
  const links = [...h.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["']/gi)].map((m) => decode(m[1]));
  return {
    title: decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(h)?.[1] ?? "").replace(/\s+/g, " ").trim()),
    bytes: h.length,
    links: links.length,
    forms: (h.match(/<form\b/gi) || []).length,
    selects: (h.match(/<select\b/gi) || []).length,
    scripts: (h.match(/<script\b/gi) || []).length,
    docs: listDocuments(h, base).length,
    structure: describeStructure(h),
    sample_links: links.filter((l) => !/^(#|javascript:)/i.test(l)).slice(0, 15),
  };
}

/** Connection test from the server: does the configured page open and does it list documents? */
export async function probePublicaciones(sampleCode = "050013103001") {
  const base = { site: SITE, template: urlTemplate(), configured: !!urlTemplate() };
  const hasCode = urlTemplate().includes("{codigo}");
  let home;
  try { home = { ok: true, status: "abre", ...describePage(await get(SITE, "text"), SITE) }; }
  catch (err) { home = { ok: false, status: err.message, docs: 0 }; }
  if (!urlTemplate()) return { ...base, home, despacho: null };
  const page = despachoUrl(sampleCode);
  const note = hasCode ? "" : "PUBLICACIONES_URL no trae {codigo}: se consulta la misma página para todos los despachos, que no filtra por despacho.";
  try {
    const html = await get(page, "text");
    const docs = listDocuments(html, page);
    return { ...base, home, note, despacho: { ok: true, url: page, docs: docs.length, sample: docs.slice(0, 3), page: describePage(html, page) } };
  } catch (err) {
    return { ...base, home, note, despacho: { ok: false, url: page, error: err.message } };
  }
}
