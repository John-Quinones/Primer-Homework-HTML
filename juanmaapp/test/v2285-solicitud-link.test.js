// Version 2.2.85: «Solicitar link de expediente», an HTML letter e-mailed to the court with one click.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { setMailTransport } from "../src/mailtrace.js";
import { jsPDF } from "jspdf";
import { createHash } from "node:crypto";
import { letterFields, letterMissing, buildLetter, signerView } from "../src/solicitud-link-letter.js";

let srv, admin;
before(async () => {
  process.env.SMTP_HOST = "smtp.test"; process.env.MAIL_FROM = "gerencia@tecjuridicos.com"; process.env.TSA_URL = "off";
  srv = await startServer(); admin = await srv.setup();
});
after(() => { setMailTransport(null); srv.close(); });

const data = { "fecha.hoy": "27 de octubre de 2026", "expediente.juez": "Yolanda Vargas", "expediente.despacho": "Juzgado Tercero Civil Municipal de Ibagué", "expediente.correo_despacho": "j03@cendoj.ramajudicial.gov.co",
  "expediente.radicado": "73001-40-03-003-2026-00312-00", "cliente.nombre": "Alirio Guzmán", "cliente.del_senor": "del señor", "expediente.contraparte": "Banco Ejemplo S.A.", "cliente.calidad_sola": "demandante" };

test("letterFields takes the case's data; the type of action is typed", () => {
  const f = letterFields(data);
  assert.equal(f.ciudad, "Ibagué");
  assert.equal(f.nombre_juez_o_doctora, "YOLANDA VARGAS");
  assert.equal(f.numero_radicado, "73-001-40-03-003-2026-00312-00");
  assert.equal(f.demandante, "Alirio Guzmán");
  assert.equal(f.nombre_cliente, "ALIRIO GUZMÁN");
  assert.deepEqual(letterMissing(f), ["Tipo de actuación"]);
  assert.deepEqual(letterMissing({ ...f, tipo_actuacion: "x" }, signerView({})), ["Su nombre completo para firmas (Usuarios)", "Su cédula (Usuarios)"]);
  assert.deepEqual(letterMissing({ ...f, tipo_actuacion: "Interrogatorio de parte" }), []);
});

const letterPdf = () => { const d = new jsPDF({ unit: "pt", format: "letter" }); d.text("Solicitud link de expediente " + "x".repeat(900), 40, 60, { maxWidth: 500 }); return Buffer.from(d.output("arraybuffer")).toString("base64"); };
const lawyer = { legal_name: "John Fredy Quiñones Montaña", id_number: "17.418.999", professional_card: "150081", email: "gerencia@tecjuridicos.com", phone: "314 415 6914" };

test("buildLetter: subject as John asked, escaped data, his opening sentence, the stamp of the electronic signature", () => {
  const signer = signerView(lawyer);
  assert.equal(signer.id_number, "17418999");
  assert.equal(signer.card, "Tarjeta Profesional No. 150.081 del C. S. de la J.");
  const L = buildLetter({ ...letterFields(data), tipo_actuacion: "Interrogatorio <b>", demandado: "A & B" }, { signer,
    imgs: { logo: "cid:carta-logo" }, stamp: { code: "ABCDE-23456", signed_at: "2026-10-27 19:28:36 -05:00", qrSrc: "cid:firma-qr" } });
  assert.match(L.subject, /^Solicitud Link Expediente - Interrogatorio <b> – Alirio Guzmán Vs A & B Radicación No\. 73-001-40-03-003-2026-00312-00$/);
  assert.match(L.html, /Interrogatorio &lt;b&gt;/);
  assert.match(L.html, /A &amp; B/);
  assert.match(L.html, /JOHN FREDY QUIÑONES MONTAÑA<\/strong>, identificado civil y profesionalmente como aparece al final en la firma electrónica, actuando como apoderado judicial del señor <strong[^>]*>ALIRIO GUZMÁN<\/strong>/);
  assert.doesNotMatch(L.html, /Yo,/);
  assert.match(L.html, /src="cid:carta-logo"/);
  assert.match(L.html, /src="cid:firma-qr"/);
  assert.match(L.html, /Firma Electrónica/);
  assert.match(L.html, /2026-10-27 19:28:36 -05:00/);
  assert.match(L.html, /El PDF adjunto lleva la estampa de la firma electrónica/);
  assert.match(L.html, /Tarjeta Profesional No\. 150\.081 del C\. S\. de la J\./);
  assert.match(L.html, /ABCDE-23456/);
  assert.match(L.html, /Carrera 5 No\. 29-32 Of\.290 Centro Comercial La Quinta/);
  assert.match(L.text, /gerencia@tecjuridicos\.com/);
  // The preview (no stamp yet) says the QR and code are issued when sending.
  assert.match(buildLetter(letterFields(data), { signer }).html, /se emiten al enviar/);
});

test("POST /mail with a letter signs it with the platform's electronic signature; the code answers on the public verification; missing data is refused", async () => {
  const sent = [];
  setMailTransport({ sendMail: async (m) => { sent.push(m); return { messageId: "<m@test>", accepted: m.to, rejected: [], response: "250 OK" }; } });
  const fields = { ...letterFields(data), tipo_actuacion: "Interrogatorio de parte" };
  const bad = await admin.call("POST", "/mail", { to: "j03@cendoj.ramajudicial.gov.co", letter: { kind: "solicitud_link", pdf_base64: letterPdf(), fields: { ...fields, tipo_actuacion: "" } } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Tipo de actuación/);
  // The sender needs his full name and ID for the signature.
  const noId = await admin.call("POST", "/mail", { to: "j03@cendoj.ramajudicial.gov.co", letter: { kind: "solicitud_link", pdf_base64: letterPdf(), fields } });
  assert.equal(noId.status, 400);
  assert.match(noId.body.error, /nombre completo para firmas.*cédula/);
  assert.equal(srv.db.prepare("SELECT COUNT(*) n FROM sign_requests").get().n, 0);
  srv.db.prepare("UPDATE users SET legal_name = ?, id_number = ?, professional_card = ? WHERE email = 'gerencia@firma.co'").run(lawyer.legal_name, lawyer.id_number, lawyer.professional_card);
  const noPdf = await admin.call("POST", "/mail", { to: "j03@cendoj.ramajudicial.gov.co", letter: { kind: "solicitud_link", fields } });
  assert.equal(noPdf.status, 400);
  assert.match(noPdf.body.error, /PDF de la carta/);
  const ok = await admin.call("POST", "/mail", { to: "j03@cendoj.ramajudicial.gov.co", letter: { kind: "solicitud_link", pdf_base64: letterPdf(), stamp_pos: "at:0.1,0.55", fields } });
  assert.equal(ok.status, 201);
  assert.match(ok.body.subject, /^Solicitud Link Expediente - Interrogatorio de parte/);
  const m = sent.at(-1);
  assert.match(m.html, /Solicitud Link Expediente - Interrogatorio de parte/);
  assert.match(m.html, /src="cid:carta-logo"/);
  assert.match(m.html, /src="cid:firma-qr"/);
  for (const cid of ["carta-logo", "carta-qr", "carta-globo", "carta-ubicacion", "firma-qr"]) assert.ok(m.attachments.some((a) => a.cid === cid && a.contentType === "image/png"), cid);
  assert.deepEqual([...m.attachments.find((a) => a.cid === "firma-qr").content.subarray(0, 4)], [137, 80, 78, 71]);
  // The electronic signature is a completed request holding the letter's PDF, with the signature module's stamp and certificate on the signed copy.
  const x = srv.db.prepare("SELECT * FROM sign_requests").get();
  assert.equal(x.status, "completada");
  assert.equal(x.doc_kind, "pdf");
  assert.equal(x.stamp_pos, "at:0.1,0.55");
  assert.match(x.verify_code, /^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
  assert.ok(m.html.includes(x.verify_code));
  const sg = srv.db.prepare("SELECT * FROM sign_signers WHERE request_id = ?").get(x.id);
  assert.equal(sg.status, "firmado");
  assert.equal(sg.id_number, "17418999");
  const att = m.attachments.find((a) => a.filename === "Solicitud link expediente - firmada.pdf");
  assert.ok(att, "the signed PDF travels with the e-mail");
  assert.equal(att.content.subarray(0, 5).toString("latin1"), "%PDF-");
  const sha = createHash("sha256").update(att.content).digest("hex");
  assert.equal(sha, x.signed_sha256, "the attached file is the one registered");
  const v = await fetch(`${srv.base}/public/verify`, { method: "POST", headers: { "Content-Type": "application/json", "X-JuanMa": "1" }, body: JSON.stringify({ code: x.verify_code }) }).then((r) => r.json());
  assert.equal(v.match, "codigo");
  assert.equal(v.status, "completada");
  assert.equal(v.signers[0].status, "firmado");
  // Uploading the signed PDF (its SHA-256) answers «firmado»: authentic and unaltered.
  const byFile = await fetch(`${srv.base}/public/verify`, { method: "POST", headers: { "Content-Type": "application/json", "X-JuanMa": "1" }, body: JSON.stringify({ sha256: sha }) }).then((r) => r.json());
  assert.equal(byFile.match, "firmado");
  const other = await admin.call("POST", "/mail", { to: "j03@cendoj.ramajudicial.gov.co", letter: { kind: "otra", pdf_base64: letterPdf(), fields } });
  assert.equal(other.status, 400);
});
