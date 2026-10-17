// Electronic signature with one-time codes (OTP) sent by e-mail, SMS or WhatsApp. Each signer gets a
// private link; signing records the document's SHA-256, time, IP, browser,
// typed name and drawn signature, and every step goes to an audit trail.
// Signers can also sign in person on an office device.
import { publicBase } from "./public-url.js";
import express from "express";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { can, scopeOf } from "./auth.js";
import { sendEmail, sendSms, sendWhatsapp, sendWhatsappCode, channelReady } from "./notify.js";
import { buildSignedPdf } from "./signed-pdf.js";
import { newVerifyCode, normVerifyCode } from "./verify-code.js";
import { policiesFor, parseMailOpts, signConsentAnswers, recordConsents } from "./consents.js";
import { legalVersion, legalDoc, signMailParts, mailOptions } from "./legal.js";
import { signersProblem } from "./person.js";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const str = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const MAX_PDF = 10 * 1024 * 1024;
const OTP_MINUTES = 10;
const PNG = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

export const publicUrl = (req) => publicBase(req);
// req.ip honours "trust proxy" (TRUST_PROXY=1 behind Render), so a client cannot forge it otherwise.
const clientIp = (req) => String(req.ip || req.socket.remoteAddress || "");
const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function event(db, requestId, signerId, name, detail = "", ip = "") {
  db.prepare("INSERT INTO sign_events (request_id, signer_id, event, detail, ip) VALUES (?, ?, ?, ?, ?)").run(requestId, signerId, name, detail, ip);
}

const CHANNELS = ["email", "sms", "whatsapp"];
const CHANNEL_LABEL = { email: "correo", sms: "SMS", whatsapp: "WhatsApp" };
const maskEmail = (e) => String(e || "").replace(/^(.{2}).*(@.*)$/, "$1•••$2");
const maskPhone = (p) => { const d = String(p || "").replace(/\D/g, ""); return d ? `•••${d.slice(-4)}` : ""; };
// Channels a signer can receive codes on: e-mail when they have one, SMS / WhatsApp when they have a phone and the server is set up for it.
const otpChannels = (s) => CHANNELS.filter((c) => (c === "email" ? !!s.email : !!s.phone && channelReady(c)));

/** Send a short text by the chosen channel (e-mail gets the HTML too). */
async function deliver(channel, signer, subject, text, html, code = null) {
  if (channel === "sms") return sendSms(signer.phone, text);
  if (channel === "whatsapp") return code ? sendWhatsappCode(signer.phone, code, text) : sendWhatsapp(signer.phone, text);
  return sendEmail(signer.email, subject, text, html);
}

async function sendLink(db, req, request, signer, token) {
  const link = `${publicUrl(req)}/firmar.html#${token}`;
  const via = signer.email ? "email" : signer.otp_channel !== "email" ? signer.otp_channel : "email";
  const codeVia = CHANNEL_LABEL[signer.otp_channel] || "correo";
  // A client of the firm also gets the data policies as a checklist: on the page they accept or not each one, separately (version 2.4),
  // only with the services contract and only the items not answered yet. The office chose which parts go in the e-mail (version 2.8).
  const full = { ...request };
  if (full.case_id === undefined || full.mail_opts === undefined) Object.assign(full, db.prepare("SELECT case_id, mail_opts FROM sign_requests WHERE id = ?").get(request.id) || {});
  const ask = policiesFor(db, full, signer);
  const policies = ask ? ask.items.map((i) => ({ title: i.title, url: `${publicUrl(req)}/legal.html#${i.doc}`, doc: legalDoc(i.doc).title })) : [];
  const parts = signMailParts({ name: signer.name, message: request.message, title: request.title, link, code_via: codeVia, policies, version: legalVersion().name },
    parseMailOpts(full.mail_opts));
  const text = parts.map((p) => p.text).join("\n\n");
  const html = `<div style="font-family:Arial,sans-serif;color:#101010">${parts.map((p) => p.html).join("\n")}</div>`;
  const r = await deliver(via, signer, `Documento para firmar: ${request.title}`, via === "email" ? text : `${request.title}: para leerlo y firmarlo abra ${link}`, html);
  event(db, request.id, signer.id, r.ok ? "enlace_enviado" : "enlace_no_enviado", r.ok ? `${CHANNEL_LABEL[via]} ${via === "email" ? signer.email : maskPhone(signer.phone)}${policies.length ? " · con las políticas de datos" : ""}` : r.detail);
  return r;
}

// The signed PDF (stamps on the chosen page + certificate), as an e-mail attachment.
async function signedAttachment(db, req, x) {
  try {
    const out = await ensureSignedPdf(db, req, x.id);
    return out ? [{ filename: signedName(x.title), content: out.pdf, contentType: "application/pdf" }] : [];
  } catch (err) {
    event(db, x.id, null, "pdf_firmado_no_generado", err.message);
    return [];
  }
}

// Whoever sent the document hears about every signature (e-mail and the bell).
async function notifySigned(db, requestId, signerName) {
  const x = db.prepare("SELECT * FROM sign_requests WHERE id = ?").get(requestId);
  if (!x?.created_by) return;
  const pending = db.prepare("SELECT COUNT(*) AS n FROM sign_signers WHERE request_id = ? AND status = 'pendiente'").get(requestId).n;
  if (pending) {
    db.prepare("INSERT INTO notifications (user_id, kind, title, body, link) VALUES (?, 'firma', ?, ?, '#firmas')")
      .run(x.created_by, `${signerName} firmó`, `${x.title} · faltan ${pending} firma(s)`);
    const owner = x.notify && db.prepare("SELECT email FROM users WHERE id = ?").get(x.created_by);
    if (owner?.email) await sendEmail(owner.email, `${signerName} firmó: ${x.title}`, `${signerName} firmó "${x.title}". Faltan ${pending} firma(s).`,
      `<p><strong>${esc(signerName)}</strong> firmó <strong>${esc(x.title)}</strong>. Faltan ${pending} firma(s).</p>`);
  }
}

// When everybody signed: each signer and whoever sent the document get an e-mail with the
// signed PDF attached and a fresh private link to download it again.
async function notifyCompleted(db, req, requestId) {
  const x = db.prepare("SELECT * FROM sign_requests WHERE id = ?").get(requestId);
  if (!x?.notify) return;
  const subject = `Documento firmado por todos: ${x.title}`;
  const attachments = await signedAttachment(db, req, x);
  for (const s of db.prepare("SELECT * FROM sign_signers WHERE request_id = ?").all(requestId)) {
    if (!s.email) continue;
    const token = randomBytes(24).toString("base64url");
    db.prepare("UPDATE sign_signers SET token_hash = ? WHERE id = ?").run(sha(token), s.id);
    const link = `${publicUrl(req)}/firmar.html#${token}`;
    const r = await sendEmail(s.email, subject,
      `Hola ${s.name}:\n\nTodos los firmantes firmaron "${x.title}". Adjuntamos el documento firmado, con las firmas estampadas y el certificado. También puede descargarlo en:\n${link}\n\nTecjuridicosApp`,
      `<div style="font-family:Arial,sans-serif;color:#101010"><p>Hola ${esc(s.name)}:</p><p>Todos los firmantes firmaron <strong>${esc(x.title)}</strong>.</p>
       <p><a href="${esc(link)}" style="display:inline-block;background:#002b6a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Descargar documento firmado</a></p>
       <p style="color:#666;font-size:12px">Adjuntamos el PDF firmado: trae la estampa de cada firma y el certificado con la huella SHA-256 y el registro de eventos.</p></div>`, attachments);
    event(db, x.id, s.id, r.ok ? "aviso_final_enviado" : "aviso_final_no_enviado", r.ok ? s.email : r.detail);
  }
  const owner = x.created_by && db.prepare("SELECT email, name FROM users WHERE id = ?").get(x.created_by);
  if (owner?.email) {
    const r = await sendEmail(owner.email, subject, `Todos los firmantes firmaron "${x.title}". Adjuntamos una copia del documento firmado; también está en TecjuridicosApp → Firmas.`,
      `<p>Todos los firmantes firmaron <strong>${esc(x.title)}</strong>. Adjuntamos una copia del documento firmado; también está en TecjuridicosApp → Firmas.</p>`, attachments);
    event(db, x.id, null, r.ok ? "copia_enviada_a_quien_envio" : "copia_no_enviada", r.ok ? owner.email : r.detail);
  }
}

async function notifyOwner(db, requestId, subject, text) {
  const x = db.prepare("SELECT created_by, notify FROM sign_requests WHERE id = ?").get(requestId);
  const owner = x?.notify && x.created_by && db.prepare("SELECT email FROM users WHERE id = ?").get(x.created_by);
  if (owner?.email) await sendEmail(owner.email, subject, text, `<p>${esc(text)}</p>`);
}

const requestOut = (db, r) => {
  const signers = db.prepare(`SELECT id, name, id_type, id_number, email, phone, status, method, signed_at, ip, user_agent, typed_name,
      signature_png, reject_reason, otp_sent_at, otp_channel FROM sign_signers WHERE request_id = ? ORDER BY id`).all(r.id).map((x) => ({ ...x }));
  const events = db.prepare("SELECT * FROM sign_events WHERE request_id = ? ORDER BY id").all(r.id).map((x) => ({ ...x }));
  const { doc_file, signed_pdf, ...rest } = r;
  return { ...rest, has_pdf: !!doc_file, has_signed_pdf: !!signed_pdf, signers, events };
};

/**
 * The signed PDF is built once, when everybody has signed, and kept with its
 * SHA-256: every copy (e-mail, app, signer page) is byte-for-byte the same, so
 * the verification page can tell whether a file is exactly the signed one.
 */
async function ensureSignedPdf(db, req, requestId) {
  let x = db.prepare("SELECT * FROM sign_requests WHERE id = ?").get(requestId);
  if (!x || x.status !== "completada") return null;
  if (x.signed_pdf) return { pdf: Buffer.from(x.signed_pdf), sha256: x.signed_sha256 };
  if (!x.verify_code) {
    db.prepare("UPDATE sign_requests SET verify_code = ? WHERE id = ?").run(newVerifyCode(), x.id);
    x = db.prepare("SELECT * FROM sign_requests WHERE id = ?").get(requestId);
  }
  const full = { ...requestOut(db, x), doc_text: x.doc_text, verify_url: `${publicUrl(req)}/verificar.html` };
  const pdf = await buildSignedPdf(full, x.doc_file ? Buffer.from(x.doc_file) : null);
  const hash = sha(pdf);
  db.prepare("UPDATE sign_requests SET signed_pdf = ?, signed_sha256 = ? WHERE id = ? AND signed_pdf IS NULL").run(pdf, hash, x.id);
  event(db, x.id, null, "pdf_firmado_generado", `SHA-256 ${hash}`);
  const kept = db.prepare("SELECT signed_pdf, signed_sha256 FROM sign_requests WHERE id = ?").get(x.id);
  return { pdf: Buffer.from(kept.signed_pdf), sha256: kept.signed_sha256 };
}
const signedName = (title) => `${String(title).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w .-]+/g, "").trim().slice(0, 80) || "documento"} - firmado.pdf`;

/** Marks the request complete when nobody is pending; returns true then (the caller sends the e-mail notices). */
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
    return true;
  }
  return false;
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
    const signers = Array.isArray(b.signers) ? b.signers.map((s) => ({ name: str(s.name), id_type: str(s.id_type) || "CC", id_number: str(s.id_number),
      email: str(s.email).toLowerCase(), phone: str(s.phone), otp_channel: CHANNELS.includes(s.otp_channel) ? s.otp_channel : "email" })) : [];
    if (!signers.length || signers.length > 10) return res.status(400).json({ error: "Agregue entre 1 y 10 firmantes." });
    const remote = b.mode !== "presencial";
    const problem = signersProblem(signers, { remote });
    if (problem) return res.status(400).json({ error: problem.message, field: problem.field, index: problem.index });
    for (const s of signers) {
      if (remote && s.otp_channel !== "email" && !channelReady(s.otp_channel)) {
        return res.status(400).json({ error: `El servidor aún no tiene configurado el envío por ${CHANNEL_LABEL[s.otp_channel]}. Use correo o configure el canal.` });
      }
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
    const stampPage = /^(last|first|all|new|\d{1,3})$/.test(str(b.stamp_page)) ? str(b.stamp_page) : "last";
    const stampPos = ["br", "bc", "bl", "tr", "tl"].includes(b.stamp_pos) ? b.stamp_pos : "br";
    const id = db.prepare(`INSERT INTO sign_requests (title, case_id, office_id, doc_kind, doc_text, doc_file, doc_name, doc_hash, message, created_by, stamp_page, stamp_pos, notify, verify_code, mail_opts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(title, Number(b.case_id) || null, officeId, kind, text, file, str(b.doc_name), hash, str(b.message), req.user.id,
      stampPage, stampPos, b.notify === false ? 0 : 1, newVerifyCode(), JSON.stringify(mailOptions(b.mail))).lastInsertRowid;
    event(db, id, null, "creada", `${req.user.name} · SHA-256 ${hash}`, clientIp(req));
    const ins = db.prepare("INSERT INTO sign_signers (request_id, name, id_type, id_number, email, phone, token_hash, otp_channel) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const delivery = [];
    for (const s of signers) {
      const token = randomBytes(24).toString("base64url");
      const sid = ins.run(id, s.name, s.id_type, s.id_number, s.email, s.phone, sha(token), s.otp_channel).lastInsertRowid;
      if (remote) delivery.push(await sendLink(db, req, { id, title, message: str(b.message) }, { id: sid, ...s }, token));
    }
    res.status(201).json({ ...requestOut(db, db.prepare("SELECT * FROM sign_requests WHERE id = ?").get(id)), delivery });
  });

  r.get("/:id/signed", async (req, res) => {
    const x = get(req, Number(req.params.id));
    if (!x || x.status !== "completada") return res.status(400).json({ error: "El documento aún no está firmado por todos." });
    const out = await ensureSignedPdf(db, req, x.id);
    res.json({ filename: signedName(x.title), sha256: out.sha256, base64: out.pdf.toString("base64") });
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
    const done = finishIfDone(db, x.id);
    res.json(requestOut(db, db.prepare("SELECT * FROM sign_requests WHERE id = ?").get(x.id)));
    (done ? notifyCompleted(db, req, x.id) : notifySigned(db, x.id, s.name)).catch((err) => console.error("esign notice:", err.message));
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
  const view = ({ s, x }) => {
    const v = {
      title: x.title, message: x.message, doc_kind: x.doc_kind, doc_text: x.doc_text, doc_name: x.doc_name, doc_hash: x.doc_hash,
      request_status: x.status,
      signer: { name: s.name, id_type: s.id_type, id_number: s.id_number, email: maskEmail(s.email), phone: maskPhone(s.phone), status: s.status, signed_at: s.signed_at,
        otp_channel: s.otp_channel, otp_channels: otpChannels(s) },
    };
    // A client of the firm answers the data policies, each on its own, together with the signature.
    const ask = s.status === "pendiente" && x.status === "enviada" ? policiesFor(db, x, s) : null;
    if (ask) v.consent = { items: ask.items, version: legalVersion().name };
    // Once everybody signed, the signer can download the signed document (stamps + certificate).
    if (x.status === "completada") {
      // Only names and dates of the others: their documents, IPs and signatures are in the signed PDF itself (audit A01-002).
      v.signed = {
        id: x.id, title: x.title, status: x.status, completed_at: x.completed_at, doc_hash: x.doc_hash,
        signers: db.prepare("SELECT name, status, signed_at FROM sign_signers WHERE request_id = ? ORDER BY id").all(x.id).map((o) => ({ ...o })),
      };
    }
    return v;
  };

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

  r.get("/:token/signed", async (req, res) => {
    const f = bySigner(req.params.token);
    if (!f || f.x.status !== "completada") return res.status(400).json({ error: "El documento aún no está firmado por todos." });
    const out = await ensureSignedPdf(db, req, f.x.id);
    res.json({ filename: signedName(f.x.title), sha256: out.sha256, base64: out.pdf.toString("base64") });
  });

  r.post("/:token/otp", async (req, res) => {
    const f = bySigner(req.params.token);
    if (!f || f.s.status !== "pendiente" || f.x.status !== "enviada") return res.status(400).json({ error: "Este documento ya no está pendiente de su firma." });
    if (f.s.otp_sent_at && Date.parse(f.s.otp_sent_at.replace(" ", "T") + "Z") > Date.now() - 60000) return res.status(429).json({ error: "Espere un minuto antes de pedir otro código." });
    const allowed = otpChannels(f.s);
    const channel = allowed.includes(req.body?.channel) ? req.body.channel : allowed.includes(f.s.otp_channel) ? f.s.otp_channel : allowed[0];
    if (!channel) return res.status(400).json({ error: "No hay un medio disponible para enviarle el código. Avise a quien le envió el documento." });
    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    db.prepare(`UPDATE sign_signers SET otp_hash = ?, otp_expires_at = datetime('now', '+${OTP_MINUTES} minutes'), otp_sent_at = datetime('now'), otp_attempts = 0, otp_channel = ? WHERE id = ?`)
      .run(sha(`${f.s.id}:${code}`), channel, f.s.id);
    const text = `TecjuridicosApp: su código para firmar "${f.x.title.slice(0, 60)}" es ${code}. Vence en ${OTP_MINUTES} minutos. No lo comparta.`;
    const out = await deliver(channel, f.s, `Código para firmar: ${code}`, text,
      `<p>Su código para firmar <strong>${esc(f.x.title)}</strong> es:</p><p style="font-size:28px;letter-spacing:6px;font-weight:bold">${code}</p><p>Vence en ${OTP_MINUTES} minutos. No lo comparta.</p>`, code);
    const to = channel === "email" ? maskEmail(f.s.email) : maskPhone(f.s.phone);
    event(db, f.x.id, f.s.id, out.ok ? "codigo_enviado" : "codigo_no_enviado", out.ok ? `${CHANNEL_LABEL[channel]} ${to}` : out.detail, clientIp(req));
    if (!out.ok) return res.status(502).json({ error: `No se pudo enviar el código por ${CHANNEL_LABEL[channel]}. Pruebe otro medio o avise a quien le envió el documento.` });
    res.json({ sent: true, minutes: OTP_MINUTES, channel, to });
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
    const ask = policiesFor(db, f.x, s), client = ask?.client;
    let consents = null;
    if (ask) {
      try { consents = signConsentAnswers(b.consents, ask.items); } catch (err) { return res.status(400).json({ error: err.message }); }
    }
    db.prepare(`UPDATE sign_signers SET status = 'firmado', method = 'enlace_otp', signed_at = datetime('now'), ip = ?, user_agent = ?,
      typed_name = ?, signature_png = ?, otp_hash = NULL WHERE id = ?`)
      .run(clientIp(req), String(req.get("user-agent") || "").slice(0, 300), str(b.typed_name), b.signature_png, s.id);
    const via = s.otp_channel === "email" ? `correo ${s.email}` : `${CHANNEL_LABEL[s.otp_channel]} ${maskPhone(s.phone)}`;
    event(db, f.x.id, s.id, "firmado", `OTP verificado por ${via} · SHA-256 ${f.x.doc_hash}`, clientIp(req));
    if (consents) {
      const recs = recordConsents(db, client, consents, { method: "firma", ip: clientIp(req), user_agent: req.get("user-agent"), typed_name: b.typed_name,
        typed_id: s.id_number, note: `Firma de «${f.x.title}» (solicitud N.º ${f.x.id})` });
      event(db, f.x.id, s.id, "politicas_respondidas", recs.map((x) => `${x.item}: ${x.granted ? "sí" : "no"}`).join(" · "), clientIp(req));
    }
    const done = finishIfDone(db, f.x.id);
    res.json(view(bySigner(req.params.token)));
    (done ? notifyCompleted(db, req, f.x.id) : notifySigned(db, f.x.id, s.name)).catch((err) => console.error("esign notice:", err.message));
  });

  r.post("/:token/reject", (req, res) => {
    const f = bySigner(req.params.token);
    if (!f || f.s.status !== "pendiente" || f.x.status !== "enviada") return res.status(400).json({ error: "Este documento ya no está pendiente." });
    db.prepare("UPDATE sign_signers SET status = 'rechazado', reject_reason = ? WHERE id = ?").run(str(req.body?.reason).slice(0, 500), f.s.id);
    db.prepare("UPDATE sign_requests SET status = 'rechazada' WHERE id = ?").run(f.x.id);
    event(db, f.x.id, f.s.id, "rechazado", str(req.body?.reason).slice(0, 500), clientIp(req));
    notifyOwner(db, f.x.id, `No firmó: ${f.x.title}`, `${f.s.name} decidió no firmar "${f.x.title}"${str(req.body?.reason) ? `: ${str(req.body.reason).slice(0, 300)}` : ""}.`).catch((err) => console.error("esign notice:", err.message));
    res.json(view(bySigner(req.params.token)));
  });

  return r;
}

/**
 * Public verification (no session). The page computes the SHA-256 of the file in the
 * visitor's browser (the file is never uploaded) and asks whether it matches:
 * the signed PDF kept here, or the original document that was signed. The code
 * printed at the foot of every page finds the request without the file.
 */
export function verifyRouter(db) {
  const r = express.Router();
  const describe = (x, match) => ({
    match, title: x.title, status: x.status, created_at: x.created_at, completed_at: x.completed_at, verify_code: x.verify_code,
    doc_hash: x.doc_hash, signed_sha256: x.signed_sha256 || null,
    signers: db.prepare("SELECT name, id_type, id_number, status, method, otp_channel, signed_at FROM sign_signers WHERE request_id = ? ORDER BY id").all(x.id)
      .map((s) => ({ ...s, id_number: s.id_number ? `•••${String(s.id_number).replace(/\D/g, "").slice(-3)}` : "" })),
  });
  const tries = new Map();
  r.post("/", (req, res) => {
    // A few lookups per minute per address: codes cannot be guessed by brute force.
    const ip = clientIp(req), now = Date.now();
    const t = (tries.get(ip) || []).filter((x) => x > now - 60000);
    if (t.length >= 20) return res.status(429).json({ error: "Demasiadas consultas. Espere un minuto." });
    tries.set(ip, [...t, now]);
    // The map never grows without limit: old addresses are dropped (audit A06-002).
    if (tries.size > 5000) for (const [k, v] of tries) if (!v.some((x) => x > now - 60000)) tries.delete(k);
    const hash = String(req.body?.sha256 || "").toLowerCase();
    const code = normVerifyCode(req.body?.code);
    if (/^[0-9a-f]{64}$/.test(hash)) {
      const signed = db.prepare("SELECT * FROM sign_requests WHERE signed_sha256 = ?").get(hash);
      if (signed) return res.json(describe(signed, "firmado"));
      const original = db.prepare("SELECT * FROM sign_requests WHERE doc_hash = ? ORDER BY id DESC").get(hash);
      if (original) return res.json(describe(original, "original"));
      return res.json({ match: "ninguno" });
    }
    if (/^[0-9A-Z]{5}-[0-9A-Z]{5}$/.test(code)) {
      const x = db.prepare("SELECT * FROM sign_requests WHERE verify_code = ?").get(code);
      return x ? res.json(describe(x, "codigo")) : res.json({ match: "ninguno" });
    }
    res.status(400).json({ error: "Cargue el archivo o escriba el código de verificación." });
  });
  return r;
}

export { sha };
