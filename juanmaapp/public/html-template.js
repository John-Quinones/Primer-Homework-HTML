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
    nombre_cliente: "Nombre del cliente", correo_abogado: "Correo del abogado", elaboro: "Quién elaboró",
  };
  const HINTS = {
    tipo_actuacion: "Ej.: Interrogatorio de parte", identificacion_abogado: "Ej.: C.C. No. 00.000.000 y T.P. No. 000.000 del C. S. de la J.",
    nombre_juez_o_doctora: "Ej.: YOLANDA VARGAS RUGELES", correo_juzgado: "Ej.: j03cmpaliba@cendoj.ramajudicial.gov.co",
  };

  const up = (x) => String(x || "").toLocaleUpperCase("es-CO");

  /** Values of the letter's variables from the data the document already has: the shared letter data (src/solicitud-link-letter.js) plus the lawyer's. */
  function fromCase(v, who) {
    const L = window.JuanmaSolicitudLink.letterFields(v);
    return {
      ...L,
      nombre_abogado: up(v["abogado.nombre"]),
      identificacion_abogado: v["abogado.tarjeta_profesional"] ? `tarjeta profesional N.º ${v["abogado.tarjeta_profesional"]}` : "",
      correo_abogado: v["abogado.correo"],
      elaboro: who || "",
    };
  }

  const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  /** The letter's HTML with every {{variable}}; a missing one is a yellow [FILL: …]. */
  function fill(body, data, labels = {}) {
    return String(body).trimStart().slice(MARK.length).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key) => {
      const v = data[key];
      return v !== undefined && v !== null && String(v).trim() !== "" ? esc(String(v).trim()) : `<mark class="fill">[FILL: ${esc(labels[key] || LABELS[key] || key)}]</mark>`;
    });
  }

  // A clean sheet for the picture: no outer margin, shadow or grey background.
  const SHEET_CSS = "<style>body{background:#fff!important}.hoja{margin:0!important;box-shadow:none!important;border-radius:0!important;max-width:none!important;width:816px}.cabecera{padding-top:12px!important;padding-bottom:12px!important}.contenido{padding-top:24px!important;padding-bottom:14px!important}.fecha{margin-bottom:14px!important}.destinatario,.asunto{margin-bottom:18px!important}.firma{margin-top:14px!important;padding-top:14px!important}.cuerpo p{margin-bottom:10px!important}.pie{padding-top:4px!important;padding-bottom:12px!important}</style>";

  /** PDF Blob of the letter: a photograph of the page cut into Letter sheets (one sheet when it fits). */
  async function toPdf(html) {
    if (!window.html2canvas || !window.jspdf) throw new Error("Esta pantalla no puede crear el PDF de la carta.");
    const fr = document.createElement("iframe");
    fr.style.cssText = "position:fixed;left:-20000px;top:0;width:816px;height:1200px;border:0";
    fr.srcdoc = html.replace("</head>", SHEET_CSS + "</head>");
    document.body.appendChild(fr);
    try {
      await new Promise((ok, no) => { fr.onload = ok; setTimeout(() => no(new Error("La carta no cargó.")), 15000); });
      const d = fr.contentDocument;
      await Promise.all([...d.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))));
      const sheet = d.querySelector(".hoja") || d.body;
      const shot = await window.html2canvas(sheet, { scale: 2, backgroundColor: "#ffffff", logging: false, useCORS: true, windowWidth: 816 });
      const { jsPDF } = window.jspdf;
      const W = 612, H = 792; // Letter in points
      const pageH = Math.floor(shot.width * H / W);
      const pdf = new jsPDF({ unit: "pt", format: [W, H], compress: true });
      // A letter only a little taller than one sheet is shrunk onto it instead of spilling its signature onto a second page.
      if (shot.height > pageH && shot.height <= pageH * 1.25) {
        const k = pageH / shot.height;
        pdf.addImage(shot.toDataURL("image/jpeg", 0.92), "JPEG", W * (1 - k) / 2, 0, W * k, H);
        return pdf.output("blob");
      }
      for (let y = 0, n = 0; y < shot.height - 2; y += pageH, n++) {
        const part = document.createElement("canvas");
        part.width = shot.width; part.height = Math.min(pageH, shot.height - y);
        const ctx = part.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, part.width, part.height);
        ctx.drawImage(shot, 0, y, shot.width, part.height, 0, 0, part.width, part.height);
        if (n) pdf.addPage([W, H]);
        pdf.addImage(part.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, W, part.height * W / shot.width);
      }
      return pdf.output("blob");
    } finally { fr.remove(); }
  }

  window.JuanmaHtmlTemplate = { MARK, isHtml, LABELS, HINTS, fromCase, fill, toPdf };
})();
