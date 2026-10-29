import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { startServer } from "./helpers.js";
import { setTransports } from "../src/notify.js";
import { setMailTransport } from "../src/mailtrace.js";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
let srv, admin;
const mails = [];
before(async () => {
  process.env.SMTP_HOST = "smtp.test"; process.env.MAIL_FROM = "notificaciones@firma.co";
  setTransports({ mail: { sendMail: async (m) => { mails.push(m); return { messageId: "<x@test>" }; } } });
  srv = await startServer();
  admin = await srv.setup();
});
after(() => srv.close());

const pub = async (method, path, body) => {
  const res = await fetch(srv.base + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test("e-signature by link + e-mailed OTP, with evidence and audit trail", async () => {
  const text = "# PODER ESPECIAL\n\nOtorgo poder…";
  assert.equal((await admin.call("POST", "/esign", { title: "Poder", doc_text: text, signers: [{ name: "Ana", email: "mal" }] })).status, 400);
  const r = await admin.call("POST", "/esign", { title: "Poder especial", doc_text: text, message: "Por favor firme.", signers: [
    { name: "Ana Pérez", id_number: "52.123.456", email: "ana@cliente.co" }, { name: "Luis Rojas", email: "luis@cliente.co" }] });
  assert.equal(r.status, 201);
  assert.equal(r.body.doc_hash, sha(text));
  assert.deepEqual(r.body.delivery.map((d) => d.ok), [true, true]);
  const link = mails.find((m) => m.to === "ana@cliente.co").text.match(/firmar\.html#(\S+)/)[1];

  const v = await pub("GET", `/public/sign/${link}`);
  assert.equal(v.body.signer.name, "Ana Pérez");
  assert.equal(v.body.signer.email, "an•••@cliente.co");
  assert.equal((await pub("GET", "/public/sign/no-existe")).status, 404);

  assert.equal((await pub("POST", `/public/sign/${link}/sign`, { otp: "000000", typed_name: "Ana", accept: true, signature_png: PNG })).status, 400, "no code yet");
  assert.equal((await pub("POST", `/public/sign/${link}/otp`, {})).status, 200);
  assert.equal((await pub("POST", `/public/sign/${link}/otp`, {})).status, 429, "one code per minute");
  const code = mails.at(-1).subject.match(/(\d{6})/)[1];
  assert.equal((await pub("POST", `/public/sign/${link}/sign`, { otp: "999999", typed_name: "Ana", accept: true, signature_png: PNG })).status, 400);
  assert.equal((await pub("POST", `/public/sign/${link}/sign`, { otp: code, typed_name: "Ana", accept: false, signature_png: PNG })).status, 400);
  const signed = await pub("POST", `/public/sign/${link}/sign`, { otp: code, typed_name: "Ana María Pérez", accept: true, signature_png: PNG });
  assert.equal(signed.status, 200);
  assert.equal(signed.body.signer.status, "firmado");
  assert.equal((await pub("POST", `/public/sign/${link}/sign`, { otp: code, typed_name: "x", accept: true, signature_png: PNG })).status, 400, "cannot sign twice");

  // Second signer in person, witnessed by the signed-in user.
  let detail = (await admin.call("GET", `/esign/${r.body.id}`)).body;
  const luis = detail.signers.find((s) => s.name === "Luis Rojas");
  assert.equal((await admin.call("POST", `/esign/${r.body.id}/in-person/${luis.id}`, { typed_name: "Luis Rojas", accept: true })).status, 400, "needs a drawing");
  const done = await admin.call("POST", `/esign/${r.body.id}/in-person/${luis.id}`, { typed_name: "Luis Rojas", id_number: "79.1", accept: true, signature_png: PNG });
  assert.equal(done.body.status, "completada");
  detail = (await admin.call("GET", `/esign/${r.body.id}`)).body;
  assert.deepEqual(detail.signers.map((s) => [s.status, s.method]), [["firmado", "enlace_otp"], ["firmado", "presencial"]]);
  assert.ok(detail.signers[0].ip && detail.signers[0].user_agent);
  const events = detail.events.map((e) => e.event);
  for (const e of ["creada", "enlace_enviado", "abierto", "codigo_enviado", "codigo_incorrecto", "firmado", "firmado_presencial", "completada"]) assert.ok(events.includes(e), e);
  assert.ok(!(await admin.call("GET", "/notifications")).body.items.some((n) => n.title === "Documento firmado por todos"), "v2.3.0: no longer in the bell");
  assert.ok(srv.db.prepare("SELECT 1 FROM notifications WHERE title = ?").get("Documento firmado por todos") && srv.db.prepare("SELECT 1 FROM audit_log WHERE summary LIKE ?").get("Documento firmado por todos%"), "kept and logged in the Bitácora");
});

test("PDF documents, reminders replace the link, cancel and reject", async () => {
  const pdf = Buffer.from("%PDF-1.4\n% prueba\n").toString("base64");
  assert.equal((await admin.call("POST", "/esign", { title: "X", doc_pdf_base64: Buffer.from("hola").toString("base64"), signers: [{ name: "A", email: "a@b.co" }] })).status, 400);
  const r = (await admin.call("POST", "/esign", { title: "Contrato", doc_pdf_base64: pdf, doc_name: "contrato.pdf", signers: [{ name: "Pedro", email: "pedro@c.co" }] })).body;
  assert.equal(r.has_pdf, true);
  const first = mails.filter((m) => m.to === "pedro@c.co").at(-1).text.match(/firmar\.html#(\S+)/)[1];
  assert.equal((await pub("GET", `/public/sign/${first}/pdf`)).body.base64, pdf);
  await admin.call("POST", `/esign/${r.id}/remind/${r.signers[0].id}`);
  const second = mails.filter((m) => m.to === "pedro@c.co").at(-1).text.match(/firmar\.html#(\S+)/)[1];
  assert.notEqual(first, second);
  assert.equal((await pub("GET", `/public/sign/${first}`)).status, 404, "old link no longer works");
  const rej = await pub("POST", `/public/sign/${second}/reject`, { reason: "No estoy de acuerdo con la cláusula 3" });
  assert.equal(rej.body.signer.status, "rechazado");
  assert.equal((await admin.call("GET", `/esign/${r.id}`)).body.status, "rechazada");
  const c = (await admin.call("POST", "/esign", { title: "Otro", doc_text: "x", mode: "presencial", signers: [{ name: "Sin correo" }] })).body;
  assert.equal(c.delivery.length, 0, "in-person requests send no e-mail");
  assert.equal((await admin.call("POST", `/esign/${c.id}/cancel`)).body.status, "cancelada");
});

test("e-mail with traceability: hash, SMTP result, opening, acknowledgment", async () => {
  const sent = [];
  setMailTransport({ sendMail: async (m) => { sent.push(m); return { messageId: "<m1@test>", accepted: m.to, rejected: [], response: "250 OK" }; } });
  assert.equal((await admin.call("POST", "/mail", { to: "no-es-correo", subject: "x", body: "y" })).status, 400);
  const att = Buffer.from("memorial firmado").toString("base64");
  const m = await admin.call("POST", "/mail", { to: "j02lctoiba@cendoj.ramajudicial.gov.co", cc: "cliente@x.co", subject: "Radicación memorial",
    body: "Señor juez, adjunto memorial.", attachments: [{ filename: "memorial.pdf", mime: "application/pdf", base64: att }] });
  assert.equal(m.status, 201);
  assert.equal(m.body.status, "enviado");
  assert.match(m.body.smtp_response, /250 OK/);
  assert.equal(m.body.attachments[0].sha256, sha(Buffer.from("memorial firmado")));
  assert.equal(sent[0].headers["Disposition-Notification-To"], "notificaciones@firma.co");
  const token = sent[0].text.match(/acuse\.html#(\S+)/)[1];
  assert.match(sent[0].html, new RegExp(`/api/public/mail/${token}/o.png`));

  const px = await fetch(`${srv.base}/public/mail/${token}/o.png`);
  assert.equal(px.headers.get("content-type"), "image/png");
  let detail = (await admin.call("GET", `/mail/${m.body.id}`)).body;
  assert.ok(detail.opened_at);
  assert.equal(detail.confirmed_at, null);
  assert.equal((await pub("GET", `/public/mail/${token}`)).body.subject, "Radicación memorial");
  await pub("POST", `/public/mail/${token}/confirm`, { name: "Secretaría Juzgado 2" });
  detail = (await admin.call("GET", `/mail/${m.body.id}`)).body;
  assert.ok(detail.confirmed_at);
  assert.equal(detail.confirm_name, "Secretaría Juzgado 2");

  setMailTransport({ sendMail: async () => { throw new Error("connection refused"); } });
  const fail = await admin.call("POST", "/mail", { to: "a@b.co", subject: "x", body: "y" });
  assert.equal(fail.status, 502);
  assert.equal(fail.body.status, "fallido");
  assert.equal((await admin.call("GET", "/mail")).body.length, 2, "failed sends are recorded too");
});
