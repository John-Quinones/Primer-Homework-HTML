// Electronic signature with e-mailed one-time codes (OTP). Each signer gets a
// private link; signing records the document's SHA-256, time, IP, browser,
// typed name and drawn signature, and every step goes to an audit trail.
// Signers can also sign in person on an office device.
import express from "express";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { can, scopeOf } from "./auth.js";
import { sendEmail } from "./notify.js";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const str = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const MAX_PDF = 10 * 1024 * 1024;
const OTP_MINUTES = 10;
const PNG = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

export const publicUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
// req.ip honours "trust proxy" (TRUST_PROXY=1 behind Render), so a client cannot forge it otherwise.
const clientIp = (req) => String(req.ip || req.socket.remoteAddress || "");
const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function event(db, requestId, signerId, name, detail = "", ip = "") {
  db.prepare("INSERT INTO sign_events (request_id, signer_id, event, detail, ip) VALUES (?, ?, ?, ?, ?)").run(requestId, signerId, name, detail, ip);
}

async function sendLink(db, req, request, signer, token) {
  const link = `${publicUrl(req)}/firmar.html#${token}`;
  const text = `Hola ${signer.name}:\n\n${request.message || "Le enviamos un documento para su firma electrónica."}\n\nDocumento: ${request.title}\nPara leerlo y firmarlo, abra este enlace:\n${link}\n\nAl firmar le enviaremos un código de verificación a este correo.\n\nTecjuridicosApp`;
  const html = `<div style="font-family:Arial,sans-serif;color:#101010"><p>Hola ${esc(signer.name)}:</p><p>${esc(request.message || "Le enviamos un documento para su firma electrónica.")}</p>
    <p><strong>Documento:</strong> ${esc(request.title)}</p>
    <p><a href="${esc(link)}" style="display:inline-block;background:#002b6a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Leer y firmar</a></p>
    <p style="color:#666;font-size:12px">Al firmar le enviaremos un código de verificación a este correo. Si no esperaba este mensaje, ignórelo.</p></div>`;
  const r = await sendEmail(signer.email, `Documento para firmar: ${request.title}`, text, html);
  event(db, request.id, signer.id, r.ok ? "enlace_enviado" : "enlace_no_enviado", r.ok ? signer.email : r.detail);
  return r;
}

const requestOut = (db, r) => {
  const signers = db.prepare(`SELECT id, name, id_type, id_number, email, phone, status, method, signed_at, ip, user_agent, typed_name,
      signature_png, reject_reason, otp_sent_at FROM sign_signers WHERE request_id = ? ORDER BY id`).all(r.id).map((x) => ({ ...x }));
  const events = db.prepare("SELECT * FROM sign_events WHERE request_id = ? ORDER BY id").all(r.id).map((x) => ({ ...x }));
  const { doc_file, ...rest } = r;
  return { ...rest, has_pdf: !!doc_file, signers, events };
};

function finishIfDone(db, requestId) {
  const pending = db.prepare("SELECT COUNT(*) AS n FROM sign_signers WHERE request_id = ? AND status != 'firmado'").get(requestId).n;
  if (!pending) {
    db.prepare("UPDATE sign_requests SET status = 'completada', completed_at = datetime('now') WHERE id = ? AND status = 'enviada'").run(requestId);
    event(db, requestId, null, "completada", "Todos los firmantes firmaron.");
    const r = db.prepare("SELECT created_by, title FROM sign_requests WHERE id = ?").get(requestId);
    if (r.created_by) {
      db.prepare("INSERT INTO notifications (user_id, kind, title, body, link) VALUES (?, 'firma', ?, ?, '#firmas')")
        .run(r.created_by, "Documento firmado por todos", r.title);
    }
  }
}

/** Staff routes (signed-in users with esign.use). */
export function esignRouter(db) {
  const r = express.Router();
  const officeCond = (req) => {
    const sc = scopeOf(req.user);
    return sc === null ? "1 = 1" : `(office_id IN (${sc.map(Number).join(",") || "NULL"}) OR created_by = ${Number(req.user.id)})`;
  };
  const get = (req, id) => db.prepare(`SELECT * FROM sign_requests WHERE id = ? AND ${officeCond(req)}`).get(id);

  r.get("/", (req, res) => {
    const rows = db.prepare(`SELECT * FROM sign_requests WHERE ${officeCond(req)} ORDER BY id DESC LIMIT 300`).all();
    res.json(rows.map((x) => requestOut(db, x)));
  });

  r.get("/:id", (req, res) => {
    const x = get(req, Number(req.params.id));
    if (!x) return res.status(404).json({ error: "La solicitud no existe." });
    res.json(requestOut(db, x));
  });

  r.get("/:id/pdf", (req, res) => {
    const x = get(req, Number(req.params.id));
    if (!x?.doc_file) return res.status(404).json({ error: "La solicitud no tiene PDF." });
    res.json({ name: x.doc_name, base64: Buffer.from(x.doc_file).toString("base64") });
  });

  r.post("/", async (req, res) => {
    const b = req.body ?? {};
    const title = str(b.title);
    if (!title) return res.status(400).json({ error: "Escriba el nombre del documento." });
    const signers = Array.isArray(b.signers) ? b.signers.map((s) => ({ name: str(s.name), id_type: str(s.id_type) || "CC", id_number: str(s.id_number), email: str(s.email).toLowerCase(), phone: str(s.phone) })) : [];
    if (!signers.length || signers.length > 10) return res.status(400).json({ error: "Agregue entre 1 y 10 firmantes." });
    const remote = b.mode !== "presencial";
    for (const s of signers) {
      if (!s.name) return res.status(400).json({ error: "Cada firmante necesita nombre." });
      if (remote && !s.email.includes("@")) return res.status(400).json({ error: `Falta un correo válido para ${s.name}.` });
    }
    let kind, text = null, file = null;
    if (b.doc_pdf_base64) {
      file = Buffer.from(String(b.doc_pdf_base64), "base64");
      if (!file.length || file.length > MAX_PDF) return res.status(400).json({ error: "El PDF debe pesar menos de 10 MB." });
      if (file.subarray(0, 5).toString("latin1") !== "%PDF-") return res.status(400).json({ error: "El archivo no es un PDF válido." });
      kind = "pdf";
    } else {
      text = String(b.doc_text ?? "");
      if (!text.trim()) return res.status(400).json({ error: "El documento está vacío." });
      kind = "markdown";
    }
    let officeId = null;
    if (b.case_id) {
      const k = db.prepare("SELECT office_id FROM cases WHERE id = ?").get(Number(b.case_id));
      const sc = scopeOf(req.user);
      if (!k || (sc !== null && !sc.includes(k.office_id))) return res.status(404).json({ error: "El expediente no existe." });
      officeId = k.office_id;
    }
    officeId ||= req.user.offices[0]?.id ?? null;
    const hash = sha(file || Buffer.from(text, "utf8"));
    const id = db.prepare(`INSERT INTO sign_requests (title, case_id, office_id, doc_kind, doc_text, doc_file, doc_name, doc_hash, message, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(title, Number(b.case_id) || null, officeId, kind, text, file, str(b.doc_name), hash, str(b.message), req.user.id).lastInsertRowid;
    event(db, id, null, "creada", `${req.user.name} · SHA-256 ${hash}`, clientIp(req));
    const ins = db.prepare("INSERT INTO sign_signers (request_id, name, id_type, id_number, email, phone, token_hash) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const delivery = [];
    for (const s of signers) {
      const token = randomBytes(24).toString("base64url");
      const sid = ins.run(id, s.name, s.id_type, s.id_number, s.email, s.phone, sha(token)).lastInsertRowid;
      if (remote) delivery.push(await sendLink(db, req, { id, title, message: str(b.message) }, { id: sid, ...s }, token));
    }
    res.status(201).json({ ...requestOut(db, db.prepare("SELECT * FROM sign_requests WHERE id = ?").get(id)), delivery });
  });

  r.post("/:id/remind/:signerId", async (req, res) => {
    const x = get(req, Number(req.params.id));
    const s = x && db.prepare("SELECT * FROM sign_signers WHERE id = ? AND request_id = ?").get(Number(req.params.signerId), x.id);
    if (!s || x.status !== "enviada" || s.status !== "pendiente") return res.status(400).json({ error: "Este firmante no tiene firma pendiente." });
    // A reminder issues a fresh link; the old one stops working.
    const token = randomBytes(24).toString("base64url");
    db.prepare("UPDATE sign_signers SET token_hash = ? WHERE id = ?").run(sha(token), s.id);
    res.json(await sendLink(db, req, x, s, token));
  });

  r.post("/:id/cancel", (req, res) => {
    const x = get(req, Number(req.params.id));
    if (!x || x.status !== "enviada") return res.status(400).json({ error: "Solo se cancelan solicitudes en curso." });
    db.prepare("UPDATE sign_requests SET status = 'cancelada' WHERE id = ?").run(x.id);
    event(db, x.id, null, "cancelada", req.user.name, clientIp(req));
    res.json(requestOut(db, db.prepare("SELECT * FROM sign_requests WHERE id = ?").get(x.id)));
  });

  // In-person signature on an office device, witnessed by the signed-in user.
  r.post("/:id/in-person/:signerId", (req, res) => {
    const x = get(req, Number(req.params.id));
    const s = x && db.prepare("SELECT * FROM sign_signers WHERE id = ? AND request_id = ?").get(Number(req.params.signerId), x.id);
    if (!s || x.status !== "enviada" || s.status !== "pendiente") return res.status(400).json({ error: "Este firmante no tiene firma pendiente." });
    const b = req.body ?? {};
    if (!PNG.test(b.signature_png || "") || b.signature_png.length > 400000) return res.status(400).json({ error: "Dibuje la firma." });
    if (!str(b.typed_name)) return res.status(400).json({ error: "Escriba el nombre completo del firmante." });
    if (!b.accept) return res.status(400).json({ error: "El firmante debe aceptar el documento." });
    db.prepare(`UPDATE sign_signers SET status = 'firmado', method = 'presencial', signed_at = datetime('now'), ip = ?, user_agent = ?,
      typed_name = ?, signature_png = ?, id_number = CASE WHEN ? != '' THEN ? ELSE id_number END WHERE id = ?`)
      .run(clientIp(req), String(req.get("user-agent") || "").slice(0, 300), str(b.typed_name), b.signature_png, str(b.id_number), str(b.id_number), s.id);
    event(db, x.id, s.id, "firmado_presencial", `Testigo: ${req.user.name} · SHA-256 ${x.doc_hash}`, clientIp(req));
    finishIfDone(db, x.id);
    res.json(requestOut(db, db.prepare("SELECT * FROM sign_requests WHERE id = ?").get(x.id)));
  });

  return r;
}

/** Public routes used by the signer's page (no session; the link token is the credential). */
export function esignPublicRouter(db) {
  const r = express.Router();
  const bySigner = (token) => {
    const s = db.prepare("SELECT * FROM sign_signers WHERE token_hash = ?").get(sha(String(token || "")));
    if (!s) return null;
    return { s, x: db.prepare("SELECT * FROM sign_requests WHERE id = ?").get(s.request_id) };
  };
  const view = ({ s, x }) => ({
    title: x.title, message: x.message, doc_kind: x.doc_kind, doc_text: x.doc_text, doc_name: x.doc_name, doc_hash: x.doc_hash,
    request_status: x.status, signer: { name: s.name, id_type: s.id_type, id_number: s.id_number, email: s.email.replace(/^(.{2}).*(@.*)$/, "$1•••$2"), status: s.status, signed_at: s.signed_at },
  });

  r.get("/:token", (req, res) => {
    const f = bySigner(req.params.token);
    if (!f) return res.status(404).json({ error: "El enlace no es válido o fue reemplazado por uno más reciente." });
    if (f.s.status === "pendiente") event(db, f.x.id, f.s.id, "abierto", "", clientIp(req));
    res.json(view(f));
  });

  r.get("/:token/pdf", (req, res) => {
    const f = bySigner(req.params.token);
    if (!f?.x.doc_file) return res.status(404).json({ error: "No hay PDF." });
    res.json({ name: f.x.doc_name, base64: Buffer.from(f.x.doc_file).toString("base64") });
  });

  r.post("/:token/otp", async (req, res) => {
    const f = bySigner(req.params.token);
    if (!f || f.s.status !== "pendiente" || f.x.status !== "enviada") return res.status(400).json({ error: "Este documento ya no está pendiente de su firma." });
    if (f.s.otp_sent_at && Date.parse(f.s.otp_sent_at.replace(" ", "T") + "Z") > Date.now() - 60000) return res.status(429).json({ error: "Espere un minuto antes de pedir otro código." });
    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    db.prepare(`UPDATE sign_signers SET otp_hash = ?, otp_expires_at = datetime('now', '+${OTP_MINUTES} minutes'), otp_sent_at = datetime('now'), otp_attempts = 0 WHERE id = ?`)
      .run(sha(`${f.s.id}:${code}`), f.s.id);
    const out = await sendEmail(f.s.email, `Código para firmar: ${code}`,
      `Su código para firmar "${f.x.title}" es ${code}. Vence en ${OTP_MINUTES} minutos. No lo comparta.`,
      `<p>Su código para firmar <strong>${esc(f.x.title)}</strong> es:</p><p style="font-size:28px;letter-spacing:6px;font-weight:bold">${code}</p><p>Vence en ${OTP_MINUTES} minutos. No lo comparta.</p>`);
    event(db, f.x.id, f.s.id, out.ok ? "codigo_enviado" : "codigo_no_enviado", out.ok ? "" : out.detail, clientIp(req));
    if (!out.ok) return res.status(502).json({ error: "No se pudo enviar el código. Avise a quien le envió el documento." });
    res.json({ sent: true, minutes: OTP_MINUTES });
  });

  r.post("/:token/sign", (req, res) => {
    const f = bySigner(req.params.token);
    if (!f || f.s.status !== "pendiente" || f.x.status !== "enviada") return res.status(400).json({ error: "Este documento ya no está pendiente de su firma." });
    const b = req.body ?? {};
    const s = f.s;
    if (!s.otp_hash || !s.otp_expires_at || Date.parse(s.otp_expires_at.replace(" ", "T") + "Z") < Date.now()) return res.status(400).json({ error: "Pida un código nuevo." });
    if (s.otp_attempts >= 5) return res.status(429).json({ error: "Demasiados intentos. Pida un código nuevo." });
    const want = Buffer.from(s.otp_hash), got = Buffer.from(sha(`${s.id}:${str(b.otp)}`));
    if (!timingSafeEqual(want, got)) {
      db.prepare("UPDATE sign_signers SET otp_attempts = otp_attempts + 1 WHERE id = ?").run(s.id);
      event(db, f.x.id, s.id, "codigo_incorrecto", "", clientIp(req));
      return res.status(400).json({ error: "El código no es correcto." });
    }
    if (!PNG.test(b.signature_png || "") || b.signature_png.length > 400000) return res.status(400).json({ error: "Dibuje su firma." });
    if (!str(b.typed_name)) return res.status(400).json({ error: "Escriba su nombre completo." });
    if (!b.accept) return res.status(400).json({ error: "Debe aceptar el documento para firmarlo." });
    db.prepare(`UPDATE sign_signers SET status = 'firmado', method = 'enlace_otp', signed_at = datetime('now'), ip = ?, user_agent = ?,
      typed_name = ?, signature_png = ?, otp_hash = NULL WHERE id = ?`)
      .run(clientIp(req), String(req.get("user-agent") || "").slice(0, 300), str(b.typed_name), b.signature_png, s.id);
    event(db, f.x.id, s.id, "firmado", `OTP verificado en ${s.email} · SHA-256 ${f.x.doc_hash}`, clientIp(req));
    finishIfDone(db, f.x.id);
    res.json(view(bySigner(req.params.token)));
  });

  r.post("/:token/reject", (req, res) => {
    const f = bySigner(req.params.token);
    if (!f || f.s.status !== "pendiente" || f.x.status !== "enviada") return res.status(400).json({ error: "Este documento ya no está pendiente." });
    db.prepare("UPDATE sign_signers SET status = 'rechazado', reject_reason = ? WHERE id = ?").run(str(req.body?.reason).slice(0, 500), f.s.id);
    db.prepare("UPDATE sign_requests SET status = 'rechazada' WHERE id = ?").run(f.x.id);
    event(db, f.x.id, f.s.id, "rechazado", str(req.body?.reason).slice(0, 500), clientIp(req));
    res.json(view(bySigner(req.params.token)));
  });

  return r;
}

export { sha };
