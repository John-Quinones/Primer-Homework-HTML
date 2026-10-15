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

test("Gerencia invites users by e-mail (link to create their password) or assigns a temporary password", async () => {
  const g = await srv.login("nuevo@firma.co", "otra-clave-segura");
  const office = (await g.call("GET", "/admin/offices")).body[0].id;
  assert.equal((await g.call("POST", "/admin/users", { name: "Sin Clave", email: "sin@firma.co", role: "Abogado", office_ids: [office] })).status, 400,
    "needs a password or the invitation");
  const inv = await g.call("POST", "/admin/users", { name: "Laura Gómez", email: "laura@firma.co", role: "Abogado", office_ids: [office], invite: true });
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  assert.equal(inv.body.invitation.ok, true);
  assert.equal(inv.body.has_password, false);
  const mail = mails.filter((m) => m.to === "laura@firma.co").at(-1);
  assert.match(mail.subject, /Invitación/);
  assert.doesNotMatch(mail.text, /contraseña temporal|clave-/i, "no password in the e-mail");
  const token = mail.text.match(/#invitacion-([\w-]+)/)[1];
  const created = await pub("/auth/reset", { token, password: "laura-clave-2026" });
  assert.equal(created.status, 200);
  assert.equal(created.body.user.must_change_password, false);
  assert.equal((await pub("/auth/login", { email: "laura@firma.co", password: "laura-clave-2026" })).status, 200);

  const tmp = await g.call("POST", "/admin/users", { name: "Pedro Ruiz", email: "pedro@firma.co", role: "Abogado", office_ids: [office], password: "Temporal-2026-x" });
  assert.equal(tmp.body.must_change_password, true, "assigned password is temporary");
  const p = await srv.login("pedro@firma.co", "Temporal-2026-x");
  assert.equal((await p.call("POST", "/auth/password", { current: "Temporal-2026-x", next: "Temporal-2026-x" })).status, 400, "must be a different one");
  assert.equal((await p.call("POST", "/auth/password", { current: "Temporal-2026-x", next: "pedro-propia-2026" })).status, 204);
  assert.equal((await p.call("GET", "/auth/status")).body.user.must_change_password, false);
  const again = await g.call("POST", `/admin/users/${tmp.body.id}/invite`);
  assert.equal(again.status, 200);
  assert.ok(again.body.user.invited_at);
});
