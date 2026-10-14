import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { searchSentencias, analyzeSentencia, verifyCitation, COURTS, CSJ_SALAS } from "./jurisprudence.js";

const str = (v) => (typeof v === "string" ? v.trim() : "");

function apiError(err) {
  if (/authentication method/i.test(err.message || "")) return [500, "El servidor no tiene configurada la clave de Anthropic (ANTHROPIC_API_KEY)."];
  if (err instanceof Anthropic.AuthenticationError) return [500, "Falta o es inválida la clave de Anthropic."];
  if (err instanceof Anthropic.RateLimitError) return [429, "Demasiadas consultas seguidas. Intente en un momento."];
  if (err instanceof Anthropic.APIError) return [502, `Error del servicio de IA (${err.status}).`];
  return [500, err.message || "Error interno."];
}

export function jurisprudenceRouter(db) {
  const r = express.Router();

  const ai = (fn) => async (req, res) => {
    try {
      res.json(await fn(req.body ?? {}));
    } catch (err) {
      console.error(err);
      const [status, error] = err.status && !(err instanceof Anthropic.APIError) ? [err.status, err.message] : apiError(err);
      res.status(status).json({ error });
    }
  };

  r.get("/courts", (_req, res) => res.json({ courts: COURTS, csjSalas: CSJ_SALAS }));

  r.post("/search", ai((b) => {
    const query = str(b.query);
    if (!query) throw Object.assign(new Error("Escriba qué busca."), { status: 400 });
    return searchSentencias({
      query, court: COURTS[b.court] ? b.court : "", sala: str(b.sala),
      yearFrom: Number(b.yearFrom) || null, yearTo: Number(b.yearTo) || null,
    });
  }));

  r.post("/analyze", ai((b) => {
    if (!str(b.reference) && !str(b.url)) throw Object.assign(new Error("Indique la sentencia o su enlace."), { status: 400 });
    return analyzeSentencia({ reference: str(b.reference), url: str(b.url), court: str(b.court) });
  }));

  r.post("/verify", ai((b) => {
    if (!str(b.citation)) throw Object.assign(new Error("Falta la cita."), { status: 400 });
    return verifyCitation({ citation: str(b.citation), claim: str(b.claim).slice(0, 1200) });
  }));

  // ---------- Saved judgments ----------
  const out = (row) => ({ ...row, verified: !!row.verified, analysis: JSON.parse(row.analysis) });

  r.get("/saved", (req, res) => {
    const caseId = Number(req.query.caseId) || null;
    const rows = caseId
      ? db.prepare("SELECT * FROM saved_rulings WHERE case_id = ? ORDER BY id DESC").all(caseId)
      : db.prepare("SELECT * FROM saved_rulings ORDER BY id DESC").all();
    res.json(rows.map(out));
  });

  r.post("/saved", (req, res) => {
    const b = req.body ?? {};
    const reference = str(b.reference);
    if (!reference) return res.status(400).json({ error: "Falta la referencia de la sentencia." });
    const caseId = Number(b.case_id) || null;
    if (caseId && !db.prepare("SELECT id FROM cases WHERE id = ?").get(caseId)) {
      return res.status(404).json({ error: "El expediente no existe." });
    }
    const id = db.prepare(`INSERT INTO saved_rulings (case_id, reference, court, url, verified, analysis)
      VALUES (?, ?, ?, ?, ?, ?)`).run(caseId, reference, str(b.court), str(b.url), b.verified ? 1 : 0,
      JSON.stringify(b.analysis ?? {})).lastInsertRowid;
    res.status(201).json(out(db.prepare("SELECT * FROM saved_rulings WHERE id = ?").get(id)));
  });

  r.delete("/saved/:id", (req, res) => {
    const { changes } = db.prepare("DELETE FROM saved_rulings WHERE id = ?").run(Number(req.params.id));
    if (!changes) return res.status(404).json({ error: "No existe." });
    res.status(204).end();
  });

  return r;
}
