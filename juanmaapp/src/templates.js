// Document templates: the firm's own Word (.docx) or text files plus the
// starter ones, and the values a case provides to fill {{variables}}.
import express from "express";
import { str } from "./http.js";
import { formatRadicado } from "./portals.js";
import { can, scopeOf, loadUser, ASSISTANT } from "./auth.js";
import { typePath } from "./sql.js";
import { feeVariables } from "./ledger.js";
import { counterpartyText, counterpartyLines, fillRadicadoAliases, partyContext, partyWords, isFolderLabel, caseRecipient, recipientVariables, fieldDocValue, genderWords, idPlaceVariables, processVariables, plaintiffNames, lastActuacionVariables } from "./case-meta.js";
import { allAuthorities } from "./authorities.js";
import { DOC_CATEGORIES, VARIABLES, SEED_TEMPLATES, FIRM_FIXES, SLINK_V1_SHA, SLINK_V2_SHA } from "./templates-seed.js";
import { createHash } from "node:crypto";

const MAX_FILE = 8 * 1024 * 1024;
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function seedTemplates(db) {
  db.exec("CREATE TABLE IF NOT EXISTS app_flags (key TEXT PRIMARY KEY)");
  const flag = db.prepare("SELECT 1 FROM app_flags WHERE key = ?");
  const setFlag = db.prepare("INSERT OR IGNORE INTO app_flags (key) VALUES (?)");
  const ins = db.prepare("INSERT INTO document_templates (name, category, description, format, body, builtin) VALUES (?, ?, ?, 'markdown', ?, 1)");
  const first = !flag.get("templates_seeded");
  // Each starter template arrives once; one the firm deleted does not come back.
  for (const t of SEED_TEMPLATES) {
    const key = `template:${t.name}`;
    if (flag.get(key)) continue;
    const exists = db.prepare("SELECT 1 FROM document_templates WHERE name = ?").get(t.name);
    if (first || !exists) {
      if (!exists) {
        const id = ins.run(t.name, t.category, t.description, FIRM_FIXES.reduce((b, [from, to]) => b.split(from).join(to), t.body)).lastInsertRowid;
        // Version 2.2.90: a memorial arrives inside its category when the firm still has it (only fills the empty column).
        if (t.memorialCategory) db.prepare("UPDATE document_templates SET memorial_category_id = (SELECT id FROM memorial_categories WHERE title = ? LIMIT 1) WHERE id = ?").run(t.memorialCategory, id);
      }
    }
    setFlag.run(key);
  }
  setFlag.run("templates_seeded");
  // Version 2.2.91: «Solicitud link de expediente» takes the letterhead design, only while the starter template is exactly the one 2.2.90 seeded (nobody edited it).
  if (!flag.get("template-slink-v2")) {
    const t = SEED_TEMPLATES.find((x) => x.name === "Solicitud link de expediente");
    const cur = t && db.prepare("SELECT id, body FROM document_templates WHERE name = ? AND builtin = 1").get(t.name);
    if (cur && createHash("sha256").update(cur.body).digest("hex") === SLINK_V1_SHA) db.prepare("UPDATE document_templates SET body = ?, description = ? WHERE id = ?").run(t.body, t.description, cur.id);
    setFlag.run("template-slink-v2");
  }
  // Version 2.2.92: the same, from the 2.2.91 body to the Word-faithful letterhead (only while nobody edited it).
  if (!flag.get("template-slink-v3")) {
    const t = SEED_TEMPLATES.find((x) => x.name === "Solicitud link de expediente");
    const cur = t && db.prepare("SELECT id, body FROM document_templates WHERE name = ? AND builtin = 1").get(t.name);
    if (cur && createHash("sha256").update(cur.body).digest("hex") === SLINK_V2_SHA) db.prepare("UPDATE document_templates SET body = ?, description = ? WHERE id = ?").run(t.body, t.description, cur.id);
    setFlag.run("template-slink-v3");
  }
}



/** Today in Colombia as "14 de octubre de 2026". */
export function longDate(d = new Date()) {
  const b = new Date(d.getTime() - 5 * 3600 * 1000);
  return `${b.getUTCDate()} de ${MONTHS[b.getUTCMonth()]} de ${b.getUTCFullYear()}`;
}

/** Values for every variable from a case (or only the user and date without one). */
export function templateData(db, user, caseId) {
  const v = {};
  const today = longDate();
  let lawyer = user, office = null;
  if (caseId) {
    const k = db.prepare(`SELECT k.*, ${typePath("t")} AS type_name, g.name AS category_name FROM cases k
      JOIN process_types t ON t.id = k.process_type_id JOIN process_categories g ON g.id = t.category_id WHERE k.id = ?`).get(caseId);
    const sc = scopeOf(user);
    if (!k || (sc !== null && !sc.includes(k.office_id))) return null;
    const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(k.client_id);
    const party = partyContext(k, k.category_name, k.type_name, c, (id) => db.prepare("SELECT gender, person_type FROM clients WHERE id = ?").get(id));
    Object.assign(v, {
      "cliente.nombre": c.full_name, "cliente.tipo_documento": c.id_type, "cliente.documento": c.id_number,
      "cliente.correo": c.email, "cliente.telefono": c.phone, "cliente.direccion": c.address,
      "cliente.ciudad": c.city, "cliente.departamento": c.department, ...idPlaceVariables(c), ...genderWords(c.person_type === "juridica" ? "" : c.gender),
      ...partyWords(party, c.gender), _partes: JSON.stringify(party),
      "expediente.radicado": (k.radicado ? formatRadicado(k.radicado) : k.case_number) || "", "expediente.tipo_proceso": k.category_name, "expediente.subproceso": k.type_name,
      "expediente.asunto": k.title, "expediente.contraparte": counterpartyText(k.parties, k.counterparty), "expediente.demandados": counterpartyLines(k.parties, k.counterparty), "expediente.demandantes": plaintiffNames(k.parties), "expediente.hechos": k.facts,
      "expediente.despacho": k.court_name, "expediente.juez": k.judge_name || "", "expediente.numero": (k.radicado ? formatRadicado(k.radicado) : k.case_number) || "", "expediente.correo_despacho": k.court_email, "expediente.area": k.area,
      "expediente.ciudad": k.city, "expediente.departamento": k.department,
      ...processVariables(k.category_name, k.area, k.type_name, (k.radicado ? formatRadicado(k.radicado) : k.case_number) || ""),
    });
    const fields = db.prepare("SELECT id, label, field_type FROM custom_fields WHERE category_id = (SELECT category_id FROM process_types WHERE id = ?)").all(k.process_type_id);
    const values = JSON.parse(k.field_values);
    for (const f of fields) v[`campo.${f.label}`] = fieldDocValue(f, values[f.id]);
    fillRadicadoAliases(v, v["expediente.numero"]);
    Object.assign(v, lastActuacionVariables(db.prepare("SELECT id, fecha, actuacion, anotacion FROM actuaciones WHERE case_id = ?").all(k.id)));
    const folder = fields.find((f) => isFolderLabel(f.label) && String(values[f.id] ?? "").trim());
    if (folder) v["expediente.carpeta"] = String(values[folder.id]).trim();
    // Addressee (version 2.27): the judge of the case or the official saved for the entity.
    const courtAddress = k.court_id ? db.prepare("SELECT address FROM courts WHERE id = ?").get(k.court_id)?.address || "" : "";
    Object.assign(v, recipientVariables(caseRecipient({ ...k, court_address: courtAddress }, allAuthorities(db))));
    // Fees of the contract = the case's charges in Pagos.
    Object.assign(v, feeVariables(db.prepare("SELECT amount, due_date, status FROM charges WHERE case_id = ?").all(k.id),
      db.prepare("SELECT amount, voided_at FROM receipts WHERE case_id = ?").all(k.id)));
    if (k.assigned_user_id) lawyer = loadUser(db, k.assigned_user_id) || user;
    office = db.prepare("SELECT * FROM offices WHERE id = ?").get(k.office_id);
  }
  office ||= db.prepare("SELECT * FROM offices WHERE id = ?").get(user.offices[0]?.id) || db.prepare("SELECT * FROM offices WHERE is_main = 1").get();
  // A hidden lawyer (version 2.11) signs as "Asistente", without personal contact data.
  if (lawyer.hidden || lawyer.real_name) lawyer = { id: null, name: ASSISTANT, email: "", phone: "" };
  const card = (lawyer.id && db.prepare("SELECT professional_card FROM users WHERE id = ?").get(lawyer.id)?.professional_card) || "";
  Object.assign(v, {
    "abogado.nombre": lawyer.name, "abogado.tarjeta_profesional": card, "abogado.correo": lawyer.email, "abogado.telefono": lawyer.phone || "",
    "oficina.nombre": office?.name || "", "oficina.ciudad": office?.city || "", "oficina.direccion": office?.address || "",
    "oficina.telefono": office?.phone || "", "oficina.correo": office?.email || "",
    "fecha.hoy": today, "fecha.ciudad_y_fecha": `${office?.city || v["expediente.ciudad"] || ""}, ${today}`.replace(/^, /, ""),
  });
  // Empty strings count as missing so the document shows [FILL: …].
  for (const k of Object.keys(v)) if (v[k] === null || v[k] === undefined || String(v[k]).trim() === "") delete v[k];
  return v;
}

export function templatesRouter(db) {
  const r = express.Router();
  const manage = (req, res, next) => (can(req, "templates.manage") ? next() : res.status(403).json({ error: "Su rol no tiene permiso para gestionar plantillas." }));
  const META = "id, name, category, description, format, filename, builtin, memorial_category_id, created_at, updated_at, length(file) AS file_size";
  const out = (t) => ({ ...t, builtin: !!t.builtin });

  r.get("/meta", (req, res) => res.json({ categories: DOC_CATEGORIES, variables: VARIABLES }));

  r.get("/", (req, res) => {
    res.json(db.prepare(`SELECT ${META} FROM document_templates ORDER BY category, name`).all().map(out));
  });

  r.get("/data", (req, res) => {
    const data = templateData(db, req.user, Number(req.query.caseId) || null);
    if (!data) return res.status(404).json({ error: "El expediente no existe." });
    res.json(data);
  });

  r.get("/:id", (req, res) => {
    const t = db.prepare(`SELECT ${META}, body FROM document_templates WHERE id = ?`).get(Number(req.params.id));
    if (!t) return res.status(404).json({ error: "La plantilla no existe." });
    res.json(out(t));
  });

  r.get("/:id/file", (req, res) => {
    const t = db.prepare("SELECT filename, file FROM document_templates WHERE id = ? AND format = 'docx'").get(Number(req.params.id));
    if (!t?.file) return res.status(404).json({ error: "La plantilla no tiene archivo." });
    res.json({ filename: t.filename, base64: Buffer.from(t.file).toString("base64") });
  });

  function values(b, cur = {}, user = null) {
    const v = {
      name: "name" in b ? str(b.name) : cur.name,
      category: "category" in b ? str(b.category) : cur.category,
      description: "description" in b ? str(b.description) : cur.description || "",
    };
    if (!v.name) return "Escriba el nombre de la plantilla.";
    if (!DOC_CATEGORIES.includes(v.category)) return "Categoría no válida.";
    // Version 2.2.64: only a Memorial template belongs to a memorial category (empty = «Otros memoriales»).
    // Version 2.2.66 (John): only Gerencia assigns a template to a memorial category.
    if ("memorial_category_id" in b && (Number(b.memorial_category_id) || null) !== (cur.memorial_category_id || null) && user?.role !== "Gerencia") return "Solo Gerencia puede asignar plantillas a una categoría de memoriales.";
    const mc = "memorial_category_id" in b ? Number(b.memorial_category_id) || null : cur.memorial_category_id || null;
    v.memorial_category_id = v.category === "Memorial" ? mc : null;
    if (v.memorial_category_id && !db.prepare("SELECT 1 FROM memorial_categories WHERE id = ?").get(v.memorial_category_id)) return "Elija una categoría de memoriales válida.";
    return v;
  }

  r.post("/", manage, (req, res) => {
    const b = req.body ?? {};
    const v = values(b, {}, req.user);
    if (typeof v === "string") return res.status(400).json({ error: v });
    if (b.file_base64) {
      const file = Buffer.from(String(b.file_base64), "base64");
      if (!file.length || file.length > MAX_FILE) return res.status(400).json({ error: "El archivo debe pesar menos de 8 MB." });
      if (file.subarray(0, 2).toString("latin1") !== "PK") return res.status(400).json({ error: "El archivo no es un documento de Word (.docx) válido." });
      const id = db.prepare(`INSERT INTO document_templates (name, category, description, format, filename, file, created_by, memorial_category_id)
        VALUES (?, ?, ?, 'docx', ?, ?, ?, ?)`).run(v.name, v.category, v.description, str(b.filename) || "plantilla.docx", file, req.user.id, v.memorial_category_id).lastInsertRowid;
      return res.status(201).json(out(db.prepare(`SELECT ${META} FROM document_templates WHERE id = ?`).get(id)));
    }
    const body = String(b.body ?? "");
    if (!body.trim()) return res.status(400).json({ error: "La plantilla está vacía." });
    if (body.length > 400000) return res.status(400).json({ error: "La plantilla es demasiado larga." });
    const id = db.prepare(`INSERT INTO document_templates (name, category, description, format, body, created_by, memorial_category_id)
      VALUES (?, ?, ?, 'markdown', ?, ?, ?)`).run(v.name, v.category, v.description, body, req.user.id, v.memorial_category_id).lastInsertRowid;
    res.status(201).json(out(db.prepare(`SELECT ${META}, body FROM document_templates WHERE id = ?`).get(id)));
  });

  r.put("/:id", manage, (req, res) => {
    const cur = db.prepare("SELECT * FROM document_templates WHERE id = ?").get(Number(req.params.id));
    if (!cur) return res.status(404).json({ error: "La plantilla no existe." });
    const v = values(req.body ?? {}, cur, req.user);
    if (typeof v === "string") return res.status(400).json({ error: v });
    // Replacing with an updated Word file (version 2.16): a text template becomes a Word one;
    // a Word template also gets a new file when its blanks turn into {{variables}}.
    let file = cur.file, format = cur.format, filename = cur.filename, body = cur.body;
    if (req.body?.file_base64) {
      file = Buffer.from(String(req.body.file_base64), "base64");
      if (!file.length || file.length > MAX_FILE) return res.status(400).json({ error: "El archivo debe pesar menos de 8 MB." });
      if (file.subarray(0, 2).toString("latin1") !== "PK") return res.status(400).json({ error: "El archivo no es un documento de Word (.docx) válido." });
      format = "docx";
      filename = str(req.body.filename) || cur.filename || `${v.name}.docx`;
      body = null;
    } else if (cur.format === "markdown" && "body" in (req.body ?? {})) body = String(req.body.body);
    if (format === "markdown" && !String(body || "").trim()) return res.status(400).json({ error: "La plantilla está vacía." });
    db.prepare("UPDATE document_templates SET name = ?, category = ?, description = ?, memorial_category_id = ?, format = ?, filename = ?, body = ?, file = ?, updated_at = datetime('now') WHERE id = ?")
      .run(v.name, v.category, v.description, v.memorial_category_id, format, filename, body, file, cur.id);
    res.json(out(db.prepare(`SELECT ${META}, body FROM document_templates WHERE id = ?`).get(cur.id)));
  });

  r.delete("/:id", manage, (req, res) => {
    const { changes } = db.prepare("DELETE FROM document_templates WHERE id = ?").run(Number(req.params.id));
    if (!changes) return res.status(404).json({ error: "La plantilla no existe." });
    res.status(204).end();
  });

  return r;
}
