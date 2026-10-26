// «Numeración de documentos» (version 2.2.58). Mounted under /api/doc-numbers. Every number is issued once, in order, per kind.
import express from "express";
import { HttpError, toInt } from "./http.js";
import { scopeOf, inTransaction } from "./auth.js";
import { DOC_START, DOC_KIND_NAME, formatDocNumber, nextDocNumber } from "./doc-numbers.js";

export const DOC_NUMBERS_SCHEMA = `
CREATE TABLE IF NOT EXISTS doc_numbers (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  number INTEGER NOT NULL,
  case_id INTEGER,
  template_id INTEGER,
  template_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  user_id INTEGER,
  user_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (kind, number)
);
CREATE INDEX IF NOT EXISTS doc_numbers_case ON doc_numbers(case_id);`;

const ACTIONS = ["docx", "pdf", "save", "mail", "whatsapp", "sign"];

export function docNumbersRouter(db) {
  const r = express.Router();
  const visibleCase = (req, id) => {
    const k = db.prepare("SELECT office_id FROM cases WHERE id = ?").get(id), sc = scopeOf(req.user);
    if (!k || (sc !== null && !sc.includes(k.office_id))) throw new HttpError(404, "El expediente no existe.");
  };

  // Issues the next number of a kind. Called when a document is generated (Word, PDF, saved, sent or sent to sign).
  r.post("/", (req, res) => {
    const b = req.body ?? {};
    const kind = String(b.kind ?? "");
    if (!DOC_START[kind]) throw new HttpError(400, "Solo se numeran los contratos y los poderes.");
    const caseId = b.case_id ? toInt(b.case_id, "El expediente") : null;
    if (caseId) visibleCase(req, caseId);
    const row = inTransaction(db, () => {
      const number = nextDocNumber(db.prepare("SELECT MAX(number) AS m FROM doc_numbers WHERE kind = ?").get(kind).m, kind);
      db.prepare("INSERT INTO doc_numbers (kind, number, case_id, template_id, template_name, action, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(kind, number, caseId, Number(b.template_id) || null, String(b.template_name ?? "").slice(0, 160), ACTIONS.includes(b.action) ? b.action : "", req.user.id, req.user.name || "");
      return number;
    });
    res.status(201).json({ kind, name: DOC_KIND_NAME[kind], number: row, label: formatDocNumber(row) });
  });

  // What was issued: a case's documents, or (Gerencia) the latest ones.
  r.get("/", (req, res) => {
    const caseId = req.query.case_id ? toInt(req.query.case_id, "El expediente") : null;
    if (caseId) visibleCase(req, caseId);
    else if (req.user.role !== "Gerencia") throw new HttpError(403, "Su rol no tiene permiso para ver toda la numeración (solo Gerencia).");
    const rows = caseId
      ? db.prepare("SELECT * FROM doc_numbers WHERE case_id = ? ORDER BY id DESC").all(caseId)
      : db.prepare("SELECT * FROM doc_numbers ORDER BY id DESC LIMIT 200").all();
    res.json(rows.map((x) => ({ ...x, label: formatDocNumber(x.number) })));
  });
  return r;
}
