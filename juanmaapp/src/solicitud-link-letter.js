// «Solicitar link de expediente» (version 2.2.83): the short letter to a court asking for the link of the digital expediente,
// sent as an HTML e-mail with the lawyer's signature picture. Shared by the server (builds the message) and the page (preview).
// Everything typed is escaped; the e-mail uses inline styles (e-mail programs ignore <style>).

export const LETTER_FIELDS = [
  ["ciudad", "Ciudad", true], ["fecha_solicitud", "Fecha de la solicitud", true], ["nombre_juez_o_doctora", "Nombre del juez o doctora", false],
  ["cargo_despacho", "Cargo o despacho", true], ["correo_juzgado", "Correo del juzgado", true], ["ciudad_juzgado", "Ciudad del juzgado", false],
  ["tipo_actuacion", "Tipo de actuación", true], ["demandante", "Demandante", false], ["demandado", "Demandado", false],
  ["numero_radicado", "Número de radicado", true], ["nombre_cliente", "Nombre del cliente", true], ["cliente_del_senor", "«del señor» / «de la señora»", false],
];
export const LETTER_KEYS = LETTER_FIELDS.map((f) => f[0]);

const clean = (x) => String(x ?? "").replace(/\s+/g, " ").trim();
const up = (x) => String(x || "").toLocaleUpperCase("es-CO");
// The radicado is written with its dashes (version 2.2.91): 73-001-40-03-005-2025-00185-00.
const dashed = (r) => { const d = String(r || "").replace(/\D/g, ""); return d.length === 23 ? [2, 3, 2, 2, 3, 4, 5, 2].reduce((o, n) => { o.parts.push(d.slice(o.i, o.i + n)); o.i += n; return o; }, { i: 0, parts: [] }).parts.join("-") : String(r || ""); };

/** The letter's data from what a case gives (the values of «templateData»). */
export function letterFields(v) {
  const first = (...ks) => ks.map((k) => v[k]).find((x) => String(x || "").trim()) || "";
  return {
    ciudad: first("oficina.ciudad") || "Ibagué",
    fecha_solicitud: v["fecha.hoy"] || "",
    nombre_juez_o_doctora: up(first("destinatario.nombre", "expediente.juez")),
    cargo_despacho: first("destinatario.entidad", "expediente.despacho"),
    correo_juzgado: first("destinatario.correo", "expediente.correo_despacho"),
    ciudad_juzgado: first("destinatario.ciudad", "expediente.ciudad"),
    tipo_actuacion: String(v["expediente.clase_proceso"] || "").trim(), // the case's process class: Pertenencia, Ejecutivo, Ordinario Laboral de Primera Instancia…
    demandante: v["expediente.demandantes"] || (v["cliente.calidad_sola"] === "demandante" ? v["cliente.nombre"] : "") || "",
    demandado: first("expediente.contraparte"),
    numero_radicado: dashed(first("expediente.radicado")),
    nombre_cliente: up(v["cliente.nombre"]),
    cliente_del_senor: v["cliente.del_senor"] || "",
  };
}

/** Required data still missing (labels), so the letter is never sent half empty. The signer (the user who sends) must have the name and ID used in the signature. */
export function letterMissing(f, signer) {
  const miss = LETTER_FIELDS.filter(([k, , req]) => req && !String(f[k] || "").trim()).map((x) => x[1]);
  if (signer) {
    if (!clean(signer.name)) miss.push("Su nombre completo para firmas (Usuarios)");
    if (!String(signer.id_number || "").replace(/\D/g, "")) miss.push("Su cédula (Usuarios)");
  }
  return miss;
}

/** The signer as the stamp shows it: name, «CC. 17418999» and «Tarjeta Profesional No. 150.081 del C. S. de la J.». */
export function signerView(u) {
  const card = clean(u?.professional_card), digits = card.replace(/\D/g, "");
  return {
    name: clean(u?.legal_name), id_number: String(u?.id_number || "").replace(/\D/g, ""), email: clean(u?.email), phone: clean(u?.phone),
    card: card ? `Tarjeta Profesional No. ${/^\d{4,}$/.test(card) ? Number(digits).toLocaleString("es-CO") : card} del C. S. de la J.` : "",
  };
}
/** «2026-10-27 19:28:36 -05:00» (Colombia time) for the stamp. */
export function stampTime(d = new Date()) {
  return new Date(d.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ") + " -05:00";
}

const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const NAVY = "#002b6a", BLUE = "#027cc6", SILVER = "#989795", FONT = "'Century Gothic','Questrial','Segoe UI',Helvetica,Arial,sans-serif";

/**
 * {subject, text, html}. Design of the firm's letterhead (logo, QR, border, footer of «Plantilla Membrete_Pie_Encab_Pagina»),
 * in e-mail HTML (tables and inline styles). `imgs` = {logo, qr, globo, ubicacion} sources (cid:… in the e-mail);
 * `signer` = signerView(user); `stamp` = {code, signed_at, qrSrc} once the signature is issued (null = preview: the QR and code are issued when sending).
 */
export function buildLetter(fields, { imgs = {}, signer = {}, stamp = null } = {}) {
  const f = Object.fromEntries(LETTER_KEYS.map((k) => [k, clean(fields[k])]));
  const who = f.cliente_del_senor || "de";
  const name = up(signer.name || "");
  const subject = `Solicitud Link Expediente - ${f.tipo_actuacion} – ${f.demandante} Vs ${f.demandado} Radicación No. ${f.numero_radicado}`;
  const lead = `${name}, identificado civil y profesionalmente como aparece al final en la firma electrónica, actuando como apoderado judicial ${who} ${f.nombre_cliente}, por medio del presente escrito solicito de manera respetuosa a su Señoría se sirva compartirme el link del expediente electrónico.`;
  const note = "Informo a su Señoría que el correo autorizado por el suscrito apoderado corresponde a gerencia@tecjuridicos.com.";
  const thanks = "Agradezco de antemano su atención y colaboración.";
  const addressee = ["Señor(a)", f.cargo_despacho, f.nombre_juez_o_doctora, f.correo_juzgado, f.ciudad_juzgado].filter(Boolean);
  const idLine = [signer.id_number && `CC. ${signer.id_number}`, signer.card].filter(Boolean).join(" · ");
  const text = [`${f.ciudad}, ${f.fecha_solicitud}`, "", ...addressee, "", `Referencia: Solicitud Link Expediente - ${f.tipo_actuacion}`, `Demandante: ${f.demandante}`, `Demandado: ${f.demandado}`,
    `Radicación No.: ${f.numero_radicado}`, "", "Cordial saludo.", "", lead, "", note, "", thanks, "", "Atentamente,", "", signer.name || "", idLine, "Firma Electrónica" + (stamp ? ` · ${stamp.signed_at}` : ""),
    stamp ? `Verifique la autenticidad con el código ${stamp.code} en tecjuridicos.com/verificar` : "", "", "Carrera 5 No. 29-32 Of.290 Centro Comercial La Quinta", "Tel. 314 415 6914 / 320 557 7777", "www.tecjuridicos.com", "gerencia@tecjuridicos.com", "Ibagué – Colombia"].join("\n");
  const img = (src, w, h, extra = "") => (src ? `<img src="${esc(src)}" width="${w}" ${h ? `height="${h}"` : ""} alt="" style="display:block;border:0;${extra}">` : "");
  const row = (label, value) => `<tr><td style="padding:2px 14px 2px 0;border:0;background:none;color:${SILVER};font-size:13px;vertical-align:top;white-space:nowrap">${label}</td><td style="padding:2px 0;border:0;background:none;font-weight:bold;color:#1e1e1e;font-size:13px">${esc(value)}</td></tr>`;
  // The signature itself is the platform's own stamp (QR, time, data, certificate) on the PDF of the letter, attached signed; the e-mail points to it.
  const qr = stamp?.qrSrc
    ? img(stamp.qrSrc, 84, 84)
    : `<div style="width:84px;height:84px;border:1px dashed ${SILVER};color:${SILVER};font-size:9px;line-height:1.3;text-align:center;padding-top:30px;box-sizing:border-box">QR<br>al enviar</div>`;
  const stampHtml = `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border:0;border-collapse:collapse;margin:4px 0 0"><tr>
<td style="vertical-align:top;padding:0 14px 0 0;border:0">${qr}</td>
<td style="vertical-align:top;border:0;background:none;font-size:12.5px;line-height:1.4"><strong style="color:#1e1e1e">${esc(signer.name || "")}</strong><br>${esc(idLine)}<br><span style="color:${BLUE};font-weight:bold">Firma Electrónica</span>${stamp ? ` · <span style="color:${BLUE}">${esc(stamp.signed_at)}</span>` : ""}<br>
<span style="color:${SILVER};font-size:11px">${stamp ? `El PDF adjunto lleva la estampa de la firma electrónica y su certificado. Verifique su autenticidad con el QR o en <strong style="color:${NAVY}">tecjuridicos.com/verificar</strong> con el código <strong style="color:${NAVY}">${esc(stamp.code)}</strong> o cargando el PDF.` : "La estampa de la firma electrónica y el código de verificación se emiten al enviar; el PDF firmado va adjunto."}</span></td></tr></table>`;
  const fline = (t, icon) => `<tr><td align="right" style="border:0;background:none;padding:0;font-size:13px;line-height:1.35;color:#1F3864;white-space:nowrap">${icon ? `${icon} ` : ""}${t}</td></tr>`;
  const html = `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:660px;border:1px solid #002B6A;border-bottom:2px solid #000;border-right:2px solid #000;border-collapse:separate;background:#ffffff;font-family:${FONT};font-size:14px;line-height:1.55;color:#333333">
<tr><td style="padding:47px 32px 0;border:0;background:none"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:0"><tr>
<td style="border:0;background:none;padding:0 7px">${img(imgs.logo, 131, 70)}</td><td align="right" style="border:0;background:none;padding:0 7px">${img(imgs.qr, 70, 70, "margin-left:auto")}</td></tr></table></td></tr>
<tr><td style="padding:18px 39px 6px;border:0;background:none">
<p style="margin:0 0 16px;text-align:right;color:${SILVER};font-size:13px">${esc(f.ciudad)}, ${esc(f.fecha_solicitud)}</p>
<p style="margin:0 0 16px;line-height:1.45"><span style="color:${SILVER};font-size:11.5px;letter-spacing:1.5px">SEÑOR(A)</span><br><strong style="color:${NAVY};font-size:15px">${esc(f.cargo_despacho)}</strong><br><strong>${esc(f.nombre_juez_o_doctora)}</strong><br><span style="color:${BLUE};font-size:13px">${esc(f.correo_juzgado)}</span><br>${esc(f.ciudad_juzgado)}</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 16px;border:0"><tr><td style="background:#f1f4f8;border:0;border-left:5px solid ${NAVY};border-radius:6px;padding:10px 18px 12px">
<div style="font-size:10px;letter-spacing:2px;color:${SILVER}">REFERENCIA</div>
<div style="font-size:15px;font-weight:bold;color:${NAVY};margin:1px 0 6px">Solicitud Link Expediente - ${esc(f.tipo_actuacion)}</div>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border:0;border-collapse:collapse;background:none">${row("Demandante", f.demandante)}${row("Demandado", f.demandado)}${row("Radicación No.", f.numero_radicado)}</table>
</td></tr></table>
<p style="margin:0 0 10px">Cordial saludo.</p>
<p style="margin:0 0 10px;text-align:justify"><strong style="color:${NAVY}">${esc(name)}</strong>${esc(lead.slice(name.length)).replace(esc(f.nombre_cliente), `<strong style="color:${NAVY}">${esc(f.nombre_cliente)}</strong>`).replace("link del expediente electrónico", `<strong style="color:${NAVY}">link del expediente electrónico</strong>`)}</p>
<p style="margin:0 0 10px;text-align:justify">Informo a su Señoría que el correo autorizado por el suscrito apoderado corresponde a <strong style="color:${NAVY}">gerencia@tecjuridicos.com</strong>.</p>
<p style="margin:0 0 12px">${thanks}</p>
<p style="margin:0 0 6px">Atentamente,</p>
${stampHtml}
</td></tr>
<tr><td align="right" style="padding:22px 39px 38px;border:0;background:none"><table role="presentation" cellspacing="0" cellpadding="0" border="0" align="right" style="border:0;border-collapse:collapse">
${fline("Carrera 5 No. 29-32 Of.290 Centro Comercial La Quinta", "<b>📍</b>")}${fline("Tel. 314 415 6914 / 320 557 7777", "<b>☎</b>")}${fline(`<a href="https://www.tecjuridicos.com" style="color:#1F3864;text-decoration:underline">www.tecjuridicos.com</a>`, img(imgs.globo, 14, 14, "display:inline;vertical-align:middle"))}${fline(`<a href="mailto:gerencia@tecjuridicos.com" style="color:#0000FF;text-decoration:underline">gerencia@tecjuridicos.com</a>`, "<b>✉</b>")}${fline("Ibagué – Colombia", img(imgs.ubicacion, 14, 14, "display:inline;vertical-align:middle"))}
</table></td></tr></table>`;
  return { subject, text, html };
}
