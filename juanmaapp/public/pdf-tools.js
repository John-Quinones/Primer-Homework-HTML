// PDF tools shared by the app and the signer's page (firmar.html):
// text → PDF (jsPDF), the signature certificate, and the signed document:
// the original PDF with a signature stamp per signer on the chosen page and
// position, a verification footer on every page and the certificate appended
// (pdf-lib), as signature platforms do.
(function () {
  const STATUS = { enviada: "En curso", completada: "Firmado por todos", cancelada: "Cancelada", rechazada: "Rechazada" };
  const CHANNEL = { email: "correo electrónico", sms: "mensaje de texto (SMS)", whatsapp: "WhatsApp" };
  // Stored times are UTC; documents show Colombia time (UTC-5, no daylight saving).
  const co = (utc) => (utc ? new Date(Date.parse(String(utc).replace(" ", "T") + "Z") - 5 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") + " (hora de Colombia)" : "");
  const methodText = (x) => (x.method === "presencial" ? "en persona, con testigo"
    : `enlace privado y código de un solo uso enviado por ${CHANNEL[x.otp_channel] || CHANNEL.email}${x.otp_to ? " a " + x.otp_to : x.email ? " a " + x.email : ""}`);

  function markdownToPdf(md, { returnDoc = false } = {}) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    const margin = 64, width = doc.internal.pageSize.getWidth() - margin * 2, bottom = doc.internal.pageSize.getHeight() - margin;
    let y = margin;
    const write = (text, { size = 11, bold = false, gap = 6, indent = 0 } = {}) => {
      doc.setFont("times", bold ? "bold" : "normal");
      doc.setFontSize(size);
      let open = false; // a [FILL: …] that wraps to the next line stays highlighted (version 2.47)
      for (const line of doc.splitTextToSize(text, width - indent)) {
        if (y > bottom) { doc.addPage(); y = margin; }
        const spans = [];
        let from = open ? 0 : -1;
        for (let i = 0; i < line.length; i++) {
          if (from < 0 && line.startsWith("[FILL:", i)) from = i;
          else if (from >= 0 && line[i] === "]") { spans.push([from, i + 1]); from = -1; }
        }
        open = from >= 0;
        if (open) spans.push([from, line.length]);
        if (spans.length) {
          doc.setFillColor(255, 236, 102);
          for (const [a, z] of spans) doc.rect(margin + indent + doc.getTextWidth(line.slice(0, a)), y - size * 0.82, doc.getTextWidth(line.slice(a, z)), size * 1.1, "F");
        }
        doc.text(line, margin + indent, y);
        y += size * 1.35;
      }
      y += gap;
    };
    const clean = (t) => t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/`([^`]+)`/g, "$1");
    for (const raw of md.split("\n")) {
      const line = raw.trimEnd();
      if (!line.trim()) { y += 4; continue; }
      let m;
      if ((m = line.match(/^(#{1,3})\s+(.*)/))) write(clean(m[2]), { size: [16, 13, 12][m[1].length - 1], bold: true, gap: 8 });
      else if ((m = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/))) write("• " + clean(m[1]), { indent: 14, gap: 2 });
      else if (/^\|/.test(line)) { if (!/^\|\s*-/.test(line)) write(clean(line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).join("   ")), { gap: 2 }); }
      else if (/^---+$/.test(line)) { doc.line(margin, y, margin + width, y); y += 12; }
      else if (/^>\s?/.test(line)) write(clean(line.replace(/^>\s?/, "")), { indent: 14, gap: 4 });
      else write(clean(line));
    }
    return returnDoc ? doc : doc.output("blob");
  }

  // Certificate: document identity + each signature's evidence + audit trail.
  function signatureCertificate(r) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48;
    let y = M;
    const line = (t, { size = 10, bold = false, color = [16, 16, 16], gap = 4 } = {}) => {
      doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(...color);
      for (const l of doc.splitTextToSize(String(t), W - 2 * M)) { if (y > H - M) { doc.addPage(); y = M; } doc.text(l, M, y); y += size * 1.35; }
      y += gap;
    };
    line("CERTIFICADO DE FIRMA ELECTRÓNICA", { size: 16, bold: true, color: [0, 43, 106] });
    line(`Documento: ${r.title}`, { size: 11, bold: true });
    line(`Solicitud N.º ${r.id} · Estado: ${STATUS[r.status] || r.status}${r.completed_at ? ` · completado ${co(r.completed_at)}` : ""}`);
    if (r.verify_code) line(`Código de verificación: ${r.verify_code}${r.verify_url ? ` · ${r.verify_url}` : ""}`, { bold: true });
    line(`Huella del documento original (SHA-256): ${r.doc_hash}`, { size: 9 });
    line("La huella identifica el contenido exacto que se firmó: cualquier cambio en el documento produce una huella distinta. Para comprobar este PDF firmado, cárguelo en la página de verificación: la app calcula su huella y la compara con la que quedó registrada al completarse las firmas.", { size: 8, color: [90, 90, 90], gap: 10 });
    for (const x of r.signers) {
      if (y > H - 190) { doc.addPage(); y = M; }
      line(`${x.name} · ${x.id_type} ${x.id_number}`.trim(), { size: 11, bold: true });
      if (x.status === "firmado") {
        line(`Firmó: ${co(x.signed_at)} · Verificación: ${methodText(x)}`);
        line(`Nombre escrito: ${x.typed_name || ""} · IP: ${x.ip || "—"}`);
        line(`Navegador: ${x.user_agent || "—"}`, { size: 8, color: [90, 90, 90] });
        try { doc.addImage(x.signature_png, "PNG", M, y, 180, 60); } catch {}
        doc.setDrawColor(150); doc.line(M, y + 62, M + 200, y + 62);
        y += 78;
      } else {
        line(x.status === "rechazado" ? `No firmó: ${x.reject_reason || ""}` : "Pendiente de firma", { color: [168, 103, 10], gap: 10 });
      }
    }
    if (r.events?.length) {
      if (y > H - 120) { doc.addPage(); y = M; }
      line("Registro de eventos (hora UTC)", { size: 12, bold: true, color: [0, 43, 106] });
      for (const e of r.events) line(`${e.at} · ${e.event.replace(/_/g, " ")}${e.detail ? " · " + e.detail : ""}${e.ip ? " · IP " + e.ip : ""}`, { size: 8, gap: 1 });
      y += 8;
    }
    line("Firma electrónica con verificación de identidad por código de un solo uso (correo, SMS o WhatsApp) o en persona con testigo, conforme a la Ley 527 de 1999 y el Decreto 2364 de 2012. Generado por TecjuridicosApp.", { size: 8, color: [90, 90, 90] });
    return doc.output("blob");
  }

  // pdf-lib's standard fonts write WinAnsi: drop what it cannot encode instead of failing.
  const ansi = (t) => String(t ?? "").replace(/[^\x20-\x7E -ÿ–—‘’“”•…€]/g, "");

  const STAMP = { w: 170, h: 78, gap: 8, margin: 26, footer: 28 };
  // "at:X,Y": top-left corner of the first stamp as a fraction (0–1) of the page width and height,
  // measured from the top-left corner, as the sender placed it on the preview (version 2.25).
  function stampSpot(pos) {
    const m = /^at:([01](?:\.\d{1,4})?),([01](?:\.\d{1,4})?)$/.exec(String(pos || ""));
    if (!m) return null;
    const fx = Number(m[1]), fy = Number(m[2]);
    return fx <= 1 && fy <= 1 ? { fx, fy } : null;
  }
  /**
   * Where each of `n` signature stamps goes on a page (PDF points, origin bottom-left).
   * Corners line the stamps up from that corner; a chosen spot puts the first stamp
   * there and the rest to its right, then below, always inside the page and above
   * the verification footer.
   */
  function stampBoxes(width, height, n, pos = "br", top = 0) {
    const { w, h, gap, margin, footer } = STAMP, out = [];
    const spot = stampSpot(pos);
    if (spot) {
      const x0 = Math.min(Math.max(0, spot.fx * width), Math.max(0, width - w));
      const perRow = Math.max(1, Math.floor((width - x0 + gap) / (w + gap)));
      const rows = Math.ceil(n / perRow), tall = rows * (h + gap) - gap;
      const yTop = Math.max(0, Math.min(spot.fy * height, height - footer - tall));
      for (let i = 0; i < n; i++) {
        const row = Math.floor(i / perRow), col = i % perRow;
        out.push({ x: x0 + col * (w + gap), y: height - yTop - h - row * (h + gap), w, h });
      }
      return out;
    }
    const perRow = Math.max(1, Math.floor((width - 2 * margin + gap) / (w + gap)));
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / perRow), col = i % perRow;
      const inRow = Math.min(perRow, n - row * perRow);
      const span = inRow * (w + gap) - gap;
      const x0 = pos.endsWith("l") ? margin : pos.endsWith("r") ? width - margin - span : (width - span) / 2;
      const y = pos.startsWith("t") ? height - margin - top - h - row * (h + gap) : margin + 14 + row * (h + gap);
      out.push({ x: x0 + col * (w + gap), y, w, h });
    }
    return out;
  }

  /**
   * The signed document: original PDF (or the text as PDF), one stamp per
   * signer on the chosen page(s) and corner, a verification footer on every
   * page, and the certificate pages at the end.
   * r.stamp_page: "last" | "first" | "all" | "new" | page number;
   * r.stamp_pos: "br" | "bc" | "bl" | "tr" | "tl" | "at:X,Y" (spot chosen on the preview, see stampBoxes).
   */
  async function signedPdf(r, originalBytes = null) {
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const base = originalBytes || new Uint8Array(await markdownToPdf(r.doc_text || "").arrayBuffer());
    const pdf = await PDFDocument.load(base, { ignoreEncryption: true });
    const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const navy = rgb(0, 43 / 255, 106 / 255), blue = rgb(2 / 255, 124 / 255, 198 / 255), gray = rgb(0.35, 0.35, 0.35);
    const signed = r.signers.filter((s) => s.status === "firmado");
    const images = await Promise.all(signed.map((s) => pdf.embedPng(s.signature_png).catch(() => null)));
    const pages = pdf.getPages();
    const verifyLine = r.verify_code ? ` · Verifique en ${r.verify_url || "TecjuridicosApp → Firmas → Verificar"} con el código ${r.verify_code}` : "";
    for (const page of pages) {
      page.drawText(ansi(`Firmado electrónicamente en TecjuridicosApp · Solicitud N.º ${r.id}${verifyLine}`), { x: 24, y: 18, size: 6.5, font, color: gray });
      page.drawText(ansi(`SHA-256 del documento original: ${r.doc_hash}`), { x: 24, y: 9, size: 5.6, font, color: gray });
    }
    const where = String(r.stamp_page || "last");
    let targets, pos = r.stamp_pos || "br";
    if (where === "new") {
      const { width, height } = pages.at(-1).getSize();
      const p = pdf.addPage([width, height]);
      p.drawText("FIRMAS ELECTRÓNICAS", { x: 48, y: height - 60, size: 14, font: bold, color: navy });
      p.drawText(ansi(`${r.title} · Solicitud N.º ${r.id}`), { x: 48, y: height - 78, size: 9, font, color: gray });
      targets = [{ page: p, top: 100 }];
      if (!stampSpot(pos)) pos = "tl";
    } else {
      const n = /^\d+$/.test(where) ? Math.min(pages.length, Math.max(1, Number(where))) - 1 : null;
      targets = (where === "all" ? pages : where === "first" ? [pages[0]] : n !== null ? [pages[n]] : [pages.at(-1)]).map((page) => ({ page, top: 0 }));
    }
    for (const { page, top } of targets) {
      const { width, height } = page.getSize();
      const boxW = STAMP.w, boxH = STAMP.h;
      stampBoxes(width, height, signed.length, pos, top).forEach(({ x, y }, i) => {
        const s = signed[i];
        page.drawRectangle({ x, y, width: boxW, height: boxH, color: rgb(1, 1, 1), opacity: 0.94, borderColor: blue, borderWidth: 0.8 });
        const img = images[i];
        if (img) {
          const k = Math.min(110 / img.width, 30 / img.height);
          page.drawImage(img, { x: x + 6, y: y + boxH - 6 - img.height * k, width: img.width * k, height: img.height * k });
        }
        const t = (text, dy, f = font, size = 6.6, color = rgb(0.1, 0.1, 0.1)) => page.drawText(ansi(text).slice(0, 52), { x: x + 6, y: y + dy, size, font: f, color });
        t(s.typed_name || s.name, 31, bold, 7.4, navy);
        t(`${s.id_type || ""} ${s.id_number || ""}`.trim(), 22.5);
        t(`Firmó: ${co(s.signed_at).replace(" (hora de Colombia)", " (hora Colombia)")}`, 14);
        t(s.method === "presencial" ? "Verificación: en persona con testigo"
          : `Verificación: código OTP por ${s.otp_channel === "sms" ? "SMS" : s.otp_channel === "whatsapp" ? "WhatsApp" : "correo"}`, 5.5, font, 6.2, gray);
      });
    }
    const cert = await PDFDocument.load(await signatureCertificate(r).arrayBuffer());
    for (const p of await pdf.copyPages(cert, cert.getPageIndices())) pdf.addPage(p);
    pdf.setTitle(ansi(`${r.title} - firmado`));
    pdf.setProducer("TecjuridicosApp");
    return new Blob([await pdf.save()], { type: "application/pdf" });
  }

  window.JuanmaPdf = { markdownToPdf, signatureCertificate, signedPdf, stampBoxes, stampSpot, STAMP, colombiaTime: co };
})();
