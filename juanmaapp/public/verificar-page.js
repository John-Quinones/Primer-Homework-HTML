// Page script for verificar.html, in its own file so the Content-Security-Policy can forbid inline scripts (audit A02-001).
const $ = (s) => document.querySelector(s);
const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const co = (utc) => (utc ? new Date(Date.parse(String(utc).replace(" ", "T") + "Z") - 5 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") + " (hora de Colombia)" : "");
async function ask(body) {
  const res = await fetch("/api/public/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}
function show(r, hash) {
  const box = $("#result");
  box.hidden = false;
  const VERDICT = {
    firmado: ["ok", "AUTÉNTICO Y SIN ALTERACIONES: este archivo es exactamente el documento firmado registrado."],
    original: ["warn", "Es el documento ORIGINAL que se envió a firma (sin las estampas). Para el documento firmado, cargue el PDF firmado."],
    codigo: ["warn", "El código corresponde a esta solicitud de firma. Para comprobar que su archivo no fue alterado, cárguelo arriba."],
    ninguno: ["bad", hash ? "NO COINCIDE: este archivo no corresponde a ningún documento firmado registrado. Pudo ser modificado, o no se firmó con TecjuridicosApp." : "No hay ningún documento con ese código."],
  };
  const [cls, text] = VERDICT[r.match];
  box.innerHTML = `<div class="verdict ${cls}">${esc(text)}</div>${hash ? `<p class="hash">Huella SHA-256 del archivo cargado: ${esc(hash)}</p>` : ""}${r.title ? `
    <h3>${esc(r.title)}</h3>
    <p>Estado: <strong>${r.status === "completada" ? "Firmado por todos" : esc(r.status)}</strong>${r.completed_at ? ` · ${esc(co(r.completed_at))}` : ""} · Código ${esc(r.verify_code || "")}</p>
    <ul>${r.signers.map((s) => `<li><strong>${esc(s.name)}</strong> ${esc(s.id_type || "")} ${esc(s.id_number || "")} · ${s.status === "firmado"
      ? `firmó el ${esc(co(s.signed_at))} · ${s.method === "presencial" ? "en persona con testigo" : `código OTP por ${s.otp_channel === "whatsapp" ? "WhatsApp" : s.otp_channel === "sms" ? "SMS" : "correo"}`}` : esc(s.status)}</li>`).join("")}</ul>
    <p class="hash">Huella del documento original: ${esc(r.doc_hash)}${r.signed_sha256 ? `<br>Huella del PDF firmado: ${esc(r.signed_sha256)}` : ""}</p>` : ""}`;
}
$("#file").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await f.arrayBuffer()))].map((b) => b.toString(16).padStart(2, "0")).join("");
  try { show(await ask({ sha256: hash }), hash); } catch (err) { $("#result").hidden = false; $("#result").textContent = err.message; }
});
$("#code-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try { show(await ask({ code: $("#code").value })); } catch (err) { $("#result").hidden = false; $("#result").textContent = err.message; }
});
const pre = location.hash.slice(1);
if (pre) { $("#code").value = pre; $("#code-form").requestSubmit(); }
