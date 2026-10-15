import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { setMicrosoftFetch } from "../src/microsoft.js";

const TENANT = "11111111-2222-3333-4444-555555555555";
let srv, origin, claims, tokenCalls = [];
before(async () => {
  Object.assign(process.env, { MS_TENANT_ID: TENANT, MS_CLIENT_ID: "app-123", MS_CLIENT_SECRET: "secreto" });
  setMicrosoftFetch(async (url, opts) => {
    tokenCalls.push({ url, body: Object.fromEntries(new URLSearchParams(opts.body)) });
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    return { ok: true, json: async () => ({ id_token: `${enc({ alg: "RS256" })}.${enc(claims)}.firma` }) };
  });
  srv = await startServer();
  origin = srv.base.replace(/\/api$/, "");
});
after(() => { srv.close(); for (const k of ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET"]) delete process.env[k]; });

// Start the flow like a browser: returns the state cookie and the authorize URL.
async function start() {
  const r = await fetch(`${origin}/api/auth/microsoft/start`, { redirect: "manual" });
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get("location"));
  return { cookie: r.headers.get("set-cookie").split(";")[0], loc, state: loc.searchParams.get("state"), nonce: loc.searchParams.get("nonce") };
}
async function callback(s, { state = s.state, code = "abc" } = {}) {
  const r = await fetch(`${origin}/api/auth/microsoft/callback?code=${code}&state=${state}`, { redirect: "manual", headers: { Cookie: s.cookie } });
  const cookies = r.headers.getSetCookie();
  const session = cookies.find((c) => c.startsWith("jm_session=") && !c.startsWith("jm_session=;"));
  return { location: r.headers.get("location"), session: session?.split(";")[0] };
}
const good = (s, extra = {}) => ({ aud: "app-123", tid: TENANT, iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, nonce: s.nonce,
  exp: Math.floor(Date.now() / 1000) + 3600, name: "Juan Manuel Quiñones", preferred_username: "JM@TecJuridicos.co", ...extra });

test("status says Microsoft sign-in is available; authorize URL uses the firm's tenant and PKCE", async () => {
  assert.equal((await (await fetch(`${srv.base}/auth/status`)).json()).microsoft, true);
  const s = await start();
  assert.equal(s.loc.origin + s.loc.pathname, `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`);
  assert.equal(s.loc.searchParams.get("code_challenge_method"), "S256");
  assert.equal(s.loc.searchParams.get("redirect_uri"), `${origin}/api/auth/microsoft/callback`);
});

test("first Microsoft sign-in on an empty install creates Gerencia; later ones need a registered user", async () => {
  let s = await start();
  claims = good(s);
  const first = await callback(s);
  assert.equal(first.location, "/");
  assert.ok(first.session);
  assert.equal(tokenCalls.at(-1).body.code_verifier.length > 40, true);
  const me = await (await fetch(`${srv.base}/auth/status`, { headers: { Cookie: first.session } })).json();
  assert.equal(me.user.role, "Gerencia");
  assert.equal(me.user.email, "jm@tecjuridicos.co");

  s = await start();
  claims = good(s, { preferred_username: "otra@tecjuridicos.co" });
  const stranger = await callback(s);
  assert.match(decodeURIComponent(stranger.location), /ms_error=not_registered$/);
  assert.equal(stranger.session, undefined);

  // Gerencia creates the user without a password; then that account gets in.
  const office = (await (await fetch(`${srv.base}/admin/offices`, { headers: { Cookie: first.session } })).json())[0].id;
  const created = await fetch(`${srv.base}/admin/users`, { method: "POST", headers: { Cookie: first.session, "Content-Type": "application/json", "X-JuanMa": "1" },
    body: JSON.stringify({ name: "Otra Abogada", email: "otra@tecjuridicos.co", role: "Abogado", office_ids: [office] }) });
  assert.equal(created.status, 201);
  s = await start();
  claims = good(s, { preferred_username: "otra@tecjuridicos.co" });
  assert.ok((await callback(s)).session);
  // …and cannot sign in with a password.
  const pw = await fetch(`${srv.base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-JuanMa": "1" }, body: JSON.stringify({ email: "otra@tecjuridicos.co", password: "!" }) });
  assert.equal(pw.status, 401);
});

test("rejects a wrong state, a replayed nonce, another tenant or another app", async () => {
  let s = await start();
  claims = good(s);
  assert.match((await callback(s, { state: "otro" })).location, /ms_error=/);
  for (const bad of [{ nonce: "x" }, { tid: "99999999-2222-3333-4444-555555555555" }, { aud: "otra-app" }, { exp: 1 }]) {
    s = await start();
    claims = good(s, bad);
    const r = await callback(s);
    assert.match(r.location, /ms_error=/, JSON.stringify(bad));
    assert.equal(r.session, undefined);
  }
});

test("Microsoft accounts are bound to their fixed id (oid); guests and look-alike accounts are refused (audit A07-002)", async () => {
  let s = await start();
  claims = good(s, { oid: "oid-jm-1" });
  assert.ok((await callback(s)).session, "binds the oid at the next sign-in");
  s = await start();
  claims = good(s, { oid: "oid-otro-2" });
  const other = await callback(s);
  assert.match(other.location, /ms_error=other_account$/, "same e-mail, different Microsoft account");
  assert.equal(other.session, undefined);
  s = await start();
  claims = good(s, { oid: "oid-jm-1", preferred_username: "nuevo.correo@tecjuridicos.co" });
  assert.ok((await callback(s)).session, "the same person enters even if the e-mail changed");
  s = await start();
  claims = good(s, { oid: "oid-guest", acct: 1, preferred_username: "x@otra.com" });
  assert.match((await callback(s)).location, /ms_error=guest$/);
});

test("any e-mail can enter: a Gmail user needs a password or an invitation, and then signs in with it (change 53)", async () => {
  let s = await start();
  claims = good(s, { oid: "oid-jm-1" });
  const g = (await callback(s)).session;
  const call = (method, path, body) => fetch(`${srv.base}${path}`, { method, headers: { "Content-Type": "application/json", "X-JuanMa": "1", Cookie: g }, body: body && JSON.stringify(body) });
  const office = (await (await call("GET", "/admin/offices")).json())[0].id;
  const bare = await call("POST", "/admin/users", { name: "Laura Gómez", email: "laura.gomez@gmail.com", role: "Abogado", office_ids: [office] });
  assert.equal(bare.status, 400, "a Gmail address cannot be left for Microsoft-only sign-in");
  assert.match((await bare.json()).error, /no es de la cuenta Microsoft 365/);
  const ok = await call("POST", "/admin/users", { name: "Laura Gómez", email: "laura.gomez@gmail.com", role: "Abogado", office_ids: [office], password: "tribunal-azul-2026" });
  assert.equal(ok.status, 201);
  const login = await fetch(`${srv.base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-JuanMa": "1" }, body: JSON.stringify({ email: "laura.gomez@gmail.com", password: "tribunal-azul-2026" }) });
  assert.equal(login.status, 200);
});
