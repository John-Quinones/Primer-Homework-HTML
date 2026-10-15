// Page script for autorizar.html: the client answers each authorization on its own.
// The private link (#token) is the credential; nothing is stored in the browser.
const $ = (s) => document.querySelector(s);
const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const co = (utc) => (utc ? new Date(Date.parse(String(utc).replace(" ", "T") + "Z") - 5 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") + " (hora de Colombia)" : "");
const { legalDoc, consentItem } = window.JuanmaLegal;
const token = location.hash.slice(1);
const main = $("#main");

async function api(method, body) {
  const res = await fetch(`/api/public/consent/${encodeURIComponent(token)}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function answered(v) {
  main.innerHTML = `<section class="panel">
    <h2>Gracias, ${esc(v.client_name)}</h2>
    <p>Sus respuestas quedaron registradas el ${esc(co(v.answered_at))}, sobre la versión ${esc(v.version)} de los documentos. Le enviamos una copia a su correo, si la firma lo tiene registrado.</p>
    <ul class="consent-status">${v.answers.map((a) => `<li><span>${esc(consentItem(a.item)?.title || a.item)}</span>
      <span class="consent-state ${a.granted ? "yes" : "no"}">${a.granted ? "Autorizó" : "No autorizó"}</span>
      <small>Huella del registro: ${esc(a.hash.slice(0, 16))}…</small></li>`).join("")}</ul>
    <p class="hint">Puede revocar o cambiar cualquiera de estas autorizaciones cuando quiera, escribiendo a la firma.</p>
  </section>`;
}

function form(v) {
  main.innerHTML = `<section class="panel">
    <h2>Hola, ${esc(v.client_name)}</h2>
    <p>${esc(v.firm)} le pide responder las siguientes autorizaciones. <strong>Cada una es independiente</strong>: marque solo las que acepte. Una casilla sin marcar queda registrada como <strong>no autorizada</strong>. Puede abrir y leer cada documento antes de responder.</p>
  </section>
  <form id="consent-form" class="panel">
    <ul class="consent-list">${v.items.map((i) => {
      const doc = legalDoc(i.doc);
      return `<li class="consent-card"><h4>${esc(i.title)}</h4>
        <label class="consent-check"><input type="checkbox" name="${esc(i.key)}" /> <span>${esc(i.label)}</span></label>
        <details><summary>Leer: ${esc(doc.title)}</summary><div class="legal-doc">${doc.html}</div></details></li>`;
    }).join("")}</ul>
    <h3>Quién responde</h3>
    <div class="grid2">
      <label>Nombre completo * <input name="typed_name" required autocomplete="name" /></label>
      ${v.needs_id ? '<label>Número de documento * <input name="typed_id" required inputmode="numeric" autocomplete="off" /></label>' : '<label>Número de documento <input name="typed_id" inputmode="numeric" autocomplete="off" /></label>'}
    </div>
    <p class="hint">Al guardar se registran sus respuestas con la fecha y hora, la versión de cada documento, la dirección IP y el navegador, como prueba de su decisión (Decreto 1074 de 2015, art. 2.2.2.25.2.5).</p>
    <p class="form-error" hidden></p>
    <div class="dialog-actions"><button class="primary">Guardar mis respuestas</button></div>
  </form>`;
  // Links inside the documents open the full page in a new tab.
  main.querySelectorAll("[data-legal]").forEach((a) => { a.target = "_blank"; a.rel = "noopener"; });
  $("#consent-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, err = f.querySelector(".form-error");
    const answers = Object.fromEntries(v.items.map((i) => [i.key, f.elements[i.key].checked]));
    const no = v.items.filter((i) => !answers[i.key]).map((i) => i.title);
    if (no.length && !confirm(`No marcó: ${no.join(", ")}.\n\nEsas quedarán registradas como NO autorizadas. ¿Guardar así?`)) return;
    const btn = f.querySelector("button.primary");
    btn.disabled = true; err.hidden = true;
    try {
      answered(await api("POST", { answers, typed_name: f.elements.typed_name.value, typed_id: f.elements.typed_id.value }));
      window.scrollTo(0, 0);
    } catch (x) {
      err.textContent = x.message; err.hidden = false; btn.disabled = false;
    }
  });
}

(async () => {
  if (!token) { main.innerHTML = '<section class="panel"><p>Este enlace está incompleto. Ábralo tal como le llegó.</p></section>'; return; }
  try {
    const v = await api("GET");
    if (v.answered_at) answered(v);
    else if (v.expired) main.innerHTML = '<section class="panel"><h2>El enlace venció</h2><p>Pida a la firma un nuevo enlace para responder sus autorizaciones.</p></section>';
    else form(v);
  } catch (x) {
    main.innerHTML = `<section class="panel"><p>${esc(x.message)}</p></section>`;
  }
})();
