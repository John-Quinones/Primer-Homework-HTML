// Users, roles, offices and sessions. Passwords are hashed with scrypt; a
// session is a random token in an HttpOnly cookie whose SHA-256 is stored.
// Mutating requests must carry the X-JuanMa header, which a cross-site form
// cannot send, so the cookie alone cannot be used for CSRF.
import express from "express";
import { microsoftEnabled } from "./microsoft.js";
import { VERSION } from "./version.js";
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { canonicalDepartment, canonicalCity } from "./places.js";
import { sendEmail, sendWhatsapp, channelsStatus } from "./notify.js";
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
  "catalog.manage": "Configura tipos de proceso, subprocesos y campos",
  "clients.write": "Crea y edita clientes",
  "clients.delete": "Elimina clientes (solo Gerencia)",
  "cases.write": "Crea y edita expedientes",
  "cases.delete": "Elimina expedientes (solo Gerencia)",
  "drafts.generate": "Genera borradores",
  "jurisprudence.use": "Usa el buscador de jurisprudencia",
  "import.run": "Importa datos desde Excel",
  "reports.view": "Ve y exporta reportes",
  "processes.consult": "Consulta procesos en la Rama Judicial y recibe reportes",
  "templates.manage": "Crea, carga y edita plantillas de documentos",
  "esign.use": "Envía documentos a firma electrónica",
  "mail.send": "Envía correo electrónico con trazabilidad",
  "payments.manage": "Registra cobros y recibos, maneja cartera y envía recordatorios de pago",
};

// Starting matrix; Gerencia edits it in Usuarios › Roles.
export const DEFAULT_MATRIX = {
  "Gerencia": Object.keys(PERMISSIONS),
  "Director Jurídico": ["scope.all", "catalog.manage", "clients.write", "cases.write", "drafts.generate", "jurisprudence.use", "import.run", "reports.view", "processes.consult", "templates.manage", "esign.use", "mail.send"],
  "Director Contable": ["scope.all", "reports.view", "payments.manage"],
  "Gerente Regional": ["clients.write", "cases.write", "drafts.generate", "jurisprudence.use", "import.run", "reports.view", "processes.consult", "esign.use", "mail.send", "payments.manage"],
  "Abogado": ["clients.write", "cases.write", "drafts.generate", "jurisprudence.use", "reports.view", "processes.consult", "esign.use", "mail.send"],
  "Dependiente Judicial": ["cases.write", "jurisprudence.use", "processes.consult", "mail.send"],
  "Asistente": ["clients.write", "cases.write", "drafts.generate", "payments.manage"],
};

// Deleting anything is for Gerencia only (change 24): these permissions are
// always on for Gerencia and never reach another role or a user's own checklist.
export const GERENCIA_ONLY = ["clients.delete", "cases.delete"];
export const effectivePermissions = (role, perms) => {
  const p = perms.filter((x) => role === "Gerencia" || !GERENCIA_ONLY.includes(x));
  if (role === "Gerencia") for (const x of ["users.manage", ...GERENCIA_ONLY]) if (!p.includes(x)) p.push(x);
  return p;
};

const SESSION_HOURS = 12;
const COOKIE = "jm_session";

export function hashPassword(pw) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(pw, salt, 64).toString("hex")}`;
}

export function checkPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split("$");
  if (alg !== "scrypt" || !saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, "hex");
  const got = scryptSync(String(pw), Buffer.from(saltHex, "hex"), want.length);
  return timingSafeEqual(want, got);
}

const sha = (t) => createHash("sha256").update(t).digest("hex");
const str = (v) => (typeof v === "string" ? v.trim() : "");

function validPassword(pw) {
  return typeof pw === "string" && pw.length >= 10;
}

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
  const u = db.prepare("SELECT id, name, email, phone, professional_card, role, active, custom_permissions, created_at FROM users WHERE id = ?").get(id);
  if (!u) return null;
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
      const s = db.prepare("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')").get(sha(token));
      const u = s && loadUser(db, s.user_id);
      if (u?.active) req.user = u;
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
  db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_HOURS} hours'))`)
    .run(sha(token), userId);
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  const secure = req.secure || process.env.COOKIE_SECURE === "1" ? "; Secure" : "";
  res.append("Set-Cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure}`);
}

export function authRouter(db) {
  const r = express.Router();
  const failures = new Map(); // email -> { n, until }

  r.get("/status", (req, res) => {
    const hasUsers = db.prepare("SELECT COUNT(*) AS n FROM users").get().n > 0;
    res.json({ setupNeeded: !hasUsers, user: req.user || null, microsoft: microsoftEnabled(), version: VERSION });
  });

  // First run only: create the Gerencia account.
  r.post("/setup", (req, res) => {
    if (db.prepare("SELECT COUNT(*) AS n FROM users").get().n > 0) return res.status(409).json({ error: "La app ya está configurada." });
    const b = req.body ?? {};
    const name = str(b.name), email = str(b.email).toLowerCase();
    if (!name || !email.includes("@")) return res.status(400).json({ error: "Nombre y correo son obligatorios." });
    if (!validPassword(b.password)) return res.status(400).json({ error: "La contraseña debe tener al menos 10 caracteres." });
    const id = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'Gerencia')")
      .run(name, email, hashPassword(b.password)).lastInsertRowid;
    const main = db.prepare("SELECT id FROM offices WHERE is_main = 1").get();
    if (main) db.prepare("INSERT INTO user_offices (user_id, office_id) VALUES (?, ?)").run(id, main.id);
    setSession(db, req, res, id);
    res.status(201).json({ user: loadUser(db, id) });
  });

  r.post("/login", (req, res) => {
    const email = str(req.body?.email).toLowerCase();
    const f = failures.get(email);
    if (f && f.n >= 5 && f.until > Date.now()) {
      return res.status(429).json({ error: "Demasiados intentos. Espere 10 minutos." });
    }
    const u = db.prepare("SELECT id, password_hash, active FROM users WHERE email = ?").get(email);
    if (!u || !u.active || !checkPassword(req.body?.password ?? "", u.password_hash)) {
      const n = (f && f.until > Date.now() ? f.n : 0) + 1;
      failures.set(email, { n, until: Date.now() + 10 * 60 * 1000 });
      return res.status(401).json({ error: "Correo o contraseña incorrectos." });
    }
    failures.delete(email);
    setSession(db, req, res, u.id);
    res.json({ user: loadUser(db, u.id) });
  });

  r.post("/logout", (req, res) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha(token));
    res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.status(204).end();
  });

  // Forgotten password: an e-mailed link valid for 30 minutes. The answer is the same
  // whether or not the e-mail is registered, so it cannot be used to find accounts.
  const resetSent = new Map(); // email -> last request time
  r.post("/forgot", async (req, res) => {
    const email = str(req.body?.email).toLowerCase();
    const reply = () => res.json({ ok: true, message: "Si el correo está registrado, le llegará un enlace para crear una contraseña nueva." });
    if (!email.includes("@")) return res.status(400).json({ error: "Escriba su correo." });
    const last = resetSent.get(email);
    if (last && last > Date.now() - 5 * 60 * 1000) return reply();
    resetSent.set(email, Date.now());
    const u = db.prepare("SELECT id, name, active FROM users WHERE email = ?").get(email);
    if (!u?.active) return reply();
    const token = randomBytes(24).toString("base64url");
    db.prepare("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 minutes'))").run(sha(token), u.id);
    const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
    const link = `${base}/#restablecer-${token}`;
    await sendEmail(email, "Crear una contraseña nueva · TecjuridicosApp",
      `Hola ${u.name}:\n\nPara crear una contraseña nueva abra este enlace (vence en 30 minutos):\n${link}\n\nSi usted no lo pidió, ignore este mensaje: su contraseña no cambia.\n\nTecjuridicosApp`,
      `<p>Hola ${u.name.replace(/[<>&]/g, "")}:</p><p>Para crear una contraseña nueva abra este enlace (vence en 30 minutos):</p><p><a href="${link}">Crear contraseña nueva</a></p><p style="color:#666;font-size:12px">Si usted no lo pidió, ignore este mensaje: su contraseña no cambia.</p>`);
    reply();
  });

  r.post("/reset", (req, res) => {
    const row = db.prepare("SELECT * FROM password_resets WHERE token_hash = ?").get(sha(str(req.body?.token)));
    if (!row || row.used_at || Date.parse(row.expires_at.replace(" ", "T") + "Z") < Date.now()) {
      return res.status(400).json({ error: "El enlace venció o ya se usó. Pida uno nuevo." });
    }
    if (!validPassword(req.body?.password)) return res.status(400).json({ error: "La contraseña debe tener al menos 10 caracteres." });
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(req.body.password), row.user_id);
    db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").run(row.user_id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.user_id);
    setSession(db, req, res, row.user_id);
    res.json({ user: loadUser(db, row.user_id) });
  });

  // Change one's own e-mail (confirmed with the current password when the account has one).
  r.post("/email", requireAuth, async (req, res) => {
    const email = str(req.body?.email).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Escriba un correo válido." });
    const row = db.prepare("SELECT email, password_hash FROM users WHERE id = ?").get(req.user.id);
    if (row.password_hash !== "!" && !checkPassword(req.body?.password ?? "", row.password_hash)) {
      return res.status(400).json({ error: "La contraseña actual no es correcta." });
    }
    if (email === row.email) return res.status(400).json({ error: "Ese ya es su correo." });
    if (db.prepare("SELECT 1 FROM users WHERE email = ? AND id != ?").get(email, req.user.id)) return res.status(409).json({ error: "Ese correo ya está registrado por otro usuario." });
    db.prepare("UPDATE users SET email = ? WHERE id = ?").run(email, req.user.id);
    sendEmail(row.email, "Su correo en TecjuridicosApp cambió",
      `Hola ${req.user.name}: el correo de su cuenta en TecjuridicosApp cambió a ${email}. Si usted no hizo este cambio, avise de inmediato a Gerencia.`,
      `<p>Hola ${req.user.name.replace(/[<>&]/g, "")}: el correo de su cuenta en TecjuridicosApp cambió a <strong>${email}</strong>. Si usted no hizo este cambio, avise de inmediato a Gerencia.</p>`).catch(() => {});
    res.json({ user: loadUser(db, req.user.id) });
  });

  r.post("/password", requireAuth, (req, res) => {
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);
    if (!checkPassword(req.body?.current ?? "", row.password_hash)) return res.status(400).json({ error: "La contraseña actual no es correcta." });
    if (!validPassword(req.body?.next)) return res.status(400).json({ error: "La nueva contraseña debe tener al menos 10 caracteres." });
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(req.body.next), req.user.id);
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
    return { name: str(b.name), department, city: canonicalCity(b.city, department), address: str(b.address), phone: str(b.phone), email: str(b.email) };
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
        db.exec("BEGIN");
        db.prepare("UPDATE offices SET is_main = 0").run();
        db.prepare("UPDATE offices SET is_main = 1 WHERE id = ?").run(id);
        db.exec("COMMIT");
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
      const u = loadUser(db, id);
      return { id: u.id, name: u.name, role: u.role, offices: u.offices, scopeAll: u.permissions.includes("scope.all") };
    }));
  });

  r.get("/users", manage, (req, res) => {
    res.json(db.prepare("SELECT id FROM users ORDER BY active DESC, name").all().map((u) => loadUser(db, u.id)));
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

  r.post("/users", manage, (req, res) => {
    const b = req.body ?? {};
    const name = str(b.name), email = str(b.email).toLowerCase();
    if (!name || !email.includes("@")) return res.status(400).json({ error: "Nombre y correo son obligatorios." });
    if (!roleExists(db, b.role)) return res.status(400).json({ error: "Rol no válido." });
    // With Microsoft sign-in the password is optional: the user then enters only with their Microsoft account.
    const noPassword = !b.password && microsoftEnabled();
    if (!noPassword && !validPassword(b.password)) return res.status(400).json({ error: microsoftEnabled()
      ? "La contraseña inicial debe tener al menos 10 caracteres, o déjela vacía para que ingrese solo con su cuenta de Microsoft."
      : "La contraseña inicial debe tener al menos 10 caracteres." });
    if (!Array.isArray(b.office_ids) || !b.office_ids.length) return res.status(400).json({ error: "Asigne al menos una oficina." });
    try {
      const id = db.prepare("INSERT INTO users (name, email, phone, professional_card, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)")
        .run(name, email, str(b.phone), str(b.professional_card), noPassword ? "!" : hashPassword(b.password), b.role).lastInsertRowid;
      setOffices(id, b.office_ids);
      setUserPermissions(id, b.custom_permissions, b.permissions);
      res.status(201).json(loadUser(db, id));
    } catch {
      res.status(409).json({ error: "Ya existe un usuario con ese correo." });
    }
  });

  r.put("/users/:id", manage, (req, res) => {
    const id = Number(req.params.id);
    const cur = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (!cur) return res.status(404).json({ error: "El usuario no existe." });
    const b = req.body ?? {};
    const role = b.role ?? cur.role;
    if (!roleExists(db, role)) return res.status(400).json({ error: "Rol no válido." });
    const active = b.active === undefined ? !!cur.active : !!b.active;
    // Never leave the firm without an active Gerencia account.
    if (cur.role === "Gerencia" && (role !== "Gerencia" || !active)) {
      const others = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'Gerencia' AND active = 1 AND id != ?").get(id).n;
      if (!others) return res.status(409).json({ error: "Debe quedar al menos un usuario activo de Gerencia." });
    }
    if (b.password && !validPassword(b.password)) return res.status(400).json({ error: "La contraseña debe tener al menos 10 caracteres." });
    if (Array.isArray(b.office_ids) && !b.office_ids.length) return res.status(400).json({ error: "Asigne al menos una oficina." });
    const email = b.email ? str(b.email).toLowerCase() : cur.email;
    try {
      db.prepare("UPDATE users SET name = ?, email = ?, phone = ?, professional_card = ?, role = ?, active = ? WHERE id = ?")
        .run(str(b.name) || cur.name, email, "phone" in b ? str(b.phone) : cur.phone,
          "professional_card" in b ? str(b.professional_card) : cur.professional_card, role, active ? 1 : 0, id);
    } catch {
      return res.status(409).json({ error: "Ya existe un usuario con ese correo." });
    }
    if (b.password) {
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(b.password), id);
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
      db.exec("BEGIN");
      db.prepare("UPDATE roles SET name = ? WHERE name = ?").run(newName, role);
      db.prepare("UPDATE role_permissions SET role = ? WHERE role = ?").run(newName, role);
      db.prepare("UPDATE users SET role = ? WHERE role = ?").run(newName, role);
      db.exec("COMMIT");
      return res.json({ role: newName, permissions: rolePermissions(db, newName) });
    }
    if (!Array.isArray(req.body?.permissions)) return res.status(400).json({ error: "Faltan los permisos." });
    const perms = req.body.permissions.filter((p) => p in PERMISSIONS);
    if (role === "Gerencia" && !perms.includes("users.manage")) perms.push("users.manage");
    db.exec("BEGIN");
    db.prepare("DELETE FROM role_permissions WHERE role = ?").run(role);
    const ins = db.prepare("INSERT INTO role_permissions (role, permission) VALUES (?, ?)");
    for (const p of new Set(perms)) ins.run(role, p);
    db.exec("COMMIT");
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
