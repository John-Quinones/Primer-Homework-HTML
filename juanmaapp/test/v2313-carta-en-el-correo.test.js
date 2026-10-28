// Version 2.3.13: with the letter of «Firmar y enviar por correo», the e-mail carries the letter itself (HTML/CSS with the letterhead), not a plain message.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { setMailTransport } from "../src/mailtrace.js";
import { jsPDF } from "jspdf";

let srv, admin;
before(async () => {
  process.env.SMTP_HOST = "smtp.test"; process.env.MAIL_FROM = "gerencia@tecjuridicos.com"; process.env.TSA_URL = "off";
  srv = await startServer(); admin = await srv.setup();
  srv.db.prepare("UPDATE users SET legal_name = ?, id_number = ?, professional_card = ? WHERE email = 'gerencia@firma.co'").run("John Fredy Quiñones Montaña", "17418999", "150081");
});
after(() => { setMailTransport(null); srv.close(); });

const pdf = () => { const d = new jsPDF({ unit: "pt", format: "letter" }); d.text("Letra " + "x".repeat(400), 40, 60, { maxWidth: 500 }); return Buffer.from(d.output("arraybuffer")).toString("base64"); };
const carta = { ciudad: "Ibagué", fecha: "28 de octubre de 2026", tratamiento: "Señores", destinatario: "Ministerio de Educación Nacional\nBogotá D.C.", titulo: "Derecho de petición",
  referencia: "Peticionario: Ana Pérez\nRadicado: 73-001-40-03-005-2025-00185-00", cuerpo: "Cordial saludo.\n\nRemito el documento adjunto.", despedida: "Atentamente,", mayusculas: true, elaboro: "GG", mostrarElaboro: true };

test("the e-mail body is the letter in HTML with the letterhead, the stamp's QR and the signed PDF; no letter without its required data", async () => {
  const sent = [];
  setMailTransport({ sendMail: async (m) => { sent.push(m); return { messageId: "<c@test>", accepted: m.to, rejected: [], response: "250 OK" }; } });
  const base = { to: "a@x.gov.co", subject: "Derecho de petición", body: "", sign: { pdf_base64: pdf(), filename: "Carta.pdf", stamp_page: "first", stamp_pos: "br" } };
  const bad = await admin.call("POST", "/mail", { ...base, sign: { ...base.sign, carta: { ...carta, cuerpo: "" } } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Texto de la carta/);
  const ok = await admin.call("POST", "/mail", { ...base, sign: { ...base.sign, carta } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body).slice(0, 300));
  const m = sent.at(-1);
  assert.match(m.html, /MINISTERIO DE EDUCACIÓN NACIONAL/);
  assert.match(m.html, /Derecho de petición/);
  assert.match(m.html, /cid:carta-logo/);
  assert.match(m.html, /cid:firma-qr/);
  assert.match(m.html, /Tarjeta Profesional No\. 150\.081/);
  assert.ok(m.attachments.some((a) => a.cid === "firma-qr"));
  assert.ok(m.attachments.some((a) => a.filename === "Carta - firmada.pdf"));
  assert.match(m.text, /Remito el documento adjunto/);
});
