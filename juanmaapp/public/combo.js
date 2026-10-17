// Type-ahead fields: as the user types, matching options appear below the
// input (names that start with the text first, then names with a word that
// starts with it). Accents are ignored, so "bogo" finds "Bogotá, D.C.".
// Also loads the DANE department and municipality list.
(function () {
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let divipola = window.JUANMA_DIVIPOLA || null;
  async function loadPlaces() {
    if (!divipola) divipola = await (await fetch("data/divipola.json")).json();
    return divipola;
  }

  /** Items whose label starts with q; from two letters on, also items with a word starting with q. */
  function filter(items, q, limit = 12) {
    const n = norm(q);
    if (!n) return items.slice(0, limit);
    const starts = [], words = [];
    for (const it of items) {
      const l = norm(it.label);
      if (l.startsWith(n)) starts.push(it);
      else if (n.length > 1 && l.split(/[\s,.()-]+/).some((w) => w.startsWith(n))) words.push(it);
      if (starts.length >= limit) break;
    }
    return [...starts, ...words].slice(0, limit);
  }

  /**
   * attach(input, { items: () => Promise<[{label, sub?, value?}]>|[...], onPick(item), strict })
   * strict: on blur, a typed value takes the option's spelling (IBAGUE → Ibagué; onMatch(item) when only one option has that name), and one that matches no option is cleared.
   */
  function attach(input, opts) {
    if (input._combo) return input._combo;
    const box = document.createElement("ul");
    box.className = "combo-list";
    box.setAttribute("role", "listbox");
    box.hidden = true;
    const id = "combo-" + Math.random().toString(36).slice(2, 8);
    box.id = id;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", id);
    input.setAttribute("aria-expanded", "false");
    input.parentElement.classList.add("combo-wrap");
    input.parentElement.append(box);
    let shown = [], active = -1;

    const close = () => { box.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
    const highlight = (i) => {
      active = i;
      [...box.children].forEach((li, j) => li.classList.toggle("active", j === i));
      if (i >= 0) box.children[i]?.scrollIntoView({ block: "nearest" });
    };
    async function open() {
      const all = await Promise.resolve(opts.items());
      shown = (opts.filter || filter)(all, input.value, opts.limit || 12);
      box.innerHTML = shown.map((it, i) => `<li role="option" data-i="${i}"><span>${esc(it.label)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</li>`).join("")
        || `<li class="combo-empty">${esc(opts.emptyText || "Sin coincidencias")}</li>`;
      box.hidden = false;
      input.setAttribute("aria-expanded", "true");
      highlight(shown.length && input.value ? 0 : -1);
    }
    function pick(i) {
      const it = shown[i];
      if (!it) return;
      input.value = it.label;
      close();
      opts.onPick?.(it);
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    input.addEventListener("input", () => { opts.onType?.(); open(); });
    input.addEventListener("focus", open);
    input.addEventListener("keydown", (e) => {
      if (box.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) { open(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); highlight(Math.min(active + 1, shown.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); highlight(Math.max(active - 1, 0)); }
      else if (e.key === "Enter" && !box.hidden && active >= 0) { e.preventDefault(); pick(active); }
      else if (e.key === "Escape" && !box.hidden) { e.stopPropagation(); e.preventDefault(); close(); }
      else if (e.key === "Tab" && !box.hidden && active >= 0 && input.value) pick(active);
    });
    box.addEventListener("mousedown", (e) => {
      const li = e.target.closest("[data-i]");
      if (li) { e.preventDefault(); pick(Number(li.dataset.i)); }
    });
    input.addEventListener("blur", async () => {
      setTimeout(close, 120);
      if (opts.strict && input.value) {
        const all = await Promise.resolve(opts.items());
        const hits = all.filter((it) => norm(it.label) === norm(input.value));
        if (hits.length) { input.value = hits[0].label; if (hits.length === 1) opts.onMatch?.(hits[0]); } else { input.value = ""; opts.onClear?.(); }
      }
    });
    input._combo = { open, close };
    return input._combo;
  }

  /**
   * Items whose name or document holds every typed word, anywhere (accents and case ignored;
   * "1234567" also finds "CC 1.234.567"). Names that start with the text come first.
   */
  function filterAnywhere(items, q, limit = 50) {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return items.slice(0, limit);
    const starts = [], wordStarts = [], inside = [];
    const nq = norm(q);
    for (const it of items) {
      const l = norm(it.label), hay = l + " " + norm(it.sub), digits = (it.label + " " + (it.sub || "")).replace(/\D/g, "");
      const ok = words.every((w) => hay.includes(w) || (/^\d[\d.,\s-]*$/.test(w) && digits.includes(w.replace(/\D/g, ""))));
      if (!ok) continue;
      if (l.startsWith(nq)) starts.push(it);
      else if (l.split(/[\s,.()-]+/).some((w) => w.startsWith(words[0]))) wordStarts.push(it);
      else inside.push(it);
    }
    return [...starts, ...wordStarts, ...inside].slice(0, limit);
  }

  /**
   * Turn a <select> into a search box: a text field shows the chosen option and, while typing any
   * letter or word, lists the options whose text (or data-sub, e.g. the document number) holds it.
   * The <select> stays in the form (hidden) and keeps its value and "change" event, so code that
   * reads or sets select.value, refills its options or disables it keeps working.
   */
  function searchSelect(select, opts = {}) {
    if (select._search) return select._search;
    const wrap = document.createElement("span");
    wrap.className = "select-search";
    const input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = opts.placeholder || "Escriba nombre o documento para buscar…";
    input.setAttribute("aria-label", opts.label || "Buscar cliente");
    select.before(wrap);
    wrap.append(input, select);
    select.classList.add("select-search-native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    const chosenLabel = () => select.selectedOptions[0]?.textContent.trim() || "";
    // While the user is typing the text stays; otherwise the field shows the chosen option (selected, so typing replaces it).
    const sync = () => {
      input.disabled = select.disabled;
      if (input.dataset.typed) return;
      input.value = select.value || opts.showEmpty ? chosenLabel() : "";
      if (document.activeElement === input) input.select();
    };
    const items = () => [...select.options].map((o) => ({ label: o.textContent.trim(), sub: o.dataset.sub || "", value: o.value }));

    attach(input, {
      items, limit: opts.limit || 60, emptyText: "Ningún cliente coincide con lo escrito",
      // Right after focusing, the field still shows the chosen name: list everything until the user types.
      filter: (all, q, limit) => filterAnywhere(all, input.dataset.typed ? q : "", limit),
      onType: () => { input.dataset.typed = "1"; },
      onPick: (it) => {
        delete input.dataset.typed;
        select.value = it.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        input.value = it.label;
      },
    });
    input.addEventListener("focus", () => { delete input.dataset.typed; input.select(); });
    input.addEventListener("change", (e) => e.stopPropagation()); // the select's own change is the one that counts
    // Leaving the field without picking puts back the client that is chosen.
    input.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== input) { delete input.dataset.typed; sync(); } }, 150));

    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    Object.defineProperty(select, "value", { configurable: true, get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); sync(); } });
    new MutationObserver(sync).observe(select, { childList: true, attributes: true, attributeFilter: ["disabled"] });
    select.addEventListener("change", sync);
    select.form?.addEventListener("reset", () => setTimeout(sync));
    select._search = { input, sync };
    sync();
    return select._search;
  }

  async function departments() {
    const d = await loadPlaces();
    return d.departamentos.map((x) => ({ label: x.name, value: x.code }));
  }
  async function cities(depName) {
    const d = await loadPlaces();
    const dep = d.departamentos.find((x) => norm(x.name) === norm(depName));
    const depByCode = new Map(d.departamentos.map((x) => [x.code, x.name]));
    return d.municipios.filter((m) => !dep || m.dep === dep.code)
      .map((m) => ({ label: m.name, value: m.code, sub: dep ? "" : depByCode.get(m.dep), dep: depByCode.get(m.dep) }));
  }
  async function placeFromRadicado(r) {
    const code = String(r).replace(/\D/g, "").slice(0, 5);
    if (code.length < 5) return null;
    const d = await loadPlaces();
    const m = d.municipios.find((x) => x.code === code);
    return m ? { department: d.departamentos.find((x) => x.code === m.dep).name, city: m.name } : null;
  }

  /** Wire every [data-combo=dep|city] inside root. City fields follow the department field named in data-dep. */
  function wirePlaces(root = document) {
    for (const input of root.querySelectorAll('input[data-combo="dep"]')) {
      attach(input, {
        items: departments, strict: true,
        onPick: () => {
          const form = input.form || input.closest(".panel, form, section");
          form?.querySelectorAll('input[data-combo="city"]').forEach((c) => { if (c.dataset.dep && form.querySelector(c.dataset.dep) === input) c.value = ""; });
        },
      });
    }
    for (const input of root.querySelectorAll('input[data-combo="city"]')) {
      const scope = input.form || input.closest(".panel, form, section");
      const depInput = () => scope.querySelector(input.dataset.dep);
      attach(input, {
        items: () => cities(depInput()?.value || ""), strict: true, limit: 15,
        onPick: (it) => { const dep = depInput(); if (dep && !dep.value) dep.value = it.dep; },
        onMatch: (it) => { const dep = depInput(); if (dep && !dep.value) dep.value = it.dep; },
      });
    }
  }

  window.JuanmaCombo = { attach, filter, filterAnywhere, searchSelect, norm, departments, cities, placeFromRadicado, wirePlaces, loadPlaces };
})();
