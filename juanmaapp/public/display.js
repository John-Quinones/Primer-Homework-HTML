// Display preferences of this device: font size, layout (automatic, mobile or
// web) and day / night theme. They are a per-device convenience, kept in the
// browser; nothing here touches the firm's data.
(function () {
  const KEY = "tecjuridicos-display-v1";
  const DEFAULTS = { font: "normal", view: "auto", theme: "auto" };
  const FONT = { normal: "100%", mediana: "112.5%", grande: "125%" };
  const MOBILE_MAX = 760;
  let prefs = { ...DEFAULTS };
  try { prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch {}

  // The layout rules live in @media (max-width: …) blocks. "Móvil" makes them
  // always apply and "Web" never; "Automático" restores what the screen decides.
  const original = new Map();
  function layoutRules() {
    const out = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules) if (r instanceof CSSMediaRule && /max-width/.test(original.get(r) ?? r.media.mediaText)) out.push(r);
    }
    return out;
  }
  function applyView() {
    for (const r of layoutRules()) {
      if (!original.has(r)) original.set(r, r.media.mediaText);
      r.media.mediaText = prefs.view === "mobile" ? "all" : prefs.view === "web" ? "not all" : original.get(r);
    }
    // On a phone, "Web" shows the desktop layout (zoomed out), like a browser's desktop-site option.
    const vp = document.querySelector('meta[name="viewport"]');
    if (vp) {
      vp.dataset.auto ??= vp.content;
      vp.content = prefs.view === "web" && window.screen.width < 900 ? "width=1280" : vp.dataset.auto;
    }
  }
  /** The layout in use right now, for the badge at the top. */
  function currentView() {
    if (prefs.view === "mobile") return "Móvil";
    if (prefs.view === "web") return "Web";
    return window.matchMedia(`(max-width: ${MOBILE_MAX}px)`).matches ? "Móvil (automático)" : "Web (automático)";
  }
  function apply() {
    const root = document.documentElement;
    root.style.fontSize = FONT[prefs.font] || "100%";
    // "Automático" follows the device (or the viewer's own choice); only undo a theme this page set.
    if (prefs.theme === "auto") { if (root.dataset.themeByApp) { root.removeAttribute("data-theme"); delete root.dataset.themeByApp; } }
    else { root.dataset.theme = prefs.theme === "noche" ? "dark" : "light"; root.dataset.themeByApp = "1"; }
    root.dataset.view = prefs.view;
    applyView();
    const badge = document.getElementById("view-badge");
    if (badge) badge.textContent = `Vista: ${currentView()}`;
  }
  function set(next) {
    prefs = { ...prefs, ...next };
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {}
    apply();
  }
  window.addEventListener("resize", () => { if (prefs.view === "auto") apply(); });
  window.JuanmaDisplay = { get: () => ({ ...prefs }), set, apply, currentView };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply); else apply();
})();
