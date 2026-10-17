// Client authorizations (habeas data): each item of CONSENT_ITEMS is answered
// on its own and stored as evidence that is never edited or deleted. A record
// keeps the exact text answered (by its SHA-256, the text itself once in
// consent_texts), when, how (private link or in person with a drawn
// signature), the IP and browser, and a hash chained to the previous record.
import express from "express";
import { createHash, randomBytes } from "node:crypto";
import { can, scopeOf, inTransaction } from "./auth.js";
import { sendEmail, sendWhatsapp } from "./notify.js";
import { publicBase } from "./public-url.js";
import { VERSION } from "./version.js";
import { CONSENT_ITEMS, CONSENT_METHODS, legalVersion, setLegalVersion, FIRM, consentItem, consentText, consentCanonical, consentStatus } from "./legal.js";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const str = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const digits = (v) => String(v || "").replace(/\D/g, "");
const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const PNG = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const LINK_DAYS = 30;
// The legal documents carry the App's version.
setLegalVersion(VERSION);
const LEGAL_VERSION = () => legalVersion().name;
const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const clientIp = (req) => String(req.ip || req.socket.remoteAddress || "");

export const CONSENT_SCHEMA = `
CREATE TABLE IF NOT EXISTS consent_texts (
  sha256   TEXT PRIMARY KEY,
  version  TEXT NOT NULL,
  item     TEXT NOT NULL,
  text     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS consent_requests (
  id          INTEGER PRIMARY KEY,
  client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  channel     TEXT NOT NULL,
  sent_to     TEXT NOT NULL DEFAULT '',
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  opened_at   TEXT,
  answered_at TEXT
);
CREATE TABLE IF NOT EXISTS consent_records (
  id                 INTEGER PRIMARY KEY,
  client_id          INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  client_name        TEXT NOT NULL,
  client_id_number   TEXT NOT NULL DEFAULT '',
  item               TEXT NOT NULL,
  granted            INTEGER NOT NULL,
  method             TEXT NOT NULL,
  doc_version        TEXT NOT NULL,
  doc_sha256         TEXT NOT NULL,
  at                 TEXT NOT NULL,
  ip                 TEXT NOT NULL DEFAULT '',
  user_agent         TEXT NOT NULL DEFAULT '',
  typed_name         TEXT NOT NULL DEFAULT '',
  typed_id           TEXT NOT NULL DEFAULT '',
  signature_png      TEXT NOT NULL DEFAULT '',
  note               TEXT NOT NULL DEFAULT '',
  registered_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  registered_by_name TEXT NOT NULL DEFAULT '',
  request_id         INTEGER REFERENCES consent_requests(id) ON DELETE SET NULL,
  prev_hash          TEXT NOT NULL DEFAULT '',
  hash               TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS consent_records_client ON consent_records(client_id);
CREATE TRIGGER IF NOT EXISTS consent_records_no_update BEFORE UPDATE ON consent_records
  WHEN NOT (NEW.hash = OLD.hash AND NEW.prev_hash = OLD.prev_hash AND NEW.granted = OLD.granted AND NEW.item = OLD.item AND NEW.at = OLD.at
    AND (NEW.client_id IS OLD.client_id OR NEW.client_id IS NULL) AND (NEW.request_id IS OLD.request_id OR NEW.request_id IS NULL))
  BEGIN SELECT RAISE(ABORT, 'Las autorizaciones no se modifican: registre una nueva respuesta.'); END;
CREATE TRIGGER IF NOT EXISTS consent_records_no_delete BEFORE DELETE ON consent_records
  BEGIN SELECT RAISE(ABORT, 'Las autorizaciones no se borran.'); END;
`;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; this.expose = true; }
}
const fail = (msg, status = 400) => { throw new HttpError(status, msg); };

/** Store each answer of one submission, chained to the last record. */
export function recordConsents(db, client, answers, ctx) {
  const keys = CONSENT_ITEMS.map((i) => i.key).filter((k) => typeof answers[k] === "boolean");
  keys.length || fail("Marque o desmarque al menos una autorización.");
  const at = now();
  return inTransaction(db, () => keys.map((key) => {
    const text = consentText(key), docSha = sha(text);
    db.prepare("INSERT OR IGNORE INTO consent_texts (sha256, version, item, text) VALUES (?, ?, ?, ?)").run(docSha, LEGAL_VERSION(), key, text);
    const prev = db.prepare("SELECT hash FROM consent_records ORDER BY id DESC LIMIT 1").get()?.hash || "";
    const r = { client_id: client.id, client_name: client.full_name, client_id_number: [client.id_type, client.id_number].filter(Boolean).join(" "),
      item: key, granted: answers[key] ? 1 : 0, method: ctx.method, doc_version: LEGAL_VERSION(), doc_sha256: docSha, at,
      ip: ctx.ip || "", user_agent: str(ctx.user_agent).slice(0, 400), typed_name: str(ctx.typed_name).slice(0, 200), typed_id: str(ctx.typed_id).slice(0, 40),
      signature_png: ctx.signature_png || "", note: str(ctx.note).slice(0, 1000), registered_by: ctx.user?.id ?? null, registered_by_name: ctx.user?.name || "",
      request_id: ctx.request_id ?? null, prev_hash: prev };
    r.hash = sha(consentCanonical(r, prev) + r.signature_png);
    const cols = Object.keys(r);
    r.id = Number(db.prepare(`INSERT INTO consent_records (${cols.join(",")}) VALUES (${cols.map((c) => ":" + c).join(",")})`).run(r).lastInsertRowid);
    return r;
  }));
}

/** The client a signer is, when the firm knows them: same document number, or the case's client with the same e-mail. */
export function clientForSigner(db, caseId, signer) {
  const d = digits(signer.id_number);
  if (d.length >= 5) {
    const c = db.prepare("SELECT * FROM clients WHERE id_number <> ''").all().find((x) => digits(x.id_number) === d);
    if (c) return { ...c };
  }
  if (caseId && signer.email) {
    const c = db.prepare("SELECT c.* FROM clients c JOIN cases k ON k.client_id = c.id WHERE k.id = ? AND lower(c.email) = lower(?)").get(caseId, signer.email);
    if (c) return { ...c };
  }
  return null;
}

/** Checked answers sent with a signature: every item must be answered yes or no. */
export function signConsentAnswers(raw) {
  const answers = {};
  for (const i of CONSENT_ITEMS) {
    if (typeof raw?.[i.key] !== "boolean") fail(`Responda si acepta o no: ${i.title}.`);
    answers[i.key] = raw[i.key];
  }
  return answers;
}

/** The client's records and link requests, with the current answer per item. */
function consentsOut(db, clientId) {
  const records = db.prepare("SELECT * FROM consent_records WHERE client_id = ? ORDER BY id").all(clientId).map((x) => ({ ...x }));
  const requests = db.prepare(`SELECT r.id, r.channel, r.sent_to, r.created_at, r.expires_at, r.opened_at, r.answered_at, u.name AS created_by_name
    FROM consent_requests r LEFT JOIN users u ON u.id = r.created_by WHERE r.client_id = ? ORDER BY r.id DESC`).all(clientId).map((x) => ({ ...x }));
  return { version: LEGAL_VERSION(), items: CONSENT_ITEMS, methods: CONSENT_METHODS, status: consentStatus(records), records, requests };
}

/** Does every record still match its hash and its link to the previous one? */
export function verifyConsentChain(db) {
  let prev = "";
  for (const x of db.prepare("SELECT * FROM consent_records ORDER BY id").all()) {
    if (x.prev_hash !== prev || x.hash !== sha(consentCanonical(x, prev) + x.signature_png)) return { ok: false, id: x.id };
    prev = x.hash;
  }
  return { ok: true };
}

export function consentRouter(db) {
  const r = express.Router();
  const h = (fn) => async (req, res, next) => { try { const out = await fn(req, res); if (!res.headersSent) res.json(out); } catch (e) { next(e); } };

  const visibleClient = (req, id) => {
    const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(id) || fail("El cliente no existe.", 404);
    const sc = scopeOf(req.user);
    if (sc !== null && !sc.includes(c.office_id) && !db.prepare(`SELECT 1 FROM cases WHERE client_id = ? AND office_id IN (${sc.map(() => "?").join(",") || "NULL"})`).get(id, ...sc)) fail("El cliente no existe.", 404);
    return { ...c };
  };
  const write = (req) => can(req, "clients.write") || fail("No tiene permiso para registrar autorizaciones.", 403);

  r.get("/clients/:id/consents", h((req) => consentsOut(db, visibleClient(req, Number(req.params.id)).id)));

  // In the office: the client marks each item on the firm's device and signs on screen.
  r.post("/clients/:id/consents", h((req, res) => {
    write(req);
    const c = visibleClient(req, Number(req.params.id));
    const b = req.body ?? {};
    str(b.typed_name) || fail("Escriba el nombre de quien autoriza.");
    PNG.test(b.signature_png || "") || fail("Falta la firma en pantalla.");
    String(b.signature_png).length < 600000 || fail("La firma es demasiado grande.");
    recordConsents(db, c, b.answers || {}, { method: "presencial", ip: clientIp(req), user_agent: req.get("user-agent"), typed_name: b.typed_name,
      typed_id: b.typed_id, signature_png: b.signature_png, note: b.note, user: req.user });
    res.status(201);
    return consentsOut(db, c.id);
  }));

  // The client asked (in writing, by e-mail, in person) to withdraw one authorization.
  r.post("/clients/:id/consents/revoke", h((req, res) => {
    write(req);
    const c = visibleClient(req, Number(req.params.id));
    const b = req.body ?? {};
    consentItem(b.item) || fail("Autorización no válida.");
    str(b.note) || fail("Indique cómo pidió el cliente la revocación (por ejemplo, correo del 15/10/2026).");
    recordConsents(db, c, { [b.item]: false }, { method: "revocacion", ip: clientIp(req), user_agent: req.get("user-agent"), note: b.note, user: req.user });
    res.status(201);
    return consentsOut(db, c.id);
  }));

  // A private link for the client to answer from their phone or computer.
  r.post("/clients/:id/consent-link", h(async (req, res) => {
    write(req);
    const c = visibleClient(req, Number(req.params.id));
    const channel = ["email", "whatsapp", "copy"].includes(req.body?.channel) ? req.body.channel : "copy";
    if (channel === "email" && !c.email) fail("El cliente no tiene correo registrado.");
    if (channel === "whatsapp" && !digits(c.phone)) fail("El cliente no tiene teléfono registrado.");
    const token = randomBytes(24).toString("base64url");
    const expires = new Date(Date.now() + LINK_DAYS * 86400000).toISOString().slice(0, 19).replace("T", " ");
    const sentTo = channel === "email" ? c.email : channel === "whatsapp" ? c.phone : "";
    const id = Number(db.prepare("INSERT INTO consent_requests (client_id, token_hash, channel, sent_to, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(c.id, sha(token), channel, sentTo, req.user.id, now(), expires).lastInsertRowid);
    const link = `${publicBase(req)}/autorizar.html#${token}`;
    let sent = null;
    if (channel === "email") {
      const text = `Hola ${c.full_name}:\n\n${FIRM.brand} le pide revisar y responder sus autorizaciones de tratamiento de datos personales, privacidad, cookies, centrales de riesgo y comunicaciones. Cada una se responde por separado y puede negarse a cualquiera.\n\nAbra este enlace privado (vence en ${LINK_DAYS} días):\n${link}\n\n${FIRM.brand}`;
      const html = `<div style="font-family:Arial,sans-serif;color:#101010"><p>Hola ${esc(c.full_name)}:</p>
        <p>${esc(FIRM.brand)} le pide revisar y responder sus autorizaciones de <strong>tratamiento de datos personales, privacidad, cookies, centrales de riesgo y comunicaciones</strong>. Cada una se responde por separado y puede negarse a cualquiera.</p>
        <p><a href="${esc(link)}" style="display:inline-block;background:#002b6a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Revisar y responder</a></p>
        <p style="color:#666;font-size:12px">Enlace privado, vence en ${LINK_DAYS} días. Si no esperaba este mensaje, ignórelo.</p></div>`;
      sent = await sendEmail(c.email, `${FIRM.brand}: autorizaciones de tratamiento de datos`, text, html);
    } else if (channel === "whatsapp") {
      sent = await sendWhatsapp(c.phone, `${FIRM.brand} le pide responder sus autorizaciones de datos personales, privacidad, cookies, centrales de riesgo y comunicaciones, cada una por separado: ${link}`);
    }
    res.status(201);
    return { id, link, sent, ...consentsOut(db, c.id) };
  }));

  return r;
}

/** The client's page: the link token is the credential. */
export function consentPublicRouter(db) {
  const r = express.Router();
  const h = (fn) => async (req, res, next) => { try { const out = await fn(req, res); if (!res.headersSent) res.json(out); } catch (e) { next(e); } };
  const byToken = (token) => {
    const q = db.prepare("SELECT * FROM consent_requests WHERE token_hash = ?").get(sha(str(token))) || fail("El enlace no es válido.", 404);
    const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(q.client_id) || fail("El enlace no es válido.", 404);
    return { q: { ...q }, c: { ...c } };
  };
  const view = (q, c) => ({
    client_name: c.full_name, needs_id: !!digits(c.id_number), version: LEGAL_VERSION(), firm: FIRM.brand, items: CONSENT_ITEMS,
    expired: !q.answered_at && q.expires_at < now(), answered_at: q.answered_at,
    answers: q.answered_at ? db.prepare("SELECT item, granted, at, hash FROM consent_records WHERE request_id = ? ORDER BY id").all(q.id).map((x) => ({ ...x })) : [],
  });

  r.get("/:token", h((req) => {
    const { q, c } = byToken(req.params.token);
    if (!q.opened_at) db.prepare("UPDATE consent_requests SET opened_at = ? WHERE id = ?").run(now(), q.id);
    return view(q, c);
  }));

  r.post("/:token", h(async (req) => {
    const { q, c } = byToken(req.params.token);
    q.answered_at && fail("Estas autorizaciones ya fueron respondidas. Si quiere cambiarlas, pida un nuevo enlace a la firma.", 409);
    q.expires_at < now() && fail("El enlace venció. Pida uno nuevo a la firma.", 410);
    const b = req.body ?? {};
    str(b.typed_name).length >= 3 || fail("Escriba su nombre completo.");
    if (digits(c.id_number) && digits(b.typed_id) !== digits(c.id_number)) fail("El número de documento no coincide con el registrado por la firma.");
    const answers = Object.fromEntries(CONSENT_ITEMS.map((i) => [i.key, b.answers?.[i.key] === true]));
    const ua = req.get("user-agent");
    const records = recordConsents(db, c, answers, { method: "enlace", ip: clientIp(req), user_agent: ua, typed_name: b.typed_name, typed_id: b.typed_id, request_id: q.id });
    db.prepare("UPDATE consent_requests SET answered_at = ? WHERE id = ?").run(records[0].at, q.id);
    // Whoever sent the link hears about it in the bell.
    if (q.created_by) db.prepare("INSERT INTO notifications (user_id, kind, title, body, link) VALUES (?, 'autorizacion', ?, ?, ?)")
      .run(q.created_by, `${c.full_name} respondió sus autorizaciones`, records.map((x) => `${consentItem(x.item).title}: ${x.granted ? "sí" : "no"}`).join(" · "), `#cliente-${c.id}-autorizaciones`);
    // The client gets a copy of what they answered.
    if (c.email) {
      const lines = records.map((x) => `${x.granted ? "AUTORIZÓ" : "NO AUTORIZÓ"} · ${consentItem(x.item).title}`);
      await sendEmail(c.email, `${FIRM.brand}: copia de sus autorizaciones`,
        `Hola ${c.full_name}:\n\nEsta es la copia de sus respuestas del ${records[0].at} (UTC), versión ${LEGAL_VERSION()} de los documentos:\n\n${lines.join("\n")}\n\nPuede revocarlas o cambiarlas cuando quiera escribiendo a la firma.\n\n${FIRM.brand}`,
        `<div style="font-family:Arial,sans-serif;color:#101010"><p>Hola ${esc(c.full_name)}:</p><p>Esta es la copia de sus respuestas (versión ${esc(LEGAL_VERSION())} de los documentos):</p><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p>Puede revocarlas o cambiarlas cuando quiera escribiendo a la firma.</p></div>`)
        .catch(() => null);
    }
    return view({ ...q, answered_at: records[0].at }, c);
  }));

  return r;
}
