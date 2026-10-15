// Sign-in with the firm's Microsoft 365 accounts (Microsoft Entra ID, OpenID
// Connect authorization code flow with PKCE). A Microsoft account only gets in
// if Gerencia created a TecjuridicosApp user with the same e-mail; roles, offices
// and permissions stay in TecjuridicosApp.
//
// Settings: MS_TENANT_ID (the firm's directory id), MS_CLIENT_ID and
// MS_CLIENT_SECRET (from the app registration), PUBLIC_URL (for the redirect).
import { audit } from "./audit.js";
import express from "express";
import { createHash, randomBytes } from "node:crypto";
import { setSession } from "./auth.js";
import { publicUrl } from "./esign.js";

const env = process.env;
const STATE_COOKIE = "jm_ms";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let fetchImpl = (...a) => fetch(...a);
/** Tests replace the call to Microsoft's token endpoint. */
export function setMicrosoftFetch(f) { fetchImpl = f; }

export const microsoftEnabled = () => !!(env.MS_CLIENT_ID && env.MS_CLIENT_SECRET && GUID.test(env.MS_TENANT_ID || ""));

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const cookies = (req) => Object.fromEntries(String(req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
const redirectUri = (req) => `${publicUrl(req)}/api/auth/microsoft/callback`;
const secure = (req) => (req.secure || env.COOKIE_SECURE === "1" ? "; Secure" : "");

/** Payload of a JWT. The token comes straight from Microsoft's token endpoint over TLS (OIDC Core 3.1.3.7). */
function claimsOf(idToken) {
  const part = String(idToken || "").split(".")[1];
  if (!part) throw new Error("Microsoft no devolvió la identidad.");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

export function microsoftRouter(db) {
  const r = express.Router();
  // Only a short code travels in the address; the page shows its own fixed message for it (audit A06-003).
  const back = (res, code) => res.redirect(302, code ? `/?ms_error=${encodeURIComponent(code)}` : "/");

  r.get("/start", (req, res) => {
    if (!microsoftEnabled()) return back(res, "not_configured");
    const state = b64url(randomBytes(24)), nonce = b64url(randomBytes(24)), verifier = b64url(randomBytes(48));
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    // The state, nonce and PKCE verifier ride in a short-lived cookie bound to this browser.
    res.setHeader("Set-Cookie", `${STATE_COOKIE}=${encodeURIComponent(JSON.stringify({ state, nonce, verifier }))}; HttpOnly; SameSite=Lax; Path=/api/auth/microsoft; Max-Age=600${secure(req)}`);
    const q = new URLSearchParams({
      client_id: env.MS_CLIENT_ID, response_type: "code", redirect_uri: redirectUri(req), response_mode: "query",
      scope: "openid profile email", state, nonce, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account",
    });
    res.redirect(302, `https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/authorize?${q}`);
  });

  r.get("/callback", async (req, res) => {
    res.append("Set-Cookie", `${STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/api/auth/microsoft; Max-Age=0`);
    try {
      if (!microsoftEnabled()) return back(res, "not_configured");
      if (req.query.error) return back(res, req.query.error === "access_denied" ? "cancelled" : "denied");
      let saved = null;
      try { saved = JSON.parse(cookies(req)[STATE_COOKIE] || "null"); } catch { saved = null; }
      if (!saved?.state || saved.state !== req.query.state || !req.query.code) return back(res, "expired");

      const tokenRes = await fetchImpl(`https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET, grant_type: "authorization_code",
          code: String(req.query.code), redirect_uri: redirectUri(req), code_verifier: saved.verifier, scope: "openid profile email",
        }),
      });
      const tok = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok) return back(res, tok.error === "invalid_client" ? "secret" : "not_confirmed");

      const c = claimsOf(tok.id_token);
      const ok = c.aud === env.MS_CLIENT_ID && c.tid === env.MS_TENANT_ID && c.iss === `https://login.microsoftonline.com/${c.tid}/v2.0`
        && c.nonce === saved.nonce && Number(c.exp) * 1000 > Date.now() - 300000;
      if (!ok) return back(res, "invalid");
      const email = String(c.email || c.preferred_username || "").toLowerCase();
      if (!email.includes("@")) return back(res, "no_email");

      // Guests from other organizations are not members of the firm (audit A07-002).
      if (c.acct === 1 || (c.idp && !String(c.idp).includes(String(c.tid)))) {
        audit(db, req, { user: null, action: "Ingreso fallido", ok: false, summary: `Microsoft 365: cuenta invitada ${email}` });
        return back(res, "guest");
      }
      // The person is identified by Microsoft's fixed object id (oid), not by the e-mail, which can change (audit A07-002).
      const oid = String(c.oid || "");
      let u = oid ? db.prepare("SELECT id, active, ms_oid FROM users WHERE ms_oid = ?").get(oid) : null;
      if (!u) {
        u = db.prepare("SELECT id, active, ms_oid FROM users WHERE lower(email) = ?").get(email);
        if (u?.ms_oid && u.ms_oid !== oid) {
          audit(db, req, { user: db.prepare("SELECT id, name FROM users WHERE id = ?").get(u.id), action: "Ingreso fallido", ok: false, summary: `Microsoft 365: otra cuenta de Microsoft con el correo ${email}` });
          return back(res, "other_account");
        }
        if (u && oid) db.prepare("UPDATE users SET ms_oid = ? WHERE id = ?").run(oid, u.id);
      }
      if (!u && !db.prepare("SELECT COUNT(*) AS n FROM users").get().n) {
        // With SETUP_TOKEN set, the first account is created only from the setup form (audit A07-003).
        if (env.SETUP_TOKEN) return back(res, "setup_token");
        // First run: the first person of the firm's own directory becomes Gerencia.
        const id = db.prepare("INSERT INTO users (name, email, password_hash, role, ms_oid) VALUES (?, ?, '!', 'Gerencia', ?)").run(String(c.name || email), email, oid || null).lastInsertRowid;
        const main = db.prepare("SELECT id FROM offices WHERE is_main = 1").get();
        if (main) db.prepare("INSERT INTO user_offices (user_id, office_id) VALUES (?, ?)").run(id, main.id);
        u = { id, active: 1 };
      }
      if (!u) return back(res, "not_registered");
      if (!u.active) return back(res, "inactive");
      setSession(db, req, res, u.id);
      audit(db, req, { user: db.prepare("SELECT id, name FROM users WHERE id = ?").get(u.id), action: "Ingresó", summary: "Inicio de sesión con Microsoft 365" });
      back(res);
    } catch (err) {
      console.error("microsoft sign-in:", err);
      back(res, "failed");
    }
  });

  return r;
}
