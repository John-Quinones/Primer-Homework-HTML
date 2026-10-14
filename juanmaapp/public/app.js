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
const VIEWS = ["clientes", "expedientes", "borradores", "configuracion"];
function showView() {
  const name = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "clientes";
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
  await RENDER[location.hash.slice(1) || "clientes"]?.();
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
  }
});

const RENDER = {
  clientes: renderClientes,
  expedientes: renderExpedientes,
  borradores: renderBorradores,
  configuracion: renderConfiguracion,
};

guarded(async () => {
  await loadCatalog();
  await showView();
});
