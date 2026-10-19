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
import { publicUrl } from "./esign.js";
import { stamp } from "./tsa.js";

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
    // "adjunto": files attached and also offered as tracked links; "enlace": only links (every download is recorded).
    let mode = b.attach_mode === "enlace" && files.length ? "enlace" : "adjunto";
    const fileDigests = files.map((f) => digests(f.data));
    const hashes = fileDigests.map((d) => d.sha256);
    const contentHash = sha(JSON.stringify({ to, cc, subject, body, attachments: hashes }));
    const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
    const fileLines = files.map((f, i) => ({ name: f.filename, size: `${kb(f.data.length)} (${f.data.length.toLocaleString("es-CO")} bytes)`, sha256: hashes[i], link: `${base}/api/public/mail/${token}/a/${i + 1}` }));
    const html = `<div style="font-family:Arial,sans-serif;color:#101010;white-space:pre-wrap">${esc(body)}</div>
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
      attachments: mode === "adjunto" ? files.map((f) => ({ filename: f.filename, content: f.data, contentType: f.mime })) : [],
    };
    let raw = Buffer.from((await composer.sendMail(mail)).message);
    // Microsoft 365 takes about 3 MB per message: larger attachments travel as tracked links.
    if (t.graph && raw.length > GRAPH_MAX_MIME && mail.attachments.length) {
      mail.attachments = [];
      mode = "enlace";
      mail.html = mail.html.replace("<strong>Anexos:</strong>", "<strong>Anexos (descárguelos con estos enlaces):</strong>");
      raw = Buffer.from((await composer.sendMail(mail)).message);
    }
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
