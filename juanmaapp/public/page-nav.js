// Change 59: "‹ Atrás / Adelante ›" at the top of each public page (legal texts, authorizations, verification, acknowledgment).
(() => {
  const main = document.querySelector("main");
  if (!main) return;
  const nav = document.createElement("nav");
  nav.className = "page-nav";
  nav.setAttribute("aria-label", "Navegación entre pantallas");
  const btn = (label, title, go) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "mini"; b.textContent = label; b.title = title;
    b.addEventListener("click", go);
    return b;
  };
  const back = btn("‹ Atrás", "Volver a la pantalla anterior", () => history.back());
  const fwd = btn("Adelante ›", "Ir a la pantalla siguiente", () => history.forward());
  nav.append(back, fwd);
  nav.classList.add("public-nav");
  main.before(nav); // before <main>: some pages rewrite main.innerHTML
  const sync = () => {
    const n = window.navigation;
    if (!n || typeof n.canGoBack !== "boolean") return;
    back.disabled = !n.canGoBack; fwd.disabled = !n.canGoForward;
  };
  window.addEventListener("hashchange", sync);
  sync();
})();
