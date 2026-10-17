// Changes 59–60, 64: "‹ Atrás / Adelante ›" at the foot of each public page (legal texts, authorizations,
// verification, acknowledgment, signing). On a page with steps ([data-step], e.g. firmar.html) the buttons
// move between the steps instead, keeping everything already typed, so a mistake can be corrected.
(() => {
  const main = document.querySelector("main.public-wrap");
  if (!main) return;
  const nav = document.createElement("nav");
  nav.className = "page-nav public-nav";
  nav.setAttribute("aria-label", "Navegación entre pasos y pantallas");
  const btn = (label, title) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "mini"; b.textContent = label; b.title = title;
    return b;
  };
  const back = btn("‹ Atrás", "Volver al paso o pantalla anterior sin borrar lo escrito");
  const where = document.createElement("span");
  where.className = "page-nav-step";
  where.setAttribute("aria-live", "polite");
  const fwd = btn("Adelante ›", "Ir al paso o pantalla siguiente");
  nav.append(back, where, fwd);
  main.after(nav); // after <main>: some pages rewrite main.innerHTML

  // Visible steps, in page order; the current one is the step last moved to (or the first).
  const steps = () => [...document.querySelectorAll("[data-step]")].filter((el) => el.offsetParent !== null);
  let current = null;
  const show = (el) => {
    const list = steps();
    document.querySelectorAll(".step-current").forEach((s) => s.classList.remove("step-current"));
    current = el;
    if (el) {
      el.classList.add("step-current");
      el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      el.querySelector("input:not([type=hidden]):not([disabled]), select, textarea")?.focus({ preventScroll: true });
    }
    sync(list);
  };
  const sync = (list = steps()) => {
    if (list.length > 1) {
      const i = Math.max(0, list.indexOf(current));
      where.textContent = `Paso ${i + 1} de ${list.length}: ${list[i].dataset.step}`;
      fwd.disabled = i >= list.length - 1;
      back.disabled = false;
      return;
    }
    where.textContent = "";
    const n = window.navigation;
    if (!n || typeof n.canGoBack !== "boolean") return;
    back.disabled = !n.canGoBack; fwd.disabled = !n.canGoForward;
  };
  back.addEventListener("click", () => {
    const list = steps();
    const i = list.indexOf(current);
    if (list.length > 1 && i > 0) show(list[i - 1]);
    else if (list.length > 1 && i < 0) show(list[0]);
    else history.back();
  });
  fwd.addEventListener("click", () => {
    const list = steps();
    if (list.length > 1) show(list[Math.min(list.length - 1, list.indexOf(current) + 1)]);
    else history.forward();
  });
  // Working inside a step makes it the current one.
  document.addEventListener("focusin", (e) => {
    const s = e.target.closest?.("[data-step]");
    if (s && s !== current) { document.querySelectorAll(".step-current").forEach((x) => x.classList.remove("step-current")); current = s; s.classList.add("step-current"); sync(); }
  });
  window.addEventListener("hashchange", () => sync());
  new MutationObserver(() => sync()).observe(main, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
  sync();
})();
