// Version 2.2.97: a PDF of the office signed with the platform's electronic signature (where the sender marks it) and e-mailed to several recipients.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { setMailTransport } from "../src/mailtrace.js";
import { jsPDF } from "jspdf";
import { createHash } from "node:crypto";

let srv, admin;
before(async () => {
  process.env.SMTP_HOST = "smtp.test"; process.env.MAIL_FROM = "gerencia@tecjuridicos.com"; process.env.TSA_URL = "off";
  srv = await startServer(); admin = await srv.setup();
});
after(() => { setMailTransport(null); srv.close(); });

const pdf = () => { const d = new jsPDF({ unit: "pt", format: "letter" }); d.text("Derecho de petición " + "x".repeat(900), 40, 60, { maxWidth: 500 }); d.addPage(); d.text("Página 2", 40, 60); return Buffer.from(d.output("arraybuffer")).toString("base64"); };
const to = "atencion@mineducacion.gov.co, notificaciones@fomag.gov.co; educacion@putumayo.gov.co";

test("POST /mail with sign: needs the sender's name and ID, signs at the marked spot and sends the signed PDF to every recipient", async () => {
  const sent = [];
  setMailTransport({ sendMail: async (m) => { sent.push(m); return { messageId: "<m@test>", accepted: m.to, rejected: [], response: "250 OK" }; } });
  const body = { to, subject: "Derecho de petición", body: "Adjunto derecho de petición.", sign: { pdf_base64: pdf(), filename: "Derecho de petición.pdf", stamp_page: "2", stamp_pos: "at:0.1,0.5" } };
  const noId = await admin.call("POST", "/mail", body);
  assert.equal(noId.status, 400);
  assert.match(noId.body.error, /nombre completo.*cédula/);
  srv.db.prepare("UPDATE users SET legal_name = ?, id_number = ? WHERE email = 'gerencia@firma.co'").run("John Fredy Quiñones Montaña", "17418999");
  const bad = await admin.call("POST", "/mail", { ...body, sign: { ...body.sign, pdf_base64: "AAAA" } });
  assert.equal(bad.status, 400);
  const ok = await admin.call("POST", "/mail", body);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.to_addr.split(", ").length, 3);
  const m = sent.at(-1);
  assert.equal(m.to.length, 3);
  const att = m.attachments.find((a) => a.filename === "Derecho de petición - firmada.pdf");
  assert.ok(att);
  const x = srv.db.prepare("SELECT * FROM sign_requests").get();
  assert.equal(x.status, "completada");
  assert.equal(x.stamp_page, "2");
  assert.equal(x.stamp_pos, "at:0.1,0.5");
  assert.equal(createHash("sha256").update(att.content).digest("hex"), x.signed_sha256);
  assert.notEqual(att.content.length, Buffer.from(body.sign.pdf_base64, "base64").length);
});
