// Tema HUD (solo presentación): radar y botones direccionales en «Movimiento reciente».
// Atrás/Adelante usan el historial del navegador, igual que los botones de la barra; Arriba/Abajo desplazan la pantalla.
// No lee ni guarda datos.
(() => {
  const list = document.getElementById("recent-cases");
  const panel = list && list.closest(".panel");
  if (!panel || panel.querySelector(".hud-radar-row")) return;
  const svg = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
  const icons = {
    up: svg('<path d="M5 4h14"/><path d="M12 20V8M7 12l5-5 5 5"/>'),
    back: svg('<path class="solid" d="M16 6v12L6 12z"/>'),
    fwd: svg('<path class="solid" d="M8 6v12l10-6z"/>'),
    down: svg('<path d="M5 20h14"/><path d="M12 4v12M7 12l5 5 5-5"/>'),
  };
  const row = document.createElement("div");
  row.className = "hud-radar-row";
  row.innerHTML = `<div class="hud-radar" role="img" aria-label="Radar decorativo"><i></i><i></i><i></i><i></i></div>
    <div class="hud-pad" role="group" aria-label="Navegación">
      <button type="button" data-hud="up" title="Arriba" aria-label="Arriba">${icons.up}</button>
      <button type="button" data-hud="back" title="Atrás" aria-label="Atrás">${icons.back}</button>
      <button type="button" data-hud="fwd" title="Adelante" aria-label="Adelante">${icons.fwd}</button>
      <button type="button" data-hud="down" title="Abajo" aria-label="Abajo">${icons.down}</button>
    </div>`;
  panel.append(row);
  row.addEventListener("click", (e) => {
    const b = e.target.closest("[data-hud]");
    if (!b) return;
    const k = b.dataset.hud;
    if (k === "back") history.back();
    else if (k === "fwd") history.forward();
    else window.scrollTo({ top: k === "up" ? 0 : document.documentElement.scrollHeight, behavior: "smooth" });
  });
})();

// El menú lateral de escritorio muestra solo iconos: el nombre queda como título (tooltip).
document.querySelectorAll(".sidenav a[data-view]").forEach((a) => {
  const t = a.querySelector(".nav-text");
  if (t && !a.title) a.title = (t.firstElementChild || t).textContent.trim();
});
