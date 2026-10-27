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

const up = (x) => String(x || "").toLocaleUpperCase("es-CO");
// The radicado is written as the courts' mail does: 23 digits, no dashes.
const digits = (r) => { const d = String(r || "").replace(/\D/g, ""); return d.length >= 20 ? d : String(r || ""); };

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
    tipo_actuacion: "",
    demandante: v["expediente.demandantes"] || (v["cliente.calidad_sola"] === "demandante" ? v["cliente.nombre"] : "") || "",
    demandado: first("expediente.contraparte"),
    numero_radicado: digits(first("expediente.radicado")),
    nombre_cliente: up(v["cliente.nombre"]),
    cliente_del_senor: v["cliente.del_senor"] || "",
  };
}

/** Required data still missing (labels), so the letter is never sent half empty. */
export function letterMissing(f) {
  return LETTER_FIELDS.filter(([k, , req]) => req && !String(f[k] || "").trim()).map((x) => x[1]);
}

const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clean = (x) => String(x ?? "").replace(/\s+/g, " ").trim();

/** {subject, text, html}. `imgSrc` is where the signature picture is (cid:firma-john in the e-mail). */
export function buildLetter(fields, { imgSrc = "firma-john.png" } = {}) {
  const f = Object.fromEntries(LETTER_KEYS.map((k) => [k, clean(fields[k])]));
  const who = f.cliente_del_senor || "de";
  const subject = `Solicitud Link Expediente - ${f.tipo_actuacion} – ${f.demandante} Vs ${f.demandado} Radicación No. ${f.numero_radicado}`;
  const lead = `Actuando como apoderado judicial ${who} ${f.nombre_cliente}, por medio del presente escrito solicito de manera respetuosa a su Señoría, se sirva compartirme el link del expediente electrónico.`;
  const note = "Informo a su Señoría que el correo autorizado por el suscrito apoderado corresponde a gerencia@tecjuridicos.com.";
  const addressee = ["Señor(a)", f.nombre_juez_o_doctora, f.cargo_despacho, f.correo_juzgado, f.ciudad_juzgado].filter(Boolean);
  const text = [`${f.ciudad}, ${f.fecha_solicitud}`, "", ...addressee, "", `Referencia: Solicitud Link Expediente - ${f.tipo_actuacion}`, `Demandante: ${f.demandante}`, `Demandado: ${f.demandado}`,
    `Radicación No.: ${f.numero_radicado}`, "", lead, "", note, "", "Atentamente,", "", "John Fredy Quiñones M.", "Magister en Derecho - Especialista en Derecho", "Experto en Medicina Laboral",
    "Ex Conjuez del Tribunal Administrativo del Tolima", "+57 314 415 6914 · gerencia@tecjuridicos.com", "Carrera 5a No.29-32 Oficina 290, Centro Comercial La Quinta, Ibagué - Colombia", "www.tecjuridicos.com"].join("\n");
  const font = "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#333333";
  const row = (label, value) => `<tr><td style="padding:3px 14px 3px 0;border:0;background:none;color:#6b7686;font-size:13px;vertical-align:top;white-space:nowrap">${label}</td><td style="padding:3px 0;border:0;background:none;font-weight:bold;color:#1e1e1e">${esc(value)}</td></tr>`;
  const html = `<div style="${font};max-width:640px">
<p style="margin:0 0 18px;color:#555555">${esc(f.ciudad)}, ${esc(f.fecha_solicitud)}</p>
<p style="margin:0 0 20px">Señor(a)<br><strong style="color:#002b6a;font-size:16px">${esc(f.nombre_juez_o_doctora)}</strong><br>${esc(f.cargo_despacho)}<br><span style="color:#1560d4">${esc(f.correo_juzgado)}</span><br>${esc(f.ciudad_juzgado)}</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 22px"><tr><td style="background:#f5f7fa;border:1px solid #dde2ea;border-left:5px solid #002b6a;border-radius:10px;padding:14px 18px">
<div style="font-size:11px;letter-spacing:1.5px;color:#6b7686">REFERENCIA</div>
<div style="font-size:16px;font-weight:bold;color:#002b6a;margin:2px 0 8px">Solicitud Link Expediente - ${esc(f.tipo_actuacion)}</div>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border:0;border-collapse:collapse;background:none">${row("Demandante", f.demandante)}${row("Demandado", f.demandado)}${row("Radicación No.", f.numero_radicado)}</table>
</td></tr></table>
<p style="margin:0 0 14px;text-align:justify">Actuando como apoderado judicial ${esc(who)} <strong>${esc(f.nombre_cliente)}</strong>, por medio del presente escrito solicito de manera respetuosa a su Señoría, se sirva compartirme el link del expediente electrónico.</p>
<p style="margin:0 0 20px;text-align:justify">Informo a su Señoría que el correo autorizado por el suscrito apoderado corresponde a <strong>gerencia@tecjuridicos.com</strong>.</p>
<p style="margin:0 0 10px">Atentamente,</p>
<img src="${esc(imgSrc)}" alt="John Fredy Quiñones M. · Tec Jurídicos · +57 314 415 6914 · gerencia@tecjuridicos.com · www.tecjuridicos.com" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0">
</div>`;
  return { subject, text, html };
}
