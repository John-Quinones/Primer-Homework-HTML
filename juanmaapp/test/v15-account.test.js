import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { setTransports } from "../src/notify.js";

let srv, admin;
const mails = [];
before(async () => {
  process.env.SMTP_HOST = "smtp.test"; process.env.MAIL_FROM = "n@firma.co";
  setTransports({ mail: { sendMail: async (m) => { mails.push(m); return { messageId: "<x>" }; } } });
  srv = await startServer();
  admin = await srv.setup();
});
after(() => srv.close());

const pub = async (path, body) => {
  const res = await fetch(srv.base + path, { method: "POST", headers: { "Content-Type": "application/json", "X-JuanMa": "1" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test("forgotten password: e-mailed link, one use, 10+ characters", async () => {
  const unknown = await pub("/auth/forgot", { email: "nadie@firma.co" });
  assert.equal(unknown.status, 200, "same answer for unknown e-mails");
  assert.equal(mails.length, 0);
  assert.equal((await pub("/auth/forgot", { email: "gerencia@firma.co" })).status, 200);
  const token = mails.at(-1).text.match(/#restablecer-([\w-]+)/)[1];
  assert.equal((await pub("/auth/reset", { token, password: "corta" })).status, 400);
  const ok = await pub("/auth/reset", { token, password: "otra-clave-segura" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.email, "gerencia@firma.co");
  assert.equal((await pub("/auth/reset", { token, password: "otra-clave-segura-2" })).status, 400, "used once");
  assert.equal((await pub("/auth/login", { email: "gerencia@firma.co", password: "otra-clave-segura" })).status, 200);
});

test("change one's own e-mail with the current password", async () => {
  const s = await srv.login("gerencia@firma.co", "otra-clave-segura");
  assert.equal((await s.call("POST", "/auth/email", { email: "nuevo@firma.co", password: "mala-clave-123" })).status, 400);
  const r = await s.call("POST", "/auth/email", { email: "Nuevo@Firma.co", password: "otra-clave-segura" });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.email, "nuevo@firma.co");
  assert.ok(mails.some((m) => m.to === "gerencia@firma.co" && /cambió/.test(m.subject)), "old address is told");
});
