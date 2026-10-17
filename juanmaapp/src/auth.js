// Users, roles, offices and sessions. Passwords are hashed with scrypt; a
// session is a random token in an HttpOnly cookie whose SHA-256 is stored.
// Mutating requests must carry the X-JuanMa header, which a cross-site form
// cannot send, so the cookie alone cannot be used for CSRF.
import { audit } from "./audit.js";
import express from "express";
import { microsoftEnabled } from "./microsoft.js";
import { VERSION } from "./version.js";
import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { publicBase } from "./public-url.js";
import { canonicalDepartment, canonicalCity } from "./places.js";
import { properAddress, properPhone } from "./person.js";
import { sendEmail, sendWhatsapp, channelsStatus, channelReady } from "./notify.js";
import { stamp, tsaUrl } from "./tsa.js";
import { createHash as hashOf } from "node:crypto";

// Built-in roles; the firm can add more in Usuarios › Roles y permisos.
export const ROLES = [
  "Gerencia",
  "Director Jurídico",
  "Director Contable",
  "Gerente Regional",
  "Abogado",
  "Dependiente Judicial",
  "Asistente",
];

export const PERMISSIONS = {
  "scope.all": "Ve todas las oficinas",
  "users.manage": "Gestiona usuarios, roles y oficinas",
  "catalog.manage": "Crea y configura tipos de proceso, subprocesos y campos (solo Gerencia)",
  "clients.write": "Crea y edita clientes",
  "clients.delete": "Elimina clientes (solo Gerencia)",
  "cases.write": "Crea y edita expedientes",
  "cases.delete": "Elimina expedientes (solo Gerencia)",
  "drafts.generate": "Genera borradores",
  "jurisprudence.use": "Usa el buscador de jurisprudencia",
  "import.run": "Importa datos desde Excel",
  "reports.view": "Ve y exporta reportes",
  "processes.consult": "Consulta procesos en la Rama Judicial y recibe reportes",
  "templates.manage": "Sube, descarga, reemplaza y crea plantillas de documentos (solo Gerencia)",
  "esign.use": "Envía documentos a firma electrónica",
  "mail.send": "Envía correo electrónico con trazabilidad",
  "payments.manage": "Registra cobros y recibos, maneja cartera y envía recordatorios de pago",
  "audit.view": "Ve la bitácora de auditoría (quién cambió qué, cuándo y desde qué dispositivo)",
};

// Starting matrix; Gerencia edits it in Usuarios › Roles.
export const DEFAULT_MATRIX = {
  "Gerencia": Object.keys(PERMISSIONS),
  "Director Jurídico": ["scope.all", "clients.write", "cases.write", "drafts.generate", "jurisprudence.use", "import.run", "reports.view", "processes.consult", "esign.use", "mail.send"],
  "Director Contable": ["scope.all", "reports.view", "payments.manage"],
  "Gerente Regional": ["clients.write", "cases.write", "drafts.generate", "jurisprudence.use", "import.run", "reports.view", "processes.consult", "esign.use", "mail.send", "payments.manage"],
  "Abogado": ["clients.write", "cases.write", "drafts.generate", "jurisprudence.use", "reports.view", "processes.consult", "esign.use", "mail.send"],
  "Dependiente Judicial": ["cases.write", "jurisprudence.use", "processes.consult", "mail.send"],
  "Asistente": ["clients.write", "cases.write", "drafts.generate", "payments.manage"],
};

// Deleting anything (change 24), creating process types, sub-processes and
// fields (version 2.9) and managing the Word templates (version 2.16) are for
// Gerencia, the administrator, only: these
// permissions are always on for Gerencia and never reach another role or a
// user's own checklist.
export const GERENCIA_ONLY = ["clients.delete", "cases.delete", "catalog.manage", "templates.manage"];
export const effectivePermissions = (role, perms) => {
  const p = perms.filter((x) => role === "Gerencia" || !GERENCIA_ONLY.includes(x));
  if (role === "Gerencia") for (const x of ["users.manage", ...GERENCIA_ONLY]) if (!p.includes(x)) p.push(x);
  return p;
};

// Version 2.11: a hidden user's actions read "Asistente"; the real name is seen only with
// the hidden-users password (Gerencia), and every user_id column keeps the real author.
export const ASSISTANT = "Asistente";
/** The user as everyone else sees them: hidden users go by "Asistente" (role and permissions unchanged). */
export const shownUser = (u) => (u?.hidden ? { ...u, name: ASSISTANT, real_name: u.name } : u);
const HIDDEN_UNLOCK_MS = 15 * 60 * 1000;
const hiddenUnlocks = new Map(); // session hash -> unlocked until (ms); a restart locks again
/** True while this Gerencia session entered the hidden-users password (15 minutes). */
export const hiddenUnlocked = (req) => req.user?.role === "Gerencia" && (hiddenUnlocks.get(req.sessionHash) || 0) > Date.now();

const SESSION_HOURS = 12;
const COOKIE = "jm_session";

// scrypt with OWASP's cost (N=2^17, r=8, p=1), run off the main thread; the parameters
// travel in the stored hash, and older hashes are upgraded at the next sign-in (audit A04-001).
const scryptN = () => 2 ** (Number(process.env.SCRYPT_LOG_N) || 17); // tests lower it to stay fast
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const scryptAsync = (pw, salt, len, o) => new Promise((ok, ko) => scrypt(pw, salt, len, { ...o, maxmem: SCRYPT_MAXMEM }, (e, k) => (e ? ko(e) : ok(k))));

export async function hashPassword(pw) {
  const salt = randomBytes(16), N = scryptN();
  const key = await scryptAsync(String(pw), salt, 64, { N, r: 8, p: 1 });
  return `scrypt2$${N}$8$1$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function checkPassword(pw, stored) {
  const parts = String(stored).split("$");
  let N = 16384, r = 8, p = 1, saltHex, hashHex;
  if (parts[0] === "scrypt" && parts.length === 3) [, saltHex, hashHex] = parts;
  else if (parts[0] === "scrypt2" && parts.length === 6) [N, r, p, saltHex, hashHex] = [Number(parts[1]), Number(parts[2]), Number(parts[3]), parts[4], parts[5]];
  else return false;
  if (!(N >= 1024 && N <= 2 ** 20 && r >= 1 && r <= 16 && p >= 1 && p <= 4)) return false;
  const want = Buffer.from(hashHex, "hex");
  const got = await scryptAsync(String(pw), Buffer.from(saltHex, "hex"), want.length, { N, r, p });
  return got.length === want.length && timingSafeEqual(want, got);
}
export const needsRehash = (stored) => /^scrypt/.test(String(stored)) && !String(stored).startsWith(`scrypt2$${scryptN()}$8$1$`);
// Unknown accounts take as long to answer as wrong passwords (audit A07-007).
let dummy = null;
const dummyHash = async () => (dummy ??= await hashPassword(randomBytes(12).toString("hex")));

const sha = (t) => createHash("sha256").update(t).digest("hex");
/** BEGIN … COMMIT, rolled back on any error so the single connection is never left inside a transaction (audit A10-002). */
export function inTransaction(db, fn) {
  db.exec("BEGIN");
  try { const out = fn(); db.exec("COMMIT"); return out; } catch (err) { db.exec("ROLLBACK"); throw err; }
}
const safeEqual = (a, b) => timingSafeEqual(Buffer.from(sha(String(a))), Buffer.from(sha(String(b))));
const str = (v) => (typeof v === "string" ? v.trim() : "");

// Too easy to guess even when long enough (audit A07-006).
const COMMON = new Set(["1234567890", "0123456789", "12345678910", "contraseña", "contrasena1", "password123", "qwertyuiop", "colombia123", "abogado123", "tecjuridicos",
  "1111111111", "abc1234567", "administrador", "iloveyou12", "1q2w3e4r5t", "asdfghjkl1", "contraseña1", "password12"]);
/** Why a new password is not acceptable, or "" when it is. */
export function passwordProblem(pw, { email = "", name = "" } = {}) {
  if (typeof pw !== "string" || pw.length < 10) return "La contraseña debe tener al menos 10 caracteres.";
  if (pw.length > 128) return "La contraseña puede tener máximo 128 caracteres.";
  const low = pw.toLowerCase();
  const words = [String(email).split("@")[0], ...String(name).split(/\s+/)].map((w) => w.toLowerCase()).filter((w) => w.length >= 4);
  if (COMMON.has(low) || /^(.)\1+$/.test(pw) || /^\d+$/.test(pw) || words.some((w) => low.includes(w)))
    return "Esa contraseña es fácil de adivinar: no use su nombre, su correo ni solo números; pruebe una frase de varias palabras.";
  return "";
}

// Failed sign-ins and reset requests are counted in the database, per account and per IP,
// so the limits survive restarts (audit A07-001, A06-002). Repeated lockouts grow longer.
function throttle(db) {
  const get = (key) => db.prepare("SELECT * FROM auth_throttle WHERE key = ?").get(key);
  return {
    wait(key) { const r = get(key); return r && r.until_ms > Date.now() ? Math.ceil((r.until_ms - Date.now()) / 60000) : 0; },
    fail(key, max, windowMs, lockMs) {
      const now = Date.now(), r = get(key);
      const n = r && r.first_ms > now - windowMs ? r.n + 1 : 1;
      const until = n >= max ? now + lockMs * 2 ** Math.min(n - max, 4) : 0;
      db.prepare(`INSERT INTO auth_throttle (key, n, first_ms, until_ms) VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET n = excluded.n, first_ms = CASE WHEN excluded.n = 1 THEN excluded.first_ms ELSE first_ms END, until_ms = excluded.until_ms`)
        .run(key, n, now, until);
      if (Math.random() < 0.02) db.prepare("DELETE FROM auth_throttle WHERE until_ms < ? AND first_ms < ?").run(now - 86400000, now - 86400000);
    },
    clear(key) { db.prepare("DELETE FROM auth_throttle WHERE key = ?").run(key); },
  };
}
// Personal mail providers: never the firm's Microsoft 365 directory.
const PUBLIC_MAIL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|aol|protonmail|proton|zoho|gmx)\.[a-z.]+$/i;
const passwordLoginOff = () => microsoftEnabled() && String(process.env.PASSWORD_LOGIN || "").toLowerCase() === "off";

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((p) => p.trim().split("=")).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
}

export const listRoles = (db) => db.prepare("SELECT name, builtin FROM roles ORDER BY builtin DESC, rowid").all().map((r) => r.name);
const roleExists = (db, name) => !!db.prepare("SELECT 1 FROM roles WHERE name = ?").get(name);

/** Permissions for a role from the stored matrix (Gerencia always keeps users.manage). */
export function rolePermissions(db, role) {
  const perms = db.prepare("SELECT permission FROM role_permissions WHERE role = ?").all(role).map((r) => r.permission);
  if (role === "Gerencia" && !perms.includes("users.manage")) perms.push("users.manage");
  return perms;
}

export function loadUser(db, id) {
  const row = db.prepare(`SELECT id, name, email, phone, professional_card, role, active, custom_permissions, created_at, must_change_password, invited_at,
    password_hash != '!' AS has_password, hidden FROM users WHERE id = ?`).get(id);
  if (!row) return null;
  const u = { ...row, must_change_password: !!row.must_change_password, has_password: !!row.has_password, hidden: !!row.hidden };
  const offices = db.prepare(`SELECT o.id, o.name FROM user_offices uo JOIN offices o ON o.id = uo.office_id
    WHERE uo.user_id = ? ORDER BY o.is_main DESC, o.name`).all(id).map((o) => ({ ...o }));
  // A user's own checklist replaces the role's when it is turned on.
  const permissions = u.custom_permissions
    ? db.prepare("SELECT permission FROM user_permissions WHERE user_id = ?").all(id).map((r) => r.permission)
    : rolePermissions(db, u.role);
  return { ...u, active: !!u.active, custom_permissions: !!u.custom_permissions, offices, permissions: effectivePermissions(u.role, permissions) };
}

/** Office ids a user may see, or null for every office. */
export function scopeOf(user) {
  return user.permissions.includes("scope.all") ? null : user.offices.map((o) => o.id);
}

export function sessionMiddleware(db) {
  return (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      // Sessions end after 12 hours, or after SESSION_IDLE_HOURS (default 4) without use (audit A07-005).
      const s = db.prepare(`SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')
        AND (last_seen IS NULL OR last_seen > datetime('now', ?))`).get(sha(token), `-${Number(process.env.SESSION_IDLE_HOURS) || 4} hours`);
      const u = s && loadUser(db, s.user_id);
      if (u?.active) {
        req.user = shownUser(u);
        req.sessionHash = sha(token);
        db.prepare("UPDATE sessions SET last_seen = datetime('now') WHERE token_hash = ? AND (last_seen IS NULL OR last_seen < datetime('now', '-1 minute'))").run(req.sessionHash);
      }
    }
    next();
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Inicie sesión para continuar." });
  if (req.method !== "GET" && req.get("X-JuanMa") !== "1") {
    return res.status(403).json({ error: "Solicitud no permitida." });
  }
  if (req.method === "DELETE" && req.user.role !== "Gerencia") return res.status(403).json({ error: "Solo Gerencia puede eliminar." });
  next();
}

export const can = (req, perm) => !!req.user?.permissions.includes(perm);

export function requirePerm(perm) {
  return (req, res, next) => (can(req, perm) ? next() : res.status(403).json({ error: "Su rol no tiene permiso para esta acción." }));
}

export function setSession(db, req, res, userId) {
  const token = randomBytes(32).toString("base64url");
  db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at, last_seen) VALUES (?, ?, datetime('now', '+${SESSION_HOURS} hours'), datetime('now'))`)
    .run(sha(token), userId);
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  const secure = req.secure || process.env.COOKIE_SECURE === "1" ? "; Secure" : "";
  res.append("Set-Cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure}`);
}

export function authRouter(db) {
  const r = express.Router();
  const t = throttle(db);
  // The same anti-forgery header as the rest of the API, also for sign-in and sign-out (audit A01-005).
  r.use((req, res, next) => (req.method === "POST" && req.get("X-JuanMa") !== "1" ? res.status(403).json({ error: "Solicitud no permitida." }) : next()));
  const failures = new Map(); // email -> { n, until }

  r.get("/status", (req, res) => {
    const hasUsers = db.prepare("SELECT COUNT(*) AS n FROM users").get().n > 0;
    res.json({ setupNeeded: !hasUsers, setupToken: !hasUsers && !!process.env.SETUP_TOKEN, passwordLogin: !passwordLoginOff(), user: req.user ? { ...req.user, name: req.user.real_name || req.user.name } : null, microsoft: microsoftEnabled(), version: VERSION });
  });

  // First run only: create the Gerencia account.
  r.post("/setup", async (req, res) => {
    if (db.prepare("SELECT COUNT(*) AS n FROM users").get().n > 0) return res.status(409).json({ error: "La app ya está configurada." });
    const b = req.body ?? {};
    // With SETUP_TOKEN set, only whoever knows it can create the first Gerencia account (audit A07-003).
    if (process.env.SETUP_TOKEN && !safeEqual(str(b.setup_token), process.env.SETUP_TOKEN)) return res.status(403).json({ error: "El código de instalación no es correcto." });
    const name = str(b.name), email = str(b.email).toLowerCase();
    if (!name || !email.includes("@")) return res.status(400).json({ error: "Nombre y correo son obligatorios." });
    const bad = passwordProblem(b.password, { email, name });
    if (bad) return res.status(400).json({ error: bad });
    const hash = await hashPassword(b.password);
    if (db.prepare("SELECT COUNT(*) AS n FROM users").get().n > 0) return res.status(409).json({ error: "La app ya está configurada." });
    const id = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'Gerencia')")
      .run(name, email, hash).lastInsertRowid;
    const main = db.prepare("SELECT id FROM offices WHERE is_main = 1").get();
    if (main) db.prepare("INSERT INTO user_offices (user_id, office_id) VALUES (?, ?)").run(id, main.id);
    setSession(db, req, res, id);
    audit(db, req, { user: { id, name }, action: "Configuró", summary: "Creó la cuenta inicial de Gerencia" });
    res.status(201).json({ user: loadUser(db, id) });
  });

  r.post("/login", async (req, res) => {
    if (passwordLoginOff()) return res.status(403).json({ error: "En esta firma se ingresa solo con la cuenta de Microsoft 365." });
    const email = str(req.body?.email).toLowerCase().slice(0, 200), ip = String(req.ip || "");
    const wait = Math.max(t.wait(`email:${email}`), t.wait(`ip:${ip}`));
    if (wait) {
      audit(db, req, { user: null, action: "Ingreso bloqueado", ok: false, summary: `Demasiados intentos (${email})` });
      return res.status(429).json({ error: `Demasiados intentos. Espere ${wait} minuto(s).` });
    }
    const u = db.prepare("SELECT id, name, password_hash, active FROM users WHERE email = ?").get(email);
    const pw = String(req.body?.password ?? "").slice(0, 200);
    const ok = u?.active && u.password_hash !== "!" ? await checkPassword(pw, u.password_hash) : (await checkPassword(pw, await dummyHash()), false);
    if (!ok) {
      t.fail(`email:${email}`, 5, 10 * 60000, 10 * 60000);
      t.fail(`ip:${ip}`, 20, 15 * 60000, 15 * 60000);
      audit(db, req, { user: u ? { id: u.id, name: u.name } : null, action: "Ingreso fallido", ok: false, summary: `${u ? (u.active ? "Contraseña incorrecta" : "Usuario inactivo") : "Correo no registrado"}: ${email}` });
      return res.status(401).json({ error: "Correo o contraseña incorrectos." });
    }
    t.clear(`email:${email}`);
    if (needsRehash(u.password_hash)) db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(pw), u.id);
    setSession(db, req, res, u.id);
    const user = loadUser(db, u.id);
    audit(db, req, { user, action: "Ingresó", summary: "Inicio de sesión con contraseña" });
    res.json({ user });
  });

  r.post("/logout", (req, res) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha(token));
    if (req.user) audit(db, req, { action: "Salió", summary: "Cerró sesión" });
    res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.status(204).end();
  });

  // Forgotten password: an e-mailed link valid for 30 minutes. The answer is the same
  // whether or not the e-mail is registered, so it cannot be used to find accounts.
  r.post("/forgot", async (req, res) => {
    const email = str(req.body?.email).toLowerCase().slice(0, 200), ip = String(req.ip || "");
    const reply = () => res.json({ ok: true, message: "Si el correo está registrado, le llegará un enlace para crear una contraseña nueva." });
    if (!email.includes("@")) return res.status(400).json({ error: "Escriba su correo." });
    // One e-mail per account every 5 minutes and 10 requests per IP an hour.
    if (t.wait(`forgot:${email}`) || t.wait(`forgot-ip:${ip}`)) return reply();
    t.fail(`forgot:${email}`, 1, 5 * 60000, 5 * 60000);
    t.fail(`forgot-ip:${ip}`, 10, 60 * 60000, 60 * 60000);
    const u = db.prepare("SELECT id, name, active, password_hash FROM users WHERE email = ?").get(email);
    if (!u?.active) return reply();
    // Accounts that enter with Microsoft 365 do not get a local password, which would skip Microsoft's MFA (audit A07-006).
    // Only people who already entered with Microsoft 365 (their account is bound) stay without a local password;
    // an invited user with Gmail or Outlook can always create theirs.
    if (passwordLoginOff() || (u.password_hash === "!" && microsoftEnabled() && db.prepare("SELECT ms_oid FROM users WHERE id = ?").get(u.id)?.ms_oid)) return reply();
    audit(db, req, { user: u, action: "Pidió restablecer contraseña", summary: `Enlace enviado a ${email}` });
    const token = randomBytes(24).toString("base64url");
    db.prepare("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 minutes'))").run(sha(token), u.id);
    const base = publicBase(req);
    const link = `${base}/#restablecer-${token}`;
    // Sent without waiting, so the answer takes the same time whether or not the account exists (audit A07-007).
    sendEmail(email, "Crear una contraseña nueva · TecjuridicosApp",
      `Hola ${u.name}:\n\nPara crear una contraseña nueva abra este enlace (vence en 30 minutos):\n${link}\n\nSi usted no lo pidió, ignore este mensaje: su contraseña no cambia.\n\nTecjuridicosApp`,
      `<p>Hola ${u.name.replace(/[<>&]/g, "")}:</p><p>Para crear una contraseña nueva abra este enlace (vence en 30 minutos):</p><p><a href="${link}">Crear contraseña nueva</a></p><p style="color:#666;font-size:12px">Si usted no lo pidió, ignore este mensaje: su contraseña no cambia.</p>`)
      .catch((err) => console.error("forgot e-mail:", err.message));
    reply();
  });

  r.post("/reset", async (req, res) => {
    const row = db.prepare("SELECT * FROM password_resets WHERE token_hash = ?").get(sha(str(req.body?.token)));
    if (!row || row.used_at || Date.parse(row.expires_at.replace(" ", "T") + "Z") < Date.now()) {
      return res.status(400).json({ error: "El enlace venció o ya se usó. Pida uno nuevo." });
    }
    const who = db.prepare("SELECT email, name FROM users WHERE id = ?").get(row.user_id);
    const bad = passwordProblem(req.body?.password, who || {});
    if (bad) return res.status(400).json({ error: bad });
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(await hashPassword(req.body.password), row.user_id);
    db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").run(row.user_id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.user_id);
    setSession(db, req, res, row.user_id);
    const user = loadUser(db, row.user_id);
    audit(db, req, { user, action: "Creó contraseña", summary: "Contraseña creada con enlace de restablecimiento o invitación" });
    res.json({ user });
  });

  // Change one's own e-mail (confirmed with the current password when the account has one).
  r.post("/email", requireAuth, async (req, res) => {
    const email = str(req.body?.email).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Escriba un correo válido." });
    const row = db.prepare("SELECT email, password_hash FROM users WHERE id = ?").get(req.user.id);
    // Without a password there is nothing to confirm with: Gerencia changes it in Usuarios (audit A07-005).
    if (row.password_hash === "!") return res.status(403).json({ error: "Su cuenta ingresa con Microsoft 365: pida a Gerencia que cambie su correo en Usuarios." });
    if (!(await checkPassword(req.body?.password ?? "", row.password_hash))) {
      return res.status(400).json({ error: "La contraseña actual no es correcta." });
    }
    if (email === row.email) return res.status(400).json({ error: "Ese ya es su correo." });
    if (db.prepare("SELECT 1 FROM users WHERE email = ? AND id != ?").get(email, req.user.id)) return res.status(409).json({ error: "Ese correo ya está registrado por otro usuario." });
    db.prepare("UPDATE users SET email = ? WHERE id = ?").run(email, req.user.id);
    audit(db, req, { action: "Cambió su correo", module: "Acceso", entity: "cuenta", record_id: req.user.id, summary: "Cambió el correo de su cuenta",
      changes: [{ field: "email", label: "Correo", before: row.email, after: email }] });
    sendEmail(row.email, "Su correo en TecjuridicosApp cambió",
      `Hola ${req.user.name}: el correo de su cuenta en TecjuridicosApp cambió a ${email}. Si usted no hizo este cambio, avise de inmediato a Gerencia.`,
      `<p>Hola ${req.user.name.replace(/[<>&]/g, "")}: el correo de su cuenta en TecjuridicosApp cambió a <strong>${email}</strong>. Si usted no hizo este cambio, avise de inmediato a Gerencia.</p>`)
      .catch((err) => console.error("e-mail change notice:", err.message));
    res.json({ user: loadUser(db, req.user.id) });
  });

  r.post("/password", requireAuth, async (req, res) => {
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);
    if (!(await checkPassword(req.body?.current ?? "", row.password_hash))) return res.status(400).json({ error: "La contraseña actual no es correcta." });
    const bad = passwordProblem(req.body?.next, req.user);
    if (bad) return res.status(400).json({ error: bad });
    if (req.body?.next === req.body?.current) return res.status(400).json({ error: "La nueva contraseña debe ser distinta de la actual." });
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(await hashPassword(req.body.next), req.user.id);
    // Other devices signed in with the old password are signed out (audit A07-005).
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(req.user.id, req.sessionHash || "");
    audit(db, req, { action: "Cambió su contraseña", summary: "Cambió su contraseña" });
    res.status(204).end();
  });

  return r;
}

/** Gerencia-only administration: users, role matrix, offices. Offices are readable by everyone signed in. */
export function adminRouter(db) {
  const r = express.Router();
  const manage = requirePerm("users.manage");

  // ----- Delivery channels: status and a test message -----
  r.get("/channels", manage, (req, res) => {
    const c = channelsStatus();
    res.json({ ...c, from: process.env.MAIL_FROM || "", whatsapp_template: process.env.WHATSAPP_TEMPLATE || "", whatsapp_template_otp: process.env.WHATSAPP_TEMPLATE_OTP || "",
      whatsapp_lang: process.env.WHATSAPP_LANG || "es", tsa_url: tsaUrl() });
  });
  r.post("/test-tsa", manage, async (req, res) => {
    const digest = hashOf("sha256").update(`Prueba de sello de tiempo ${new Date().toISOString()}`).digest("hex");
    const r2 = await stamp(digest);
    res.json({ ok: r2.ok, url: r2.url || tsaUrl(), detail: r2.ok ? `Sello concedido: ${r2.genTime || "hora en el sello"}` : r2.detail });
  });
  r.post("/test-channel", manage, async (req, res) => {
    const to = str(req.body?.to);
    if (req.body?.channel === "whatsapp") {
      if (to.replace(/\D/g, "").length < 10) return res.status(400).json({ error: "Escriba el celular para la prueba." });
      return res.json(await sendWhatsapp(to, `Mensaje de prueba de TecjuridicosApp enviado por ${req.user.name}. Si lo recibe, WhatsApp quedó configurado.`));
    }
    if (!to.includes("@")) return res.status(400).json({ error: "Escriba el correo para la prueba." });
    res.json(await sendEmail(to, "Prueba de correo · TecjuridicosApp", `Mensaje de prueba enviado por ${req.user.name}. Si lo recibe, el correo de la app quedó configurado.`,
      `<p>Mensaje de prueba enviado por <strong>${req.user.name.replace(/[<>&]/g, "")}</strong>. Si lo recibe, el correo de la app quedó configurado.</p>`));
  });

  // ----- Offices -----
  const officeOut = (o) => ({ ...o, is_main: !!o.is_main });
  r.get("/offices", (req, res) => {
    res.json(db.prepare(`SELECT o.*, (SELECT COUNT(*) FROM cases WHERE office_id = o.id) AS case_count,
      (SELECT COUNT(*) FROM user_offices WHERE office_id = o.id) AS user_count
      FROM offices o ORDER BY o.is_main DESC, o.name`).all().map(officeOut));
  });

  const officeFields = (b) => {
    const department = canonicalDepartment(b.department);
    return { name: str(b.name), department, city: canonicalCity(b.city, department), address: properAddress(b.address), phone: properPhone(b.phone), email: str(b.email) };
  };

  r.post("/offices", manage, (req, res) => {
    const o = officeFields(req.body ?? {});
    if (!o.name) return res.status(400).json({ error: "El nombre de la oficina es obligatorio." });
    try {
      const id = db.prepare("INSERT INTO offices (name, department, city, address, phone, email) VALUES (:name, :department, :city, :address, :phone, :email)").run(o).lastInsertRowid;
      res.status(201).json(officeOut(db.prepare("SELECT * FROM offices WHERE id = ?").get(id)));
    } catch {
      res.status(409).json({ error: "Ya existe una oficina con ese nombre." });
    }
  });

  r.put("/offices/:id", manage, (req, res) => {
    const id = Number(req.params.id);
    const cur = db.prepare("SELECT * FROM offices WHERE id = ?").get(id);
    if (!cur) return res.status(404).json({ error: "La oficina no existe." });
    const o = { ...officeFields({ ...cur, ...req.body }), id };
    if (!o.name) return res.status(400).json({ error: "El nombre de la oficina es obligatorio." });
    try {
      db.prepare("UPDATE offices SET name = :name, department = :department, city = :city, address = :address, phone = :phone, email = :email WHERE id = :id").run(o);
      if (req.body?.is_main === true) {
        inTransaction(db, () => {
          db.prepare("UPDATE offices SET is_main = 0").run();
          db.prepare("UPDATE offices SET is_main = 1 WHERE id = ?").run(id);
        });
      }
      res.json(officeOut(db.prepare("SELECT * FROM offices WHERE id = ?").get(id)));
    } catch {
      res.status(409).json({ error: "Ya existe una oficina con ese nombre." });
    }
  });

  r.delete("/offices/:id", manage, (req, res) => {
    const id = Number(req.params.id);
    const o = db.prepare("SELECT * FROM offices WHERE id = ?").get(id);
    if (!o) return res.status(404).json({ error: "La oficina no existe." });
    if (o.is_main) return res.status(409).json({ error: "No se puede eliminar la oficina principal." });
    const used = db.prepare("SELECT (SELECT COUNT(*) FROM cases WHERE office_id = ?) + (SELECT COUNT(*) FROM clients WHERE office_id = ?) AS n").get(id, id).n;
    if (used) return res.status(409).json({ error: "La oficina tiene clientes o expedientes. Reasígnelos antes de eliminarla." });
    db.prepare("DELETE FROM offices WHERE id = ?").run(id);
    res.status(204).end();
  });

  // ----- Users -----
  // Directory (id, name, role, offices) for assignment pickers: any signed-in user.
  r.get("/users/directory", (req, res) => {
    const ids = db.prepare("SELECT id FROM users WHERE active = 1 ORDER BY name").all().map((u) => u.id);
    res.json(ids.map((id) => {
      const u = loadUser(db, id), shown = !u.hidden || hiddenUnlocked(req);
      return { id: u.id, name: shown ? u.name : ASSISTANT, role: shown ? u.role : ASSISTANT, offices: u.offices, scopeAll: u.permissions.includes("scope.all") };
    }));
  });

  // Hidden users are left out of the list until Gerencia enters the hidden-users password.
  r.get("/users", manage, (req, res) => {
    const all = hiddenUnlocked(req);
    res.json(db.prepare(`SELECT id FROM users ${all ? "" : "WHERE hidden = 0"} ORDER BY active DESC, name`).all().map((u) => loadUser(db, u.id)));
  });

  // ----- Hidden users (version 2.11): Gerencia only, behind their own password -----
  const gerencia = (req, res, next) => (req.user.role === "Gerencia" ? next() : res.status(403).json({ error: "Solo Gerencia puede ocultar usuarios." }));
  const hiddenPass = () => { try { return JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'hidden_users'").get()?.value || "{}").hash || ""; } catch { return ""; } };
  const tries = throttle(db);
  r.get("/hidden-users", manage, (req, res) => {
    const until = hiddenUnlocked(req) ? hiddenUnlocks.get(req.sessionHash) : 0;
    res.json({ count: db.prepare("SELECT COUNT(*) AS n FROM users WHERE hidden = 1").get().n, has_password: !!hiddenPass(),
      unlocked: !!until, unlocked_until: until ? new Date(until).toISOString() : null, can_manage: req.user.role === "Gerencia" });
  });
  r.post("/hidden-users/password", gerencia, async (req, res) => {
    const b = req.body ?? {}, cur = hiddenPass();
    if (cur && !(await checkPassword(String(b.current || ""), cur))) {
      audit(db, req, { action: "Intentó cambiar la contraseña de usuarios ocultos", module: "Usuarios", ok: false, summary: "Contraseña actual incorrecta" });
      return res.status(403).json({ error: "La contraseña actual de usuarios ocultos no es correcta." });
    }
    const bad = passwordProblem(b.next);
    if (bad) return res.status(400).json({ error: bad });
    db.prepare("INSERT INTO settings (key, value) VALUES ('hidden_users', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify({ hash: await hashPassword(b.next), set_at: new Date().toISOString(), set_by: req.user.id }));
    hiddenUnlocks.clear(); // every open view of hidden users closes
    audit(db, req, { action: cur ? "Cambió la contraseña de usuarios ocultos" : "Creó la contraseña de usuarios ocultos", module: "Usuarios", summary: "Contraseña de usuarios ocultos" });
    res.status(204).end();
  });
  r.post("/hidden-users/unlock", gerencia, async (req, res) => {
    const key = `hidden:${req.user.id}`, wait = tries.wait(key);
    if (wait) return res.status(429).json({ error: `Demasiados intentos. Espere ${wait} minuto(s).` });
    const cur = hiddenPass();
    if (!cur) return res.status(409).json({ error: "Primero cree la contraseña de usuarios ocultos." });
    if (!(await checkPassword(String(req.body?.password || ""), cur))) {
      tries.fail(key, 5, 15 * 60 * 1000, 15 * 60 * 1000);
      audit(db, req, { action: "Intentó ver usuarios ocultos", module: "Usuarios", ok: false, summary: "Contraseña de usuarios ocultos incorrecta" });
      return res.status(403).json({ error: "La contraseña de usuarios ocultos no es correcta." });
    }
    tries.clear(key);
    hiddenUnlocks.set(req.sessionHash, Date.now() + HIDDEN_UNLOCK_MS);
    audit(db, req, { action: "Vio usuarios ocultos", module: "Usuarios", summary: "Abrió la vista de usuarios ocultos por 15 minutos" });
    res.json({ ok: true, unlocked_until: new Date(Date.now() + HIDDEN_UNLOCK_MS).toISOString() });
  });
  r.post("/hidden-users/lock", manage, (req, res) => {
    hiddenUnlocks.delete(req.sessionHash);
    res.status(204).end();
  });
  // Hide needs the password to exist; showing a hidden user again needs the view unlocked.
  r.put("/users/:id/hidden", gerencia, (req, res) => {
    const id = Number(req.params.id), hide = req.body?.hidden === true;
    const u = db.prepare("SELECT id, hidden FROM users WHERE id = ?").get(id);
    if (!u || (u.hidden && !hiddenUnlocked(req))) return res.status(404).json({ error: "El usuario no existe." });
    if (hide && !hiddenPass()) return res.status(409).json({ error: "Primero cree la contraseña de usuarios ocultos." });
    if (!hide && !hiddenUnlocked(req)) return res.status(403).json({ error: "Escriba la contraseña de usuarios ocultos para mostrar este usuario." });
    db.prepare("UPDATE users SET hidden = ? WHERE id = ?").run(hide ? 1 : 0, id);
    audit(db, req, { action: hide ? "Ocultó un usuario" : "Volvió a mostrar un usuario", module: "Usuarios", entity: "usuario", record_id: id,
      summary: hide ? "Ocultó un usuario: sus acciones se ven como «Asistente»" : "Volvió a mostrar un usuario oculto" });
    res.json(loadUser(db, id));
  });

  const setUserPermissions = (userId, custom, perms) => {
    if (custom === undefined) return;
    db.prepare("UPDATE users SET custom_permissions = ? WHERE id = ?").run(custom ? 1 : 0, userId);
    db.prepare("DELETE FROM user_permissions WHERE user_id = ?").run(userId);
    if (!custom) return;
    const ins = db.prepare("INSERT INTO user_permissions (user_id, permission) VALUES (?, ?)");
    for (const p of new Set((perms || []).filter((p) => p in PERMISSIONS))) ins.run(userId, p);
  };

  const setOffices = (userId, officeIds) => {
    const valid = new Set(db.prepare("SELECT id FROM offices").all().map((o) => o.id));
    db.prepare("DELETE FROM user_offices WHERE user_id = ?").run(userId);
    const ins = db.prepare("INSERT INTO user_offices (user_id, office_id) VALUES (?, ?)");
    for (const oid of new Set((officeIds || []).map(Number))) if (valid.has(oid)) ins.run(userId, oid);
  };

  // Invitation by e-mail: a private link (72 hours, one use) to create one's own password.
  // The password itself never travels by e-mail.
  async function invite(req, userId) {
    const u = db.prepare("SELECT id, name, email FROM users WHERE id = ?").get(userId);
    const token = randomBytes(24).toString("base64url");
    db.prepare("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+72 hours'))").run(sha(token), u.id);
    const base = publicBase(req);
    const link = `${base}/#invitacion-${token}`;
    const ms = microsoftEnabled() ? `\nTambién puede ingresar con su cuenta de Microsoft 365 (${u.email}) con el botón «Ingresar con la cuenta de Microsoft».` : "";
    const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
    const r = await sendEmail(u.email, "Invitación a TecjuridicosApp · TEC Jurídicos",
      `Hola ${u.name}:\n\n${req.user.name} le dio acceso a TecjuridicosApp, la aplicación de gestión de TEC Jurídicos.\n\nSu usuario es: ${u.email}\nCree su contraseña con este enlace (vence en 72 horas y sirve una sola vez):\n${link}${ms}\n\nSi no esperaba este mensaje, ignórelo.\n\nTecjuridicosApp`,
      `<div style="font-family:Arial,sans-serif;color:#101010"><p>Hola ${esc(u.name)}:</p><p><strong>${esc(req.user.name)}</strong> le dio acceso a <strong>TecjuridicosApp</strong>, la aplicación de gestión de TEC Jurídicos.</p>
       <p>Su usuario es: <strong>${esc(u.email)}</strong></p>
       <p><a href="${esc(link)}" style="display:inline-block;background:#002b6a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Crear mi contraseña</a></p>
       <p style="color:#666;font-size:12px">El enlace vence en 72 horas y sirve una sola vez.${microsoftEnabled() ? " También puede ingresar con su cuenta de Microsoft 365." : ""} Si no esperaba este mensaje, ignórelo.</p></div>`);
    if (r.ok) db.prepare("UPDATE users SET invited_at = datetime('now') WHERE id = ?").run(u.id);
    return r;
  }

  r.post("/users/:id/invite", manage, async (req, res) => {
    const u = db.prepare("SELECT id, active, hidden FROM users WHERE id = ?").get(Number(req.params.id));
    if (!u || (u.hidden && !hiddenUnlocked(req))) return res.status(404).json({ error: "El usuario no existe." });
    if (!u.active) return res.status(400).json({ error: "El usuario está inactivo: actívelo antes de invitarlo." });
    const r = await invite(req, u.id);
    res.status(r.ok ? 200 : 502).json(r.ok ? { ok: true, detail: r.detail, user: loadUser(db, u.id) } : { error: `No se envió la invitación: ${r.detail}` });
  });

  r.post("/users", manage, async (req, res) => {
    const b = req.body ?? {};
    const name = str(b.name), email = str(b.email).toLowerCase();
    if (!name || !email.includes("@")) return res.status(400).json({ error: "Nombre y correo son obligatorios." });
    if (!roleExists(db, b.role)) return res.status(400).json({ error: "Rol no válido." });
    // The password is optional when the user will create it from the invitation, or enter with Microsoft.
    // Any e-mail works (Gmail, Outlook, Hotmail or the firm's): such a user enters with a password,
    // assigned here or created from the invitation. Only an address of the firm's own domain may
    // go without one, to enter with Microsoft 365 (change 53).
    if (!b.password && b.invite && !channelReady("email")) return res.status(400).json({ error: "El servidor todavía no envía correos (falta configurar el correo de Microsoft 365): asigne una contraseña temporal y entréguesela al usuario." });
    const firmMail = microsoftEnabled() && !PUBLIC_MAIL.test(email.split("@")[1] || "");
    if (!b.password && !b.invite && !firmMail) return res.status(400).json({ error: `El correo ${email} no es de la cuenta Microsoft 365 de la firma: asigne una contraseña temporal o marque «Enviar invitación por correo».` });
    const noPassword = !b.password && (firmMail || !!b.invite);
    // Only Gerencia creates Gerencia accounts (audit A01-004).
    if (b.role === "Gerencia" && req.user.role !== "Gerencia") return res.status(403).json({ error: "Solo Gerencia puede crear usuarios de Gerencia." });
    const pwBad = noPassword ? "" : passwordProblem(b.password, { email, name });
    if (pwBad && b.password) return res.status(400).json({ error: pwBad });
    if (pwBad) return res.status(400).json({ error: microsoftEnabled()
      ? "La contraseña inicial debe tener al menos 10 caracteres, o déjela vacía para que ingrese solo con su cuenta de Microsoft."
      : "Asigne una contraseña de al menos 10 caracteres o marque «Enviar invitación por correo» para que el usuario cree la suya." });
    if (!Array.isArray(b.office_ids) || !b.office_ids.length) return res.status(400).json({ error: "Asigne al menos una oficina." });
    let id;
    try {
      // A password Gerencia assigns is temporary: the user changes it at the first sign-in.
      id = db.prepare("INSERT INTO users (name, email, phone, professional_card, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(name, email, properPhone(b.phone), str(b.professional_card), noPassword ? "!" : await hashPassword(b.password), b.role, noPassword ? 0 : 1).lastInsertRowid;
      setOffices(id, b.office_ids);
      setUserPermissions(id, b.custom_permissions, b.permissions);
    } catch {
      return res.status(409).json({ error: "Ya existe un usuario con ese correo." });
    }
    const sent = b.invite ? await invite(req, id) : null;
    res.status(201).json({ ...loadUser(db, id), invitation: sent ? { ok: sent.ok, detail: sent.detail } : null });
  });

  r.put("/users/:id", manage, async (req, res) => {
    const id = Number(req.params.id);
    const cur = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (!cur || (cur.hidden && !hiddenUnlocked(req))) return res.status(404).json({ error: "El usuario no existe." });
    const b = req.body ?? {};
    const role = b.role ?? cur.role;
    if (!roleExists(db, role)) return res.status(400).json({ error: "Rol no válido." });
    // Only Gerencia gives the Gerencia role or changes a Gerencia account (audit A01-004).
    if ((cur.role === "Gerencia" || role === "Gerencia") && req.user.role !== "Gerencia") return res.status(403).json({ error: "Solo Gerencia puede modificar usuarios de Gerencia." });
    const active = b.active === undefined ? !!cur.active : !!b.active;
    // Never leave the firm without an active Gerencia account.
    if (cur.role === "Gerencia" && (role !== "Gerencia" || !active)) {
      const others = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'Gerencia' AND active = 1 AND id != ?").get(id).n;
      if (!others) return res.status(409).json({ error: "Debe quedar al menos un usuario activo de Gerencia." });
    }
    if (b.password && passwordProblem(b.password, { email: cur.email, name: cur.name })) return res.status(400).json({ error: passwordProblem(b.password, { email: cur.email, name: cur.name }) });
    if (Array.isArray(b.office_ids) && !b.office_ids.length) return res.status(400).json({ error: "Asigne al menos una oficina." });
    const email = b.email ? str(b.email).toLowerCase() : cur.email;
    try {
      db.prepare("UPDATE users SET name = ?, email = ?, phone = ?, professional_card = ?, role = ?, active = ? WHERE id = ?")
        .run(str(b.name) || cur.name, email, "phone" in b ? properPhone(b.phone) : cur.phone,
          "professional_card" in b ? str(b.professional_card) : cur.professional_card, role, active ? 1 : 0, id);
    } catch {
      return res.status(409).json({ error: "Ya existe un usuario con ese correo." });
    }
    if (b.password) {
      // Assigned by Gerencia to someone else: temporary until that user changes it.
      db.prepare("UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?").run(await hashPassword(b.password), id === req.user.id ? 0 : 1, id);
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    }
    if (!active) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    if (Array.isArray(b.office_ids)) setOffices(id, b.office_ids);
    setUserPermissions(id, b.custom_permissions, b.permissions);
    res.json(loadUser(db, id));
  });

  // ----- Roles -----
  r.get("/roles", (req, res) => {
    const roles = db.prepare(`SELECT r.name, r.builtin, (SELECT COUNT(*) FROM users WHERE role = r.name) AS users
      FROM roles r ORDER BY r.builtin DESC, r.rowid`).all().map((x) => ({ ...x, builtin: !!x.builtin }));
    res.json({
      roles: roles.map((x) => x.name),
      details: roles,
      permissions: PERMISSIONS,
      matrix: Object.fromEntries(roles.map((x) => [x.name, rolePermissions(db, x.name)])),
    });
  });

  r.post("/roles", manage, (req, res) => {
    const name = str(req.body?.name);
    if (!name || name.length > 60) return res.status(400).json({ error: "Escriba el nombre del rol (máximo 60 caracteres)." });
    if (roleExists(db, name)) return res.status(409).json({ error: "Ya existe un rol con ese nombre." });
    const from = str(req.body?.copy_from);
    db.prepare("INSERT INTO roles (name, builtin) VALUES (?, 0)").run(name);
    if (from && roleExists(db, from)) {
      const ins = db.prepare("INSERT INTO role_permissions (role, permission) VALUES (?, ?)");
      for (const p of rolePermissions(db, from)) if (p !== "users.manage" || from !== "Gerencia") ins.run(name, p);
    }
    res.status(201).json({ role: name, permissions: rolePermissions(db, name) });
  });

  r.put("/roles/:role", manage, (req, res) => {
    const role = req.params.role;
    if (!roleExists(db, role)) return res.status(404).json({ error: "Rol no válido." });
    const newName = str(req.body?.name);
    if (newName && newName !== role) {
      const builtin = db.prepare("SELECT builtin FROM roles WHERE name = ?").get(role).builtin;
      if (builtin) return res.status(409).json({ error: "Los roles incluidos no se pueden renombrar." });
      if (roleExists(db, newName)) return res.status(409).json({ error: "Ya existe un rol con ese nombre." });
      inTransaction(db, () => {
        db.prepare("UPDATE roles SET name = ? WHERE name = ?").run(newName, role);
        db.prepare("UPDATE role_permissions SET role = ? WHERE role = ?").run(newName, role);
        db.prepare("UPDATE users SET role = ? WHERE role = ?").run(newName, role);
      });
      return res.json({ role: newName, permissions: rolePermissions(db, newName) });
    }
    if (!Array.isArray(req.body?.permissions)) return res.status(400).json({ error: "Faltan los permisos." });
    const perms = req.body.permissions.filter((p) => p in PERMISSIONS);
    if (role === "Gerencia" && !perms.includes("users.manage")) perms.push("users.manage");
    inTransaction(db, () => {
      db.prepare("DELETE FROM role_permissions WHERE role = ?").run(role);
      const ins = db.prepare("INSERT INTO role_permissions (role, permission) VALUES (?, ?)");
      for (const p of new Set(perms)) ins.run(role, p);
    });
    res.json({ role, permissions: rolePermissions(db, role) });
  });

  r.delete("/roles/:role", manage, (req, res) => {
    const row = db.prepare("SELECT builtin FROM roles WHERE name = ?").get(req.params.role);
    if (!row) return res.status(404).json({ error: "Rol no válido." });
    if (row.builtin) return res.status(409).json({ error: "Los roles incluidos no se pueden eliminar." });
    if (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = ?").get(req.params.role).n) {
      return res.status(409).json({ error: "Hay usuarios con este rol. Cámbielos de rol antes de eliminarlo." });
    }
    db.prepare("DELETE FROM role_permissions WHERE role = ?").run(req.params.role);
    db.prepare("DELETE FROM roles WHERE name = ?").run(req.params.role);
    res.status(204).end();
  });

  return r;
}
