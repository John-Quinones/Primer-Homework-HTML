import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { startServer } from "./helpers.js";
import { setMailTransport } from "../src/mailtrace.js";
import { setTsaFetch, timestampRequest, readTimestampReply } from "../src/tsa.js";

const h = (alg, b) => createHash(alg).update(b).digest("hex");
let srv, admin;
before(async () => {
  process.env.SMTP_HOST = "smtp.test"; process.env.MAIL_FROM = "notificaciones@firma.co";
  srv = await startServer();
  admin = await srv.setup();
});
after(() => { delete process.env.TSA_URL; srv.close(); });

test("a TSA reply that does not stamp our digest is refused; TSA_URL=off disables stamping", async () => {
  const { stamp, tsaUrl, DEFAULT_TSA_URL } = await import("../src/tsa.js");
  const saved = process.env.TSA_URL;
  delete process.env.TSA_URL;
  assert.equal(tsaUrl(), DEFAULT_TSA_URL);
  setTsaFetch(async () => new Response(Buffer.from([0x30, 0x05, 0x30, 0x03, 0x02, 0x01, 0x00]), { status: 200 }));
  const r = await stamp("cd".repeat(32));
  assert.equal(r.ok, false);
  assert.match(r.detail, /no corresponde/);
  process.env.TSA_URL = "off";
  assert.equal((await stamp("cd".repeat(32))).ok, false);
  process.env.TSA_URL = saved ?? "";
});

test("certified e-mail: exact message digests, attachment digests, openings, downloads, acknowledgment, timestamp", async () => {
  const sent = [];
  setMailTransport({ sendMail: async (m) => { sent.push(m); return { messageId: "<m@test>", accepted: m.to, rejected: [], response: "250 2.0.0 OK queued" }; } });
  // A minimal granted TimeStampResp: status 0 and a GeneralizedTime.
  process.env.TSA_URL = "https://tsa.test/tsr";
  // The fake TSA echoes the request (digest and nonce) inside its token, as a real one does.
  let reply;
  setTsaFetch(async (url, opts) => {
    assert.equal(opts.headers["Content-Type"], "application/timestamp-query");
    reply = Buffer.concat([Buffer.from([0x30, 0x16, 0x30, 0x03, 0x02, 0x01, 0x00, 0x18, 0x0f]), Buffer.from("20261015143000Z"), Buffer.from(opts.body)]);
    return new Response(reply, { status: 200 });
  });

  const pdf = Buffer.from("%PDF-1.4 memorial");
  const m = await admin.call("POST", "/mail", { to: "juzgado@cendoj.ramajudicial.gov.co", subject: "Notificación personal Ley 2213", body: "Adjunto demanda y anexos.",
    attach_mode: "enlace", attachments: [{ filename: "demanda.pdf", mime: "application/pdf", base64: pdf.toString("base64") }] });
  assert.equal(m.status, 201, JSON.stringify(m.body));
  const a = m.body.attachments[0];
  assert.deepEqual([a.size, a.sha1, a.sha256, a.sha512, a.sha3_512], [pdf.length, h("sha1", pdf), h("sha256", pdf), h("sha512", pdf), h("sha3-512", pdf)]);
  assert.equal(sent[0].attachments.length, 0, "link mode: the file travels as a tracked link");
  assert.equal(m.body.tsa_time, "2026-10-15 14:30:00 UTC");

  const eml = Buffer.from((await admin.call("GET", `/mail/${m.body.id}/eml`)).body.base64, "base64");
  assert.equal(h("sha256", eml), m.body.raw_sha256, "the stored .eml is what was hashed");
  assert.equal(h("sha512", eml), m.body.raw_sha512);
  assert.ok(Buffer.from(sent[0].raw).equals(eml), "the bytes handed to SMTP are the stored ones");

  const token = sent[0].text.match(/acuse\.html#(\S+)/)[1];
  await fetch(`${srv.base}/public/mail/${token}/o.png`, { headers: { "User-Agent": "Outlook" } });
  await fetch(`${srv.base}/public/mail/${token}/o.png`, { headers: { "User-Agent": "Outlook" } });
  const dl = await fetch(`${srv.base}/public/mail/${token}/a/1`);
  assert.ok(Buffer.from(await dl.arrayBuffer()).equals(pdf));
  assert.equal((await fetch(`${srv.base}/public/mail/${token}/a/9`)).status, 404);
  await fetch(`${srv.base}/public/mail/${token}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Secretaría" }) });

  const d = (await admin.call("GET", `/mail/${m.body.id}`)).body;
  const ev = d.events.map((e) => e.event);
  assert.deepEqual(ev.filter((e) => e !== "pagina_de_acuse_abierta"), ["aceptado_por_servidor_smtp", "sello_de_tiempo", "mensaje_abierto", "mensaje_abierto", "anexo_descargado", "acuse_de_recibo"]);
  assert.match(d.events[0].at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/, "milliseconds");
  assert.equal(d.events.find((e) => e.event === "mensaje_abierto").user_agent, "Outlook");
  assert.equal(Buffer.from((await admin.call("GET", `/mail/${m.body.id}/tsr`)).body.base64, "base64").length, reply.length);
});

test("RFC 3161 request and reply parsing", () => {
  const q = timestampRequest("ab".repeat(32), Buffer.from("0102030405060708", "hex"));
  assert.equal(q[0], 0x30);
  assert.ok(q.includes(Buffer.from("ab".repeat(32), "hex")));
  assert.deepEqual(readTimestampReply(Buffer.from([0x30, 0x05, 0x30, 0x03, 0x02, 0x01, 0x02])), { status: 2, granted: false, genTime: null });
});

test("status code 3 is archivo provisional; the contract carries the folder number; the credit-bureau authorization exists", async () => {
  const { normStatus } = await import("../src/case-meta.js");
  assert.deepEqual(["1", "2", "3"].map(normStatus), ["Activo", "Archivo definitivo", "Archivo provisional"]);
  const list = (await admin.call("GET", "/templates")).body;
  const auth = list.find((t) => /centrales de riesgo/.test(t.name));
  assert.equal(auth?.category, "Autorización");
  const contract = list.find((t) => /Contrato de prestación/.test(t.name));
  const body = (await admin.call("GET", `/templates/${contract.id}`)).body.body;
  assert.match(body, /^# CONTRATO DE PRESTACIÓN DE SERVICIOS PROFESIONALES DE ABOGADO N\.º \{\{expediente\.carpeta\}\}/);
});
