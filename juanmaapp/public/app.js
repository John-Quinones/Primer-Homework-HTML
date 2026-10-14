const form = document.getElementById("draft-form");
const submitBtn = document.getElementById("submit");
const statusEl = document.getElementById("status");
const auditEl = document.getElementById("audit");
const docEl = document.getElementById("document");
const payloadBox = document.getElementById("payload-box");
const payloadEl = document.getElementById("payload");
const actionBtns = document.querySelectorAll("[data-action]");

let lastResult = null;

form.paymentRequired.addEventListener("change", (e) => {
  form.paymentItems.disabled = !e.target.checked;
});

function setStatus(text, isError = false) {
  statusEl.hidden = !text;
  statusEl.textContent = text || "";
  statusEl.classList.toggle("error", isError);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderMarkdown(md) {
  const html = DOMPurify.sanitize(marked.parse(md));
  // Highlight [FILL: …] markers so missing data is impossible to miss.
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
  const parts = [];
  parts.push(result.ok
    ? '<span class="ok">✓ Verificación automática superada</span>'
    : '<span class="error">✗ El borrador no supera la verificación automática</span>');
  const items = result.issues.map((i) =>
    `<li class="${i.level}">${escapeHtml(ISSUE_LABELS[i.code] || i.code)}: ${escapeHtml(String(i.detail))}</li>`);
  if (result.fillFields.length) {
    items.push(`<li class="warning">Datos por completar: ${result.fillFields.map(escapeHtml).join("; ")}</li>`);
  }
  if (result.boldLink) {
    items.push(`<li>Referencia Bold: <code>${escapeHtml(result.transactionId)}</code></li>`);
  }
  if (items.length) parts.push(`<ul>${items.join("")}</ul>`);
  auditEl.innerHTML = parts.join("");
  auditEl.hidden = false;
}

function collect() {
  const f = form.elements;
  return {
    documentType: f.documentType.value,
    language: f.language.value,
    jurisdiction: f.jurisdiction.value.trim(),
    client: {
      fullName: f.fullName.value.trim(),
      idNumber: f.idNumber.value.trim(),
      email: f.email.value.trim(),
      address: f.address.value.trim(),
    },
    counterparty: f.counterparty.value.trim(),
    facts: f.facts.value.trim(),
    payment: { required: f.paymentRequired.checked, items: f.paymentItems.value.trim() },
  };
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  actionBtns.forEach((b) => (b.disabled = true));
  auditEl.hidden = true;
  payloadBox.hidden = true;
  lastResult = null;
  setStatus("Redactando borrador…");

  const pre = document.createElement("pre");
  pre.className = "streaming";
  docEl.replaceChildren(pre);

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collect()),
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
        if (!line) continue;
        const evt = JSON.parse(line);
        if (evt.type === "text") pre.textContent += evt.text;
        else if (evt.type === "error") throw new Error(evt.error);
        else if (evt.type === "done") lastResult = evt;
      }
    }
    if (!lastResult) throw new Error("La respuesta terminó sin resultado.");

    docEl.innerHTML = renderMarkdown(lastResult.document);
    renderAudit(lastResult);
    if (lastResult.payload) {
      payloadEl.textContent = JSON.stringify(lastResult.payload, null, 2);
      payloadBox.hidden = false;
    }
    actionBtns.forEach((b) => (b.disabled = b.dataset.action === "copy-json" && !lastResult.payload));
    setStatus("");
  } catch (err) {
    setStatus(`Error: ${err.message}`, true);
  } finally {
    submitBtn.disabled = false;
  }
});

document.querySelector(".actions").addEventListener("click", async (e) => {
  const action = e.target.dataset?.action;
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
