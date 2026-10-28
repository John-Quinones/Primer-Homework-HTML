// Version 2.2.90: letters written in HTML (first line <!--tj-html-->), like «Solicitud link de expediente».
// They keep the firm's design; the {{variables}} are filled here and the PDF is a picture of the letter on Letter pages.
(function () {
  const MARK = "<!--tj-html-->";
  const isHtml = (body) => String(body || "").trimStart().startsWith(MARK);

  const LABELS = {
    ciudad: "Ciudad", fecha_solicitud: "Fecha de la solicitud", nombre_juez_o_doctora: "Nombre del juez o doctora (destinatario)",
    cargo_despacho: "Cargo o despacho", correo_juzgado: "Correo del juzgado", ciudad_juzgado: "Ciudad del juzgado",
    tipo_actuacion: "Tipo de actuación (audiencia o diligencia)", demandante: "Demandante", demandado: "Demandado",
    numero_radicado: "Número de radicado", nombre_abogado: "Nombre del abogado", identificacion_abogado: "Identificación del abogado",
    nombre_cliente: "Nombre del cliente", cliente_del_senor: "«del señor» o «de la señora»", firma_nombre: "Su nombre completo para firmas (Usuarios)", firma_cc: "Su cédula (Usuarios)", firma_tarjeta: "Su tarjeta profesional (Usuarios)", firma_contacto: "Su correo (Usuarios)", firma_fecha: "Fecha de la firma", correo_abogado: "Correo del abogado", elaboro: "Quién elaboró",
  };
  const HINTS = {
    tipo_actuacion: "Ej.: Interrogatorio de parte", identificacion_abogado: "Ej.: C.C. No. 00.000.000 y T.P. No. 000.000 del C. S. de la J.",
    nombre_juez_o_doctora: "Ej.: YOLANDA VARGAS RUGELES", correo_juzgado: "Ej.: j03cmpaliba@cendoj.ramajudicial.gov.co",
  };

  const up = (x) => String(x || "").toLocaleUpperCase("es-CO");

  /** Values of the letter's variables from the data the document already has: the shared letter data (src/solicitud-link-letter.js) plus the lawyer's. */
  function fromCase(v, who, user) {
    const L = window.JuanmaSolicitudLink.letterFields(v), S = window.JuanmaSolicitudLink.signerView(user || {});
    return {
      ...L,
      cliente_del_senor: L.cliente_del_senor || "de",
      nombre_abogado: up(S.name),
      firma_nombre: S.name, firma_cc: S.id_number ? `CC. ${S.id_number}` : "", firma_tarjeta: S.card, firma_contacto: [S.email, S.phone].filter(Boolean).join(" · "),
      firma_fecha: "se registra al enviar", firma_codigo: "se emite al enviar",
      correo_abogado: "gerencia@tecjuridicos.com",
      elaboro: who || "",
    };
  }

  const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  /** The letter's HTML with every {{variable}}; a missing one is a yellow [FILL: …]. */
  const BLANK_OK = new Set(["documento.numero", "elaboro"]); // a letter without a memorial number (sent from the expediente menu) leaves them empty
  function fill(body, data, labels = {}) {
    return String(body).trimStart().slice(MARK.length).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key) => {
      const v = data[key];
      if ((v === undefined || v === null || String(v).trim() === "") && BLANK_OK.has(key)) return "";
      return v !== undefined && v !== null && String(v).trim() !== "" ? esc(String(v).trim()) : `<mark class="fill">[FILL: ${esc(labels[key] || LABELS[key] || key)}]</mark>`;
    });
  }

  // A clean sheet for the picture: no outer margin or shadow, and the dashed box where the signature module stamps is left empty.
  const SHEET_CSS = "<style>body{background:#fff!important;padding:0!important}.hoja{margin:0!important;box-shadow:none!important}.espacio-firma{border-color:transparent!important;color:transparent!important}mark.fill{print-color-adjust:exact}</style>";

  /**
   * {blob, spot}: the PDF of the letter (one Letter sheet: the letter is laid out on a 816 × 1056 px page) and where its signature space is,
   * as fractions of the page from the top-left, so the signature module stamps exactly there («at:X,Y»).
   */
  async function toPdfSpot(html) {
    if (!window.html2canvas || !window.jspdf) throw new Error("Esta pantalla no puede crear el PDF de la carta.");
    const fr = document.createElement("iframe");
    fr.style.cssText = "position:fixed;left:-20000px;top:0;width:816px;height:1100px;border:0";
    fr.srcdoc = html.replace("</head>", SHEET_CSS + "</head>");
    document.body.appendChild(fr);
    try {
      await new Promise((ok, no) => { fr.onload = ok; setTimeout(() => no(new Error("La carta no cargó.")), 15000); });
      const d = fr.contentDocument;
      await Promise.all([...d.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))));
      if (d.fonts?.ready) await d.fonts.ready;
      const sheet = d.querySelector(".hoja") || d.body;
      const box = sheet.getBoundingClientRect(), slot = d.querySelector(".espacio-firma")?.getBoundingClientRect();
      const shot = await window.html2canvas(sheet, { scale: 2, backgroundColor: "#ffffff", logging: false, useCORS: true, windowWidth: 816 });
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ unit: "pt", format: "letter", compress: true });
      pdf.addImage(shot.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 612, 792);
      const r4 = (n) => Math.min(1, Math.max(0, Math.round(n * 10000) / 10000));
      return { blob: pdf.output("blob"), spot: slot ? { x: r4((slot.left - box.left) / box.width), y: r4((slot.top - box.top) / box.height) } : null };
    } finally { fr.remove(); }
  }
  const toPdf = async (html) => (await toPdfSpot(html)).blob;

  window.JuanmaHtmlTemplate = { MARK, isHtml, LABELS, HINTS, fromCase, fill, toPdf, toPdfSpot };
})();
