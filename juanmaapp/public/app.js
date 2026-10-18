// TecjuridicosApp front end. Talks to the Express API; the preview build swaps in
// an in-browser backend by defining window.JuanmaBackend before this script.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Backend ----------
const httpBackend = {
  async request(method, url, body) {
    const res = await fetch("/api" + url, {
      method,
      headers: { "X-JuanMa": "1", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !url.startsWith("/auth/")) showAuth();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },
  // Yields NDJSON events from /api/generate.
  async *generate(payload) {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-JuanMa": "1" },
      body: JSON.stringify(payload),
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line) yield JSON.parse(line);
      }
    }
  },
};
const backend = window.JuanmaBackend || httpBackend;
const api = (method, url, body) => backend.request(method, url, body);
if (window.JuanmaBackend) $("#demo-badge").hidden = false;
// Published link: users pick their name to sign in; passwords belong to the installed app.
const WEB = !!window.JuanmaBackend?.web;
if (WEB) {
  $$(".pw-field").forEach((l) => l.remove());
  $("#login-form").remove();
  $("#forgot-form").remove();
  $("#reset-form").remove();
  $('[data-action="change-password"]')?.remove();
  $("#email-dialog [data-pw-only]")?.remove();
  $$("#user-dialog [data-pw-only]").forEach((el) => el.remove());
}

// ---------- Shared state ----------
const state = { catalog: [], clients: [], cases: [], selectedClientId: null };

async function loadCatalog() { state.catalog = await api("GET", "/catalog"); }
async function loadClients(q = "", by = $("#client-search-by")?.value || "") {
  state.clients = await api("GET", `/clients?${new URLSearchParams({ q, by })}`);
}
async function loadCases() { state.cases = await api("GET", "/cases"); }

const categoryOf = (catId) => state.catalog.find((c) => c.id === Number(catId));
// Folder number of a case: the "No. Carpeta" custom field of its process type
// (also spelled "Carpeta", "N° de carpeta", "Número de carpeta").
const isFolderField = (f) => /^(n|no|nro|num|numero)?(de)?carpeta$/.test(f.label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, ""));
const caseFolder = (k) => {
  for (const f of categoryOf(k.category_id)?.fields ?? []) {
    const v = isFolderField(f) && String(k.field_values?.[f.id] ?? "").trim();
    if (v) return v;
  }
  return "";
};
/** «Asignar carpeta» / «Editar carpeta» (version 2.18), for whoever can edit cases. */
const folderButton = (k, cls = "mini") => can("cases.write")
  ? `<button type="button" class="${cls}" data-action="edit-folder" data-id="${k.id}" data-folder="${escapeHtml(caseFolder(k))}">${caseFolder(k) ? "Editar carpeta" : "Asignar carpeta"}</button>` : "";
const typeById = (typeId) => {
  for (const c of state.catalog) {
    const t = c.types.find((t) => t.id === Number(typeId));
    if (t) return { ...t, category: c };
  }
  return null;
};

function toast(msg, isError = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.toggle("error", isError);
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 3200);
}

async function guarded(fn) {
  try { await fn(); } catch (err) { toast(err.message, true); }
}

// ---------- Session & permissions ----------
let me = null;
// PDF building (text → PDF, signature certificate, stamped signed document): public/pdf-tools.js, shared with the signer page.
const { markdownToPdf, signatureCertificate, signedPdf } = window.JuanmaPdf;
let offices = [];
let directory = [];
const can = (perm) => !!me?.permissions.includes(perm);
const myOfficeIds = () => (can("scope.all") ? offices.map((o) => o.id) : me.offices.map((o) => o.id));
const myOffices = () => offices.filter((o) => myOfficeIds().includes(o.id));

const VIEW_PERMS = {
  firmas: "esign.use",
  correo: "mail.send",
  pagos: "payments.manage",
  consulta: "processes.consult",
  radicados: "cases.write",
  borradores: "drafts.generate", jurisprudencia: "jurisprudence.use", reportes: "reports.view",
  importar: "import.run", configuracion: "catalog.manage", usuarios: "users.manage", bitacora: "audit.view",
};

// Only Gerencia deletes (change 24); every delete button carries data-action="delete-…" or data-jact="delete-…".
const isGerencia = () => me?.role === "Gerencia";
// Gerencia-only permissions (src/auth.js GERENCIA_ONLY): deleting, creating process types, sub-processes and fields, and managing templates.
const GERENCIA_PERMS = ["clients.delete", "cases.delete", "catalog.manage", "templates.manage"];

// What each shortcut of the side menu does (shown under its name, and as a tooltip).
const NAV_DESC = {
  inicio: "Resumen del día: audiencias, vencimientos y avisos",
  clientes: "Datos de cada cliente y sus expedientes",
  expedientes: "Procesos: partes, despacho, tareas y estado",
  agenda: "Audiencias, términos y tareas por funcionario",
  consulta: "Actuaciones nuevas en la Rama Judicial",
  despachos: "Juzgados y tribunales con su correo",
  borradores: "Contratos, poderes y escritos con los datos del cliente",
  firmas: "Enviar documentos a firma electrónica",
  pagos: "Cobros, recibos, cartera y recordatorios",
  correo: "Correo con constancia de entrega y lectura",
  jurisprudencia: "Sentencias de las altas cortes",
  reportes: "Informes en Excel o PDF",
  importar: "Cargar clientes y procesos desde Excel",
  configuracion: "Tipos de proceso, campos y canales de envío",
  bitacora: "Quién cambió qué, cuándo y desde qué equipo",
  usuarios: "Usuarios, roles, permisos y oficinas",
};
for (const a of $$(".sidenav a[data-view]")) {
  const d = NAV_DESC[a.dataset.view];
  const label = a.querySelector("span");
  if (!d || !label) continue;
  a.title = d;
  label.outerHTML = `<span class="nav-text"><span>${escapeHtml(label.textContent)}</span><small class="nav-desc">${escapeHtml(d)}</small></span>`;
}

function applyPermissions() {
  document.body.classList.toggle("is-gerencia", isGerencia());
  $$(".sidenav a").forEach((a) => (a.hidden = !!VIEW_PERMS[a.dataset.view] && !can(VIEW_PERMS[a.dataset.view])));
  // Buttons that need a permission carry data-perm (set when rendered) or are matched here.
  const needs = { "new-receipt": "payments.manage", "new-charge": "payments.manage", "new-sign": "esign.use", "new-mail": "mail.send", "new-client": "clients.write", "new-case": "cases.write", "new-task": "cases.write", "add-radicado": "cases.write" };
  $$("[data-action]").forEach((b) => { if (needs[b.dataset.action]) b.hidden = !can(needs[b.dataset.action]); });
  $("#user-name").textContent = me.name;
  $("#user-role").textContent = me.role;
  $("#user-initials").textContent = me.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  $("#courts-import-btn").hidden = !can("catalog.manage");
  // Creating process types and sub-processes from the case form or an import is for Gerencia only.
  $$("[data-new-cat], [data-new-type]").forEach((b) => (b.hidden = !can("catalog.manage")));
  const createCat = $("#import-create-catalog");
  createCat.disabled = !can("catalog.manage");
  if (createCat.disabled) createCat.checked = false;
  $("#portal-probe").hidden = !can("users.manage");
  $("#tpl-manage-bar").hidden = !can("templates.manage");
  $("#tpl-drop").hidden = !can("templates.manage");
  $$('[data-tpl-out="sign"], [data-out="sign"]').forEach((b) => (b.hidden = !can("esign.use")));
  $$('[data-tpl-out="mail"]').forEach((b) => (b.hidden = !can("mail.send")));
  $("#user-offices").textContent = can("scope.all") ? "Todas las oficinas" : `Oficina: ${me.offices.map((o) => o.name).join(", ")}`;
}

async function loadSessionData() {
  [offices, directory] = await Promise.all([api("GET", "/admin/offices"), api("GET", "/admin/users/directory")]);
}

function showAuth(status = {}) {
  me = null;
  $("#app-root").hidden = true;
  $("#auth-screen").hidden = false;
  // PASSWORD_LOGIN=off on the server: only the Microsoft 365 button (its MFA applies to everyone).
  if ($("#login-form")) $("#login-form").hidden = !!status.setupNeeded || status.passwordLogin === false;
  $("#setup-form").hidden = !status.setupNeeded;
  $("[data-setup-token]").hidden = !status.setupToken;
  // Microsoft 365 sign-in (installed app with MS_* settings).
  $("#ms-login").hidden = !(status.microsoft ?? authInfo.microsoft);
  $("[data-ms-label]").textContent = status.setupNeeded ? "Crear la cuenta de Gerencia con Microsoft" : "Ingresar con la cuenta de Microsoft";
  // Fixed messages only: the code in the address cannot put arbitrary text on this screen (audit A06-003).
  const MS_ERRORS = {
    not_configured: "El inicio de sesión con Microsoft no está configurado en el servidor.", cancelled: "Se canceló el inicio de sesión con Microsoft.",
    denied: "Microsoft no permitió el ingreso. Intente de nuevo o consulte al administrador de Microsoft 365.", expired: "El inicio de sesión venció o no es válido. Intente de nuevo.",
    secret: "La clave de la app en Microsoft (secreto) no es válida o venció. Avise a Gerencia.", not_confirmed: "Microsoft no confirmó el ingreso. Intente de nuevo.",
    invalid: "La respuesta de Microsoft no es válida.", no_email: "Su cuenta de Microsoft no tiene correo.",
    guest: "Las cuentas invitadas de otras organizaciones no pueden ingresar. Use su cuenta de la firma.",
    not_registered: "Su cuenta de Microsoft no está registrada en TecjuridicosApp. Pida a Gerencia que cree su usuario con ese mismo correo.",
    other_account: "Ese correo ya está vinculado a otra cuenta de Microsoft. Avise a Gerencia.", inactive: "Su usuario de TecjuridicosApp está inactivo.",
    setup_token: "La cuenta inicial de Gerencia se crea con el formulario y el código de instalación.", failed: "No se pudo completar el ingreso con Microsoft.",
  };
  const msCode = new URLSearchParams(location.search).get("ms_error");
  const msError = msCode ? MS_ERRORS[msCode] || MS_ERRORS.failed : "";
  $("#ms-error").hidden = !msError;
  $("#ms-error").textContent = msError;
  if (msCode) history.replaceState(null, "", location.pathname + location.hash);
  $("#sign-code-form").hidden = !(WEB && backend.signLink) || !!status.setupNeeded;
  const demo = backend.demoUsers?.();
  $("#demo-logins").hidden = !demo?.length || !!status.setupNeeded;
  if (demo) {
    $("#demo-logins .demo-grid").innerHTML = demo.map((u) =>
      `<button type="button" data-demo-login="${escapeHtml(u.email)}"><strong>${escapeHtml(u.role)}</strong><span>${escapeHtml(u.name)} · ${escapeHtml(u.office)}</span></button>`).join("");
  }
}

// Version 2.13: a case-law search sent from the test link ("#jurisprudencia?q=…") survives the sign-in,
// also the round trip through Microsoft, which drops the address after "#".
const JURIS_PENDING = "juanma.pendingJuris";
if (/^#jurisprudencia\?/.test(location.hash)) try { sessionStorage.setItem(JURIS_PENDING, location.hash); } catch {}

async function enterApp(user, { fresh = true } = {}) {
  me = user;
  let pending = "";
  try { pending = sessionStorage.getItem(JURIS_PENDING) || ""; sessionStorage.removeItem(JURIS_PENDING); } catch {}
  // A new sign-in starts on Inicio; a page reload keeps the current section.
  if (pending) history.replaceState(null, "", location.pathname + location.search + pending);
  else if (fresh) history.replaceState(null, "", "#inicio");
  await loadSessionData();
  $("#auth-screen").hidden = true;
  $("#app-root").hidden = false;
  applyPermissions();
  window.JuanmaCombo.wirePlaces(document);
  await Promise.all([loadCatalog(), loadAreas()]);
  startBell();
  await showView();
  if (me.must_change_password && !WEB) openForcedPasswordChange();
  else showNewsOnce();
}

// «Novedades de la versión»: shown the first time each user enters a new version (change 62).
function showNewsOnce() {
  const v = authInfo.version || {};
  if (!v.name || !v.news?.length) return;
  const key = `juanma.newsSeen.${me.id}`;
  try { if (localStorage.getItem(key) === v.name) return; } catch {}
  const dlg = $("#news-dialog");
  $$("[data-news-number]", dlg).forEach((el) => { el.textContent = v.name; });
  $("[data-news-date]", dlg).textContent = v.date ? `Publicada el ${v.date.split("-").reverse().join("/")}` : "";
  $(".news-list", dlg).innerHTML = v.news.map((c) => `<li class="${c.n === v.name ? "is-current" : ""}">
    <span class="news-n">${escapeHtml(c.n)}</span>
    <p><strong>${escapeHtml(c.title)}</strong>${c.n === v.name ? ' <span class="news-tag">Actual</span>' : ""}
    <em>${escapeHtml(c.text)}${c.n === v.name ? "" : ` · ${escapeHtml(c.date)}`}</em></p></li>`).join("");
  dlg.addEventListener("close", () => { try { localStorage.setItem(key, v.name); } catch {} }, { once: true });
  dlg.showModal();
}
$("#news-dialog [data-action=news-close]").addEventListener("click", () => $("#news-dialog").close());

// A temporary password assigned by Gerencia must be replaced before working.
function openForcedPasswordChange() {
  const dlg = $("#password-dialog");
  openDialog(dlg, "Cambiar contraseña");
  $("[data-must-change]", dlg).hidden = false;
  $("button[value=cancel]", dlg).hidden = true;
  dlg.dataset.forced = "1";
}
$("#password-dialog").addEventListener("cancel", (e) => { if (e.currentTarget.dataset.forced) e.preventDefault(); });

let authInfo = {};
async function boot() {
  const st = await api("GET", "/auth/status");
  authInfo = st;
  // Which numbered change of the project is running (see CAMBIOS.md).
  const v = st.version || {};
  const label = v.name ? `Versión ${v.name}${v.date ? " · " + v.date.split("-").reverse().join("/") : ""}` : "";
  $$("[data-version]").forEach((el) => { el.textContent = label; el.title = v.sha ? `Versión ${v.sha}` : ""; });
  // Technical version line at the foot of the side menu (change 63).
  $$("[data-version-tech]").forEach((el) => {
    el.hidden = !v.name;
    el.title = v.sha ? `Versión ${v.sha}` : "";
    el.querySelector("[data-version-number]").textContent = v.name || "";
    el.querySelector("[data-version-short]").textContent = v.date ? v.date.slice(2).split("-").reverse().join(".") : "";
  });
  // Version seal on the sign-in screen (change 62).
  $$("[data-version-seal]").forEach((el) => {
    el.hidden = !v.name;
    el.title = v.sha ? `Versión ${v.sha}` : "";
    el.querySelector("[data-version-number]").textContent = v.name || "";
    el.querySelector("[data-version-date]").textContent = v.date ? `Actualizada el ${v.date.split("-").reverse().join("/")}` : "";
  });
  // A password-reset link (#restablecer-TOKEN) opens the form to create a new password.
  // A signer's link on the test link (#firmar-CODE) opens the signing page, without signing in.
  const signTok = location.hash.match(/^#firmar-([\w-]+)$/);
  if (signTok && WEB) return openSignerPage(signTok[1]);
  const reset = location.hash.match(/^#(restablecer|invitacion)-([\w-]+)$/);
  if (reset && $("#reset-form")) {
    showAuth(st);
    $("#login-form").hidden = true;
    $("#reset-form").hidden = false;
    $("#reset-form").dataset.token = reset[2];
    $("[data-reset-note]").textContent = reset[1] === "invitacion"
      ? "Bienvenido(a) a TecjuridicosApp. Cree su contraseña (mínimo 10 caracteres) para ingresar."
      : "Cree su contraseña nueva (mínimo 10 caracteres).";
    history.replaceState(null, "", location.pathname);
    return;
  }
  if (st.user) await enterApp(st.user, { fresh: false });
  else showAuth(st);
}

// ----- Forgotten password (installed app) -----
const authSwap = (show) => { for (const id of ["#login-form", "#forgot-form", "#reset-form"]) if ($(id)) $(id).hidden = id !== show; };
$("#forgot-open")?.addEventListener("click", () => authSwap("#forgot-form"));
$("#forgot-back")?.addEventListener("click", () => authSwap("#login-form"));
$("#forgot-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $(".form-error", e.target);
  err.hidden = true;
  try {
    const out = await api("POST", "/auth/forgot", formData(e.target));
    err.textContent = out.message;
    err.hidden = false;
    err.classList.add("ok");
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
});
$("#reset-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, err = $(".form-error", f);
  err.hidden = true;
  try {
    if (f.elements.password.value !== f.elements.again.value) throw new Error("Las dos contraseñas no coinciden.");
    const out = await api("POST", "/auth/reset", { token: f.dataset.token, password: f.elements.password.value });
    f.reset();
    toast("Contraseña nueva guardada.");
    await enterApp(out.user);
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
});

// ----- Signer's page on the test link (change 61): request code + one-time code, no sign-in -----
let signerToken = "", signerPad = null;
$("#sign-code-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const err = $(".form-error", e.target);
  const code = e.target.elements.token.value.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (code.length !== 8) { err.textContent = "El código de la solicitud tiene 8 letras y números (ej. ABCD-EFGH)."; err.hidden = false; return; }
  err.hidden = true;
  guarded(() => openSignerPage(code));
});
function signerMsg(text, isErr = false) { const m = $("#ps-msg"); m.hidden = !text; m.textContent = text || ""; m.classList.toggle("error", isErr); }
function renderSigner(v) {
  $("#ps-doc").hidden = false;
  $("#ps-title").textContent = v.title;
  $("#ps-intro").textContent = v.message || `Documento para la firma de ${v.signer.name}.`;
  $("#ps-hash").textContent = v.doc_hash;
  if (v.doc_kind === "markdown") $("#ps-text").innerHTML = DOMPurify.sanitize(marked.parse(v.doc_text || ""));
  $("#ps-done").hidden = !v.signed;
  const pending = v.signer.status === "pendiente" && v.request_status === "enviada";
  $("#ps-sign").hidden = !pending;
  const via = v.signer.otp_channel === "whatsapp" && v.signer.phone ? `WhatsApp al celular ${v.signer.phone}` : `correo ${v.signer.email}`;
  $("#ps-otp-note").textContent = `${v.signer.name}: escriba el código de verificación de 6 dígitos que le llegó por ${via}, su nombre completo y dibuje su firma.`;
  if (pending) { $("#ps-form").elements.typed_name.value ||= v.signer.name; signerMsg(""); }
  else signerMsg(v.signer.status === "firmado" ? `Firmado el ${window.JuanmaPdf.colombiaTime(v.signer.signed_at)}. Gracias.`
    : v.signer.status === "rechazado" ? "Usted decidió no firmar este documento." : "Este documento ya no está disponible para firma.");
  if (pending && !signerPad) signerPad = window.JuanmaSigPad($("#ps-pad"));
  // A client of the firm answers each data policy on its own before signing (version 2.4).
  signerConsent = pending && v.consent ? v.consent.items : null;
  $("#ps-consent").hidden = !signerConsent;
  if (signerConsent) $("#ps-consent").innerHTML = window.JuanmaLegal.consentChecklistHtml(signerConsent);
}
let signerConsent = null;
async function openSignerPage(token) {
  signerToken = token;
  history.replaceState(null, "", location.pathname);
  $("#auth-screen").hidden = true;
  $("#app-root").hidden = true;
  $("#sign-screen").hidden = false;
  try {
    const v = await api("GET", `/public/sign/${encodeURIComponent(token)}`);
    renderSigner(v);
    if (v.doc_kind === "pdf") {
      const f = await api("GET", `/public/sign/${encodeURIComponent(token)}/pdf`);
      await window.JuanmaPdfView.render($("#ps-pdf"), D.b64ToBytes(f.base64));
      // The signer sees where the signature will be stamped (version 2.25).
      window.JuanmaPdfView.markStamps($("#ps-pdf"), { page: v.stamp_page, pos: v.stamp_pos, n: v.signers_count, label: "Aquí va la firma" });
    }
  } catch (e) { $("#ps-doc").hidden = true; $("#ps-sign").hidden = true; signerMsg(e.message, true); }
}
$("#ps-clear").addEventListener("click", () => signerPad?.clear());
$("#ps-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, err = $(".form-error", f);
  err.hidden = true;
  try {
    if (!signerPad || signerPad.isEmpty()) throw new Error("Dibuje su firma.");
    let consents;
    if (signerConsent) {
      const c = window.JuanmaLegal.consentAnswers(f, signerConsent);
      if (c.missing.length) throw new Error(`Responda Sí o No en: ${c.missing.join(", ")}.`);
      consents = c.answers;
    }
    renderSigner(await api("POST", `/public/sign/${encodeURIComponent(signerToken)}/sign`,
      { otp: f.otp.value, typed_name: f.typed_name.value, accept: f.accept.checked, signature_png: signerPad.toPng(), consents }));
    toast("Documento firmado.");
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
});
$("#ps-reject").addEventListener("click", () => guarded(async () => {
  const reason = window.prompt("¿Por qué no firma? (opcional)");
  if (reason === null) return;
  renderSigner(await api("POST", `/public/sign/${encodeURIComponent(signerToken)}/reject`, { reason }));
}));
$("#ps-dl").addEventListener("click", () => guarded(async () => {
  const f = await api("GET", `/public/sign/${encodeURIComponent(signerToken)}/signed`);
  await saveFile(f.filename, new Blob([D.b64ToBytes(f.base64)], { type: "application/pdf" }));
}));
$("#ps-exit").addEventListener("click", () => { $("#sign-screen").hidden = true; signerToken = ""; guarded(boot); });

// ----- Display preferences (this device) and account -----
const prefsForm = $("#prefs-dialog form");
function openPrefs() {
  const p = window.JuanmaDisplay.get();
  for (const k of ["font", "view", "theme"]) prefsForm.elements[k].value = p[k];
  $("#prefs-dialog").showModal();
}
prefsForm.addEventListener("change", () => window.JuanmaDisplay.set({
  font: prefsForm.elements.font.value, view: prefsForm.elements.view.value, theme: prefsForm.elements.theme.value }));
wireDialog($("#email-dialog"), async (form) => {
  const out = await api("POST", "/auth/email", formData(form));
  me = out.user;
  toast(`Su correo ahora es ${out.user.email}.`);
});

for (const [formSel, url] of [["#login-form", "/auth/login"], ["#setup-form", "/auth/setup"]]) {
  $(formSel)?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $(".form-error", e.target);
    err.hidden = true;
    try {
      const out = await api("POST", url, formData(e.target));
      e.target.reset();
      await enterApp(out.user);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
}
$("#demo-logins").addEventListener("click", (e) => {
  const b = e.target.closest("[data-demo-login]");
  if (b) guarded(async () => enterApp((await api("POST", "/auth/login", { email: b.dataset.demoLogin, password: "demo" })).user));
});

let AREAS = [], courtsTotal = 0;
async function loadAreas() {
  const meta = await api("GET", "/courts/meta");
  AREAS = meta.areas;
  courtsTotal = meta.total;
  const opts = AREAS.map((a) => `<option>${escapeHtml(a)}</option>`).join("");
  $("#courts-area").innerHTML = '<option value="">Todas</option>' + opts;
  $("#case-area").innerHTML = '<option value="">Todas</option>' + opts;
  caseForm.elements.area.innerHTML = '<option value="">—</option>' + opts;
}

// ----- Notifications bell -----
let bellTimer = null;
function startBell() {
  clearInterval(bellTimer);
  refreshBell();
  bellTimer = setInterval(() => me && refreshBell(), 60000);
}
async function refreshBell() {
  const n = await api("GET", "/notifications").catch(() => null);
  if (!n) return;
  const c = $("#bell-count");
  c.hidden = !n.unread;
  c.textContent = n.unread > 99 ? "99+" : n.unread;
  const ICON = { audiencia: "⚖", tarea: "✓", termino: "⏱", vencida: "!", actuacion: "•", reporte: "✉" };
  $("#bell-list").innerHTML = n.items.map((x) => `
    <li class="${x.read_at ? "" : "unread"}"><a href="${escapeHtml(x.link || "#inicio")}" data-note="${x.id}">
      <span class="note-ico" aria-hidden="true">${ICON[x.kind] || "•"}</span>
      <span><strong>${escapeHtml(x.title)}</strong><small>${escapeHtml(x.body)} · ${escapeHtml(x.created_at.slice(0, 16))} UTC</small></span>
    </a></li>`).join("") || '<li class="empty">Sin notificaciones.</li>';
}
$("#bell-list").addEventListener("click", (e) => {
  const a = e.target.closest("[data-note]");
  if (!a) return;
  $(".bell").open = false;
  api("POST", "/notifications/read", { ids: [Number(a.dataset.note)] }).then(refreshBell).catch(() => {});
});

// In-page confirm / prompt (the browser's own dialogs are blocked in some viewers).
function ask({ title, message = "", input = null, okLabel = "Aceptar", danger = false, secret = false }) {
  const dlg = $("#ask-dialog");
  const field = dlg.querySelector("[name=text]");
  field.type = secret ? "password" : "text"; // secret: a password, never trimmed or remembered
  field.autocomplete = secret ? "new-password" : "on";
  $("[data-title]", dlg).textContent = title;
  $("[data-msg]", dlg).textContent = message;
  field.hidden = input === null;
  field.required = input !== null;
  field.value = input ?? "";
  const ok = $("[data-ok]", dlg);
  ok.textContent = okLabel;
  ok.classList.toggle("danger-solid", danger);
  dlg.returnValue = "";
  dlg.showModal();
  if (input !== null) field.select();
  return new Promise((resolve) => {
    dlg.addEventListener("close", () => {
      if (dlg.returnValue !== "ok") return resolve(input === null ? false : null);
      resolve(input === null ? true : (secret ? field.value : field.value.trim()) || null);
    }, { once: true });
  });
}
const confirmAsk = (title, message, okLabel = "Eliminar") => ask({ title, message, okLabel, danger: true });

// Save a generated file: the viewer's download capability when the page runs
// inside claude.ai, a normal browser download otherwise.
async function saveFile(filename, blob) {
  const downloads = await window.claude?.use?.("downloads").catch(() => null);
  if (downloads) {
    try {
      await downloads.save({ filename, data: blob });
      toast("Archivo listo.");
    } catch (err) {
      if (err?.code !== "declined") toast(`No se pudo guardar el archivo (${err?.code || err?.message}).`, true);
    }
    return;
  }
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Navigation ----------
const VIEWS = ["inicio", "clientes", "expedientes", "agenda", "consulta", "radicados", "despachos", "borradores", "firmas", "pagos", "correo", "jurisprudencia", "reportes", "importar", "configuracion", "usuarios", "bitacora"];
// "#cliente-12" and "#expediente-34" open the client's and the case's own screens.
const FICHAS = { cliente: "clientes", expediente: "expedientes" };
function route() {
  const m = location.hash.match(/^#(cliente|expediente)-(\d+)(?:-([a-z]+))?$/);
  if (m) return { name: m[1], id: Number(m[2]), sec: m[3] || "" };
  const n = location.hash.slice(1).split("?")[0]; // "#jurisprudencia?q=…" carries a search (version 2.13)
  return { name: VIEWS.includes(n) ? n : "inicio" };
}
function showView() {
  if (!me) return;
  let { name, id } = route();
  if (VIEW_PERMS[name] && !can(VIEW_PERMS[name])) name = "inicio";
  for (const v of [...VIEWS, ...Object.keys(FICHAS)]) $(`#view-${v}`).hidden = v !== name;
  const nav = FICHAS[name] || (name === "radicados" ? "consulta" : name);
  $$(".sidenav a").forEach((a) => a.classList.toggle("active", a.dataset.view === nav));
  if (FICHAS[name]) {
    window.scrollTo(0, 0);
    const { sec } = route();
    return (name === "cliente" ? renderClienteFicha(id) : renderExpedienteFicha(id)).then(() => sec && goToSection(sec));
  }
  return RENDER[name]();
}
/** Re-render whatever screen is open (after a dialog saves). */
const refreshView = () => showView();
window.addEventListener("hashchange", () => guarded(showView));

// Changes 59–60: every screen carries its own "‹ Atrás / Adelante ›" buttons at its foot (not in the top bar); the bar sticks to the bottom of the window.
for (const view of $$("main .view")) {
  const nav = document.createElement("nav");
  nav.className = "page-nav";
  nav.setAttribute("aria-label", "Navegación entre pantallas");
  nav.innerHTML = '<button type="button" class="mini" data-action="go-back" title="Volver a la pantalla anterior">‹ Atrás</button>'
    + '<button type="button" class="mini" data-action="go-forward" title="Ir a la pantalla siguiente">Adelante ›</button>';
  view.append(nav);
}
/** Greys out Atrás / Adelante when there is nowhere to go (browsers with the Navigation API). */
function syncPageNav() {
  const n = window.navigation;
  if (!n || typeof n.canGoBack !== "boolean") return;
  $$('.page-nav [data-action="go-back"]').forEach((b) => (b.disabled = !n.canGoBack));
  const reopen = !!dlgNav && dlgNav.forward.some((d) => !d.open);
  $$('.page-nav [data-action="go-forward"]').forEach((b) => (b.disabled = !n.canGoForward && !reopen));
}
window.addEventListener("hashchange", syncPageNav);
syncPageNav();

// Change 59: clicking a field of a client's or case's data shades it, so it is clear which datum is being read.
function selectFact(row) {
  const list = row.closest(".facts");
  $$(".is-selected", list.closest(".view") || document).forEach((el) => el !== row && el.classList.remove("is-selected"));
  row.classList.toggle("is-selected");
}
document.addEventListener("click", (e) => {
  const row = e.target.closest(".facts > div");
  if (row && !e.target.closest("a, button")) selectFact(row);
});
document.addEventListener("keydown", (e) => {
  const row = e.target.closest?.(".facts > div");
  if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); selectFact(row); }
});

// ---------- Clientes ----------
function renderClientList() {
  const ul = $("#client-list");
  if (!state.clients.length) {
    ul.innerHTML = '<li class="empty">No hay clientes. Cree el primero con “+ Nuevo cliente”.</li>';
    return;
  }
  ul.innerHTML = state.clients.map((c) => `
    <li><button class="item ${c.id === state.selectedClientId ? "selected" : ""}" data-client="${c.id}">
      <strong>${escapeHtml(c.full_name)}</strong>
      <span>${escapeHtml([c.id_type, c.id_number].filter(Boolean).join(" "))} · ${c.case_count} expediente(s)${offices.length > 1 ? " · " + escapeHtml(c.office_name || "") : ""}</span>
    </button></li>`).join("");
}

async function renderClientDetail() {
  const box = $("#client-detail");
  const c = state.clients.find((c) => c.id === state.selectedClientId);
  if (!c) {
    box.innerHTML = '<p class="empty">Seleccione un cliente o cree uno nuevo.</p>';
    return;
  }
  const cases = await api("GET", `/cases?clientId=${c.id}`);
  const row = (label, v) => (v ? `<div><dt>${label}</dt><dd>${escapeHtml(v)}</dd></div>` : "");
  box.innerHTML = `
    <div class="detail-head">
      <h3>${escapeHtml(c.full_name)}</h3>
      <div class="toolbar">
        <button class="primary" data-action="go" data-to="#cliente-${c.id}">Ver cliente</button>
        <button data-action="go" data-to="#cliente-${c.id}-expedientes">Ver expedientes</button>
        ${can("payments.manage") ? `<button data-action="pay-statement" data-id="${c.id}">Ver pagos</button>` : ""}
        ${can("clients.write") ? `<button data-action="edit-client" data-id="${c.id}">Editar</button>` : ""}
        ${can("clients.delete") ? `<button class="danger" data-action="delete-client" data-id="${c.id}">Eliminar</button>` : ""}
      </div>
    </div>
    <dl class="facts">
      ${row("Tipo", c.person_type === "juridica" ? "Persona jurídica" : "Persona natural")}
      ${c.person_type === "juridica" ? "" : row("Nombres", c.first_names) + row("Apellidos", c.last_names)}
      ${row(c.person_type === "juridica" ? "NIT" : "Documento", c.person_type === "juridica" ? c.id_number : [c.id_type, c.id_number].filter(Boolean).join(" "))}
      ${c.person_type === "juridica" ? row("Representante legal", c.legal_rep) : ""}
      ${row("Correo", c.email)}${row("Teléfono", c.phone)}
      ${row("Dirección", c.address)}
      ${row("Ciudad", [c.city, c.department].filter(Boolean).join(" · "))}
      ${row("Oficina", c.office_name)}
      ${row("Notas", c.notes)}
    </dl>
    <div class="detail-head">
      <h4>Expedientes</h4>
      ${can("cases.write") ? `<button class="primary" data-action="new-case" data-client="${c.id}">+ Nuevo expediente</button>` : ""}
    </div>
    ${cases.length ? `<ul class="case-cards">${cases.map(caseCard).join("")}</ul>` : '<p class="empty">Este cliente no tiene expedientes.</p>'}`;
}

// ---------- Client screen: data, totals and the client's cases ----------
const factRow = (label, v) => (v ? `<div tabindex="0"><dt>${label}</dt><dd>${escapeHtml(v)}</dd></div>` : "");
async function renderClienteFicha(id) {
  const box = $("#ficha-cliente");
  box.innerHTML = '<p class="muted">Cargando…</p>';
  const [c, cases, consents] = await Promise.all([api("GET", `/clients/${id}`), api("GET", `/cases?clientId=${id}`), api("GET", `/clients/${id}/consents`).catch(() => null), loadCatalog()]);
  state.selectedClientId = c.id;
  if (!state.clients.some((x) => x.id === c.id)) state.clients.push(c);
  const pay = can("payments.manage") ? (await api("GET", "/payments/summary").catch(() => null))?.clients.find((r) => r.client_id === c.id) : null;
  const active = cases.filter((k) => k.status === "Activo").length;
  box.innerHTML = `
    <nav class="crumbs"><a href="#clientes">← Clientes</a></nav>
    <div class="view-head">
      <h2>${escapeHtml(c.full_name)}</h2>
      <div class="toolbar">
        ${can("clients.write") ? `<button data-action="edit-client" data-id="${c.id}">Editar cliente</button>` : ""}
        <button data-action="go" data-to="#cliente-${c.id}-expedientes">Ver expedientes</button>
        ${cases.length ? `<button data-action="go" data-to="#cliente-${c.id}-carpetas">Números de carpeta</button>` : ""}
        ${can("payments.manage") ? `<button data-action="pay-statement" data-id="${c.id}">Ver pagos (estado de cuenta)</button><button data-action="new-receipt" data-client="${c.id}">Registrar pago</button>` : ""}
        ${can("cases.write") ? `<button class="primary" data-action="new-case" data-client="${c.id}">+ Nuevo expediente</button>` : ""}
      </div>
    </div>
    <div class="ficha-chips">
      <span class="chip-stat">Expedientes <strong>${cases.length}</strong></span>
      <span class="chip-stat">Activos <strong>${active}</strong></span>
      ${pay ? `<span class="chip-stat">Honorarios <strong>${cop(pay.billed)}</strong></span><span class="chip-stat">Pagado <strong>${cop(pay.received)}</strong></span>
        <span class="chip-stat ${pay.balance > 0 ? "warn" : ""}">Saldo <strong>${cop(pay.balance)}</strong></span>` : ""}
    </div>
    <div class="ficha-grid">
      <section class="panel">
        <h3 class="panel-title">Datos del cliente</h3>
        ${clientPhotoBlock(c)}
        <dl class="facts">
          ${factRow("Tipo", c.person_type === "juridica" ? "Persona jurídica" : "Persona natural")}
          ${factRow(c.person_type === "juridica" ? "NIT" : "Documento", c.person_type === "juridica" ? c.id_number : [c.id_type, c.id_number].filter(Boolean).join(" "))}
          ${c.person_type === "juridica" ? factRow("Representante legal", c.legal_rep) : ""}
          ${factRow("Correo", c.email)}${factRow("Teléfono", c.phone)}${factRow("Dirección", c.address)}
          ${factRow("Ciudad", [c.city, c.department].filter(Boolean).join(" · "))}${factRow("Oficina", c.office_name)}${factRow("Notas", c.notes)}
        </dl>
      </section>
      ${consents ? consentPanel(c, consents) : ""}
      ${cases.length ? `<section id="sec-carpetas" class="panel ficha-wide">
        <h3 class="panel-title">Números de carpeta <span class="count">${cases.filter((k) => caseFolder(k)).length} de ${cases.length}</span></h3>
        <p class="hint">Cada expediente tiene su número de carpeta. Asígnelo o corríjalo aquí: la App avisa si el número ya está en otro expediente y sugiere el siguiente libre.</p>
        <table class="data-table compact folder-table"><thead><tr><th>Carpeta</th><th>Expediente</th><th>Estado</th><th></th></tr></thead><tbody>${[...cases].sort((a, b) => a.id - b.id).map((k) => `<tr>
          <td>${caseFolder(k) ? `<span class="folder-tag">${escapeHtml(caseFolder(k))}</span>` : '<span class="muted">Sin asignar</span>'}</td>
          <td><strong>${escapeHtml(k.type_name)}</strong>${k.title ? `<br><span class="muted">${escapeHtml(k.title)}</span>` : ""}${k.radicado ? `<br><span class="muted">${escapeHtml(formatRadicado(k.radicado))}</span>` : ""}</td>
          <td>${escapeHtml(k.status)}</td><td class="folder-act">${folderButton(k, caseFolder(k) ? "mini" : "mini primary")}</td></tr>`).join("")}</tbody></table>
      </section>` : ""}
      <section id="sec-expedientes" class="panel ficha-wide">
        <h3 class="panel-title">Expedientes de ${escapeHtml(c.full_name)}</h3>
        ${cases.length ? `<ul class="case-open-list">${cases.map((k) => `
          <li class="case-open">
            <span class="case-open-top">${caseFolder(k) ? `<span class="folder-tag">Carpeta ${escapeHtml(caseFolder(k))}</span>` : '<span class="folder-tag none">Sin carpeta</span>'}<span class="pill">${escapeHtml(k.category_name)}</span><span class="status-tag">${escapeHtml(k.status)}</span></span>
            <strong>${escapeHtml(k.type_name)}</strong>
            ${k.title ? `<span>${escapeHtml(k.title)}</span>` : ""}
            ${k.client_id !== c.id ? `<span class="muted">Cliente principal: ${escapeHtml(k.client_name)}</span>` : ""}
            <span class="muted">${escapeHtml([k.court_name, k.radicado && formatRadicado(k.radicado)].filter(Boolean).join(" · ") || "Sin despacho ni radicado")}</span>
            <span class="muted">${escapeHtml(k.assigned_name || "Sin responsable")} · ${escapeHtml(k.office_name || "")}</span>
            <span class="toolbar case-open-actions">${verCaseButtons(k)}${folderButton(k)}</span></li>`).join("")}</ul>`
          : '<p class="empty">Este cliente no tiene expedientes. Créelo con «+ Nuevo expediente».</p>'}
      </section>
    </div>`;
}

// ---------- Legal documents and client authorizations (change 56) ----------
const LEGAL = window.JuanmaLegal;
const coTime = (utc) => window.JuanmaPdf.colombiaTime(utc);
let legalCurrent = null;
function openLegal(id) {
  const doc = LEGAL.legalDoc(id) || LEGAL.LEGAL_DOCS[0];
  legalCurrent = doc;
  const dlg = $("#legal-dialog");
  $("[data-title]", dlg).textContent = doc.title;
  $("#legal-tabs").innerHTML = LEGAL.LEGAL_DOCS.map((d) => `<button type="button" data-legal="${d.id}" class="${d.id === doc.id ? "active" : ""}">${escapeHtml(d.short)}</button>`).join("");
  $("#legal-body").innerHTML = doc.html;
  $("#legal-body").scrollTop = 0;
  if (!dlg.open) dlg.showModal();
}
/** A legal document as Markdown, for the PDF. */
const legalMarkdown = (html) => html.replace(/\n\s*/g, " ")
  .replace(/<h3>(.*?)<\/h3>/g, "\n## $1\n").replace(/<tr>(.*?)<\/tr>/g, (_, r) => `\n- ${r.replace(/<\/t[hd]>\s*<t[hd]>/g, " · ")}`)
  .replace(/<li>/g, "\n- ").replace(/<\/p>|<\/ul>|<\/ol>|<\/table>/g, "\n").replace(/<\/?strong>/g, "**").replace(/<[^>]+>/g, "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").replace(/\n /g, "\n").replace(/\n{3,}/g, "\n\n").trim();
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-legal]");
  if (!a) return;
  e.preventDefault();
  openLegal(a.dataset.legal);
});
$("#legal-print").addEventListener("click", () => guarded(() =>
  saveFile(`${safeName(legalCurrent.title)}.pdf`, markdownToPdf(`# ${legalCurrent.title}\n\n${legalMarkdown(legalCurrent.html)}`))));

const consentState = (r) => (r ? (r.granted ? '<span class="consent-state yes">Autorizó</span>' : '<span class="consent-state no">No autorizó</span>') : '<span class="consent-state none">Sin respuesta</span>');
const consentWhen = (r, methods) => `${escapeHtml(methods[r.method] || r.method)} · ${escapeHtml(coTime(r.at))}${r.registered_by_name ? ` · registró ${escapeHtml(r.registered_by_name)}` : ""}${r.note ? ` · ${escapeHtml(r.note)}` : ""}`;
function consentPanel(c, k) {
  const pending = k.requests.find((q) => !q.answered_at);
  const remote = !window.JuanmaBackend?.web;
  const w = can("clients.write");
  return `<section id="sec-autorizaciones" class="panel">
    <h3 class="panel-title">Autorizaciones de datos <span class="muted">· versión ${escapeHtml(k.version)}</span></h3>
    <ul class="consent-status">${k.items.map((i) => { const r = k.status[i.key]; return `<li><span>${escapeHtml(i.title)}</span>${consentState(r)}${r ? `<small>${consentWhen(r, k.methods)}</small>` : ""}</li>`; }).join("")}</ul>
    ${pending ? `<p class="hint">Enlace ${pending.channel === "copy" ? "generado" : `enviado por ${pending.channel === "whatsapp" ? "WhatsApp" : "correo"}`} el ${escapeHtml(coTime(pending.created_at))}${pending.opened_at ? " · el cliente lo abrió" : ""}; aún sin responder.</p>` : ""}
    <div class="toolbar">
      ${w && remote ? `<button class="mini primary" data-consent="email" data-client="${c.id}" ${c.email ? "" : "disabled title=\"El cliente no tiene correo\""}>Enviar enlace por correo</button>
        <button class="mini" data-consent="whatsapp" data-client="${c.id}" ${c.phone ? "" : "disabled title=\"El cliente no tiene teléfono\""}>Enviar por WhatsApp</button>
        <button class="mini" data-consent="copy" data-client="${c.id}">Copiar enlace</button>` : ""}
      ${w ? `<button class="mini ${remote ? "" : "primary"}" data-consent="inperson" data-client="${c.id}">Firmar en la oficina</button>
        <button class="mini" data-consent="revoke" data-client="${c.id}">Registrar revocación</button>` : ""}
      ${k.records.length ? `<button class="mini" data-consent="pdf" data-client="${c.id}">Constancia PDF</button>` : ""}
      <button class="mini" data-legal="autorizacion">Ver documentos</button>
    </div>
    ${remote ? "" : '<p class="hint">El envío por enlace necesita la app en el servidor; en este enlace de prueba use «Firmar en la oficina».</p>'}
    ${k.records.length ? `<details class="consent-history"><summary>Historial de respuestas (${k.records.length})</summary><ul class="ficha-list">${k.records.slice().reverse().map((r) =>
      `<li><span><strong>${escapeHtml(LEGAL.consentItem(r.item)?.title || r.item)}</strong>: ${r.granted ? "autorizó" : "no autorizó"}<br><span class="muted">${consentWhen(r, k.methods)}${r.ip ? ` · IP ${escapeHtml(r.ip)}` : ""}</span></span></li>`).join("")}</ul></details>` : ""}
  </section>`;
}

let consentClient = null, consentPad = null;
const consentData = (cid) => Promise.all([api("GET", `/clients/${cid}`), api("GET", `/clients/${cid}/consents`)]);
const CONSENT_ACTIONS = {
  async link(cid, channel) {
    const r = await api("POST", `/clients/${cid}/consent-link`, { channel });
    if (r.sent?.ok) toast(`Enlace enviado a ${r.sent.detail}.`);
    else {
      const copied = await copyText(r.link);
      toast(r.sent ? `No se envió (${r.sent.detail}). ${copied ? "Copié el enlace para que lo envíe por otro medio." : r.link}` : copied ? "Enlace copiado. Envíelo al cliente por el medio que prefiera." : r.link, !!r.sent);
    }
    await refreshView();
  },
  email: (cid) => CONSENT_ACTIONS.link(cid, "email"),
  whatsapp: (cid) => CONSENT_ACTIONS.link(cid, "whatsapp"),
  copy: (cid) => CONSENT_ACTIONS.link(cid, "copy"),
  async inperson(cid) {
    const [c] = await consentData(cid);
    consentClient = c;
    openDialog($("#consent-dialog"), `Autorizaciones en la oficina · ${c.full_name}`, { typed_name: c.full_name, typed_id: c.id_number });
    $("#consent-items").innerHTML = LEGAL.CONSENT_ITEMS.map((i) => `<li class="consent-card"><h4>${escapeHtml(i.title)}</h4>
      <label class="consent-check"><input type="checkbox" name="c_${i.key}" /> <span>${escapeHtml(i.label)}</span></label>
      <details><summary>Leer: ${escapeHtml(LEGAL.legalDoc(i.doc).title)}</summary><div class="legal-doc">${LEGAL.legalDoc(i.doc).html}</div></details></li>`).join("");
    consentPad = window.JuanmaSigPad($("#consent-pad"));
    consentPad.clear();
  },
  async revoke(cid) {
    const [c, k] = await consentData(cid);
    consentClient = c;
    openDialog($("#revoke-dialog"), `Registrar revocación · ${c.full_name}`);
    $("#revoke-item").innerHTML = k.items.map((i) => `<option value="${i.key}">${escapeHtml(i.title)}${k.status[i.key]?.granted ? "" : " (hoy no autorizada)"}</option>`).join("");
  },
  async pdf(cid) {
    const [c, k] = await consentData(cid);
    const ev = (r) => [`- **${LEGAL.consentItem(r.item)?.title || r.item}: ${r.granted ? "AUTORIZÓ" : "NO AUTORIZÓ"}**`,
      `  Registro N.º ${r.id} · ${k.methods[r.method] || r.method} · ${coTime(r.at)}`,
      r.typed_name || r.typed_id ? `  Nombre escrito: ${r.typed_name || "—"} · Documento escrito: ${r.typed_id || "—"}` : "",
      r.ip || r.user_agent ? `  IP: ${r.ip || "—"} · Navegador: ${r.user_agent || "—"}` : "",
      r.registered_by_name ? `  Registrado por: ${r.registered_by_name}${r.signature_png ? " · firma en pantalla guardada" : ""}` : "",
      r.note ? `  Observación: ${r.note}` : "",
      `  Versión del documento ${r.doc_version} · huella del texto (SHA-256): ${r.doc_sha256}`,
      `  Huella del registro: ${r.hash}`].filter(Boolean).join("\n");
    const md = `# CONSTANCIA DE AUTORIZACIONES DE DATOS PERSONALES

**${LEGAL.FIRM.brand}** · Ley 1581 de 2012 y Decreto 1074 de 2015 (art. 2.2.2.25.2.5, prueba de la autorización)

Titular: **${c.full_name}**${c.id_number ? ` · ${c.id_type || ""} ${c.id_number}` : ""}

Expedida el ${coTime(new Date().toISOString().slice(0, 19).replace("T", " "))} por ${me.name}.

## Estado actual

${k.items.map((i) => { const r = k.status[i.key]; return `- ${i.title}: **${r ? (r.granted ? "Autorizó" : "No autorizó") : "Sin respuesta"}**${r ? ` (${coTime(r.at)})` : ""}`; }).join("\n")}

## Registro de respuestas

${k.records.map(ev).join("\n\n")}

---

Cada registro guarda el texto exacto que se respondió (su huella SHA-256 identifica la versión del documento) y está encadenado con el anterior: cualquier modificación posterior rompe la cadena. Los registros no se pueden editar ni borrar.`;
    await saveFile(`Autorizaciones ${safeName(c.full_name)}.pdf`, markdownToPdf(md));
  },
};
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-consent]");
  if (b) guarded(() => CONSENT_ACTIONS[b.dataset.consent](Number(b.dataset.client)));
});
$("#consent-clear").addEventListener("click", () => consentPad?.clear());
wireDialog($("#consent-dialog"), async (form) => {
  if (consentPad.isEmpty()) throw new Error("Falta la firma del cliente.");
  const answers = Object.fromEntries(LEGAL.CONSENT_ITEMS.map((i) => [i.key, form.elements[`c_${i.key}`].checked]));
  await api("POST", `/clients/${consentClient.id}/consents`, { answers, typed_name: form.elements.typed_name.value, typed_id: form.elements.typed_id.value,
    note: form.elements.note.value, signature_png: consentPad.toPng() });
  toast("Autorizaciones guardadas.");
  await refreshView();
});
wireDialog($("#revoke-dialog"), async (form) => {
  await api("POST", `/clients/${consentClient.id}/consents/revoke`, { item: form.elements.item.value, note: form.elements.note.value });
  toast("Revocación registrada.");
  await refreshView();
});

// ---------- Case screen: everything about one case, with the other modules ----------
const fmtDue = (d) => escapeHtml(String(d || "").replace("T", " ").slice(0, 16));
/** Opens a section of the client's or case's screen and shades it (and its "Ver:" tab) so it is clear which information is in view. */
function goToSection(sec) {
  const target = document.getElementById(`sec-${sec}`);
  if (!target) return;
  const view = target.closest(".view") || document;
  $$(".sec-current", view).forEach((el) => el.classList.remove("sec-current"));
  $$("[data-sec], [data-to]", view).forEach((b) => b.toggleAttribute("aria-current", b.dataset.sec ? b.dataset.sec === sec : b.dataset.to.endsWith(`-${sec}`)));
  target.classList.add("sec-current");
  target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}
const secId = (key, html) => html.replace('<section class="', `<section id="sec-${key}" class="`);
/** "Ver …" buttons: each one opens a screen or a section of it; nothing opens by clicking elsewhere. */
const VER_CASE = [["", "Ver expediente"], ["tareas", "Ver tareas"], ["actuaciones", "Ver actuaciones"], ["pagos", "Ver pagos"], ["correos", "Ver correos"], ["historial", "Ver historial"]];
const verCaseButtons = (k, keys = ["", "tareas", "actuaciones", "pagos", "correos"]) => VER_CASE.filter(([x]) => keys.includes(x))
  .map(([x, label]) => `<button class="mini ${x === "" ? "primary" : ""}" data-action="go" data-to="#expediente-${k.id}${x ? "-" + x : ""}">${label}</button>`).join("");
/** Parties by side, our clients marked (main client included). */
function partiesView(k) {
  const labels = CMETA.sideLabels(k.category_name || "", k.type_name || "");
  const mainSide = CMETA.sideOfRole(k.client_role);
  const list = [...(mainSide ? [{ side: mainSide, role: k.client_role, name: k.client_name, ours: true, client_id: k.client_id, main: true }] : []), ...(k.parties || [])];
  if (!list.length) return "";
  const col = (side) => `<div><h4>${escapeHtml(labels[side])}</h4><ul class="ficha-list">${list.filter((p) => p.side === side).map((p) => `<li><span><strong>${escapeHtml(p.name)}</strong>${p.role ? ` <span class="role-tag">${escapeHtml(p.role)}</span>` : ""}${p.id_number ? ` <span class="muted">${escapeHtml(p.id_number)}</span>` : ""}${p.main ? ' <span class="muted">· cliente principal</span>' : ""}</span>
      <span>${p.ours ? '<span class="follow ok">Nuestro cliente</span>' : ""}${p.client_id && !p.main ? ` <button class="mini" data-action="go" data-to="#cliente-${p.client_id}">Ver cliente</button>` : ""}</span></li>`).join("") || '<li class="muted">Sin registrar</li>'}</ul></div>`;
  return `<div class="parties-view">${col("activa")}${col("pasiva")}</div>`;
}
async function renderExpedienteFicha(id) {
  const box = $("#ficha-expediente");
  box.innerHTML = '<p class="muted">Cargando…</p>';
  await loadCatalog();
  const k = await api("GET", `/cases/${id}`);
  const quiet = (p) => p.catch(() => null);
  const [client, tasks, acts, docs, charges, receipts, signs, mails, changes, taskLog] = await Promise.all([
    quiet(api("GET", `/clients/${k.client_id}`)),
    quiet(api("GET", `/tasks?caseId=${id}`)),
    can("processes.consult") && k.radicado ? quiet(api("GET", `/monitor/cases/${id}/actuaciones`)) : null,
    quiet(api("GET", `/cases/${id}/documents`)),
    can("payments.manage") ? quiet(api("GET", `/payments/charges?caseId=${id}&state=`)) : null,
    can("payments.manage") ? quiet(api("GET", `/payments/receipts?clientId=${k.client_id}`)) : null,
    can("esign.use") ? quiet(api("GET", "/esign")) : null,
    can("mail.send") ? quiet(api("GET", `/mail?caseId=${id}`)) : null,
    quiet(api("GET", `/audit?caseId=${id}`)),
    quiet(api("GET", `/task-log?caseId=${id}`)),
  ]);
  if (client && !state.clients.some((x) => x.id === client.id)) state.clients.push(client);
  if (!state.cases.some((x) => x.id === k.id)) state.cases.push(k);
  const caseReceipts = (receipts || []).filter((r) => r.case_id === id);
  payReceiptsCache = caseReceipts;
  const caseSigns = (signs || []).filter((r) => r.case_id === id);
  const fields = (categoryOf(k.category_id)?.fields || []).filter((f) => String(k.field_values?.[f.id] ?? "").trim());
  const billed = (charges || []).filter((c) => c.state !== "anulado").reduce((a, c) => a + c.amount, 0);
  const balance = (charges || []).filter((c) => c.state !== "anulado").reduce((a, c) => a + c.balance, 0);
  const paid = caseReceipts.filter((r) => !r.voided_at).reduce((a, r) => a + r.amount, 0);
  const canWrite = can("cases.write");
  const work = (tasks || []).filter((t) => !CMETA.RESPONSE_KINDS.includes(t.kind));
  const answers = (tasks || []).filter((t) => CMETA.RESPONSE_KINDS.includes(t.kind));
  agendaCache = tasks || [];
  const hist = caseHistory({ k, tasks, acts, docs, charges, receipts: caseReceipts, signs: caseSigns, mails, changes });
  const panel = (title, count, body, actions = "") => `<section class="panel ficha-panel"><div class="ficha-panel-head"><h3 class="panel-title">${title}${count != null ? ` <span class="count">${count}</span>` : ""}</h3>${actions}</div>${body}</section>`;
  const empty = (t) => `<p class="empty">${t}</p>`;
  box.innerHTML = `
    <nav class="crumbs"><a href="#expedientes">Expedientes</a> › <a href="#cliente-${k.client_id}">${escapeHtml(k.client_name)}</a> › <span>${caseFolder(k) ? `Carpeta ${escapeHtml(caseFolder(k))}` : "Expediente"}</span></nav>
    <div class="view-head">
      <div><h2>${escapeHtml(k.type_name)}</h2>
        <p class="ficha-sub">${caseFolder(k) ? `<span class="folder-tag">Carpeta ${escapeHtml(caseFolder(k))}</span> ` : ""}<span class="pill">${escapeHtml(k.category_name)}</span> <span class="status-tag">${escapeHtml(k.status)}</span>${k.title ? ` · ${escapeHtml(k.title)}` : ""}</p></div>
      <div class="toolbar">
        ${can("cases.write") ? `<button data-action="edit-case" data-id="${k.id}">Editar</button>` : ""}
        ${folderButton(k, "")}
        <button data-action="rama-case" data-id="${k.id}" title="Consulta este proceso en la Rama Judicial (Consulta Nacional Unificada) con el radicado del expediente">⚖ Consultar en Rama Judicial</button>
        <button data-action="go-sec" data-sec="portales">Portales de consulta</button>
        ${can("processes.consult") ? `<button data-action="consult-case" data-id="${k.id}" title="Consulta el proceso en todas las plataformas de una vez y trae las actuaciones nuevas">↻ Consultar en todas las plataformas</button>` : ""}
        ${can("drafts.generate") ? `<button class="primary" data-action="draft-case" data-id="${k.id}">Generar documento</button>` : ""}
      </div>
    </div>
    <nav class="sec-nav" aria-label="Secciones del expediente"><span class="muted">Ver:</span>
      ${[["datos", "Datos"], ["responsable", "Responsable"], ["partes", "Partes"], ["tareas", "Tareas"], ["oficios", "Oficios"], ["historialtareas", "Historial de tareas"], ["actuaciones", "Actuaciones"], ["portales", "Portales"], ["documentos", "Documentos"], ["pagos", "Pagos"], ["firmas", "Firmas"], ["correos", "Correos"], ["historial", "Historial"]]
        .map(([x, label]) => `<button type="button" class="mini" data-action="goto-sec" data-sec="${x}">${label}</button>`).join("")}
      <button type="button" class="mini" data-action="go" data-to="#cliente-${k.client_id}">Ver cliente</button></nav>
    <div class="ficha-chips">
      <span class="chip-stat">Cliente <strong>${clientName(k.client_id, k.client_name)}</strong></span>
      ${partyLine(k) ? `<span class="chip-stat">${escapeHtml(partyLine(k))}</span>` : ""}
      <button type="button" class="chip-stat" data-action="goto-sec" data-sec="responsable" title="Ver o cambiar el funcionario responsable">Responsable <strong>${escapeHtml(k.assigned_name || "sin asignar")}</strong></button>
      ${charges ? `<span class="chip-stat">Honorarios <strong>${cop(billed)}</strong></span><span class="chip-stat">Pagado <strong>${cop(paid)}</strong></span><span class="chip-stat ${balance > 0 ? "warn" : ""}">Saldo <strong>${cop(balance)}</strong></span>` : ""}
    </div>
    <div class="ficha-grid">
      ${secId("datos", wide(panel("Datos del expediente", null, `<dl class="facts">
        ${factRow("Radicado", k.radicado && formatRadicado(k.radicado))}${factRow("Despacho", k.court_name)}${factRow("Juez", k.judge_name)}${factRow("Correo del despacho", k.court_email)}
        ${factRow("Ciudad", [k.city, k.department].filter(Boolean).join(" · "))}${factRow("Área", k.area)}${factRow("Contraparte", k.counterparty)}
        ${factRow("Oficina", k.office_name)}${factRow("Afiliado", k.affiliated ? "Sí" : "")}${factRow("Creado", k.created_at && k.created_at.slice(0, 10))}
        ${factRow("Consulta automática", k.radicado ? (k.monitor ? "Activada" : "Desactivada") : "")}${factRow("Última consulta", CMETA.utcToBogota(k.last_checked_at))}${factRow("Última actuación", k.last_action_date)}
        ${fields.filter((f) => !isFolderField(f)).map((f) => factRow(escapeHtml(f.label), k.field_values[f.id])).join("")}
        ${factRow("Hechos", k.facts)}
      </dl>`)))}
      ${secId("responsable", wide(panel("Funcionario responsable", null, responsiblePanel(k, tasks || []))))}
      ${secId("partes", wide(panel("Partes del proceso", null, partiesView(k) || '<p class="empty">Registre las partes con «Editar» (sección «Partes del proceso»).</p>')))}
      ${secId("tareas", wide(panel("Tareas, audiencias y términos", work.length, `${followSummary(work)}${work.length ? taskTable(work, false) : empty("Sin tareas, audiencias ni términos. Asigne uno con los botones de arriba.")}`,
        canWrite ? kindButtons(k.id, ["tarea", "audiencia", "termino", "recurso"]) : "")))}
      ${secId("oficios", wide(panel("Oficios, peticiones y requerimientos", answers.length, answers.length ? taskTable(answers, true)
        : empty("Sin oficios, peticiones ni requerimientos. Registre la entrega y la app controla la respuesta y su plazo."),
        canWrite ? kindButtons(k.id, ["oficio", "peticion", "requerimiento"]) : "")))}
      ${secId("historialtareas", wide(panel("Historial de tareas", (taskLog || []).length, taskLogView(taskLog || []))))}
      ${acts !== null ? secId("actuaciones", wide(panel("Actuaciones (consulta automática)", acts.length, `${portalCheckBox(k.id)}
          <p class="hint">${WEB ? "En este enlace de prueba no se puede consultar la Rama Judicial (no se conecta a sitios externos); en la versión del servidor (Azure) se consulta en automático y con «Consultar ahora»." : k.monitor ? "Se consulta en automático a las 7, 13 y 17 h." : "La consulta automática está desactivada para este expediente (actívela en Expedientes, columna «Consulta»)."}
            ${k.last_checked_at ? `Última consulta: ${escapeHtml(CMETA.utcToBogota(k.last_checked_at))}.` : "Aún no se ha consultado."} Con «Recordatorio» crea un término o tarea a partir de la actuación.</p>
          ${acts.length ? `<div class="acts-scroll"><table class="data-table compact"><thead><tr><th>Fecha</th><th>Actuación</th><th>Anotación</th><th></th></tr></thead><tbody>${acts.map((a, i) => `<tr>
            <td>${escapeHtml(String(a.fecha || "").slice(0, 10))}</td><td><strong>${escapeHtml(a.actuacion || "")}</strong>${a.decision ? `<br><span class="muted">Decisión: ${escapeHtml(a.decision)}</span>` : ""}</td>
            <td>${escapeHtml(String(a.anotacion || "").slice(0, 300))}</td>
            <td>${canWrite ? `<button class="mini" data-action="act-remind" data-case="${k.id}" data-act="${i}">Recordatorio</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`
          : empty(k.last_checked_at ? "La consulta no ha encontrado actuaciones." : "Use «↻ Consultar ahora» para traer las actuaciones de la Rama Judicial.")}`,
        `<span class="toolbar"><button class="mini" data-action="rama-case" data-id="${k.id}">⚖ Consultar en Rama Judicial</button><button class="mini" data-action="consult-case" data-id="${k.id}">↻ Consultar en todas las plataformas</button><button class="mini" data-action="view-acts" data-id="${k.id}">Ver con decisiones</button></span>`)))
        : !k.radicado ? secId("actuaciones", wide(panel("Actuaciones", null, `${portalCheckBox(k.id)}${empty("Agregue el radicado (botón «Editar») para consultar las actuaciones en automático.")}`))) : ""}
      ${secId("documentos", panel("Documentos guardados", (docs || []).length, (docs || []).length ? `<ul class="ficha-list">${docs.map((d) => `<li>
          <strong>${escapeHtml(d.name)}</strong> <span class="muted">${escapeHtml(d.filename)} · ${escapeHtml(String(d.created_at).slice(0, 10))}</span>
          <button class="mini" data-fdoc="${d.id}">Descargar</button></li>`).join("")}</ul>`
        : empty("Genere un documento y use «Guardar en el expediente»."), can("drafts.generate") ? `<button class="mini" data-action="draft-case" data-id="${k.id}">Generar documento</button>` : ""))}
      ${charges ? secId("pagos", panel("Pagos", charges.length + caseReceipts.length, `
        ${charges.length ? `<table class="data-table compact"><thead><tr><th>Cobro</th><th>Vence</th><th class="num">Valor</th><th class="num">Saldo</th><th>Estado</th></tr></thead><tbody>${charges.map((c) => `<tr class="${c.state === "anulado" ? "voided" : ""}">
          <td>${escapeHtml(c.concept)}${c.plan_label ? `<br><span class="muted">${escapeHtml(c.plan_label)}</span>` : ""}</td><td>${escapeHtml(c.due_date)}</td>
          <td class="num">${cop(c.amount)}</td><td class="num">${cop(c.balance)}</td><td><span class="pay-state ${c.state}">${escapeHtml(L.STATE_LABELS[c.state] || c.state)}</span></td></tr>`).join("")}</tbody></table>` : empty("Sin cobros para este expediente.")}
        ${caseReceipts.length ? `<h4>Recibos</h4><ul class="ficha-list">${caseReceipts.map((r) => `<li><strong>${escapeHtml(receiptNo(r.number))}</strong> · ${escapeHtml(r.paid_on)} · ${cop(r.amount)}${r.voided_at ? " · anulado" : ""}
          <button class="mini" data-action="receipt-pdf" data-id="${r.id}">PDF</button></li>`).join("")}</ul>` : ""}`,
        `<span class="toolbar"><button class="mini" data-action="new-charge" data-client="${k.client_id}" data-case="${k.id}">+ Cobro</button><button class="mini primary" data-action="new-receipt" data-client="${k.client_id}">Registrar pago</button></span>`)) : ""}
      ${signs ? secId("firmas", panel("Firmas electrónicas", caseSigns.length, caseSigns.length ? `<ul class="ficha-list">${caseSigns.map((r) => `<li>
          <span class="badge ${r.status === "completada" ? "ok" : r.status === "enviada" ? "warn" : ""}">${escapeHtml(SIGN_STATUS[r.status][1])}</span> <strong>${escapeHtml(r.title)}</strong>
          <button class="mini" data-action="open-sign" data-id="${r.id}">Ver</button></li>`).join("")}</ul>` : empty("Sin documentos enviados a firma."),
        `<button class="mini" data-action="sign-case" data-id="${k.id}">Enviar a firma</button>`)) : ""}
      ${mails ? secId("correos", panel("Correos con trazabilidad", mails.length, mails.length ? `<ul class="ficha-list">${mails.map((m) => `<li>
          <strong>${escapeHtml(m.subject)}</strong> <span class="muted">${escapeHtml(m.to_addr)} · ${escapeHtml(String(m.sent_at).slice(0, 16))}</span>
          <span class="badge ${m.confirmed_at ? "ok" : m.opened_at ? "warn" : ""}">${m.confirmed_at ? "Acuse recibido" : m.opened_at ? "Abierto" : m.status === "enviado" ? "Enviado" : "Fallido"}</span>
          <button class="mini" data-action="mail-proof" data-id="${m.id}">Constancia</button></li>`).join("")}</ul>` : empty("Sin correos enviados desde este expediente."),
        `<button class="mini" data-action="mail-case" data-case="${k.id}">Enviar correo</button>`))
        : can("mail.send") ? secId("correos", panel("Correos con trazabilidad", null, empty("El correo con trazabilidad funciona en la versión del servidor (Azure); no está disponible en este enlace de prueba."))) : ""}
      ${secId("portales", wide(panel("Consultar en los portales de la Rama Judicial", null, `<div data-portal-case="${k.id}">
          ${portalCopyBar(k, client)}
          <ul class="portal-list">${portalListHtml(k)}</ul>
          <p class="hint">Al tocar «Abrir» el radicado queda copiado: péguelo en el buscador del portal (en Publicaciones Procesales se copia el despacho). La consulta automática funciona con Justicia Siglo XXI en la versión del servidor; TYBA y SIUGJ piden verificación de seguridad y SAMAI y Publicaciones Procesales no tienen un servicio público para consultar en automático.</p></div>`)))}
      ${secId("historial", wide(panel("Historial del expediente", hist.length, `<div class="chip-row hist-filters">${HIST_TYPES.filter(([t]) => t === "" || hist.some((h) => h.type === t))
          .map(([t, label]) => `<button type="button" class="chip ${t === "" ? "active" : ""}" data-hist="${t}">${label}</button>`).join("")}</div>
        <ol class="history">${hist.map((h) => `<li data-type="${h.type}"><span class="h-when">${escapeHtml(h.at)}</span><span class="h-dot h-${h.type}"></span>
          <div><strong>${escapeHtml(h.text)}</strong>${h.sub ? `<br><span class="muted">${escapeHtml(h.sub)}</span>` : ""}</div></li>`).join("")}</ol>`)))}
    </div>`;
  ACTS_CACHE = acts || [];
}
let ACTS_CACHE = [];

// Funcionarios who can take a case: users of its office, plus roles that see every office.
// A hidden user comes as «Asistente» in name and role (version 2.11): show it once, with no office.
const staffLabel = (u) => u.role && u.role !== u.name ? `${escapeHtml(u.name)} · ${escapeHtml(u.role)}` : escapeHtml(u.name);
const caseStaff = (officeId) => directory.filter((u) => u.scopeAll || u.offices.some((o) => o.id === Number(officeId)));

/** The case's responsible funcionario: change it, or give a task to them (or to anyone of the office) without leaving the case. */
function responsiblePanel(k, tasks) {
  const staff = caseStaff(k.office_id);
  const cur = directory.find((u) => u.id === k.assigned_user_id);
  const open = (uid) => tasks.filter((t) => t.status === "pendiente" && (t.assigned_user_id || k.assigned_user_id) === uid);
  const mine = cur ? open(cur.id) : [];
  const late = mine.filter((t) => CMETA.taskFollowUp(t, bogotaNow()).key === "vencida").length;
  const who = cur ? `<p class="resp-now"><strong>${escapeHtml(cur.name)}</strong>${cur.role !== cur.name ? ` <span class="muted">· ${escapeHtml(cur.role)}${cur.offices?.length ? " · " + escapeHtml(cur.offices.map((o) => o.name).join(", ")) : ""}</span>` : ""}<br>
      <span class="muted">${mine.length ? `${mine.length} pendiente(s) en este expediente${late ? ` · <span class="follow bad">${late} vencida(s)</span>` : ""}` : "Sin tareas pendientes en este expediente."}</span></p>`
    : `<p class="resp-now"><strong>Sin asignar.</strong> <span class="muted">Elija el funcionario que llevará este expediente.</span></p>`;
  if (!can("cases.write")) return who;
  return `${who}<div class="resp-pick" data-resp-case="${k.id}">
      <label>Funcionario <select name="resp_user">${!staff.length ? '<option value="">— No hay funcionarios en esta oficina —</option>' : cur ? "" : '<option value="">— Elija un funcionario —</option>'}${staff.map((u) =>
        `<option value="${u.id}" ${u.id === k.assigned_user_id ? "selected" : ""}>${staffLabel(u)}${open(u.id).length ? ` · ${open(u.id).length} pendiente(s)` : ""}</option>`).join("")}</select></label>
      <span class="toolbar"><button type="button" class="mini primary" data-action="set-responsible" data-id="${k.id}">Asignar como responsable</button>
        <button type="button" class="mini" data-action="task-for" data-id="${k.id}">+ Asignarle una tarea</button>
        ${cur ? `<button type="button" class="mini" data-action="clear-responsible" data-id="${k.id}">Quitar responsable</button>` : ""}</span>
    </div>
    <p class="hint">«Asignar como responsable» deja al funcionario elegido a cargo del expediente. «+ Asignarle una tarea» abre una tarea, audiencia o término ya dirigido a ese funcionario; le llega el aviso y aparece en su Agenda.</p>`;
}
const CMETA = window.JuanmaCaseMeta;
const HIST_TYPES = [["", "Todo"], ["actuacion", "Actuaciones"], ["tarea", "Tareas y oficios"], ["documento", "Documentos"], ["pago", "Pagos"], ["firma", "Firmas"], ["correo", "Correos"], ["cambio", "Cambios por funcionario"], ["expediente", "Expediente"]];
const wide = (html) => html.replace('class="panel ficha-panel"', 'class="panel ficha-panel ficha-wide"');
const kindButtons = (caseId, kinds) => `<span class="toolbar">${kinds.map((x) => `<button class="mini ${x === kinds[0] ? "primary" : ""}" data-action="new-task" data-case="${caseId}" data-kind="${x}">+ ${KIND_LABEL[x]}</button>`).join("")}</span>`;
const whoOf = (t) => t.assigned_name || t.case_assigned_name || "Sin responsable";
const followBadge = (t) => { const f = CMETA.taskFollowUp(t, bogotaNow()); return `<span class="follow ${f.tone}">${escapeHtml(f.label)}</span>`; };

/** Per-person tally: pending, overdue, done on time, done late. */
function followSummary(list) {
  if (!list.length) return "";
  const now = bogotaNow(), by = new Map();
  for (const t of list) {
    const f = CMETA.taskFollowUp(t, now), who = whoOf(t);
    const r = by.get(who) || { pend: 0, venc: 0, ok: 0, tarde: 0 };
    if (f.key === "vencida") r.venc++; else if (f.key === "a_tiempo") r.ok++; else if (f.key === "tarde") r.tarde++; else if (f.key !== "cancelada") r.pend++;
    by.set(who, r);
  }
  return `<div class="follow-people">${[...by].map(([who, r]) => `<span class="person-tally"><strong>${escapeHtml(who)}</strong>
    ${r.pend ? `<span class="follow muted">${r.pend} pendiente(s)</span>` : ""}${r.venc ? `<span class="follow bad">${r.venc} vencida(s)</span>` : ""}
    ${r.ok ? `<span class="follow ok">${r.ok} a tiempo</span>` : ""}${r.tarde ? `<span class="follow warn">${r.tarde} con retraso</span>` : ""}</span>`).join("")}</div>`;
}

function taskTable(list, answers) {
  const canWrite = can("cases.write");
  const rows = list.map((t) => {
    const actions = canWrite ? `${t.status === "pendiente" && !answers ? `<button class="mini" data-action="task-done" data-id="${t.id}">Cumplida</button>` : ""}
      ${t.status === "pendiente" && answers ? `<button class="mini" data-action="edit-task" data-id="${t.id}" data-focus="response_at">Registrar respuesta</button>` : ""}
      ${t.status === "pendiente" ? `<button class="mini" data-action="notify-task" data-id="${t.id}">Notificar</button>` : ""}
      <button class="mini" data-action="edit-task" data-id="${t.id}">Editar</button>` : "";
    const done = t.status === "hecha" ? `Cumplida ${escapeHtml(CMETA.utcToBogota(t.done_at))}${t.done_by_name ? " por " + escapeHtml(t.done_by_name) : ""}${t.done_notes ? " · " + escapeHtml(t.done_notes) : ""}` : "";
    return answers ? `<tr class="${t.status !== "pendiente" ? "is-done" : ""}">
        <td><span class="badge">${escapeHtml(KIND_LABEL[t.kind])}</span></td>
        <td><strong>${escapeHtml(t.title)}</strong>${t.notes ? `<br><span class="muted">${escapeHtml(t.notes)}</span>` : ""}<br><span class="muted">${escapeHtml(whoOf(t))}</span></td>
        <td>${escapeHtml(t.delivered_at || "—")}</td><td>${fmtDue(t.due_at)}${t.term_days ? `<br><span class="muted">${escapeHtml(termText(t))}</span>` : ""}</td>
        <td>${t.response_at ? `${escapeHtml(t.response_at)}${t.response_notes ? `<br><span class="muted">${escapeHtml(t.response_notes)}</span>` : ""}` : "—"}</td>
        <td>${followBadge(t)}</td><td class="row-actions">${actions}</td></tr>`
      : `<tr class="${t.status !== "pendiente" ? "is-done" : ""}">
        <td><span class="badge ${t.kind === "audiencia" ? "ok" : t.kind === "termino" || t.kind === "recurso" ? "warn" : ""}">${escapeHtml(KIND_LABEL[t.kind])}</span></td>
        <td><strong>${escapeHtml(t.title)}</strong>${t.location ? `<br><span class="muted">${escapeHtml(t.location)}</span>` : ""}${t.notes ? `<br><span class="muted">${escapeHtml(t.notes)}</span>` : ""}${done ? `<br><span class="muted">${done}</span>` : ""}</td>
        <td>${escapeHtml(whoOf(t))}${t.created_by_name ? `<br><span class="muted">Asignó: ${escapeHtml(t.created_by_name)}</span>` : ""}</td>
        <td>${fmtDue(t.due_at)}${t.term_days ? `<br><span class="muted">${escapeHtml(termText(t))}</span>` : ""}<br><span class="muted">${t.remind_days?.length ? "Aviso " + t.remind_days.map((d) => (d === 0 ? "el mismo día" : d + " d antes")).join(", ") : "Sin aviso"}</span></td>
        <td>${followBadge(t)}</td><td class="row-actions">${actions}</td></tr>`;
  }).join("");
  return `<div class="table-scroll"><table class="data-table compact"><thead><tr>${answers
    ? "<th>Tipo</th><th>Asunto y responsable</th><th>Entregado</th><th>Plazo de respuesta</th><th>Respuesta</th><th>Estado</th><th></th>"
    : "<th>Tipo</th><th>Asunto</th><th>Funcionario</th><th>Plazo</th><th>Seguimiento</th><th></th>"}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** Everything that happened in the case, newest first, in Colombia time. */
function caseHistory({ k, tasks, acts, docs, charges, receipts, signs, mails, changes }) {
  const out = [], at = (utc) => CMETA.utcToBogota(utc), add = (when, type, text, sub = "") => when && out.push({ at: when, type, text, sub });
  add(at(k.created_at), "expediente", "Se creó el expediente", [k.type_name, k.title].filter(Boolean).join(" · "));
  if (k.last_checked_at) add(at(k.last_checked_at), "actuacion", "Última consulta en la Rama Judicial");
  for (const a of acts || []) add(String(a.fecha || "").slice(0, 10), "actuacion", `Actuación: ${a.actuacion || ""}`, String(a.anotacion || "").slice(0, 220));
  for (const t of tasks || []) {
    const label = KIND_LABEL[t.kind];
    add(at(t.created_at), "tarea", `Asignado (${label.toLowerCase()}): ${t.title}`, `${whoOf(t)} · plazo ${t.due_at}${t.created_by_name ? " · asignó " + t.created_by_name : ""}`);
    if (t.delivered_at) add(t.delivered_at, "tarea", `Entregado o radicado (${label.toLowerCase()}): ${t.title}`);
    if (t.response_at) add(t.response_at, "tarea", `Respuesta recibida: ${t.title}`, t.response_notes);
    if (t.status === "hecha" && t.done_at && !t.response_at) add(at(t.done_at), "tarea", `Cumplido (${label.toLowerCase()}): ${t.title}`,
      [t.done_by_name && "por " + t.done_by_name, CMETA.taskFollowUp(t, bogotaNow()).label, t.done_notes].filter(Boolean).join(" · "));
  }
  for (const d of docs || []) add(at(d.created_at), "documento", `Documento guardado: ${d.name}`, d.filename);
  for (const c of charges || []) add(at(c.created_at), "pago", `Cobro: ${c.concept}${c.plan_label ? " (" + c.plan_label + ")" : ""}`, `${cop(c.amount)} · vence ${c.due_date}`);
  for (const r of receipts || []) add(r.paid_on, "pago", `Pago recibido · recibo ${receiptNo(r.number)}${r.voided_at ? " (anulado)" : ""}`, `${cop(r.amount)}${r.method ? " · " + r.method : ""}`);
  for (const r of signs || []) {
    add(at(r.created_at), "firma", `Enviado a firma: ${r.title}`);
    if (r.completed_at) add(at(r.completed_at), "firma", `Firmado por todos: ${r.title}`);
  }
  for (const m of mails || []) {
    add(at(m.sent_at), "correo", `Correo ${m.status === "enviado" ? "enviado" : "fallido"}: ${m.subject}`, m.to_addr);
    if (m.opened_at) add(at(m.opened_at), "correo", `Correo abierto: ${m.subject}`, m.to_addr);
    if (m.confirmed_at) add(at(m.confirmed_at), "correo", `Acuse de recibo: ${m.subject}`, m.confirm_name || m.to_addr);
  }
  // Who changed what, from the audit log (change 50).
  for (const e of changes || []) add(at(e.at), "cambio", `${e.user_name || "—"}: ${e.summary}`,
    [`${e.device}${e.device_detail ? " (" + e.device_detail + ")" : ""}`, ...e.changes.map((c) => `${c.label}: ${c.before || "(vacío)"} → ${c.after || "(vacío)"}`)].join(" · "));
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
/** Task history of a case (version 2.18): who did what on each task, and when, filterable by funcionario. */
function taskLogView(rows) {
  if (!rows.length) return '<p class="empty">Aún no hay movimientos de tareas en este expediente. Desde ahora queda registrado quién crea, edita, reasigna, cumple, cancela o elimina cada tarea, y cuándo.</p>';
  const people = new Map();
  for (const r of rows) {
    if (r.user_id) people.set(r.user_id, r.user_name || "—");
    if (r.assigned_user_id) people.set(r.assigned_user_id, r.assigned_name || "—");
  }
  const when = (r) => { try { return CMETA.utcToBogota(r.at); } catch { return String(r.at || "").slice(0, 16); } };
  return `<div class="tlog-filter"><label>Ver por funcionario <select data-tlog-user>
      <option value="">Todos (${rows.length})</option>${[...people].sort((a, b) => a[1].localeCompare(b[1], "es")).map(([uid, name]) => `<option value="${uid}">${escapeHtml(name)} (${rows.filter((r) => r.user_id === uid || r.assigned_user_id === uid).length})</option>`).join("")}
    </select></label><span class="muted" data-tlog-count></span></div>
    <div class="acts-scroll"><table class="data-table compact tlog-table"><thead><tr><th>Fecha y hora</th><th>Quién</th><th>Qué hizo</th><th>Tarea</th><th>Asignada a</th></tr></thead><tbody>${rows.map((r) => `
      <tr data-tlog-who="${r.user_id || ""}" data-tlog-to="${r.assigned_user_id || ""}">
        <td class="nowrap">${escapeHtml(when(r))}</td><td>${escapeHtml(r.user_name || "Sin registro")}</td>
        <td><strong>${escapeHtml(CMETA.TASK_LOG_LABEL[r.action] || r.action)}</strong>${r.detail ? `<br><span class="muted">${escapeHtml(r.detail)}</span>` : ""}${r.earlier ? '<br><span class="muted">Dato guardado antes del historial</span>' : ""}</td>
        <td>${escapeHtml(CMETA.TASK_KIND_LABEL[r.kind] || "")} · ${escapeHtml(r.title || "")}</td>
        <td>${escapeHtml(r.assigned_name || "Responsable del expediente")}</td></tr>`).join("")}</tbody></table></div>
    <p class="hint">«Ver por funcionario» muestra lo que hizo esa persona y lo que pasó con las tareas asignadas a ella. Este historial no se puede editar ni borrar.</p>`;
}
$("#ficha-expediente").addEventListener("change", (e) => {
  const sel = e.target.closest("[data-tlog-user]");
  if (!sel) return;
  let n = 0;
  for (const tr of $$("[data-tlog-who]", $("#ficha-expediente"))) {
    tr.hidden = !!sel.value && tr.dataset.tlogWho !== sel.value && tr.dataset.tlogTo !== sel.value;
    if (!tr.hidden) n++;
  }
  $("[data-tlog-count]", $("#ficha-expediente")).textContent = sel.value ? `${n} movimiento(s)` : "";
});
$("#ficha-expediente").addEventListener("click", (e) => {
  const h = e.target.closest("[data-hist]");
  if (h) {
    $$("[data-hist]", h.parentElement).forEach((x) => x.classList.toggle("active", x === h));
    $$(".history li", $("#ficha-expediente")).forEach((li) => (li.hidden = !!h.dataset.hist && li.dataset.type !== h.dataset.hist));
    return;
  }
  const b = e.target.closest("[data-fdoc]");
  if (!b) return;
  guarded(async () => {
    const id = route().id;
    const f = await api("GET", `/cases/${id}/documents/${b.dataset.fdoc}/file`);
    await saveFile(f.filename, new Blob([D.b64ToBytes(f.base64)], { type: f.mime }));
  });
});

function caseCard(k) {
  return `<li class="case-card">
    <div>${caseFolder(k) ? `<span class="folder-tag">Carpeta ${escapeHtml(caseFolder(k))}</span> ` : ""}<span class="pill">${escapeHtml(k.category_name)}</span> <span class="status-tag">${escapeHtml(k.status)}</span></div>
    ${partyLine(k) ? `<span class="muted">Cliente: ${escapeHtml(partyLine(k))}</span>` : ""}
    <strong>${escapeHtml(k.type_name)}</strong>
    ${k.title ? `<span>${escapeHtml(k.title)}</span>` : ""}
    <span>${escapeHtml(k.office_name || "")}${k.assigned_name ? " · " + escapeHtml(k.assigned_name) : " · Sin responsable"}</span>
    ${k.court_name ? `<span class="court-line">${escapeHtml(k.court_name)}${k.radicado ? " · " + escapeHtml(formatRadicado(k.radicado)) : ""}</span>` : ""}
    <div class="toolbar">${verCaseButtons(k, ["", "pagos", "correos"])}</div>
    <div class="toolbar">
      ${can("cases.write") ? `<button data-action="edit-case" data-id="${k.id}">Editar</button><button data-action="new-task" data-case="${k.id}">+ Tarea</button>` : ""}
      <button data-action="portals" data-id="${k.id}">Portales</button>
      ${can("mail.send") ? `<button data-action="mail-case" data-case="${k.id}">Correo</button>` : ""}
      <button data-action="case-docs" data-id="${k.id}">Documentos</button>
      ${can("drafts.generate") ? `<button class="primary" data-action="draft-case" data-id="${k.id}">Generar borrador</button>` : ""}
    </div>
  </li>`;
}

async function renderClientes() {
  await Promise.all([loadClients($("#client-search").value), loadCatalog()]);
  renderClientList();
  await renderClientDetail();
}

for (const [id, ev] of [["#client-search", "input"], ["#client-search-by", "change"]]) $(id).addEventListener(ev, () => guarded(async () => {
  await loadClients($("#client-search").value);
  renderClientList();
}));

$("#client-list").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-client]");
  if (!btn) return;
  // Selecting shows the summary at the side and a menu next to the name with the client's data and cases.
  state.selectedClientId = Number(btn.dataset.client);
  renderClientList();
  guarded(renderClientDetail);
  const again = $(`#client-list [data-client="${btn.dataset.client}"]`);
  e.openedClientMenu = true; // the same click must not close it again below
  guarded(() => openClientMenu(again || btn, Number(btn.dataset.client)));
});

// ---------- Client menu (change 52): tapping a client's name anywhere shows their data and their cases ----------
let clientMenu = null;
const closeClientMenu = () => { clientMenu?.remove(); clientMenu = null; };
function placeClientMenu(pop, anchor) {
  if (innerWidth < 700) { pop.classList.add("sheet"); return; } // bottom sheet on phones
  const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = `${Math.max(10, Math.min(r.left, innerWidth - w - 10))}px`;
  pop.style.top = `${r.bottom + 6 + h > innerHeight - 10 ? Math.max(10, r.top - h - 6) : r.bottom + 6}px`;
}
async function openClientMenu(anchor, clientId) {
  closeClientMenu();
  const pop = Object.assign(document.createElement("div"), { className: "client-menu" });
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Cliente");
  pop.innerHTML = '<p class="muted">Cargando…</p>';
  document.body.append(pop);
  clientMenu = pop;
  placeClientMenu(pop, anchor);
  const [c, cases] = await Promise.all([api("GET", `/clients/${clientId}`), api("GET", `/cases?clientId=${clientId}`)]);
  if (clientMenu !== pop) return;
  const doc = [c.person_type === "juridica" ? "NIT" : c.id_type, c.id_number].filter(Boolean).join(" ");
  pop.innerHTML = `
    <div class="cm-head"><strong>${escapeHtml(c.full_name)}</strong><button type="button" class="cm-close" aria-label="Cerrar">✕</button></div>
    <p class="muted">${escapeHtml([doc, c.phone, c.email, c.city].filter(Boolean).join(" · ") || "Sin datos de contacto")}</p>
    <div class="toolbar">
      <button class="mini primary" data-action="go" data-to="#cliente-${c.id}">Ver datos del cliente</button>
      <button class="mini" data-action="go" data-to="#cliente-${c.id}-expedientes">Ver expedientes</button>
      ${can("payments.manage") ? `<button class="mini" data-action="pay-statement" data-id="${c.id}">Ver pagos</button>` : ""}
    </div>
    <h4>Expedientes asignados (${cases.length})</h4>
    ${cases.length ? `<ul class="cm-cases">${cases.map((k) => `<li>
      <span><strong>${escapeHtml(k.type_name)}</strong>${caseFolder(k) ? ` <span class="folder-tag">Carpeta ${escapeHtml(caseFolder(k))}</span>` : ""}
        <br><span class="muted">${escapeHtml([k.title, k.status, k.radicado && formatRadicado(k.radicado)].filter(Boolean).join(" · "))}${k.client_id !== c.id ? " · cliente principal: " + escapeHtml(k.client_name) : ""}</span></span>
      <button class="mini" data-action="go" data-to="#expediente-${k.id}">Ver expediente</button></li>`).join("")}</ul>`
      : '<p class="empty">Este cliente no tiene expedientes.</p>'}`;
  placeClientMenu(pop, anchor);
}
document.addEventListener("click", (e) => {
  const opener = e.target.closest("[data-client-menu]");
  if (opener) { e.preventDefault(); guarded(() => openClientMenu(opener, Number(opener.dataset.clientMenu))); return; }
  if (!clientMenu || e.openedClientMenu) return;
  if (e.target.closest(".cm-close") || (clientMenu.contains(e.target) && e.target.closest("[data-action]"))) { setTimeout(closeClientMenu); return; }
  if (!clientMenu.contains(e.target) && !e.target.closest("#client-list [data-client]")) closeClientMenu();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeClientMenu(); });
window.addEventListener("hashchange", closeClientMenu);
const clientName = (id, name) => `<button type="button" class="client-link" data-client-menu="${id}" title="Ver datos y expedientes del cliente">${escapeHtml(name)}</button>`;

// ---------- Dialog helpers ----------
function openDialog(dialog, title, values = {}) {
  const form = $("form", dialog);
  form.reset();
  $("[data-title]", dialog).textContent = title;
  $(".form-error", dialog).hidden = true;
  for (const [k, v] of Object.entries(values)) if (form.elements[k] && v != null) form.elements[k].value = v;
  dialog.showModal();
}

// ---------- Change 64: Atrás / Adelante inside every window (dialog) ----------
// Atrás closes the window WITHOUT clearing what was typed and returns to the window it came from
// (or to the screen); Adelante reopens it exactly as it was. A window opened right after another
// one was saved (e.g. «Enviar a firma» → «Firma en persona») counts as its next step.
var dlgNav = { forward: [], lastClosed: null, lastClosedAt: 0, navigating: false };
const NO_DLG_NAV = new Set(["ask-dialog"]); // yes/no questions answer with their own buttons
const nativeShowModal = HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.showModal = function () {
  if (!dlgNav.navigating) {
    const below = $$("dialog[open]").filter((d) => d !== this).pop();
    const recent = Date.now() - dlgNav.lastClosedAt < 2500 ? dlgNav.lastClosed : null;
    this._navPrev = below || (recent !== this ? recent : null);
    dlgNav.forward = dlgNav.forward.filter((d) => d !== this); // opened anew: no stale "Adelante" to it
  }
  const r = nativeShowModal.call(this);
  syncDlgNav();
  return r;
};
for (const dlg of $$("dialog")) {
  if (NO_DLG_NAV.has(dlg.id)) continue;
  const nav = document.createElement("nav");
  nav.className = "page-nav dlg-nav";
  nav.setAttribute("aria-label", "Navegación de la ventana");
  nav.innerHTML = '<button type="button" class="mini" data-dlg-nav="back" title="Volver sin borrar lo escrito">‹ Atrás</button>'
    + '<button type="button" class="mini" data-dlg-nav="forward" title="Volver a abrir la ventana tal como la dejó">Adelante ›</button>';
  dlg.append(nav);
  // Only a window closed by saving leads into the next one; one closed by hand does not.
  dlg.addEventListener("close", () => {
    if (Date.now() - (dlg._savedAt || 0) < 1500) { dlgNav.lastClosed = dlg; dlgNav.lastClosedAt = Date.now(); }
    syncDlgNav();
  });
}
function reopenDialog(dlg) {
  dlgNav.navigating = true;
  try { if (!dlg.open) dlg.showModal(); } finally { dlgNav.navigating = false; }
}
function dialogBack(dlg) {
  if (dlg.dataset.forced) return; // a forced password change cannot be skipped
  const prev = dlg._navPrev;
  dlgNav.forward.push(dlg);
  dlg.close("back");
  if (prev && prev.isConnected && !prev.open) reopenDialog(prev);
  syncDlgNav();
}
function dialogForward() {
  const next = dlgNav.forward.pop();
  if (next) reopenDialog(next);
  syncDlgNav();
}
function syncDlgNav() {
  const canFwd = dlgNav.forward.some((d) => !d.open);
  $$('[data-dlg-nav="forward"]').forEach((b) => (b.disabled = !canFwd));
  $$('[data-dlg-nav="back"]').forEach((b) => (b.disabled = !!b.closest("dialog")?.dataset.forced));
  if (typeof syncPageNav === "function") syncPageNav();
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-dlg-nav]");
  if (!b) return;
  e.preventDefault();
  if (b.dataset.dlgNav === "back") dialogBack(b.closest("dialog"));
  else dialogForward();
});
// Changing screens forgets windows closed with Atrás on the previous screen.
window.addEventListener("hashchange", () => { dlgNav.forward = []; syncDlgNav(); });

// Dialog forms close on submit by default; keep them open until the save succeeds.
function wireDialog(dialog, onSave) {
  const form = $("form", dialog);
  form.addEventListener("submit", async (e) => {
    if (e.submitter?.value === "cancel") return;
    e.preventDefault();
    try {
      await onSave(form);
      dialog._savedAt = Date.now();
      dialog.close();
    } catch (err) {
      const p = $(".form-error", dialog);
      p.textContent = err.message;
      p.hidden = false;
    }
  });
}

const formData = (form) => Object.fromEntries(new FormData(form).entries());

const clientForm = $("#client-dialog form");
// Natural person: first and last names + document. Legal entity: business name + NIT.
function setPersonType(type) {
  clientForm.elements.person_type.value = type;
  $$("[data-pt]", clientForm).forEach((box) => {
    box.hidden = box.dataset.pt !== type;
    $$("input, select", box).forEach((el) => (el.disabled = box.hidden));
  });
  for (const [name, on] of [["first_names", type === "natural"], ["last_names", type === "natural"], ["business_name", type === "juridica"], ["nit", type === "juridica"]]) {
    clientForm.elements[name].required = on;
  }
}
clientForm.addEventListener("change", (e) => { if (e.target.name === "person_type") setPersonType(e.target.value); });
// Names and addresses in proper case as soon as the user leaves the field, in every form
// (JOHN or john → John; "clle 5 no 12b-30" → "Calle 5 No. 12B-30"; "3222531327" → "322 253 1327"). Cities and departments
// take their DANE spelling in the type-ahead (IBAGUE → Ibagué). Company names stay as written.
const PERSON_NAME_FIELDS = '[name=first_names], [name=last_names], [name=legal_rep], [name=typed_name], [data-form=user] [name=name], #setup-name, [data-p=name], #signer-rows [data-k=name]';
const PHONE_FIELDS = '[name=phone], input[name=whatsapp]:not([type=checkbox]), #signer-rows [data-k=phone]';
document.addEventListener("focusout", (e) => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || !el.value.trim()) return;
  const P = window.JuanmaPerson;
  let v = el.value;
  if (el.name === "address") v = P.properAddress(v);
  else if (el.matches(PHONE_FIELDS)) v = P.properPhone(v);
  else if (el.matches(PERSON_NAME_FIELDS) && !P.looksLikeCompany(v)) v = P.properName(v);
  if (v !== el.value) { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }
});

// ---------- Version 2.22: optional client photo (camera of the phone or computer, or an uploaded image) ----------
const PHOTO_SIDE = 640; // longest side of the stored photo, in pixels
const clientInitials = (c) => escapeHtml((c.person_type === "juridica" ? [c.full_name] : [c.first_names || c.full_name, c.last_names])
  .filter(Boolean).map((w) => String(w).trim()[0] || "").join("").slice(0, 2).toUpperCase() || "?");
const photoImg = (photo, c) => (photo ? `<img src="${escapeHtml(photo)}" alt="Foto de ${escapeHtml(c.full_name || "el cliente")}" />` : `<span>${clientInitials(c)}</span>`);
function clientPhotoBlock(c) {
  const edit = can("clients.write");
  return `<div class="photo-field ficha-photo">
    <span class="client-photo big">${photoImg(c.photo, c)}</span>
    <div>
      <strong>Foto</strong> <span class="muted">${c.photo ? "" : "(opcional, sin foto)"}</span>
      ${edit ? `<div class="toolbar">
        <button class="mini" data-action="client-photo" data-mode="camera" data-id="${c.id}">${c.photo ? "Tomar otra foto" : "Tomar foto"}</button>
        <button class="mini" data-action="client-photo" data-mode="file" data-id="${c.id}">Subir imagen</button>
        ${c.photo ? `<button class="mini" data-action="client-photo" data-mode="clear" data-id="${c.id}">Quitar foto</button>` : ""}
      </div>` : ""}
    </div>
  </div>`;
}
// Any image (camera frame or file) becomes a JPEG data URL no larger than PHOTO_SIDE on its longest side.
function shrinkPhoto(source, w, h) {
  const k = Math.min(1, PHOTO_SIDE / Math.max(w, h));
  const cv = document.createElement("canvas");
  cv.width = Math.round(w * k); cv.height = Math.round(h * k);
  const g = cv.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(source, 0, 0, cv.width, cv.height);
  return cv.toDataURL("image/jpeg", 0.85);
}
function fileToPhoto(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error("Elija un archivo de imagen (JPG, PNG…)."));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { try { resolve(shrinkPhoto(img, img.naturalWidth, img.naturalHeight)); } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); } };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No se pudo leer la imagen. Pruebe con una foto JPG o PNG.")); };
    img.src = url;
  });
}
// Opens a file input and resolves with the chosen image as a photo, or null if nothing was chosen.
function pickPhotoFile(input) {
  return new Promise((resolve, reject) => {
    input.value = "";
    const done = () => { window.removeEventListener("focus", onFocus); };
    const onFocus = () => setTimeout(() => { if (!input.files.length) { done(); resolve(null); } }, 1200);
    input.onchange = () => { done(); input.files[0] ? fileToPhoto(input.files[0]).then(resolve, reject) : resolve(null); };
    window.addEventListener("focus", onFocus);
    input.click();
  });
}
const coarsePointer = () => window.matchMedia?.("(pointer: coarse)").matches;
// Camera: on phones the phone's own camera opens; on computers the webcam shows in a window.
// If the browser does not allow the camera, the user is told and can upload an image instead.
let photoStream = null, photoFacing = "user";
function stopPhotoStream() { photoStream?.getTracks().forEach((t) => t.stop()); photoStream = null; }
async function startPhotoStream() {
  stopPhotoStream();
  photoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: photoFacing, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
  $("#photo-video").srcObject = photoStream;
  $("#photo-video").classList.toggle("mirror", photoFacing === "user"); // a front camera shows like a mirror
}
async function takePhoto() {
  if (coarsePointer()) return pickPhotoFile($("#photo-capture"));
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("Este navegador no permite usar la cámara aquí. Elija una imagen guardada.", true);
    return pickPhotoFile($("#photo-file"));
  }
  try { await startPhotoStream(); } catch (err) {
    stopPhotoStream();
    toast(err?.name === "NotAllowedError" ? "No se dio permiso para usar la cámara. Puede subir una imagen en su lugar." : "No se encontró una cámara disponible. Puede subir una imagen en su lugar.", true);
    return pickPhotoFile($("#photo-file"));
  }
  const dlg = $("#photo-dialog");
  const cams = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === "videoinput");
  $("#photo-switch").hidden = cams.length < 2;
  return new Promise((resolve) => {
    let shot = null;
    $("#photo-shoot").onclick = () => {
      const v = $("#photo-video");
      if (!v.videoWidth) return toast("La cámara aún no está lista. Espere un momento.", true);
      shot = shrinkPhoto(v, v.videoWidth, v.videoHeight);
      dlg.close("shot");
    };
    $("#photo-switch").onclick = () => guarded(async () => { photoFacing = photoFacing === "user" ? "environment" : "user"; await startPhotoStream(); });
    dlg.addEventListener("close", () => { stopPhotoStream(); resolve(shot); }, { once: true });
    dlg.showModal();
  });
}
const getPhoto = (mode) => (mode === "camera" ? takePhoto() : pickPhotoFile($("#photo-file")));
async function saveClientPhoto(id, photo) {
  const saved = await api("PUT", `/clients/${id}/photo`, { photo });
  const i = state.clients.findIndex((x) => x.id === id);
  if (i >= 0) state.clients[i] = { ...state.clients[i], has_photo: saved.has_photo };
  return saved;
}
// In the client form the photo waits until «Guardar»: undefined = unchanged, "" = remove, data URL = new.
let pendingPhoto;
function showFormPhoto(photo, c) {
  $("#client-photo-field [data-photo-preview]").innerHTML = photoImg(photo, c || {});
  $('#client-photo-field [data-photo-pick="clear"]').hidden = !photo;
  $('#client-photo-field [data-photo-pick="camera"]').textContent = photo ? "Tomar otra foto" : "Tomar foto";
}
$("#client-photo-field").addEventListener("click", (e) => {
  const b = e.target.closest("[data-photo-pick]");
  if (!b) return;
  e.preventDefault();
  const f = clientForm.elements, who = { full_name: f.business_name.value || f.first_names.value, first_names: f.first_names.value, last_names: f.last_names.value, person_type: f.person_type.value };
  guarded(async () => {
    const photo = b.dataset.photoPick === "clear" ? "" : await getPhoto(b.dataset.photoPick);
    if (photo == null) return;
    pendingPhoto = photo;
    showFormPhoto(photo, who);
  });
});

function openClientDialog(c) {
  pendingPhoto = undefined;
  const sel = $("#client-dialog [name=office_id]");
  sel.innerHTML = myOffices().map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join("");
  const type = c?.person_type || "natural";
  openDialog($("#client-dialog"), c ? "Editar cliente" : "Nuevo cliente", c ? {
    ...c, business_name: type === "juridica" ? c.full_name : "", nit: type === "juridica" ? c.id_number : "",
    id_number: type === "natural" ? c.id_number : "",
  } : {});
  setPersonType(type);
  sel.value = c?.office_id ?? myOffices()[0]?.id ?? "";
  showFormPhoto(c?.photo || "", c || {});
}

wireDialog($("#client-dialog"), async (form) => {
  const { id, business_name, nit, ...data } = formData(form);
  if (data.person_type === "juridica") Object.assign(data, { full_name: business_name, id_number: nit, id_type: "NIT", first_names: "", last_names: "" });
  const saved = id ? await api("PUT", `/clients/${id}`, data) : await api("POST", "/clients", data);
  if (pendingPhoto !== undefined) await saveClientPhoto(saved.id, pendingPhoto).catch((err) => toast(`El cliente quedó guardado, pero la foto no: ${err.message}`, true));
  pendingPhoto = undefined;
  state.selectedClientId = saved.id;
  toast(id ? "Cliente actualizado." : "Cliente creado.");
  // The client's own screen opens (or refreshes) with the saved data.
  const target = `#cliente-${saved.id}`;
  location.hash === target ? await refreshView() : (location.hash = target);
});

// ---------- Expedientes ----------
function fillCaseFilter() {
  const sel = $("#case-filter");
  const cur = sel.value;
  sel.innerHTML = '<option value="">Todos los tipos de proceso</option>' +
    state.catalog.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  sel.value = cur;
}

// Case list filters: text, department → city (or its circuit) → area → court.
let caseCourtIds = null; // courts of the chosen place and area, from the directory
async function refreshCaseCourts() {
  const dep = $("#case-dep").value, city = $("#case-city").value, area = $("#case-area").value;
  const sel = $("#case-court");
  const cur = sel.value;
  const courts = dep || city || area ? await courtsFor(dep, city, area) : [];
  caseCourtIds = city || area ? new Set(courts.map((c) => c.id)) : null;
  // Courts named in the cases count too, so a case whose court is not in the directory can still be found.
  const named = new Map(courts.map((c) => [`id:${c.id}`, c.name]));
  for (const k of casesByPlace()) if (k.court_name && !(k.court_id && named.has(`id:${k.court_id}`))) named.set(k.court_id ? `id:${k.court_id}` : `n:${k.court_name}`, k.court_name);
  sel.innerHTML = '<option value="">Todos los despachos</option>' + [...named].sort((a, b) => a[1].localeCompare(b[1], "es"))
    .map(([v, l]) => `<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`).join("");
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "";
  renderCaseRows();
}
const plainText = (x) => window.JuanmaCombo.norm(x || "");
function casesByPlace() {
  const dep = plainText($("#case-dep").value), city = plainText($("#case-city").value), area = $("#case-area").value;
  return state.cases.filter((k) => (!dep || plainText(k.department) === dep)
    && (!city || plainText(k.city) === city || (caseCourtIds && k.court_id && caseCourtIds.has(k.court_id)))
    && (!area || k.area === area || (!k.area && caseCourtIds && k.court_id && caseCourtIds.has(k.court_id))));
}
function renderCaseRows() {
  const catId = Number($("#case-filter").value) || null;
  const officeId = Number($("#case-office-filter").value) || null;
  const mine = $("#case-mine").checked;
  const flat = (x) => String(x ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const q = flat($("#case-search").value.trim());
  const qDigits = q.replace(/\D/g, "");
  const matches = (k) => !q || [caseFolder(k), k.client_name, k.title, k.type_name, ...(k.parties || []).map((p) => p.name)].some((x) => flat(x).includes(q))
    || (qDigits.length >= 4 && String(k.radicado || "").replace(/\D/g, "").includes(qDigits));
  const court = $("#case-court").value, status = $("#case-status").value;
  const rows = casesByPlace().filter((k) => (!catId || k.category_id === catId) && (!officeId || k.office_id === officeId)
    && (!mine || k.assigned_user_id === me.id) && (!status || k.status === status)
    && (!court || (court.startsWith("id:") ? k.court_id === Number(court.slice(3)) : k.court_name === court.slice(2)))
    && matches(k));
  $("#case-count").textContent = `${rows.length} de ${state.cases.length} expediente(s)`;
  $("#case-empty").hidden = rows.length > 0;
  $("#case-rows").innerHTML = rows.map((k) => `
    <tr>
      <td>${caseFolder(k) ? `<span class="folder-tag">${escapeHtml(caseFolder(k))}</span>` : '<span class="muted">—</span>'}</td>
      <td>${clientName(k.client_id, k.client_name)}${partyLine(k) ? `<br><span class="muted">${escapeHtml(partyLine(k))}</span>` : ""}${(k.parties || []).some((p) => p.ours) ? `<br><span class="muted">+ ${(k.parties || []).filter((p) => p.ours).map((p) => escapeHtml(p.name)).join(", ")}</span>` : ""}</td>
      <td><span class="pill">${escapeHtml(k.category_name)}</span><br>${escapeHtml(k.type_name)}</td>
      <td>${escapeHtml(k.title)}${k.court_name ? `<br><span class="muted">${escapeHtml(k.court_name)}</span>` : ""}${k.radicado ? `<br><span class="mono">${escapeHtml(formatRadicado(k.radicado))}</span>` : ""}</td>
      <td>${escapeHtml(k.office_name || "")}<br><span class="muted">${escapeHtml(k.assigned_name || "Sin responsable")}</span></td>
      <td><span class="status-tag">${escapeHtml(k.status)}</span></td>
      <td>${k.radicado
        ? `<label class="switch"><input type="checkbox" data-case-monitor="${k.id}" ${k.monitor ? "checked" : ""} ${can("processes.consult") ? "" : "disabled"} /> <span>${k.monitor ? "Sí" : "No"}</span></label>`
        : '<span class="muted" title="Agregue el radicado para poder consultarlo">Sin radicado</span>'}</td>
      <td class="row-actions">
        <span class="ver-group">${verCaseButtons(k, ["", "pagos", "correos"])}<button class="mini" data-action="go" data-to="#cliente-${k.client_id}">Ver cliente</button></span>
        ${can("cases.write") ? `<button data-action="edit-case" data-id="${k.id}">Editar</button>` : ""}
        ${can("cases.write") ? `<button data-action="new-task" data-case="${k.id}">+ Tarea</button>` : ""}
        <button data-action="portals" data-id="${k.id}">Portales</button>
        <button data-action="case-docs" data-id="${k.id}">Documentos</button>
        ${can("drafts.generate") ? `<button data-action="draft-case" data-id="${k.id}">Borrador</button>` : ""}
        ${can("cases.delete") ? `<button class="danger" data-action="delete-case" data-id="${k.id}" aria-label="Eliminar">✕</button>` : ""}
      </td>
    </tr>`).join("");
}

async function renderExpedientes() {
  await Promise.all([loadCatalog(), loadCases()]);
  fillCaseFilter();
  const of = $("#case-office-filter");
  const cur = of.value;
  of.innerHTML = '<option value="">Todas mis oficinas</option>' + myOffices().map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join("");
  of.value = cur;
  of.hidden = myOffices().length < 2;
  await refreshCaseCourts();
}
$("#case-filter").addEventListener("change", renderCaseRows);

// ----- «Cargar radicados» (version 2.24): every case with a box to type its radicado -----
// Cases without one come first; Enter saves (PUT /cases/:id/radicado) and moves to the next box.
// The order stays put while typing, so a saved row does not jump; it re-sorts on the next visit or filter.
const radDigits = (v) => String(v ?? "").replace(/\D/g, "");
// What an Excel import brought that was not 23 digits (field "Radicado (como venía)", importer.js).
const radAsImported = (k) => {
  const f = (categoryOf(k.category_id)?.fields ?? []).find((x) => /^radicado\s*\(como ven[ií]a\)$/i.test(x.label.trim()));
  return f ? String(k.field_values?.[f.id] ?? "").trim() : "";
};
function radCount() {
  const total = state.cases.length, missing = state.cases.filter((k) => !k.radicado).length;
  $("#rad-progress").innerHTML = `<strong>${total - missing} de ${total}</strong> expediente(s) con radicado · <strong>${missing}</strong> sin radicado`;
}
function renderRadRows() {
  const flat = (x) => String(x ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = flat($("#rad-search").value.trim()), qDigits = q.replace(/\D/g, "");
  const show = $("#rad-filter").value, officeId = Number($("#rad-office").value) || null;
  const folderNum = (k) => { const n = parseInt(caseFolder(k).replace(/\D/g, ""), 10); return Number.isFinite(n) ? n : Infinity; };
  const rows = state.cases.filter((k) => (!officeId || k.office_id === officeId)
    && (show !== "missing" || !k.radicado) && (show !== "done" || k.radicado)
    && (!q || [caseFolder(k), k.client_name, k.title, k.type_name, k.court_name, ...(k.parties || []).map((p) => p.name)].some((x) => flat(x).includes(q))
      || (qDigits.length >= 4 && radDigits(k.radicado).includes(qDigits))))
    .sort((a, b) => (!!a.radicado - !!b.radicado) || folderNum(a) - folderNum(b) || a.id - b.id);
  $("#rad-empty").hidden = rows.length > 0;
  $("#rad-rows").innerHTML = rows.map((k) => {
    const old = radAsImported(k);
    return `<tr data-rad-case="${k.id}" class="${k.radicado ? "has-rad" : ""}">
      <td>${caseFolder(k) ? `<span class="folder-tag">${escapeHtml(caseFolder(k))}</span>` : '<span class="muted">—</span>'}</td>
      <td><strong>${escapeHtml(k.client_name)}</strong>${partyLine(k) ? `<br><span class="muted">${escapeHtml(partyLine(k))}</span>` : ""}</td>
      <td>${escapeHtml(k.type_name)}${k.title ? `<br><span class="muted">${escapeHtml(k.title)}</span>` : ""}${k.court_name ? `<br><span class="muted">${escapeHtml(k.court_name)}</span>` : ""}</td>
      <td class="rad-cell">
        <div class="rad-edit">
          <input class="rad-input mono" inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="40" placeholder="23 dígitos, con o sin guiones"
            aria-label="Radicado del expediente de ${escapeHtml(k.client_name)}" value="${escapeHtml(k.radicado ? formatRadicado(k.radicado) : "")}" data-saved="${escapeHtml(k.radicado || "")}" />
          <button type="button" class="mini primary" data-rad-save>Guardar</button>
        </div>
        <span class="rad-note muted" aria-live="polite">${k.radicado ? `Guardado · consulta automática ${k.monitor ? "activada" : "pausada"}` : "Sin radicado"}</span>
        ${old ? `<span class="rad-old muted">Venía en el Excel: <span class="mono">${escapeHtml(old)}</span></span>` : ""}
      </td>
    </tr>`;
  }).join("");
}
async function renderRadicados() {
  await Promise.all([loadCatalog(), loadCases()]);
  const of = $("#rad-office"), cur = of.value;
  of.innerHTML = '<option value="">Todas mis oficinas</option>' + myOffices().map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join("");
  of.value = cur;
  of.hidden = myOffices().length < 2;
  radCount();
  renderRadRows();
}
for (const id of ["#rad-filter", "#rad-office"]) $(id).addEventListener("change", renderRadRows);
$("#rad-search").addEventListener("input", renderRadRows);
// Live digit count while typing; the dashes come back when leaving the box.
$("#rad-rows").addEventListener("input", (e) => {
  const inp = e.target.closest(".rad-input");
  if (!inp) return;
  const n = radDigits(inp.value).length, note = $(".rad-note", inp.closest("td"));
  note.className = `rad-note ${n === 23 ? "ok" : "muted"}`;
  note.textContent = n === 0 ? (inp.dataset.saved ? "Vacío: Guardar quita el radicado (pide confirmación)" : "Sin radicado")
    : n === 23 ? "23 dígitos: pulse Enter o Guardar" : `${n} de 23 dígitos`;
});
$("#rad-rows").addEventListener("focusout", (e) => {
  const inp = e.target.closest(".rad-input");
  if (inp) inp.value = formatRadicado(inp.value.trim());
});
async function saveRadicado(tr) {
  const inp = $(".rad-input", tr), note = $(".rad-note", tr), btn = $("[data-rad-save]", tr);
  const id = Number(tr.dataset.radCase), saved = inp.dataset.saved, digits = radDigits(inp.value);
  inp.value = formatRadicado(inp.value.trim());
  const fail = (msg) => { note.className = "rad-note bad"; note.textContent = msg; inp.focus(); inp.select(); return false; };
  if (digits === saved) return true;
  if (digits && digits.length !== 23) return fail(`El radicado debe tener 23 dígitos (tiene ${digits.length}).`);
  const k = state.cases.find((x) => x.id === id);
  if (saved && !(await confirmAsk(digits ? "Cambiar radicado" : "Quitar radicado",
    digits ? `Este expediente ya tiene el radicado ${formatRadicado(saved)}. ¿Lo cambia por ${formatRadicado(digits)}?`
      : `¿Quita el radicado ${formatRadicado(saved)} de este expediente? Se pausa su consulta automática.`, digits ? "Cambiar" : "Quitar"))) {
    inp.value = formatRadicado(saved);
    note.className = "rad-note muted"; note.textContent = "Sin cambios: se dejó el radicado que tenía.";
    return false;
  }
  btn.disabled = true;
  try {
    const out = await api("PUT", `/cases/${id}/radicado`, { radicado: digits, replace: !!saved });
    if (k) Object.assign(k, out);
    inp.dataset.saved = out.radicado || "";
    tr.classList.toggle("has-rad", !!out.radicado);
    note.className = "rad-note ok";
    note.textContent = out.radicado ? `✓ Guardado · consulta automática ${out.monitor ? "activada" : "pausada"}` : "✓ Radicado quitado";
    radCount();
    return true;
  } catch (err) {
    return fail(err.message);
  } finally {
    btn.disabled = false;
  }
}
const nextRadInput = (tr) => {
  for (let r = tr.nextElementSibling; r; r = r.nextElementSibling) if (!radDigits($(".rad-input", r).value)) return $(".rad-input", r);
  return $(".rad-input", tr.nextElementSibling || tr);
};
$("#rad-rows").addEventListener("keydown", (e) => {
  const inp = e.target.closest(".rad-input");
  if (!inp || e.key !== "Enter") return;
  e.preventDefault();
  const tr = inp.closest("tr");
  guarded(async () => { if (await saveRadicado(tr)) { const n = nextRadInput(tr); n.focus(); n.select(); } });
});
$("#rad-rows").addEventListener("click", (e) => {
  const b = e.target.closest("[data-rad-save]");
  if (b) guarded(() => saveRadicado(b.closest("tr")));
});
$("#case-office-filter").addEventListener("change", renderCaseRows);
$("#case-mine").addEventListener("change", renderCaseRows);
for (const id of ["#case-court", "#case-status"]) $(id).addEventListener("change", renderCaseRows);
for (const id of ["#case-dep", "#case-city", "#case-area"]) $(id).addEventListener("change", () => guarded(refreshCaseCourts));
$("#case-search").addEventListener("input", renderCaseRows);
$("#case-rows").addEventListener("change", (e) => guarded(async () => {
  const box = e.target.closest("[data-case-monitor]");
  if (!box) return;
  const id = Number(box.dataset.caseMonitor);
  try {
    await api("PUT", `/monitor/cases/${id}/monitor`, { monitor: box.checked });
  } catch (err) {
    box.checked = !box.checked;
    throw err;
  }
  const k = state.cases.find((x) => x.id === id);
  if (k) k.monitor = box.checked ? 1 : 0;
  box.nextElementSibling.textContent = box.checked ? "Sí" : "No";
  toast(box.checked ? "Se consultará en automático." : "Ya no se consultará en automático.");
}));

const caseForm = $("#case-dialog form");
// Client pickers are search boxes: any letter or word of the name or the document filters the list.
const clientOption = (c) => `<option value="${c.id}" data-sub="${escapeHtml([c.id_type, c.id_number].filter(Boolean).join(" "))}">${escapeHtml(c.full_name)}</option>`;
window.JuanmaCombo.searchSelect(caseForm.elements.client_id);

function fillTypeSelect(catId, selectedTypeId) {
  const cat = categoryOf(catId);
  // First-order sub-processes with their second-order ones indented below.
  const types = cat?.types ?? [];
  caseForm.elements.process_type_id.innerHTML = types.filter((t) => !t.parent_id).map((t) =>
    `<option value="${t.id}">${escapeHtml(t.name)}</option>` +
    types.filter((x) => x.parent_id === t.id).map((x) => `<option value="${x.id}">&nbsp;&nbsp;&nbsp;› ${escapeHtml(x.name)}</option>`).join("")).join("");
  if (selectedTypeId) caseForm.elements.process_type_id.value = selectedTypeId;
  renderCustomFields(cat, {});
  fillRoleSelect();
}

// Procedural role options follow the process: Demandante/Demandado, Ejecutante/Ejecutado, penal roles…
// The process's own roles come first, grouped by side; every other role stays available under «Otros roles».
function roleOptions(selected, blank) {
  const cat = categoryOf(caseForm.elements.category_id.value);
  const type = cat?.types.find((t) => t.id === Number(caseForm.elements.process_type_id.value));
  const r = CMETA.sideRoles(cat?.name || "", type?.path || type?.name || "");
  const labels = CMETA.sideLabels(cat?.name || "", type?.path || type?.name || "");
  const opt = (x) => `<option${x === selected ? " selected" : ""}>${escapeHtml(x)}</option>`;
  const group = (label, list) => list.length ? `<optgroup label="${escapeHtml(label)}">${list.map(opt).join("")}</optgroup>` : "";
  const known = [...r.activa, ...r.pasiva, ...r.others];
  return `<option value="">${escapeHtml(blank)}</option>` + group(labels.activa, r.activa) + group(labels.pasiva, r.pasiva) +
    group("Otros roles", r.others) + (selected && !known.includes(selected) ? opt(selected) : "");
}
function fillRoleSelect(selected = caseForm.elements.client_role.value) {
  caseForm.elements.client_role.innerHTML = roleOptions(selected || "", "— Elija: demandante, demandado… —");
  caseForm.elements.client_role.value = selected || "";
}
const partyLine = (k) => [k.client_role, k.affiliated ? "Afiliado" : ""].filter(Boolean).join(" · ");

function renderCustomFields(cat, values) {
  const box = $("#custom-fields");
  const fields = [...(cat?.fields ?? [])].sort((a, b) => isFolderField(b) - isFolderField(a));
  box.innerHTML = fields.map((f) => {
    const name = `cf_${f.id}`;
    const v = escapeHtml(values[f.id] ?? "");
    const req = f.required ? "required" : "";
    const label = `${escapeHtml(f.label)}${f.required ? " *" : ""}`;
    if (f.field_type === "textarea") return `<label class="span2">${label}<textarea name="${name}" rows="3" ${req}>${v}</textarea></label>`;
    if (f.field_type === "select") {
      return `<label>${label}<select name="${name}" ${req}><option value=""></option>${f.options
        .map((o) => `<option ${values[f.id] === o ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}</select></label>`;
    }
    const type = { number: "number", date: "date" }[f.field_type] || "text";
    return `<label>${label}<input type="${type}" name="${name}" value="${v}" ${req}></label>`;
  }).join("");
}

caseForm.elements.category_id.addEventListener("change", (e) => fillTypeSelect(e.target.value));

// Gerencia creates a process type or a sub-process right from the case form;
// what was already typed in the form stays.
async function newCatalogEntry(kind) {
  const catId = caseForm.elements.category_id.value;
  const cat = categoryOf(catId);
  const name = await ask(kind === "cat"
    ? { title: "Nuevo tipo de proceso", message: "Quedará en Configuración para todos los expedientes. Ej. Civil, Familia, Comercial.", input: "", okLabel: "Crear" }
    : { title: `Nuevo subproceso de ${cat?.name || ""}`, message: "Ej. Ejecutivo singular, Divorcio, Sucesión.", input: "", okLabel: "Crear" });
  if (!name) return;
  try {
    const made = kind === "cat" ? await api("POST", "/categories", { name }) : await api("POST", `/categories/${catId}/types`, { name });
    let typeId = null;
    if (kind === "cat") {
      await loadCatalog();
      // A new process type needs at least one sub-process to file a case under it.
      const sub = await ask({ title: `Primer subproceso de ${made.name}`, message: "Un expediente necesita tipo y subproceso. Puede agregar más después.", input: "General", okLabel: "Crear" });
      if (sub) typeId = (await api("POST", `/categories/${made.id}/types`, { name: sub })).id;
    } else typeId = made.id;
    await loadCatalog();
    const curCat = kind === "cat" ? made.id : Number(catId);
    caseForm.elements.category_id.innerHTML = state.catalog.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
    caseForm.elements.category_id.value = curCat;
    const values = Object.fromEntries([...new FormData(caseForm)].filter(([k]) => k.startsWith("cf_")).map(([k, v]) => [Number(k.slice(3)), v]));
    fillTypeSelect(curCat, typeId);
    if (kind !== "cat") renderCustomFields(categoryOf(curCat), values);
    renderParties();
    toast(kind === "cat" ? `Tipo de proceso «${made.name}» creado.` : `Subproceso «${made.name}» creado.`);
  } catch (err) { toast(err.message, true); }
}
$("[data-new-cat]").addEventListener("click", () => newCatalogEntry("cat"));
$("[data-new-type]").addEventListener("click", () => newCatalogEntry("type"));
caseForm.elements.process_type_id.addEventListener("change", () => fillRoleSelect());

// Responsible people: users of the chosen office, plus roles that see every office.
function fillAssignees(officeId, selected) {
  const sel = caseForm.elements.assigned_user_id;
  const people = caseStaff(officeId);
  sel.innerHTML = '<option value="">— Sin asignar —</option>' +
    people.map((u) => `<option value="${u.id}">${staffLabel(u)}</option>`).join("");
  sel.value = selected && people.some((u) => u.id === selected) ? String(selected) : "";
}
caseForm.elements.office_id.addEventListener("change", (e) => fillAssignees(e.target.value, Number(caseForm.elements.assigned_user_id.value)));

const formatRadicado = (r) => window.JuanmaPortals.formatRadicado(r);

// Courts for the chosen department / city / area, cached per filter.
const courtCache = new Map();
async function courtsFor(dep, city, area) {
  const key = [dep, city, area].join("|");
  if (!courtCache.has(key)) {
    const q = new URLSearchParams({ ...(dep && { department: dep }), ...(city && { city }), ...(area && { area }), limit: "2000" });
    courtCache.set(key, api("GET", `/courts?${q}`));
  }
  return courtCache.get(key);
}
function showCourtEmail(court) {
  $("#court-email").innerHTML = court?.email
    ? `Correo del despacho: <strong class="copyable">${escapeHtml(court.email)}</strong>${court.phone ? ` · Tel. ${escapeHtml(court.phone)}` : ""}`
    : court ? "El directorio no trae correo para este despacho." : "";
}
window.JuanmaCombo.attach(caseForm.elements.court_search, {
  limit: 200,
  get emptyText() {
    return courtsTotal ? "Ningún despacho del directorio coincide con este departamento, ciudad y área."
      : "El directorio de despachos está vacío: cárguelo en Despachos con el archivo oficial de la Rama Judicial.";
  },
  items: async () => (await courtsFor(caseForm.elements.department.value, caseForm.elements.city.value, caseForm.elements.area.value))
    .map((c) => ({ label: c.name, sub: [c.area, c.city !== caseForm.elements.city.value ? c.city : "", c.circuit && `Circuito de ${c.circuit}`, c.email].filter(Boolean).join(" · "), court: c })),
  onPick: (it) => {
    caseForm.elements.court_id.value = it.court.id;
    if (!caseForm.elements.area.value) caseForm.elements.area.value = it.court.area;
    if (!caseForm.elements.department.value) caseForm.elements.department.value = it.court.department;
    if (!caseForm.elements.city.value) caseForm.elements.city.value = it.court.city;
    showCourtEmail(it.court);
    suggestJudge();
  },
  onType: () => { caseForm.elements.court_id.value = ""; showCourtEmail(null); },
});
caseForm.elements.court_search.addEventListener("change", () => suggestJudge());

// Version 2.27: when a court is chosen, show the judge's name the Rama Judicial has for the
// radicado («ponente»), plus the directory's and the ones used in other cases of that court.
// Nothing is filled in by itself: «Usar este nombre» copies it, or the user types it.
let judgeAsk = 0;
async function suggestJudge() {
  const box = $("#judge-suggest");
  const courtId = caseForm.elements.court_id.value, courtName = caseForm.elements.court_search.value.trim();
  const radicado = caseForm.elements.radicado.value.replace(/\D/g, "");
  if (!courtId && !courtName) { box.innerHTML = ""; return; }
  const ask = ++judgeAsk;
  box.innerHTML = `<p class="hint">${radicado.length === 23 ? "Consultando el nombre del juez en la Rama Judicial…" : "Buscando el nombre del juez…"}</p>`;
  let r;
  try {
    r = await api("GET", `/courts/judge?${new URLSearchParams({ court_id: courtId, court_name: courtName, radicado })}`);
  } catch (err) {
    r = { rama: null, rama_error: err.message, directory: "", others: [] };
  }
  if (ask !== judgeAsk) return;
  const current = plainText(caseForm.elements.judge_name.value);
  const seen = new Set();
  const opts = [];
  const add = (name, source) => {
    const key = plainText(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    opts.push({ name: window.JuanmaPerson.properName(name), source });
  };
  if (r.rama?.judge) add(r.rama.judge, "Rama Judicial (consulta del radicado)");
  add(r.directory, "Directorio de despachos");
  for (const n of r.others || []) add(n, "Usado en otros expedientes de este despacho");
  const otherCourt = r.rama?.court && plainText(r.rama.court) !== plainText(courtName)
    ? `<p class="hint">La Rama Judicial registra este radicado en: <strong>${escapeHtml(r.rama.court)}</strong>.</p>` : "";
  box.innerHTML = (opts.length ? `<ul class="judge-options">${opts.map((o) => `<li><span><strong>${escapeHtml(o.name)}</strong>
      <span class="muted">${escapeHtml(o.source)}</span></span>${plainText(o.name) === current
        ? `<span class="follow ok">Elegido</span>` : `<button type="button" class="mini" data-use-judge="${escapeHtml(o.name)}">Usar este nombre</button>`}</li>`).join("")}</ul>` : "")
    + otherCourt + (r.rama_error ? `<p class="hint">${escapeHtml(r.rama_error)}</p>` : "")
    + `<p class="hint">Si el nombre no aparece o cambió, escríbalo a mano en «Nombre del juez».</p>`;
}
$("#judge-suggest").addEventListener("click", (e) => {
  const b = e.target.closest("[data-use-judge]");
  if (!b) return;
  caseForm.elements.judge_name.value = b.dataset.useJudge;
  toast("Nombre del juez elegido. Se guarda al guardar el expediente.");
  suggestJudge();
});
// Written as the firm reads it (73-001-40-03-002-2008-00664-00); saved and queried as 23 digits.
caseForm.elements.radicado.addEventListener("focusout", (e) => { e.target.value = formatRadicado(e.target.value.trim()); });
caseForm.elements.radicado.addEventListener("input", async (e) => {
  const digits = e.target.value.replace(/\D/g, "");
  if (digits.length >= 5 && !caseForm.elements.department.value) {
    const place = await window.JuanmaCombo.placeFromRadicado(digits);
    if (place) { caseForm.elements.department.value = place.department; caseForm.elements.city.value = place.city; }
  }
  if (digits.length === 23 && (caseForm.elements.court_id.value || caseForm.elements.court_search.value.trim())) suggestJudge();
});

// ----- Parties of the case (change 49) -----
let partyRows = [];
const partyBox = $(".parties-box", caseForm);
function renderParties() {
  const cat = categoryOf(caseForm.elements.category_id.value);
  const type = cat?.types.find((t) => t.id === Number(caseForm.elements.process_type_id.value));
  const labels = CMETA.sideLabels(cat?.name || "", type?.path || type?.name || "");
  const main = state.clients.find((c) => c.id === Number(caseForm.elements.client_id.value));
  const mainRole = caseForm.elements.client_role.value;
  const mainSide = CMETA.sideOfRole(mainRole);
  $("[data-main-name]", partyBox).textContent = main ? main.full_name : "";
  caseForm.elements.client_role.classList.toggle("needs-choice", !mainRole);
  for (const side of ["activa", "pasiva"]) {
    const box = $(`[data-side="${side}"]`, partyBox);
    $("[data-side-title]", box).textContent = labels[side];
    $(".party-rows", box).innerHTML = (main && mainSide === side ? `<li class="party-row main"><span><strong>${escapeHtml(main.full_name)}</strong>
        <span class="muted">${escapeHtml([mainRole, main.id_type, main.id_number].filter(Boolean).join(" · "))} · cliente principal</span></span><span class="follow ok">Nuestro cliente</span></li>` : "") +
      partyRows.map((p, i) => p.side !== side ? "" : `<li class="party-row" data-i="${i}">
        <input data-p="name" list="party-clients" value="${escapeHtml(p.name)}" placeholder="Nombre o razón social" aria-label="Nombre" />
        <button type="button" class="mini danger" data-del-party="${i}" aria-label="Quitar">✕</button>
        <select data-p="role" aria-label="Rol en el proceso">${roleOptions(p.role || "", "— Rol —")}</select>
        <input data-p="id_number" value="${escapeHtml(p.id_number)}" placeholder="Cédula o NIT" aria-label="Documento" inputmode="numeric" />
        <label class="inline"><input type="checkbox" data-p="ours" ${p.ours ? "checked" : ""} /> Nuestro cliente</label></li>`).join("");
  }
  $(".hint", partyBox).hidden = false;
}
partyBox.addEventListener("click", (e) => {
  const add = e.target.closest("[data-add-party]");
  if (add) {
    // A new party starts with the first role of its column (Demandante, Demandado, Denunciado…).
    const side = add.dataset.addParty, cat = categoryOf(caseForm.elements.category_id.value);
    const type = cat?.types.find((t) => t.id === Number(caseForm.elements.process_type_id.value));
    const role = CMETA.sideRoles(cat?.name || "", type?.path || type?.name || "")[side][0] || "";
    partyRows.push({ side, role, name: "", id_number: "", ours: false, client_id: null }); renderParties(); $$(`[data-side="${add.dataset.addParty}"] .party-row:last-child input`, partyBox)[0]?.focus(); }
  const del = e.target.closest("[data-del-party]");
  if (del) { partyRows.splice(Number(del.dataset.delParty), 1); renderParties(); }
});
partyBox.addEventListener("input", (e) => {
  const row = e.target.closest(".party-row[data-i]");
  if (!row) return;
  const p = partyRows[Number(row.dataset.i)], key = e.target.dataset.p;
  p[key] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  // Choosing a role moves the party to its side (a demandado goes to the Demandados column).
  if (key === "role") { if (p.role) p.side = CMETA.sideOfRole(p.role); renderParties(); return; }
  if (key === "name") {
    // Picking a registered client fills the document and marks it as ours.
    const c = state.clients.find((x) => x.full_name === p.name);
    p.client_id = c?.id ?? null;
    if (c) { p.id_number = c.id_number || ""; p.ours = true; $("[data-p=id_number]", row).value = p.id_number; $("[data-p=ours]", row).checked = true; }
  }
});
for (const n of ["client_role", "process_type_id", "category_id", "client_id"]) caseForm.elements[n].addEventListener("change", () => renderParties());

async function openCaseDialog(k = null, clientId = null) {
  await Promise.all([loadCatalog(), loadClients()]);
  if (!state.clients.length) {
    toast("Primero cree un cliente.", true);
    location.hash = "#clientes";
    return;
  }
  caseForm.elements.client_id.innerHTML = state.clients.map(clientOption).join("");
  caseForm.elements.category_id.innerHTML = state.catalog
    .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");

  openDialog($("#case-dialog"), k ? `Editar expediente${caseFolder(k) ? ` · Carpeta ${caseFolder(k)}` : ""}` : "Nuevo expediente", k ? {
    id: k.id, title: k.title, status: k.status, counterparty: k.counterparty, facts: k.facts,
    radicado: k.radicado ? formatRadicado(k.radicado) : "", department: k.department, city: k.city, area: k.area,
    court_search: k.court_name, court_id: k.court_id ?? "", judge_name: k.judge_name || "", affiliated: k.affiliated ? "1" : "0",
  } : { affiliated: "0" });
  caseForm.elements.client_role.innerHTML = "";
  caseForm.elements.monitor.checked = k ? !!k.monitor || !k.radicado : true;
  showCourtEmail(k?.court_name ? { email: k.court_email } : null);
  $("#judge-suggest").innerHTML = "";
  if (k?.court_name) suggestJudge();
  caseForm.elements.client_id.value = k?.client_id ?? clientId ?? state.clients[0].id;
  caseForm.elements.client_id.disabled = !!k;
  caseForm.elements.office_id.innerHTML = myOffices().map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join("");
  const clientOffice = state.clients.find((c) => c.id === Number(caseForm.elements.client_id.value))?.office_id;
  const officeId = k?.office_id ?? (myOfficeIds().includes(clientOffice) ? clientOffice : myOffices()[0]?.id);
  caseForm.elements.office_id.value = officeId;
  fillAssignees(officeId, k ? k.assigned_user_id : (["Abogado", "Dependiente Judicial"].includes(me.role) ? me.id : null));
  const catId = k?.category_id ?? state.catalog[0]?.id;
  caseForm.elements.category_id.value = catId;
  fillTypeSelect(catId, k?.process_type_id);
  fillRoleSelect(k?.client_role || "");
  if (k) renderCustomFields(categoryOf(catId), k.field_values);
  partyRows = (k?.parties || []).map((p) => ({ ...p }));
  $("#party-clients").innerHTML = state.clients.map((c) => `<option value="${escapeHtml(c.full_name)}">${escapeHtml([c.id_type, c.id_number].filter(Boolean).join(" "))}</option>`).join("");
  renderParties();
}

wireDialog($("#case-dialog"), async (form) => {
  const d = formData(form);
  const field_values = {};
  for (const [k, v] of Object.entries(d)) if (k.startsWith("cf_")) field_values[k.slice(3)] = v;
  const body = {
    client_id: Number(form.elements.client_id.value),
    process_type_id: Number(d.process_type_id),
    title: d.title, status: d.status, counterparty: d.counterparty, facts: d.facts, field_values,
    client_role: d.client_role, affiliated: d.affiliated === "1",
    office_id: Number(d.office_id), assigned_user_id: Number(d.assigned_user_id) || null,
    radicado: d.radicado, department: d.department, city: d.city, area: d.area,
    court_id: Number(d.court_id) || null, court_name: Number(d.court_id) ? undefined : d.court_search, judge_name: d.judge_name || "", monitor: form.elements.monitor.checked,
    parties: partyRows.filter((p) => p.name.trim()).map(({ side, role, name, id_number, ours, client_id }) => ({ side, role: role || "", name, id_number, ours, client_id })),
  };
  if (d.id) await api("PUT", `/cases/${d.id}`, body);
  else await api("POST", "/cases", body);
  toast(d.id ? "Expediente actualizado." : "Expediente creado.");
  await refreshView();
});

// ---------- Configuración ----------
const FIELD_TYPE_LABELS = { text: "Texto", textarea: "Texto largo", number: "Número", date: "Fecha", select: "Lista" };

// Delivery channels: what the server is set up with, and a test message (Gerencia).
async function renderChannels() {
  const panel = $("#channels-panel");
  panel.hidden = !can("users.manage");
  if (panel.hidden) return;
  const c = await api("GET", "/admin/channels");
  const row = (ok, label, detail) => `<li><span class="badge ${ok ? "ok" : "warn"}">${ok ? "Listo" : "Falta configurar"}</span> <strong>${escapeHtml(label)}</strong> <span class="muted">${escapeHtml(detail)}</span></li>`;
  $("#channels-status").innerHTML = c.web ? "<li class=\"muted\">En el enlace de prueba no se envían correos ni WhatsApp: los canales se configuran en el servidor (Azure).</li>"
    : [row(c.email, "Correo", c.email ? `${c.email_via} · remitente ${c.from}` : "MAIL_TRANSPORT=graph y MAIL_FROM (Microsoft 365), o SMTP_HOST"),
      row(c.whatsapp, "WhatsApp: avisos y recordatorios", c.whatsapp ? `plantilla «${c.whatsapp_template}» · idioma ${c.whatsapp_lang}` : "WHATSAPP_TOKEN, WHATSAPP_PHONE_ID y WHATSAPP_TEMPLATE"),
      row(c.whatsapp_otp, "WhatsApp: códigos de firma", c.whatsapp_otp ? `plantilla de autenticación «${c.whatsapp_template_otp}»` : "WHATSAPP_TEMPLATE_OTP (plantilla de autenticación)"),
      row(!!c.tsa_url, "Sello de tiempo del correo certificado", c.tsa_url ? `${c.tsa_url} (RFC 3161)` : "desactivado (TSA_URL=off)")].join("");
  $$("[data-action=test-email], [data-action=test-whatsapp], [data-action=test-tsa], #channel-test-to").forEach((el) => (el.disabled = !!c.web));
}

async function renderConfiguracion() {
  renderChannels().catch(() => {});
  await loadCatalog();
  const open = new Set($$("#catalog details[open]").map((d) => d.dataset.cat));
  const arrows = (kind, id, first, last) => `<span class="order-btns">
    <button type="button" class="mini" data-move="${kind}" data-id="${id}" data-dir="-1" ${first ? "disabled" : ""} aria-label="Subir">↑</button>
    <button type="button" class="mini" data-move="${kind}" data-id="${id}" data-dir="1" ${last ? "disabled" : ""} aria-label="Bajar">↓</button></span>`;
  const typeRow = (t, i, list, child) => `
    <li class="type-row ${child ? "child" : ""}" draggable="true" data-type="${t.id}" data-parent="${t.parent_id || 0}">
      <span class="drag" aria-hidden="true" title="Arrastre para ordenar">⋮⋮</span>
      <span class="type-name">${escapeHtml(t.name)}</span>
      <span class="uses" title="Expedientes que lo usan">${t.uses} exp.</span>
      <span class="toolbar">
        ${arrows("type", t.id, i === 0, i === list.length - 1)}
        ${child ? "" : `<button class="mini" data-action="add-subtype" data-id="${t.id}">+ Segundo orden</button>`}
        <button class="mini" data-action="rename-type" data-id="${t.id}">Renombrar</button>
        <button class="mini danger" data-action="delete-type" data-id="${t.id}" aria-label="Eliminar">✕</button>
      </span>
    </li>`;
  $("#catalog").innerHTML = state.catalog.map((c, ci) => {
    const top = c.types.filter((t) => !t.parent_id);
    return `
    <details class="panel cat" data-cat="${c.id}" ${open.has(String(c.id)) ? "open" : ""}>
      <summary>
        <span class="cat-name">${escapeHtml(c.name)}</span>
        <span class="muted">${top.length} subprocesos · ${c.types.length - top.length} de segundo orden · ${c.fields.length} campos</span>
        ${arrows("cat", c.id, ci === 0, ci === state.catalog.length - 1)}
      </summary>
      <div class="cat-body">
        <div class="toolbar">
          <button data-action="sort-usage" data-id="${c.id}">Ordenar por más usados</button>
          <button data-action="rename-category" data-id="${c.id}">Renombrar</button>
          <button class="danger" data-action="delete-category" data-id="${c.id}">Eliminar tipo</button>
        </div>
        <h4>Subprocesos <span class="muted">· arrastre o use las flechas para ponerlos en el orden que más le sirva</span></h4>
        <ul class="config-list type-list" data-cat="${c.id}">
          ${top.map((t, i) => {
            const kids = c.types.filter((x) => x.parent_id === t.id);
            return typeRow(t, i, top, false) + (kids.length ? `<li class="kids"><ul class="config-list type-list" data-cat="${c.id}">${kids.map((k, j) => typeRow(k, j, kids, true)).join("")}</ul></li>` : "");
          }).join("")}
        </ul>
        <form class="toolbar" data-form="new-type" data-cat="${c.id}">
          <input name="name" placeholder="Nuevo subproceso" required />
          <button class="primary">+ Agregar</button>
        </form>
        <h4>Campos propios de ${escapeHtml(c.name)}</h4>
        <ul class="config-list">
          ${c.fields.map((f, i) => `<li><span>${escapeHtml(f.label)} <span class="muted">· ${FIELD_TYPE_LABELS[f.field_type]}${f.required ? " · obligatorio" : ""}${f.options.length ? ` · ${escapeHtml(f.options.join(", "))}` : ""}</span></span>
            <span class="toolbar">${arrows("field", f.id, i === 0, i === c.fields.length - 1)}
            <button class="mini danger" data-action="delete-field" data-id="${f.id}" aria-label="Eliminar">✕</button></span></li>`).join("") || '<li class="muted">Sin campos propios todavía.</li>'}
        </ul>
        <form class="field-form" data-form="new-field" data-cat="${c.id}">
          <input name="label" placeholder="Nombre del campo (ej. Etapa, Cuantía)" required />
          <select name="field_type">
            ${Object.entries(FIELD_TYPE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
          </select>
          <input name="options" placeholder="Opciones separadas por coma (solo Lista)" />
          <label class="inline"><input type="checkbox" name="required" /> Obligatorio</label>
          <button class="primary">+ Campo</button>
        </form>
      </div>
    </details>`;
  }).join("");
}

// Save a new sibling order for types (same parent), categories or fields.
async function saveOrder(kind, ids, catId) {
  if (kind === "type") await api("PUT", `/categories/${catId}/order`, { type_ids: ids });
  else if (kind === "cat") await api("PUT", "/category-order", { ids });
  else await api("PUT", `/categories/${catId}/fields/order`, { field_ids: ids });
  await renderConfiguracion();
}
$("#catalog").addEventListener("click", (e) => {
  const b = e.target.closest("[data-move]");
  if (!b) return;
  e.preventDefault(); // arrows in <summary> must not toggle the panel
  const id = Number(b.dataset.id), dir = Number(b.dataset.dir), kind = b.dataset.move;
  let ids, catId;
  if (kind === "cat") ids = state.catalog.map((c) => c.id);
  else {
    const cat = state.catalog.find((c) => (kind === "type" ? c.types : c.fields).some((x) => x.id === id));
    catId = cat.id;
    if (kind === "type") {
      const parent = cat.types.find((t) => t.id === id).parent_id || 0;
      ids = cat.types.filter((t) => (t.parent_id || 0) === parent).map((t) => t.id);
    } else ids = cat.fields.map((f) => f.id);
  }
  const i = ids.indexOf(id);
  [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
  guarded(() => saveOrder(kind, ids, catId));
});
// Drag and drop within the same level.
let dragId = null;
$("#catalog").addEventListener("dragstart", (e) => {
  const li = e.target.closest("[data-type]");
  if (!li) return;
  dragId = li.dataset.type;
  li.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
});
$("#catalog").addEventListener("dragend", (e) => e.target.closest?.("[data-type]")?.classList.remove("dragging"));
$("#catalog").addEventListener("dragover", (e) => {
  const over = e.target.closest("[data-type]");
  const src = dragId && $(`#catalog [data-type="${dragId}"]`);
  if (!over || !src || over === src || over.dataset.parent !== src.dataset.parent) return;
  e.preventDefault();
  const rect = over.getBoundingClientRect();
  over.parentElement.insertBefore(src, e.clientY > rect.top + rect.height / 2 ? over.nextSibling : over);
});
$("#catalog").addEventListener("drop", (e) => {
  const src = dragId && $(`#catalog [data-type="${dragId}"]`);
  dragId = null;
  if (!src) return;
  e.preventDefault();
  const list = src.parentElement;
  const ids = [...list.children].filter((li) => li.dataset.type && li.dataset.parent === src.dataset.parent).map((li) => Number(li.dataset.type));
  guarded(() => saveOrder("type", ids, Number(list.dataset.cat)));
});

document.addEventListener("submit", (e) => {
  const form = e.target.closest("[data-form]");
  if (!form || !["new-category", "new-type", "new-field"].includes(form.dataset.form)) return;
  e.preventDefault();
  guarded(async () => {
    const d = formData(form);
    if (form.dataset.form === "new-category") await api("POST", "/categories", { name: d.name });
    if (form.dataset.form === "new-type") await api("POST", `/categories/${form.dataset.cat}/types`, { name: d.name });
    if (form.dataset.form === "new-field") {
      await api("POST", `/categories/${form.dataset.cat}/fields`, {
        label: d.label, field_type: d.field_type, required: !!d.required,
        options: (d.options || "").split(",").map((s) => s.trim()).filter(Boolean),
      });
    }
    form.reset();
    toast("Guardado.");
    await renderConfiguracion();
    if (form.dataset.cat) $(`#catalog details[data-cat="${form.dataset.cat}"]`).open = true;
  });
});

// ---------- Global button actions ----------
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const ACTIONS = {
    "logout": async () => {
      await api("POST", "/auth/logout");
      $(".user-menu").open = false;
      showAuth({});
    },
    "test-email": async () => {
      const r = await api("POST", "/admin/test-channel", { channel: "email", to: $("#channel-test-to").value });
      $("#channel-test-result").textContent = r.ok ? `Correo de prueba enviado a ${r.detail}. Revise la bandeja (y el correo no deseado).` : `No se envió: ${r.detail}`;
    },
    "test-tsa": async () => {
      const r = await api("POST", "/admin/test-tsa");
      $("#channel-test-result").textContent = r.ok ? `Sello de tiempo funcionando (${r.url}). ${r.detail}.` : `Sello de tiempo no disponible (${r.url || "sin TSA"}): ${r.detail}`;
    },
    "test-whatsapp": async () => {
      const r = await api("POST", "/admin/test-channel", { channel: "whatsapp", to: $("#channel-test-to").value });
      $("#channel-test-result").textContent = r.ok ? `WhatsApp de prueba enviado a ${r.detail}.` : `No se envió: ${r.detail}`;
    },
    "display-prefs": () => openPrefs(),
    "change-email": () => openDialog($("#email-dialog"), "Cambiar correo", { email: me?.email || "" }),
    "change-password": () => {
      $(".user-menu").open = false;
      openDialog($("#password-dialog"), "Cambiar contraseña");
    },
    "new-sign": () => openSignDialog({}),
    "sign-case": () => openSignDialog({ caseId: id }),
    "open-sign": () => openSignDetail(id),
    "new-mail": () => openMailDialog({}),
    "mail-case": () => openMailDialog({ caseId: Number(btn.dataset.case) }),
    "mail-court": () => openMailDialog({ to: btn.dataset.to }),
    "mail-proof": async () => {
      const m = await api("GET", `/mail/${id}`);
      await saveFile(`Constancia de envio - ${safeName(m.subject)}.pdf`, mailProof(m));
    },
    "mail-eml": async () => {
      const f = await api("GET", `/mail/${id}/eml`);
      await saveFile(`Correo ${id} - mensaje original.eml`, new Blob([D.b64ToBytes(f.base64)], { type: "message/rfc822" }));
    },
    "mail-tsr": async () => {
      const f = await api("GET", `/mail/${id}/tsr`);
      await saveFile(`Correo ${id} - sello de tiempo.tsr`, new Blob([D.b64ToBytes(f.base64)], { type: "application/timestamp-reply" }));
    },
    "go": () => { location.hash = btn.dataset.to; },
    "goto-sec": () => goToSection(btn.dataset.sec),
    "go-sec": () => goToSection(btn.dataset.sec),
    "go-back": () => history.back(),
    "go-forward": () => (dlgNav.forward.some((d) => !d.open) ? dialogForward() : history.forward()),
    "open-case": () => { location.hash = `#expediente-${id}`; },
    "new-task": () => openTaskDialog(null, btn.dataset.case ? Number(btn.dataset.case) : null, btn.dataset.kind),
    "edit-task": () => openTaskDialog(agendaCache.find((t) => t.id === id), null, null, {}, btn.dataset.focus),
    "notify-task": () => openTaskDialog(agendaCache.find((t) => t.id === id), null, null, {}, "notify"),
    "set-responsible": async () => {
      const uid = Number($("[name=resp_user]", btn.closest("[data-resp-case]")).value) || null;
      if (!uid) { toast("Elija un funcionario.", true); return; }
      const k = await api("PUT", `/cases/${id}`, { assigned_user_id: uid });
      toast(`${k.assigned_name} quedó como funcionario responsable del expediente.`);
      await refreshView();
      goToSection("responsable");
    },
    "clear-responsible": async () => {
      if (!(await confirmAsk("Quitar", "El expediente quedará sin funcionario responsable. Sus tareas no se borran."))) return;
      await api("PUT", `/cases/${id}`, { assigned_user_id: null });
      toast("El expediente quedó sin responsable.");
      await refreshView();
      goToSection("responsable");
    },
    "task-for": () => {
      const uid = Number($("[name=resp_user]", btn.closest("[data-resp-case]")).value) || null;
      return openTaskDialog(null, id, "tarea", { assigned_user_id: uid });
    },
    "edit-folder": async () => {
      const cur = btn.dataset.folder || "";
      const next = (await api("GET", "/folders/next").catch(() => null))?.next || "";
      let v = cur || next, problem = "";
      // A number already in use shows why and asks again with what was typed.
      for (;;) {
        v = await ask({ title: cur ? `Editar carpeta ${cur}` : "Asignar número de carpeta",
          message: problem || `${cur ? `Número actual: ${cur}. Escriba el nuevo número.` : "Escriba el número de carpeta de este expediente."}${next ? ` El siguiente libre es ${next}.` : ""} La App revisa que no esté asignado a otro expediente.`,
          input: v, okLabel: "Guardar" });
        if (!v || v === cur) return;
        try { await api("PUT", `/cases/${id}/folder`, { folder: v }); break; }
        catch (err) { problem = `${err.message}${next ? ` El siguiente libre es ${next}.` : ""}`; }
      }
      toast(cur ? `Carpeta cambiada de ${cur} a ${v}.` : `Carpeta ${v} asignada al expediente.`);
      await refreshView();
    },
    "task-done": async () => { await api("PUT", `/tasks/${id}`, { status: "hecha" }); toast("Marcada como cumplida."); await refreshView(); },
    "act-remind": () => {
      const a = ACTS_CACHE[Number(btn.dataset.act)];
      return openTaskDialog(null, Number(btn.dataset.case), "termino", { title: `Actuación: ${a.actuacion || ""}`.slice(0, 140), notes: `${String(a.fecha || "").slice(0, 10)} · ${a.anotacion || ""}`.trim() });
    },
    "consult-case": async () => {
      // One request, every platform (change 55): the automatic ones are consulted now, the rest are listed to open.
      btn.disabled = true;
      toast("Consultando en todas las plataformas…");
      try {
        const r = await api("POST", `/monitor/cases/${id}/check-all`);
        lastPortalCheck.set(id, { ...r, at: bogotaNow() });
        const auto = r.portals.filter((p) => p.mode === "auto");
        const failed = auto.filter((p) => !p.ok);
        toast(failed.length ? `No se pudo consultar: ${failed.map((p) => p.detail).join(" · ")}` : r.newCount ? `${r.newCount} actuación(es) nueva(s).` : "Consultado: sin actuaciones nuevas.", failed.length > 0);
      } finally { btn.disabled = false; }
      await refreshView();
      goToSection("actuaciones");
    },
    "delete-task": async () => {
      if (!(await confirmAsk("Eliminar", "Se eliminará esta tarea o audiencia."))) return;
      await api("DELETE", `/tasks/${id}`);
      await refreshView();
    },
    "read-all": async () => { await api("POST", "/notifications/read", {}); await refreshBell(); },
    "rama-case": () => showRama(id),
    "view-acts": () => showActuaciones(id),
    "portals": async () => showPortals(state.cases.find((k) => k.id === id) || await api("GET", `/cases/${id}`)),
    "add-radicado": () => { location.hash = "#radicados"; },
    "new-role": () => openRoleDialog(),
    "rename-role": async () => {
      const name = await ask({ title: "Renombrar rol", input: btn.dataset.role, okLabel: "Guardar" });
      if (name && name !== btn.dataset.role) { await api("PUT", `/admin/roles/${encodeURIComponent(btn.dataset.role)}`, { name }); await renderUsuarios(); }
    },
    "delete-role": async () => {
      if (!(await confirmAsk("Eliminar rol", `Se eliminará el rol “${btn.dataset.role}”.`))) return;
      await api("DELETE", `/admin/roles/${encodeURIComponent(btn.dataset.role)}`);
      await renderUsuarios();
    },
    "new-user": () => openUserDialog(null),
    "edit-user": () => openUserDialog(adminUsers.find((u) => u.id === id)),
    "invite-user": async () => {
      const u = adminUsers.find((x) => x.id === id);
      await api("POST", `/admin/users/${id}/invite`);
      toast(`Invitación enviada a ${u.email}. El enlace vence en 72 horas.`);
      await renderUsuarios();
    },
    "hide-user": async () => {
      const u = adminUsers.find((x) => x.id === id);
      if (!hiddenInfo.has_password && !(await setHiddenPassword())) return;
      if (!(await ask({ title: "Ocultar usuario", okLabel: "Ocultar",
        message: `${u.name} saldrá de esta lista y todo lo que haga (tareas, recibos, firmas, avisos, bitácora, informes y documentos) aparecerá como «Asistente». Puede seguir trabajando normalmente. Para verlo otra vez se pide la contraseña de usuarios ocultos.` }))) return;
      await api("PUT", `/admin/users/${id}/hidden`, { hidden: true });
      toast(`Usuario oculto. Ahora aparece como «Asistente».`);
      await renderUsuarios();
    },
    "unhide-user": async () => {
      const u = adminUsers.find((x) => x.id === id);
      if (!(await ask({ title: "Dejar de ocultar", okLabel: "Mostrar", message: `${u.name} volverá a aparecer con su nombre en toda la App, también en lo que hizo mientras estuvo oculto.` }))) return;
      await api("PUT", `/admin/users/${id}/hidden`, { hidden: false });
      toast(`${u.name} ya no está oculto.`);
      await renderUsuarios();
    },
    "unlock-hidden": async () => {
      const password = await ask({ title: "Ver usuarios ocultos", message: "Escriba la contraseña de usuarios ocultos. La vista se cierra sola en 15 minutos.", input: "", secret: true, okLabel: "Ver" });
      if (!password) return;
      await api("POST", "/admin/hidden-users/unlock", { password });
      await renderUsuarios();
    },
    "lock-hidden": async () => { await api("POST", "/admin/hidden-users/lock"); await renderUsuarios(); },
    "hidden-password": async () => { if (await setHiddenPassword()) await renderUsuarios(); },
    "new-office": () => openOfficeDialog(null),
    "edit-office": () => openOfficeDialog(offices.find((o) => o.id === id)),
    "delete-office": async () => {
      if (!(await confirmAsk("Eliminar oficina", "Solo se puede eliminar una oficina sin clientes ni expedientes."))) return;
      await api("DELETE", `/admin/offices/${id}`);
      toast("Oficina eliminada.");
      await renderUsuarios();
    },
    "new-client": () => openClientDialog(null),
    "client-photo": async () => {
      const mode = btn.dataset.mode;
      if (mode === "clear" && !(await ask({ title: "Quitar foto", okLabel: "Quitar", message: "La foto del cliente se quitará. Sus demás datos no cambian." }))) return;
      const photo = mode === "clear" ? "" : await getPhoto(mode);
      if (photo == null) return;
      await saveClientPhoto(id, photo);
      toast(photo ? "Foto del cliente guardada." : "Foto quitada.");
      await refreshView();
    },
    "edit-client": async () => openClientDialog(await api("GET", `/clients/${id}`)), // fresh copy, with the photo
    "delete-client": async () => {
      const c = state.clients.find((x) => x.id === id);
      if (!(await confirmAsk("¿Eliminar cliente?", `Se eliminará el cliente ${c ? `“${c.full_name}”` : ""}. Esta acción no se puede deshacer.`))) return;
      await api("DELETE", `/clients/${id}`);
      state.selectedClientId = null;
      toast("Cliente eliminado.");
      location.hash === "#clientes" ? await renderClientes() : (location.hash = "#clientes");
    },
    "new-case": () => openCaseDialog(null, btn.dataset.client ? Number(btn.dataset.client) : state.selectedClientId),
    "edit-case": async () => openCaseDialog(await api("GET", `/cases/${id}`)),
    "delete-case": async () => {
      const k = state.cases.find((x) => x.id === id);
      const which = k ? [caseFolder(k) && `carpeta ${caseFolder(k)}`, k.client_name, k.type_name].filter(Boolean).join(" · ") : "";
      if (!(await confirmAsk("¿Eliminar expediente?", `Se eliminará el expediente${which ? ` (${which})` : ""} con sus datos. Esta acción no se puede deshacer.`))) return;
      await api("DELETE", `/cases/${id}`);
      toast("Expediente eliminado.");
      if (route().name === "expediente") { history.back(); return; }
      await refreshView();
    },
    "draft-case": () => {
      pendingDraftCase = id;
      $("#tpl-case").value = String(id);
      location.hash === "#borradores" ? renderBorradores() : (location.hash = "#borradores");
    },
    "new-template": () => openTemplateDialog(null),
    "edit-template": async () => openTemplateDialog(await api("GET", `/templates/${id}`)),
    "verify-sign": async () => {
      const dlg = $("#verify-dialog");
      $("form", dlg).reset();
      $("#verify-result").innerHTML = "";
      $("#verify-public").textContent = WEB ? "" : `Cualquier persona puede verificar sin entrar a la app en ${location.origin}/verificar.html (el código va al pie de cada página del PDF firmado).`;
      dlg.showModal();
    },
    "prepare-blanks": async () => tplActive?.format === "docx" && openBlanksDialog(tplActive),
    "download-template": async () => downloadTemplate(id),
    "replace-template": async () => { replaceFor = id; $("#tpl-replace-file").click(); },
    "tpl-markers": async () => openMarkers(),
    "case-docs": async () => openCaseDocs(id),
    "delete-casedoc": async () => {
      if (!(await ask({ title: "Eliminar documento", message: "El documento se borrará del expediente.", okLabel: "Eliminar", danger: true }))) return;
      await api("DELETE", `/cases/${casedocsCase.id}/documents/${id}`);
      await renderCaseDocs();
    },
    "delete-template": async () => {
      if (!(await confirmAsk("Eliminar plantilla", "La plantilla dejará de estar disponible para todos los usuarios."))) return;
      await api("DELETE", `/templates/${id}`);
      if (tplActive?.id === id) { tplActive = null; $("#tpl-active").hidden = true; $("#tpl-empty").hidden = false; }
      await renderBorradores();
    },
    "add-subtype": async () => {
      const parent = typeById(id);
      const name = await ask({ title: `Subproceso de segundo orden en “${parent.name}”`, input: "", okLabel: "Agregar" });
      if (!name) return;
      await api("POST", `/categories/${parent.category_id}/types`, { name, parent_id: id });
      toast("Subproceso agregado.");
      await renderConfiguracion();
      $(`#catalog details[data-cat="${parent.category_id}"]`).open = true;
    },
    "sort-usage": async () => {
      await api("POST", `/categories/${id}/sort-by-usage`);
      toast("Ordenado por número de expedientes.");
      await renderConfiguracion();
      $(`#catalog details[data-cat="${id}"]`).open = true;
    },
    "rename-category": async () => {
      const name = await ask({ title: "Renombrar tipo de proceso", input: categoryOf(id).name, okLabel: "Guardar" });
      if (name) { await api("PUT", `/categories/${id}`, { name }); await renderConfiguracion(); }
    },
    "delete-category": async () => {
      if (!(await confirmAsk("Eliminar tipo de proceso", "Se eliminarán también sus subprocesos y campos propios."))) return;
      await api("DELETE", `/categories/${id}`);
      await renderConfiguracion();
    },
    "rename-type": async () => {
      const name = await ask({ title: "Renombrar subproceso", input: typeById(id).name, okLabel: "Guardar" });
      if (name) { await api("PUT", `/types/${id}`, { name }); await renderConfiguracion(); }
    },
    "delete-type": async () => {
      if (!(await confirmAsk("Eliminar subproceso", "Se eliminará este subproceso del catálogo."))) return;
      await api("DELETE", `/types/${id}`);
      await renderConfiguracion();
    },
    "delete-field": async () => {
      if (!(await confirmAsk("Eliminar campo", "Los valores guardados en los expedientes dejarán de mostrarse."))) return;
      await api("DELETE", `/fields/${id}`);
      await renderConfiguracion();
    },
  };
  if (btn.dataset.action?.startsWith("delete-") && !isGerencia()) return toast("Solo Gerencia puede eliminar.", true);
  if (ACTIONS[btn.dataset.action]) guarded(ACTIONS[btn.dataset.action]);
});

// ---------- Borradores ----------
const draftForm = $("#draft-form");
let pendingDraftCase = null;
let lastResult = null;

draftForm.paymentRequired.addEventListener("change", (e) => (draftForm.paymentItems.disabled = !e.target.checked));

async function renderNomos() {
  await loadCases();
  const sel = draftForm.caseId;
  const cur = pendingDraftCase ?? sel.value;
  sel.innerHTML = '<option value="">— Sin expediente: llenar a mano —</option>' + state.cases
    .map((k) => `<option value="${k.id}">${escapeHtml(k.client_name)} · ${escapeHtml(k.type_name)}${k.title ? " · " + escapeHtml(k.title) : ""}</option>`)
    .join("");
  sel.value = cur ? String(cur) : "";
  pendingDraftCase = null;
  applyCaseToDraft();
}

function applyCaseToDraft() {
  const k = state.cases.find((k) => k.id === Number(draftForm.caseId.value));
  const summary = $("#case-summary");
  $("#manual-client").hidden = !!k;
  summary.hidden = !k;
  if (!k) return;
  summary.textContent = `Se usarán los datos de ${k.client_name} y del expediente ${k.category_name} › ${k.type_name}. Lo que escriba abajo complementa o reemplaza los hechos guardados.`;
  draftForm.counterparty.value = k.counterparty || "";
  draftForm.facts.value = "";
  draftForm.facts.placeholder = k.facts ? `Hechos guardados: ${k.facts.slice(0, 140)}…` : "Instrucciones adicionales";
  // A right of petition is the natural first document for petition-type processes.
  if (/petici/i.test(k.type_name + k.category_name)) draftForm.documentType.value = "PETITION";
}
draftForm.caseId.addEventListener("change", applyCaseToDraft);

function setStatus(text, isError = false) {
  const el = $("#status");
  el.hidden = !text;
  el.textContent = text || "";
  el.classList.toggle("error", isError);
}

// [FILL: …] markers are highlighted before sanitizing, so nothing is added to the HTML after DOMPurify checked it (audit A05-001).
function renderMarkdown(md) {
  const marked_ = marked.parse(md).replace(/\[FILL:\s*([^\]<>"]+)\]/g, '<mark class="fill">[FILL: $1]</mark>');
  return DOMPurify.sanitize(marked_, { ADD_TAGS: ["mark"] });
}

const ISSUE_LABELS = {
  FORBIDDEN_PHRASE: "Frases prohibidas detectadas",
  MISSING_AUDIT_FOOTER: "Falta el pie de auditoría humana",
  MISSING_ESIGN_FIELD: "Falta campo de trazabilidad de firma",
  PAYLOAD_INVALID: "JSON del backend inválido",
  BOLD_ID_MISMATCH: "ID de transacción Bold no coincide",
  BOLD_LINK_MISSING: "Falta el enlace de pago Bold en el documento",
  TRUNCATED: "Respuesta truncada",
};

function renderAudit(result) {
  const parts = [result.ok
    ? '<span class="ok">✓ Verificación automática superada</span>'
    : '<span class="error">✗ El borrador no supera la verificación automática</span>'];
  const items = result.issues.map((i) =>
    `<li class="${i.level}">${escapeHtml(ISSUE_LABELS[i.code] || i.code)}: ${escapeHtml(String(i.detail))}</li>`);
  if (result.fillFields.length) items.push(`<li class="warning">Datos por completar: ${result.fillFields.map(escapeHtml).join("; ")}</li>`);
  if (result.boldLink) items.push(`<li>Referencia Bold: <code>${escapeHtml(result.transactionId)}</code></li>`);
  if (items.length) parts.push(`<ul>${items.join("")}</ul>`);
  $("#audit").innerHTML = parts.join("");
  $("#audit").hidden = false;
}

let baseTemplate = null; // { name, text } when NomosAI completes a firm template
function setBaseTemplate(t) {
  baseTemplate = t;
  const note = $("#base-template-note");
  note.hidden = !t;
  note.innerHTML = t ? `NomosAI usará como base la plantilla <strong>${escapeHtml(t.name)}</strong>. <button type="button" class="mini" id="drop-base">Quitar</button>` : "";
}
document.addEventListener("click", (e) => { if (e.target.id === "drop-base") setBaseTemplate(null); });

function collectDraft() {
  const f = draftForm.elements;
  const caseId = Number(f.caseId.value) || null;
  return {
    template: baseTemplate?.text,
    caseId,
    documentType: f.documentType.value,
    language: f.language.value,
    jurisdiction: f.jurisdiction.value.trim(),
    client: caseId ? {} : {
      fullName: f.fullName.value.trim(), idNumber: f.idNumber.value.trim(),
      email: f.email.value.trim(), address: f.address.value.trim(),
    },
    counterparty: f.counterparty.value.trim(),
    facts: f.facts.value.trim(),
    payment: { required: f.paymentRequired.checked, items: f.paymentItems.value.trim() },
  };
}

draftForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const submitBtn = $("#submit");
  submitBtn.disabled = true;
  $$("[data-out]").forEach((b) => (b.disabled = true));
  $("#audit").hidden = true;
  $("#payload-box").hidden = true;
  lastResult = null;
  setStatus("Redactando borrador…");
  const pre = document.createElement("pre");
  pre.className = "streaming";
  $("#document").replaceChildren(pre);

  try {
    for await (const evt of backend.generate(collectDraft())) {
      if (evt.type === "text") pre.textContent += evt.text;
      else if (evt.type === "error") throw new Error(evt.error);
      else if (evt.type === "done") lastResult = evt;
    }
    if (!lastResult) throw new Error("La respuesta terminó sin resultado.");
    $("#document").innerHTML = renderMarkdown(lastResult.document);
    renderAudit(lastResult);
    if (lastResult.payload) {
      $("#payload").textContent = JSON.stringify(lastResult.payload, null, 2);
      $("#payload-box").hidden = false;
    }
    $$("[data-out]").forEach((b) => (b.disabled = b.dataset.out === "copy-json" && !lastResult.payload));
    setStatus("");
  } catch (err) {
    setStatus(`Error: ${err.message}`, true);
  } finally {
    submitBtn.disabled = false;
  }
});

$(".actions").addEventListener("click", async (e) => {
  const action = e.target.dataset?.out;
  if (!action || !lastResult) return;
  if (action === "copy-md") {
    await navigator.clipboard.writeText(lastResult.document);
    setStatus("Markdown copiado.");
  } else if (action === "copy-json") {
    await navigator.clipboard.writeText(JSON.stringify(lastResult.payload, null, 2));
    setStatus("JSON copiado.");
  } else if (action === "download-md") {
    await saveFile(`${(lastResult.payload?.document_type || "borrador").toLowerCase()}.md`, new Blob([lastResult.document], { type: "text/markdown" }));
  } else if (["docx", "pdf", "save", "mail", "whatsapp"].includes(action)) {
    const name = lastResult.payload?.document_type ? `Borrador ${lastResult.payload.document_type}` : "Borrador";
    const caseId = Number(draftForm.caseId.value) || null;
    const k = caseId ? state.cases.find((x) => x.id === caseId) : null;
    await guarded(() => exportDocument(action, { name, caseId, base: safeName(k ? `${name} - ${k.client_name}` : name),
      word: () => D.markdownToDocx(lastResult.document, name), pdf: () => markdownToPdf(lastResult.document) }));
  } else if (action === "sign") {
    await openSignDialog({ title: lastResult.payload?.document_type ? `Borrador ${lastResult.payload.document_type}` : "Documento", text: lastResult.document,
      caseId: Number(draftForm.caseId.value) || null });
  } else if (action === "verify") {
    $("#j-verify-text").value = lastResult.document;
    location.hash = "#jurisprudencia";
    showJTab("verificar");
    detectAndVerify();
  }
});

// ---------- Importar ----------
const IMP = window.JuanmaImport;
const imp = { sheets: [], headers: [], body: [], mapping: [] };

const importMode = () => $("input[name=import-mode]:checked").value;

async function renderImportar() {
  await loadCatalog();
  const catSel = $("#import-default-cat");
  const cur = catSel.value;
  catSel.innerHTML = '<option value="">— Ninguno —</option>' +
    state.catalog.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join("");
  catSel.value = cur;
  fillDefaultTypes();
}

function fillDefaultTypes() {
  const cat = state.catalog.find((c) => c.name === $("#import-default-cat").value);
  $("#import-default-type").innerHTML = '<option value="">— Ninguno —</option>' +
    (cat?.types ?? []).map((t) => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join("");
}
$("#import-default-cat").addEventListener("change", fillDefaultTypes);

$("#import-file").addEventListener("change", (e) => guarded(async () => {
  const file = e.target.files[0];
  $("#import-result").hidden = true;
  if (!file) return;
  imp.sheets = await IMP.readFile(file);
  const sel = $("#import-sheet");
  sel.innerHTML = imp.sheets.map((s, i) => `<option value="${i}">${escapeHtml(s.name)} (${s.rows.length} filas)</option>`).join("");
  $("#import-sheet-wrap").hidden = imp.sheets.length < 2;
  loadSheet(0);
}));
$("#import-sheet").addEventListener("change", (e) => loadSheet(Number(e.target.value)));

function loadSheet(i) {
  const { headers, body } = IMP.splitHeader(imp.sheets[i].rows);
  imp.headers = headers;
  imp.body = body;
  imp.mapping = IMP.guessAll(headers);
  const info = $("#import-file-info");
  info.hidden = false;
  if (!headers.length) {
    info.textContent = "No se encontró una fila de encabezados en esta hoja.";
    ["#import-step2", "#import-step3", "#import-step4"].forEach((s) => ($(s).hidden = true));
    return;
  }
  info.textContent = `${body.length} filas de datos y ${headers.length} columnas.`;
  // A file with process columns is most likely one row per case.
  const hasCase = imp.mapping.some((m) => m.startsWith("case."));
  $(`input[name=import-mode][value=${hasCase ? "cases" : "clients"}]`).checked = true;
  ["#import-step2", "#import-step3", "#import-step4"].forEach((s) => ($(s).hidden = false));
  renderMapping();
}

function renderMapping() {
  const casesMode = importMode() === "cases";
  $("#import-case-opts").hidden = !casesMode;
  const targets = IMP.TARGETS.filter((t) => casesMode || !t.key.startsWith("case."));
  $("#import-map").innerHTML = imp.headers.map((h, i) => {
    const sample = imp.body.find((r) => r[i])?.[i] ?? "";
    return `<tr>
      <td><strong>${escapeHtml(h)}</strong></td>
      <td title="${escapeHtml(sample)}">${escapeHtml(sample)}</td>
      <td><select data-col="${i}">${targets.map((t) =>
        `<option value="${t.key}" ${t.key === imp.mapping[i] ? "selected" : ""}>${escapeHtml(t.label)}</option>`).join("")}</select></td>
    </tr>`;
  }).join("");
  // Columns mapped to case fields fall back to "No importar" in clients-only mode.
  $$("#import-map select").forEach((sel) => (imp.mapping[sel.dataset.col] = sel.value));
  renderImportPreview();
}

$$("input[name=import-mode]").forEach((r) => r.addEventListener("change", renderMapping));
$("#import-map").addEventListener("change", (e) => {
  const sel = e.target.closest("select[data-col]");
  if (!sel) return;
  imp.mapping[sel.dataset.col] = sel.value;
  renderImportPreview();
});

function importRecords() {
  return imp.body.map((row, i) => ({ ...IMP.buildRecord(row, imp.headers, imp.mapping), rowNumber: i + 2 }))
    .filter((r) => Object.keys(r.client).length || Object.keys(r.case).length);
}

function renderImportPreview() {
  const casesMode = importMode() === "cases";
  const recs = importRecords();
  const cols = [["client.full_name", "Cliente"], ["client.id_number", "Documento"], ["client.email", "Correo"], ["client.phone", "Teléfono"]];
  if (casesMode) {
    cols.push(["case.category", "Tipo de proceso"], ["case.type", "Subproceso"]);
    for (const [k, l] of [["case.radicado", "Radicado"], ["case.status", "Estado"], ["case.court_name", "Despacho"], ["case.folder", "Carpeta"], ["pay.fees", "Honorarios"], ["pay.paid", "Pagos"], ["case.title", "Asunto"]])
      if (imp.mapping.includes(k)) cols.push([k, l]);
  }
  const head = `<thead><tr>${cols.map(([, l]) => `<th>${l}</th>`).join("")}${casesMode ? "<th>Campos propios</th>" : ""}</tr></thead>`;
  const rows = recs.slice(0, 5).map((r) => `<tr>${cols.map(([k]) => {
    const [o, f] = k.split(".");
    const v = r[o][f] ?? "";
    return `<td>${escapeHtml(k === "case.status" && v ? window.JuanmaCaseMeta.normStatus(v) : o === "pay" && v ? cop(IMP.parsePesos(v)) : v)}</td>`;
  }).join("")}${casesMode ? `<td>${escapeHtml(Object.entries(r.custom).map(([k, v]) => `${k}: ${v}`).join("\n"))}</td>` : ""}</tr>`).join("");
  $("#import-preview").innerHTML = head + `<tbody>${rows}</tbody>`;
  const noName = !imp.mapping.includes("client.full_name") && !imp.mapping.includes("client.first_names");
  const btn = $("#import-run");
  btn.disabled = noName || !recs.length;
  btn.textContent = noName ? "Asigne la columna del nombre del cliente" : `Importar ${recs.length} filas`;
}

$("#import-run").addEventListener("click", () => guarded(async () => {
  const records = importRecords();
  const casesMode = importMode() === "cases";
  const btn = $("#import-run");
  const bar = $("#import-progress");
  btn.disabled = true;
  bar.hidden = false;
  bar.value = 0;
  try {
    const sum = await IMP.run(records, api, {
      withCases: casesMode,
      createCatalog: $("#import-create-catalog").checked,
      defaultCategory: $("#import-default-cat").value,
      defaultType: $("#import-default-type").value,
      canPay: can("payments.manage"),
      onProgress: (done, total) => (bar.value = done / total),
    });
    const res = $("#import-result");
    res.hidden = false;
    res.innerHTML = `
      <p class="${sum.errors.length ? "" : "ok"}"><strong>Importación terminada.</strong></p>
      <ul>
        <li>Clientes nuevos: <strong>${sum.clientsCreated}</strong></li>
        <li>Clientes existentes completados: <strong>${sum.clientsCompleted}</strong></li>
        ${casesMode ? `<li>Expedientes nuevos: <strong>${sum.casesCreated}</strong></li>
        <li>Expedientes que ya existían (omitidos): <strong>${sum.casesSkipped}</strong></li>` : ""}
        ${sum.charges ? `<li>Honorarios registrados en Pagos: <strong>${sum.charges}</strong></li>` : ""}
        ${sum.receipts ? `<li>Pagos anteriores registrados como recibos: <strong>${sum.receipts}</strong></li>` : ""}
        ${sum.catalogCreated.length ? `<li>Agregado a Configuración: ${escapeHtml(sum.catalogCreated.join("; "))}</li>` : ""}
        <li>Filas con error: <strong>${sum.errors.length}</strong></li>
      </ul>
      ${sum.errors.length ? `<div class="errors"><ul>${sum.errors.map((e) =>
        `<li>Fila ${e.row}: ${escapeHtml(e.message)}</li>`).join("")}</ul></div>` : ""}`;
    toast("Importación terminada.");
    await loadCatalog();
  } finally {
    btn.disabled = false;
  }
}));

// ---------- Inicio ----------
const OPEN_STATUSES = new Set(["Activo"]);

async function renderInicio() {
  const now = bogotaNow();
  const in7 = new Date(Date.now() - 5 * 3600 * 1000 + 7 * 86400000).toISOString().slice(0, 16).replace("T", " ");
  const in14 = new Date(Date.now() - 5 * 3600 * 1000 + 14 * 86400000).toISOString().slice(0, 16).replace("T", " ");
  const [clients, cases, catalog, tasks, monitored] = await Promise.all([
    api("GET", "/clients"), api("GET", "/cases"), api("GET", "/catalog"),
    api("GET", `/tasks?status=pendiente&to=${encodeURIComponent(in14)}`),
    can("processes.consult") ? api("GET", "/monitor/cases") : Promise.resolve(null),
  ]);
  const hour = Number(now.slice(11, 13));
  $("#greeting").textContent = `${hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches"}, ${me.name.split(" ")[0]}`;
  $("#kpi-clients").textContent = clients.length;
  $("#kpi-open").textContent = cases.filter((k) => OPEN_STATUSES.has(k.status)).length;
  $("#kpi-total").textContent = `de ${cases.length} en total`;
  $("#kpi-due").textContent = tasks.filter((t) => t.due_at <= in7).length;
  $("#kpi-hearings").textContent = tasks.filter((t) => t.kind === "audiencia" && t.due_at >= now).length;
  $("#kpi-news-tile").hidden = !monitored;
  if (monitored) $("#kpi-news").textContent = monitored.reduce((a, k) => a + k.new_7d, 0);

  $("#dash-agenda").innerHTML = tasks.slice(0, 7).map((t) => `
    <li class="${t.due_at < now ? "late" : ""}">
      <span class="badge ${t.kind === "audiencia" ? "ok" : t.kind === "termino" ? "warn" : ""}">${KIND_LABEL[t.kind]}</span>
      <div><strong>${escapeHtml(t.title)}</strong><span>${escapeHtml(t.client_name)} · ${escapeHtml(t.due_at < now ? "Vencida " + t.due_at : dayLabel(t.due_at.slice(0, 10)) + " " + t.due_at.slice(11))}</span></div>
    </li>`).join("") || '<li class="empty">Sin audiencias ni vencimientos en los próximos 14 días.</li>';

  const counts = catalog.map((c) => ({ name: c.name, n: cases.filter((k) => k.category_id === c.id).length }))
    .filter((c) => c.n).sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...counts.map((c) => c.n));
  $("#chart-by-type").innerHTML = counts.map((c) => `
    <div class="hbar" role="listitem" title="${escapeHtml(c.name)}: ${c.n} expediente(s)">
      <span class="hbar-label">${escapeHtml(c.name)}</span>
      <span class="hbar-track"><span class="hbar-fill" style="width:${(c.n / max) * 100}%"></span></span>
      <span class="hbar-value">${c.n}</span>
    </div>`).join("") || '<p class="empty">Sin expedientes todavía.</p>';

  $("#recent-cases").innerHTML = cases.slice(0, 6).map((k) => `
    <li>
      <span class="pill">${escapeHtml(k.category_name)}</span>
      <div><strong>${escapeHtml(k.client_name)}</strong><span>${escapeHtml(k.type_name)}${k.title ? " · " + escapeHtml(k.title) : ""}</span></div>
      <span class="status-tag">${escapeHtml(k.status)}</span>
    </li>`).join("") || '<li class="empty">Aún no hay expedientes.</li>';
}

// ---------- Jurisprudencia ----------
const CSJ_SALAS = ["Sala Plena", "Sala de Casación Civil, Agraria y Rural", "Sala de Casación Laboral", "Sala de Casación Penal", "Sala de Instrucción", "Sala de Primera Instancia"];
const COURT_NAMES = { CC: "Corte Constitucional", CSJ: "Corte Suprema de Justicia", CE: "Consejo de Estado", TRIB: "Tribunales" };
let jResults = [];
let jAnalysis = null;
let pendingSave = null;

function showJTab(name) {
  $$("[data-jtab]").forEach((b) => b.classList.toggle("active", b.dataset.jtab === name));
  $$("[data-jpanel]").forEach((p) => (p.hidden = p.dataset.jpanel !== name));
  if (name === "guardadas") guarded(renderSaved);
}
$("#juris-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-jtab]");
  if (b) showJTab(b.dataset.jtab);
});

// Version 2.13: the test link cannot open the courts' sites, so «Buscar» and «Verificar citas» send the user
// to the app on the server with the search already written ("#jurisprudencia?q=…"), where it runs at once.
const SERVER_URL = (window.JUANMA_SERVER_URL || "").replace(/\/+$/, "");
const JURIS_PARAMS = { q: "query", corte: "court", sala: "sala", desde: "yearFrom", hasta: "yearTo" };
function serverJurisLink(params) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  return `${SERVER_URL}/#jurisprudencia${q.toString() ? "?" + q : ""}`;
}
function searchLink() {
  const f = formData(jSearch);
  return serverJurisLink(Object.fromEntries(Object.entries(JURIS_PARAMS).map(([k, name]) => [k, (f[name] || "").trim()])));
}
// Long documents do not fit in an address: they are opened only if short enough, otherwise pasted there.
const VERIFY_LINK_MAX = 6000;
function verifyLink() {
  const text = $("#j-verify-text").value.trim();
  return serverJurisLink({ tab: "verificar", texto: text.length <= VERIFY_LINK_MAX ? text : "" });
}
function serverNote(sel, href, label, extra = "") {
  const el = $(sel);
  el.hidden = false;
  el.innerHTML = `<p><strong>En este enlace de pruebas no se puede consultar las relatorías oficiales.</strong>
    Los sitios de la Corte Constitucional, la Corte Suprema, el Consejo de Estado y la Rama Judicial solo se consultan desde la App instalada en el servidor (Azure), con su usuario de siempre.${extra}</p>
    ${SERVER_URL ? `<a class="button" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label} ›</a>` : ""}`;
}
function showServerNotes() {
  serverNote("#j-search-server", searchLink(), "Buscar en la App del servidor", " El botón abre allí esta misma búsqueda y la ejecuta.");
  const long = $("#j-verify-text").value.trim().length > VERIFY_LINK_MAX;
  serverNote("#j-verify-server", verifyLink(), "Verificar en la App del servidor",
    long ? " El texto es largo para enviarlo en el enlace: cópielo y péguelo allí." : " El botón lleva allí el texto pegado y verifica sus citas.");
}

async function renderJurisprudencia() {
  if (WEB) return showServerNotes();
  const m = location.hash.match(/^#jurisprudencia\?(.*)$/);
  if (!m) return;
  history.replaceState(null, "", location.pathname + location.search + "#jurisprudencia"); // run it only once
  const p = new URLSearchParams(m[1]);
  if (p.get("tab") === "verificar") {
    showJTab("verificar");
    if (p.get("texto")) { $("#j-verify-text").value = p.get("texto"); await detectAndVerify(); }
    return;
  }
  showJTab("buscar");
  jSearch.reset();
  jSearch.court.value = COURT_NAMES[p.get("corte")] ? p.get("corte") : "";
  jSearch.court.dispatchEvent(new Event("change"));
  if (CSJ_SALAS.includes(p.get("sala"))) jSearch.sala.value = p.get("sala");
  jSearch.yearFrom.value = p.get("desde") || "";
  jSearch.yearTo.value = p.get("hasta") || "";
  jSearch.query.value = p.get("q") || "";
  if (jSearch.query.value) jSearch.requestSubmit();
}

const verifiedBadge = (v) => v
  ? '<span class="badge ok">✓ Fuente oficial verificada</span>'
  : '<span class="badge warn">Sin verificar en fuente oficial</span>';
const safeLink = (url) => /^https:\/\//.test(url || "")
  ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Abrir fuente</a>` : "";

const jSearch = $("#j-search");
jSearch.court.addEventListener("change", () => {
  const csj = jSearch.court.value === "CSJ";
  jSearch.sala.disabled = !csj;
  jSearch.sala.innerHTML = '<option value="">Todas las salas</option>' +
    (csj ? CSJ_SALAS.map((s) => `<option>${escapeHtml(s)}</option>`).join("") : "");
});

function setBox(sel, text, isError = false) {
  const el = $(sel);
  el.hidden = !text;
  el.textContent = text || "";
  el.classList.toggle("error", isError);
}

// Research takes a while: show the seconds so the wait is visible. Returns the stop function.
function elapsedBox(sel, text) {
  const t0 = Date.now();
  const tick = () => setBox(sel, `${text} (${Math.round((Date.now() - t0) / 1000)} s)`);
  tick();
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}
const fromCache = (o) => (o?.cached ? "Respuesta guardada de una consulta anterior (menos de 30 días). " : "");

jSearch.addEventListener("input", () => WEB && showServerNotes());
jSearch.addEventListener("change", () => WEB && showServerNotes());
$("#j-verify-text").addEventListener("input", () => WEB && showServerNotes());

jSearch.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (WEB) { // nothing to search here: point at the server button instead of failing
    showServerNotes();
    $("#j-search-server a")?.focus();
    return;
  }
  const btn = $("button", jSearch);
  btn.disabled = true;
  $("#j-results").innerHTML = "";
  const stop = elapsedBox("#j-search-status", "Buscando en las relatorías oficiales…");
  try {
    const out = await api("POST", "/jurisprudencia/search", formData(jSearch));
    stop();
    jResults = out.results || [];
    setBox("#j-search-status", fromCache(out) + (jResults.length ? (out.notes || "") : `Sin resultados. ${out.notes || ""}`));
    $("#j-results").innerHTML = jResults.map((r, i) => `
      <article class="result-card">
        <div class="result-head">
          <span class="pill">${escapeHtml(r.court || "")}</span>
          ${verifiedBadge(r.verified)}
        </div>
        <h4>${escapeHtml(r.reference || "")}</h4>
        <p class="muted">${escapeHtml([r.sala, r.date, r.reporting_judge && "M.P. " + r.reporting_judge].filter(Boolean).join(" · "))}</p>
        <p>${escapeHtml(r.topic || "")}</p>
        <div class="toolbar">
          <button class="primary" data-jact="analyze" data-i="${i}">Analizar</button>
          <button data-jact="save-result" data-i="${i}">Guardar</button>
          ${safeLink(r.url)}
        </div>
      </article>`).join("");
  } catch (err) {
    stop();
    setBox("#j-search-status", `Error: ${err.message}`, true);
  } finally {
    btn.disabled = false;
  }
});

const jAnalyze = $("#j-analyze");
async function runAnalysis(body) {
  showJTab("analizar");
  const box = $("#j-analysis");
  box.hidden = true;
  const stop = elapsedBox("#j-analyze-status", body.text ? "NomosAI está leyendo el texto pegado…" : "Leyendo la sentencia en la fuente oficial…");
  $("button", jAnalyze).disabled = true;
  try {
    jAnalysis = await api("POST", "/jurisprudencia/analyze", body);
    stop();
    setBox("#j-analyze-status", fromCache(jAnalysis));
    renderAnalysis(jAnalysis);
  } catch (err) {
    stop();
    setBox("#j-analyze-status", `Error: ${err.message}`, true);
  } finally {
    $("button", jAnalyze).disabled = false;
  }
}

function renderAnalysis(a) {
  const box = $("#j-analysis");
  box.hidden = false;
  if (!a.found) {
    box.innerHTML = `<h3>No se encontró en las fuentes oficiales</h3><p>${escapeHtml(a.notes || "")}</p>`;
    return;
  }
  const sec = (title, body) => body ? `<section><h4>${title}</h4>${body}</section>` : "";
  const p = (t) => t ? `<p>${escapeHtml(t)}</p>` : "";
  box.innerHTML = `
    <div class="result-head">
      <span class="pill">${escapeHtml(a.court || "")}</span>${verifiedBadge(a.verified)}
    </div>
    <h3>${escapeHtml(a.reference || "")}</h3>
    <p class="muted">${escapeHtml([a.sala, a.date, a.reporting_judge && "M.P. " + a.reporting_judge].filter(Boolean).join(" · "))}</p>
    ${sec("Resumen", p(a.summary))}
    ${sec("Problema jurídico", p(a.legal_problem))}
    ${sec("Hechos", p(a.facts))}
    ${sec("Regla de decisión (ratio decidendi)", p(a.ratio_decidendi))}
    ${sec("Decisión", p(a.decision))}
    ${sec("Salvamentos y aclaraciones", p(a.dissents))}
    ${sec("Normas aplicadas", (a.cited_norms || []).length ? `<ul>${a.cited_norms.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>` : "")}
    ${sec("Citas textuales", (a.key_quotes || []).map((q) => `<blockquote>“${escapeHtml(q.text)}”<cite>${escapeHtml(q.section || "")}</cite></blockquote>`).join(""))}
    ${a.notes ? `<p class="muted">${escapeHtml(a.notes)}</p>` : ""}
    <div class="toolbar">
      <button class="primary" data-jact="save-analysis">Guardar en expediente</button>
      ${safeLink(a.url)}
    </div>`;
}

jAnalyze.addEventListener("submit", (e) => {
  e.preventDefault();
  runAnalysis(formData(jAnalyze));
});

// ----- Citation check -----
const VERDICT = {
  exists: { yes: ["ok", "Existe"], no: ["bad", "No encontrada"], unknown: ["warn", "Sin confirmar"] },
  supports: { yes: ["ok", "Respalda lo afirmado"], partially: ["warn", "Respalda en parte"], no: ["bad", "No respalda lo afirmado"], unknown: ["warn", "Respaldo sin confirmar"], not_applicable: ["", ""] },
};
const chip = ([cls, label]) => (label ? `<span class="badge ${cls}">${label}</span>` : "");

async function detectAndVerify() {
  if (WEB) {
    showServerNotes();
    $("#j-verify-server a")?.focus();
    return;
  }
  const text = $("#j-verify-text").value;
  const cites = window.JuanmaCitations.extractCitations(text);
  $("#j-detect-info").textContent = cites.length ? `${cites.length} cita(s) encontradas.` : "No se encontraron citas de sentencias.";
  const list = $("#j-verify-list");
  list.innerHTML = cites.map((c, i) => `
    <li class="panel verify-item" data-v="${i}">
      <div class="result-head"><strong>${escapeHtml(c.citation)}</strong><span class="badge">Verificando…</span></div>
      <p class="muted">“${escapeHtml(c.claim)}”</p>
    </li>`).join("");
  $("#j-detect").disabled = true;
  try {
    for (let i = 0; i < cites.length; i++) {
      const li = $(`[data-v="${i}"]`, list);
      try {
        const r = await api("POST", "/jurisprudencia/verify", cites[i]);
        li.innerHTML = `
          <div class="result-head"><strong>${escapeHtml(r.citation)}</strong>
            ${chip(VERDICT.exists[r.exists] || VERDICT.exists.unknown)}
            ${chip(VERDICT.supports[r.supports_claim] || ["", ""])}
            ${verifiedBadge(r.verified)}
          </div>
          <p class="muted">“${escapeHtml(cites[i].claim)}”</p>
          ${r.correct_reference && r.correct_reference !== r.citation ? `<p><strong>Referencia correcta:</strong> ${escapeHtml(r.correct_reference)}</p>` : ""}
          <p>${escapeHtml(r.explanation || "")}</p>
          ${r.supporting_quote ? `<blockquote>“${escapeHtml(r.supporting_quote)}”</blockquote>` : ""}
          ${safeLink(r.url)}`;
      } catch (err) {
        li.querySelector(".badge").textContent = `Error: ${err.message}`;
        li.querySelector(".badge").className = "badge bad";
      }
    }
  } finally {
    $("#j-detect").disabled = false;
  }
}
$("#j-detect").addEventListener("click", () => guarded(detectAndVerify));

// ----- Saved -----
async function renderSaved() {
  const [saved, cases] = await Promise.all([api("GET", "/jurisprudencia/saved"), api("GET", "/cases")]);
  const caseName = (id) => {
    const k = cases.find((k) => k.id === id);
    return k ? `${k.client_name} · ${k.type_name}` : "";
  };
  $("#j-saved").innerHTML = saved.map((r) => `
    <li>
      <div>
        <div class="result-head"><strong>${escapeHtml(r.reference)}</strong>${verifiedBadge(r.verified)}</div>
        <span class="muted">${escapeHtml([r.court, caseName(r.case_id) && "Expediente: " + caseName(r.case_id)].filter(Boolean).join(" · "))}</span>
        ${r.analysis?.summary ? `<p>${escapeHtml(r.analysis.summary)}</p>` : ""}
      </div>
      <span class="toolbar">${safeLink(r.url)}
        <button class="danger" data-jact="delete-saved" data-id="${r.id}" aria-label="Eliminar">✕</button></span>
    </li>`).join("") || '<li class="empty">No hay sentencias guardadas.</li>';
}

async function openSaveDialog(item) {
  pendingSave = item;
  const cases = await api("GET", "/cases");
  const dlg = $("#save-ruling-dialog");
  $("[data-ref]", dlg).textContent = `${item.reference} — ${item.court || ""}`;
  $("select[name=case_id]", dlg).innerHTML = '<option value="">— Sin expediente —</option>' +
    cases.map((k) => `<option value="${k.id}">${escapeHtml(k.client_name)} · ${escapeHtml(k.type_name)}${k.title ? " · " + escapeHtml(k.title) : ""}</option>`).join("");
  $(".form-error", dlg).hidden = true;
  dlg.showModal();
}

wireDialog($("#save-ruling-dialog"), async (form) => {
  const it = pendingSave;
  await api("POST", "/jurisprudencia/saved", {
    case_id: Number(form.elements.case_id.value) || null,
    reference: it.reference, court: it.court, url: it.url, verified: it.verified, proof: it.proof, analysis: it.analysis || {},
  });
  toast("Sentencia guardada.");
});

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-jact]");
  if (!b) return;
  const r = jResults[Number(b.dataset.i)];
  guarded(async () => {
    if (b.dataset.jact === "analyze") {
      jAnalyze.reference.value = r.reference || "";
      jAnalyze.url.value = r.url || "";
      await runAnalysis({ reference: r.reference, url: r.verified ? r.url : "", court: "" });
    } else if (b.dataset.jact === "save-result") {
      await openSaveDialog({ reference: r.reference, court: r.court, url: r.url, verified: r.verified, proof: r.proof, analysis: { topic: r.topic, date: r.date } });
    } else if (b.dataset.jact === "save-analysis") {
      const a = jAnalysis;
      await openSaveDialog({ reference: a.reference, court: a.court, url: a.url, verified: a.verified, proof: a.proof, analysis: a });
    } else if (b.dataset.jact === "delete-saved") {
      if (!(await confirmAsk("Eliminar sentencia guardada", "Se quitará de la lista de sentencias guardadas."))) return;
      await api("DELETE", `/jurisprudencia/saved/${b.dataset.id}`);
      await renderSaved();
    }
  });
});

// ---------- PDF from Markdown (drafts) ----------

// ---------- Reportes ----------
const REPORT_TYPES = {
  expedientes: "Expedientes", clientes: "Clientes", oficinas: "Resumen por oficina",
  responsables: "Carga por responsable", procesos: "Expedientes por tipo de proceso", jurisprudencia: "Sentencias guardadas",
  cartera: "Cartera por cliente", recibos: "Recibos de caja",
};
let lastReport = null;

async function renderReportes() {
  const f = $("#report-form");
  if (!f.type.options.length) {
    f.type.innerHTML = Object.entries(REPORT_TYPES).filter(([k]) => !["cartera", "recibos"].includes(k) || can("payments.manage"))
      .map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  }
  const curOffice = f.officeId.value;
  f.officeId.innerHTML = '<option value="">Todas mis oficinas</option>' + myOffices().map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join("");
  f.officeId.value = curOffice;
  const curCat = f.categoryId.value;
  f.categoryId.innerHTML = '<option value="">Todos</option>' + state.catalog.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  f.categoryId.value = curCat;
  const curUser = f.assignedUserId.value;
  f.assignedUserId.innerHTML = '<option value="">Todos</option>' + directory.map((u) => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join("");
  f.assignedUserId.value = curUser;
  toggleReportFilters();
  if (!lastReport) await runReport();
}

function toggleReportFilters() {
  const t = $("#report-type").value;
  $$("[data-rf]").forEach((el) => (el.hidden = el.dataset.rf !== t));
}
$("#report-type").addEventListener("change", () => { toggleReportFilters(); guarded(runReport); });

async function runReport() {
  const f = $("#report-form");
  const params = new URLSearchParams();
  for (const [k, v] of new FormData(f).entries()) if (v && k !== "type") {
    if (["categoryId", "status", "assignedUserId"].includes(k) && f.type.value !== "expedientes") continue;
    params.set(k, v);
  }
  lastReport = await api("GET", `/reports/${f.type.value}?${params}`);
  lastReport.filters = describeFilters(f);
  const t = $("#report-table");
  t.innerHTML = `<thead><tr>${lastReport.columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr></thead>
    <tbody>${lastReport.rows.map((r) => `<tr>${lastReport.columns.map((c) => `<td>${escapeHtml(r[c.key] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>`;
  $("#report-info").textContent = `${lastReport.rows.length} fila(s)`;
  $("#report-xlsx").disabled = $("#report-pdf").disabled = false;
}

function describeFilters(f) {
  const parts = [];
  const opt = (sel) => sel.selectedOptions[0]?.textContent;
  parts.push(f.officeId.value ? `Oficina: ${opt(f.officeId)}` : (can("scope.all") ? "Todas las oficinas" : `Oficinas: ${me.offices.map((o) => o.name).join(", ")}`));
  if (f.from.value || f.to.value) parts.push(`Fechas: ${f.from.value || "…"} a ${f.to.value || "…"}`);
  if (f.type.value === "expedientes") {
    if (f.categoryId.value) parts.push(`Tipo: ${opt(f.categoryId)}`);
    if (f.status.value) parts.push(`Estado: ${opt(f.status)}`);
    if (f.assignedUserId.value) parts.push(`Responsable: ${opt(f.assignedUserId)}`);
  }
  return parts.join(" · ");
}

$("#report-form").addEventListener("submit", (e) => { e.preventDefault(); guarded(runReport); });

const reportFileName = (ext) => `reporte-${lastReport.type}-${new Date().toISOString().slice(0, 10)}.${ext}`;

$("#report-xlsx").addEventListener("click", () => guarded(async () => {
  const r = lastReport;
  const header = r.columns.map((c) => ({ value: c.label, fontWeight: "bold", backgroundColor: "#002B6A", color: "#FFFFFF" }));
  const body = r.rows.map((row) => r.columns.map((c) => {
    const v = row[c.key];
    return { value: v === null || v === undefined ? null : v, type: typeof v === "number" ? Number : String };
  }));
  const title = [[{ value: `${r.title} — TecjuridicosApp`, fontWeight: "bold" }], [{ value: r.filters }],
    [{ value: `Generado el ${new Date(r.generatedAt).toLocaleString("es-CO")} por ${r.generatedBy}` }], []];
  const widths = r.columns.map((c) => ({ width: Math.min(45, Math.max(c.label.length, ...r.rows.map((x) => String(x[c.key] ?? "").length)) + 2) }));
  const blob = await window.writeXlsxFile([...title, header, ...body], { columns: widths, sheet: r.title.slice(0, 31) }).toBlob();
  await saveFile(reportFileName("xlsx"), blob);
}));

$("#report-pdf").addEventListener("click", () => guarded(async () => {
  const r = lastReport;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: r.columns.length > 6 ? "landscape" : "portrait", unit: "pt", format: "letter" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(0, 43, 106);
  doc.text(`${r.title}`, 40, 46);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(`${r.filters}  ·  ${r.rows.length} fila(s)`, 40, 62);
  doc.text(`Generado el ${new Date(r.generatedAt).toLocaleString("es-CO")} por ${r.generatedBy} · TecjuridicosApp`, 40, 74);
  doc.autoTable({
    startY: 88,
    head: [r.columns.map((c) => c.label)],
    body: r.rows.map((row) => r.columns.map((c) => String(row[c.key] ?? ""))),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [0, 43, 106], textColor: 255 },
    alternateRowStyles: { fillColor: [240, 243, 247] },
    margin: { left: 40, right: 40 },
    didDrawPage: (d) => {
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(`Página ${d.pageNumber}`, doc.internal.pageSize.getWidth() - 80, doc.internal.pageSize.getHeight() - 20);
    },
  });
  await saveFile(reportFileName("pdf"), doc.output("blob"));
}));

// ---------- Usuarios y oficinas ----------
let adminUsers = [];
let roleInfo = null;

function showATab(name) {
  $$("[data-atab]").forEach((b) => b.classList.toggle("active", b.dataset.atab === name));
  $$("[data-apanel]").forEach((p) => (p.hidden = p.dataset.apanel !== name));
}
$("#admin-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-atab]");
  if (b) showATab(b.dataset.atab);
});

// Hidden users (version 2.11): Gerencia hides a user, whose actions then read "Asistente";
// the hidden users are seen again only with their own password, for 15 minutes.
let hiddenInfo = { count: 0, has_password: false, unlocked: false, can_manage: false }, hiddenTimer = null;
// Version 2.14 (John): the «Crear/Cambiar contraseña de ocultos» button is switched off and the strip
// only shows while there are hidden users. The password stays saved; the first «Ocultar» still
// asks to create it when none exists. Set to true to bring the button back.
const SHOW_HIDDEN_PASSWORD_BUTTON = false;
function renderHiddenBar() {
  const bar = $("#hidden-users-bar");
  bar.hidden = !hiddenInfo.can_manage || (!SHOW_HIDDEN_PASSWORD_BUTTON && !hiddenInfo.count && !hiddenInfo.unlocked);
  if (bar.hidden) return;
  const until = hiddenInfo.unlocked_until ? new Date(hiddenInfo.unlocked_until).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" }) : "";
  bar.innerHTML = `<span class="hidden-users-text">${hiddenInfo.unlocked
      ? `<span class="badge warn">Viendo usuarios ocultos</span> (hasta las ${escapeHtml(until)}). Para los demás siguen apareciendo como «Asistente».`
      : hiddenInfo.count ? `<strong>${hiddenInfo.count}</strong> usuario(s) oculto(s). Sus acciones aparecen como «Asistente».`
      : "Ningún usuario oculto. Con «Ocultar» un usuario sale de esta lista y todo lo que haga aparece como «Asistente»."}</span>
    <span class="row-actions">${hiddenInfo.unlocked ? '<button data-action="lock-hidden">Volver a ocultar</button>'
      : hiddenInfo.count ? '<button data-action="unlock-hidden">Ver usuarios ocultos</button>' : ""}
      ${SHOW_HIDDEN_PASSWORD_BUTTON ? `<button data-action="hidden-password">${hiddenInfo.has_password ? "Cambiar contraseña de ocultos" : "Crear contraseña de ocultos"}</button>` : ""}</span>`;
  clearTimeout(hiddenTimer);
  if (hiddenInfo.unlocked_until) hiddenTimer = setTimeout(() => { if (location.hash.startsWith("#usuarios")) renderUsuarios(); }, Math.max(1000, Date.parse(hiddenInfo.unlocked_until) - Date.now() + 500));
}
// Ask for a new hidden-users password twice; returns true when it was saved.
async function setHiddenPassword() {
  let current = "";
  if (hiddenInfo.has_password) {
    current = await ask({ title: "Cambiar contraseña de ocultos", message: "Escriba la contraseña actual de usuarios ocultos.", input: "", secret: true, okLabel: "Seguir" });
    if (!current) return false;
  }
  const next = await ask({ title: hiddenInfo.has_password ? "Contraseña nueva de ocultos" : "Crear contraseña de ocultos",
    message: "Con esta contraseña Gerencia ve los usuarios ocultos. Use al menos 10 caracteres, distinta a la de ingreso. Guárdela: no se puede recuperar.", input: "", secret: true, okLabel: "Seguir" });
  if (!next) return false;
  const again = await ask({ title: "Repita la contraseña", message: "Escríbala otra vez para confirmar.", input: "", secret: true, okLabel: "Guardar" });
  if (again === null) return false;
  if (again !== next) { toast("Las dos contraseñas no coinciden. No se guardó nada."); return false; }
  await api("POST", "/admin/hidden-users/password", { current, next });
  toast(hiddenInfo.has_password ? "Contraseña de usuarios ocultos cambiada." : "Contraseña de usuarios ocultos creada.");
  return true;
}

async function renderUsuarios() {
  [adminUsers, offices, roleInfo, hiddenInfo] = await Promise.all([api("GET", "/admin/users"), api("GET", "/admin/offices"), api("GET", "/admin/roles"),
    api("GET", "/admin/hidden-users").catch(() => ({ count: 0, can_manage: false }))]);
  directory = await api("GET", "/admin/users/directory");
  renderHiddenBar();
  $("#user-rows").innerHTML = adminUsers.map((u) => `
    <tr class="${u.active ? "" : "inactive"} ${u.hidden ? "is-hidden-user" : ""}">
      <td><strong>${escapeHtml(u.name)}</strong>${u.hidden ? ' <span class="badge warn">Oculto · se ve como «Asistente»</span>' : ""}<br><span class="muted">${escapeHtml(u.email)}</span></td>
      <td>${escapeHtml(u.role)}${u.custom_permissions ? '<br><span class="badge warn">Permisos propios</span>' : ""}</td>
      <td>${u.permissions.includes("scope.all") ? "Todas" : escapeHtml(u.offices.map((o) => o.name).join(", "))}</td>
      <td>${u.active ? '<span class="badge ok">Activo</span>' : '<span class="badge">Inactivo</span>'}</td>
      <td>${WEB ? '<span class="muted">Entra eligiendo su nombre</span>'
        : `${u.must_change_password ? '<span class="badge warn">Contraseña temporal</span>' : u.has_password ? '<span class="badge ok">Con contraseña</span>' : '<span class="badge">Sin contraseña</span>'}
          ${u.invited_at ? `<br><span class="muted">Invitado ${escapeHtml(window.JuanmaPdf.colombiaTime(u.invited_at).replace(" (hora de Colombia)", ""))}</span>` : ""}`}</td>
      <td class="row-actions"><button data-action="edit-user" data-id="${u.id}">Editar</button>
        ${!WEB && u.active ? `<button data-action="invite-user" data-id="${u.id}">${u.invited_at ? "Reenviar invitación" : "Invitar por correo"}</button>` : ""}
        ${hiddenInfo.can_manage && u.id !== me.id ? (u.hidden ? `<button data-action="unhide-user" data-id="${u.id}">Dejar de ocultar</button>` : `<button data-action="hide-user" data-id="${u.id}">Ocultar</button>`) : ""}</td>
    </tr>`).join("");
  $("#office-cards").innerHTML = offices.map((o) => `
    <article class="result-card">
      <div class="result-head"><h4>${escapeHtml(o.name)}</h4>${o.is_main ? '<span class="badge ok">Principal</span>' : ""}</div>
      <p class="muted">${escapeHtml([o.city, o.address, o.phone, o.email].filter(Boolean).join(" · ") || "Sin datos de contacto")}</p>
      <p>${o.case_count} expediente(s) · ${o.user_count} usuario(s)</p>
      <div class="toolbar">
        <button data-action="edit-office" data-id="${o.id}">Editar</button>
        ${o.is_main ? "" : `<button class="danger" data-action="delete-office" data-id="${o.id}">Eliminar</button>`}
      </div>
    </article>`).join("");
  const perms = Object.entries(roleInfo.permissions);
  const details = Object.fromEntries((roleInfo.details || []).map((d) => [d.name, d]));
  $("#role-matrix").innerHTML = `<thead><tr><th>Permiso</th>${roleInfo.roles.map((r) => `<th>${escapeHtml(r)}${details[r] && !details[r].builtin
    ? `<div class="role-actions"><button class="mini" data-action="rename-role" data-role="${escapeHtml(r)}">Renombrar</button><button class="mini danger" data-action="delete-role" data-role="${escapeHtml(r)}" aria-label="Eliminar rol">✕</button></div>` : ""}</th>`).join("")}</tr></thead>
    <tbody>${perms.map(([p, label]) => `<tr><td>${escapeHtml(label)}</td>${roleInfo.roles.map((r) => {
      const onlyGerencia = GERENCIA_PERMS.includes(p);
      const locked = (r === "Gerencia" && p === "users.manage") || onlyGerencia;
      const on = onlyGerencia ? r === "Gerencia" : roleInfo.matrix[r].includes(p);
      return `<td class="center"><input type="checkbox" data-role="${escapeHtml(r)}" data-perm="${p}" aria-label="${escapeHtml(r)}: ${escapeHtml(label)}"
        ${on ? "checked" : ""} ${locked ? "disabled" : ""}></td>`;
    }).join("")}</tr>`).join("")}</tbody>`;
}

// A readable random password (no look-alike characters) for Gerencia to hand over.
$("#user-dialog [data-gen-password]")?.addEventListener("click", () => {
  const A = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789", v = crypto.getRandomValues(new Uint32Array(12));
  const pw = [...v].map((x) => A[x % A.length]).join("");
  const input = $("#user-dialog [name=password]");
  input.value = `${pw.slice(0, 4)}-${pw.slice(4, 8)}-${pw.slice(8)}`;
  input.select();
});
function openUserDialog(u) {
  const dlg = $("#user-dialog");
  const form = $("form", dlg);
  form.elements.role.innerHTML = roleInfo.roles.map((r) => `<option>${escapeHtml(r)}</option>`).join("");
  $("#user-office-checks").innerHTML = offices.map((o) => `<label class="inline"><input type="checkbox" name="office" value="${o.id}"
    ${u ? (u.offices.some((x) => x.id === o.id) ? "checked" : "") : (o.is_main ? "checked" : "")}> ${escapeHtml(o.name)}</label>`).join("");
  openDialog(dlg, u ? "Editar usuario" : "Nuevo usuario", u ? { id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone, professional_card: u.professional_card } : { role: "Abogado" });
  form.elements.custom_permissions.checked = !!u?.custom_permissions;
  renderUserPerms(u ? u.permissions : roleInfo.matrix[form.elements.role.value]);
  form.elements.active.checked = u ? u.active : true;
  if (form.elements.password) form.elements.password.required = false;
  if (form.elements.invite) form.elements.invite.checked = !u;
  if ($("[data-pw-label]", dlg)) $("[data-pw-label]", dlg).textContent = u ? "Asignar contraseña nueva (opcional, temporal)"
    : "Contraseña asignada (opcional si envía la invitación)";
}

// Per-user checklist: shows the role's permissions until "específicos" is on.
function renderUserPerms(checked) {
  const form = $("#user-dialog form");
  const custom = form.elements.custom_permissions.checked;
  $("#user-perm-checks").innerHTML = Object.entries(roleInfo.permissions).map(([p, label]) => `
    <label class="inline"><input type="checkbox" name="perm" value="${p}" ${checked.includes(p) ? "checked" : ""} ${custom && !GERENCIA_PERMS.includes(p) ? "" : "disabled"} /> ${escapeHtml(label)}</label>`).join("");
}
$("#user-dialog [name=custom_permissions]").addEventListener("change", () => {
  const form = $("#user-dialog form");
  renderUserPerms(form.elements.custom_permissions.checked
    ? $$("#user-perm-checks input:checked").map((i) => i.value)
    : roleInfo.matrix[form.elements.role.value] || []);
});
$("#user-dialog [name=role]").addEventListener("change", (e) => {
  if (!$("#user-dialog [name=custom_permissions]").checked) renderUserPerms(roleInfo.matrix[e.target.value] || []);
});

wireDialog($("#user-dialog"), async (form) => {
  const d = formData(form);
  const body = {
    name: d.name, email: d.email, phone: d.phone, professional_card: d.professional_card, role: d.role, active: form.elements.active.checked,
    office_ids: $$("#user-office-checks input:checked").map((i) => Number(i.value)),
    custom_permissions: form.elements.custom_permissions.checked,
    permissions: $$("#user-perm-checks input:checked").map((i) => i.value),
  };
  if (d.password) body.password = d.password;
  const invite = !!form.elements.invite?.checked;
  if (!d.id && !d.password && !invite && !authInfo.microsoft && !WEB) throw new Error("Asigne una contraseña o marque «Enviar invitación por correo».");
  let msg;
  if (d.id) {
    await api("PUT", `/admin/users/${d.id}`, body);
    const sent = invite ? await api("POST", `/admin/users/${d.id}/invite`).then(() => true, (e) => e.message) : null;
    msg = `Usuario actualizado.${sent === true ? " Invitación enviada por correo." : sent ? ` ${sent}` : ""}`;
  } else {
    const u = await api("POST", "/admin/users", { ...body, invite });
    msg = `Usuario creado.${u.invitation ? (u.invitation.ok ? ` Invitación enviada a ${u.email}.` : ` La invitación no se envió: ${u.invitation.detail}`) : ""}${d.password ? " Entréguele la contraseña temporal por un medio distinto al correo." : ""}`;
  }
  toast(msg);
  await renderUsuarios();
});

function openOfficeDialog(o) {
  openDialog($("#office-dialog"), o ? "Editar oficina" : "Nueva oficina", o || {});
  const main = $("#office-dialog [name=is_main]");
  main.checked = !!o?.is_main;
  main.disabled = !!o?.is_main;
}

wireDialog($("#office-dialog"), async (form) => {
  const { id, ...d } = formData(form);
  const body = { ...d, is_main: form.elements.is_main.checked || undefined };
  if (id) await api("PUT", `/admin/offices/${id}`, body);
  else {
    const o = await api("POST", "/admin/offices", body);
    if (body.is_main) await api("PUT", `/admin/offices/${o.id}`, { is_main: true });
  }
  toast(id ? "Oficina actualizada." : "Oficina creada.");
  await renderUsuarios();
});

function openRoleDialog() {
  const dlg = $("#role-dialog");
  $("[name=copy_from]", dlg).innerHTML = '<option value="">— Sin permisos —</option>' + roleInfo.roles.map((r) => `<option>${escapeHtml(r)}</option>`).join("");
  openDialog(dlg, "Nuevo rol");
}
wireDialog($("#role-dialog"), async (form) => {
  const d = formData(form);
  await api("POST", "/admin/roles", { name: d.name, copy_from: d.copy_from });
  toast(`Rol “${d.name}” creado.`);
  await renderUsuarios();
  showATab("roles");
});

$("#save-roles").addEventListener("click", () => guarded(async () => {
  for (const role of roleInfo.roles) {
    const permissions = $$(`#role-matrix input[data-role="${CSS.escape(role)}"]:checked`).map((i) => i.dataset.perm);
    await api("PUT", `/admin/roles/${encodeURIComponent(role)}`, { permissions });
  }
  toast("Permisos guardados.");
  me = (await api("GET", "/auth/status")).user;
  applyPermissions();
  await renderUsuarios();
}));

wireDialog($("#password-dialog"), async (form) => {
  await api("POST", "/auth/password", formData(form));
  const dlg = $("#password-dialog");
  delete dlg.dataset.forced;
  $("[data-must-change]", dlg).hidden = true;
  $("button[value=cancel]", dlg).hidden = false;
  if (me) me.must_change_password = false;
  toast("Contraseña actualizada.");
});

// ---------- Documentos: plantillas ----------
const D = window.JuanmaDocx;
let tplMeta = null, tplList = [], tplCat = "", tplActive = null, tplData = {}, tplOverrides = {};

function showDTab(name) {
  $$("[data-dtab]").forEach((b) => b.classList.toggle("active", b.dataset.dtab === name));
  $$("[data-dpanel]").forEach((p) => (p.hidden = p.dataset.dpanel !== name));
}
$("#doc-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-dtab]");
  if (!b) return;
  showDTab(b.dataset.dtab);
  if (b.dataset.dtab === "nomos") guarded(renderNomos);
});

async function renderBorradores() {
  if (!tplMeta) tplMeta = await api("GET", "/templates/meta");
  tplList = await api("GET", "/templates");
  const counts = Object.fromEntries(tplMeta.categories.map((c) => [c, tplList.filter((t) => t.category === c).length]));
  $("#tpl-cats").innerHTML = [["", `Todas (${tplList.length})`], ...tplMeta.categories.filter((c) => counts[c]).map((c) => [c, `${c} (${counts[c]})`])]
    .map(([v, l]) => `<button type="button" class="chip ${v === tplCat ? "active" : ""}" data-tcat="${escapeHtml(v)}">${escapeHtml(l)}</button>`).join("");
  renderTplList();
  const cases = await api("GET", "/cases");
  const sel = $("#tpl-case");
  const cur = pendingDraftCase ?? sel.value;
  sel.innerHTML = '<option value="">— Sin expediente: llenar a mano —</option>' + cases.map((k) =>
    `<option value="${k.id}">${escapeHtml(k.client_name)} · ${escapeHtml(k.type_name)}${k.title ? " · " + escapeHtml(k.title) : ""}</option>`).join("");
  sel.value = cur ? String(cur) : "";
  if (pendingDraftCase && !tplActive) showDTab("nomos");
  if (!$("[data-dpanel=nomos]").hidden) await renderNomos();
  else if (tplActive) await loadTplData();
}

function renderTplList() {
  const q = window.JuanmaCombo.norm($("#tpl-search").value);
  const items = tplList.filter((t) => (!tplCat || t.category === tplCat) && (!q || window.JuanmaCombo.norm(t.name + " " + t.description).includes(q)));
  const groups = new Map();
  for (const t of items) { if (!groups.has(t.category)) groups.set(t.category, []); groups.get(t.category).push(t); }
  $("#tpl-list").innerHTML = [...groups].map(([cat, ts]) => `
    <h4>${escapeHtml(cat)}</h4>
    <ul class="tpl-items">${ts.map((t) => `<li><button type="button" class="tpl-item ${tplActive?.id === t.id ? "selected" : ""}" data-tpl="${t.id}">
      <strong>${escapeHtml(t.name)}</strong>
      <span>${t.format === "docx" ? "Word" : "Texto"}${t.builtin ? " · ejemplo TecjuridicosApp" : ""}${t.description ? " · " + escapeHtml(t.description) : ""}</span></button>
      ${can("templates.manage") ? `<span class="tpl-tools">
        <button class="mini" data-action="download-template" data-id="${t.id}" title="Descarga la plantilla en Word, con sus {{marcadores}}, para actualizarla">Descargar</button>
        <button class="mini" data-action="replace-template" data-id="${t.id}" title="Sube el Word actualizado en lugar de esta plantilla">Reemplazar</button>
        ${t.format === "markdown" ? `<button class="mini" data-action="edit-template" data-id="${t.id}">Editar</button>` : ""}
        <button class="mini danger" data-action="delete-template" data-id="${t.id}" aria-label="Eliminar plantilla">✕</button></span>` : ""}</li>`).join("")}</ul>`).join("")
    || '<p class="empty">No hay plantillas con ese filtro.</p>';
}
$("#tpl-search").addEventListener("input", renderTplList);
$("#tpl-cats").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tcat]");
  if (!b) return;
  tplCat = b.dataset.tcat;
  $$("#tpl-cats .chip").forEach((c) => c.classList.toggle("active", c === b));
  renderTplList();
});
$("#tpl-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tpl]");
  if (b) guarded(() => openTemplate(Number(b.dataset.tpl)));
});

async function openTemplate(id) {
  const t = await api("GET", `/templates/${id}`);
  if (t.format === "docx") {
    const f = await api("GET", `/templates/${id}/file`);
    t.bytes = D.b64ToBytes(f.base64);
    t.vars = D.docxVariables(t.bytes);
  } else {
    t.vars = D.textVariables(t.body);
  }
  tplActive = t;
  tplOverrides = {};
  $("#tpl-empty").hidden = true;
  $("#tpl-active").hidden = false;
  $("#tpl-name").textContent = t.name;
  $("#tpl-cat").textContent = t.category;
  $("#tpl-format").textContent = t.format === "docx" ? "Word" : "Texto";
  $$("[data-text-only]").forEach((el) => (el.hidden = t.format === "docx"));
  $("#tpl-docx-note").hidden = t.format !== "docx";
  $("#tpl-blanks-btn").hidden = !can("templates.manage");
  $("#tpl-edit-mode").checked = false;
  $("#tpl-text").hidden = true;
  renderTplList();
  await loadTplData();
}

async function loadTplData() {
  const caseId = $("#tpl-case").value;
  tplData = await api("GET", `/templates/data${caseId ? `?caseId=${caseId}` : ""}`);
  renderFees();
  applyDraftFees();
}

// ----- Contract fees: the value written in the contract is the case's charge in Pagos -----
const feeBox = $("#tpl-fees");
const feeInput = (n) => $(`[name=${n}]`, feeBox);
function draftFees() {
  const total = parseMoney(feeInput("fee_amount").value), n = Math.min(60, Math.max(1, Number(feeInput("fee_n").value) || 1));
  const first = feeInput("fee_due").value || localToday(), every = feeInput("fee_every").value;
  if (!(total > 0)) return null;
  const step = (i) => (every === "quincenal" ? L.addDays(first, 15 * i) : every === "semanal" ? L.addDays(first, 7 * i) : L.addMonths(first, i));
  return { total, n, first, every, charges: L.splitAmount(total, n).map((amount, i) => ({ amount, due_date: step(i), status: "pendiente" })) };
}
function renderFees() {
  const uses = tplActive?.vars.some((k) => k.startsWith("honorarios.")) || tplActive?.category === "Contrato";
  feeBox.hidden = !uses || !can("payments.manage");
  if (feeBox.hidden) return;
  const caseId = Number($("#tpl-case").value) || null;
  const registered = !!tplData["honorarios.valor"];
  $("#tpl-fees-form").hidden = registered;
  $("#tpl-fees-save").hidden = registered;
  $("#tpl-fees-status").textContent = registered
    ? `Honorarios de este expediente en Pagos: ${tplData["honorarios.valor"]} · ${tplData["honorarios.forma_pago"]} · pagado ${tplData["honorarios.pagado"]} · saldo ${tplData["honorarios.saldo"]}. Para cambiarlos, edite el cobro en Pagos.`
    : caseId ? "Escriba el valor y las cuotas: el contrato los muestra de inmediato y, al registrarlos, quedan como cobro del cliente en Pagos (cartera, recibos y recordatorios)."
      : "Elija el expediente del cliente para ligar los honorarios a su cuenta en Pagos.";
  if (!feeInput("fee_due").value) feeInput("fee_due").value = localToday();
}
function applyDraftFees() {
  for (const k of Object.keys(tplOverrides)) if (k.startsWith("honorarios.")) delete tplOverrides[k];
  const d = !tplData["honorarios.valor"] && draftFees();
  if (d) Object.assign(tplOverrides, L.feeVariables(d.charges));
  renderTplVars();
  renderTplDoc();
}
feeBox.addEventListener("input", applyDraftFees);
$("#tpl-fees-save").addEventListener("click", () => guarded(async () => {
  const caseId = Number($("#tpl-case").value) || null;
  if (!caseId) throw new Error("Elija primero el expediente del cliente.");
  const d = draftFees();
  if (!d) throw new Error("Escriba el valor de los honorarios.");
  const k = await api("GET", `/cases/${caseId}`);
  await api("POST", "/payments/charges", { client_id: k.client_id, case_id: caseId, concept: `Honorarios · ${tplActive.name}`,
    amount: d.total, installments: d.n, due_date: d.first, every: d.every });
  toast(`Honorarios registrados en Pagos: ${L.fmtCOP(d.total)} en ${d.n} cuota(s).`);
  tplOverrides = Object.fromEntries(Object.entries(tplOverrides).filter(([key]) => !key.startsWith("honorarios.")));
  feeInput("fee_amount").value = "";
  await loadTplData();
}));
$("#tpl-case").addEventListener("change", () => guarded(async () => { tplOverrides = {}; await loadTplData(); }));

const varLabel = (key) => tplMeta.variables.find((v) => v.key === key)?.label || key.replace(/^campo\./, "");
const tplValues = () => ({ ...tplData, ...Object.fromEntries(Object.entries(tplOverrides).filter(([, v]) => v !== "")) });

function renderTplVars() {
  const vals = tplValues();
  const missing = tplActive.vars.filter((k) => !vals[k]);
  $("#tpl-missing").textContent = missing.length ? `${missing.length} por completar` : "Completo";
  $("#tpl-missing").className = `badge ${missing.length ? "warn" : "ok"}`;
  $("#tpl-vars-box").open = missing.length > 0;
  // Missing data first, so what needs attention is at the top.
  const ordered = [...tplActive.vars].sort((a, b) => Number(!!vals[a]) - Number(!!vals[b]));
  $("#tpl-vars").innerHTML = ordered.map((k) => `<label>${escapeHtml(varLabel(k))}
    <input data-var="${escapeHtml(k)}" value="${escapeHtml(vals[k] ?? "")}" placeholder="Falta" class="${vals[k] ? "" : "missing"}" /></label>`).join("")
    || '<p class="muted">Esta plantilla no tiene variables.</p>';
}
$("#tpl-vars").addEventListener("input", (e) => {
  const i = e.target.closest("[data-var]");
  if (!i) return;
  tplOverrides[i.dataset.var] = i.value.trim();
  i.classList.toggle("missing", !i.value.trim() && !tplData[i.dataset.var]);
  if (!$("#tpl-edit-mode").checked) renderTplDoc();
});

function filledText() {
  const labels = Object.fromEntries(tplActive.vars.map((k) => [k, varLabel(k)]));
  return D.fillText(tplActive.body, tplValues(), labels);
}
function renderTplDoc() {
  if (tplActive.format === "docx") {
    const vals = tplValues();
    $("#tpl-preview").innerHTML = `<table class="data-table"><thead><tr><th>Variable</th><th>Valor en el documento</th></tr></thead><tbody>${
      tplActive.vars.map((k) => `<tr><td><code>{{${escapeHtml(k)}}}</code></td><td>${vals[k] ? escapeHtml(vals[k]) : `<mark class="fill">[FILL: ${escapeHtml(k)}]</mark>`}</td></tr>`).join("")
    }</tbody></table>`;
    return;
  }
  const text = $("#tpl-edit-mode").checked ? $("#tpl-text").value : filledText();
  $("#tpl-preview").innerHTML = renderMarkdown(text);
}
$("#tpl-edit-mode").addEventListener("change", (e) => {
  const ta = $("#tpl-text");
  if (e.target.checked) ta.value = filledText();
  ta.hidden = !e.target.checked;
  renderTplDoc();
});
$("#tpl-text").addEventListener("input", renderTplDoc);

const tplFileBase = () => (tplActive.name + (tplActive.category === "Contrato" && tplData["expediente.carpeta"] ? ` N.º ${tplData["expediente.carpeta"]}` : "")
  + (tplData["cliente.nombre"] ? " - " + tplData["cliente.nombre"] : ""))
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w .-]+/g, "").replace(/\s+/g, " ").trim().slice(0, 90) || "documento";
const currentText = () => ($("#tpl-edit-mode").checked ? $("#tpl-text").value : filledText());

$("#tpl-active .actions").addEventListener("click", (e) => {
  const action = e.target.closest("[data-tpl-out]")?.dataset.tplOut;
  if (!action) return;
  guarded(async () => {
    if (["docx", "pdf", "save", "mail", "whatsapp"].includes(action)) {
      const word = () => (tplActive.format === "docx" ? D.fillDocx(tplActive.bytes, tplValues()) : D.markdownToDocx(currentText(), tplActive.name));
      await exportDocument(action, {
        name: tplActive.name, base: tplFileBase(), caseId: Number($("#tpl-case").value) || null, word,
        // A Word form keeps its layout in the .docx; its PDF carries the same text in the firm's PDF layout.
        pdf: async () => markdownToPdf(tplActive.format === "docx" ? D.docxText(new Uint8Array(await word().arrayBuffer())) : currentText()),
      });
    } else if (action === "copy") {
      try { await navigator.clipboard.writeText(currentText()); toast("Texto copiado."); }
      catch { toast("No se pudo copiar; active “Editar el texto” y cópielo desde allí.", true); }
    } else if (action === "sign") {
      const text = tplActive.format === "docx" ? D.docxText(new Uint8Array(await D.fillDocx(tplActive.bytes, tplValues()).arrayBuffer())) : currentText();
      await openSignDialog({ title: tplActive.name, text, caseId: Number($("#tpl-case").value) || null });
    } else if (action === "nomos") {
      setBaseTemplate({ name: tplActive.name, text: currentText() });
      const map = { Contrato: "CONTRACT", Poder: "POWER_OF_ATTORNEY", "Derecho de petición": "PETITION", Demanda: "LAWSUIT" };
      if (map[tplActive.category]) draftForm.documentType.value = map[tplActive.category];
      pendingDraftCase = Number($("#tpl-case").value) || null;
      showDTab("nomos");
      await renderNomos();
      toast("Revise los datos y pulse “Generar borrador”.");
    }
  });
});

// ----- Exporting a document: Word, PDF, save to the case, e-mail, WhatsApp -----
const blobToB64 = async (blob) => bytesToB64(new Uint8Array(await blob.arrayBuffer()));
async function exportDocument(action, doc) {
  const word = async () => doc.word();
  const pdf = async () => doc.pdf();
  if (action === "docx") return saveFile(`${doc.base}.docx`, await word());
  if (action === "pdf") return saveFile(`${doc.base}.pdf`, await pdf());
  if (action === "save") {
    if (!doc.caseId) throw new Error("Elija primero el expediente donde se guardará el documento.");
    for (const [ext, blob] of [["docx", await word()], ["pdf", await pdf()]]) {
      await api("POST", `/cases/${doc.caseId}/documents`, { name: doc.name, filename: `${doc.base}.${ext}`, file_base64: await blobToB64(blob) });
    }
    toast("Documento guardado en el expediente (Word y PDF). Lo encuentra en Expedientes → Documentos.");
    return;
  }
  if (action === "mail") {
    const [w, p] = [await word(), await pdf()];
    return openMailDialog({ caseId: doc.caseId, subject: doc.name, files: [new File([w], `${doc.base}.docx`, { type: w.type }), new File([p], `${doc.base}.pdf`, { type: "application/pdf" })] });
  }
  if (action === "whatsapp") return openWhatsappDialog(doc);
}

// WhatsApp: the page cannot attach a file for the user, so it downloads the file and opens the chat with the message ready.
let waDoc = null;
const waForm = $("#wa-dialog form");
const waNumber = (phone) => { const d = String(phone || "").replace(/\D/g, ""); return d.length === 10 ? "57" + d : d; };
function refreshWaLink() {
  const n = waNumber(waForm.elements.phone.value);
  $("[data-wa-open]", waForm).href = `https://wa.me/${n}?text=${encodeURIComponent(waForm.elements.message.value)}`;
}
async function openWhatsappDialog(doc) {
  waDoc = doc;
  let phone = "", name = "";
  if (doc.caseId) {
    const k = await api("GET", `/cases/${doc.caseId}`).catch(() => null);
    const c = k && (await api("GET", `/clients/${k.client_id}`).catch(() => null));
    phone = c?.phone || ""; name = c?.first_names || c?.full_name || "";
  }
  waForm.elements.phone.value = phone;
  waForm.elements.format.value = "pdf";
  waForm.elements.message.value = `${name ? `Hola ${name}, ` : "Hola, "}le enviamos el documento «${doc.name}». Quedamos atentos.\n\n${me?.name || ""} · TEC Jurídicos`.trim();
  $(".form-error", waForm).hidden = true;
  refreshWaLink();
  $("#wa-dialog").showModal();
}
waForm.addEventListener("input", refreshWaLink);
$("[data-wa-download]", waForm).addEventListener("click", () => guarded(async () => {
  const ext = waForm.elements.format.value;
  await saveFile(`${waDoc.base}.${ext}`, await (ext === "pdf" ? waDoc.pdf() : waDoc.word()));
}));

// Verification of a signed document: SHA-256 computed here, compared with the registry.
async function showVerification(body, hash = "") {
  const r = await api("POST", "/public/verify", body);
  const VERDICT = {
    firmado: ["ok", "AUTÉNTICO Y SIN ALTERACIONES: es exactamente el documento firmado registrado."],
    original: ["warn", "Es el documento ORIGINAL enviado a firma (sin estampas). Para el firmado, cargue el PDF firmado."],
    codigo: ["warn", "El código corresponde a esta solicitud. Cargue el archivo para comprobar que no fue alterado."],
    ninguno: ["bad", hash ? "NO COINCIDE: el archivo no corresponde a ningún documento firmado registrado; pudo ser modificado o no se firmó aquí." : "No hay ningún documento con ese código."],
  };
  const [cls, text] = VERDICT[r.match];
  $("#verify-result").innerHTML = `<p class="badge ${cls === "ok" ? "ok" : cls === "warn" ? "warn" : "bad"} verdict-badge">${escapeHtml(text)}</p>
    ${hash ? `<p class="muted mono small">SHA-256 del archivo: ${escapeHtml(hash)}</p>` : ""}
    ${r.title ? `<p><strong>${escapeHtml(r.title)}</strong> · ${r.status === "completada" ? "Firmado por todos" : escapeHtml(r.status)}${r.completed_at ? " · " + escapeHtml(window.JuanmaPdf.colombiaTime(r.completed_at)) : ""} · Código ${escapeHtml(r.verify_code || "")}</p>
      <ul>${r.signers.map((x) => `<li>${escapeHtml(x.name)} · ${x.status === "firmado" ? `firmó ${escapeHtml(window.JuanmaPdf.colombiaTime(x.signed_at))}` : escapeHtml(x.status)}</li>`).join("")}</ul>` : ""}`;
}
$("#verify-dialog [name=file]").addEventListener("change", (e) => guarded(async () => {
  const f = e.target.files[0];
  if (!f) return;
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await f.arrayBuffer()))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await showVerification({ sha256: hash }, hash);
}));
$("[data-verify-code]").addEventListener("click", () => guarded(() => showVerification({ code: $("#verify-dialog [name=code]").value })));

// Documents saved in a case.
let casedocsCase = null;
async function openCaseDocs(caseId) {
  casedocsCase = await api("GET", `/cases/${caseId}`);
  $("#casedocs-dialog [data-sub]").textContent = `${casedocsCase.client_name} · ${casedocsCase.type_name}${casedocsCase.title ? " · " + casedocsCase.title : ""}`;
  await renderCaseDocs();
  if (!$("#casedocs-dialog").open) $("#casedocs-dialog").showModal();
}
async function renderCaseDocs() {
  const list = await api("GET", `/cases/${casedocsCase.id}/documents`);
  $("#casedocs-empty").hidden = list.length > 0;
  $("#casedocs-rows").innerHTML = list.map((d) => `<tr>
    <td><strong>${escapeHtml(d.name)}</strong><br><span class="muted">${escapeHtml(d.filename)} · ${Math.max(1, Math.round(d.size / 1024))} KB</span></td>
    <td>${escapeHtml(d.created_at)}${d.created_by_name ? `<br><span class="muted">${escapeHtml(d.created_by_name)}</span>` : ""}</td>
    <td class="row-actions"><button type="button" class="mini" data-casedoc="${d.id}">Descargar</button>
      ${can("cases.write") ? `<button type="button" class="mini danger" data-action="delete-casedoc" data-id="${d.id}" aria-label="Eliminar documento">✕</button>` : ""}</td></tr>`).join("");
}
$("#casedocs-rows").addEventListener("click", (e) => {
  const b = e.target.closest("[data-casedoc]");
  if (!b) return;
  guarded(async () => {
    const f = await api("GET", `/cases/${casedocsCase.id}/documents/${b.dataset.casedoc}/file`);
    await saveFile(f.filename, new Blob([D.b64ToBytes(f.base64)], { type: f.mime }));
  });
});

// ----- Template editor and uploads -----
const tplForm = $("#tpl-dialog form");
function openTemplateDialog(t = null) {
  tplForm.elements.category.innerHTML = tplMeta.categories.map((c) => `<option>${escapeHtml(c)}</option>`).join("");
  openDialog($("#tpl-dialog"), t ? "Editar plantilla" : "Nueva plantilla", t ? { id: t.id, name: t.name, category: t.category, description: t.description, body: t.body }
    : { category: tplCat || "Contrato", body: "# TÍTULO DEL DOCUMENTO\n\n{{fecha.ciudad_y_fecha}}\n\n**{{cliente.nombre}}**, identificado(a) con {{cliente.tipo_documento}} No. {{cliente.documento}}…\n" });
  const groups = {};
  for (const v of tplMeta.variables) (groups[v.group] ||= []).push(v);
  $("#var-picker").innerHTML = Object.entries(groups).map(([g, vs]) => `<h5>${escapeHtml(g)}</h5>${vs.map((v) =>
    `<button type="button" class="chip" data-insert="${escapeHtml(v.key)}" title="{{${escapeHtml(v.key)}}}">${escapeHtml(v.label)}</button>`).join("")}`).join("");
}
$("#var-picker").addEventListener("click", (e) => {
  const b = e.target.closest("[data-insert]");
  if (!b) return;
  const ta = tplForm.elements.body;
  const ins = `{{${b.dataset.insert}}}`;
  const { selectionStart: a, selectionEnd: z } = ta;
  ta.setRangeText(ins, a, z, "end");
  ta.focus();
});
wireDialog($("#tpl-dialog"), async (form) => {
  const { id, ...d } = formData(form);
  if (id) await api("PUT", `/templates/${id}`, d); else await api("POST", "/templates", d);
  toast(id ? "Plantilla actualizada." : "Plantilla creada.");
  await renderBorradores();
  if (tplActive && Number(id) === tplActive.id) await openTemplate(tplActive.id);
});

$("#tpl-file").addEventListener("change", (e) => guarded(async () => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const name = file.name.replace(/\.[^.]+$/, "");
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".doc")) throw new Error("Guarde el archivo como .docx (Word 2007 o posterior) y vuelva a cargarlo.");
  const category = guessCategory(name);
  let created;
  if (lower.endsWith(".docx")) {
    if (file.size > 8 * 1024 * 1024) throw new Error("El archivo debe pesar menos de 8 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const vars = D.docxVariables(bytes);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    created = await api("POST", "/templates", { name, category, filename: file.name, file_base64: btoa(bin),
      description: vars.length ? `${vars.length} variable(s)` : "Sin variables {{…}}: se descargará tal cual" });
  } else if (/\.(md|txt)$/.test(lower)) {
    created = await api("POST", "/templates", { name, category, body: await file.text() });
  } else {
    throw new Error("Use un archivo .docx, .md o .txt.");
  }
  toast(`Plantilla “${name}” cargada en ${category}. Puede cambiar la categoría con Editar.`);
  await renderBorradores();
  await openTemplate(created.id);
  // A firm's own form usually has blanks instead of {{variables}}: offer to map them.
  if (tplActive?.format === "docx" && !tplActive.vars.length) await openBlanksDialog(tplActive);
}));
// Version 2.17: a visible box to upload a template (click or drop a file on it); same path as the toolbar button.
const tplDrop = $("#tpl-drop");
tplDrop.addEventListener("dragover", (e) => { e.preventDefault(); tplDrop.classList.add("is-over"); });
tplDrop.addEventListener("dragleave", () => tplDrop.classList.remove("is-over"));
tplDrop.addEventListener("drop", (e) => {
  e.preventDefault();
  tplDrop.classList.remove("is-over");
  if (!e.dataTransfer?.files?.length) return;
  const input = $("#tpl-file");
  input.files = e.dataTransfer.files;
  input.dispatchEvent(new Event("change"));
});

// ----- Version 2.16: Gerencia downloads a template to update it in Word, and uploads it back -----
/** The template as it is, {{markers}} included: the firm's own Word file, or a text template turned into Word. */
async function downloadTemplate(id) {
  const t = await api("GET", `/templates/${id}`);
  if (t.format === "docx") {
    const f = await api("GET", `/templates/${id}/file`);
    const name = /\.docx$/i.test(f.filename || "") ? f.filename : `${safeName(t.name)}.docx`;
    return saveFile(name, new Blob([D.b64ToBytes(f.base64)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
  }
  await saveFile(`${safeName(t.name)}.docx`, D.markdownToDocx(t.body || "", t.name));
}
let replaceFor = null;
$("#tpl-replace-file").addEventListener("change", (e) => guarded(async () => {
  const file = e.target.files[0];
  e.target.value = "";
  const id = replaceFor;
  replaceFor = null;
  if (!file || !id) return;
  if (!file.name.toLowerCase().endsWith(".docx")) throw new Error("Use el archivo de Word (.docx) actualizado.");
  if (file.size > 8 * 1024 * 1024) throw new Error("El archivo debe pesar menos de 8 MB.");
  const t = tplList.find((x) => x.id === id) || (await api("GET", `/templates/${id}`));
  const bytes = new Uint8Array(await file.arrayBuffer());
  const vars = D.docxVariables(bytes);
  if (!(await ask({ title: "Reemplazar plantilla", okLabel: "Reemplazar",
    message: `“${t.name}” quedará con el Word “${file.name}” (${vars.length} marcador(es) {{…}}). Los documentos ya creados con la versión anterior no cambian.` }))) return;
  await api("PUT", `/templates/${id}`, { filename: file.name, file_base64: bytesToB64(bytes),
    description: vars.length ? `${vars.length} variable(s)` : "Sin variables {{…}}: se descargará tal cual" });
  toast(`Plantilla “${t.name}” actualizada con “${file.name}”.`);
  await renderBorradores();
  await openTemplate(id);
}));
/** Every {{marker}} a template can use: the fixed ones and the custom fields of the catalog. */
async function markerList() {
  if (!tplMeta) tplMeta = await api("GET", "/templates/meta");
  const list = tplMeta.variables.map((v) => ({ key: v.key, label: v.label, group: v.group }));
  try {
    const seen = new Set(list.map((v) => v.key));
    for (const c of await api("GET", "/catalog")) for (const f of c.fields || []) {
      const key = `campo.${f.label}`;
      if (!seen.has(key)) { seen.add(key); list.push({ key, label: f.label, group: "Campos del tipo de proceso" }); }
    }
  } catch {}
  return list;
}
let markersShown = [];
async function openMarkers() {
  markersShown = await markerList();
  $("#markers-search").value = "";
  renderMarkers();
  $("#markers-dialog").showModal();
}
function renderMarkers() {
  const q = window.JuanmaCombo.norm($("#markers-search").value);
  const rows = markersShown.filter((v) => !q || window.JuanmaCombo.norm(`${v.group} ${v.label} ${v.key}`).includes(q));
  let group = "";
  $("#markers-dialog tbody").innerHTML = rows.map((v) => {
    const head = v.group !== group ? `<tr class="group-row"><th colspan="3">${escapeHtml((group = v.group))}</th></tr>` : "";
    return `${head}<tr><td>${escapeHtml(v.label)}</td><td><code>{{${escapeHtml(v.key)}}}</code></td>
      <td><button type="button" class="mini" data-copy-marker="{{${escapeHtml(v.key)}}}">Copiar</button></td></tr>`;
  }).join("") || '<tr><td colspan="3" class="empty">Ningún marcador coincide.</td></tr>';
}
$("#markers-search").addEventListener("input", renderMarkers);
$("#markers-dialog").addEventListener("click", (e) => {
  const c = e.target.closest("[data-copy-marker]");
  if (c) return guarded(async () => toast((await copyText(c.dataset.copyMarker)) ? `${c.dataset.copyMarker} copiado. Péguelo en su Word.` : "No se pudo copiar: selecciónelo y cópielo a mano."));
  if (e.target.closest("[data-markers-download]")) guarded(async () => {
    const groups = new Map();
    for (const v of markersShown) { if (!groups.has(v.group)) groups.set(v.group, []); groups.get(v.group).push(v); }
    const md = "# MARCADORES DISPONIBLES PARA LAS PLANTILLAS\n\nEscriba cada marcador tal cual, con las dos llaves, donde debe ir el dato.\n\n"
      + [...groups].map(([g, vs]) => `## ${g}\n\n${vs.map((v) => `${v.label}: {{${v.key}}}`).join("\n")}`).join("\n\n") + "\n";
    await saveFile("Marcadores disponibles TecjuridicosApp.docx", D.markdownToDocx(md, "Marcadores disponibles"));
  });
});

// Word forms (minutas): each blank (____, XXXX, [NOMBRE], highlighted text) gets a client or case datum.
const bytesToB64 = (bytes) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
let blanksFor = null;
async function openBlanksDialog(t) {
  if (!tplMeta) tplMeta = await api("GET", "/templates/meta");
  const blanks = D.docxBlanks(t.bytes);
  blanksFor = { t, blanks };
  const dlg = $("#blanks-dialog");
  const opts = (sel) => '<option value="">— Dejar como está —</option>' + Object.entries(tplMeta.variables.reduce((g, v) => ((g[v.group] ||= []).push(v), g), {}))
    .map(([g, vs]) => `<optgroup label="${escapeHtml(g)}">${vs.map((v) => `<option value="${escapeHtml(v.key)}" ${v.key === sel ? "selected" : ""}>${escapeHtml(v.label)}</option>`).join("")}</optgroup>`).join("");
  const shown = (x) => (x.kind === "subrayado" ? "línea subrayada" : x.text.length > 40 ? x.text.slice(0, 40) + "…" : x.text);
  $("tbody", dlg).innerHTML = blanks.map((b) => `<tr>
    <td class="blank-ctx">…${escapeHtml(b.before.slice(-60))}<mark>${escapeHtml(shown(b))}</mark>${escapeHtml(b.after.slice(0, 40))}…</td>
    <td><select data-blank="${b.id}" aria-label="Dato para el espacio ${b.id + 1}">${opts(D.guessVariable(b))}</select></td></tr>`).join("");
  $("[data-sub]", dlg).textContent = blanks.length
    ? `“${t.name}”: ${blanks.length} espacio(s) encontrado(s). La app ya sugirió el dato más probable según el texto de alrededor; revise cada uno y cambie lo que no corresponda. El formato del documento no cambia.`
    : `“${t.name}”`;
  $("[data-none]", dlg).hidden = blanks.length > 0;
  $(".blanks-table", dlg).hidden = !blanks.length;
  $(".form-error", dlg).hidden = true;
  dlg.showModal();
}
wireDialog($("#blanks-dialog"), async (form) => {
  const { t, blanks } = blanksFor;
  const assign = new Map();
  for (const sel of $$("select[data-blank]", form)) if (sel.value) assign.set(Number(sel.dataset.blank), sel.value);
  if (!blanks.length) return;
  if (!assign.size) throw new Error("Elija el dato de al menos un espacio, o cancele.");
  const bytes = D.applyBlanks(t.bytes, assign);
  const vars = D.docxVariables(bytes);
  await api("PUT", `/templates/${t.id}`, { file_base64: bytesToB64(bytes), description: `Minuta de Word · ${vars.length} dato(s) del cliente o del expediente` });
  toast(`Minuta lista: ${assign.size} espacio(s) se llenarán con los datos del expediente.`);
  await renderBorradores();
  await openTemplate(t.id);
});

function guessCategory(name) {
  const n = window.JuanmaCombo.norm(name);
  if (/contrato/.test(n)) return "Contrato";
  if (/poder/.test(n)) return "Poder";
  if (/peticion/.test(n)) return "Derecho de petición";
  if (/demanda/.test(n)) return "Demanda";
  if (/tutela/.test(n)) return "Tutela";
  if (/recurso|apelacion|reposicion/.test(n)) return "Recurso";
  if (/memorial/.test(n)) return "Memorial";
  return "Otro";
}

// ---------- Firma electrónica ----------
const SIGN_STATUS = { enviada: ["warn", "En curso"], completada: ["ok", "Firmado por todos"], cancelada: ["", "Cancelada"], rechazada: ["bad", "Rechazada"] };
let signList = [], signCurrent = null, inpersonSigner = null, inpersonPad = null;

async function renderFirmas() {
  signList = await api("GET", "/esign");
  $("#sign-empty").hidden = signList.length > 0;
  $("#sign-rows").innerHTML = signList.map((r) => {
    const done = r.signers.filter((x) => x.status === "firmado").length;
    const [cls, label] = SIGN_STATUS[r.status];
    return `<tr>
      <td><strong>${escapeHtml(r.title)}</strong><br><span class="muted">${r.doc_kind === "pdf" ? "PDF" : "Texto"} · SHA-256 ${escapeHtml(r.doc_hash.slice(0, 12))}…</span></td>
      <td>${done}/${r.signers.length} · ${r.signers.map((x) => `${escapeHtml(x.name)} ${x.status === "firmado" ? "✓" : x.status === "rechazado" ? "✗" : "…"}`).join(", ")}</td>
      <td><span class="badge ${cls}">${label}</span></td>
      <td class="nowrap">${escapeHtml(r.created_at.slice(0, 16))} UTC</td>
      <td class="row-actions"><button data-action="open-sign" data-id="${r.id}">Ver</button></td>
    </tr>`;
  }).join("");
}

const signForm = $("#sign-dialog form");
// The test link signs by link only when it knows its own address (a downloaded copy does not).
const remoteSignOk = () => !WEB || !!window.JuanmaBackend?.signLink;
function signerRow(v = {}) {
  const div = document.createElement("div");
  div.className = "signer-row";
  div.innerHTML = `<input data-k="name" placeholder="Nombre completo" value="${escapeHtml(v.name || "")}" aria-label="Nombre del firmante" />
    <input data-k="id_number" placeholder="Cédula (ej. 52123456)" inputmode="numeric" value="${escapeHtml(v.id_number || "")}" aria-label="Documento del firmante" title="Cédula: 5 a 10 dígitos. Pasaporte: letras y números." />
    <input data-k="email" type="email" placeholder="Correo" value="${escapeHtml(v.email || "")}" aria-label="Correo del firmante" />
    <input data-k="phone" type="tel" inputmode="tel" placeholder="Celular (ej. 300 123 4567)" value="${escapeHtml(v.phone || "")}" aria-label="Celular del firmante" title="10 dígitos, empieza por 3. Otro país: con + e indicativo." />
    <select data-k="otp_channel" aria-label="Medio del código OTP" title="Por dónde recibe el código de verificación">
      <option value="email">Código por correo</option><option value="whatsapp">Código por WhatsApp</option>
    </select>
    <button type="button" class="mini danger" data-rm aria-label="Quitar firmante">✕</button>`;
  return div;
}
$("#add-signer").addEventListener("click", () => $("#signer-rows").append(signerRow()));
$("#signer-rows").addEventListener("click", (e) => { if (e.target.closest("[data-rm]")) e.target.closest(".signer-row").remove(); });
$("#signer-rows").addEventListener("input", (e) => e.target.classList.remove("invalid"));
// Same checks as the server (src/person.js): the wrong field is marked and the message says what to fix.
function checkSigners(rows, signers, remote) {
  $$(".invalid", $("#signer-rows")).forEach((el) => el.classList.remove("invalid"));
  if (!signers.length) throw new Error("Agregue al menos un firmante.");
  const p = window.JuanmaPerson.signersProblem(signers, { remote });
  if (!p) return;
  const el = $(`[data-k="${p.field}"]`, rows[p.index]);
  if (el) { el.classList.add("invalid"); el.focus(); }
  throw new Error(p.message);
}
signForm.addEventListener("change", (e) => {
  if (e.target.name === "stamp_page") $("[data-stamp-num]", signForm).hidden = e.target.value !== "num";
  if (e.target.name === "source") {
    const pdf = e.target.value === "pdf";
    signForm.elements.doc_text.hidden = pdf;
    signForm.elements.pdf.hidden = !pdf;
    $("[data-pdf-box]", signForm).hidden = !pdf || !signForm.elements.pdf.files[0];
    if (pdf && !signForm.elements.pdf.files[0]) signForm.elements.pdf.click();
  }
  if (e.target.name === "pdf") guarded(() => previewSignPdf(e.target.files[0]));
  if (e.target.name === "source" && e.target.value === "text" || e.target.name === "stamp_pos") guarded(() => ensureSpotPreview());
  drawStampMarks();
});
// The e-mail to the signer: the office leaves out the parts it does not want this time (version 2.8).
function renderMailBox() {
  const L = window.JuanmaLegal;
  $("#mail-parts").innerHTML = L.MAIL_PARTS.filter((p) => p.key !== "policies").map((p) =>
    `<label class="inline"><input type="checkbox" data-mail-part="${p.key}" checked /> ${escapeHtml(p.label)}</label>`).join("");
  $("#mail-policy-list").innerHTML = L.CONSENT_ITEMS.map((i) =>
    `<label class="inline"><input type="checkbox" data-mail-policy="${i.key}" checked /> ${escapeHtml(i.title)}</label>`).join("");
  updateMailPreview();
}
function mailChoice() {
  const out = Object.fromEntries($$("[data-mail-part]", signForm).map((c) => [c.dataset.mailPart, c.checked]));
  out.policies = $$("[data-mail-policy]", signForm).filter((c) => c.checked).map((c) => c.dataset.mailPolicy);
  return out;
}
function updateMailPreview() {
  const L = window.JuanmaLegal, f = signForm.elements;
  $("[data-mail-box]", signForm).hidden = f.mode.value === "presencial";
  const contract = L.isServiceContract(f.title.value);
  $("#mail-policies").hidden = !contract;
  const opts = mailChoice();
  const first = $("#signer-rows .signer-row");
  const name = first ? $('[data-k="name"]', first)?.value.trim() : "";
  const channel = first ? $('[data-k="otp_channel"]', first)?.value : "email";
  const policies = contract ? L.CONSENT_ITEMS.filter((i) => opts.policies.includes(i.key)).map((i) => ({ title: i.title })) : [];
  const parts = L.signMailParts({ name: name || "[nombre del firmante]", message: f.message.value, title: f.title.value || "[nombre del documento]",
    link: "[enlace privado de cada firmante]", code_via: ({ whatsapp: "WhatsApp", sms: "SMS" })[channel] || "correo", policies }, opts);
  $("#mail-preview").textContent = `Asunto: Documento para firmar: ${f.title.value}\n\n${parts.map((p) => p.text).join("\n\n")}`;
}
signForm.addEventListener("input", () => updateMailPreview());
signForm.addEventListener("change", () => updateMailPreview());

// The chosen PDF is shown page by page before sending, so the firm sees exactly what will be signed.
async function previewSignPdf(file) {
  const box = $("[data-pdf-box]", signForm), info = $("[data-pdf-info]", signForm);
  if (!file) { box.hidden = true; return; }
  box.hidden = false;
  const kb = file.size / 1024;
  const size = kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
  info.textContent = `${file.name} · ${size}`;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error("El PDF debe pesar menos de 10 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") throw new Error("El archivo no es un PDF válido.");
    if (!signForm.elements.title.value.trim()) signForm.elements.title.value = file.name.replace(/\.pdf$/i, "");
    const pages = await window.JuanmaPdfView.render($("#sign-pdf-view"), bytes);
    info.textContent = `${file.name} · ${size} · ${pages} página${pages === 1 ? "" : "s"}. Revise el documento antes de enviarlo.`;
    drawStampMarks();
  } catch (err) {
    $("#sign-pdf-view").replaceChildren();
    info.textContent = `${file.name}: ${err.message || "no se pudo mostrar."}`;
    throw err;
  }
}

// Where the signature goes (version 2.25): the dashed boxes over the preview show it for any choice;
// with «En el lugar que yo marque» the sender clicks the spot and drags the box to adjust it.
let signSpot = null; // { fx, fy }: top-left corner of the first stamp, as a fraction of the page
const spotChosen = () => signForm.elements.stamp_pos.value === "spot";
const signSpotPos = () => `at:${signSpot.fx.toFixed(4)},${signSpot.fy.toFixed(4)}`;
function signStampPage() {
  const f = signForm.elements;
  return f.stamp_page.value === "num" ? String(Math.max(1, Number(f.stamp_num.value) || 1)) : f.stamp_page.value;
}
function signerCount() {
  return Math.max(1, $$("#signer-rows .signer-row").filter((row) => $$("input", row).some((i) => i.value.trim())).length);
}
function drawStampMarks() {
  const view = $("#sign-pdf-view"), sheets = $$(".pdf-sheet", view);
  const picking = spotChosen();
  view.classList.toggle("stamp-picking", picking);
  $("[data-stamp-spot]", signForm).hidden = !picking;
  if (!sheets.length) return;
  if (picking && !signSpot) {
    // Starts where «Abajo a la derecha» puts it, on the page chosen above.
    const p = window.JuanmaPdfView.stampPages(signStampPage(), sheets.length)[0] || sheets.length;
    const W = Number(sheets[p - 1].dataset.w), H = Number(sheets[p - 1].dataset.h);
    const b = window.JuanmaPdf.stampBoxes(W, H, 1, "br")[0];
    signSpot = { fx: b.x / W, fy: (H - b.y - b.h) / H };
  }
  const marks = window.JuanmaPdfView.markStamps(view, { page: signStampPage(), pos: picking ? signSpotPos() : signForm.elements.stamp_pos.value, n: signerCount(), label: "Firma" });
  if (picking) marks.slice(0, 1).forEach((m) => { m.tabIndex = 0; m.setAttribute("role", "button"); m.setAttribute("aria-label", "Lugar de la firma: arrástrelo o muévalo con las flechas"); });
}
// A text document is shown as the PDF it will become, so the spot can be marked on it too.
let spotTextTimer = null;
async function ensureSpotPreview() {
  if (!spotChosen() || signForm.elements.source.value !== "text") return;
  $("[data-pdf-box]", signForm).hidden = false;
  $("[data-pdf-info]", signForm).textContent = "Así quedará el texto en PDF. Marque dónde va la firma.";
  await window.JuanmaPdfView.render($("#sign-pdf-view"), new Uint8Array(await markdownToPdf(signForm.elements.doc_text.value || " ").arrayBuffer()));
  drawStampMarks();
}
signForm.elements.doc_text.addEventListener("input", () => {
  clearTimeout(spotTextTimer);
  if (spotChosen()) spotTextTimer = setTimeout(() => guarded(ensureSpotPreview), 900);
});
$("#signer-rows").addEventListener("click", () => setTimeout(drawStampMarks));
$("#add-signer").addEventListener("click", () => setTimeout(drawStampMarks));
// Puts the first stamp at (fx, fy) of page n; the page select follows unless «Todas las páginas».
function placeSpot(n, fx, fy, sheet) {
  const W = Number(sheet.dataset.w), H = Number(sheet.dataset.h);
  signSpot = { fx: Math.min(Math.max(0, fx), Math.max(0, 1 - window.JuanmaPdf.STAMP.w / W)), fy: Math.min(Math.max(0, fy), Math.max(0, 1 - window.JuanmaPdf.STAMP.h / H)) };
  const f = signForm.elements;
  if (f.stamp_page.value !== "all") {
    f.stamp_page.value = "num";
    f.stamp_num.value = n;
    $("[data-stamp-num]", signForm).hidden = false;
  }
  drawStampMarks();
}
let spotDrag = null;
$("#sign-pdf-view").addEventListener("pointerdown", (e) => {
  if (!spotChosen()) return;
  const sheet = e.target.closest(".pdf-sheet");
  if (!sheet) return;
  const r = sheet.getBoundingClientRect(), W = Number(sheet.dataset.w), H = Number(sheet.dataset.h);
  const mark = e.target.closest(".stamp-mark");
  if (mark) {
    // Drag keeps the pointer at the same distance from the first stamp's corner.
    const first = $(".stamp-mark", sheet).getBoundingClientRect();
    spotDrag = { dx: e.clientX - first.left, dy: e.clientY - first.top, id: e.pointerId };
    e.currentTarget.classList.add("stamp-dragging");
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }
  // A click on the page centres the first stamp there.
  placeSpot(Number(sheet.dataset.page), (e.clientX - r.left) / r.width - window.JuanmaPdf.STAMP.w / W / 2, (e.clientY - r.top) / r.height - window.JuanmaPdf.STAMP.h / H / 2, sheet);
});
$("#sign-pdf-view").addEventListener("pointermove", (e) => {
  if (!spotDrag || e.pointerId !== spotDrag.id) return;
  const sheet = document.elementFromPoint(e.clientX, e.clientY)?.closest("#sign-pdf-view .pdf-sheet");
  if (!sheet) return;
  const r = sheet.getBoundingClientRect();
  placeSpot(Number(sheet.dataset.page), (e.clientX - spotDrag.dx - r.left) / r.width, (e.clientY - spotDrag.dy - r.top) / r.height, sheet);
});
const endSpotDrag = (e) => { if (!spotDrag) return; spotDrag = null; e.currentTarget.classList.remove("stamp-dragging"); };
$("#sign-pdf-view").addEventListener("pointerup", endSpotDrag);
$("#sign-pdf-view").addEventListener("pointercancel", endSpotDrag);
$("#sign-pdf-view").addEventListener("keydown", (e) => {
  const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  const sheet = e.target.closest?.(".stamp-mark") && e.target.closest(".pdf-sheet");
  if (!step || !sheet || !signSpot) return;
  e.preventDefault();
  const k = e.shiftKey ? 0.05 : 0.01;
  placeSpot(Number(sheet.dataset.page), signSpot.fx + step[0] * k, signSpot.fy + step[1] * k, sheet);
  $(".stamp-mark", sheet)?.focus();
});

async function openSignDialog({ title = "", text = "", caseId = null } = {}) {
  const cases = await api("GET", "/cases");
  signForm.elements.case_id.innerHTML = '<option value="">— Ninguno —</option>' + cases.map((k) =>
    `<option value="${k.id}">${escapeHtml(k.client_name)} · ${escapeHtml(k.type_name)}</option>`).join("");
  openDialog($("#sign-dialog"), "Enviar documento a firma", { title, doc_text: text, case_id: caseId ?? "" });
  signForm.elements.source.value = "text";
  signForm.elements.doc_text.hidden = false;
  signForm.elements.pdf.hidden = true;
  $("[data-pdf-box]", signForm).hidden = true;
  $("#sign-pdf-view").replaceChildren();
  $("#signer-rows").innerHTML = "";
  // The case's client is the usual first signer.
  const k = cases.find((x) => x.id === caseId);
  const c = k && (await api("GET", `/clients/${k.client_id}`).catch(() => null));
  $("#signer-rows").append(signerRow(c ? { name: c.full_name, id_number: c.id_number, email: c.email, phone: c.phone } : {}));
  signForm.elements.stamp_page.value = "last";
  signForm.elements.stamp_pos.value = "br";
  signSpot = null;
  drawStampMarks();
  signForm.elements.notify.checked = true;
  $("[data-stamp-num]", signForm).hidden = true;
  if (!remoteSignOk()) signForm.elements.mode.value = "presencial";
  renderMailBox();
}

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1]);
  r.onerror = () => reject(new Error("No se pudo leer el archivo."));
  r.readAsDataURL(file);
});

wireDialog($("#sign-dialog"), async (form) => {
  const rows = $$("#signer-rows .signer-row").filter((row) => $$("input", row).some((i) => i.value.trim()));
  const signers = rows.map((row) => Object.fromEntries($$("input, select", row).map((i) => [i.dataset.k, i.value.trim()])));
  checkSigners(rows, signers, form.elements.mode.value !== "presencial");
  const body = { title: form.elements.title.value, case_id: Number(form.elements.case_id.value) || null, signers,
    message: form.elements.message.value, mode: form.elements.mode.value,
    stamp_page: signStampPage(),
    stamp_pos: spotChosen() ? (signSpot ? signSpotPos() : "br") : form.elements.stamp_pos.value, notify: form.elements.notify.checked, mail: mailChoice() };
  if (form.elements.source.value === "pdf") {
    const f = form.elements.pdf.files[0];
    if (!f) throw new Error("Elija el archivo PDF.");
    body.doc_pdf_base64 = await fileToBase64(f);
    body.doc_name = f.name;
  } else body.doc_text = form.elements.doc_text.value;
  const r = await api("POST", "/esign", body);
  const failed = (r.delivery || []).filter((d) => !d.ok);
  const manual = (r.delivery || []).filter((d) => d.manual);
  toast(failed.length ? `Solicitud creada, pero ${failed.length} enlace(s) no se enviaron: ${failed[0].detail}` : body.mode === "presencial" ? "Solicitud creada. Abra “Ver” para firmar en persona."
    : manual.length ? "Solicitud creada. Envíe ahora el enlace y el código a cada firmante." : "Enlaces de firma enviados.", !!failed.length);
  if (FICHAS[route().name]) await refreshView();
  else location.hash === "#firmas" ? await renderFirmas() : (location.hash = "#firmas");
  if (manual.length) openSignSend(r.title, manual);
});

// Test link: the link and the one-time code leave from this device (WhatsApp or e-mail), in two separate messages.
function openSignSend(title, list) {
  const dlg = $("#sign-send-dialog");
  $("[data-title]", dlg).textContent = `Enviar a firma · ${title}`;
  const btns = (d, kind) => {
    const via = d[`${kind}_via`], text = d[`${kind}_text`];
    const out = [];
    if (via === "whatsapp" && d.wa) out.push(`<a class="button mini primary" target="_blank" rel="noopener" href="https://wa.me/${d.wa}?text=${encodeURIComponent(text)}">Enviar por WhatsApp</a>`);
    if (via === "email" && d.email) out.push(`<a class="button mini primary" target="_blank" rel="noopener" href="mailto:${encodeURIComponent(d.email)}?subject=${encodeURIComponent(kind === "code" ? `Código para firmar: ${title}` : d.subject)}&body=${encodeURIComponent(text)}">Enviar por correo</a>`);
    out.push(`<button type="button" class="mini" data-copy="${escapeHtml(text)}">Copiar mensaje</button>`);
    return out.join(" ");
  };
  $("#sign-send-body").innerHTML = list.map((d) => `<div class="send-card">
    <strong>${escapeHtml(d.name)}</strong>
    <div class="send-step"><span>1. Enlace${d.link_via === "email" ? " (correo)" : " (WhatsApp)"}</span>${btns(d, "link")}</div>
    <div class="send-step"><span>2. Código ${escapeHtml(d.otp)}</span>${btns(d, "code")}</div>
    <p class="hint">Código de la solicitud: <code>${escapeHtml(d.token)}</code>. Si el firmante abre el enlace y no ve el documento, lo escribe en «¿Le enviaron un documento para firmar?» de la pantalla de ingreso. El código de verificación vence en ${d.hours} horas y sirve una vez.</p>
  </div>`).join("");
  dlg.showModal();
}
$("#sign-send-body").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copy); toast("Mensaje copiado."); }
  catch { toast("No se pudo copiar; use el botón de WhatsApp o correo.", true); }
});

async function openSignDetail(id) {
  signCurrent = await api("GET", `/esign/${id}`);
  const r = signCurrent;
  const dlg = $("#sign-detail");
  $("[data-title]", dlg).textContent = r.title;
  $("[data-sub]", dlg).textContent = `${SIGN_STATUS[r.status][1]} · Código de verificación ${r.verify_code || "—"} · Huella del documento original (SHA-256): ${r.doc_hash}${r.signed_sha256 ? ` · Huella del PDF firmado: ${r.signed_sha256}` : ""}`;
  $("#sign-detail-body").innerHTML = `
    <ul class="signer-list">${r.signers.map((x) => `<li>
      <div><strong>${escapeHtml(x.name)}</strong> <span class="muted">${escapeHtml([x.id_type + " " + x.id_number, x.email].filter((v) => v.trim()).join(" · "))}</span></div>
      <div>${x.status === "firmado" ? `<span class="badge ok">Firmó ${escapeHtml(window.JuanmaPdf.colombiaTime(x.signed_at))} · ${x.method === "presencial" ? "en persona" : `enlace + código por ${({ sms: "SMS", whatsapp: "WhatsApp" })[x.otp_channel] || "correo"}`}</span>
        <img class="sig-img" src="${escapeHtml(x.signature_png)}" alt="Firma de ${escapeHtml(x.name)}" />`
        : x.status === "rechazado" ? `<span class="badge bad">No firmó: ${escapeHtml(x.reject_reason || "")}</span>`
        : `<span class="badge warn">Pendiente</span>${r.status === "enviada" ? `
          ${(x.email || x.phone) && remoteSignOk() ? `<button type="button" class="mini" data-sign-remind="${x.id}">${WEB ? "Enviar enlace y código" : "Reenviar enlace"}</button>` : ""}
          <button type="button" class="mini" data-sign-inperson="${x.id}">Firmar en persona</button>` : ""}`}</div>
    </li>`).join("")}</ul>
    <details><summary>Registro de eventos (${r.events.length})</summary>
      <table class="data-table"><tbody>${r.events.map((e) => `<tr><td class="nowrap">${escapeHtml(e.at)} UTC</td><td>${escapeHtml(e.event.replace(/_/g, " "))}</td><td>${escapeHtml(e.detail)}</td><td class="muted">${escapeHtml(e.ip)}</td></tr>`).join("")}</tbody></table>
    </details>`;
  const prev = $("#sign-doc-preview");
  prev.open = false;
  delete prev.dataset.loaded;
  $("[data-doc-view]", prev).replaceChildren();
  $('[data-sign-out="cancel"]', dlg).hidden = r.status !== "enviada";
  $('[data-sign-out="doc"]', dlg).hidden = r.status !== "completada";
  $('[data-sign-out="save"]', dlg).hidden = r.status !== "completada" || !r.case_id || !can("cases.write");
  if (!dlg.open) dlg.showModal();
}

// The document as it was sent (the PDF page by page, or the text), loaded when opened.
$("#sign-doc-preview").addEventListener("toggle", (e) => {
  const prev = e.currentTarget, view = $("[data-doc-view]", prev);
  if (!prev.open || prev.dataset.loaded || !signCurrent) return;
  prev.dataset.loaded = "1";
  guarded(async () => {
    if (signCurrent.doc_kind === "pdf") {
      const f = await api("GET", `/esign/${signCurrent.id}/pdf`);
      await window.JuanmaPdfView.render(view, D.b64ToBytes(f.base64));
      window.JuanmaPdfView.markStamps(view, { page: signCurrent.stamp_page, pos: signCurrent.stamp_pos, n: signCurrent.signers?.length || 1, label: "Firma" });
    } else view.innerHTML = `<article class="document">${DOMPurify.sanitize(marked.parse(signCurrent.doc_text || ""))}</article>`;
  });
});
$("#sign-detail").addEventListener("click", (e) => {
  const remind = e.target.closest("[data-sign-remind]");
  const inperson = e.target.closest("[data-sign-inperson]");
  const out = e.target.closest("[data-sign-out]")?.dataset.signOut;
  guarded(async () => {
    if (remind) {
      const d = await api("POST", `/esign/${signCurrent.id}/remind/${remind.dataset.signRemind}`);
      if (d.manual) { await openSignDetail(signCurrent.id); openSignSend(signCurrent.title, [d]); return; }
      toast(d.ok ? "Enlace reenviado. El anterior dejó de funcionar." : `No se envió: ${d.detail}`, !d.ok);
      await openSignDetail(signCurrent.id);
    } else if (inperson) {
      inpersonSigner = signCurrent.signers.find((x) => x.id === Number(inperson.dataset.signInperson));
      openDialog($("#inperson-dialog"), `Firma en persona · ${inpersonSigner.name}`, { typed_name: inpersonSigner.name, id_number: inpersonSigner.id_number });
      inpersonPad = window.JuanmaSigPad($("#inperson-pad"));
      inpersonPad.clear();
    } else if (out === "cancel") {
      if (!(await confirmAsk("Cancelar solicitud", "Los enlaces de firma dejarán de funcionar.", "Cancelar solicitud"))) return;
      await api("POST", `/esign/${signCurrent.id}/cancel`);
      await openSignDetail(signCurrent.id);
      await renderFirmas();
    } else if (out === "cert") {
      await saveFile(`Certificado de firma - ${safeName(signCurrent.title)}.pdf`, signatureCertificate(signCurrent));
    } else if (out === "doc" || out === "save") {
      // The signed PDF is generated once and kept: every copy has the same SHA-256 and passes verification.
      const f = await api("GET", `/esign/${signCurrent.id}/signed`);
      const blob = new Blob([D.b64ToBytes(f.base64)], { type: "application/pdf" });
      const filename = f.filename;
      if (out === "doc") await saveFile(filename, blob);
      else {
        await api("POST", `/cases/${signCurrent.case_id}/documents`, { name: `${signCurrent.title} (firmado)`, filename, file_base64: await blobToB64(blob) });
        toast("Documento firmado guardado en el expediente (Expedientes → Documentos).");
      }
    }
  });
});
$("#inperson-clear").addEventListener("click", () => inpersonPad?.clear());
wireDialog($("#inperson-dialog"), async (form) => {
  if (inpersonPad.isEmpty()) throw new Error("Falta la firma.");
  await api("POST", `/esign/${signCurrent.id}/in-person/${inpersonSigner.id}`, {
    typed_name: form.elements.typed_name.value, id_number: form.elements.id_number.value, accept: form.elements.accept.checked, signature_png: inpersonPad.toPng(),
  });
  toast("Firma registrada.");
  await openSignDetail(signCurrent.id);
  await renderFirmas();
});

const safeName = (t) => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w .-]+/g, "").trim().slice(0, 80) || "documento";

// ---------- Correo con trazabilidad ----------
let mailList = [], mailFiles = [];
async function renderCorreo() {
  const [status, list] = await Promise.all([api("GET", "/mail/status"), api("GET", "/mail")]);
  mailList = list;
  const note = $("#mail-note");
  note.hidden = status.configured;
  note.textContent = status.configured ? "" : status.message || "El servidor aún no tiene configurado el correo (SMTP). Gerencia debe configurarlo para poder enviar.";
  $("[data-action=new-mail]").disabled = !status.configured;
  $("#mail-empty").hidden = list.length > 0;
  $("#mail-rows").innerHTML = list.map((m) => `<tr>
    <td>${escapeHtml(m.to_addr)}${m.cc ? `<br><span class="muted">cc ${escapeHtml(m.cc)}</span>` : ""}</td>
    <td><strong>${escapeHtml(m.subject)}</strong>${m.attachments.length ? `<br><span class="muted">${m.attachments.length} adjunto(s)</span>` : ""}</td>
    <td>${m.status === "enviado" ? `<span class="badge ok">Enviado</span>` : `<span class="badge bad" title="${escapeHtml(m.smtp_response)}">Falló</span>`}<br><span class="muted nowrap">${escapeHtml(m.sent_at.slice(0, 16))} UTC</span></td>
    <td>${m.opened_at ? `<span class="nowrap">${escapeHtml(m.opened_at.slice(0, 16))} UTC</span>` : '<span class="muted">—</span>'}</td>
    <td>${m.confirmed_at ? `<span class="badge ok">Confirmado</span><br><span class="muted nowrap">${escapeHtml(m.confirmed_at.slice(0, 16))} UTC</span>` : '<span class="muted">Pendiente</span>'}</td>
    <td class="row-actions"><button data-action="mail-proof" data-id="${m.id}">Constancia PDF</button>
      ${m.raw_size ? `<button data-action="mail-eml" data-id="${m.id}" title="El mensaje exacto que se envió, para verificar las huellas">Mensaje original (.eml)</button>` : ""}
      ${m.has_tsa ? `<button data-action="mail-tsr" data-id="${m.id}">Sello de tiempo (.tsr)</button>` : ""}</td>
  </tr>`).join("");
}

const mailForm = $("#mail-dialog form");
async function openMailDialog({ caseId = null, subject = "", files = [], to = "" } = {}) {
  const cases = await api("GET", "/cases");
  mailForm.elements.case_id.innerHTML = '<option value="">— Ninguno —</option>' + cases.map((k) =>
    `<option value="${k.id}">${escapeHtml(k.client_name)} · ${escapeHtml(k.type_name)}</option>`).join("");
  const k = cases.find((x) => x.id === caseId);
  openDialog($("#mail-dialog"), "Nuevo correo con trazabilidad", {
    case_id: caseId ?? "", subject: subject || (k ? `${k.type_name}${k.radicado ? " · Rad. " + formatRadicado(k.radicado) : ""}` : ""),
    to: to || k?.court_email || "",
  });
  const hint = $("#mail-court-hint");
  hint.hidden = !k?.court_email;
  hint.textContent = k?.court_email ? `Correo del despacho del expediente: ${k.court_email}` : "";
  mailFiles = files;
  renderMailFiles();
}
function renderMailFiles() {
  $("#mail-pending-atts").innerHTML = mailFiles.map((f, i) => `<li>${escapeHtml(f.name)} · ${Math.ceil(f.size / 1024)} KB <button type="button" class="mini" data-rm-att="${i}">Quitar</button></li>`).join("");
}
mailForm.elements.files.addEventListener("change", (e) => { mailFiles.push(...e.target.files); e.target.value = ""; renderMailFiles(); });
$("#mail-pending-atts").addEventListener("click", (e) => { const b = e.target.closest("[data-rm-att]"); if (b) { mailFiles.splice(Number(b.dataset.rmAtt), 1); renderMailFiles(); } });
mailForm.elements.case_id.addEventListener("change", async (e) => {
  const k = (await api("GET", "/cases")).find((x) => x.id === Number(e.target.value));
  if (k?.court_email && !mailForm.elements.to.value) mailForm.elements.to.value = k.court_email;
});

wireDialog($("#mail-dialog"), async (form) => {
  const attachments = [];
  for (const f of mailFiles) attachments.push({ filename: f.name, mime: f.type || "application/octet-stream", base64: await fileToBase64(f) });
  const d = formData(form);
  const m = await api("POST", "/mail", { to: d.to, cc: d.cc, subject: d.subject, body: d.body, case_id: Number(d.case_id) || null, attachments, attach_mode: d.attach_mode });
  toast(`Correo enviado a ${m.to_addr}.`);
  if (FICHAS[route().name]) await refreshView();
  else location.hash === "#correo" ? await renderCorreo() : (location.hash = "#correo");
});

// Consolidated evidence of a traced e-mail, as a PDF to present to a judge.
const EVENT_LABEL = {
  aceptado_por_servidor_smtp: "Aceptado por el servidor de correo (SMTP) para entrega", envio_fallido: "Envío fallido",
  sello_de_tiempo: "Sello de tiempo (RFC 3161) sobre la huella del mensaje", sin_sello_de_tiempo: "Sin sello de tiempo",
  mensaje_abierto: "Mensaje abierto (imagen de rastreo cargada)", anexo_descargado: "Anexo descargado por el enlace",
  pagina_de_acuse_abierta: "Página de acuse de recibo abierta", acuse_de_recibo: "ACUSE DE RECIBO confirmado por el destinatario",
};
const coMs = (utc) => {
  if (!utc) return "";
  const d = new Date(Date.parse(String(utc).replace(" ", "T") + (String(utc).endsWith("Z") ? "" : "Z")) - 5 * 3600 * 1000);
  return d.toISOString().replace("T", " ").replace("Z", "") + " (hora de Colombia)";
};
const proxyNote = (ua) => (/GoogleImageProxy|ggpht/i.test(ua || "") ? " · abierto a través del servicio de imágenes de Gmail (la IP es de Google)" : "");
function mailProof(m) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth(), M = 46;
  let y = M;
  const line = (t, { size = 9.5, bold = false, color = [16, 16, 16], gap = 3, mono = false } = {}) => {
    doc.setFont(mono ? "courier" : "helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(...color);
    for (const l of doc.splitTextToSize(String(t), W - 2 * M)) { if (y > 748) { doc.addPage(); y = M; } doc.text(l, M, y); y += size * 1.32; }
    y += gap;
  };
  const head = (t) => { y += 6; line(t, { size: 11.5, bold: true, color: [0, 43, 106], gap: 4 }); };
  const ev = m.events || [];
  const opens = ev.filter((e) => e.event === "mensaje_abierto"), downloads = ev.filter((e) => e.event === "anexo_descargado");
  line("CONSTANCIA CONSOLIDADA DE ENVÍO Y RECEPCIÓN DE MENSAJE DE DATOS", { size: 14, bold: true, color: [0, 43, 106] });
  line(`Generada el ${coMs(new Date().toISOString())} por TecjuridicosApp · Correo N.º ${m.id}`, { size: 8, color: [90, 90, 90] });
  head("1. Resumen");
  const yes = (b) => (b ? "SÍ" : "NO");
  line(`Entregado al servidor de correo para su envío: ${yes(m.status === "enviado")}${m.sent_at_ms ? ` · ${coMs(m.sent_at_ms)}` : ""}`, { bold: true });
  line(`Mensaje abierto: ${yes(opens.length)}${opens.length ? ` · ${opens.length} vez/veces · primera: ${coMs(opens[0].at)}` : " (o el programa del destinatario bloquea las imágenes)"}`, { bold: true });
  line(`Anexos descargados por enlace: ${yes(downloads.length)}${downloads.length ? ` · ${downloads.length} descarga(s) · primera: ${coMs(downloads[0].at)}` : ""}`, { bold: true });
  line(`Acuse de recibo del destinatario: ${yes(m.confirmed_at)}${m.confirmed_at ? ` · ${coMs(m.confirmed_at)} · ${m.confirm_name || ""}` : ""}`, { bold: true });
  line(`Sello de tiempo de una autoridad (TSA): ${m.has_tsa ? `SÍ · ${m.tsa_time} · ${m.tsa_url}` : `NO${m.tsa_detail ? " · " + m.tsa_detail : ""}`}`);
  head("2. Datos del envío");
  line(`Remitente: ${m.from || "correo configurado de la firma"}`);
  line(`Destinatario(s): ${m.to_addr}${m.cc ? ` · Copia: ${m.cc}` : ""}`);
  line(`Asunto: ${m.subject}`, { bold: true });
  line(`Message-ID: ${m.smtp_message_id || "—"}`, { mono: true, size: 8 });
  line(`Respuesta del servidor SMTP: ${m.smtp_response || "—"}`, { size: 8.5 });
  line(`Forma de entrega de los anexos: ${m.attach_mode === "enlace" ? "solo por enlace de descarga (cada descarga se registra)" : "adjuntos al correo y además por enlace de descarga"}`);
  head("3. Integridad del mensaje completo (archivo .eml enviado)");
  line(`Tamaño: ${(m.raw_size || 0).toLocaleString("es-CO")} bytes`);
  for (const [k, v] of [["SHA-1", m.raw_sha1], ["SHA-256", m.raw_sha256], ["SHA-512", m.raw_sha512], ["SHA3-512", m.raw_sha3_512]]) if (v) line(`${k}: ${v}`, { mono: true, size: 7.2, gap: 1 });
  line(`Huella del contenido (destinatarios, asunto, texto y anexos), SHA-256: ${m.content_hash}`, { mono: true, size: 7.2 });
  line("SHA-1 se incluye por compatibilidad; SHA-256, SHA-512 y SHA3-512 son los algoritmos vigentes y resistentes a colisiones. Cualquiera puede recalcularlas sobre el archivo .eml descargado de la app.", { size: 7.5, color: [90, 90, 90] });
  head("4. Anexos");
  if (!m.attachments.length) line("Sin anexos.");
  for (const a of m.attachments) {
    const n = downloads.filter((d) => d.detail.startsWith(a.filename + " ·")).length;
    line(`${a.filename} · ${a.mime} · ${a.size.toLocaleString("es-CO")} bytes (${(a.size / 1024).toFixed(1)} KB) · descargas registradas: ${n}`, { bold: true, size: 9 });
    for (const [k, v] of [["SHA-1", a.sha1], ["SHA-256", a.sha256], ["SHA-512", a.sha512], ["SHA3-512", a.sha3_512]]) if (v) line(`${k}: ${v}`, { mono: true, size: 7.2, gap: 0 });
    y += 4;
  }
  head("5. Registro de actividad (fecha y hora exactas)");
  for (const e of ev) {
    line(`${e.at} UTC · ${coMs(e.at)}`, { bold: true, size: 8.5, gap: 0 });
    line(`${EVENT_LABEL[e.event] || e.event.replace(/_/g, " ")}${e.detail ? " · " + e.detail : ""}`, { size: 8.5, gap: 0 });
    if (e.ip || e.user_agent) line(`IP ${e.ip || "—"} · ${e.user_agent || ""}${proxyNote(e.user_agent)}`, { size: 7.2, color: [90, 90, 90], gap: 4 });
    else y += 4;
  }
  if (!ev.length) line("Correo enviado antes de este registro detallado: ver los datos de los numerales 1 y 2.");
  head("6. Texto del mensaje");
  line(m.body, { size: 9.5 });
  head("7. Valor probatorio y alcance");
  line("Mensaje de datos conforme a la Ley 527 de 1999 (arts. 10, 11, 20 y 21: admisibilidad, fuerza probatoria y acuse de recibo) y al art. 8 de la Ley 2213 de 2022 (notificación personal por mensaje de datos), cuya exequibilidad condicionó la Corte Constitucional en la sentencia C-420 de 2020 a que se acredite el acuse de recibo o se pueda constatar por otro medio el acceso del destinatario al mensaje. Los registros de apertura, descarga y acuse sirven para esa constatación; el juez los valora con las reglas de la sana crítica (CGP, arts. 176 y 247).", { size: 8 });
  line("Limitaciones: la apertura se detecta cuando el programa del destinatario carga imágenes; algunos servicios las cargan por un intermediario o las bloquean. «Aceptado por el servidor de correo» prueba la entrega al servidor de salida, no la lectura. Esta constancia la genera la firma con su propio sistema: no es un servicio de correo electrónico certificado prestado por una entidad acreditada ante ONAC.", { size: 8, color: [90, 90, 90] });
  return doc.output("blob");
}

// ---------- Bitácora (change 50): who changed what, when, from which device ----------
let auditRows = [];
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const AUDIT_MODULES = ["Acceso", "Clientes", "Expedientes", "Agenda", "Pagos", "Firmas", "Correo certificado", "Documentos", "Consulta de procesos", "Despachos", "Usuarios", "Configuración", "Jurisprudencia", "Importar"];
const deviceIcon = (d) => (d === "Móvil" ? "📱" : d === "Tableta" ? "📲" : d === "PC" ? "💻" : "");
const changeList = (changes) => (changes || []).map((c) => {
  const val = (f, v) => (f === "assigned_user_id" || f === "office_id") && v ? (directory.find((u) => String(u.id) === v)?.name || offices.find((o) => String(o.id) === v)?.name || v) : v;
  return `<li><strong>${escapeHtml(c.label)}:</strong> <span class="before">${escapeHtml(val(c.field, c.before) || "(vacío)")}</span> → <span class="after">${escapeHtml(val(c.field, c.after) || "(vacío)")}</span></li>`;
}).join("");
async function renderBitacora(more = false) {
  const f = $("#audit-filters");
  if (!more) {
    const cu = f.elements.userId.value, cm = f.elements.module.value;
    f.elements.userId.innerHTML = '<option value="">Todos</option>' + directory.map((u) => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join("");
    f.elements.userId.value = cu;
    f.elements.module.innerHTML = '<option value="">Todos</option>' + AUDIT_MODULES.map((m) => `<option>${escapeHtml(m)}</option>`).join("");
    f.elements.module.value = cm;
  }
  const q = new URLSearchParams(Object.entries(formData(f)).filter(([, v]) => v));
  if (more && auditRows.length) q.set("before", auditRows.at(-1).id);
  const rows = await api("GET", `/audit?${q}`);
  auditRows = more ? [...auditRows, ...rows] : rows;
  $("#audit-empty").hidden = auditRows.length > 0;
  $("#audit-more").hidden = rows.length < 300;
  $("#audit-rows").innerHTML = auditRows.map((e) => `<tr class="${e.ok ? "" : "audit-denied"}">
    <td class="nowrap">${escapeHtml(CMETA.utcToBogota(e.at))}</td>
    <td>${escapeHtml(e.user_name || "—")}</td>
    <td><span title="${escapeHtml(e.user_agent)}">${deviceIcon(e.device)} ${escapeHtml(e.device)}</span><br><span class="muted">${escapeHtml(e.device_detail)}${e.ip ? " · IP " + escapeHtml(e.ip) : ""}</span></td>
    <td><span class="badge">${escapeHtml(e.module)}</span><br>${escapeHtml(e.summary)}</td>
    <td>${e.changes.length ? `<ul class="audit-changes">${changeList(e.changes)}</ul>` : '<span class="muted">—</span>'}</td>
    <td>${e.case_id ? `<button class="mini" data-action="go" data-to="#expediente-${e.case_id}-historial">Ver expediente</button>` : ""}</td></tr>`).join("");
}
$("#audit-filters").addEventListener("change", () => guarded(() => renderBitacora()));
$("#audit-filters").addEventListener("submit", (e) => { e.preventDefault(); guarded(() => renderBitacora()); });
$("#audit-filters").elements.q.addEventListener("input", debounce(() => guarded(() => renderBitacora()), 350));
$("#audit-more").addEventListener("click", () => guarded(() => renderBitacora(true)));
$("#audit-xlsx").addEventListener("click", () => guarded(async () => {
  const head = ["Fecha y hora (Colombia)", "Funcionario", "Dispositivo", "Sistema y navegador", "IP", "Módulo", "Acción", "Cambios"]
    .map((value) => ({ value, fontWeight: "bold", backgroundColor: "#002B6A", color: "#FFFFFF" }));
  const body = auditRows.map((e) => [CMETA.utcToBogota(e.at), e.user_name, e.device, e.device_detail, e.ip, e.module, e.summary,
    e.changes.map((c) => `${c.label}: ${c.before || "(vacío)"} → ${c.after || "(vacío)"}`).join(" | ")].map((v) => ({ value: String(v ?? ""), type: String })));
  const blob = await window.writeXlsxFile([[{ value: "Bitácora — TecjuridicosApp", fontWeight: "bold" }], [{ value: `Generada el ${new Date().toLocaleString("es-CO")} por ${me.name}` }], [], head, ...body],
    { columns: [18, 22, 10, 18, 14, 18, 50, 70].map((width) => ({ width })), sheet: "Bitácora" }).toBlob();
  await saveFile(`bitacora-${new Date().toISOString().slice(0, 10)}.xlsx`, blob);
}));

// ---------- Agenda (tareas, audiencias, términos) ----------
const KIND_LABEL = window.JuanmaCaseMeta.TASK_KIND_LABEL;
const bogotaNow = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
const DAY_FMT = new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const dayLabel = (ymd) => {
  const today = bogotaNow().slice(0, 10);
  const tomorrow = new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10);
  const txt = DAY_FMT.format(new Date(ymd + "T00:00:00Z"));
  return ymd === today ? `Hoy · ${txt}` : ymd === tomorrow ? `Mañana · ${txt}` : txt.charAt(0).toUpperCase() + txt.slice(1);
};

async function renderAgenda() {
  const q = new URLSearchParams();
  if ($("#agenda-mine").checked) q.set("mine", "1");
  if ($("#agenda-kind").value) q.set("kind", $("#agenda-kind").value);
  if ($("#agenda-status").value) q.set("status", $("#agenda-status").value);
  const sel = $("#agenda-user"), cur = sel.value;
  sel.innerHTML = '<option value="">Todos los funcionarios</option>' + directory.map((u) => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join("");
  sel.value = cur;
  if (sel.value) { q.set("userId", sel.value); q.delete("mine"); }
  const [tasks, all] = await Promise.all([api("GET", `/tasks?${q}`), api("GET", "/tasks")]);
  renderFollowTable(all);
  const now = bogotaNow();
  const groups = new Map();
  for (const t of tasks) {
    const key = t.status === "pendiente" && t.due_at < now ? "vencidas" : t.due_at.slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === "vencidas" ? -1 : b === "vencidas" ? 1 : a.localeCompare(b)));
  $("#agenda-list").innerHTML = keys.map((key) => `
    <section class="agenda-day ${key === "vencidas" ? "overdue" : ""}">
      <h3>${key === "vencidas" ? "Vencidas" : escapeHtml(dayLabel(key))}</h3>
      <ul>${groups.get(key).map((t) => `
        <li class="agenda-item kind-${t.kind} ${t.status !== "pendiente" ? "done" : ""}">
          <span class="time">${escapeHtml(key === "vencidas" ? t.due_at : t.due_at.slice(11))}</span>
          <span class="badge ${t.kind === "audiencia" ? "ok" : t.kind === "termino" ? "warn" : ""}">${KIND_LABEL[t.kind]}</span>
          <div class="agenda-body">
            <span><strong>${escapeHtml(t.title)}</strong> ${followBadge(t)}</span>
            <span class="muted">${clientName(t.client_id, t.client_name)} · ${escapeHtml(t.type_name)}${t.radicado ? " · " + escapeHtml(formatRadicado(t.radicado)) : ""}</span>
            ${t.location ? `<span class="muted">${escapeHtml(t.location)}</span>` : ""}
            ${t.term_days ? `<span class="muted">Término: ${escapeHtml(termText(t))}</span>` : ""}
            <span class="muted">${escapeHtml(whoOf(t))}${t.delivered_at ? " · entregado " + escapeHtml(t.delivered_at) : ""}${t.response_at ? " · respuesta " + escapeHtml(t.response_at) : ""}</span>
          </div>
          <span class="toolbar"><button data-action="go" data-to="#expediente-${t.case_id}-tareas">Ver expediente</button>
          ${can("cases.write") ? `
            ${t.status === "pendiente" ? (CMETA.RESPONSE_KINDS.includes(t.kind) ? `<button data-action="edit-task" data-id="${t.id}" data-focus="response_at">Respuesta</button>` : `<button data-action="task-done" data-id="${t.id}">Cumplida</button>`) : ""}
            ${t.status === "pendiente" ? `<button data-action="notify-task" data-id="${t.id}">Notificar</button>` : ""}
            <button data-action="edit-task" data-id="${t.id}">Editar</button>
            <button class="danger" data-action="delete-task" data-id="${t.id}" aria-label="Eliminar">✕</button>` : ""}</span>
        </li>`).join("")}</ul>
    </section>`).join("") || '<p class="empty panel">No hay tareas ni audiencias con este filtro. Cree una con “+ Tarea o audiencia” o desde un expediente.</p>';
  agendaCache = tasks;
}
let agendaCache = [];
// Compliance per person over every task the user can see.
function renderFollowTable(all) {
  const now = bogotaNow(), by = new Map();
  for (const t of all) {
    const who = whoOf(t), f = CMETA.taskFollowUp(t, now);
    const r = by.get(who) || { who, total: 0, pend: 0, venc: 0, ok: 0, tarde: 0 };
    r.total++;
    if (f.key === "vencida") r.venc++; else if (f.key === "a_tiempo") r.ok++; else if (f.key === "tarde") r.tarde++; else if (f.key !== "cancelada") r.pend++;
    by.set(who, r);
  }
  const rows = [...by.values()].sort((a, b) => b.venc - a.venc || b.pend - a.pend);
  $("#agenda-follow-body").innerHTML = rows.length ? `<table class="data-table compact"><thead><tr><th>Funcionario</th><th class="num">Pendientes</th><th class="num">Vencidas</th><th class="num">Cumplidas a tiempo</th><th class="num">Con retraso</th><th class="num">Cumplimiento</th></tr></thead><tbody>${rows.map((r) => {
      const closed = r.ok + r.tarde + r.venc;
      return `<tr><td><strong>${escapeHtml(r.who)}</strong></td><td class="num">${r.pend}</td><td class="num">${r.venc ? `<span class="follow bad">${r.venc}</span>` : 0}</td>
        <td class="num">${r.ok}</td><td class="num">${r.tarde}</td><td class="num">${closed ? Math.round((r.ok / closed) * 100) + " %" : "—"}</td></tr>`;
    }).join("")}</tbody></table><p class="hint">Cumplimiento = cumplidas a tiempo sobre (cumplidas + vencidas sin cumplir).</p>` : '<p class="empty">Aún no hay tareas asignadas.</p>';
}
["#agenda-mine", "#agenda-kind", "#agenda-status", "#agenda-user"].forEach((sel) => $(sel).addEventListener("change", () => guarded(renderAgenda)));

const taskForm = $("#task-dialog form");
const TASK_TITLE_HINT = {
  audiencia: "Ej. Audiencia inicial art. 77 CPTSS", tarea: "Ej. Preparar alegatos de conclusión", termino: "Ej. Vence traslado de la demanda",
  recurso: "Ej. Recurso de apelación contra el auto del 10 de octubre", requerimiento: "Ej. Atender requerimiento del despacho: aportar poder",
  peticion: "Ej. Derecho de petición a Colpensiones: historia laboral", oficio: "Ej. Oficio a la EPS para que remita la historia clínica",
};
// Form fields follow the kind: oficios, peticiones and requerimientos track delivery and answer.
function syncTaskForm(autoDue = false) {
  const f = taskForm.elements, kind = f.kind.value, answered = CMETA.RESPONSE_KINDS.includes(kind);
  $("[data-response]", taskForm).hidden = !answered;
  $("[data-due-label]", taskForm).textContent = answered ? "Plazo de respuesta" : kind === "audiencia" ? "Fecha y hora" : "Plazo (fecha y hora)";
  f.title.placeholder = TASK_TITLE_HINT[kind] || "";
  $("[data-response-hint]", taskForm).textContent = kind === "peticion"
    ? "Derecho de petición: la entidad debe responder en 15 días hábiles (Ley 1755 de 2015, art. 14; 10 días para documentos, 30 para consultas). Al indicar la fecha de radicación la app calcula el plazo sin fines de semana ni festivos."
    : "Al registrar la fecha de respuesta, queda como cumplido. Si vence el plazo sin respuesta, el responsable recibe el aviso.";
  $("[data-term]", taskForm).hidden = kind === "audiencia";
  if (!f.id.value) $("[data-title]", taskForm).textContent = `Nuevo: ${KIND_LABEL[kind].toLowerCase()}`;
  // A petition's term runs from the day it was filed: 15 business days unless the user sets another.
  if (autoDue && kind === "peticion" && f.delivered_at.value) {
    f.term_from.value = f.delivered_at.value;
    if (!f.term_days.value) applyTermPreset(TERM_PRESETS.findIndex((x) => x.name === "Derecho de petición (general)"));
    computeTerm();
  }
  $("[data-done-notes]", taskForm).hidden = !f.done.checked;
  syncNotify();
}

// ----- Version 2.26: «Notificar al asignado» (bell always; e-mail and WhatsApp when chosen) -----
let noticeChannels = null;
/** Who gets the notice: the chosen funcionario, else the case's responsible. */
function noticeTarget() {
  const f = taskForm.elements, k = taskCases.find((x) => x.id === Number(f.case_id.value));
  const uid = Number(f.assigned_user_id.value) || k?.assigned_user_id || null;
  return uid ? { id: uid, name: directory.find((u) => u.id === uid)?.name || k?.assigned_name || "" } : null;
}
function syncNotify() {
  const f = taskForm.elements, who = noticeTarget(), closed = f.done.checked;
  $("[data-notify-box]", taskForm).hidden = closed;
  // Without anyone to tell the box is off; it comes back as it was once a funcionario is chosen.
  f.notify_on.checked = !!who && f.notify_on.dataset.want === "1";
  f.notify_on.disabled = !who;
  $("[data-notify-who]", taskForm).textContent = who ? `(${who.name}${who.id === me.id ? ", usted" : ""})` : "(nadie: elija el funcionario o asigne un responsable al expediente)";
  $$("[data-notify-ways]", taskForm).forEach((x) => (x.hidden = !f.notify_on.checked));
  const ch = noticeChannels;
  $("[data-notify-hint]", taskForm).textContent = !f.notify_on.checked ? "" : ch?.link
    ? "En el enlace de pruebas el correo y WhatsApp no salen solos: al guardar le mostramos el texto para enviarlo desde su propio correo o WhatsApp."
    : ch && (!ch.email || !ch.whatsapp) ? `${!ch.email ? "El correo no está configurado en el servidor. " : ""}${!ch.whatsapp ? "WhatsApp no está configurado en el servidor. " : ""}Lo que no salga se lo mostramos para enviarlo usted.`
    : "El aviso queda en el historial de tareas del expediente.";
}
taskForm.elements.notify_on.addEventListener("change", (e) => { e.target.dataset.want = e.target.checked ? "1" : ""; syncNotify(); });
taskForm.elements.assigned_user_id.addEventListener("change", syncNotify);

const NOTICE_LABEL = { app: "Aviso en la App", email: "Correo", whatsapp: "WhatsApp" };
function showNoticeResult(n) {
  const dlg = $("#notice-dialog");
  $("[data-to]", dlg).textContent = `Para: ${n.to.name}${n.to.email ? ` · ${n.to.email}` : ""}`;
  $("[data-results]", dlg).innerHTML = n.results.map((r) => `<li class="${r.ok ? "ok" : "bad"}"><span class="follow ${r.ok ? "ok" : "bad"}">${r.ok ? "Enviado" : "No enviado"}</span>
    <strong>${escapeHtml(NOTICE_LABEL[r.channel] || r.channel)}</strong><br><span class="muted">${escapeHtml(r.detail || "")}</span></li>`).join("");
  $("[data-text]", dlg).textContent = n.mail.text;
  const failed = (c) => n.results.some((r) => r.channel === c && !r.ok);
  const digits = String(n.to.phone || "").replace(/\D/g, "");
  $("[data-links]", dlg).innerHTML = [
    failed("email") && n.to.email && `<a class="button primary" target="_blank" rel="noopener" href="mailto:${encodeURIComponent(n.to.email)}?subject=${encodeURIComponent(n.mail.subject)}&body=${encodeURIComponent(n.mail.text)}">Enviar desde mi correo</a>`,
    failed("whatsapp") && digits && `<a class="button primary" target="_blank" rel="noopener" href="https://wa.me/${digits.length === 10 ? "57" + digits : digits}?text=${encodeURIComponent(n.short)}">Enviar por WhatsApp</a>`,
  ].filter(Boolean).join("");
  $("[data-copy]", dlg).onclick = async () => {
    try { await navigator.clipboard.writeText(n.mail.text); toast("Texto copiado."); } catch { toast("No se pudo copiar: selecciónelo en «Ver el texto del aviso».", true); }
  };
  dlg.showModal();
}

// ----- Término de cumplimiento (change 48): days set by the user, presets as suggestions -----
const TERM_PRESETS = CMETA.LEGAL_TERMS.flatMap(([, items]) => items);
taskForm.elements.term_preset.innerHTML += CMETA.LEGAL_TERMS.map(([area, items]) => `<optgroup label="${escapeHtml(area)}">${items.map((x) =>
  `<option value="${TERM_PRESETS.indexOf(x)}">${escapeHtml(x.name)} · ${x.days} días${x.unit === "calendario" ? " calendario" : ""} (${escapeHtml(x.norm)})</option>`).join("")}</optgroup>`).join("");
const LONG_DATE = new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const termText = (t) => (t.term_days ? `${t.term_days} día(s) ${t.term_unit === "calendario" ? "calendario" : "hábiles"} desde ${t.term_from}${t.term_label ? " · " + t.term_label : ""}` : "");
function applyTermPreset(i) {
  const x = TERM_PRESETS[i], f = taskForm.elements;
  if (!x) return;
  f.term_preset.value = String(i);
  Object.assign(f.term_days, { value: x.days });
  f.term_unit.value = x.unit;
  f.term_judicial.checked = x.judicial;
  f.term_label.value = `${x.name} (${x.norm})`;
  if (!f.title.value.trim()) f.title.value = x.name;
  if (!f.id.value && f.kind.value !== x.kind && !(CMETA.RESPONSE_KINDS.includes(f.kind.value) && x.kind === "peticion")) { f.kind.value = x.kind; syncTaskForm(); }
}
/** Due date from the term: notification date (+2 business days if notified by e-mail) + N days. */
function computeTerm() {
  const f = taskForm.elements, out = $("[data-term-result]", taskForm), days = Number(f.term_days.value);
  if (!f.term_from.value || !(days > 0)) { out.textContent = f.term_days.value || f.term_from.value ? "Indique la fecha de notificación y el número de días." : ""; return; }
  const judicial = f.term_judicial.checked;
  const start = f.term_email.checked ? L.addBusinessDays(f.term_from.value, 2, { judicial }) : f.term_from.value;
  const due = L.addBusinessDays(start, days, { unit: f.term_unit.value, judicial });
  f.due_at.value = `${due}T${f.term_hour.value || "17:00"}`;
  const txt = LONG_DATE.format(new Date(due + "T00:00:00Z"));
  out.innerHTML = `Vence el <strong>${escapeHtml(txt)}</strong> a las ${escapeHtml(f.term_hour.value || "17:00")}. ${days} día(s) ${f.term_unit.value === "calendario" ? "calendario" : "hábiles"} contados desde el día siguiente al ${escapeHtml(start)}${f.term_email.checked ? " (notificación por correo: se entiende hecha 2 días hábiles después del envío)" : ""}${f.term_unit.value === "habiles" ? `, sin sábados, domingos ni festivos${judicial ? " ni vacancia judicial" : ""}` : ""}.`;
}
taskForm.elements.term_preset.addEventListener("change", (e) => { applyTermPreset(Number(e.target.value)); if (e.target.value === "") taskForm.elements.term_label.value = ""; computeTerm(); });
for (const n of ["term_from", "term_days", "term_unit", "term_hour", "term_judicial", "term_email"]) {
  taskForm.elements[n].addEventListener(n === "term_days" ? "input" : "change", computeTerm);
}
taskForm.elements.term_days.addEventListener("input", () => {
  const x = TERM_PRESETS[Number(taskForm.elements.term_preset.value)];
  if (x && Number(taskForm.elements.term_days.value) !== x.days) { taskForm.elements.term_preset.value = ""; taskForm.elements.term_label.value = ""; }
});
taskForm.elements.kind.addEventListener("change", () => syncTaskForm(true));
taskForm.elements.delivered_at.addEventListener("change", () => syncTaskForm(true));
taskForm.elements.done.addEventListener("change", () => syncTaskForm());
taskForm.elements.due_at.addEventListener("input", () => (taskForm.elements.due_at.dataset.touched = "1"));

/** Funcionario list of the task form for the chosen case; the empty option names the case's responsible. */
function fillTaskAssignees(cases, selected) {
  const k = cases.find((x) => x.id === Number(taskForm.elements.case_id.value));
  const sel = taskForm.elements.assigned_user_id;
  sel.innerHTML = `<option value="">— El responsable del expediente${k?.assigned_name ? ` (${escapeHtml(k.assigned_name)})` : ""} —</option>` +
    caseStaff(k?.office_id).map((u) => `<option value="${u.id}">${staffLabel(u)}</option>`).join("");
  sel.value = selected && [...sel.options].some((o) => o.value === String(selected)) ? String(selected) : "";
}
let taskCases = [];
taskForm.elements.case_id.addEventListener("change", () => { fillTaskAssignees(taskCases, taskForm.elements.assigned_user_id.value); syncNotify(); });

async function openTaskDialog(t = null, caseId = null, kind = null, preset = {}, focus = "") {
  const cases = await api("GET", "/cases");
  if (!cases.length) { toast("Primero cree un expediente.", true); return; }
  taskCases = cases;
  taskForm.elements.case_id.innerHTML = cases.map((k) => `<option value="${k.id}">${caseFolder(k) ? "Carpeta " + escapeHtml(caseFolder(k)) + " · " : ""}${escapeHtml(k.client_name)} · ${escapeHtml(k.type_name)}${k.title ? " · " + escapeHtml(k.title) : ""}</option>`).join("");
  const k0 = kind || "audiencia";
  openDialog($("#task-dialog"), t ? `Editar ${KIND_LABEL[t.kind].toLowerCase()}` : `Nuevo: ${KIND_LABEL[k0].toLowerCase()}`, t ? {
    id: t.id, kind: t.kind, title: t.title, location: t.location, notes: t.notes, due_at: t.due_at.replace(" ", "T"),
    delivered_at: t.delivered_at || "", response_at: t.response_at || "", response_notes: t.response_notes || "", done_notes: t.done_notes || "",
    term_from: t.term_from || "", term_days: t.term_days || "", term_unit: t.term_unit || "habiles", term_label: t.term_label || "", term_hour: t.due_at.slice(11, 16) || "17:00",
  } : { kind: k0, delivered_at: CMETA.RESPONSE_KINDS.includes(k0) ? bogotaNow().slice(0, 10) : "", term_from: bogotaNow().slice(0, 10), term_unit: "habiles", term_hour: "17:00", ...preset });
  taskForm.elements.term_preset.value = "";
  taskForm.elements.term_judicial.checked = !/término administrativo/.test(t?.term_label || "") && t?.kind !== "peticion" && k0 !== "peticion";
  taskForm.elements.term_email.checked = /notificación por correo/.test(t?.term_label || "");
  $("[data-term-result]", taskForm).textContent = t?.term_days ? `Término registrado: ${termText(t)}. Vence ${t.due_at}.` : "";
  delete taskForm.elements.due_at.dataset.touched;
  if (t) taskForm.elements.due_at.dataset.touched = "1";
  taskForm.elements.case_id.value = t?.case_id ?? caseId ?? cases[0].id;
  taskForm.elements.case_id.disabled = !!t;
  fillTaskAssignees(cases, t?.assigned_user_id ?? preset.assigned_user_id ?? "");
  const days = t ? t.remind_days : k0 === "audiencia" ? [3, 1] : [1];
  $$("input[name=remind]", taskForm).forEach((c) => (c.checked = days.includes(Number(c.value))));
  taskForm.elements.done.checked = t?.status === "hecha";
  // New tasks and hearings offer the notice already ticked; an edit only when asked («Notificar»).
  taskForm.elements.notify_on.dataset.want = !t || focus === "notify" ? "1" : "";
  if (!noticeChannels) noticeChannels = await api("GET", "/tasks/notify-channels").catch(() => ({ email: false, whatsapp: false }));
  syncTaskForm(!t);
  if (focus === "notify") taskForm.elements.notify_message.focus();
  if (focus && taskForm.elements[focus]) {
    if (focus === "response_at" && !taskForm.elements.response_at.value) taskForm.elements.response_at.value = bogotaNow().slice(0, 10);
    taskForm.elements[focus].focus();
  }
}
wireDialog($("#task-dialog"), async (form) => {
  const d = formData(form);
  const body = {
    case_id: Number(form.elements.case_id.value), kind: d.kind, title: d.title, location: d.location, notes: d.notes,
    due_at: d.due_at.replace("T", " "), assigned_user_id: Number(d.assigned_user_id) || null,
    remind_days: $$("input[name=remind]:checked", form).map((c) => Number(c.value)),
    status: form.elements.done.checked ? "hecha" : "pendiente",
    done_notes: form.elements.done.checked ? d.done_notes || "" : "",
    delivered_at: d.delivered_at || "", response_at: d.response_at || "", response_notes: d.response_notes || "",
  };
  const termOn = !$("[data-term]", form).hidden && Number(d.term_days) > 0 && d.term_from;
  Object.assign(body, termOn ? {
    term_from: d.term_from, term_days: Number(d.term_days), term_unit: d.term_unit,
    term_label: [d.term_label.replace(/ · (notificación por correo|término administrativo)/g, ""), form.elements.term_email.checked && "notificación por correo",
      !form.elements.term_judicial.checked && "término administrativo"].filter(Boolean).join(" · "),
  } : { term_from: "", term_days: null, term_unit: "", term_label: "" });
  const notifying = form.elements.notify_on.checked && !form.elements.notify_on.disabled && body.status === "pendiente";
  if (notifying) body.notify = { email: form.elements.notify_email.checked, whatsapp: form.elements.notify_whatsapp.checked, message: d.notify_message || "" };
  const saved = d.id ? await api("PUT", `/tasks/${d.id}`, body) : await api("POST", "/tasks", body);
  const who = directory.find((u) => u.id === body.assigned_user_id);
  if (saved.notice?.error) toast(`Guardado, pero no se notificó: ${saved.notice.error}`, true);
  else if (!saved.notice) toast(d.id ? "Guardado." : `Registrado: ${KIND_LABEL[d.kind].toLowerCase()}${who && who.id !== me.id ? `. Se avisó a ${who.name} en la App` : ""}.`);
  if (saved.notice && !saved.notice.error) setTimeout(() => showNoticeResult(saved.notice), 0);
  refreshBell();
  await refreshView();
});

// ---------- Consulta de procesos ----------
$("#portal-probe-run").addEventListener("click", () => guarded(async () => {
  $("#portal-probe-out").innerHTML = '<p class="muted">Probando… (puede tardar hasta un minuto)</p>';
  const rows = await api("GET", "/monitor/portal-probe");
  $("#portal-probe-out").innerHTML = `<table class="data-table compact"><thead><tr><th>Portal</th><th>Respuesta</th><th>Verificación de seguridad</th><th>Detalle</th></tr></thead><tbody>${rows.map((r) => `<tr>
    <td><strong>${escapeHtml(r.name)}</strong><br><span class="muted">${escapeHtml(r.url)}</span></td>
    <td>${r.status ? `HTTP ${r.status} · ${r.ms} ms · ${Math.round((r.bytes || 0) / 1024)} KB` : `<span class="follow bad">Sin conexión</span><br><span class="muted">${escapeHtml(r.error || "")}</span>`}</td>
    <td>${r.status ? (r.captcha ? '<span class="follow warn">Sí (captcha)</span>' : '<span class="follow ok">No detectada</span>') : "—"}</td>
    <td><span class="muted">${escapeHtml([r.title, r.forms != null ? `${r.forms} formulario(s)` : "", (r.apiHints || []).join(", ")].filter(Boolean).join(" · "))}</span></td></tr>`).join("")}</tbody></table>`;
}));
let monitorRows = [];
async function renderConsulta() {
  const [rows, prefs, status, log] = await Promise.all([
    api("GET", "/monitor/cases"), api("GET", "/monitor/prefs"), api("GET", "/monitor/status"), api("GET", "/monitor/log"),
  ]);
  monitorRows = rows;
  $("#consulta-empty").hidden = rows.length > 0;
  $("#consulta-table tbody").innerHTML = rows.map((k) => `
    <tr>
      <td><input type="checkbox" class="pick" value="${k.id}" ${k.selected ? "checked" : ""} aria-label="Seleccionar ${escapeHtml(k.radicado)}" /></td>
      <td><span class="mono">${escapeHtml(formatRadicado(k.radicado))}</span><br><strong>${escapeHtml(k.client_name)}</strong><br><span class="muted">${escapeHtml(k.type_name)}${k.assigned_name ? " · " + escapeHtml(k.assigned_name) : ""}</span></td>
      <td>${escapeHtml(k.court_name || "—")}<br><span class="muted">${escapeHtml([k.city, k.department].filter(Boolean).join(", "))}</span>${k.court_email ? `<br><span class="muted copyable">${escapeHtml(k.court_email)}</span>` : ""}</td>
      <td>${escapeHtml(k.last_action_date || "—")}<br><span class="muted">${k.last_checked_at ? "Consultado " + escapeHtml(k.last_checked_at.slice(0, 16)) + " UTC" : "Sin consultar"}</span>
        ${k.last_error ? `<br><span class="badge bad" title="${escapeHtml(k.last_error)}">Error en la última consulta</span>` : ""}</td>
      <td>${k.new_7d ? `<span class="badge ok">${k.new_7d} nueva(s)</span>` : '<span class="muted">—</span>'}</td>
      <td><label class="switch"><input type="checkbox" data-monitor="${k.id}" ${k.monitor ? "checked" : ""} /> <span>${k.monitor ? "Activo" : "Pausado"}</span></label></td>
      <td class="row-actions"><button data-action="view-acts" data-id="${k.id}">Actuaciones</button> <button data-action="portals" data-id="${k.id}">Portales</button></td>
    </tr>`).join("");
  updateConsultaButtons();
  const f = $("#prefs-form");
  $$("input[name=hours]", f).forEach((c) => (c.checked = prefs.hours.includes(c.value)));
  f.by_email.checked = prefs.by_email;
  f.email.value = prefs.email || "";
  f.by_whatsapp.checked = prefs.by_whatsapp;
  f.whatsapp.value = prefs.whatsapp || "";
  $(`input[name=scope][value=${prefs.scope}]`, f).checked = true;
  const missing = [!status.channels.email && "correo (SMTP)", !status.channels.whatsapp && "WhatsApp"].filter(Boolean);
  $("#channel-note").hidden = !missing.length;
  $("#channel-note").textContent = missing.length ? `El servidor aún no tiene configurado: ${missing.join(" ni ")}. El reporte queda en las notificaciones de la app.` : "";
  $("#report-log").innerHTML = log.map((r) => `<li><strong>${escapeHtml(r.sent_at.slice(0, 16))} UTC</strong> · ${r.trigger === "manual" ? "Manual" : "Programado " + escapeHtml(r.trigger)}
    <span>${r.channels.map((c) => `<span class="badge ${c.ok ? "ok" : "warn"}" title="${escapeHtml(c.detail)}">${c.channel === "email" ? "Correo" : "WhatsApp"} ${c.ok ? "✓" : "✗"}</span>`).join(" ") || '<span class="badge">Solo en la app</span>'}</span>
    <details><summary>Ver reporte</summary><pre>${escapeHtml(r.summary)}</pre></details></li>`).join("") || '<li class="muted">Aún no se han enviado reportes.</li>';
}

const pickedIds = () => $$("#consulta-table .pick:checked").map((c) => Number(c.value));
function updateConsultaButtons() {
  const n = pickedIds().length;
  $("#consulta-selected").disabled = !n;
  $("#consulta-selected").textContent = n ? `Consultar seleccionados (${n})` : "Consultar seleccionados";
}
$("#consulta-table").addEventListener("change", (e) => {
  if (e.target.id === "consulta-check-all") $$("#consulta-table .pick").forEach((c) => (c.checked = e.target.checked));
  const mon = e.target.closest("[data-monitor]");
  if (mon) guarded(async () => {
    await api("PUT", `/monitor/cases/${mon.dataset.monitor}/monitor`, { monitor: mon.checked });
    mon.nextElementSibling.textContent = mon.checked ? "Activo" : "Pausado";
  });
  updateConsultaButtons();
});

async function runConsulta(ids) {
  const box = $("#consulta-status");
  box.hidden = false;
  box.classList.remove("error");
  box.textContent = `Consultando ${ids ? ids.length : "todos los"} proceso(s) en la Rama Judicial…`;
  $("#consulta-all").disabled = $("#consulta-selected").disabled = true;
  try {
    const r = await api("POST", "/monitor/check", ids ? { case_ids: ids } : {});
    const failed = r.results.filter((x) => !x.ok);
    box.textContent = `Consulta terminada: ${r.ok} de ${r.checked} proceso(s) consultados, ${r.newCount} actuación(es) nueva(s).` +
      (failed.length ? ` No se pudieron consultar ${failed.length}: ${failed[0].error}` : "");
    box.classList.toggle("error", !!failed.length && !r.ok);
    await renderConsulta();
    refreshBell();
  } catch (err) {
    box.textContent = `Error: ${err.message}`;
    box.classList.add("error");
  } finally {
    $("#consulta-all").disabled = false;
    updateConsultaButtons();
  }
}
$("#consulta-all").addEventListener("click", () => runConsulta(null));
$("#consulta-selected").addEventListener("click", () => runConsulta(pickedIds()));

$("#prefs-form").addEventListener("submit", (e) => {
  e.preventDefault();
  guarded(async () => {
    const f = e.target;
    await api("PUT", "/monitor/prefs", {
      hours: $$("input[name=hours]:checked", f).map((c) => c.value),
      by_email: f.by_email.checked, email: f.email.value, by_whatsapp: f.by_whatsapp.checked, whatsapp: f.whatsapp.value,
      scope: $("input[name=scope]:checked", f).value, selected: pickedIds(),
    });
    toast("Preferencias guardadas.");
  });
});
$("#report-now").addEventListener("click", () => guarded(async () => {
  const btn = $("#report-now");
  btn.disabled = true;
  try {
    const r = await api("POST", "/monitor/report", { check: true });
    toast(`Reporte enviado: ${r.newCount} actuación(es) nueva(s).`);
    await renderConsulta();
    refreshBell();
  } finally {
    btn.disabled = false;
  }
}));

async function showActuaciones(id) {
  const k = monitorRows.find((x) => x.id === id);
  const acts = await api("GET", `/monitor/cases/${id}/actuaciones`);
  const dlg = $("#acts-dialog");
  $("[data-title]", dlg).textContent = `Actuaciones · ${formatRadicado(k.radicado)}`;
  $("[data-sub]", dlg).textContent = `${k.client_name} · ${k.court_name || "Despacho sin identificar"}`;
  $("#acts-rows").innerHTML = acts.map((a) => `<tr><td class="nowrap">${escapeHtml(a.fecha)}</td><td><strong>${escapeHtml(a.actuacion)}</strong></td>
    <td>${escapeHtml(a.anotacion)}</td>
    <td>${a.decision ? `<span class="pill">${escapeHtml(a.decision_kind)}</span> ${escapeHtml(a.decision)}${a.notified ? `<br><span class="muted">${escapeHtml(a.notified)}</span>` : ""}` : '<span class="muted">—</span>'}</td>
    <td class="nowrap">${a.fecha_inicial ? escapeHtml(a.fecha_inicial + " a " + a.fecha_final) : ""}</td></tr>`).join("")
    || '<tr><td colspan="5" class="muted">Sin actuaciones registradas. Use “Consultar” para traerlas.</td></tr>';
  dlg.showModal();
}

// ---------- Official portals ----------
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const ta = Object.assign(document.createElement("textarea"), { value: text });
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch {}
  ta.remove();
  return ok;
}

// Official portals for a case (change 54): Siglo XXI (national query), TYBA, SIUGJ,
// Publicaciones Procesales and SAMAI, the suggested one first. Opening one copies the radicado.
// Result of «Consultar en todas las plataformas», per portal (kept for this session).
const lastPortalCheck = new Map();
function portalCheckBox(caseId) {
  const r = lastPortalCheck.get(caseId);
  if (!r) return "";
  return `<div class="portal-check" data-portal-case="${caseId}"><strong>Resultado de la consulta en todas las plataformas</strong> <span class="muted">· ${escapeHtml(r.at)}</span>
    <ul>${r.portals.map((p) => `<li><span class="follow ${p.mode === "auto" ? (p.ok ? "ok" : "bad") : "muted"}">${p.mode === "auto" ? (p.ok ? "Consultado" : "Error") : "Revisar a mano"}</span>
      <span><strong>${escapeHtml(p.name)}</strong>${p.suggested ? ' <span class="badge ok">Sugerido</span>' : ""}<br><span class="muted">${escapeHtml(p.detail || "")}</span></span>
      ${p.mode === "manual" ? `<a class="button mini" href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer" data-portal-open data-portal-copy-what="${p.id === "publicaciones" ? "court" : "rad"}">Abrir</a>` : "<span></span>"}</li>`).join("")}</ul></div>`;
}
function portalListHtml(k) {
  const { PORTALS, portalOrder } = window.JuanmaPortals;
  return portalOrder(k.radicado, k.category_name).map((id, i) => {
    const p = PORTALS.find((x) => x.id === id);
    return `<li class="portal-item">
      <div><strong>${escapeHtml(p.name)}</strong>${i === 0 ? ' <span class="badge ok">Sugerido</span>' : ""}${p.auto ? ' <span class="badge">Consulta automática en el servidor</span>' : ""}
        <br><span class="muted">${escapeHtml(p.how)}</span></div>
      <a class="button" href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer" data-portal-open data-portal-copy-what="${p.by === "despacho" ? "court" : "rad"}">Abrir</a>
    </li>`;
  }).join("");
}
function portalCopyBar(k, client) {
  const doc = client?.id_number || "";
  return `<div class="portal-rad">
    ${k.radicado ? `<span class="mono">${escapeHtml(formatRadicado(k.radicado))}</span> <button type="button" class="mini" data-copy-value="${escapeHtml(window.JuanmaPortals.radicadoDigits(k.radicado) || k.radicado)}">Copiar radicado</button>` : '<span class="muted">Sin radicado: busque por documento o nombre (SIUGJ y TYBA lo permiten).</span>'}
    ${doc ? `<button type="button" class="mini" data-copy-value="${escapeHtml(String(doc).replace(/\D/g, ""))}">Copiar documento del cliente</button>` : ""}
    <button type="button" class="mini" data-copy-value="${escapeHtml(k.client_name)}">Copiar nombre del cliente</button>
    ${k.court_name ? `<button type="button" class="mini" data-copy-value="${escapeHtml(k.court_name)}">Copiar despacho</button>` : ""}
  </div>`;
}
// Copy buttons and «Abrir» (which copies the radicado, or the court for Publicaciones Procesales) anywhere.
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-copy-value]");
  if (c) { copyText(c.dataset.copyValue).then((ok) => toast(ok ? "Copiado: péguelo en el buscador del portal." : "No se pudo copiar; selecciónelo y cópielo a mano.", !ok)); return; }
  const a = e.target.closest("[data-portal-open]");
  if (!a) return;
  const box = a.closest("[data-portal-case]");
  const k = box && state.cases.find((x) => x.id === Number(box.dataset.portalCase));
  if (!k) return;
  const value = a.dataset.portalCopyWhat === "court" ? k.court_name : window.JuanmaPortals.radicadoDigits(k.radicado) || k.radicado;
  if (value) copyText(value).then((ok) => ok && toast(a.dataset.portalCopyWhat === "court" ? "Despacho copiado: búsquelo en Publicaciones Procesales." : "Radicado copiado: péguelo en el buscador del portal."));
});
// «Consultar en Rama Judicial» for one case: the server (Azure) queries the national
// service now and shows the process and its actuaciones; the test link cannot reach
// external sites, so it copies the radicado and opens the official query.
async function showRama(id) {
  const k = state.cases.find((x) => x.id === id) || await api("GET", `/cases/${id}`);
  if (!state.cases.some((x) => x.id === k.id)) state.cases.push(k);
  const { PORTALS, radicadoDigits } = window.JuanmaPortals;
  const url = PORTALS.find((p) => p.id === "cpnu").url;
  const rad = radicadoDigits(k.radicado) || k.radicado || "";
  const live = !WEB && can("processes.consult") && !!rad;
  let opened = false;
  if (rad) copyText(rad);
  if (rad && !live) {
    // "noopener" would make window.open return null; drop the opener by hand to know the tab opened.
    const tab = window.open(url, "_blank");
    if (tab) { tab.opener = null; opened = true; }
  }
  const dlg = $("#rama-dialog");
  $("[data-title]", dlg).textContent = `Consultar en Rama Judicial${caseFolder(k) ? " · Carpeta " + caseFolder(k) : ""}`;
  $("[data-sub]", dlg).textContent = [k.client_name, k.court_name || "Despacho sin identificar"].filter(Boolean).join(" · ");
  $("[data-portal-box]", dlg).dataset.portalCase = k.id;
  $("[data-rama-rad]", dlg).innerHTML = `${rad ? `<span class="mono">${escapeHtml(formatRadicado(k.radicado))}</span> <button type="button" class="mini" data-copy-value="${escapeHtml(rad)}">Copiar radicado</button>` : '<span class="muted">Sin radicado</span>'}
    <a class="button${live ? "" : " primary"}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" data-portal-open data-portal-copy-what="rad">Abrir la consulta oficial</a>`;
  const body = $("[data-rama-body]", dlg);
  if (!rad) {
    body.innerHTML = `<p class="empty">Este expediente no tiene radicado de 23 dígitos. Cárguelo para consultar el proceso; en la consulta oficial también se puede buscar por el nombre de las partes.</p>
      ${can("cases.write") ? '<p><button value="cancel" data-action="add-radicado">Cargar radicado</button></p>' : ""}`;
  } else if (!live) {
    body.innerHTML = `<p class="hint">${opened ? "Se abrió la Consulta Nacional Unificada de la Rama Judicial en otra pestaña" : "Pulse «Abrir la consulta oficial» para abrir la Consulta Nacional Unificada de la Rama Judicial"} y el radicado quedó copiado: péguelo en «Número de radicación» y pulse «Consultar».</p>
      <p class="hint">${WEB ? "En este enlace de prueba la App no puede traer las actuaciones (no se conecta a sitios externos). En la versión del servidor (Azure) este botón consulta el proceso al momento y muestra aquí el despacho, las partes y las actuaciones." : "Su usuario no tiene el permiso de consulta de procesos; puede revisar el proceso en la consulta oficial."}</p>`;
  } else {
    body.innerHTML = '<p class="hint">Consultando la Rama Judicial…</p>';
  }
  dlg.showModal();
  if (!live) return;
  let r;
  try { r = await api("POST", `/monitor/cases/${k.id}/rama`); }
  catch (err) { r = { ok: false, error: err.message, processes: [], acts: [] }; }
  const p = r.processes[0];
  const acts = r.acts || [];
  body.innerHTML = `${r.ok ? `<p class="hint">Consultado ${escapeHtml(bogotaNow())} (hora Colombia). ${r.first ? `Primera consulta de este proceso: se trajeron ${acts.length} actuación(es).` : r.newCount ? `<strong>${r.newCount} actuación(es) nueva(s).</strong>` : "Sin actuaciones nuevas desde la consulta anterior."} Las actuaciones quedan guardadas en el expediente.</p>`
      : `<p class="form-error">${escapeHtml(/Rama Judicial/.test(r.error || "") ? r.error : `No se pudo consultar la Rama Judicial: ${r.error || "sin respuesta"}`).replace(/\.?$/, ".")} Use «Abrir la consulta oficial»: el radicado quedó copiado.${acts.length ? " Abajo están las actuaciones ya guardadas en el expediente." : ""}</p>`}
    ${p ? `<dl class="facts">${factRow("Despacho", p.court)}${factRow("Juez o ponente", p.judge)}${factRow("Departamento", p.department)}${factRow("Fecha de radicación", p.filed)}${factRow("Última actuación", p.lastAction)}${p.parties ? `<div tabindex="0" class="fact-wide"><dt>Sujetos procesales</dt><dd>${p.parties.split(/\s*\|\s*/).filter(Boolean).map(escapeHtml).join("<br>")}</dd></div>` : ""}</dl>` : ""}
    ${acts.length ? `<div class="table-scroll acts-scroll"><table class="data-table compact"><thead><tr><th>Fecha</th><th>Actuación</th><th>Anotación</th><th>Términos</th></tr></thead><tbody>${acts.map((a) => `<tr>
      <td class="nowrap">${escapeHtml(String(a.fecha || "").slice(0, 10))}</td><td><strong>${escapeHtml(a.actuacion || "")}</strong>${a.decision ? `<br><span class="muted">Decisión: ${escapeHtml(a.decision)}</span>` : ""}</td>
      <td>${escapeHtml(a.anotacion || "")}</td><td class="nowrap">${a.fecha_inicial ? escapeHtml(a.fecha_inicial + " a " + a.fecha_final) : ""}</td></tr>`).join("")}</tbody></table></div>`
      : r.ok ? '<p class="empty">La Rama Judicial no muestra actuaciones para este radicado.</p>' : ""}`;
  if (r.ok && (location.hash === `#expediente-${k.id}` || location.hash.startsWith(`#expediente-${k.id}-`))) await refreshView();
}

function showPortals(k) {
  const dlg = $("#portals-dialog");
  if (!state.cases.some((x) => x.id === k.id)) state.cases.push(k);
  $("[data-title]", dlg).textContent = `Consultar en los portales${caseFolder(k) ? " · Carpeta " + caseFolder(k) : ""}`;
  $("[data-sub]", dlg).textContent = [k.client_name, k.court_name || "Despacho sin identificar"].filter(Boolean).join(" · ");
  $("[data-portal-box]", dlg).dataset.portalCase = k.id;
  $("[data-portal-copy]", dlg).innerHTML = portalCopyBar(k, state.clients.find((c) => c.id === k.client_id));
  $("#portal-list").innerHTML = portalListHtml(k);
  dlg.showModal();
}

// ---------- Despachos ----------
async function renderDespachos() {
  const meta = await api("GET", "/courts/meta");
  $("#courts-meta").textContent = meta.total
    ? `${meta.total.toLocaleString("es-CO")} despachos en el directorio · actualizado ${meta.updated.slice(0, 10)}. Fuente: directorio oficial de la Rama Judicial cargado por Gerencia.`
    : "El directorio está vacío. Descargue el directorio de despachos judiciales (correos electrónicos) del sitio de la Rama Judicial y cárguelo aquí.";
  await searchCourts();
}
let courtsTimer = null;
async function searchCourts() {
  const q = new URLSearchParams();
  if ($("#courts-dep").value) q.set("department", $("#courts-dep").value);
  if ($("#courts-city").value) q.set("city", $("#courts-city").value);
  if ($("#courts-area").value) q.set("area", $("#courts-area").value);
  if ($("#courts-q").value.trim()) q.set("q", $("#courts-q").value.trim());
  const rows = await api("GET", `/courts?${q}`);
  $("#courts-count").textContent = `${rows.length}${rows.length === 500 ? "+" : ""} despacho(s)`;
  $("#courts-table tbody").innerHTML = rows.map((c) => `<tr>
    <td><strong>${escapeHtml(c.name)}</strong>${c.code ? `<br><span class="muted mono">${escapeHtml(c.code)}</span>` : ""}</td>
    <td>${escapeHtml(c.area)}</td><td>${escapeHtml(c.city)}<br><span class="muted">${escapeHtml([c.circuit && c.circuit !== c.city ? "Circuito de " + c.circuit : "", c.department].filter(Boolean).join(" · "))}</span></td>
    <td>${c.email ? `<span class="copyable">${escapeHtml(c.email)}</span> <button class="mini" data-copy="${escapeHtml(c.email)}">Copiar</button>${can("mail.send") ? ` <button class="mini" data-action="mail-court" data-to="${escapeHtml(c.email)}">Escribir</button>` : ""}` : ""}</td>
    <td>${escapeHtml(c.phone)}</td></tr>`).join("");
}
for (const sel of ["#courts-dep", "#courts-city", "#courts-area"]) $(sel).addEventListener("change", () => guarded(searchCourts));
$("#courts-q").addEventListener("input", () => { clearTimeout(courtsTimer); courtsTimer = setTimeout(() => guarded(searchCourts), 250); });
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copy); toast("Correo copiado."); }
  catch { toast(b.dataset.copy); }
});

// Official directory file → rows. Column names vary between editions, so match loosely.
const COURT_COLS = {
  department: ["departamento", "depto", "distrito"], city: ["ciudad", "municipio", "ciudad municipio", "sede"],
  name: ["despacho", "nombre despacho", "nombre del despacho", "juzgado", "dependencia", "nombre"],
  area: ["especialidad", "area", "jurisdiccion", "especialidad despacho"], circuit: ["circuito", "circuito judicial"], email: ["correo", "correo electronico", "email", "e mail", "correo institucional"],
  code: ["codigo", "codigo despacho", "cod despacho"], judge: ["juez", "nombre juez", "nombre del juez", "titular", "funcionario", "nombre funcionario", "nombre del funcionario", "magistrado", "ponente"], phone: ["telefono", "telefonos", "tel"], address: ["direccion"],
};
$("#courts-file").addEventListener("change", (e) => guarded(async () => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const IMP = window.JuanmaImport;
  const sheets = await IMP.readFile(file);
  const rows = [];
  for (const sh of sheets) {
    const { headers, body } = IMP.splitHeader(sh.rows);
    const idx = {};
    headers.forEach((h, i) => {
      const n = IMP.norm(h);
      for (const [k, names] of Object.entries(COURT_COLS)) if (idx[k] === undefined && names.includes(n)) idx[k] = i;
    });
    if (idx.name === undefined || idx.department === undefined) continue;
    body.forEach((r, j) => rows.push({ rowNumber: j + 2, ...Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, r[i]])) }));
  }
  if (!rows.length) throw new Error("No se reconocieron columnas de Departamento y Despacho en el archivo.");
  if (!(await ask({ title: "Cargar directorio de despachos", message: `Se cargarán ${rows.length.toLocaleString("es-CO")} despachos. Los que ya existen se actualizan.`, okLabel: "Cargar" }))) return;
  const out = await api("POST", "/courts/import", { rows });
  courtCache.clear();
  courtsTotal += out.created;
  toast(`Directorio cargado: ${out.created} nuevos, ${out.updated} actualizados${out.skipped.length ? `, ${out.skipped.length} omitidos` : ""}.`);
  await renderDespachos();
}));

// ---------- Pagos y cartera ----------
const L = window.JuanmaLedger;
const cop = (n) => L.fmtCOP(n);
const parseMoney = (v) => Number(String(v || "").replace(/[^\d]/g, "")) || 0;
const localToday = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
let payMeta = null, paySettings = null, payClients = [], payTab = "cartera";

// Money inputs: thousands separators as the user types.
document.addEventListener("input", (e) => {
  if (!e.target.matches?.("input.money")) return;
  const n = parseMoney(e.target.value);
  e.target.value = n ? cop(n) : "";
});

async function renderPagos() {
  payMeta ||= await api("GET", "/payments/meta");
  const clientId = $("#pay-client").value;
  const [sum, clients] = await Promise.all([api("GET", "/payments/summary"), api("GET", "/clients")]);
  payClients = clients;
  const sel = $("#pay-client");
  sel.innerHTML = '<option value="">Todos los clientes</option>' + clients.map(clientOption).join("");
  sel.value = clientId;
  $("#pay-balance").textContent = cop(sum.totals.balance);
  $("#pay-overdue").textContent = cop(sum.totals.overdue);
  $("#pay-due7").textContent = cop(sum.due_7d);
  $("#pay-month").textContent = cop(sum.collected_month);
  $("#pay-received").textContent = cop(sum.received_total ?? 0);
  const max = Math.max(1, ...Object.values(sum.totals.aging));
  $("#pay-aging").innerHTML = L.AGING.map(([k, label], i) => `<div class="hbar" role="listitem"><span class="hbar-label">${label}</span>
    <span class="hbar-track"><span class="hbar-fill ${i >= 3 ? "bad" : i >= 1 ? "late" : ""}" style="width:${(sum.totals.aging[k] / max) * 100}%"></span></span>
    <span class="hbar-value">${cop(sum.totals.aging[k])}</span></div>`).join("");
  const rows = sum.clients.filter((r) => !clientId || r.client_id === Number(clientId));
  if (clientId) $("#pay-received").textContent = cop(rows[0]?.received ?? 0);
  $("#pay-cartera-empty").hidden = rows.length > 0;
  $("#pay-cartera").innerHTML = rows.map((r) => `<tr>
    <td><strong>${escapeHtml(r.client_name)}</strong><br><span class="muted">${escapeHtml(r.id_number)}${r.phone ? " · " + escapeHtml(r.phone) : ""}</span></td>
    <td class="num">${r.billed ? cop(r.billed) : '<span class="muted">—</span>'}</td>
    <td class="num"><strong>${cop(r.received)}</strong></td>
    <td class="num">${cop(r.balance)}${r.credit ? `<br><span class="muted">a favor ${cop(r.credit)}</span>` : ""}</td>
    <td class="num">${r.overdue ? `<strong>${cop(r.overdue)}</strong>` : "—"}</td>
    <td>${r.max_days ? `<span class="pay-state vencido">${r.max_days} días</span>` : '<span class="muted">Al día</span>'}</td>
    <td>${escapeHtml(r.next_due || "—")}</td><td>${escapeHtml(r.last_payment || "—")}</td>
    <td class="row-actions">
      <button class="mini" data-action="pay-client-charges" data-id="${r.client_id}">Ver cobros</button>
      <button class="mini" data-action="pay-statement" data-id="${r.client_id}">Estado de cuenta</button>
      <button class="mini primary" data-action="new-receipt" data-client="${r.client_id}">Registrar pago</button>
    </td></tr>`).join("");
  await renderPayTab();
}

async function renderPayTab() {
  $$("[data-ptab]").forEach((b) => b.classList.toggle("active", b.dataset.ptab === payTab));
  $$("[data-ppanel]").forEach((p) => (p.hidden = p.dataset.ppanel !== payTab));
  const clientId = $("#pay-client").value;
  const q = clientId ? `clientId=${clientId}` : "";
  if (payTab === "cobros") {
    const list = await api("GET", `/payments/charges?${q}&state=${$("#pay-state").value}`);
    $("#pay-charges-empty").hidden = list.length > 0;
    $("#pay-charges").innerHTML = list.map((c) => `<tr class="${c.state === "anulado" ? "voided" : ""}">
      <td>${escapeHtml(c.client_name)}</td>
      <td>${escapeHtml(c.concept)}${c.plan_label ? `<br><span class="muted">${escapeHtml(c.plan_label)}</span>` : ""}${c.case_label ? `<br><span class="muted">${escapeHtml(c.case_label)}</span>` : ""}</td>
      <td>${escapeHtml(c.due_date)}</td>
      <td class="num">${cop(c.amount)}</td><td class="num">${c.state === "anulado" ? "—" : cop(c.balance)}</td>
      <td><span class="pay-state ${c.state}">${escapeHtml(c.state_label)}${c.days_overdue ? ` · ${c.days_overdue} d` : ""}</span>${c.last_reminder_at ? `<br><span class="muted">Recordado ${escapeHtml(c.last_reminder_at.slice(0, 10))}</span>` : ""}</td>
      <td class="row-actions">${c.balance > 0 ? `
        <button class="mini primary" data-action="new-receipt" data-client="${c.client_id}" data-charge="${c.id}">Registrar pago</button>
        <button class="mini" data-action="pay-remind" data-id="${c.id}">Recordar</button>` : ""}
        ${c.state !== "anulado" ? `<button class="mini" data-action="edit-charge" data-id="${c.id}">Editar</button>
        <button class="mini danger" data-action="void-charge" data-id="${c.id}">Anular</button>` : `<span class="muted">${escapeHtml(c.void_reason)}</span>`}
      </td></tr>`).join("");
    payChargesCache = list;
  } else if (payTab === "recibos") {
    const list = await api("GET", `/payments/receipts?${q}`);
    $("#pay-receipts-empty").hidden = list.length > 0;
    $("#pay-receipts").innerHTML = list.map((r) => `<tr class="${r.voided_at ? "voided" : ""}">
      <td class="mono">${receiptNo(r.number)}</td><td>${escapeHtml(r.paid_on)}</td><td>${escapeHtml(r.client_name)}</td>
      <td>${escapeHtml(r.concept)}${r.voided_at ? `<br><span class="muted">Anulado: ${escapeHtml(r.void_reason)}</span>` : ""}</td>
      <td>${escapeHtml(r.method)}${r.reference ? `<br><span class="muted">${escapeHtml(r.reference)}</span>` : ""}</td>
      <td class="num">${cop(r.amount)}</td>
      <td class="row-actions"><button class="mini" data-action="receipt-pdf" data-id="${r.id}">PDF</button>
        ${r.voided_at ? "" : `<button class="mini danger" data-action="void-receipt" data-id="${r.id}">Anular</button>`}</td></tr>`).join("");
    payReceiptsCache = list;
  } else if (payTab === "recordatorios") {
    const list = await api("GET", `/payments/reminders?${q}`);
    $("#pay-reminders-empty").hidden = list.length > 0;
    const CH = { email: "Correo", whatsapp: "WhatsApp", manual: "Enviado por el usuario" };
    $("#pay-reminders").innerHTML = list.map((x) => `<tr><td class="nowrap">${escapeHtml(x.sent_at.slice(0, 16))} UTC</td><td>${escapeHtml(x.client_name)}</td>
      <td>${escapeHtml(x.concept)}${x.plan_label ? ` · ${escapeHtml(x.plan_label)}` : ""}</td>
      <td>${CH[x.channel] || escapeHtml(x.channel)}${x.trigger === "auto" ? ' <span class="muted">(automático)</span>' : x.created_by_name ? `<br><span class="muted">${escapeHtml(x.created_by_name)}</span>` : ""}</td>
      <td>${x.ok ? '<span class="badge ok">Enviado</span>' : `<span class="badge bad">No enviado</span><br><span class="muted">${escapeHtml(x.detail)}</span>`}</td></tr>`).join("");
  }
}
let payChargesCache = [], payReceiptsCache = [];
const receiptNo = (n) => L.receiptLabel(n);

$("#pay-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-ptab]");
  if (b) { payTab = b.dataset.ptab; guarded(renderPayTab); }
});
$("#pay-client").addEventListener("change", () => guarded(renderPagos));
window.JuanmaCombo.searchSelect($("#pay-client"), { showEmpty: true, placeholder: "Todos los clientes · escriba para buscar" });
$("#pay-state").addEventListener("change", () => guarded(renderPayTab));

// ----- Charge dialog -----
const chargeForm = $("#charge-dialog form");
window.JuanmaCombo.searchSelect(chargeForm.elements.client_id);
async function fillClientSelect(select, selected) {
  if (!payClients.length) payClients = await api("GET", "/clients");
  if (!payClients.length) throw new Error("Primero cree un cliente.");
  select.innerHTML = payClients.map(clientOption).join("");
  // defaultSelected: openDialog resets the form, and the client chosen in Pagos must survive it.
  const opt = selected && [...select.options].find((o) => o.value === String(selected));
  if (opt) { opt.defaultSelected = true; select.value = opt.value; }
}
async function fillChargeCases(selected) {
  const cases = await api("GET", `/cases?clientId=${chargeForm.elements.client_id.value}`);
  chargeForm.elements.case_id.innerHTML = '<option value="">— Ninguno —</option>' + cases.map((k) =>
    `<option value="${k.id}">${escapeHtml(k.type_name)}${k.radicado ? " · " + escapeHtml(formatRadicado(k.radicado)) : k.title ? " · " + escapeHtml(k.title) : ""}</option>`).join("");
  chargeForm.elements.case_id.value = selected || "";
}
function chargePreview() {
  const f = chargeForm.elements;
  if (f.id.value) return ($("#charge-preview").textContent = "");
  const total = parseMoney(f.amount.value), n = Math.max(1, Number(f.installments.value) || 1);
  if (!total || !f.due_date.value) return ($("#charge-preview").textContent = "");
  const parts = L.splitAmount(total, n);
  const step = f.every.value === "quincenal" ? (i) => L.addDays(f.due_date.value, 15 * i) : f.every.value === "semanal" ? (i) => L.addDays(f.due_date.value, 7 * i) : (i) => L.addMonths(f.due_date.value, i);
  $("#charge-preview").textContent = n === 1 ? `Un pago de ${cop(total)} con vencimiento ${f.due_date.value}.`
    : `${n} cuotas: ${parts.slice(0, 4).map((p, i) => `${cop(p)} el ${step(i)}`).join("; ")}${n > 4 ? `; … última el ${step(n - 1)}` : ""}.`;
}
chargeForm.addEventListener("input", chargePreview);
chargeForm.elements.client_id.addEventListener("change", () => guarded(() => fillChargeCases()));

async function openChargeDialog(c = null, clientId = null, caseId = null) {
  const dlg = $("#charge-dialog");
  await fillClientSelect(chargeForm.elements.client_id, c?.client_id ?? clientId ?? $("#pay-client").value);
  openDialog(dlg, c ? "Editar cobro" : "Nuevo cobro o plan de cuotas", c ? { id: c.id, concept: c.concept, amount: cop(c.amount), due_date: c.due_date, pay_link: c.pay_link, notes: c.notes }
    : { due_date: localToday(), installments: 1 });
  chargeForm.elements.client_id.disabled = !!c;
  $("[data-plan]", dlg).hidden = !!c;
  $("[data-amount-label]", dlg).textContent = c ? "Valor *" : "Valor total *";
  $("[data-due-label]", dlg).textContent = c ? "Vencimiento *" : "Primer vencimiento *";
  await fillChargeCases(c?.case_id ?? caseId);
  chargeForm.elements.case_id.disabled = !!c;
  chargePreview();
}
wireDialog($("#charge-dialog"), async (form) => {
  const d = formData(form);
  if (d.id) await api("PUT", `/payments/charges/${d.id}`, { concept: d.concept, amount: parseMoney(d.amount), due_date: d.due_date, pay_link: d.pay_link, notes: d.notes });
  else {
    const out = await api("POST", "/payments/charges", { client_id: Number(form.elements.client_id.value), case_id: Number(d.case_id) || null, concept: d.concept,
      amount: parseMoney(d.amount), due_date: d.due_date, installments: Number(d.installments) || 1, every: d.every, pay_link: d.pay_link, notes: d.notes });
    toast(out.ids.length > 1 ? `Plan creado: ${out.ids.length} cuotas.` : "Cobro creado.");
  }
  payTab = "cobros";
  if (FICHAS[route().name]) await refreshView();
  else location.hash === "#pagos" ? await renderPagos() : (location.hash = "#pagos");
});

// ----- Receipt dialog -----
const receiptForm = $("#receipt-dialog form");
window.JuanmaCombo.searchSelect(receiptForm.elements.client_id);
let receiptCharges = [];
async function fillReceiptCharges(selected) {
  receiptCharges = await api("GET", `/payments/charges?clientId=${receiptForm.elements.client_id.value}&state=abiertos`);
  receiptForm.elements.charge_id.innerHTML = '<option value="">Abono a cuenta (se aplica a las cuotas más antiguas)</option>' + receiptCharges.map((c) =>
    `<option value="${c.id}">${escapeHtml(c.concept)}${c.plan_label ? " · " + escapeHtml(c.plan_label) : ""} — saldo ${cop(c.balance)} — vence ${c.due_date}</option>`).join("");
  receiptForm.elements.charge_id.value = selected || "";
  const c = receiptCharges.find((x) => x.id === Number(receiptForm.elements.charge_id.value));
  receiptForm.elements.amount.value = c ? cop(c.balance) : "";
}
receiptForm.elements.client_id.addEventListener("change", () => guarded(() => fillReceiptCharges()));
receiptForm.elements.charge_id.addEventListener("change", () => {
  const c = receiptCharges.find((x) => x.id === Number(receiptForm.elements.charge_id.value));
  if (c) receiptForm.elements.amount.value = cop(c.balance);
});
async function openReceiptDialog(clientId, chargeId) {
  payMeta ||= await api("GET", "/payments/meta");
  await fillClientSelect(receiptForm.elements.client_id, clientId || $("#pay-client").value);
  receiptForm.elements.method.innerHTML = payMeta.methods.map((m) => `<option>${escapeHtml(m)}</option>`).join("");
  openDialog($("#receipt-dialog"), "Recibo de caja", { paid_on: localToday(), method: "Transferencia" });
  await fillReceiptCharges(chargeId);
}
wireDialog($("#receipt-dialog"), async (form) => {
  const d = formData(form);
  const r = await api("POST", "/payments/receipts", { client_id: Number(d.client_id), charge_id: Number(d.charge_id) || null, amount: parseMoney(d.amount),
    method: d.method, reference: d.reference, paid_on: d.paid_on, concept: d.concept, notes: d.notes });
  toast(`Recibo ${receiptNo(r.number)} registrado.`);
  payTab = "recibos";
  if (FICHAS[route().name]) await refreshView();
  else location.hash === "#pagos" ? await renderPagos() : (location.hash = "#pagos");
  if (await ask({ title: `Recibo ${receiptNo(r.number)}`, message: "¿Descargar el recibo en PDF para entregarlo al cliente?", okLabel: "Descargar PDF" })) {
    const full = (await api("GET", `/payments/receipts?clientId=${r.client_id}`)).find((x) => x.id === r.id);
    await downloadReceipt(full);
  }
});

// ----- Reminder dialog -----
const remindForm = $("#remind-dialog form");
async function openRemindDialog(id) {
  const c = payChargesCache.find((x) => x.id === id) || (await api("GET", "/payments/charges?state=abiertos")).find((x) => x.id === id);
  paySettings = await api("GET", "/payments/settings");
  const msg = L.reminderMessage({ clientName: c.client_name, charge: c, firmName: paySettings.firm_name, payInfo: paySettings.pay_info, today: localToday() });
  openDialog($("#remind-dialog"), `Recordatorio · ${c.client_name}`, { charge_id: c.id, text: msg.text });
  const digits = String(c.client_phone || "").replace(/\D/g, "");
  const wa = $("#remind-wa");
  wa.hidden = !digits;
  wa.href = digits ? `https://wa.me/${digits.length === 10 ? "57" + digits : digits}?text=${encodeURIComponent(msg.text)}` : "#";
  $("[data-remind-email]").textContent = c.client_email || "(el cliente no tiene correo)";
  $("[data-remind-phone]").textContent = c.client_phone || "(sin teléfono)";
  remindForm.elements.email.checked = !!c.client_email;
  const ch = payMeta?.channels || {};
  const web = !!window.JuanmaBackend?.web;
  $$("#remind-dialog fieldset label").forEach((l) => (l.hidden = web));
  $('#remind-dialog button[value="save"]').hidden = web;
  $("#remind-note").textContent = web
    ? "Desde este enlace use “Abrir en WhatsApp” o “Copiar texto” y luego “Marcar como enviado”. El envío automático por correo y WhatsApp funciona con la app instalada."
    : [!ch.email && "El correo del servidor no está configurado.", !ch.whatsapp && "WhatsApp automático no está configurado; use “Abrir en WhatsApp”."].filter(Boolean).join(" ");
}
$("[data-remind-copy]").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(remindForm.elements.text.value); toast("Texto copiado."); }
  catch { remindForm.elements.text.select(); toast("Seleccione y copie el texto."); }
});
$("[data-remind-manual]").addEventListener("click", () => guarded(async () => {
  await api("POST", `/payments/charges/${remindForm.elements.charge_id.value}/remind`, { channels: ["manual"] });
  $("#remind-dialog").close();
  toast("Recordatorio registrado.");
  await renderPagos();
}));
wireDialog($("#remind-dialog"), async (form) => {
  const channels = ["email", "whatsapp"].filter((c) => form.elements[c].checked);
  if (!channels.length) throw new Error("Elija correo o WhatsApp, o use “Marcar como enviado”.");
  const out = await api("POST", `/payments/charges/${form.elements.charge_id.value}/remind`, { channels });
  const bad = out.results.filter((r) => !r.ok);
  toast(bad.length ? `No enviado: ${bad.map((r) => r.detail).join(" ")}` : "Recordatorio enviado.", !!bad.length);
  await renderPagos();
});

// ----- Settings -----
const paySetForm = $("#pay-settings-dialog form");
async function openPaySettings() {
  paySettings = await api("GET", "/payments/settings");
  openDialog($("#pay-settings-dialog"), "Ajustes de cobro", { firm_name: paySettings.firm_name, firm_nit: paySettings.firm_nit, pay_info: paySettings.pay_info,
    days_before: paySettings.days_before, repeat_days: paySettings.repeat_days, receipt_start: paySettings.receipt_next });
  $("#receipt-next-note").textContent = `El próximo recibo saldrá con el ${receiptNo(paySettings.receipt_next)}; los siguientes siguen en orden (consecutivo).`;
  paySetForm.elements.auto.checked = paySettings.auto;
  paySetForm.elements.ch_email.checked = paySettings.channels.includes("email");
  paySetForm.elements.ch_whatsapp.checked = paySettings.channels.includes("whatsapp");
  $("#pay-settings-note").textContent = (window.JuanmaBackend?.web ? "Los recordatorios automáticos se envían con la app instalada en el servidor; aquí quedan guardados los ajustes. " : "")
    + "Por la Ley 2300 de 2023 solo se envían de lunes a viernes de 7:00 a. m. a 7:00 p. m. y sábados de 8:00 a. m. a 3:00 p. m.; nunca domingos ni festivos.";
}
wireDialog($("#pay-settings-dialog"), async (form) => {
  const d = formData(form);
  await api("PUT", "/payments/settings", { firm_name: d.firm_name, firm_nit: d.firm_nit, pay_info: d.pay_info, auto: form.elements.auto.checked,
    days_before: Number(d.days_before), repeat_days: Number(d.repeat_days), receipt_start: Number(d.receipt_start),
    channels: ["email", "whatsapp"].filter((c) => form.elements["ch_" + c].checked) });
  toast("Ajustes guardados.");
});

// ----- PDFs: receipt and account statement -----
const pesosEnLetras = (n) => L.pesosEnLetras(n);

function pdfBase(title) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth(), M = 48;
  const s = paySettings || {};
  doc.setFillColor(0, 43, 106); doc.rect(0, 0, W, 6, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(0, 43, 106);
  doc.text(s.firm_name || "TEC Jurídicos", M, 46);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90, 90, 90);
  doc.text([s.firm_nit ? `NIT ${s.firm_nit}` : "", "Ibagué, Tolima"].filter(Boolean).join(" · "), M, 60);
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(16, 16, 16);
  doc.text(title, W - M, 46, { align: "right" });
  return { doc, W, M };
}

async function downloadReceipt(r) {
  paySettings ||= await api("GET", "/payments/settings");
  const { doc, W, M } = pdfBase(`RECIBO DE CAJA ${receiptNo(r.number)}`);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(`Fecha de pago: ${r.paid_on}`, W - M, 62, { align: "right" });
  const rows = [["Recibimos de", `${r.client_name}${r.client_doc ? " · " + r.client_doc : ""}`], ["La suma de", `${cop(r.amount)}`],
    ["En letras", pesosEnLetras(r.amount)], ["Por concepto de", r.concept], ["Medio de pago", r.method + (r.reference ? ` · Ref. ${r.reference}` : "")]];
  if (r.notes) rows.push(["Notas", r.notes]);
  doc.autoTable({ startY: 90, body: rows, theme: "grid", styles: { fontSize: 10.5, cellPadding: 7 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 130, fillColor: [238, 242, 247] } }, margin: { left: M, right: M } });
  let y = doc.lastAutoTable.finalY + 18;
  const charges = await api("GET", `/payments/charges?clientId=${r.client_id}&state=abiertos`);
  const balance = charges.reduce((a, c) => a + c.balance, 0);
  doc.setFontSize(10);
  doc.text(`Saldo pendiente del cliente a la fecha de emisión: ${cop(balance)}`, M, y);
  y += 70;
  doc.line(M, y, M + 220, y);
  doc.text(`Recibido por: ${r.created_by_name || me.name}`, M, y + 14);
  doc.setFontSize(8); doc.setTextColor(110, 110, 110);
  doc.text(`Emitido con TecjuridicosApp el ${new Date().toLocaleString("es-CO")}`, M, y + 40);
  if (r.voided_at) {
    doc.setTextColor(179, 38, 30); doc.setFontSize(54); doc.setFont("helvetica", "bold");
    doc.text("ANULADO", W / 2, 330, { align: "center", angle: 20 });
    doc.setFontSize(10); doc.text(`Motivo: ${r.void_reason}`, W / 2, 360, { align: "center" });
  }
  await saveFile(`${receiptNo(r.number)} ${safeName(r.client_name)}.pdf`, doc.output("blob"));
}

async function downloadStatement(clientId) {
  paySettings ||= await api("GET", "/payments/settings");
  const [charges, receipts] = await Promise.all([api("GET", `/payments/charges?clientId=${clientId}&state=`), api("GET", `/payments/receipts?clientId=${clientId}`)]);
  const cl = payClients.find((c) => c.id === clientId) || {};
  const { doc, M } = pdfBase("ESTADO DE CUENTA");
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(16, 16, 16);
  doc.text([`Cliente: ${cl.full_name || ""}${cl.id_number ? " · " + (cl.id_type || "") + " " + cl.id_number : ""}`, `Fecha de corte: ${localToday()}`], M, 92);
  const live = charges.filter((c) => c.state !== "anulado");
  doc.autoTable({ startY: 120, head: [["Concepto", "Vence", "Valor", "Pagado", "Saldo", "Estado"]],
    body: live.map((c) => [c.concept + (c.plan_label ? ` · ${c.plan_label}` : ""), c.due_date, cop(c.amount), cop(c.paid), cop(c.balance), c.state_label + (c.days_overdue ? ` (${c.days_overdue} d)` : "")]),
    foot: [["Total", "", cop(live.reduce((a, c) => a + c.amount, 0)), cop(live.reduce((a, c) => a + c.paid, 0)), cop(live.reduce((a, c) => a + c.balance, 0)), ""]],
    styles: { fontSize: 9 }, headStyles: { fillColor: [0, 43, 106] }, footStyles: { fillColor: [238, 242, 247], textColor: 16 },
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } }, margin: { left: M, right: M } });
  doc.autoTable({ startY: doc.lastAutoTable.finalY + 24, head: [["Recibo", "Fecha", "Concepto", "Medio", "Valor"]],
    body: receipts.filter((r) => !r.voided_at).map((r) => [receiptNo(r.number), r.paid_on, r.concept, r.method, cop(r.amount)]),
    styles: { fontSize: 9 }, headStyles: { fillColor: [2, 124, 198] }, columnStyles: { 4: { halign: "right" } }, margin: { left: M, right: M } });
  if (paySettings.pay_info) {
    const y = doc.lastAutoTable.finalY + 24;
    doc.setFontSize(9.5); doc.text(["Datos para el pago:", ...doc.splitTextToSize(paySettings.pay_info, 500)], M, y);
  }
  await saveFile(`Estado de cuenta ${safeName(cl.full_name || "cliente")}.pdf`, doc.output("blob"));
}

const PAY_ACTIONS = {
  "new-charge": (b) => openChargeDialog(null, Number(b.dataset.client) || null, Number(b.dataset.case) || null),
  "new-receipt": (b) => openReceiptDialog(Number(b.dataset.client) || null, Number(b.dataset.charge) || null),
  "pay-settings": () => openPaySettings(),
  "edit-charge": async (b) => openChargeDialog(payChargesCache.find((c) => c.id === Number(b.dataset.id))),
  "pay-remind": (b) => openRemindDialog(Number(b.dataset.id)),
  "pay-client-charges": async (b) => { $("#pay-client").value = b.dataset.id; payTab = "cobros"; await renderPagos(); },
  "pay-statement": (b) => downloadStatement(Number(b.dataset.id)),
  "receipt-pdf": (b) => downloadReceipt(payReceiptsCache.find((r) => r.id === Number(b.dataset.id))),
  "void-charge": async (b) => {
    const reason = await ask({ title: "Anular cobro", message: "El cobro deja de contar en la cartera. Escriba el motivo.", input: "", okLabel: "Anular", danger: true });
    if (!reason) return;
    await api("POST", `/payments/charges/${b.dataset.id}/void`, { reason });
    await renderPagos();
  },
  "void-receipt": async (b) => {
    const reason = await ask({ title: "Anular recibo", message: "El número del recibo se conserva y queda marcado como anulado. Escriba el motivo.", input: "", okLabel: "Anular", danger: true });
    if (!reason) return;
    await api("POST", `/payments/receipts/${b.dataset.id}/void`, { reason });
    await renderPagos();
  },
};
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-action]");
  if (b && PAY_ACTIONS[b.dataset.action]) guarded(() => PAY_ACTIONS[b.dataset.action](b));
});

const RENDER = {
  pagos: renderPagos,
  firmas: renderFirmas,
  correo: renderCorreo,
  agenda: renderAgenda,
  consulta: renderConsulta,
  radicados: renderRadicados,
  despachos: renderDespachos,
  reportes: renderReportes,
  usuarios: renderUsuarios,
  inicio: renderInicio,
  jurisprudencia: renderJurisprudencia,
  clientes: renderClientes,
  expedientes: renderExpedientes,
  borradores: renderBorradores,
  importar: renderImportar,
  configuracion: renderConfiguracion,
  bitacora: renderBitacora,
};

guarded(boot);
