// Version 2.3.16: the user signs a PDF with their own electronic signature and gets the signed PDF back (no e-mail), to send it however they like.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { startServer } from "./helpers.js";
import { jsPDF } from "jspdf";

let srv, admin;
before(async () => { process.env.TSA_URL = "off"; srv = await startServer(); admin = await srv.setup(); });
after(() => srv.close());

const pdf = () => { const d = new jsPDF({ unit: "pt", format: "letter" }); d.text("Derecho de petición", 40, 60); d.addPage(); d.text("Página 2", 40, 60); return Buffer.from(d.output("arraybuffer")).toString("base64"); };

test("POST /esign/self signs at the marked spot and returns the signed PDF with its verification code", async () => {
  const body = { pdf_base64: pdf(), filename: "Derecho de petición.pdf", stamp_page: "2", stamp_pos: "at:0.1,0.5" };
  const noId = await admin.call("POST", "/esign/self", body);
  assert.equal(noId.status, 400);
  assert.match(noId.body.error, /nombre completo.*cédula/);
  srv.db.prepare("UPDATE users SET legal_name = ?, id_number = ?, professional_card = ? WHERE email = 'gerencia@firma.co'").run("John Fredy Quiñones Montaña", "17418999", "150081");
  assert.equal((await admin.call("POST", "/esign/self", { ...body, pdf_base64: "AAAA" })).status, 400);
  const ok = await admin.call("POST", "/esign/self", body);
  assert.equal(ok.status, 201, JSON.stringify(ok.body).slice(0, 200));
  assert.equal(ok.body.name, "Derecho de petición - firmada.pdf");
  const signed = Buffer.from(ok.body.base64, "base64");
  assert.equal(signed.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.equal(createHash("sha256").update(signed).digest("hex"), ok.body.sha256);
  const x = srv.db.prepare("SELECT * FROM sign_requests WHERE id = ?").get(ok.body.id);
  assert.equal(x.status, "completada");
  assert.equal(x.stamp_page, "2");
  assert.equal(x.stamp_pos, "at:0.1,0.5");
  assert.equal(x.signed_sha256, ok.body.sha256);
  assert.match(ok.body.verify_url, new RegExp(`/verificar\\.html#${ok.body.code}$`));
  assert.equal(srv.db.prepare("SELECT COUNT(*) n FROM mail_messages").get().n, 0, "nothing is e-mailed");
});
