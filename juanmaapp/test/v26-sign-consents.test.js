import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { setTransports } from "../src/notify.js";
import { verifyConsentChain } from "../src/consents.js";
import { CONSENT_ITEMS, legalDoc } from "../src/legal.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
let srv, admin, client, caseId;
const mails = [];
before(async () => {
  setTransports({ mail: { sendMail: async (m) => { mails.push(m); return { messageId: "<x@test>" }; } } });
  srv = await startServer(); admin = await srv.setup();
  client = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Marta", last_names: "Gil", id_number: "38.222.111", email: "marta@cliente.co" })).body;
  const lab = (await admin.call("GET", "/catalog")).body.find((c) => c.name === "Laboral");
  caseId = (await admin.call("POST", "/cases", { client_id: client.id, process_type_id: lab.types[0].id })).body.id;
});
after(() => srv.close());
const pub = async (method, path, body) => {
  const res = await fetch(srv.base + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test("version 2.4: the risk-bureau authorization is its own document and its own checkbox", () => {
  assert.ok(CONSENT_ITEMS.find((i) => i.key === "centrales" && i.doc === "centrales"));
  const html = legalDoc("centrales").html;
  assert.match(html, /Ley 2157 de 2021/);
  assert.match(html, /veinte \(20\) días calendario/);
  assert.match(html, /Tecjuridicos S\.A\.S\., NIT 901\.269\.714-4/);
});

test("a client signing by link gets the policies as a checklist and answers each one, stored as evidence", async () => {
  mails.length = 0;
  const r = await admin.call("POST", "/esign", { title: "Contrato de prestación de servicios profesionales de abogado", doc_text: "# CONTRATO\n\nTexto.", case_id: caseId,
    signers: [{ name: "Marta Gil", id_number: "38222111", email: "marta@cliente.co", otp_channel: "email" }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const mail = mails.find((m) => m.to === "marta@cliente.co");
  for (const i of CONSENT_ITEMS) assert.ok(mail.text.includes(`[ ] ${i.title}`), i.key);
  assert.match(mail.html, /&#9744;/);
  const token = mail.text.match(/firmar\.html#(\S+)/)[1];
  const v = (await pub("GET", `/public/sign/${token}`)).body;
  assert.equal(v.consent.items.length, CONSENT_ITEMS.length);
  await pub("POST", `/public/sign/${token}/otp`, { channel: "email" });
  const otp = mails.at(-1).text.match(/es (\d{6})/)[1];
  const base = { otp, typed_name: "Marta Gil", accept: true, signature_png: PNG };
  const missing = await pub("POST", `/public/sign/${token}/sign`, { ...base, consents: { datos: true } });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /Responda si acepta o no/);
  const answers = { datos: true, sensibles: false, privacidad: true, cookies: true, centrales: false, comunicaciones: true };
  const ok = await pub("POST", `/public/sign/${token}/sign`, { ...base, consents: answers });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const k = (await admin.call("GET", `/clients/${client.id}/consents`)).body;
  for (const [key, val] of Object.entries(answers)) {
    assert.equal(k.status[key].granted, val ? 1 : 0, key);
    assert.equal(k.status[key].method, "firma");
    assert.match(k.status[key].note, /Contrato de prestación de servicios/);
  }
  assert.deepEqual(verifyConsentChain(srv.db), { ok: true });
});

test("someone who is not a client of the firm signs without the checklist", async () => {
  mails.length = 0;
  await admin.call("POST", "/esign", { title: "Acta", doc_text: "x", signers: [{ name: "Testigo Uno", id_number: "99887766", email: "t@x.co", otp_channel: "email" }] });
  const mail = mails.find((m) => m.to === "t@x.co");
  assert.doesNotMatch(mail.text, /Políticas de datos personales/);
  const token = mail.text.match(/firmar\.html#(\S+)/)[1];
  assert.equal((await pub("GET", `/public/sign/${token}`)).body.consent, undefined);
});

const sendTo = async (title, signer, mail) => {
  mails.length = 0;
  const r = await admin.call("POST", "/esign", { title, doc_text: "# DOC\n\nTexto.", case_id: caseId, signers: [signer], mail });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const m = mails.find((x) => x.to === signer.email);
  return { m, token: m.text.match(/firmar\.html#(\S+)/)[1] };
};

test("version 2.8: the policies go only the first time, with the services contract", async () => {
  const marta = { name: "Marta Gil", id_number: "38222111", email: "marta@cliente.co", otp_channel: "email" };
  const again = await sendTo("Contrato de prestación de servicios profesionales de abogado", marta);
  assert.doesNotMatch(again.m.text, /Políticas de datos personales/);
  assert.equal((await pub("GET", `/public/sign/${again.token}`)).body.consent, undefined);
  const c2 = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Luis", last_names: "Rojas", id_number: "1.110.555.444", email: "luis@cliente.co" })).body;
  const luis = { name: "Luis Rojas", id_number: "1110555444", email: "luis@cliente.co", otp_channel: "email" };
  const poder = await sendTo("Poder especial", luis);
  assert.doesNotMatch(poder.m.text, /Políticas de datos personales/);
  assert.ok(c2.id);
});

test("version 2.8: the office leaves out parts of the e-mail and chooses which policies go", async () => {
  await admin.call("POST", "/clients", { person_type: "natural", first_names: "Ana", last_names: "Paz", id_number: "65.432.100", email: "ana@cliente.co" });
  const ana = { name: "Ana Paz", id_number: "65432100", email: "ana@cliente.co", otp_channel: "email" };
  const { m, token } = await sendTo("Contrato de prestación de servicios", ana,
    { greeting: false, doc_line: false, code_note: false, closing: true, message: true, policies: ["datos", "privacidad"] });
  assert.doesNotMatch(m.text, /Hola Ana/);
  assert.doesNotMatch(m.text, /Documento:/);
  assert.doesNotMatch(m.text, /código de verificación/);
  assert.match(m.text, /firmar\.html#/);
  const titles = CONSENT_ITEMS.filter((i) => m.text.includes(`[ ] ${i.title}`)).map((i) => i.key);
  assert.deepEqual(titles, ["datos", "privacidad"]);
  const v = (await pub("GET", `/public/sign/${token}`)).body;
  assert.deepEqual(v.consent.items.map((i) => i.key), ["datos", "privacidad"]);
  await pub("POST", `/public/sign/${token}/otp`, { channel: "email" });
  const otp = mails.at(-1).text.match(/es (\d{6})/)[1];
  const ok = await pub("POST", `/public/sign/${token}/sign`, { otp, typed_name: "Ana Paz", accept: true, signature_png: PNG, consents: { datos: true, privacidad: false } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const recs = srv.db.prepare("SELECT item FROM consent_records WHERE client_name LIKE 'Ana%' ORDER BY id").all().map((r) => r.item);
  assert.deepEqual(recs, ["datos", "privacidad"]);
});
