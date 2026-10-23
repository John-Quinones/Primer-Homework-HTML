import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { setTransports } from "../src/notify.js";
import { verifyConsentChain } from "../src/consents.js";
import { CONSENT_ITEMS, LEGAL_DOCS, consentText } from "../src/legal.js";
import { SEED_TEMPLATES } from "../src/templates-seed.js";

const SIG = "data:image/png;base64,iVBORw0KGgo=";
let srv, admin, client;
const mails = [];
before(async () => {
  setTransports({ mail: { sendMail: async (m) => { mails.push(m); return {}; } } });
  srv = await startServer(); admin = await srv.setup();
  client = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Ana", last_names: "Rojas", id_number: "1.110.222", email: "ana@correo.co" })).body;
});
after(() => srv.close());

test("every legal document exists and each consent item points at one", () => {
  const ids = LEGAL_DOCS.map((d) => d.id);
  for (const id of ["tratamiento", "privacidad", "cookies", "terminos", "aviso", "centrales", "autorizacion"]) assert.ok(ids.includes(id), id);
  for (const i of CONSENT_ITEMS) assert.ok(ids.includes(i.doc) && consentText(i.key).includes(i.label), i.key);
  assert.deepEqual(CONSENT_ITEMS.map((i) => i.key), ["datos", "sensibles", "privacidad", "cookies", "centrales", "comunicaciones"]);
  assert.ok(SEED_TEMPLATES.some((t) => /tratamiento de datos personales/i.test(t.name)));
});

test("the public pages and the documents are served", async () => {
  const root = srv.base.replace(/\/api$/, "");
  for (const p of ["/legal.html", "/legal-page.js", "/autorizar.html", "/autorizar-page.js"]) assert.equal((await fetch(root + p)).status, 200, p);
  assert.match(await (await fetch(root + "/shared.js")).text(), /window\.JuanmaLegal/);
});

test("in the office: each item is stored separately with the signature and who registered it", async () => {
  const r = await admin.call("POST", `/clients/${client.id}/consents`, { answers: { datos: true, sensibles: false, privacidad: true, cookies: true, comunicaciones: false },
    typed_name: "Ana Rojas", typed_id: "1110222", signature_png: SIG });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.records.length, 5); // the five answered in this submission
  assert.equal(r.body.status.datos.granted, 1);
  assert.equal(r.body.status.sensibles.granted, 0);
  assert.equal(r.body.status.datos.method, "presencial");
  assert.equal(r.body.status.datos.registered_by_name, "Gerente General");
  assert.match(r.body.status.datos.doc_sha256, /^[0-9a-f]{64}$/);
  assert.equal((await admin.call("POST", `/clients/${client.id}/consents`, { answers: { datos: true }, typed_name: "Ana Rojas" })).status, 400, "signature required");
});

test("by private link: the client answers each item, the document number must match, and the link works once", async () => {
  mails.length = 0;
  const r = await admin.call("POST", `/clients/${client.id}/consent-link`, { channel: "email" });
  assert.equal(r.status, 201);
  assert.equal(r.body.sent.ok, true);
  assert.equal(mails[0].to, "ana@correo.co");
  const token = r.body.link.split("#")[1];
  const pub = (method, body) => fetch(`${srv.base}/public/consent/${token}`, { method, headers: { "Content-Type": "application/json", "User-Agent": "Prueba/1.0" }, body: body && JSON.stringify(body) });
  const view = await (await pub("GET")).json();
  assert.equal(view.client_name, "Ana Rojas");
  assert.equal(view.items.length, CONSENT_ITEMS.length);
  assert.equal((await pub("POST", { typed_name: "Ana Rojas", typed_id: "999", answers: { datos: true } })).status, 400);
  const ok = await pub("POST", { typed_name: "Ana Rojas", typed_id: "1110222", answers: { datos: true, privacidad: true, cookies: false, sensibles: true } });
  assert.equal(ok.status, 200);
  const done = await ok.json();
  assert.equal(done.answers.length, 6);
  assert.equal(done.answers.find((a) => a.item === "cookies").granted, 0);
  assert.equal(done.answers.find((a) => a.item === "comunicaciones").granted, 0, "unchecked means not authorized");
  assert.equal((await pub("POST", { typed_name: "Ana Rojas", typed_id: "1110222", answers: {} })).status, 409);
  const mine = (await admin.call("GET", `/clients/${client.id}/consents`)).body;
  assert.equal(mine.status.cookies.granted, 0);
  assert.equal(mine.status.cookies.method, "enlace");
  assert.equal(mine.status.cookies.user_agent, "Prueba/1.0");
  assert.equal(mine.status.sensibles.granted, 1);
  assert.ok(mine.requests[0].answered_at);
  assert.ok(mails.some((m) => /copia de sus autorizaciones/.test(m.subject)), "the client gets a copy");
});

test("revocation is a new record; records can be neither edited nor deleted and the chain verifies", async () => {
  assert.equal((await admin.call("POST", `/clients/${client.id}/consents/revoke`, { item: "datos" })).status, 400, "needs how it was asked");
  const r = await admin.call("POST", `/clients/${client.id}/consents/revoke`, { item: "datos", note: "Correo del cliente del 15/10/2026" });
  assert.equal(r.body.status.datos.granted, 0);
  assert.equal(r.body.status.datos.method, "revocacion");
  assert.throws(() => srv.db.prepare("UPDATE consent_records SET granted = 1 WHERE item = 'datos'").run(), /no se modifican/);
  assert.throws(() => srv.db.prepare("DELETE FROM consent_records").run(), /no se borran/);
  assert.deepEqual(verifyConsentChain(srv.db), { ok: true });
  assert.ok(srv.db.prepare("SELECT COUNT(*) AS n FROM consent_texts").get().n >= 5, "the exact texts are kept");
});

test("deleting the client keeps the evidence with the name and document", async () => {
  const c = (await admin.call("POST", "/clients", { person_type: "natural", first_names: "Luis", last_names: "Pardo", id_number: "77" })).body;
  await admin.call("POST", `/clients/${c.id}/consent-link`, { channel: "copy" });
  await admin.call("POST", `/clients/${c.id}/consents`, { answers: { datos: true }, typed_name: "Luis Pardo", signature_png: SIG });
  assert.equal((await admin.call("DELETE", `/clients/${c.id}`, { confirm: c.full_name })).status, 204);
  const kept = srv.db.prepare("SELECT * FROM consent_records WHERE client_name = 'Luis Pardo'").all();
  assert.equal(kept.length, 1);
  assert.equal(kept[0].client_id, null);
  assert.deepEqual(verifyConsentChain(srv.db), { ok: true });
});

test("version 2.4: the legal documents carry the App's version and the firm's legal name and NIT", async () => {
  const { legalDoc, legalVersion } = await import("../src/legal.js");
  const { VERSION } = await import("../src/version.js");
  assert.equal(legalVersion().name, String(VERSION.name));
  const html = legalDoc("tratamiento").html;
  assert.match(html, new RegExp(`Versión ${VERSION.name.replace(".", "\\.")} de TecjuridicosApp`));
  assert.match(html, /Tecjuridicos S\.A\.S\., NIT 901\.269\.714-4/);
  const r = (await admin.call("GET", `/clients/${client.id}/consents`)).body;
  assert.equal(r.version, String(VERSION.name));
  const tpl = (await admin.call("GET", "/templates")).body;
  const auth = (tpl.templates || tpl).find((t) => t.name === "Autorización para el tratamiento de datos personales");
  assert.ok(auth, "starter authorization template");
});
