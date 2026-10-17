import express from "express";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { scopeOf } from "./auth.js";
import { searchSentencias, analyzeSentencia, analyzeText, verifyCitation, COURTS, CSJ_SALAS } from "./jurisprudence.js";

const str = (v) => (typeof v === "string" ? v.trim() : "");

// The server signs the URL of every result it verified; saving a judgment as
// verified requires that signature, so the page cannot mark one by itself.
const PROOF_KEY = process.env.PROOF_SECRET || randomBytes(32).toString("hex");
const proofFor = (url) => createHmac("sha256", PROOF_KEY).update(String(url)).digest("base64url");
const proofOk = (url, proof) => {
  const want = Buffer.from(proofFor(url));
  const got = Buffer.from(String(proof || ""));
  return want.length === got.length && timingSafeEqual(want, got);
};
const withProof = (item) => (item?.verified && item.url ? { ...item, proof: proofFor(item.url) } : item);

function apiError(err) {
  if (/authentication method/i.test(err.message || "")) return [500, "El servidor no tiene configurada la clave de Anthropic (ANTHROPIC_API_KEY)."];
  if (err instanceof Anthropic.AuthenticationError) return [500, "Falta o es inválida la clave de Anthropic."];
  if (err instanceof Anthropic.RateLimitError) return [429, "Demasiadas consultas seguidas. Intente en un momento."];
  if (err instanceof Anthropic.APIError) return [502, `Error del servicio de IA (${err.status}).`];
  return [500, "Error interno del servidor."]; // details stay in the log (audit A10-001)
}

const CACHE_MS = 30 * 24 * 3600 * 1000;
const cacheKey = (kind, args) => kind + ":" + createHash("sha256")
  .update(JSON.stringify(args, (_k, v) => (typeof v === "string" ? v.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase() : v)))
  .digest("hex");

export function jurisprudenceRouter(db) {
  const r = express.Router();

  // Same question within 30 days: answer from the database instead of researching again.
  // Only answers that found something are kept, so a miss is always retried.
  const cached = async (kind, args, run, keep) => {
    const key = cacheKey(kind, args);
    const row = db.prepare("SELECT result, created_ms FROM jurisprudence_cache WHERE key = ?").get(key);
    if (row && Date.now() - row.created_ms < CACHE_MS) return { ...JSON.parse(row.result), cached: true };
    const result = await run();
    if (keep(result)) {
      db.prepare("INSERT OR REPLACE INTO jurisprudence_cache (key, result, created_ms) VALUES (?, ?, ?)").run(key, JSON.stringify(result), Date.now());
    }
    return result;
  };

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
    const args = {
      query, court: COURTS[b.court] ? b.court : "", sala: str(b.sala),
      yearFrom: Number(b.yearFrom) || null, yearTo: Number(b.yearTo) || null,
    };
    return cached("search", args, () => searchSentencias(args), (o) => o.results.length > 0).then((out) => ({ ...out, results: out.results.map(withProof) }));
  }));

  r.post("/analyze", ai((b) => {
    if (str(b.text).length >= 400) return analyzeText({ text: str(b.text), reference: str(b.reference) });
    if (!str(b.reference) && !str(b.url)) throw Object.assign(new Error("Indique la sentencia o su enlace."), { status: 400 });
    const args = { reference: str(b.reference), url: str(b.url), court: str(b.court) };
    return cached("analyze", args, () => analyzeSentencia(args), (o) => !!o.found).then(withProof);
  }));

  r.post("/verify", ai((b) => {
    if (!str(b.citation)) throw Object.assign(new Error("Falta la cita."), { status: 400 });
    return verifyCitation({ citation: str(b.citation), claim: str(b.claim).slice(0, 1200) });
  }));

  // ---------- Saved judgments ----------
  const out = (row) => ({ ...row, verified: !!row.verified, analysis: JSON.parse(row.analysis) });

  // Visible: saved by me, or attached to a case in my offices (everything for scope.all).
  const visibleSql = (req) => {
    const sc = scopeOf(req.user);
    if (sc === null) return ["1 = 1", []];
    const inCase = sc.length ? `case_id IN (SELECT id FROM cases WHERE office_id IN (${sc.map(() => "?").join(",")}))` : "0 = 1";
    return [`(created_by = ? OR ${inCase})`, [req.user.id, ...sc]];
  };
  const caseVisible = (req, caseId) => {
    const k = db.prepare("SELECT office_id FROM cases WHERE id = ?").get(caseId);
    const sc = scopeOf(req.user);
    return !!k && (sc === null || sc.includes(k.office_id));
  };

  r.get("/saved", (req, res) => {
    const [w, p] = visibleSql(req);
    const caseId = Number(req.query.caseId) || null;
    const rows = caseId
      ? db.prepare(`SELECT * FROM saved_rulings WHERE case_id = ? AND ${w} ORDER BY id DESC`).all(caseId, ...p)
      : db.prepare(`SELECT * FROM saved_rulings WHERE ${w} ORDER BY id DESC`).all(...p);
    res.json(rows.map(out));
  });

  r.post("/saved", (req, res) => {
    const b = req.body ?? {};
    const reference = str(b.reference);
    if (!reference) return res.status(400).json({ error: "Falta la referencia de la sentencia." });
    const caseId = Number(b.case_id) || null;
    if (caseId && !caseVisible(req, caseId)) {
      return res.status(404).json({ error: "El expediente no existe." });
    }
    const verified = !!b.verified && proofOk(str(b.url), b.proof);
    const id = db.prepare(`INSERT INTO saved_rulings (case_id, reference, court, url, verified, analysis, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(caseId, reference, str(b.court), str(b.url), verified ? 1 : 0,
      JSON.stringify(b.analysis ?? {}), req.user.id).lastInsertRowid;
    res.status(201).json(out(db.prepare("SELECT * FROM saved_rulings WHERE id = ?").get(id)));
  });

  r.delete("/saved/:id", (req, res) => {
    const [w, p] = visibleSql(req);
    const { changes } = db.prepare(`DELETE FROM saved_rulings WHERE id = ? AND ${w}`).run(Number(req.params.id), ...p);
    if (!changes) return res.status(404).json({ error: "No existe." });
    res.status(204).end();
  });

  return r;
}
