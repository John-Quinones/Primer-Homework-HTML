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
      const label = Object.assign(document.createElement("p"), { className: "pdf-page-label", textContent: `Página ${n} de ${doc.numPages}` });
      box.append(canvas, label);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    }
    if (doc.numPages > shown) box.append(Object.assign(document.createElement("p"), { className: "hint", textContent: `Se muestran las primeras ${shown} de ${doc.numPages} páginas.` }));
    await doc.destroy();
    return doc.numPages;
  }

  window.JuanmaPdfView = { render, load };
})();
