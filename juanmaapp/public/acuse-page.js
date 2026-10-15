// Page script for acuse.html, in its own file so the Content-Security-Policy can forbid inline scripts (audit A02-001).
const token = location.hash.slice(1), $ = (s) => document.querySelector(s);
const show = (t, err) => { $("#msg").hidden = false; $("#msg").textContent = t; $("#msg").classList.toggle("error", !!err); };
const api = async (method, path, body) => {
  const res = await fetch(`/api/public/mail/${encodeURIComponent(token)}${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || `Error ${res.status}`);
  return d;
};
(async () => {
  try {
    const m = await api("GET", "");
    $("#box").hidden = false;
    $("#subject").textContent = m.subject; $("#sent").textContent = m.sent_at; $("#to").textContent = m.to; $("#hash").textContent = m.content_hash;
    $("#atts").innerHTML = m.attachments.map((a) => `<li>${a.filename.replace(/[<&]/g, "")} · ${Math.ceil(a.size / 1024)} KB</li>`).join("");
    if (m.confirmed_at) { $("#form").hidden = true; show(`Recibo confirmado el ${m.confirmed_at} (UTC).`); }
  } catch (e) { show(e.message, true); }
})();
$("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try { const r = await api("POST", "/confirm", { name: e.target.name.value }); $("#form").hidden = true; show(`Gracias. Recibo confirmado el ${r.confirmed_at} (UTC).`); }
  catch (ex) { show(ex.message, true); }
});
