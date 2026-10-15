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
  $('[data-action="change-password"]')?.remove();
  $('#user-dialog input[name="password"]')?.closest("label")?.remove();
}

// ---------- Shared state ----------
const state = { catalog: [], clients: [], cases: [], selectedClientId: null };

async function loadCatalog() { state.catalog = await api("GET", "/catalog"); }
async function loadClients(q = "") { state.clients = await api("GET", `/clients?q=${encodeURIComponent(q)}`); }
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
  borradores: "drafts.generate", jurisprudencia: "jurisprudence.use", reportes: "reports.view",
  importar: "import.run", configuracion: "catalog.manage", usuarios: "users.manage",
};

// Only Gerencia deletes (change 24); every delete button carries data-action="delete-…" or data-jact="delete-…".
const isGerencia = () => me?.role === "Gerencia";
const DELETE_PERMS = ["clients.delete", "cases.delete"];

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
  $("#tpl-manage-bar").hidden = !can("templates.manage");
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
  if ($("#login-form")) $("#login-form").hidden = !!status.setupNeeded;
  $("#setup-form").hidden = !status.setupNeeded;
  // Microsoft 365 sign-in (installed app with MS_* settings).
  $("#ms-login").hidden = !(status.microsoft ?? authInfo.microsoft);
  $("[data-ms-label]").textContent = status.setupNeeded ? "Crear la cuenta de Gerencia con Microsoft" : "Ingresar con la cuenta de Microsoft";
  const msError = new URLSearchParams(location.search).get("ms_error");
  $("#ms-error").hidden = !msError;
  $("#ms-error").textContent = msError || "";
  if (msError) history.replaceState(null, "", location.pathname + location.hash);
  const demo = backend.demoUsers?.();
  $("#demo-logins").hidden = !demo?.length || !!status.setupNeeded;
  if (demo) {
    $("#demo-logins .demo-grid").innerHTML = demo.map((u) =>
      `<button type="button" data-demo-login="${escapeHtml(u.email)}"><strong>${escapeHtml(u.role)}</strong><span>${escapeHtml(u.name)} · ${escapeHtml(u.office)}</span></button>`).join("");
  }
}

async function enterApp(user, { fresh = true } = {}) {
  me = user;
  // A new sign-in starts on Inicio; a page reload keeps the current section.
  if (fresh) history.replaceState(null, "", "#inicio");
  await loadSessionData();
  $("#auth-screen").hidden = true;
  $("#app-root").hidden = false;
  applyPermissions();
  window.JuanmaCombo.wirePlaces(document);
  await Promise.all([loadCatalog(), loadAreas()]);
  startBell();
  await showView();
}

let authInfo = {};
async function boot() {
  const st = await api("GET", "/auth/status");
  authInfo = st;
  // Which numbered change of the project is running (see CAMBIOS.md).
  const v = st.version || {};
  const label = v.change ? `Cambio ${v.change}${v.date ? " · " + v.date.split("-").reverse().join("/") : ""}` : "";
  $$("[data-version]").forEach((el) => { el.textContent = label; el.title = v.sha ? `Versión ${v.sha}` : ""; });
  if (st.user) await enterApp(st.user, { fresh: false });
  else showAuth(st);
}

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

let AREAS = [];
async function loadAreas() {
  const meta = await api("GET", "/courts/meta");
  AREAS = meta.areas;
  const opts = AREAS.map((a) => `<option>${escapeHtml(a)}</option>`).join("");
  $("#courts-area").innerHTML = '<option value="">Todas</option>' + opts;
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
function ask({ title, message = "", input = null, okLabel = "Aceptar", danger = false }) {
  const dlg = $("#ask-dialog");
  const field = dlg.querySelector("[name=text]");
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
      resolve(input === null ? true : field.value.trim() || null);
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
const VIEWS = ["inicio", "clientes", "expedientes", "agenda", "consulta", "despachos", "borradores", "firmas", "pagos", "correo", "jurisprudencia", "reportes", "importar", "configuracion", "usuarios"];
function showView() {
  if (!me) return;
  let name = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "inicio";
  if (VIEW_PERMS[name] && !can(VIEW_PERMS[name])) name = "inicio";
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== name;
  $$(".sidenav a").forEach((a) => a.classList.toggle("active", a.dataset.view === name));
  RENDER[name]();
}
window.addEventListener("hashchange", () => guarded(showView));

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

function caseCard(k) {
  return `<li class="case-card">
    <div>${caseFolder(k) ? `<span class="folder-tag">Carpeta ${escapeHtml(caseFolder(k))}</span> ` : ""}<span class="pill">${escapeHtml(k.category_name)}</span> <span class="status-tag">${escapeHtml(k.status)}</span></div>
    ${partyLine(k) ? `<span class="muted">Cliente: ${escapeHtml(partyLine(k))}</span>` : ""}
    <strong>${escapeHtml(k.type_name)}</strong>
    ${k.title ? `<span>${escapeHtml(k.title)}</span>` : ""}
    <span>${escapeHtml(k.office_name || "")}${k.assigned_name ? " · " + escapeHtml(k.assigned_name) : " · Sin responsable"}</span>
    ${k.court_name ? `<span class="court-line">${escapeHtml(k.court_name)}${k.radicado ? " · " + escapeHtml(formatRadicado(k.radicado)) : ""}</span>` : ""}
    <div class="toolbar">
      ${can("cases.write") ? `<button data-action="edit-case" data-id="${k.id}">Editar</button><button data-action="new-task" data-case="${k.id}">+ Tarea</button>` : ""}
      ${can("mail.send") ? `<button data-action="mail-case" data-case="${k.id}">Correo</button>` : ""}
      ${can("drafts.generate") ? `<button class="primary" data-action="draft-case" data-id="${k.id}">Generar borrador</button>` : ""}
    </div>
  </li>`;
}

async function renderClientes() {
  await Promise.all([loadClients($("#client-search").value), loadCatalog()]);
  renderClientList();
  await renderClientDetail();
}

$("#client-search").addEventListener("input", () => guarded(async () => {
  await loadClients($("#client-search").value);
  renderClientList();
}));

$("#client-list").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-client]");
  if (!btn) return;
  state.selectedClientId = Number(btn.dataset.client);
  renderClientList();
  guarded(renderClientDetail);
});

// ---------- Dialog helpers ----------
function openDialog(dialog, title, values = {}) {
  const form = $("form", dialog);
  form.reset();
  $("[data-title]", dialog).textContent = title;
  $(".form-error", dialog).hidden = true;
  for (const [k, v] of Object.entries(values)) if (form.elements[k] && v != null) form.elements[k].value = v;
  dialog.showModal();
}

// Dialog forms close on submit by default; keep them open until the save succeeds.
function wireDialog(dialog, onSave) {
  const form = $("form", dialog);
  form.addEventListener("submit", async (e) => {
    if (e.submitter?.value === "cancel") return;
    e.preventDefault();
    try {
      await onSave(form);
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
// Names in proper case as soon as the user leaves the field (JoHN → John).
clientForm.addEventListener("focusout", (e) => {
  if (["first_names", "last_names", "legal_rep"].includes(e.target.name)) e.target.value = window.JuanmaPerson.properName(e.target.value);
});

function openClientDialog(c) {
  const sel = $("#client-dialog [name=office_id]");
  sel.innerHTML = myOffices().map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join("");
  const type = c?.person_type || "natural";
  openDialog($("#client-dialog"), c ? "Editar cliente" : "Nuevo cliente", c ? {
    ...c, business_name: type === "juridica" ? c.full_name : "", nit: type === "juridica" ? c.id_number : "",
    id_number: type === "natural" ? c.id_number : "",
  } : {});
  setPersonType(type);
  sel.value = c?.office_id ?? myOffices()[0]?.id ?? "";
}

wireDialog($("#client-dialog"), async (form) => {
  const { id, business_name, nit, ...data } = formData(form);
  if (data.person_type === "juridica") Object.assign(data, { full_name: business_name, id_number: nit, id_type: "NIT", first_names: "", last_names: "" });
  const saved = id ? await api("PUT", `/clients/${id}`, data) : await api("POST", "/clients", data);
  state.selectedClientId = saved.id;
  toast(id ? "Cliente actualizado." : "Cliente creado.");
  location.hash === "#clientes" ? await renderClientes() : (location.hash = "#clientes");
});

// ---------- Expedientes ----------
function fillCaseFilter() {
  const sel = $("#case-filter");
  const cur = sel.value;
  sel.innerHTML = '<option value="">Todos los tipos de proceso</option>' +
    state.catalog.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  sel.value = cur;
}

function renderCaseRows() {
  const catId = Number($("#case-filter").value) || null;
  const officeId = Number($("#case-office-filter").value) || null;
  const mine = $("#case-mine").checked;
  const flat = (x) => String(x ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const q = flat($("#case-search").value.trim());
  const qDigits = q.replace(/\D/g, "");
  const matches = (k) => !q || [caseFolder(k), k.client_name, k.title, k.type_name].some((x) => flat(x).includes(q))
    || (qDigits.length >= 4 && String(k.radicado || "").replace(/\D/g, "").includes(qDigits));
  const rows = state.cases.filter((k) => (!catId || k.category_id === catId) && (!officeId || k.office_id === officeId)
    && (!mine || k.assigned_user_id === me.id) && matches(k));
  $("#case-empty").hidden = rows.length > 0;
  $("#case-rows").innerHTML = rows.map((k) => `
    <tr>
      <td>${caseFolder(k) ? `<span class="folder-tag">${escapeHtml(caseFolder(k))}</span>` : '<span class="muted">—</span>'}</td>
      <td>${escapeHtml(k.client_name)}${partyLine(k) ? `<br><span class="muted">${escapeHtml(partyLine(k))}</span>` : ""}</td>
      <td><span class="pill">${escapeHtml(k.category_name)}</span><br>${escapeHtml(k.type_name)}</td>
      <td>${escapeHtml(k.title)}${k.court_name ? `<br><span class="muted">${escapeHtml(k.court_name)}</span>` : ""}${k.radicado ? `<br><span class="mono">${escapeHtml(formatRadicado(k.radicado))}</span>` : ""}</td>
      <td>${escapeHtml(k.office_name || "")}<br><span class="muted">${escapeHtml(k.assigned_name || "Sin responsable")}</span></td>
      <td><span class="status-tag">${escapeHtml(k.status)}</span></td>
      <td class="row-actions">
        ${can("cases.write") ? `<button data-action="edit-case" data-id="${k.id}">Editar</button>` : ""}
        ${can("cases.write") ? `<button data-action="new-task" data-case="${k.id}">+ Tarea</button>` : ""}
        ${can("drafts.generate") ? `<button class="primary" data-action="draft-case" data-id="${k.id}">Borrador</button>` : ""}
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
  renderCaseRows();
}
$("#case-filter").addEventListener("change", renderCaseRows);
$("#case-office-filter").addEventListener("change", renderCaseRows);
$("#case-mine").addEventListener("change", renderCaseRows);
$("#case-search").addEventListener("input", renderCaseRows);

const caseForm = $("#case-dialog form");

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
function fillRoleSelect(selected = caseForm.elements.client_role.value) {
  const cat = categoryOf(caseForm.elements.category_id.value);
  const type = cat?.types.find((t) => t.id === Number(caseForm.elements.process_type_id.value));
  const roles = window.JuanmaCaseMeta.partyRolesFor(cat?.name || "", type?.path || type?.name || "");
  const opts = selected && !roles.includes(selected) ? [...roles, selected] : roles;
  caseForm.elements.client_role.innerHTML = '<option value="">— Sin indicar —</option>' + opts.map((r) => `<option>${escapeHtml(r)}</option>`).join("");
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
caseForm.elements.process_type_id.addEventListener("change", () => fillRoleSelect());

// Responsible people: users of the chosen office, plus roles that see every office.
function fillAssignees(officeId, selected) {
  const sel = caseForm.elements.assigned_user_id;
  const people = directory.filter((u) => u.offices.some((o) => o.id === Number(officeId)) || u.scopeAll);
  sel.innerHTML = '<option value="">— Sin asignar —</option>' +
    people.map((u) => `<option value="${u.id}">${escapeHtml(u.name)} · ${escapeHtml(u.role)}</option>`).join("");
  sel.value = selected && people.some((u) => u.id === selected) ? String(selected) : "";
}
caseForm.elements.office_id.addEventListener("change", (e) => fillAssignees(e.target.value, Number(caseForm.elements.assigned_user_id.value)));

const formatRadicado = (r) => (/^\d{23}$/.test(r) ? `${r.slice(0, 5)}-${r.slice(5, 7)}-${r.slice(7, 9)}-${r.slice(9, 12)}-${r.slice(12, 16)}-${r.slice(16, 21)}-${r.slice(21)}` : r);

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
  limit: 30, emptyText: "Sin despachos para este filtro. Cargue el directorio oficial en Despachos.",
  items: async () => (await courtsFor(caseForm.elements.department.value, caseForm.elements.city.value, caseForm.elements.area.value))
    .map((c) => ({ label: c.name, sub: [c.area, c.city, c.email].filter(Boolean).join(" · "), court: c })),
  onPick: (it) => {
    caseForm.elements.court_id.value = it.court.id;
    if (!caseForm.elements.area.value) caseForm.elements.area.value = it.court.area;
    if (!caseForm.elements.department.value) caseForm.elements.department.value = it.court.department;
    if (!caseForm.elements.city.value) caseForm.elements.city.value = it.court.city;
    showCourtEmail(it.court);
  },
  onType: () => { caseForm.elements.court_id.value = ""; showCourtEmail(null); },
});
caseForm.elements.radicado.addEventListener("input", async (e) => {
  const digits = e.target.value.replace(/\D/g, "");
  if (digits.length >= 5 && !caseForm.elements.department.value) {
    const place = await window.JuanmaCombo.placeFromRadicado(digits);
    if (place) { caseForm.elements.department.value = place.department; caseForm.elements.city.value = place.city; }
  }
});

async function openCaseDialog(k = null, clientId = null) {
  await Promise.all([loadCatalog(), loadClients()]);
  if (!state.clients.length) {
    toast("Primero cree un cliente.", true);
    location.hash = "#clientes";
    return;
  }
  caseForm.elements.client_id.innerHTML = state.clients
    .map((c) => `<option value="${c.id}">${escapeHtml(c.full_name)}</option>`).join("");
  caseForm.elements.category_id.innerHTML = state.catalog
    .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");

  openDialog($("#case-dialog"), k ? `Editar expediente${caseFolder(k) ? ` · Carpeta ${caseFolder(k)}` : ""}` : "Nuevo expediente", k ? {
    id: k.id, title: k.title, status: k.status, counterparty: k.counterparty, facts: k.facts,
    radicado: k.radicado ? formatRadicado(k.radicado) : "", department: k.department, city: k.city, area: k.area,
    court_search: k.court_name, court_id: k.court_id ?? "", affiliated: k.affiliated ? "1" : "0",
  } : { affiliated: "0" });
  caseForm.elements.client_role.innerHTML = "";
  caseForm.elements.monitor.checked = k ? !!k.monitor || !k.radicado : true;
  showCourtEmail(k?.court_name ? { email: k.court_email } : null);
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
    court_id: Number(d.court_id) || null, court_name: Number(d.court_id) ? undefined : d.court_search, monitor: form.elements.monitor.checked,
  };
  if (d.id) await api("PUT", `/cases/${d.id}`, body);
  else await api("POST", "/cases", body);
  toast(d.id ? "Expediente actualizado." : "Expediente creado.");
  await RENDER[location.hash.slice(1) || "inicio"]?.();
});

// ---------- Configuración ----------
const FIELD_TYPE_LABELS = { text: "Texto", textarea: "Texto largo", number: "Número", date: "Fecha", select: "Lista" };

async function renderConfiguracion() {
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
    "change-password": () => {
      $(".user-menu").open = false;
      openDialog($("#password-dialog"), "Cambiar contraseña");
    },
    "new-sign": () => openSignDialog({}),
    "open-sign": () => openSignDetail(id),
    "new-mail": () => openMailDialog({}),
    "mail-case": () => openMailDialog({ caseId: Number(btn.dataset.case) }),
    "mail-court": () => openMailDialog({ to: btn.dataset.to }),
    "mail-proof": async () => {
      const m = mailList.find((x) => x.id === id);
      await saveFile(`Constancia de envio - ${safeName(m.subject)}.pdf`, mailProof(m));
    },
    "new-task": () => openTaskDialog(null, btn.dataset.case ? Number(btn.dataset.case) : null),
    "edit-task": () => openTaskDialog(agendaCache.find((t) => t.id === id)),
    "task-done": async () => { await api("PUT", `/tasks/${id}`, { status: "hecha" }); toast("Marcada como hecha."); await renderAgenda(); },
    "delete-task": async () => {
      if (!(await confirmAsk("Eliminar", "Se eliminará esta tarea o audiencia."))) return;
      await api("DELETE", `/tasks/${id}`);
      await renderAgenda();
    },
    "read-all": async () => { await api("POST", "/notifications/read", {}); await refreshBell(); },
    "view-acts": () => showActuaciones(id),
    "add-radicado": () => openCaseDialog(null, null),
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
    "new-office": () => openOfficeDialog(null),
    "edit-office": () => openOfficeDialog(offices.find((o) => o.id === id)),
    "delete-office": async () => {
      if (!(await confirmAsk("Eliminar oficina", "Solo se puede eliminar una oficina sin clientes ni expedientes."))) return;
      await api("DELETE", `/admin/offices/${id}`);
      toast("Oficina eliminada.");
      await renderUsuarios();
    },
    "new-client": () => openClientDialog(null),
    "edit-client": () => openClientDialog(state.clients.find((c) => c.id === id)),
    "delete-client": async () => {
      const c = state.clients.find((x) => x.id === id);
      if (!(await confirmAsk("¿Eliminar cliente?", `Se eliminará el cliente ${c ? `“${c.full_name}”` : ""}. Esta acción no se puede deshacer.`))) return;
      await api("DELETE", `/clients/${id}`);
      state.selectedClientId = null;
      toast("Cliente eliminado.");
      await renderClientes();
    },
    "new-case": () => openCaseDialog(null, btn.dataset.client ? Number(btn.dataset.client) : state.selectedClientId),
    "edit-case": async () => openCaseDialog(await api("GET", `/cases/${id}`)),
    "delete-case": async () => {
      const k = state.cases.find((x) => x.id === id);
      const which = k ? [caseFolder(k) && `carpeta ${caseFolder(k)}`, k.client_name, k.type_name].filter(Boolean).join(" · ") : "";
      if (!(await confirmAsk("¿Eliminar expediente?", `Se eliminará el expediente${which ? ` (${which})` : ""} con sus datos. Esta acción no se puede deshacer.`))) return;
      await api("DELETE", `/cases/${id}`);
      toast("Expediente eliminado.");
      await renderExpedientes();
    },
    "draft-case": () => {
      pendingDraftCase = id;
      $("#tpl-case").value = String(id);
      location.hash === "#borradores" ? renderBorradores() : (location.hash = "#borradores");
    },
    "new-template": () => openTemplateDialog(null),
    "edit-template": async () => openTemplateDialog(await api("GET", `/templates/${id}`)),
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

function renderMarkdown(md) {
  const html = DOMPurify.sanitize(marked.parse(md));
  return html.replace(/\[FILL:\s*([^\]]+)\]/g, '<mark class="fill">[FILL: $1]</mark>');
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
  } else if (action === "pdf") {
    await saveFile(`${(lastResult.payload?.document_type || "borrador").toLowerCase()}.pdf`, markdownToPdf(lastResult.document));
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
$(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-jtab]");
  if (b) showJTab(b.dataset.jtab);
});

async function renderJurisprudencia() {}

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

jSearch.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("button", jSearch);
  btn.disabled = true;
  $("#j-results").innerHTML = "";
  setBox("#j-search-status", "Buscando en las relatorías oficiales… puede tardar un minuto.");
  try {
    const out = await api("POST", "/jurisprudencia/search", formData(jSearch));
    jResults = out.results || [];
    setBox("#j-search-status", jResults.length ? (out.notes || "") : `Sin resultados. ${out.notes || ""}`);
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
  setBox("#j-analyze-status", body.text ? "NomosAI está leyendo el texto pegado…" : "Leyendo la sentencia en la fuente oficial…");
  $("button", jAnalyze).disabled = true;
  try {
    jAnalysis = await api("POST", "/jurisprudencia/analyze", body);
    setBox("#j-analyze-status", "");
    renderAnalysis(jAnalysis);
  } catch (err) {
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
function markdownToPdf(md, { returnDoc = false } = {}) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 64, width = doc.internal.pageSize.getWidth() - margin * 2, bottom = doc.internal.pageSize.getHeight() - margin;
  let y = margin;
  const write = (text, { size = 11, bold = false, gap = 6, indent = 0 } = {}) => {
    doc.setFont("times", bold ? "bold" : "normal");
    doc.setFontSize(size);
    for (const line of doc.splitTextToSize(text, width - indent)) {
      if (y > bottom) { doc.addPage(); y = margin; }
      doc.text(line, margin + indent, y);
      y += size * 1.35;
    }
    y += gap;
  };
  const clean = (t) => t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/`([^`]+)`/g, "$1");
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { y += 4; continue; }
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) write(clean(m[2]), { size: [16, 13, 12][m[1].length - 1], bold: true, gap: 8 });
    else if ((m = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/))) write("• " + clean(m[1]), { indent: 14, gap: 2 });
    else if (/^\|/.test(line)) { if (!/^\|\s*-/.test(line)) write(clean(line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).join("   ")), { gap: 2 }); }
    else if (/^---+$/.test(line)) { doc.line(margin, y, margin + width, y); y += 12; }
    else if (/^>\s?/.test(line)) write(clean(line.replace(/^>\s?/, "")), { indent: 14, gap: 4 });
    else write(clean(line));
  }
  return returnDoc ? doc : doc.output("blob");
}

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

async function renderUsuarios() {
  [adminUsers, offices, roleInfo] = await Promise.all([api("GET", "/admin/users"), api("GET", "/admin/offices"), api("GET", "/admin/roles")]);
  directory = await api("GET", "/admin/users/directory");
  $("#user-rows").innerHTML = adminUsers.map((u) => `
    <tr class="${u.active ? "" : "inactive"}">
      <td><strong>${escapeHtml(u.name)}</strong><br><span class="muted">${escapeHtml(u.email)}</span></td>
      <td>${escapeHtml(u.role)}${u.custom_permissions ? '<br><span class="badge warn">Permisos propios</span>' : ""}</td>
      <td>${u.permissions.includes("scope.all") ? "Todas" : escapeHtml(u.offices.map((o) => o.name).join(", "))}</td>
      <td>${u.active ? '<span class="badge ok">Activo</span>' : '<span class="badge">Inactivo</span>'}</td>
      <td class="row-actions"><button data-action="edit-user" data-id="${u.id}">Editar</button></td>
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
      const onlyGerencia = DELETE_PERMS.includes(p);
      const locked = (r === "Gerencia" && p === "users.manage") || onlyGerencia;
      const on = onlyGerencia ? r === "Gerencia" : roleInfo.matrix[r].includes(p);
      return `<td class="center"><input type="checkbox" data-role="${escapeHtml(r)}" data-perm="${p}" aria-label="${escapeHtml(r)}: ${escapeHtml(label)}"
        ${on ? "checked" : ""} ${locked ? "disabled" : ""}></td>`;
    }).join("")}</tr>`).join("")}</tbody>`;
}

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
  if (form.elements.password) form.elements.password.required = !u && !authInfo.microsoft;
  if ($("[data-pw-label]", dlg)) $("[data-pw-label]", dlg).textContent = u ? "Nueva contraseña (opcional)"
    : authInfo.microsoft ? "Contraseña inicial (opcional: sin contraseña ingresa solo con su cuenta de Microsoft)" : "Contraseña inicial *";
}

// Per-user checklist: shows the role's permissions until "específicos" is on.
function renderUserPerms(checked) {
  const form = $("#user-dialog form");
  const custom = form.elements.custom_permissions.checked;
  $("#user-perm-checks").innerHTML = Object.entries(roleInfo.permissions).map(([p, label]) => `
    <label class="inline"><input type="checkbox" name="perm" value="${p}" ${checked.includes(p) ? "checked" : ""} ${custom ? "" : "disabled"} /> ${escapeHtml(label)}</label>`).join("");
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
  if (d.id) await api("PUT", `/admin/users/${d.id}`, body);
  else await api("POST", "/admin/users", body);
  toast(d.id ? "Usuario actualizado." : "Usuario creado.");
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
      ${can("templates.manage") ? `<span class="tpl-tools">${t.format === "markdown" ? `<button class="mini" data-action="edit-template" data-id="${t.id}">Editar</button>` : ""}
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
  $("#tpl-edit-mode").checked = false;
  $("#tpl-text").hidden = true;
  renderTplList();
  await loadTplData();
}

async function loadTplData() {
  const caseId = $("#tpl-case").value;
  tplData = await api("GET", `/templates/data${caseId ? `?caseId=${caseId}` : ""}`);
  renderTplVars();
  renderTplDoc();
}
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

const tplFileBase = () => (tplActive.name + (tplData["cliente.nombre"] ? " - " + tplData["cliente.nombre"] : ""))
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w .-]+/g, "").replace(/\s+/g, " ").trim().slice(0, 90) || "documento";
const currentText = () => ($("#tpl-edit-mode").checked ? $("#tpl-text").value : filledText());

$("#tpl-active .actions").addEventListener("click", (e) => {
  const action = e.target.closest("[data-tpl-out]")?.dataset.tplOut;
  if (!action) return;
  guarded(async () => {
    if (action === "docx") {
      const blob = tplActive.format === "docx" ? D.fillDocx(tplActive.bytes, tplValues()) : D.markdownToDocx(currentText(), tplActive.name);
      await saveFile(`${tplFileBase()}.docx`, blob);
    } else if (action === "pdf") {
      await saveFile(`${tplFileBase()}.pdf`, markdownToPdf(currentText()));
    } else if (action === "copy") {
      try { await navigator.clipboard.writeText(currentText()); toast("Texto copiado."); }
      catch { toast("No se pudo copiar; active “Editar el texto” y cópielo desde allí.", true); }
    } else if (action === "sign") {
      await openSignDialog({ title: tplActive.name, text: currentText(), caseId: Number($("#tpl-case").value) || null });
    } else if (action === "mail") {
      const blob = tplActive.format === "docx" ? D.fillDocx(tplActive.bytes, tplValues()) : D.markdownToDocx(currentText(), tplActive.name);
      await openMailDialog({ caseId: Number($("#tpl-case").value) || null, subject: tplActive.name,
        files: [new File([blob], `${tplFileBase()}.docx`, { type: blob.type })] });
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
}));
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
function signerRow(v = {}) {
  const div = document.createElement("div");
  div.className = "signer-row";
  div.innerHTML = `<input data-k="name" placeholder="Nombre completo" value="${escapeHtml(v.name || "")}" aria-label="Nombre del firmante" />
    <input data-k="id_number" placeholder="Documento" value="${escapeHtml(v.id_number || "")}" aria-label="Documento del firmante" />
    <input data-k="email" type="email" placeholder="Correo" value="${escapeHtml(v.email || "")}" aria-label="Correo del firmante" />
    <button type="button" class="mini danger" data-rm aria-label="Quitar firmante">✕</button>`;
  return div;
}
$("#add-signer").addEventListener("click", () => $("#signer-rows").append(signerRow()));
$("#signer-rows").addEventListener("click", (e) => { if (e.target.closest("[data-rm]")) e.target.closest(".signer-row").remove(); });
signForm.addEventListener("change", (e) => {
  if (e.target.name === "source") {
    const pdf = e.target.value === "pdf";
    signForm.elements.doc_text.hidden = pdf;
    signForm.elements.pdf.hidden = !pdf;
  }
});

async function openSignDialog({ title = "", text = "", caseId = null } = {}) {
  const cases = await api("GET", "/cases");
  signForm.elements.case_id.innerHTML = '<option value="">— Ninguno —</option>' + cases.map((k) =>
    `<option value="${k.id}">${escapeHtml(k.client_name)} · ${escapeHtml(k.type_name)}</option>`).join("");
  openDialog($("#sign-dialog"), "Enviar documento a firma", { title, doc_text: text, case_id: caseId ?? "" });
  signForm.elements.source.value = "text";
  signForm.elements.doc_text.hidden = false;
  signForm.elements.pdf.hidden = true;
  $("#signer-rows").innerHTML = "";
  // The case's client is the usual first signer.
  const k = cases.find((x) => x.id === caseId);
  const c = k && (await api("GET", `/clients/${k.client_id}`).catch(() => null));
  $("#signer-rows").append(signerRow(c ? { name: c.full_name, id_number: c.id_number, email: c.email } : {}));
  if (window.JuanmaBackend?.esignRemote === false) signForm.elements.mode.value = "presencial";
}

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1]);
  r.onerror = () => reject(new Error("No se pudo leer el archivo."));
  r.readAsDataURL(file);
});

wireDialog($("#sign-dialog"), async (form) => {
  const signers = $$("#signer-rows .signer-row").map((row) => Object.fromEntries($$("input", row).map((i) => [i.dataset.k, i.value.trim()])))
    .filter((x) => x.name || x.email);
  const body = { title: form.elements.title.value, case_id: Number(form.elements.case_id.value) || null, signers,
    message: form.elements.message.value, mode: form.elements.mode.value };
  if (form.elements.source.value === "pdf") {
    const f = form.elements.pdf.files[0];
    if (!f) throw new Error("Elija el archivo PDF.");
    body.doc_pdf_base64 = await fileToBase64(f);
    body.doc_name = f.name;
  } else body.doc_text = form.elements.doc_text.value;
  const r = await api("POST", "/esign", body);
  const failed = (r.delivery || []).filter((d) => !d.ok);
  toast(failed.length ? `Solicitud creada, pero ${failed.length} enlace(s) no se enviaron: ${failed[0].detail}` : body.mode === "presencial" ? "Solicitud creada. Abra “Ver” para firmar en persona." : "Enlaces de firma enviados.", !!failed.length);
  location.hash === "#firmas" ? await renderFirmas() : (location.hash = "#firmas");
});

async function openSignDetail(id) {
  signCurrent = await api("GET", `/esign/${id}`);
  const r = signCurrent;
  const dlg = $("#sign-detail");
  $("[data-title]", dlg).textContent = r.title;
  $("[data-sub]", dlg).textContent = `${SIGN_STATUS[r.status][1]} · Huella del documento (SHA-256): ${r.doc_hash}`;
  $("#sign-detail-body").innerHTML = `
    <ul class="signer-list">${r.signers.map((x) => `<li>
      <div><strong>${escapeHtml(x.name)}</strong> <span class="muted">${escapeHtml([x.id_type + " " + x.id_number, x.email].filter((v) => v.trim()).join(" · "))}</span></div>
      <div>${x.status === "firmado" ? `<span class="badge ok">Firmó ${escapeHtml(x.signed_at)} UTC · ${x.method === "presencial" ? "en persona" : "enlace + código"}</span>
        <img class="sig-img" src="${escapeHtml(x.signature_png)}" alt="Firma de ${escapeHtml(x.name)}" />`
        : x.status === "rechazado" ? `<span class="badge bad">No firmó: ${escapeHtml(x.reject_reason || "")}</span>`
        : `<span class="badge warn">Pendiente</span>${r.status === "enviada" ? `
          ${x.email && window.JuanmaBackend?.esignRemote !== false ? `<button type="button" class="mini" data-sign-remind="${x.id}">Reenviar enlace</button>` : ""}
          <button type="button" class="mini" data-sign-inperson="${x.id}">Firmar en persona</button>` : ""}`}</div>
    </li>`).join("")}</ul>
    <details><summary>Registro de eventos (${r.events.length})</summary>
      <table class="data-table"><tbody>${r.events.map((e) => `<tr><td class="nowrap">${escapeHtml(e.at)} UTC</td><td>${escapeHtml(e.event.replace(/_/g, " "))}</td><td>${escapeHtml(e.detail)}</td><td class="muted">${escapeHtml(e.ip)}</td></tr>`).join("")}</tbody></table>
    </details>`;
  $('[data-sign-out="cancel"]', dlg).hidden = r.status !== "enviada";
  $('[data-sign-out="doc"]', dlg).hidden = r.status !== "completada";
  if (!dlg.open) dlg.showModal();
}

$("#sign-detail").addEventListener("click", (e) => {
  const remind = e.target.closest("[data-sign-remind]");
  const inperson = e.target.closest("[data-sign-inperson]");
  const out = e.target.closest("[data-sign-out]")?.dataset.signOut;
  guarded(async () => {
    if (remind) {
      const d = await api("POST", `/esign/${signCurrent.id}/remind/${remind.dataset.signRemind}`);
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
    } else if (out === "doc") {
      if (signCurrent.doc_kind === "pdf") {
        const f = await api("GET", `/esign/${signCurrent.id}/pdf`);
        await saveFile(signCurrent.doc_name || `${safeName(signCurrent.title)}.pdf`, new Blob([D.b64ToBytes(f.base64)], { type: "application/pdf" }));
        toast("El PDF original va junto con el certificado: la huella SHA-256 del certificado prueba que no cambió.");
      } else {
        await saveFile(`${safeName(signCurrent.title)} - firmado.pdf`, signedDocumentPdf(signCurrent));
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

// Certificate: document identity + each signature's evidence + audit trail.
function signatureCertificate(r) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48;
  let y = M;
  const line = (t, { size = 10, bold = false, color = [16, 16, 16], gap = 4 } = {}) => {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(...color);
    for (const l of doc.splitTextToSize(String(t), W - 2 * M)) { if (y > H - M) { doc.addPage(); y = M; } doc.text(l, M, y); y += size * 1.35; }
    y += gap;
  };
  line("CERTIFICADO DE FIRMA ELECTRÓNICA", { size: 16, bold: true, color: [0, 43, 106] });
  line(`Documento: ${r.title}`, { size: 11, bold: true });
  line(`Estado: ${SIGN_STATUS[r.status][1]}${r.completed_at ? ` · completado ${r.completed_at} UTC` : ""}`);
  line(`Huella del documento (SHA-256): ${r.doc_hash}`, { size: 9 });
  line("La huella identifica el contenido exacto que se firmó: cualquier cambio en el documento produce una huella distinta.", { size: 8, color: [90, 90, 90], gap: 10 });
  for (const x of r.signers) {
    if (y > H - 190) { doc.addPage(); y = M; }
    line(`${x.name} · ${x.id_type} ${x.id_number}`.trim(), { size: 11, bold: true });
    if (x.status === "firmado") {
      line(`Firmó: ${x.signed_at} UTC · Método: ${x.method === "presencial" ? "en persona, con testigo" : `enlace privado y código de un solo uso enviado a ${x.email}`}`);
      line(`Nombre escrito: ${x.typed_name || ""} · IP: ${x.ip || "—"}`);
      line(`Navegador: ${x.user_agent || "—"}`, { size: 8, color: [90, 90, 90] });
      try { doc.addImage(x.signature_png, "PNG", M, y, 180, 60); } catch {}
      doc.setDrawColor(150); doc.line(M, y + 62, M + 200, y + 62);
      y += 78;
    } else {
      line(x.status === "rechazado" ? `No firmó: ${x.reject_reason || ""}` : "Pendiente de firma", { color: [168, 103, 10], gap: 10 });
    }
  }
  if (y > H - 120) { doc.addPage(); y = M; }
  line("Registro de eventos", { size: 12, bold: true, color: [0, 43, 106] });
  for (const e of r.events) line(`${e.at} UTC · ${e.event.replace(/_/g, " ")}${e.detail ? " · " + e.detail : ""}${e.ip ? " · IP " + e.ip : ""}`, { size: 8, gap: 1 });
  y += 8;
  line("Firma electrónica con verificación de identidad por código de un solo uso, conforme a la Ley 527 de 1999 y el Decreto 2364 de 2012. Generado por TecjuridicosApp.", { size: 8, color: [90, 90, 90] });
  return doc.output("blob");
}

// Text documents: the document followed by a signature page.
function signedDocumentPdf(r) {
  const { jsPDF } = window.jspdf;
  const base = markdownToPdf(r.doc_text, { returnDoc: true });
  const doc = base || new jsPDF({ unit: "pt", format: "letter" });
  doc.addPage();
  let y = 60;
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(0, 43, 106);
  doc.text("FIRMAS", 64, y); y += 24;
  for (const x of r.signers.filter((s) => s.status === "firmado")) {
    try { doc.addImage(x.signature_png, "PNG", 64, y, 180, 60); } catch {}
    doc.setDrawColor(150); doc.line(64, y + 62, 280, y + 62);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(16, 16, 16);
    doc.text(`${x.typed_name || x.name} · ${x.id_type} ${x.id_number}`.trim(), 64, y + 76);
    doc.setFontSize(8); doc.setTextColor(90, 90, 90);
    doc.text(`Firmado electrónicamente el ${x.signed_at} UTC`, 64, y + 88);
    y += 112;
  }
  doc.setFontSize(8);
  doc.text(doc.splitTextToSize(`Huella del documento (SHA-256): ${r.doc_hash}. Ver el certificado de firma para la evidencia completa.`, 480), 64, y);
  return doc.output("blob");
}

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
    <td class="row-actions"><button data-action="mail-proof" data-id="${m.id}">Constancia PDF</button></td>
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
  const m = await api("POST", "/mail", { to: d.to, cc: d.cc, subject: d.subject, body: d.body, case_id: Number(d.case_id) || null, attachments });
  toast(`Correo enviado a ${m.to_addr}.`);
  location.hash === "#correo" ? await renderCorreo() : (location.hash = "#correo");
});

function mailProof(m) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth(), M = 48;
  let y = M;
  const line = (t, { size = 10, bold = false, color = [16, 16, 16], gap = 4 } = {}) => {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(...color);
    for (const l of doc.splitTextToSize(String(t), W - 2 * M)) { if (y > 740) { doc.addPage(); y = M; } doc.text(l, M, y); y += size * 1.35; }
    y += gap;
  };
  line("CONSTANCIA DE ENVÍO DE CORREO ELECTRÓNICO", { size: 15, bold: true, color: [0, 43, 106] });
  line(`Para: ${m.to_addr}${m.cc ? ` · Copia: ${m.cc}` : ""}`);
  line(`Asunto: ${m.subject}`, { bold: true });
  line(`Envío: ${m.sent_at} UTC · Resultado: ${m.status === "enviado" ? "aceptado por el servidor de correo" : "fallido"}`);
  line(`Respuesta del servidor: ${m.smtp_response || "—"} · Message-ID: ${m.smtp_message_id || "—"}`, { size: 8, color: [90, 90, 90] });
  line(`Primera apertura: ${m.opened_at ? `${m.opened_at} UTC · IP ${m.open_ip}` : "sin registro (muchos correos bloquean las imágenes)"}`);
  line(`Acuse de recibo: ${m.confirmed_at ? `${m.confirmed_at} UTC · ${m.confirm_name || ""} · IP ${m.confirm_ip}` : "pendiente"}`, { bold: !!m.confirmed_at });
  line(`Huella del contenido (SHA-256): ${m.content_hash}`, { size: 9, gap: 10 });
  line("Adjuntos", { size: 11, bold: true });
  for (const a of m.attachments) line(`${a.filename} · ${a.size.toLocaleString("es-CO")} bytes · SHA-256 ${a.sha256}`, { size: 8, gap: 2 });
  if (!m.attachments.length) line("Sin adjuntos.");
  y += 6;
  line("Mensaje", { size: 11, bold: true });
  line(m.body, { size: 10 });
  y += 6;
  line("Constancia generada por TecjuridicosApp a partir de los registros del sistema. No reemplaza la certificación de un proveedor de correo electrónico certificado acreditado.", { size: 8, color: [90, 90, 90] });
  return doc.output("blob");
}

// ---------- Agenda (tareas, audiencias, términos) ----------
const KIND_LABEL = { audiencia: "Audiencia", tarea: "Tarea", termino: "Término" };
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
  const tasks = await api("GET", `/tasks?${q}`);
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
            <strong>${escapeHtml(t.title)}</strong>
            <span class="muted">${escapeHtml(t.client_name)} · ${escapeHtml(t.type_name)}${t.radicado ? " · " + escapeHtml(formatRadicado(t.radicado)) : ""}</span>
            ${t.location ? `<span class="muted">${escapeHtml(t.location)}</span>` : ""}
            <span class="muted">${escapeHtml(t.assigned_name || "Responsable del expediente")}</span>
          </div>
          ${can("cases.write") ? `<span class="toolbar">
            ${t.status === "pendiente" ? `<button data-action="task-done" data-id="${t.id}">Hecha</button>` : ""}
            <button data-action="edit-task" data-id="${t.id}">Editar</button>
            <button class="danger" data-action="delete-task" data-id="${t.id}" aria-label="Eliminar">✕</button></span>` : ""}
        </li>`).join("")}</ul>
    </section>`).join("") || '<p class="empty panel">No hay tareas ni audiencias con este filtro. Cree una con “+ Tarea o audiencia” o desde un expediente.</p>';
  agendaCache = tasks;
}
let agendaCache = [];
["#agenda-mine", "#agenda-kind", "#agenda-status"].forEach((sel) => $(sel).addEventListener("change", () => guarded(renderAgenda)));

const taskForm = $("#task-dialog form");
async function openTaskDialog(t = null, caseId = null) {
  const cases = await api("GET", "/cases");
  if (!cases.length) { toast("Primero cree un expediente.", true); return; }
  taskForm.elements.case_id.innerHTML = cases.map((k) => `<option value="${k.id}">${escapeHtml(k.client_name)} · ${escapeHtml(k.type_name)}${k.title ? " · " + escapeHtml(k.title) : ""}</option>`).join("");
  openDialog($("#task-dialog"), t ? `Editar ${KIND_LABEL[t.kind].toLowerCase()}` : "Nueva tarea o audiencia", t ? {
    id: t.id, kind: t.kind, title: t.title, location: t.location, notes: t.notes, due_at: t.due_at.replace(" ", "T"),
  } : { kind: "audiencia" });
  taskForm.elements.case_id.value = t?.case_id ?? caseId ?? cases[0].id;
  taskForm.elements.case_id.disabled = !!t;
  const officeOf = cases.find((k) => k.id === Number(taskForm.elements.case_id.value))?.office_id;
  taskForm.elements.assigned_user_id.innerHTML = '<option value="">— El del expediente —</option>' +
    directory.filter((u) => u.scopeAll || u.offices.some((o) => o.id === officeOf)).map((u) => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join("");
  taskForm.elements.assigned_user_id.value = t?.assigned_user_id ?? "";
  const days = t ? t.remind_days : [1];
  $$("input[name=remind]", taskForm).forEach((c) => (c.checked = days.includes(Number(c.value))));
  taskForm.elements.done.checked = t?.status === "hecha";
}
wireDialog($("#task-dialog"), async (form) => {
  const d = formData(form);
  const body = {
    case_id: Number(form.elements.case_id.value), kind: d.kind, title: d.title, location: d.location, notes: d.notes,
    due_at: d.due_at.replace("T", " "), assigned_user_id: Number(d.assigned_user_id) || null,
    remind_days: $$("input[name=remind]:checked", form).map((c) => Number(c.value)),
    status: form.elements.done.checked ? "hecha" : "pendiente",
  };
  if (d.id) await api("PUT", `/tasks/${d.id}`, body); else await api("POST", "/tasks", body);
  toast(d.id ? "Guardado." : `${KIND_LABEL[d.kind]} creada.`);
  refreshBell();
  await RENDER[location.hash.slice(1) || "inicio"]?.();
});

// ---------- Consulta de procesos ----------
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
      <td class="row-actions"><button data-action="view-acts" data-id="${k.id}">Actuaciones</button></td>
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
    <td>${escapeHtml(a.anotacion)}</td><td class="nowrap">${a.fecha_inicial ? escapeHtml(a.fecha_inicial + " a " + a.fecha_final) : ""}</td></tr>`).join("")
    || '<tr><td colspan="4" class="muted">Sin actuaciones registradas. Use “Consultar” para traerlas.</td></tr>';
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
    <td>${escapeHtml(c.area)}</td><td>${escapeHtml(c.city)}<br><span class="muted">${escapeHtml(c.department)}</span></td>
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
  area: ["especialidad", "area", "jurisdiccion", "especialidad despacho"], email: ["correo", "correo electronico", "email", "e mail", "correo institucional"],
  code: ["codigo", "codigo despacho", "cod despacho"], phone: ["telefono", "telefonos", "tel"], address: ["direccion"],
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
  sel.innerHTML = '<option value="">Todos los clientes</option>' + clients.map((c) => `<option value="${c.id}">${escapeHtml(c.full_name)}</option>`).join("");
  sel.value = clientId;
  $("#pay-balance").textContent = cop(sum.totals.balance);
  $("#pay-overdue").textContent = cop(sum.totals.overdue);
  $("#pay-due7").textContent = cop(sum.due_7d);
  $("#pay-month").textContent = cop(sum.collected_month);
  const max = Math.max(1, ...Object.values(sum.totals.aging));
  $("#pay-aging").innerHTML = L.AGING.map(([k, label], i) => `<div class="hbar" role="listitem"><span class="hbar-label">${label}</span>
    <span class="hbar-track"><span class="hbar-fill ${i >= 3 ? "bad" : i >= 1 ? "late" : ""}" style="width:${(sum.totals.aging[k] / max) * 100}%"></span></span>
    <span class="hbar-value">${cop(sum.totals.aging[k])}</span></div>`).join("");
  const rows = sum.clients.filter((r) => !clientId || r.client_id === Number(clientId));
  $("#pay-cartera-empty").hidden = rows.length > 0;
  $("#pay-cartera").innerHTML = rows.map((r) => `<tr>
    <td><strong>${escapeHtml(r.client_name)}</strong><br><span class="muted">${escapeHtml(r.id_number)}${r.phone ? " · " + escapeHtml(r.phone) : ""}</span></td>
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
const receiptNo = (n) => `RC-${String(n).padStart(6, "0")}`;

$("#pay-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-ptab]");
  if (b) { payTab = b.dataset.ptab; guarded(renderPayTab); }
});
$("#pay-client").addEventListener("change", () => guarded(renderPagos));
$("#pay-state").addEventListener("change", () => guarded(renderPayTab));

// ----- Charge dialog -----
const chargeForm = $("#charge-dialog form");
async function fillClientSelect(select, selected) {
  if (!payClients.length) payClients = await api("GET", "/clients");
  if (!payClients.length) throw new Error("Primero cree un cliente.");
  select.innerHTML = payClients.map((c) => `<option value="${c.id}">${escapeHtml(c.full_name)}${c.id_number ? " · " + escapeHtml(c.id_number) : ""}</option>`).join("");
  if (selected) select.value = selected;
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

async function openChargeDialog(c = null, clientId = null) {
  const dlg = $("#charge-dialog");
  await fillClientSelect(chargeForm.elements.client_id, c?.client_id ?? clientId ?? $("#pay-client").value);
  openDialog(dlg, c ? "Editar cobro" : "Nuevo cobro o plan de cuotas", c ? { id: c.id, concept: c.concept, amount: cop(c.amount), due_date: c.due_date, pay_link: c.pay_link, notes: c.notes }
    : { due_date: localToday(), installments: 1 });
  chargeForm.elements.client_id.disabled = !!c;
  $("[data-plan]", dlg).hidden = !!c;
  $("[data-amount-label]", dlg).textContent = c ? "Valor *" : "Valor total *";
  $("[data-due-label]", dlg).textContent = c ? "Vencimiento *" : "Primer vencimiento *";
  await fillChargeCases(c?.case_id);
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
  location.hash === "#pagos" ? await renderPagos() : (location.hash = "#pagos");
});

// ----- Receipt dialog -----
const receiptForm = $("#receipt-dialog form");
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
  location.hash === "#pagos" ? await renderPagos() : (location.hash = "#pagos");
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
    days_before: paySettings.days_before, repeat_days: paySettings.repeat_days });
  paySetForm.elements.auto.checked = paySettings.auto;
  paySetForm.elements.ch_email.checked = paySettings.channels.includes("email");
  paySetForm.elements.ch_whatsapp.checked = paySettings.channels.includes("whatsapp");
  $("#pay-settings-note").textContent = window.JuanmaBackend?.web ? "Los recordatorios automáticos se envían con la app instalada en el servidor; aquí quedan guardados los ajustes." : "";
}
wireDialog($("#pay-settings-dialog"), async (form) => {
  const d = formData(form);
  await api("PUT", "/payments/settings", { firm_name: d.firm_name, firm_nit: d.firm_nit, pay_info: d.pay_info, auto: form.elements.auto.checked,
    days_before: Number(d.days_before), repeat_days: Number(d.repeat_days),
    channels: ["email", "whatsapp"].filter((c) => form.elements["ch_" + c].checked) });
  toast("Ajustes guardados.");
});

// ----- PDFs: receipt and account statement -----
function pesosEnLetras(n) {
  const U = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince",
    "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco",
    "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
  const D = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
  const C = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];
  const under1000 = (x) => {
    if (x === 100) return "cien";
    const c = Math.floor(x / 100), r = x % 100;
    const dec = r < 30 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? " y " + U[r % 10] : "");
    return [C[c], dec].filter(Boolean).join(" ");
  };
  const apocope = (s) => s.replace(/veintiuno$/, "veintiún").replace(/uno$/, "un");
  const words = (x) => {
    if (x === 0) return "cero";
    const millions = Math.floor(x / 1e6), thousands = Math.floor((x % 1e6) / 1000), rest = x % 1000;
    const out = [];
    if (millions) out.push(millions === 1 ? "un millón" : apocope(words(millions)) + " millones");
    if (thousands) out.push(thousands === 1 ? "mil" : apocope(under1000(thousands)) + " mil");
    if (rest) out.push(under1000(rest));
    return out.join(" ");
  };
  const n0 = Math.round(n);
  const w = apocope(words(n0));
  const de = n0 >= 1e6 && n0 % 1e6 === 0 ? " de" : "";
  return (w.charAt(0).toUpperCase() + w.slice(1) + de + (n0 === 1 ? " peso" : " pesos") + " m/cte.");
}

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
  "new-charge": (b) => openChargeDialog(null, Number(b.dataset.client) || null),
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
};

guarded(boot);
