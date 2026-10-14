// E-mail with traceability. Each message records the SHA-256 of its content
// and attachments, the SMTP server's acceptance, the first opening (tracking
// image) and the recipient's explicit acknowledgment (a button on a page,
// so link scanners do not confirm by themselves). This is evidence of
// sending and receipt; legally "certified" e-mail requires an accredited
// provider, which can be connected later.
import express from "express";
import { createHash, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { scopeOf } from "./auth.js";
import { channelsStatus } from "./notify.js";
import { publicUrl } from "./esign.js";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const str = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// req.ip honours "trust proxy" (TRUST_PROXY=1 behind Render), so a client cannot forge it otherwise.
const clientIp = (req) => String(req.ip || req.socket.remoteAddress || "");
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const MAX_TOTAL = 15 * 1024 * 1024;
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

let transportOverride = null;
/** Tests replace the SMTP transport. */
export function setMailTransport(t) { transportOverride = t; }
function transport() {
  if (transportOverride) return transportOverride;
  if (!channelsStatus().email) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587, secure: process.env.SMTP_SECURE === "1",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

const out = (db, m) => ({
  ...m,
  attachments: db.prepare("SELECT id, filename, mime, size, sha256 FROM mail_attachments WHERE message_id = ? ORDER BY id").all(m.id).map((x) => ({ ...x })),
});

export function mailRouter(db) {
  const r = express.Router();
  const cond = (req) => {
    const sc = scopeOf(req.user);
    return sc === null ? "1 = 1" : `(office_id IN (${sc.map(Number).join(",") || "NULL"}) OR created_by = ${Number(req.user.id)})`;
  };
  const SELECT = `SELECT id, case_id, office_id, to_addr, cc, subject, body, content_hash, status, smtp_message_id, smtp_response, sent_at,
    opened_at, open_ip, open_ua, confirmed_at, confirm_ip, confirm_ua, confirm_name, created_by FROM mail_messages`;

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
    const subject = str(b.subject), body = String(b.body ?? "").trim();
    if (!subject || !body) return res.status(400).json({ error: "Escriba el asunto y el mensaje." });
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

    const token = randomBytes(24).toString("base64url");
    const base = publicUrl(req);
    const hashes = files.map((f) => sha(f.data));
    const contentHash = sha(JSON.stringify({ to, cc, subject, body, attachments: hashes }));
    const html = `<div style="font-family:Arial,sans-serif;color:#101010;white-space:pre-wrap">${esc(body)}</div>
      <hr style="margin:24px 0;border:0;border-top:1px solid #ddd">
      <p style="font-family:Arial,sans-serif;font-size:13px;color:#555">Por favor confirme que recibió este mensaje${files.length ? ` y sus ${files.length} adjunto(s)` : ""}:</p>
      <p><a href="${base}/acuse.html#${token}" style="display:inline-block;background:#002b6a;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none;font-family:Arial,sans-serif">Confirmar recibido</a></p>
      <p style="font-family:Arial,sans-serif;font-size:11px;color:#888">Huella del contenido (SHA-256): ${contentHash}</p>
      <img src="${base}/api/public/mail/${token}/o.png" width="1" height="1" alt="">`;
    const text = `${body}\n\n---\nConfirme que recibió este mensaje: ${base}/acuse.html#${token}\nHuella del contenido (SHA-256): ${contentHash}`;
    let status = "enviado", info = {}, response = "";
    try {
      info = await t.sendMail({
        from: process.env.MAIL_FROM, to, cc, subject, text, html,
        headers: { "Disposition-Notification-To": process.env.MAIL_FROM || "", "Return-Receipt-To": process.env.MAIL_FROM || "" },
        attachments: files.map((f) => ({ filename: f.filename, content: f.data, contentType: f.mime })),
      });
      response = `${info.response || ""} aceptados: ${(info.accepted || []).join(", ")} rechazados: ${(info.rejected || []).join(", ")}`.trim();
      if ((info.rejected || []).length && !(info.accepted || []).length) status = "fallido";
    } catch (err) {
      status = "fallido";
      response = `Error SMTP: ${err.message}`;
    }
    const id = db.prepare(`INSERT INTO mail_messages (case_id, office_id, to_addr, cc, subject, body, content_hash, token_hash, status, smtp_message_id, smtp_response, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(Number(b.case_id) || null, officeId, to.join(", "), cc.join(", "), subject, body, contentHash, sha(token),
      status, String(info.messageId || ""), response.slice(0, 1000), req.user.id).lastInsertRowid;
    const ins = db.prepare("INSERT INTO mail_attachments (message_id, filename, mime, size, sha256, data) VALUES (?, ?, ?, ?, ?, ?)");
    files.forEach((f, i) => ins.run(id, f.filename, f.mime, f.data.length, hashes[i], f.data));
    const m = out(db, db.prepare(`${SELECT} WHERE id = ?`).get(id));
    res.status(status === "enviado" ? 201 : 502).json(status === "enviado" ? m : { ...m, error: `No se pudo enviar: ${response}` });
  });

  return r;
}

/** Public routes: tracking image and the acknowledgment page's API. */
export function mailPublicRouter(db) {
  const r = express.Router();
  const find = (token) => db.prepare("SELECT * FROM mail_messages WHERE token_hash = ?").get(sha(String(token || "")));

  r.get("/:token/o.png", (req, res) => {
    const m = find(req.params.token);
    if (m && !m.opened_at) {
      db.prepare("UPDATE mail_messages SET opened_at = datetime('now'), open_ip = ?, open_ua = ? WHERE id = ?")
        .run(clientIp(req), String(req.get("user-agent") || "").slice(0, 300), m.id);
    }
    res.set({ "Content-Type": "image/png", "Cache-Control": "no-store" }).send(PIXEL);
  });

  r.get("/:token", (req, res) => {
    const m = find(req.params.token);
    if (!m) return res.status(404).json({ error: "El enlace no es válido." });
    res.json({ subject: m.subject, sent_at: m.sent_at, to: m.to_addr, content_hash: m.content_hash, confirmed_at: m.confirmed_at,
      attachments: db.prepare("SELECT filename, size, sha256 FROM mail_attachments WHERE message_id = ?").all(m.id).map((x) => ({ ...x })) });
  });

  r.post("/:token/confirm", (req, res) => {
    const m = find(req.params.token);
    if (!m) return res.status(404).json({ error: "El enlace no es válido." });
    if (!m.confirmed_at) {
      db.prepare("UPDATE mail_messages SET confirmed_at = datetime('now'), confirm_ip = ?, confirm_ua = ?, confirm_name = ? WHERE id = ?")
        .run(clientIp(req), String(req.get("user-agent") || "").slice(0, 300), str(req.body?.name).slice(0, 120), m.id);
      if (m.created_by) {
        db.prepare("INSERT INTO notifications (user_id, kind, title, body, link) VALUES (?, 'acuse', ?, ?, '#correo')")
          .run(m.created_by, "Acuse de recibo confirmado", `${m.to_addr} · ${m.subject}`);
      }
    }
    res.json({ confirmed_at: find(req.params.token).confirmed_at });
  });

  return r;
}
