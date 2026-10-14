// JuanMaApp front end. Talks to the Express API; the preview build swaps in
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
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },
  // Yields NDJSON events from /api/generate.
  async *generate(payload) {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

// ---------- Shared state ----------
const state = { catalog: [], clients: [], cases: [], selectedClientId: null };

async function loadCatalog() { state.catalog = await api("GET", "/catalog"); }
async function loadClients(q = "") { state.clients = await api("GET", `/clients?q=${encodeURIComponent(q)}`); }
async function loadCases() { state.cases = await api("GET", "/cases"); }

const categoryOf = (catId) => state.catalog.find((c) => c.id === Number(catId));
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

// ---------- Navigation ----------
const VIEWS = ["inicio", "clientes", "expedientes", "borradores", "jurisprudencia", "importar", "configuracion"];
function showView() {
  const name = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "inicio";
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
      <span>${escapeHtml([c.id_type, c.id_number].filter(Boolean).join(" "))} · ${c.case_count} expediente(s)</span>
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
        <button data-action="edit-client" data-id="${c.id}">Editar</button>
        <button class="danger" data-action="delete-client" data-id="${c.id}">Eliminar</button>
      </div>
    </div>
    <dl class="facts">
      ${row("Documento", [c.id_type, c.id_number].filter(Boolean).join(" "))}
      ${row("Correo", c.email)}${row("Teléfono", c.phone)}
      ${row("Dirección", [c.address, c.city].filter(Boolean).join(", "))}
      ${row("Notas", c.notes)}
    </dl>
    <div class="detail-head">
      <h4>Expedientes</h4>
      <button class="primary" data-action="new-case" data-client="${c.id}">+ Nuevo expediente</button>
    </div>
    ${cases.length ? `<ul class="case-cards">${cases.map(caseCard).join("")}</ul>` : '<p class="empty">Este cliente no tiene expedientes.</p>'}`;
}

function caseCard(k) {
  return `<li class="case-card">
    <div><span class="pill">${escapeHtml(k.category_name)}</span> <span class="status-tag">${escapeHtml(k.status)}</span></div>
    <strong>${escapeHtml(k.type_name)}</strong>
    ${k.title ? `<span>${escapeHtml(k.title)}</span>` : ""}
    <div class="toolbar">
      <button data-action="edit-case" data-id="${k.id}">Editar</button>
      <button class="primary" data-action="draft-case" data-id="${k.id}">Generar borrador</button>
    </div>
  </li>`;
}

async function renderClientes() {
  await loadClients($("#client-search").value);
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

wireDialog($("#client-dialog"), async (form) => {
  const { id, ...data } = formData(form);
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
  const rows = state.cases.filter((k) => !catId || k.category_id === catId);
  $("#case-empty").hidden = rows.length > 0;
  $("#case-rows").innerHTML = rows.map((k) => `
    <tr>
      <td>${escapeHtml(k.client_name)}</td>
      <td><span class="pill">${escapeHtml(k.category_name)}</span><br>${escapeHtml(k.type_name)}</td>
      <td>${escapeHtml(k.title)}</td>
      <td><span class="status-tag">${escapeHtml(k.status)}</span></td>
      <td class="row-actions">
        <button data-action="edit-case" data-id="${k.id}">Editar</button>
        <button class="primary" data-action="draft-case" data-id="${k.id}">Borrador</button>
        <button class="danger" data-action="delete-case" data-id="${k.id}" aria-label="Eliminar">✕</button>
      </td>
    </tr>`).join("");
}

async function renderExpedientes() {
  await Promise.all([loadCatalog(), loadCases()]);
  fillCaseFilter();
  renderCaseRows();
}
$("#case-filter").addEventListener("change", renderCaseRows);

const caseForm = $("#case-dialog form");

function fillTypeSelect(catId, selectedTypeId) {
  const cat = categoryOf(catId);
  caseForm.elements.process_type_id.innerHTML = (cat?.types ?? [])
    .map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
  if (selectedTypeId) caseForm.elements.process_type_id.value = selectedTypeId;
  renderCustomFields(cat, {});
}

function renderCustomFields(cat, values) {
  const box = $("#custom-fields");
  box.innerHTML = (cat?.fields ?? []).map((f) => {
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

  openDialog($("#case-dialog"), k ? "Editar expediente" : "Nuevo expediente", k ? {
    id: k.id, title: k.title, status: k.status, counterparty: k.counterparty, facts: k.facts,
  } : {});
  caseForm.elements.client_id.value = k?.client_id ?? clientId ?? state.clients[0].id;
  caseForm.elements.client_id.disabled = !!k;
  const catId = k?.category_id ?? state.catalog[0]?.id;
  caseForm.elements.category_id.value = catId;
  fillTypeSelect(catId, k?.process_type_id);
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
  $("#catalog").innerHTML = state.catalog.map((c) => `
    <details class="panel cat" data-cat="${c.id}" ${open.has(String(c.id)) ? "open" : ""}>
      <summary>
        <span class="cat-name">${escapeHtml(c.name)}</span>
        <span class="muted">${c.types.length} subprocesos · ${c.fields.length} campos</span>
      </summary>
      <div class="cat-body">
        <div class="toolbar">
          <button data-action="rename-category" data-id="${c.id}">Renombrar</button>
          <button class="danger" data-action="delete-category" data-id="${c.id}">Eliminar tipo</button>
        </div>
        <h4>Subprocesos</h4>
        <ul class="config-list">
          ${c.types.map((t) => `<li><span>${escapeHtml(t.name)}</span>
            <span class="toolbar">
              <button data-action="rename-type" data-id="${t.id}">Renombrar</button>
              <button class="danger" data-action="delete-type" data-id="${t.id}" aria-label="Eliminar">✕</button>
            </span></li>`).join("")}
        </ul>
        <form class="toolbar" data-form="new-type" data-cat="${c.id}">
          <input name="name" placeholder="Nuevo subproceso" required />
          <button class="primary">+ Agregar</button>
        </form>
        <h4>Campos propios de ${escapeHtml(c.name)}</h4>
        <ul class="config-list">
          ${c.fields.map((f) => `<li><span>${escapeHtml(f.label)} <span class="muted">· ${FIELD_TYPE_LABELS[f.field_type]}${f.required ? " · obligatorio" : ""}${f.options.length ? ` · ${escapeHtml(f.options.join(", "))}` : ""}</span></span>
            <button class="danger" data-action="delete-field" data-id="${f.id}" aria-label="Eliminar">✕</button></li>`).join("") || '<li class="muted">Sin campos propios todavía.</li>'}
        </ul>
        <form class="field-form" data-form="new-field" data-cat="${c.id}">
          <input name="label" placeholder="Nombre del campo (ej. Radicado, Juzgado)" required />
          <select name="field_type">
            ${Object.entries(FIELD_TYPE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
          </select>
          <input name="options" placeholder="Opciones separadas por coma (solo Lista)" />
          <label class="inline"><input type="checkbox" name="required" /> Obligatorio</label>
          <button class="primary">+ Campo</button>
        </form>
      </div>
    </details>`).join("");
}

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
    "new-client": () => openDialog($("#client-dialog"), "Nuevo cliente"),
    "edit-client": () => openDialog($("#client-dialog"), "Editar cliente", state.clients.find((c) => c.id === id)),
    "delete-client": async () => {
      if (!confirm("¿Eliminar este cliente?")) return;
      await api("DELETE", `/clients/${id}`);
      state.selectedClientId = null;
      toast("Cliente eliminado.");
      await renderClientes();
    },
    "new-case": () => openCaseDialog(null, btn.dataset.client ? Number(btn.dataset.client) : state.selectedClientId),
    "edit-case": async () => openCaseDialog(await api("GET", `/cases/${id}`)),
    "delete-case": async () => {
      if (!confirm("¿Eliminar este expediente?")) return;
      await api("DELETE", `/cases/${id}`);
      toast("Expediente eliminado.");
      await renderExpedientes();
    },
    "draft-case": () => {
      pendingDraftCase = id;
      location.hash === "#borradores" ? renderBorradores() : (location.hash = "#borradores");
    },
    "rename-category": async () => {
      const name = prompt("Nuevo nombre del tipo de proceso:", categoryOf(id).name);
      if (name) { await api("PUT", `/categories/${id}`, { name }); await renderConfiguracion(); }
    },
    "delete-category": async () => {
      if (!confirm("¿Eliminar este tipo de proceso con sus subprocesos y campos?")) return;
      await api("DELETE", `/categories/${id}`);
      await renderConfiguracion();
    },
    "rename-type": async () => {
      const name = prompt("Nuevo nombre del subproceso:", typeById(id).name);
      if (name) { await api("PUT", `/types/${id}`, { name }); await renderConfiguracion(); }
    },
    "delete-type": async () => {
      if (!confirm("¿Eliminar este subproceso?")) return;
      await api("DELETE", `/types/${id}`);
      await renderConfiguracion();
    },
    "delete-field": async () => {
      if (!confirm("¿Eliminar este campo? Los valores guardados en expedientes dejarán de mostrarse.")) return;
      await api("DELETE", `/fields/${id}`);
      await renderConfiguracion();
    },
  };
  if (ACTIONS[btn.dataset.action]) guarded(ACTIONS[btn.dataset.action]);
});

// ---------- Borradores ----------
const draftForm = $("#draft-form");
let pendingDraftCase = null;
let lastResult = null;

draftForm.paymentRequired.addEventListener("change", (e) => (draftForm.paymentItems.disabled = !e.target.checked));

async function renderBorradores() {
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

function collectDraft() {
  const f = draftForm.elements;
  const caseId = Number(f.caseId.value) || null;
  return {
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
    const blob = new Blob([lastResult.document], { type: "text/markdown" });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `${lastResult.payload?.document_type || "borrador"}.md`.toLowerCase(),
    });
    a.click();
    URL.revokeObjectURL(a.href);
  } else if (action === "print") {
    window.print();
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
  imp.mapping = headers.map(IMP.guessTarget);
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
  if (casesMode) cols.push(["case.category", "Tipo de proceso"], ["case.type", "Subproceso"], ["case.title", "Asunto"]);
  const head = `<thead><tr>${cols.map(([, l]) => `<th>${l}</th>`).join("")}${casesMode ? "<th>Campos propios</th>" : ""}</tr></thead>`;
  const rows = recs.slice(0, 5).map((r) => `<tr>${cols.map(([k]) => {
    const [o, f] = k.split(".");
    return `<td>${escapeHtml(r[o][f] ?? "")}</td>`;
  }).join("")}${casesMode ? `<td>${escapeHtml(Object.entries(r.custom).map(([k, v]) => `${k}: ${v}`).join("\n"))}</td>` : ""}</tr>`).join("");
  $("#import-preview").innerHTML = head + `<tbody>${rows}</tbody>`;
  const noName = !imp.mapping.includes("client.full_name");
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
const OPEN_STATUSES = new Set(["Abierto", "En trámite", "En espera de respuesta"]);

async function renderInicio() {
  const [clients, cases, catalog, saved] = await Promise.all([
    api("GET", "/clients"), api("GET", "/cases"), api("GET", "/catalog"), api("GET", "/jurisprudencia/saved"),
  ]);
  $("#kpi-clients").textContent = clients.length;
  $("#kpi-open").textContent = cases.filter((k) => OPEN_STATUSES.has(k.status)).length;
  $("#kpi-total").textContent = `de ${cases.length} en total`;
  $("#kpi-rulings").textContent = saved.length;
  $("#kpi-cats").textContent = catalog.length;

  // Horizontal bars: one series, so the label names it and each bar carries its value.
  const counts = catalog.map((c) => ({ name: c.name, n: cases.filter((k) => k.category_id === c.id).length }))
    .sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...counts.map((c) => c.n));
  $("#chart-by-type").innerHTML = counts.map((c) => `
    <div class="hbar" role="listitem" title="${escapeHtml(c.name)}: ${c.n} expediente(s)">
      <span class="hbar-label">${escapeHtml(c.name)}</span>
      <span class="hbar-track"><span class="hbar-fill" style="width:${(c.n / max) * 100}%"></span></span>
      <span class="hbar-value">${c.n}</span>
    </div>`).join("") || '<p class="empty">Sin datos.</p>';

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
  setBox("#j-analyze-status", "Leyendo la sentencia en la fuente oficial…");
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
    reference: it.reference, court: it.court, url: it.url, verified: it.verified, analysis: it.analysis || {},
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
      await openSaveDialog({ reference: r.reference, court: r.court, url: r.url, verified: r.verified, analysis: { topic: r.topic, date: r.date } });
    } else if (b.dataset.jact === "save-analysis") {
      const a = jAnalysis;
      await openSaveDialog({ reference: a.reference, court: a.court, url: a.url, verified: a.verified, analysis: a });
    } else if (b.dataset.jact === "delete-saved") {
      if (!confirm("¿Eliminar esta sentencia guardada?")) return;
      await api("DELETE", `/jurisprudencia/saved/${b.dataset.id}`);
      await renderSaved();
    }
  });
});

const RENDER = {
  inicio: renderInicio,
  jurisprudencia: renderJurisprudencia,
  clientes: renderClientes,
  expedientes: renderExpedientes,
  borradores: renderBorradores,
  importar: renderImportar,
  configuracion: renderConfiguracion,
};

guarded(async () => {
  await loadCatalog();
  await showView();
});
