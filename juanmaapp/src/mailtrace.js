// E-mail with traceability. Each message keeps the exact bytes sent (.eml)
// with SHA-1, SHA-256, SHA-512 and SHA3-512 digests, the same digests and the
// size of every attachment, the SMTP server's acceptance, every opening
// (tracking image), every download of an attachment through its link, and the
// recipient's explicit acknowledgment (a button on a page, so link scanners do
// not confirm by themselves), each with exact UTC time, IP and browser. With
// TSA_URL the message digest gets an RFC 3161 trusted timestamp. This is
// evidence of sending and receipt; legally "certified" e-mail requires an
// accredited provider (ONAC), which can be connected later.
import express from "express";
import { str } from "./http.js";
import { createHash, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { scopeOf } from "./auth.js";
import { mailTransport, GRAPH_MAX_MIME } from "./notify.js";
import { publicUrl, issueLetterSignature } from "./esign.js";
import { qrPng } from "./qr-png.js";
import { stamp } from "./tsa.js";
import { readFileSync } from "node:fs";
import { onedriveBlock } from "./onedrive-link.js";
import { buildLetter, letterMissing, signerView, stampTime } from "./solicitud-link-letter.js";
import { buildCartaMail, cartaMissing } from "./carta-firma-mail.js";

// Version 2.2.83: the signature picture of «Solicitar link de expediente», sent inline (cid) so mail programs show it.
const PUBLIC = (f) => new URL(`../public/${f}`, import.meta.url);

const sha = (b) => createHash("sha256").update(b).digest("hex");
const digests = (b) => ({ sha1: createHash("sha1").update(b).digest("hex"), sha256: sha(b),
  sha512: createHash("sha512").update(b).digest("hex"), sha3_512: createHash("sha3-512").update(b).digest("hex") });
// Exact time with milliseconds (UTC), from the server clock (keep it synchronized with NTP).
const nowMs = () => new Date().toISOString().replace("T", " ").replace("Z", "");
function mailEvent(db, messageId, event, detail = "", req = null) {
  db.prepare("INSERT INTO mail_events (message_id, at, event, detail, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)")
    .run(messageId, nowMs(), event, String(detail).slice(0, 1000), req ? clientIp(req) : "", req ? String(req.get("user-agent") || "").slice(0, 300) : "");
}
// Builds the MIME message once, so the bytes hashed are exactly the bytes handed to the SMTP server.
const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows" });
const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// req.ip honours "trust proxy" (TRUST_PROXY=1 behind Render), so a client cannot forge it otherwise.
const clientIp = (req) => String(req.ip || req.socket.remoteAddress || "");
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const MAX_TOTAL = 15 * 1024 * 1024;
// Version 2.3.6: the PDF the sender signs may weigh up to this much (it travels as an attachment or, when the mail server cannot take it, as a tracked download link).
export const MAX_SIGN_PDF = 30 * 1024 * 1024;
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

let transportOverride = null;
/** Tests replace the SMTP transport. */
export function setMailTransport(t) { transportOverride = t; }
function transport() {
  return transportOverride || mailTransport();
}

const out = (db, m) => ({
  ...m,
  from: process.env.MAIL_FROM || "",
  attachments: db.prepare("SELECT id, filename, mime, size, sha1, sha256, sha512, sha3_512 FROM mail_attachments WHERE message_id = ? ORDER BY id").all(m.id).map((x) => ({ ...x })),
  events: db.prepare("SELECT at, event, detail, ip, user_agent FROM mail_events WHERE message_id = ? ORDER BY id").all(m.id).map((x) => ({ ...x })),
});

export function mailRouter(db) {
  const r = express.Router();
  const cond = (req) => {
    const sc = scopeOf(req.user);
    return sc === null ? "1 = 1" : `(office_id IN (${sc.map(Number).join(",") || "NULL"}) OR created_by = ${Number(req.user.id)})`;
  };
  const SELECT = `SELECT id, case_id, office_id, to_addr, cc, subject, body, content_hash, status, smtp_message_id, smtp_response, sent_at, sent_at_ms,
    opened_at, open_ip, open_ua, confirmed_at, confirm_ip, confirm_ua, confirm_name, created_by, raw_sha1, raw_sha256, raw_sha512, raw_sha3_512,
    length(raw) AS raw_size, attach_mode, tsa_url, tsa_time, tsa_detail, tsa_reply IS NOT NULL AS has_tsa FROM mail_messages`;

  r.get("/status", (req, res) => res.json({ configured: !!transport(), from: process.env.MAIL_FROM || "" }));

  r.get("/", (req, res) => {
    const caseFilter = req.query.caseId ? `AND case_id = ${Number(req.query.caseId)}` : "";
    res.json(db.prepare(`${SELECT} WHERE ${cond(req)} ${caseFilter} ORDER BY id DESC LIMIT 300`).all().map((m) => out(db, m)));
  });

  r.get("/:id", (req, res) => {
    const m = db.prepare(`${SELECT} WHERE id = ? AND ${cond(req)}`).get(Number(req.params.id));
    if (!m) return res.status(404).json({ error: "El correo no existe." });
    res.json(out(db, m));
  });

  r.post("/", async (req, res) => {
    const t = transport();
    if (!t) return res.status(400).json({ error: "El servidor no tiene configurado el correo (SMTP). Pida a Gerencia que lo configure." });
    const b = req.body ?? {};
    const to = str(b.to).split(/[,;\s]+/).filter(Boolean);
    const cc = str(b.cc).split(/[,;\s]+/).filter(Boolean);
    if (!to.length || [...to, ...cc].some((a) => !EMAIL.test(a))) return res.status(400).json({ error: "Revise las direcciones de correo." });
    // Version 2.2.83: a letter built here from its data (escaped). Version 2.2.91: the firm's letterhead and the platform's electronic signature
    // (the sender signs; a verification code and QR that verificar.html answers), issued after the checks and before the message goes out.
    let letter = null, letterSigner = null, letterPdf = null;
    if (b.letter) {
      if (b.letter.kind !== "solicitud_link") return res.status(400).json({ error: "Carta no válida." });
      letterSigner = signerView(req.user);
      const missing = letterMissing(b.letter.fields ?? {}, letterSigner);
      if (missing.length) return res.status(400).json({ error: `Falta: ${missing.join(", ")}.` });
      // The page makes the letter's PDF (the firm's design); the platform signs exactly that file.
      letterPdf = Buffer.from(String(b.letter.pdf_base64 || ""), "base64");
      if (letterPdf.length < 1000 || letterPdf.length > 8 * 1024 * 1024 || letterPdf.subarray(0, 5).toString("latin1") !== "%PDF-") return res.status(400).json({ error: "Falta el PDF de la carta." });
      letter = buildLetter(b.letter.fields, { signer: letterSigner });
    }
    // Version 2.2.97: any PDF of the office, signed by the sender with the platform's stamp where they marked it, and sent to one or more recipients.
    let signDoc = null, cartaData = null, cartaMail = null;
    if (b.sign && !letter) {
      letterSigner = signerView(req.user);
      const missing = [!letterSigner.name && "su nombre completo (Usuarios)", !letterSigner.id_number && "su cédula (Usuarios)"].filter(Boolean);
      if (missing.length) return res.status(400).json({ error: `Para firmar falta: ${missing.join(", ")}.` });
      const pdf = Buffer.from(String(b.sign.pdf_base64 || ""), "base64");
      if (pdf.length < 100 || pdf.length > MAX_SIGN_PDF || pdf.subarray(0, 5).toString("latin1") !== "%PDF-") return res.status(400).json({ error: pdf.length > MAX_SIGN_PDF ? `El PDF pesa ${(pdf.length / 1048576).toFixed(1)} MB y el máximo es 30 MB.` : "Falta el PDF o no es válido." });
      // Version 2.3.13: with the letter of the dialog, the e-mail carries the letter itself (HTML/CSS) and not a plain message.
      if (b.sign.carta && typeof b.sign.carta === "object") {
        const miss = cartaMissing(b.sign.carta);
        if (miss.length) return res.status(400).json({ error: `Falta en la carta: ${miss.join(", ")}.` });
        cartaData = b.sign.carta;
      }
      signDoc = { pdf, name: str(b.sign.filename).replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120) || "documento" };
    }
    let subject = letter ? letter.subject : str(b.subject), body = letter ? letter.text : String(b.body ?? "").trim();
    if (!subject || (!body && !cartaData)) return res.status(400).json({ error: "Escriba el asunto y el mensaje." });
    // Version 2.3.7: a OneDrive link (with the steps to open it) for files too big to attach; it goes inside the message and is part of what is hashed.
    let od = null;
    try { od = onedriveBlock(b.onedrive); } catch (err) { return res.status(400).json({ error: err.message }); }
    const files = (Array.isArray(b.attachments) ? b.attachments : []).map((a) => ({
      filename: str(a.filename).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 150) || "adjunto", mime: str(a.mime) || "application/octet-stream",
      data: Buffer.from(String(a.base64 || ""), "base64"),
    }));
    if (files.reduce((n, f) => n + f.data.length, 0) > MAX_TOTAL) return res.status(400).json({ error: "Los adjuntos suman más de 15 MB." });
    let officeId = null;
    if (b.case_id) {
      const k = db.prepare("SELECT office_id FROM cases WHERE id = ?").get(Number(b.case_id));
      const sc = scopeOf(req.user);
      if (!k || (sc !== null && !sc.includes(k.office_id))) return res.status(404).json({ error: "El expediente no existe." });
      officeId = k.office_id;
    }
    officeId ||= req.user.offices[0]?.id ?? null;
    let letterQr = null, signedPdf = null;
    const cartaImgs = { logo: "cid:carta-logo", qr: "cid:carta-qr", globo: "cid:carta-globo", ubicacion: "cid:carta-ubicacion" };
    if (signDoc) {
      const sig = await issueLetterSignature(db, req, { title: subject, pdf: signDoc.pdf, stampPos: b.sign.stamp_pos, stampPage: str(b.sign.stamp_page), caseId: Number(b.case_id) || null, officeId,
        signer: letterSigner, docName: `${signDoc.name}.pdf`, message: "Documento firmado y enviado por correo desde la plataforma" });
      // The signed PDF is a normal attachment: attached when the mail server takes it, otherwise offered as a tracked download link (below).
      files.push({ filename: `${signDoc.name} - firmada.pdf`, mime: "application/pdf", data: sig.signed.pdf });
      if (cartaData) {
        letterQr = qrPng(`${publicUrl(req)}/verificar.html#${sig.code}`);
        cartaMail = buildCartaMail(cartaData, { signer: letterSigner, imgs: cartaImgs, stamp: { code: sig.code, signed_at: stampTime(), qrSrc: "cid:firma-qr" } });
        body = cartaMail.text;
      }
    }
    if (letter) {
      const sig = await issueLetterSignature(db, req, { title: subject, pdf: letterPdf, stampPos: b.letter.stamp_pos, caseId: Number(b.case_id) || null, officeId, signer: letterSigner });
      signedPdf = sig.signed.pdf;
      letterQr = qrPng(`${publicUrl(req)}/verificar.html#${sig.code}`);
      letter = buildLetter(b.letter.fields, { signer: letterSigner, imgs: { logo: "cid:carta-logo", qr: "cid:carta-qr", globo: "cid:carta-globo", ubicacion: "cid:carta-ubicacion" },
        stamp: { code: sig.code, signed_at: stampTime(), qrSrc: "cid:firma-qr" } });
      body = letter.text;
    }

    const token = randomBytes(24).toString("base64url");
    const base = publicUrl(req);
    // "adjunto": files attached and also offered as tracked links; "enlace": only links (every download is recorded).
    let mode = b.attach_mode === "enlace" && files.length ? "enlace" : "adjunto";
    const fileDigests = files.map((f) => digests(f.data));
    const hashes = fileDigests.map((d) => d.sha256);
    const userBody = body;
    if (od) body = `${body}\n\n${od.text}`;
    const contentHash = sha(JSON.stringify({ to, cc, subject, body, attachments: hashes }));
    const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
    const fileLines = files.map((f, i) => ({ name: f.filename, size: `${kb(f.data.length)} (${f.data.length.toLocaleString("es-CO")} bytes)`, sha256: hashes[i], link: `${base}/api/public/mail/${token}/a/${i + 1}` }));
    const html = `${letter ? letter.html : cartaMail ? cartaMail.html : `<div style="font-family:Arial,sans-serif;color:#101010;white-space:pre-wrap">${esc(userBody)}</div>`}
      ${od ? od.html : ""}
      ${files.length ? `<p style="font-family:Arial,sans-serif;font-size:13px;margin-top:18px"><strong>Anexos${mode === "enlace" ? " (descárguelos con estos enlaces)" : ""}:</strong></p>
      <ul style="font-family:Arial,sans-serif;font-size:13px">${fileLines.map((f) => `<li><a href="${f.link}">${esc(f.name)}</a> · ${f.size}<br><span style="font-size:11px;color:#888">SHA-256 ${f.sha256}</span></li>`).join("")}</ul>` : ""}
      <hr style="margin:24px 0;border:0;border-top:1px solid #ddd">
      <p style="font-family:Arial,sans-serif;font-size:13px;color:#555">Por favor confirme que recibió este mensaje${files.length ? ` y sus ${files.length} anexo(s)` : ""}:</p>
      <p><a href="${base}/acuse.html#${token}" style="display:inline-block;background:#002b6a;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none;font-family:Arial,sans-serif">Confirmar recibido</a></p>
      <p style="font-family:Arial,sans-serif;font-size:11px;color:#888">Huella del contenido (SHA-256): ${contentHash}</p>
      <img src="${base}/api/public/mail/${token}/o.png" width="1" height="1" alt="">`;
    const text = `${body}${files.length ? `\n\nAnexos:\n${fileLines.map((f) => `- ${f.name} · ${f.size} · SHA-256 ${f.sha256}\n  ${f.link}`).join("\n")}` : ""}\n\n---\nConfirme que recibió este mensaje: ${base}/acuse.html#${token}\nHuella del contenido (SHA-256): ${contentHash}`;
    const mail = {
      from: process.env.MAIL_FROM, to, cc, subject, text, html,
      headers: { "Disposition-Notification-To": process.env.MAIL_FROM || "", "Return-Receipt-To": process.env.MAIL_FROM || "" },
      attachments: [...(letter || cartaMail ? [...["carta-logo", "carta-qr", "carta-globo", "carta-ubicacion"].map((n) => ({ filename: `${n}.png`, content: readFileSync(PUBLIC(`${n}.png`)), cid: n, contentType: "image/png", contentDisposition: "inline" })),
        { filename: "firma-qr.png", content: letterQr, cid: "firma-qr", contentType: "image/png", contentDisposition: "inline" },
        ...(letter ? [{ filename: "Solicitud link expediente - firmada.pdf", content: signedPdf, contentType: "application/pdf" }] : [])] : []),
        ...(mode === "adjunto" ? files.map((f) => ({ filename: f.filename, content: f.data, contentType: f.mime })) : [])],
    };
    let raw = Buffer.from((await composer.sendMail(mail)).message);
    // Microsoft 365 takes about 3 MB per message: larger attachments travel as tracked links.
    if (t.graph && raw.length > GRAPH_MAX_MIME && mail.attachments.length) {
      mail.attachments = mail.attachments.filter((a) => a.cid || (letter && String(a.filename).endsWith("firmada.pdf")));
      mode = "enlace";
      mail.html = mail.html.replace("<strong>Anexos:</strong>", "<strong>Anexos (descárguelos con estos enlaces):</strong>");
      raw = Buffer.from((await composer.sendMail(mail)).message);
    }
    if (t.graph && raw.length > GRAPH_MAX_MIME) return res.status(400).json({ error: "El mensaje supera los 3 MB que admite Microsoft 365, incluso sin anexos. Reduzca el contenido." });
    const rawDigests = digests(raw);
    const messageId = (raw.toString("latin1").match(/^Message-ID:\s*(<[^>]+>)/im) || [])[1] || "";
    let status = "enviado", info = {}, response = "";
    const sentAt = nowMs();
    try {
      info = await t.sendMail({ envelope: { from: process.env.MAIL_FROM, to: [...to, ...cc] }, raw, ...mail, attachments: mail.attachments });
      response = `${info.response || ""} aceptados: ${(info.accepted || []).join(", ")} rechazados: ${(info.rejected || []).join(", ")}`.trim();
      if ((info.rejected || []).length && !(info.accepted || []).length) status = "fallido";
    } catch (err) {
      status = "fallido";
      response = `Error SMTP: ${err.message}`;
    }
    const ts = status === "enviado" ? await stamp(rawDigests.sha256) : { ok: false, detail: "" };
    const id = db.prepare(`INSERT INTO mail_messages (case_id, office_id, to_addr, cc, subject, body, content_hash, token_hash, status, smtp_message_id, smtp_response, created_by,
        raw, raw_sha1, raw_sha256, raw_sha512, raw_sha3_512, attach_mode, tsa_url, tsa_reply, tsa_time, tsa_detail, sent_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(Number(b.case_id) || null, officeId, to.join(", "), cc.join(", "), subject, body, contentHash, sha(token),
      status, String(info.messageId || messageId), response.slice(0, 1000), req.user.id, raw, rawDigests.sha1, rawDigests.sha256, rawDigests.sha512, rawDigests.sha3_512, mode,
      ts.url || "", ts.ok ? ts.tsr : null, ts.genTime || "", ts.detail || "", sentAt).lastInsertRowid;
    const ins = db.prepare("INSERT INTO mail_attachments (message_id, filename, mime, size, sha1, sha256, sha512, sha3_512, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    files.forEach((f, i) => ins.run(id, f.filename, f.mime, f.data.length, fileDigests[i].sha1, fileDigests[i].sha256, fileDigests[i].sha512, fileDigests[i].sha3_512, f.data));
    db.prepare("INSERT INTO mail_events (message_id, at, event, detail, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, sentAt, status === "enviado" ? "aceptado_por_servidor_smtp" : "envio_fallido", response.slice(0, 1000), clientIp(req), `Enviado por ${req.user.name}`);
    if (ts.ok) mailEvent(db, id, "sello_de_tiempo", `${ts.url} · ${ts.genTime || ""}`);
    else if (ts.detail && status === "enviado") mailEvent(db, id, "sin_sello_de_tiempo", ts.detail);
    const m = out(db, db.prepare(`${SELECT} WHERE id = ?`).get(id));
    res.status(status === "enviado" ? 201 : 502).json(status === "enviado" ? m : { ...m, error: `No se pudo enviar: ${response}` });
  });

  // The exact message sent (.eml) and the timestamp reply (.tsr), to verify the digests independently.
  r.get("/:id/eml", (req, res) => {
    const m = db.prepare(`SELECT raw, subject FROM mail_messages WHERE id = ? AND ${cond(req)}`).get(Number(req.params.id));
    if (!m?.raw) return res.status(404).json({ error: "Este correo no tiene el mensaje original guardado." });
    res.json({ filename: "mensaje-original.eml", base64: Buffer.from(m.raw).toString("base64") });
  });
  r.get("/:id/tsr", (req, res) => {
    const m = db.prepare(`SELECT tsa_reply FROM mail_messages WHERE id = ? AND ${cond(req)}`).get(Number(req.params.id));
    if (!m?.tsa_reply) return res.status(404).json({ error: "Este correo no tiene sello de tiempo." });
    res.json({ filename: "sello-de-tiempo.tsr", base64: m.tsa_reply });
  });

  return r;
}

/** Public routes: tracking image and the acknowledgment page's API. */
export function mailPublicRouter(db) {
  const r = express.Router();
  const find = (token) => db.prepare("SELECT * FROM mail_messages WHERE token_hash = ?").get(sha(String(token || "")));

  // Every opening is recorded (the first one also on the message). Mail services that load images
  // through a proxy (e.g. Gmail) show the proxy's address; the report says so.
  r.get("/:token/o.png", (req, res) => {
    const m = find(req.params.token);
    if (m) {
      if (!m.opened_at) {
        db.prepare("UPDATE mail_messages SET opened_at = datetime('now'), open_ip = ?, open_ua = ? WHERE id = ?")
          .run(clientIp(req), String(req.get("user-agent") || "").slice(0, 300), m.id);
      }
      mailEvent(db, m.id, "mensaje_abierto", "", req);
    }
    res.set({ "Content-Type": "image/png", "Cache-Control": "no-store" }).send(PIXEL);
  });

  // Attachment links: the file is served and the download recorded.
  r.get("/:token/a/:n", (req, res) => {
    const m = find(req.params.token);
    const list = m ? db.prepare("SELECT id, filename, mime, size, sha256, data FROM mail_attachments WHERE message_id = ? ORDER BY id").all(m.id) : [];
    const a = list[Number(req.params.n) - 1];
    if (!a) return res.status(404).type("text/plain").send("El anexo no existe o el enlace no es válido.");
    mailEvent(db, m.id, "anexo_descargado", `${a.filename} · ${a.size} bytes · SHA-256 ${a.sha256}`, req);
    if (m.created_by) {
      db.prepare("INSERT INTO notifications (user_id, kind, title, body, link) VALUES (?, 'acuse', ?, ?, '#correo')")
        .run(m.created_by, "Anexo descargado", `${a.filename} · ${m.to_addr}`);
    }
    res.set({ "Content-Type": a.mime, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`, "Cache-Control": "no-store" }).send(Buffer.from(a.data));
  });

  r.get("/:token", (req, res) => {
    const m = find(req.params.token);
    if (!m) return res.status(404).json({ error: "El enlace no es válido." });
    mailEvent(db, m.id, "pagina_de_acuse_abierta", "", req);
    res.json({ subject: m.subject, sent_at: m.sent_at, to: m.to_addr, content_hash: m.content_hash, confirmed_at: m.confirmed_at,
      attachments: db.prepare("SELECT filename, size, sha256 FROM mail_attachments WHERE message_id = ? ORDER BY id").all(m.id).map((x, i) => ({ ...x, n: i + 1 })) });
  });

  r.post("/:token/confirm", (req, res) => {
    const m = find(req.params.token);
    if (!m) return res.status(404).json({ error: "El enlace no es válido." });
    if (!m.confirmed_at) {
      db.prepare("UPDATE mail_messages SET confirmed_at = datetime('now'), confirm_ip = ?, confirm_ua = ?, confirm_name = ? WHERE id = ?")
        .run(clientIp(req), String(req.get("user-agent") || "").slice(0, 300), str(req.body?.name).slice(0, 120), m.id);
      mailEvent(db, m.id, "acuse_de_recibo", str(req.body?.name).slice(0, 120), req);
      if (m.created_by) {
        db.prepare("INSERT INTO notifications (user_id, kind, title, body, link) VALUES (?, 'acuse', ?, ?, '#correo')")
          .run(m.created_by, "Acuse de recibo confirmado", `${m.to_addr} · ${m.subject}`);
      }
    }
    res.json({ confirmed_at: find(req.params.token).confirmed_at });
  });

  return r;
}
