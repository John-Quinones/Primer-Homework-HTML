// Version 2.3.13: the letter of «Firmar y enviar por correo» as the body of the e-mail (HTML/CSS in tables with the firm's letterhead), not a link to it.
// Same data and order as the preview of the dialog (public/carta-firma.js); the signature block is the platform's own stamp (QR, time, code).
import { letterShell, stampBlock } from "./solicitud-link-letter.js";

const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const up = (x) => String(x || "").toLocaleUpperCase("es-CO");
const trim = (x, n = 4000) => String(x ?? "").slice(0, n);
const lines = (x) => trim(x).split(/\r?\n/).map((l) => l.trim());
const groups = (x) => trim(x).replace(/\r/g, "").split(/\n\s*\n/).map((g) => lines(g).filter(Boolean)).filter((g) => g.length);
const NAVY = "#002b6a", BLUE = "#027cc6", SILVER = "#989795";

export const CARTA_KEYS = ["ciudad", "fecha", "tratamiento", "destinatario", "atencion", "etiqueta", "titulo", "referencia", "cuerpo", "despedida", "elaboro"];

/** Required fields still empty (labels). */
export function cartaMissing(d) {
  return [["ciudad", "Ciudad"], ["fecha", "Fecha"], ["destinatario", "Entidad destinataria"], ["cuerpo", "Texto de la carta"]].filter(([k]) => !String(d?.[k] || "").trim()).map(([, l]) => l);
}

/** {html, text} of the letter. `d` = the dialog's data; `signer` = signerView(user); `stamp` = {code, signed_at, qrSrc}; `imgs` = cid sources. */
export function buildCartaMail(d, { signer = {}, stamp = null, imgs = {} } = {}) {
  const mayus = d.mayusculas !== false;
  const trat = trim(d.tratamiento ?? "Señores", 60).trim(), desp = trim(d.despedida ?? "Atentamente,", 60).trim();
  const ents = groups(d.destinatario);
  const destHtml = ents.map((g) => `<p style="margin:0 0 10px;line-height:1.45">${g.map((l, i) => /@/.test(l) ? `<span style="color:${BLUE};font-size:13px">${esc(l)}</span>`
    : i === 0 ? `<strong style="color:${NAVY};font-size:15px">${esc(mayus ? up(l) : l)}</strong>` : `<strong>${esc(mayus ? up(l) : l)}</strong>`).join("<br>")}</p>`).join("")
    + (trim(d.atencion, 300).trim() ? `<p style="margin:0 0 10px"><strong>${esc(trim(d.atencion, 300).trim())}</strong></p>` : "");
  const refRows = lines(d.referencia).filter(Boolean).map((l) => {
    const m = l.match(/^([^:]{1,40}):\s*(.+)$/);
    return `<tr><td style="padding:2px 14px 2px 0;border:0;background:none;color:${SILVER};font-size:13px;vertical-align:top;white-space:nowrap">${m ? esc(m[1]) : ""}</td><td style="padding:2px 0;border:0;background:none;font-weight:bold;color:#1e1e1e;font-size:13px">${esc(m ? m[2] : l)}</td></tr>`;
  }).join("");
  const titulo = trim(d.titulo, 300).trim(), etiqueta = trim(d.etiqueta ?? "Referencia", 60).trim() || "Referencia";
  const refHtml = titulo || refRows ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 16px;border:0"><tr><td style="background:#f1f4f8;border:0;border-left:5px solid ${NAVY};border-radius:6px;padding:10px 18px 12px">
<div style="font-size:10px;letter-spacing:2px;color:${SILVER}">${esc(up(etiqueta))}</div>${titulo ? `<div style="font-size:15px;font-weight:bold;color:${NAVY};margin:1px 0 6px">${esc(titulo)}</div>` : ""}
${refRows ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border:0;border-collapse:collapse;background:none">${refRows}</table>` : ""}</td></tr></table>` : "";
  const cuerpo = groups(d.cuerpo).map((g) => `<p style="margin:0 0 10px;text-align:justify">${g.map(esc).join("<br>")}</p>`).join("");
  const idLine = [signer.id_number && `CC. ${signer.id_number}`, signer.card].filter(Boolean).join(" · ");
  const elaboro = d.mostrarElaboro === false || !trim(d.elaboro, 40).trim() ? "" : `<p style="margin:10px 0 0;text-align:right;color:${SILVER};font-size:10px">Elaboró: ${esc(trim(d.elaboro, 40).trim())}</p>`;
  const html = letterShell(`<tr><td style="padding:18px 39px 6px;border:0;background:none">
<p style="margin:0 0 16px;text-align:right;color:${SILVER};font-size:13px">${esc(trim(d.ciudad, 80))}, ${esc(trim(d.fecha, 80))}</p>
${trat ? `<p style="margin:0 0 6px;color:${SILVER};font-size:11.5px;letter-spacing:1.5px">${esc(up(trat))}</p>` : ""}${destHtml}
${refHtml}${cuerpo}
<p style="margin:12px 0 6px">${esc(desp)}</p>
${stampBlock(signer, idLine, stamp)}${elaboro}
</td></tr>`, imgs);
  const text = [`${trim(d.ciudad, 80)}, ${trim(d.fecha, 80)}`, "", trat && up(trat), ...ents.map((g) => g.map((l) => (mayus && !/@/.test(l) ? up(l) : l)).join("\n") + "\n"),
    trim(d.atencion, 300), titulo && `${etiqueta}: ${titulo}`, ...lines(d.referencia).filter(Boolean), "", ...groups(d.cuerpo).map((g) => g.join("\n") + "\n"), desp, "", signer.name || "", idLine,
    "Firma Electrónica" + (stamp ? ` · ${stamp.signed_at}` : ""), stamp ? `Verifique la autenticidad con el código ${stamp.code} en tecjuridicos.com/verificar` : ""].filter((l) => l !== undefined && l !== false).join("\n");
  return { html, text };
}
