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
  const back = (res, error) => res.redirect(302, error ? `/?ms_error=${encodeURIComponent(error)}` : "/");

  r.get("/start", (req, res) => {
    if (!microsoftEnabled()) return back(res, "El inicio de sesión con Microsoft no está configurado en el servidor.");
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
      if (!microsoftEnabled()) return back(res, "El inicio de sesión con Microsoft no está configurado en el servidor.");
      if (req.query.error) return back(res, req.query.error === "access_denied" ? "Se canceló el inicio de sesión con Microsoft." : `Microsoft no permitió el ingreso (${String(req.query.error_description || req.query.error).slice(0, 160)}).`);
      let saved = null;
      try { saved = JSON.parse(cookies(req)[STATE_COOKIE] || "null"); } catch { saved = null; }
      if (!saved?.state || saved.state !== req.query.state || !req.query.code) return back(res, "El inicio de sesión venció o no es válido. Intente de nuevo.");

      const tokenRes = await fetchImpl(`https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET, grant_type: "authorization_code",
          code: String(req.query.code), redirect_uri: redirectUri(req), code_verifier: saved.verifier, scope: "openid profile email",
        }),
      });
      const tok = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok) return back(res, tok.error === "invalid_client" ? "La clave de la app en Microsoft (secreto) no es válida o venció." : "Microsoft no confirmó el ingreso. Intente de nuevo.");

      const c = claimsOf(tok.id_token);
      const ok = c.aud === env.MS_CLIENT_ID && c.tid === env.MS_TENANT_ID && c.iss === `https://login.microsoftonline.com/${c.tid}/v2.0`
        && c.nonce === saved.nonce && Number(c.exp) * 1000 > Date.now() - 300000;
      if (!ok) return back(res, "La respuesta de Microsoft no es válida.");
      const email = String(c.email || c.preferred_username || "").toLowerCase();
      if (!email.includes("@")) return back(res, "Su cuenta de Microsoft no tiene correo.");

      let u = db.prepare("SELECT id, active FROM users WHERE lower(email) = ?").get(email);
      if (!u && !db.prepare("SELECT COUNT(*) AS n FROM users").get().n) {
        // First run: the first person of the firm's own directory becomes Gerencia.
        const id = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, '!', 'Gerencia')").run(String(c.name || email), email).lastInsertRowid;
        const main = db.prepare("SELECT id FROM offices WHERE is_main = 1").get();
        if (main) db.prepare("INSERT INTO user_offices (user_id, office_id) VALUES (?, ?)").run(id, main.id);
        u = { id, active: 1 };
      }
      if (!u) audit(db, req, { user: null, action: "Ingreso fallido", ok: false, summary: `Microsoft 365: ${email} no está registrado` });
      if (!u) return back(res, `La cuenta ${email} no está registrada en TecjuridicosApp. Pida a Gerencia que cree su usuario con ese mismo correo.`);
      if (!u.active) return back(res, "Su usuario de TecjuridicosApp está inactivo.");
      setSession(db, req, res, u.id);
      audit(db, req, { user: db.prepare("SELECT id, name FROM users WHERE id = ?").get(u.id), action: "Ingresó", summary: "Inicio de sesión con Microsoft 365" });
      back(res);
    } catch (err) {
      console.error("microsoft sign-in:", err);
      back(res, "No se pudo completar el ingreso con Microsoft.");
    }
  });

  return r;
}
