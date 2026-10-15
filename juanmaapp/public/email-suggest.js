// E-mail fields suggest the common domains while typing: "maria" or "maria@h"
// offers maria@gmail.com, maria@hotmail.com and maria@outlook.com.
(() => {
  const DOMAINS = ["gmail.com", "hotmail.com", "outlook.com"];
  const list = document.createElement("datalist");
  list.id = "email-domains";

  function suggest(el) {
    if (el.getAttribute("list") !== list.id) el.setAttribute("list", list.id);
    const v = el.value.trim();
    const at = v.indexOf("@");
    const local = at < 0 ? v : v.slice(0, at);
    const typed = at < 0 ? "" : v.slice(at + 1).toLowerCase();
    const options = !local || /[\s,;]/.test(local) ? [] : DOMAINS.filter((d) => d.startsWith(typed) && d !== typed).map((d) => `${local}@${d}`);
    list.replaceChildren(...options.map((value) => Object.assign(document.createElement("option"), { value })));
  }

  function init() {
    document.body.append(list);
    document.addEventListener("input", (e) => { if (e.target.matches?.('input[type="email"]')) suggest(e.target); });
    document.addEventListener("focusin", (e) => { if (e.target.matches?.('input[type="email"]')) suggest(e.target); });
  }

  window.JuanmaEmailSuggest = { DOMAINS };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
