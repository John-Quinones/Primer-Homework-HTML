// Version 2.2.85: «Solicitar link de expediente», an HTML letter e-mailed to the court with one click.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { setMailTransport } from "../src/mailtrace.js";
import { letterFields, letterMissing, buildLetter } from "../src/solicitud-link-letter.js";

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
  assert.equal(f.numero_radicado, "73001400300320260031200");
  assert.equal(f.demandante, "Alirio Guzmán");
  assert.equal(f.nombre_cliente, "ALIRIO GUZMÁN");
  assert.deepEqual(letterMissing(f), ["Tipo de actuación"]);
  assert.deepEqual(letterMissing({ ...f, tipo_actuacion: "Interrogatorio de parte" }), []);
});

test("buildLetter: subject as John asked, escaped data, John's two paragraphs", () => {
  const L = buildLetter({ ...letterFields(data), tipo_actuacion: "Interrogatorio <b>", demandado: "A & B" }, { imgSrc: "cid:firma-john" });
  assert.match(L.subject, /^Solicitud Link Expediente - Interrogatorio <b> – Alirio Guzmán Vs A & B Radicación No\. 73001400300320260031200$/);
  assert.match(L.html, /Interrogatorio &lt;b&gt;/);
  assert.match(L.html, /A &amp; B/);
  assert.match(L.html, /Actuando como apoderado judicial del señor <strong>ALIRIO GUZMÁN<\/strong>/);
  assert.match(L.html, /src="cid:firma-john"/);
  assert.match(L.text, /gerencia@tecjuridicos\.com/);
});

test("POST /mail with a letter sends the HTML with the signature inline; missing data is refused", async () => {
  const sent = [];
  setMailTransport({ sendMail: async (m) => { sent.push(m); return { messageId: "<m@test>", accepted: m.to, rejected: [], response: "250 OK" }; } });
  const fields = { ...letterFields(data), tipo_actuacion: "Interrogatorio de parte" };
  const bad = await admin.call("POST", "/mail", { to: "j03@cendoj.ramajudicial.gov.co", letter: { kind: "solicitud_link", fields: { ...fields, tipo_actuacion: "" } } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Tipo de actuación/);
  const ok = await admin.call("POST", "/mail", { to: "j03@cendoj.ramajudicial.gov.co", letter: { kind: "solicitud_link", fields } });
  assert.equal(ok.status, 201);
  assert.match(ok.body.subject, /^Solicitud Link Expediente - Interrogatorio de parte/);
  const m = sent.at(-1);
  assert.match(m.html, /Solicitud Link Expediente - Interrogatorio de parte/);
  assert.match(m.html, /src="cid:firma-john"/);
  assert.ok(m.attachments.some((a) => a.cid === "firma-john" && a.contentType === "image/png"));
  const other = await admin.call("POST", "/mail", { to: "j03@cendoj.ramajudicial.gov.co", letter: { kind: "otra", fields } });
  assert.equal(other.status, 400);
});
