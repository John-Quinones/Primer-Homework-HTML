// Version 2.44: the PDF of a Word minuta keeps the Word's look (letterhead, logo, bold, footer).
// docx-preview draws the .docx as pages in a hidden box, html2canvas photographs each page and
// jsPDF puts the pictures on letter pages. A page longer than one sheet is cut at a blank line.
(function () {
  const pageOf = (sec) => {
    const cs = getComputedStyle(sec);
    const w = sec.offsetWidth, minH = parseFloat(cs.minHeight) || w * 11 / 8.5;
    return { w, h: minH, top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  };
  // The lowest all-white row between `from` and `to` (canvas pixels), else `to`.
  function blankRow(ctx, width, from, to) {
    for (let y = Math.floor(to); y > from; y -= 2) {
      const row = ctx.getImageData(0, y, width, 1).data;
      let white = true;
      for (let x = 0; x < row.length; x += 16) if (row[x] < 245 || row[x + 1] < 245 || row[x + 2] < 245) { white = false; break; }
      if (white) return y;
    }
    return Math.floor(to);
  }

  /** PDF Blob of a .docx, as it looks in Word (pictures of the pages). */
  async function docxToPdf(bytes) {
    if (!window.docx?.renderAsync || !window.html2canvas || !window.jspdf) throw new Error("Sin visor de Word en esta página.");
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;left:-20000px;top:0;width:1200px;background:#fff;color:#000";
    document.body.appendChild(box);
    try {
      await window.docx.renderAsync(bytes, box, null, { inWrapper: false, ignoreLastRenderedPageBreak: false, experimental: true, useBase64URL: true });
      const sections = [...box.querySelectorAll("section.docx")];
      if (!sections.length) throw new Error("El Word no tiene páginas.");
      const { jsPDF } = window.jspdf;
      const scale = 2;
      let pdf = null;
      const addPage = (canvas, p) => {
        const size = [p.w * 0.75, p.h * 0.75];
        if (!pdf) pdf = new jsPDF({ unit: "pt", format: size, compress: true }); else pdf.addPage(size);
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.88), "JPEG", 0, 0, size[0], size[1]);
      };
      for (const sec of sections) {
        const p = pageOf(sec);
        const shot = await window.html2canvas(sec, { scale, backgroundColor: "#ffffff", logging: false, useCORS: true });
        const ctx = shot.getContext("2d", { willReadFrequently: true });
        const pageH = p.h * scale, top = p.top * scale, bottom = p.bottom * scale;
        let start = 0, first = true;
        while (start < shot.height - 2) {
          const room = first ? pageH : pageH - top - bottom;
          const end = start + room >= shot.height ? shot.height : blankRow(ctx, shot.width, start + room * 0.6, start + room - (first ? bottom : 0));
          const page = document.createElement("canvas");
          page.width = shot.width;
          page.height = Math.round(pageH);
          const pc = page.getContext("2d");
          pc.fillStyle = "#fff";
          pc.fillRect(0, 0, page.width, page.height);
          pc.drawImage(shot, 0, start, shot.width, end - start, 0, first ? 0 : top, shot.width, end - start);
          addPage(page, p);
          if (end - start < 4) break;
          start = end;
          first = false;
        }
      }
      return pdf.output("blob");
    } finally {
      box.remove();
    }
  }
  window.JuanmaDocxPdf = { docxToPdf };
})();
