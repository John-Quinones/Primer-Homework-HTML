// Page script for firmar.html, in its own file so the Content-Security-Policy can forbid inline scripts (audit A02-001).
const token = location.hash.slice(1);
const $ = (s) => document.querySelector(s);
const call = async (method, path, body) => {
  const res = await fetch(`/api/public/sign/${encodeURIComponent(token)}${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
};
const show = (text, err = false) => { const m = $("#msg"); m.hidden = !text; m.textContent = text || ""; m.classList.toggle("error", err); };
let pad, signedData = null, pdfBytes = null;
function render(v) {
  $("#doc").hidden = false;
  $("#title").textContent = v.title;
  $("#intro").textContent = v.message || `Documento para la firma de ${v.signer.name}.`;
  $("#hash").textContent = v.doc_hash;
  const label = { email: `Correo ${v.signer.email}`, sms: `SMS al celular ${v.signer.phone}`, whatsapp: `WhatsApp al celular ${v.signer.phone}` };
  // Built as text, never as HTML: the e-mail and phone come from the request (audit A05-002).
  $("#otp-channel").replaceChildren(...(v.signer.otp_channels || ["email"]).filter((c) => label[c]).map((c) => new Option(label[c], c)));
  if ((v.signer.otp_channels || []).includes(v.signer.otp_channel)) $("#otp-channel").value = v.signer.otp_channel;
  signedData = v.signed || null;
  $("#done").hidden = !signedData;
  if (v.doc_kind === "markdown") $("#doc-text").innerHTML = DOMPurify.sanitize(marked.parse(v.doc_text || ""));
  const pending = v.signer.status === "pendiente" && v.request_status === "enviada";
  $("#sign").hidden = !pending;
  if (!pending) show(v.signer.status === "firmado" ? `Firmado el ${JuanmaPdf.colombiaTime(v.signer.signed_at)}. Gracias.` : v.signer.status === "rechazado" ? "Usted decidió no firmar este documento." : "Este documento ya no está disponible para firma.");
  if (pending && !pad) pad = JuanmaSigPad($("#pad"));
  // A client of the firm answers each data policy on its own, Sí or No, before signing (version 2.4).
  consentItems = pending && v.consent ? v.consent.items : null;
  const box = $("#consent-box");
  box.hidden = !consentItems;
  if (consentItems && !box.childElementCount) {
    box.innerHTML = JuanmaLegal.consentChecklistHtml(consentItems);
    box.querySelectorAll("[data-legal]").forEach((a) => { a.target = "_blank"; a.rel = "noopener"; });
  }
}
let consentItems = null;
(async () => {
  if (!token) return show("El enlace está incompleto. Ábralo de nuevo desde el correo.", true);
  try {
    const v = await call("GET", "");
    render(v);
    if (v.doc_kind === "pdf") {
      const f = await call("GET", "/pdf");
      const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
      pdfBytes = bytes;
      // Every page drawn on the page itself: an embedded PDF viewer shows only the first page on phones.
      await JuanmaPdfView.render($("#doc-pdf"), bytes);
    }
  } catch (e) { show(e.message, true); }
})();
$("#otp-btn").addEventListener("click", async () => {
  try {
    const r = await call("POST", "/otp", { channel: $("#otp-channel").value });
    const via = { email: "correo", sms: "SMS", whatsapp: "WhatsApp" }[r.channel] || "correo";
    show(`Le enviamos el código por ${via} (${r.to}). Vence en ${r.minutes} minutos.`);
  } catch (e) { show(e.message, true); }
});
$("#clear").addEventListener("click", () => pad.clear());
$("#dl-signed").addEventListener("click", async () => {
  try {
    // The signed PDF kept on the server: the same bytes everyone gets, so it passes verification.
    const f = await call("GET", "/signed");
    const blob = new Blob([Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))], { type: "application/pdf" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: f.filename });
    document.body.append(a); a.click(); a.remove();
  } catch (e) { show(`No se pudo armar el PDF: ${e.message}`, true); }
});
$("#sign-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, err = f.querySelector(".form-error");
  err.hidden = true;
  if (pad.isEmpty()) { err.textContent = "Dibuje su firma."; err.hidden = false; return; }
  try {
    let consents;
    if (consentItems) {
      const c = JuanmaLegal.consentAnswers(f, consentItems);
      if (c.missing.length) { err.textContent = `Responda Sí o No en: ${c.missing.join(", ")}.`; err.hidden = false; return; }
      consents = c.answers;
    }
    render(await call("POST", "/sign", { otp: f.otp.value, typed_name: f.typed_name.value, accept: f.accept.checked, signature_png: pad.toPng(), consents }));
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
});
$("#reject").addEventListener("click", async () => {
  const reason = window.prompt("¿Por qué no firma? (opcional)") ?? null;
  if (reason === null) return;
  try { render(await call("POST", "/reject", { reason })); } catch (e) { show(e.message, true); }
});
