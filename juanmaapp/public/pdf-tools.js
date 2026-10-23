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

  // Every PDF has the letterhead (public/membrete.js, version 2.2.4); without it (tests) a plain letter page.
  const MB = () => window.JuanmaMembrete || {
    newPdf: () => new window.jspdf.jsPDF({ unit: "pt", format: "letter" }), finishPdf: (d) => d,
    pdfBox: (d) => ({ left: 64, right: d.internal.pageSize.getWidth() - 64, top: 64, bottom: d.internal.pageSize.getHeight() - 64, W: d.internal.pageSize.getWidth(), H: d.internal.pageSize.getHeight() }),
  };

  function markdownToPdf(md, { returnDoc = false } = {}) {
    const doc = MB().newPdf(), box = MB().pdfBox(doc);
    const margin = box.left, width = box.right - box.left, bottom = box.bottom;
    let y = box.top;
    const write = (text, { size = 11, bold = false, gap = 6, indent = 0 } = {}) => {
      doc.setFont("times", bold ? "bold" : "normal");
      doc.setFontSize(size);
      let open = false; // a [FILL: …] that wraps to the next line stays highlighted (version 2.47)
      for (const line of doc.splitTextToSize(text, width - indent)) {
        if (y > bottom) { doc.addPage(); y = box.top; }
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
    MB().finishPdf(doc);
    return returnDoc ? doc : doc.output("blob");
  }

  // Certificate: document identity + each signature's evidence + audit trail.
  function signatureCertificate(r) {
    const doc = MB().newPdf(), box = MB().pdfBox(doc);
    const W = box.W, M = box.left, TOP = box.top, END = box.bottom;
    let y = TOP;
    const line = (t, { size = 10, bold = false, color = [16, 16, 16], gap = 4 } = {}) => {
      doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(...color);
      for (const l of doc.splitTextToSize(String(t), box.right - M)) { if (y > END) { doc.addPage(); y = TOP; } doc.text(l, M, y); y += size * 1.35; }
      y += gap;
    };
    line("CERTIFICADO DE FIRMA ELECTRÓNICA", { size: 16, bold: true, color: [0, 43, 106] });
    line(`Documento: ${r.title}`, { size: 11, bold: true });
    line(`Solicitud N.º ${r.id} · Estado: ${STATUS[r.status] || r.status}${r.completed_at ? ` · completado ${co(r.completed_at)}` : ""}`);
    if (r.verify_code) line(`Código de verificación: ${r.verify_code}${r.verify_url ? ` · ${r.verify_url}` : ""}`, { bold: true });
    line(`Huella del documento original (SHA-256): ${r.doc_hash}`, { size: 9 });
    line("La huella identifica el contenido exacto que se firmó: cualquier cambio en el documento produce una huella distinta. Para comprobar este PDF firmado, cárguelo en la página de verificación: la app calcula su huella y la compara con la que quedó registrada al completarse las firmas.", { size: 8, color: [90, 90, 90], gap: 10 });
    for (const x of r.signers) {
      if (y > END - 120) { doc.addPage(); y = TOP; }
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
      if (y > END - 70) { doc.addPage(); y = TOP; }
      line("Registro de eventos (hora UTC)", { size: 12, bold: true, color: [0, 43, 106] });
      for (const e of r.events) line(`${e.at} · ${e.event.replace(/_/g, " ")}${e.detail ? " · " + e.detail : ""}${e.ip ? " · IP " + e.ip : ""}`, { size: 8, gap: 1 });
      y += 8;
    }
    line("Firma electrónica con verificación de identidad por código de un solo uso (correo, SMS o WhatsApp) o en persona con testigo, conforme a la Ley 527 de 1999 y el Decreto 2364 de 2012. Generado por TecjuridicosApp.", { size: 8, color: [90, 90, 90] });
    MB().finishPdf(doc);
    return doc.output("blob");
  }

  // pdf-lib's standard fonts write WinAnsi: drop what it cannot encode instead of failing.
  const ansi = (t) => String(t ?? "").replace(/[^\x20-\x7E -ÿ–—‘’“”•…€]/g, "");

  const STAMP = { w: 250, h: 104, gap: 8, margin: 26, footer: 28 };
  // «2026-10-19 14:58:20 -05:00»: the stored UTC time as Colombia time with its offset (version 2.60).
  const isoCo = (utc) => (utc ? new Date(Date.parse(String(utc).replace(" ", "T") + "Z") - 5 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ") + " -05:00" : "");
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
   * the verification footer. `lift` raises the corner stamps of a document the App wrote itself: its letterhead footer is at the bottom (2.2.4).
   */
  function stampBoxes(width, height, n, pos = "br", top = 0, lift = 0) {
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
      const y = pos.startsWith("t") ? height - margin - top - h - row * (h + gap) : margin + 14 + lift + row * (h + gap);
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
    const wm = window.JuanmaLogoWm ? await pdf.embedPng(window.JuanmaLogoWm.png).catch(() => null) : null;
    const verifyText = r.verify_code ? (r.verify_url ? `${r.verify_url}#${r.verify_code}` : `TecjuridicosApp · verificación de firma electrónica · código ${r.verify_code}`) : "";
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
      stampBoxes(width, height, signed.length, pos, top, originalBytes ? 0 : 90).forEach(({ x, y }, i) => {
        const s = signed[i];
        page.drawRectangle({ x, y, width: boxW, height: boxH, color: rgb(1, 1, 1), opacity: 0.94 });
        // Tecjuridicos logo faded behind the whole stamp (version 2.60).
        if (wm) { const zone = boxW - 74, k = Math.min(zone / wm.width, (boxH - 8) / wm.height); page.drawImage(wm, { x: x + 70 + (zone - wm.width * k) / 2, y: y + (boxH - wm.height * k) / 2, width: wm.width * k, height: wm.height * k, opacity: 0.55 }); }
        // QR with the verification link (navy, transparent background) and, under the name, the signature data.
        const qr = verifyText ? window.JuanmaQr?.modules?.(`${verifyText}`) : null;
        const qs = 58, cell = qr ? qs / qr.length : 0, qx = x + 6, qy = y + boxH - 6 - qs;
        if (qr) qr.forEach((row, ri) => row.forEach((dark, ci) => dark && page.drawRectangle({ x: qx + ci * cell, y: qy + qs - (ri + 1) * cell, width: cell + 0.05, height: cell + 0.05, color: navy })));
        const left = x + (qr ? qs + 14 : 8);
        const put = (text, dx, dy, f, size, color, max = 40) => page.drawText(ansi(text).slice(0, max), { x: dx, y: y + dy, size, font: f, color });
        put(s.typed_name || s.name, left, boxH - 16, font, 9, gray, 34);
        put(`${s.id_type || "CC"}. ${s.id_number || ""}`.trim(), left, boxH - 28, font, 9, gray);
        put("Firma Electrónica", left, boxH - 42, bold, 6.5, blue);
        put(isoCo(s.signed_at), left, boxH - 50, font, 6.5, blue);
        const bx = x + 6;
        put(s.typed_name || s.name, bx, 24, bold, 7.4, rgb(0.06, 0.06, 0.06), 52);
        put([`${s.id_type || ""} ${s.id_number || ""}`.trim(), s.email, s.phone].filter(Boolean).join(" · "), bx, 15, font, 6.4, rgb(0.1, 0.1, 0.1), 66);
        put(s.method === "presencial" ? "Verificación: en persona con testigo"
          : `Verificación: código OTP por ${s.otp_channel === "sms" ? "SMS" : s.otp_channel === "whatsapp" ? "WhatsApp" : "correo"}`, bx, 6, font, 6, gray, 66);
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
