// Letterhead of every PDF the App writes (version 2.2.4), the same as John's Word template «Plantilla Membrete_Pie_Encab_Pagina»:
// page border, logo and QR on top, contact footer, «Página X de Y» and the faded Tecjuridicos logo as a watermark.
// One place for all the jsPDF documents: newPdf() makes the document with the letterhead already on page 1 (and on each page
// added later, behind the content), pdfBox() says where the text may go, finishPdf() writes the page numbers.
// Images: public/membrete-assets.js (built from the template by scripts/build-membrete.py).
(function () {
  const NAVY = [0, 43, 106], INK = [31, 56, 100];
  const FOOT = [
    ["pin", "Carrera 5 No. 29-32 Of.290 Centro Comercial La Quinta"], ["tel", "Tel. 314 415 6914 / 320 557 7777"],
    ["web", "www.tecjuridicos.com", "http://www.tecjuridicos.com"], ["mail", "gerencia@tecjuridicos.com", "mailto:gerencia@tecjuridicos.com"], ["loc", "Ibagué – Colombia"],
  ];

  /** Where the text of a page may go, in points: portrait letter has the template's margins (3.5 cm left, 3 cm right). */
  function pdfBox(doc) {
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    return W > H ? { left: 44, right: W - 44, top: 84, bottom: H - 64, W, H, landscape: true }
      : { left: 99, right: W - 85, top: 118, bottom: H - 140, W, H, landscape: false };
  }

  // jsPDF keeps font and colors in the document: draw the letterhead without disturbing the caller's.
  function keepState(doc, fn) {
    const f = doc.getFont(), size = doc.getFontSize(), text = doc.getTextColor(), draw = doc.getDrawColor(), fill = doc.getFillColor(), lw = doc.getLineWidth();
    try { fn(); } finally {
      doc.setFont(f.fontName, f.fontStyle); doc.setFontSize(size); doc.setTextColor(text); doc.setDrawColor(draw); doc.setFillColor(fill); doc.setLineWidth(lw);
    }
  }

  function frame(doc) {
    const A = window.JuanmaMembreteAssets;
    if (!A) return;
    const b = pdfBox(doc), { W, H } = b;
    keepState(doc, () => {
      const img = (a, x, y, w, h) => { try { doc.addImage(a.png, "PNG", x, y, w, h); } catch { /* the letterhead never stops a document */ } };
      // Watermark first, so it stays behind the text.
      const wmW = b.landscape ? 330 : 360;
      img(A.wm, (W - wmW) / 2, (H - wmW * A.wm.h / A.wm.w) / 2, wmW, wmW * A.wm.h / A.wm.w);
      doc.setDrawColor(...NAVY); doc.setLineWidth(1);
      doc.rect(24, 24, W - 48, H - 48);
      const lh = b.landscape ? 34 : 52.5;
      img(A.logo, b.left, b.landscape ? 34 : 36, lh * A.logo.w / A.logo.h, lh);
      img(A.qr, b.right - lh, b.landscape ? 34 : 36, lh, lh);
      doc.setFont("helvetica", "normal"); doc.setFontSize(b.landscape ? 7.5 : 8.5); doc.setTextColor(...INK);
      // Each icon fits a square of `box` points, as in the template's footer.
      const icon = (name, x, y, box) => { const a = A.icons[name], k = box / Math.max(a.w, a.h), w = a.w * k, h = a.h * k; img(a, x + (box - w) / 2, y - 3.2 - h / 2, w, h); };
      if (b.landscape) {
        // One line at the foot: the page is wide and short.
        const parts = FOOT.map(([n, t]) => [n, t]), gap = 14, ih = 8;
        const widths = parts.map(([, t]) => doc.getTextWidth(t) + ih + 3);
        let x = (W - (widths.reduce((a, c) => a + c, 0) + gap * (parts.length - 1))) / 2;
        parts.forEach(([n, t], i) => { icon(n, x, H - 46, ih); doc.text(t, x + ih + 3, H - 46); x += widths[i] + gap; });
      } else {
        FOOT.forEach(([n, t, link], i) => {
          const y = H - 119 + i * 13.2, tw = doc.getTextWidth(t), ih = 9;
          if (link) doc.textWithLink(t, b.right - tw, y, { url: link }); else doc.text(t, b.right - tw, y);
          icon(n, b.right - tw - ih - 4, y, ih);
        });
      }
    });
  }

  /** A letter-size jsPDF with the letterhead on its first page and on every page added afterwards. */
  function newPdf({ landscape = false } = {}) {
    const doc = new window.jspdf.jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "pt", format: "letter" });
    const addPage = doc.addPage.bind(doc);
    doc.addPage = (...args) => { const r = addPage(...args); frame(doc); return r; };
    frame(doc);
    return doc;
  }

  /** «Página X de Y» on every page; call it once, when the content is finished. */
  function finishPdf(doc) {
    if (!window.JuanmaMembreteAssets) return doc;
    const n = doc.getNumberOfPages(), here = doc.getCurrentPageInfo().pageNumber, b = pdfBox(doc);
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      keepState(doc, () => {
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...INK); doc.text(`Página ${i} de ${n}`, b.right, b.H - (b.landscape ? 34 : 46), { align: "right" });
        // Version 2.2.58: who generated the document, at the end of the footer.
        const who = String(window.JuanmaGeneratedBy?.() || "").trim();
        if (who) { doc.setTextColor(120, 120, 120); doc.setFontSize(7); doc.text(`Documento generado por: ${who}`, b.left, b.H - (b.landscape ? 34 : 46)); }
      });
    }
    doc.setPage(here);
    return doc;
  }

  window.JuanmaMembrete = { newPdf, finishPdf, pdfBox };
})();
