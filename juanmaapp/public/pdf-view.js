// Shows every page of a PDF as images inside a box (version 2.3), before sending it to sign,
// on the signer's page and in the request detail. pdf.js loads on first use.
(function () {
  let loading = null;
  const addScript = (attrs) => new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement("script"), attrs);
    s.onload = resolve; s.onerror = () => reject(new Error("No se pudo cargar el visor de PDF."));
    document.head.append(s);
    if (!attrs.src) resolve(); // inline code runs at once
  });
  async function load() {
    if (window.pdfjsLib && window.pdfjsWorker) return window.pdfjsLib;
    loading ||= (async () => {
      const inline = document.getElementById("pdfjs-code"); // single-file published link
      if (inline) {
        await addScript({ textContent: document.getElementById("pdfjs-worker-code").textContent });
        await addScript({ textContent: inline.textContent });
      } else {
        await addScript({ src: "vendor/pdfjs-worker.js" });
        await addScript({ src: "vendor/pdfjs.js" });
      }
      if (!window.pdfjsLib) throw new Error("No se pudo cargar el visor de PDF.");
      return window.pdfjsLib;
    })();
    try { return await loading; } catch (e) { loading = null; throw e; }
  }

  /** Draws the pages of `bytes` (Uint8Array) in `box`. Returns the number of pages. */
  async function render(box, bytes, { maxPages = 60 } = {}) {
    box.replaceChildren(Object.assign(document.createElement("p"), { className: "hint", textContent: "Cargando la vista previa…" }));
    box.hidden = false;
    const lib = await load();
    const doc = await lib.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false }).promise;
    box.replaceChildren();
    const width = Math.max(280, Math.min(box.clientWidth || 800, 900) - 4);
    const scaleDpr = Math.min(window.devicePixelRatio || 1, 2);
    const shown = Math.min(doc.numPages, maxPages);
    for (let n = 1; n <= shown; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (width / base.width) * scaleDpr });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
      canvas.className = "pdf-page";
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `Página ${n} de ${doc.numPages}`);
      // Each page sits in its own sheet, so the signature spot can be drawn and moved over it (version 2.25).
      const sheet = Object.assign(document.createElement("div"), { className: "pdf-sheet" });
      Object.assign(sheet.dataset, { page: n, w: base.width, h: base.height });
      sheet.append(canvas);
      const label = Object.assign(document.createElement("p"), { className: "pdf-page-label", textContent: `Página ${n} de ${doc.numPages}` });
      box.append(sheet, label);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    }
    if (doc.numPages > shown) box.append(Object.assign(document.createElement("p"), { className: "hint", textContent: `Se muestran las primeras ${shown} de ${doc.numPages} páginas.` }));
    await doc.destroy();
    return doc.numPages;
  }

  /** Pages (numbers) that get the stamps for r.stamp_page, as JuanmaPdf.signedPdf picks them. */
  function stampPages(where, total) {
    where = String(where || "last");
    if (where === "all") return Array.from({ length: total }, (_, i) => i + 1);
    if (where === "first") return [1];
    if (/^\d+$/.test(where)) return [Math.min(total, Math.max(1, Number(where)))];
    return where === "new" ? [] : [total];
  }

  /**
   * Draws where the signatures will be stamped (dashed boxes) over the pages shown in `box`.
   * { page, pos, n, label }: stamp_page, stamp_pos, number of signers. Returns the boxes drawn.
   */
  function markStamps(box, { page, pos, n = 1, label = "Aquí va la firma" } = {}) {
    box.querySelectorAll(".stamp-mark").forEach((m) => m.remove());
    const sheets = [...box.querySelectorAll(".pdf-sheet")];
    const marks = [];
    for (const p of stampPages(page, sheets.length)) {
      const sheet = sheets[p - 1], W = Number(sheet.dataset.w), H = Number(sheet.dataset.h);
      window.JuanmaPdf.stampBoxes(W, H, Math.max(1, n), pos || "br").forEach((b, i) => {
        const m = Object.assign(document.createElement("div"), { className: "stamp-mark", textContent: n > 1 ? `${label} (${i + 1})` : label });
        Object.assign(m.style, { left: `${(b.x / W) * 100}%`, top: `${((H - b.y - b.h) / H) * 100}%`, width: `${(b.w / W) * 100}%`, height: `${(b.h / H) * 100}%` });
        m.dataset.page = p;
        sheet.append(m);
        marks.push(m);
      });
    }
    return marks;
  }

  window.JuanmaPdfView = { render, load, markStamps, stampPages };
})();
