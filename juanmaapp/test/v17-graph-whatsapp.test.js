import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { startServer } from "./helpers.js";

// Microsoft 365 (Graph) and WhatsApp Cloud API answered by fakes; calls to the test server pass through.
const realFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith("http://127.0.0.1")) return realFetch(url, opts);
  calls.push({ url: u, opts });
  if (u.includes("login.microsoftonline.com")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
  if (u.includes("graph.microsoft.com")) return new Response(null, { status: 202 });
  if (u.includes("graph.facebook.com")) return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 });
  throw new Error("unexpected " + u);
};
Object.assign(process.env, { MAIL_TRANSPORT: "graph", MS_TENANT_ID: "tenant", MS_CLIENT_ID: "client", MS_CLIENT_SECRET: "secret", MAIL_FROM: "notificaciones@tecjuridicos.com",
  WHATSAPP_TOKEN: "wa", WHATSAPP_PHONE_ID: "123", WHATSAPP_TEMPLATE: "tecjuridicos_aviso", WHATSAPP_TEMPLATE_OTP: "tecjuridicos_codigo", WHATSAPP_LANG: "es" });
delete process.env.SMTP_HOST;

let srv, admin;
before(async () => { srv = await startServer(); admin = await srv.setup(); });
after(() => srv.close());

test("traced e-mail goes through Microsoft Graph as the exact MIME message", async () => {
  const m = await admin.call("POST", "/mail", { to: "juzgado@cendoj.ramajudicial.gov.co", subject: "Memorial", body: "Adjunto memorial.",
    attachments: [{ filename: "m.pdf", mime: "application/pdf", base64: Buffer.from("%PDF-1.4 x").toString("base64") }] });
  assert.equal(m.status, 201, JSON.stringify(m.body));
  const send = calls.find((c) => c.url.includes("/users/notificaciones%40tecjuridicos.com/sendMail"));
  assert.ok(send, "Graph sendMail called for the MAIL_FROM mailbox");
  assert.equal(send.opts.headers.Authorization, "Bearer tok");
  assert.equal(send.opts.headers["Content-Type"], "text/plain");
  const mime = Buffer.from(send.opts.body, "base64");
  assert.equal(createHash("sha256").update(mime).digest("hex"), m.body.raw_sha256, "what Graph received is what was hashed");
  assert.match(m.body.smtp_response, /Microsoft 365/);
});

test("e-signature code by WhatsApp uses the Authentication template with the copy-code button", async () => {
  const r = await admin.call("POST", "/esign", { title: "Poder", doc_text: "# PODER", signers: [{ name: "Ana", email: "ana@c.co", phone: "3001234567", otp_channel: "whatsapp" }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const graphMail = calls.filter((c) => c.url.includes("sendMail")).at(-1);
  const link = Buffer.from(graphMail.opts.body, "base64").toString("latin1").replace(/=\r\n/g, "").match(/firmar\.html#([\w-]+)/)[1];
  const res = await fetch(`${srv.base}/public/sign/${link}/otp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: "whatsapp" }) });
  assert.equal(res.status, 200);
  const wa = JSON.parse(calls.filter((c) => c.url.includes("graph.facebook.com")).at(-1).opts.body);
  assert.equal(wa.to, "573001234567");
  assert.equal(wa.template.name, "tecjuridicos_codigo");
  const code = wa.template.components[0].parameters[0].text;
  assert.match(code, /^\d{6}$/);
  assert.deepEqual(wa.template.components[1], { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] });
});

test("WhatsApp general template: text without line breaks (Meta rejects them)", async () => {
  const { sendWhatsapp } = await import("../src/notify.js");
  await sendWhatsapp("3001234567", "Hola Ana:\n\nSu cuota vence mañana.\n\tGracias");
  const wa = JSON.parse(calls.filter((c) => c.url.includes("graph.facebook.com")).at(-1).opts.body);
  assert.equal(wa.template.name, "tecjuridicos_aviso");
  assert.doesNotMatch(wa.template.components[0].parameters[0].text, /[\n\t]/);
});
