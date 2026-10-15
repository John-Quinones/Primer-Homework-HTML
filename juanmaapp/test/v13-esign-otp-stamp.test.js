import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { setTransports } from "../src/notify.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
let srv, admin;
const mails = [], sms = [];
before(async () => {
  process.env.SMTP_HOST = "smtp.test"; process.env.MAIL_FROM = "notificaciones@firma.co";
  setTransports({
    mail: { sendMail: async (m) => { mails.push(m); return { messageId: "<x@test>" }; } },
    sms: async (to, text) => { sms.push({ to, text }); return { channel: "sms", ok: true, detail: to }; },
  });
  srv = await startServer();
  admin = await srv.setup();
});
after(() => srv.close());

const pub = async (method, path, body) => {
  const res = await fetch(srv.base + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test("OTP by SMS, stamp settings, and an e-mail with the signed document to every signer", async () => {
  assert.equal((await admin.call("POST", "/esign", { title: "Poder", doc_text: "x", signers: [{ name: "Ana", email: "ana@c.co", otp_channel: "sms" }] })).status, 400, "SMS needs a phone");
  const r = await admin.call("POST", "/esign", { title: "Contrato de servicios", doc_text: "# CONTRATO\n\nTexto.", stamp_page: "new", stamp_pos: "bl",
    signers: [{ name: "Ana Pérez", email: "ana@cliente.co", phone: "300 123 4567", otp_channel: "sms" }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.stamp_page, "new");
  assert.equal(r.body.stamp_pos, "bl");
  const link = mails.find((m) => m.to === "ana@cliente.co").text.match(/firmar\.html#(\S+)/)[1];
  assert.match(mails.at(-1).text, /código de verificación por SMS/);

  const v = (await pub("GET", `/public/sign/${link}`)).body;
  assert.deepEqual(v.signer.otp_channels, ["email", "sms"]);
  assert.equal(v.signer.phone, "•••4567");
  const sent = await pub("POST", `/public/sign/${link}/otp`, { channel: "sms" });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.channel, "sms");
  assert.equal(sms.at(-1).to, "+573001234567");
  const code = sms.at(-1).text.match(/(\d{6})/)[1];
  const signed = await pub("POST", `/public/sign/${link}/sign`, { otp: code, typed_name: "Ana María Pérez", accept: true, signature_png: PNG });
  assert.equal(signed.status, 200);
  assert.equal(signed.body.request_status, "completada");
  assert.equal(signed.body.signed.signers[0].otp_channel, "sms");
  assert.equal(signed.body.signed.stamp_page, "new");

  await new Promise((ok) => setTimeout(ok, 50));
  const notice = mails.find((m) => m.to === "ana@cliente.co" && /firmado por todos/.test(m.subject));
  assert.ok(notice, "signer gets the completion e-mail");
  const fresh = notice.text.match(/firmar\.html#(\S+)/)[1];
  const after = (await pub("GET", `/public/sign/${fresh}`)).body;
  assert.ok(after.signed?.signers[0].signature_png, "fresh link opens the signed document data");
  await new Promise((ok) => setTimeout(ok, 300));
  const copy = mails.find((m) => m.to === "gerencia@firma.co" && /firmado por todos/.test(m.subject));
  assert.ok(copy?.attachments?.[0]?.content.subarray(0, 5).toString() === "%PDF-", "sender gets the signed PDF");
  assert.ok(notice.attachments?.length, "signers get it too");
  const detail = (await admin.call("GET", `/esign/${r.body.id}`)).body;
  assert.ok(detail.events.some((e) => e.event === "firmado" && /SMS/.test(e.detail)));
  assert.ok(detail.events.some((e) => e.event === "aviso_final_enviado"));
  assert.ok(detail.events.some((e) => e.event === "copia_enviada_a_quien_envio"));
});

test("verification: the signed PDF kept once, found by its SHA-256 or by the printed code; altered files do not match", async () => {
  const { createHash } = await import("node:crypto");
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  const r = (await admin.call("POST", "/esign", { title: "Pagaré", doc_text: "# PAGARÉ\n\nPagaré a la orden.", mode: "presencial", signers: [{ name: "Luis Rojas" }] })).body;
  assert.match(r.verify_code, /^[2-9A-Z]{5}-[2-9A-Z]{5}$/);
  assert.equal((await admin.call("GET", `/esign/${r.id}/signed`)).status, 400, "not signed yet");
  await admin.call("POST", `/esign/${r.id}/in-person/${r.signers[0].id}`, { typed_name: "Luis Rojas", accept: true, signature_png: PNG });
  const a = (await admin.call("GET", `/esign/${r.id}/signed`)).body;
  const b = (await admin.call("GET", `/esign/${r.id}/signed`)).body;
  assert.equal(a.base64, b.base64, "same bytes every time");
  const pdf = Buffer.from(a.base64, "base64");
  assert.equal(sha(pdf), a.sha256);
  const ok = await pub("POST", "/public/verify", { sha256: a.sha256 });
  assert.equal(ok.body.match, "firmado");
  assert.equal(ok.body.signers[0].status, "firmado");
  const altered = Buffer.from(pdf); altered[altered.length - 20] ^= 1;
  assert.equal((await pub("POST", "/public/verify", { sha256: sha(altered) })).body.match, "ninguno");
  assert.equal((await pub("POST", "/public/verify", { sha256: sha("# PAGARÉ\n\nPagaré a la orden.") })).body.match, "original");
  assert.equal((await pub("POST", "/public/verify", { code: r.verify_code.toLowerCase().replace("-", " ") })).body.match, "codigo");
  assert.ok(pdf.toString("latin1").includes(r.verify_code), "the code is printed on the pages");
});
