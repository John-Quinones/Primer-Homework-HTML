// Version 2.3.9: the letter of «Firmar y enviar por correo» (the firm's letterhead, same as «Solicitud link de expediente»).
// The user types the city, date, addressee, reference and text; what is missing shows as a yellow [FILL: …] and blocks the sending.
(function () {
  const esc = (x) => String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const up = (x) => String(x || "").toLocaleUpperCase("es-CO");
  const lines = (x) => String(x || "").split(/\r?\n/).map((l) => l.trim());
  const groups = (x) => String(x || "").replace(/\r/g, "").split(/\n\s*\n/).map((g) => lines(g).filter(Boolean)).filter((g) => g.length);
  const fill = (label) => `<mark class="fill">[FILL: ${esc(label)}]</mark>`;

  const LABELS = { ciudad: "Ciudad", fecha: "Fecha", destinatario: "Entidad destinataria", cuerpo: "Texto de la carta" };
  /** Names of the required fields still empty. */
  const missing = (d) => Object.keys(LABELS).filter((k) => !String(d[k] || "").trim()).map((k) => LABELS[k]);

  /** The letter's HTML for the data {ciudad, fecha, destinatario, atencion, titulo, referencia, cuerpo, elaboro}. */
  function build(d, tpl = window.JuanmaCartaTpl) {
    const ents = groups(d.destinatario).map((g) => `<div class="grupo">${g.map((l, i) => `<p class="${/@/.test(l) ? "correo" : i === 0 ? "despacho" : ""}">${esc(/@/.test(l) || d.mayusculas === false ? l : up(l))}</p>`).join("")}</div>`).join("");
    const dest = (ents || fill(LABELS.destinatario)) + (String(d.atencion || "").trim() ? `<p class="juez">${esc(d.atencion.trim())}</p>` : "");
    const ref = lines(d.referencia).filter(Boolean).map((l) => { const m = l.match(/^([^:]{1,40}):\s*(.+)$/); return m ? `<dt>${esc(m[1])}</dt><dd>${esc(m[2])}</dd>` : `<dt></dt><dd>${esc(l)}</dd>`; }).join("");
    const titulo = String(d.titulo || "").trim();
    const asunto = titulo || ref ? `<section class="asunto"><div class="in"><p class="et">${esc(String(d.etiqueta ?? "Referencia").trim() || "Referencia")}</p>${titulo ? `<p class="tit">${esc(titulo)}</p>` : ""}${ref ? `<dl>${ref}</dl>` : ""}</div></section>` : "";
    const cuerpo = groups(d.cuerpo).map((g) => `<p>${g.map(esc).join("<br>")}</p>`).join("");
    return String(tpl)
      .replace("@@TRATAMIENTO@@", () => esc(String(d.tratamiento ?? "Señores").trim()))
      .replace("@@DESPEDIDA@@", () => esc(String(d.despedida ?? "Atentamente,").trim()))
      .replace("@@ELABORO@@", () => (d.mostrarElaboro === false || !String(d.elaboro || "").trim() ? "" : `Elaboró: ${esc(String(d.elaboro).trim())}`))
      .replace("@@DEST@@", () => dest).replace("@@ASUNTO@@", () => asunto).replace("@@CUERPO@@", () => cuerpo || `<p>${fill(LABELS.cuerpo)}</p>`)
      .replace(/\{\{\s*(ciudad|fecha)\s*\}\}/g, (_, k) => (String(d[k] || "").trim() ? esc(String(d[k]).trim()) : fill(LABELS[k])));
  }

  /** A first text for the body: the user's name (capitals) as the apoderado who sends the attached document. */
  const defaultBody = (name) => `Cordial saludo.\n\n${up(name) || "[NOMBRE]"}, identificado civil y profesionalmente como aparece al final en la firma electrónica, por medio del presente escrito remito el documento adjunto para su atención y trámite.\n\nAgradezco de antemano su atención y colaboración.`;

  window.JuanmaCartaFirma = { build, missing, defaultBody, LABELS };
})();
