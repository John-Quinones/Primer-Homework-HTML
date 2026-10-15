// Page script for legal.html: one document at a time, chosen by the address (#tratamiento, #cookies…).
const $ = (s) => document.querySelector(s);
const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const { LEGAL_DOCS } = window.JuanmaLegal;
function show() {
  const id = location.hash.slice(1);
  const doc = LEGAL_DOCS.find((d) => d.id === id) || LEGAL_DOCS[0];
  document.title = `${doc.title} · TecjuridicosApp`;
  $("#tabs").innerHTML = LEGAL_DOCS.map((d) => `<a href="#${d.id}" class="${d.id === doc.id ? "active" : ""}">${esc(d.short)}</a>`).join("");
  $("#doc").innerHTML = `<h2>${esc(doc.title)}</h2><div class="legal-doc">${doc.html}</div>`;
}
// Links between documents stay on this page.
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-legal]");
  if (a) { e.preventDefault(); location.hash = a.dataset.legal; window.scrollTo(0, 0); }
});
$("#print").addEventListener("click", () => window.print());
window.addEventListener("hashchange", show);
show();
