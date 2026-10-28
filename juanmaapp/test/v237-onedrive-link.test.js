// Version 2.3.7: a OneDrive link with the steps to open it, inside the traced e-mail.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { setMailTransport } from "../src/mailtrace.js";
import { cleanOnedriveUrl, onedriveBlock } from "../src/onedrive-link.js";

let srv, admin;
before(async () => {
  process.env.SMTP_HOST = "smtp.test"; process.env.MAIL_FROM = "gerencia@tecjuridicos.com"; process.env.TSA_URL = "off";
  srv = await startServer(); admin = await srv.setup();
});
after(() => { setMailTransport(null); srv.close(); });

test("only OneDrive / SharePoint https links are accepted; the block carries the steps and escapes the data", () => {
  assert.equal(cleanOnedriveUrl(""), "");
  assert.equal(cleanOnedriveUrl("1drv.ms/b/s!abc"), "https://1drv.ms/b/s!abc");
  assert.ok(cleanOnedriveUrl("https://tecjuridicos-my.sharepoint.com/:b:/g/personal/x/y?e=1"));
  assert.throws(() => cleanOnedriveUrl("https://evil.example.com/1drv.ms"), /OneDrive o SharePoint/);
  assert.throws(() => cleanOnedriveUrl("http://1drv.ms/x"), /OneDrive o SharePoint/);
  assert.throws(() => cleanOnedriveUrl("javascript:alert(1)"), /OneDrive|válido/);
  const b = onedriveBlock({ url: "https://1drv.ms/b/s!abc", name: "Expediente <completo>.pdf", password: "Clave1" });
  assert.match(b.text, /Por su peso, el archivo no va adjunto/);
  assert.match(b.text, /Si le pide contraseña, escriba: Clave1/);
  assert.match(b.html, /Expediente &lt;completo&gt;\.pdf/);
  assert.match(b.html, /<a href="https:\/\/1drv\.ms\/b\/s!abc"/);
  assert.equal(onedriveBlock({ url: "https://1drv.ms/b/s!abc" }).text.includes("contraseña"), false);
});

test("POST /mail with a OneDrive link puts the instructions in the message; a foreign link is refused", async () => {
  const sent = [];
  setMailTransport({ sendMail: async (m) => { sent.push(m); return { messageId: "<m@test>", accepted: m.to, rejected: [], response: "250 OK" }; } });
  const base = { to: "a@x.gov.co, b@y.gov.co", subject: "Anexos", body: "Ver anexos." };
  const bad = await admin.call("POST", "/mail", { ...base, onedrive: { url: "https://evil.example.com/x" } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /OneDrive o SharePoint/);
  const ok = await admin.call("POST", "/mail", { ...base, onedrive: { url: "https://1drv.ms/b/s!abc", name: "Todo.zip" } });
  assert.equal(ok.status, 201);
  assert.match(ok.body.body, /Ver anexos\.\n\nArchivo de gran tamaño en OneDrive: Todo\.zip/);
  const m = sent.at(-1);
  assert.match(m.html, /Abrir archivo en OneDrive/);
  assert.match(m.text, /1\. Haga clic/);
  const none = await admin.call("POST", "/mail", base);
  assert.equal(none.status, 201);
  assert.doesNotMatch(sent.at(-1).html, /OneDrive/);
});
