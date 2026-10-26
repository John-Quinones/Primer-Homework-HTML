// "Cyber LegalTech" e-mail for payment notices (version 2.2.72). The HTML lives in plantillas/cobro-cyber.html with the variables
// {{nombreCliente}}, {{concepto}}, {{monto}}, {{fechaLimite}}, {{linkPago}} (plus {{datosPago}} and {{anio}}). Every value is escaped;
// a link that is not https:// is dropped, and then the button is replaced by the firm's payment details.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "plantillas", "cobro-cyber.html");
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
let template = null;

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** 2026-11-05 → "5 de noviembre de 2026" (anything else comes back as it was). */
export const longDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? `${Number(m[3])} de ${MONTHS[Number(m[2]) - 1]} de ${m[1]}` : String(iso || "");
};
/** Amount for the template, which already prints "COP" after it: 1500000 → "$ 1.500.000". */
export const montoCOP = (n) => "$ " + Math.round(Number(n) || 0).toLocaleString("es-CO");

export function renderCobroEmail({ nombreCliente, concepto, monto, fechaLimite, linkPago = "", datosPago = "", anio = new Date().getFullYear() }) {
  template ??= readFileSync(FILE, "utf8");
  const link = /^https:\/\/[^\s"'<>]+$/i.test(String(linkPago)) ? String(linkPago) : "";
  const hasPayInfo = !!String(datosPago).trim();
  let html = template
    .replace(link ? /<!--NOLINK-->[\s\S]*?<!--\/NOLINK-->/ : /<!--LINK-->[\s\S]*?<!--\/LINK-->/, "")
    .replace(/<!--\/?(NO)?LINK-->/g, "");
  if (!link && !hasPayInfo) html = html.replace(/<table[^>]*>(?:(?!<table)[\s\S])*?Datos para el pago:[\s\S]*?<\/table>/, "");
  const vars = { nombreCliente, concepto, monto, fechaLimite, linkPago: link, datosPago, anio };
  return html.replace(/\{\{(\w+)\}\}/g, (_m, k) => esc(vars[k]));
}
