// Writes the standalone copies of «Solicitud link de expediente» (template with {{variables}} and a filled example)
// into the folder given as argument. Usage: node scripts/build-solicitud-link.mjs <folder>
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { solicitudLinkHtml } from "../src/templates-seed.js";

const dir = process.argv[2] || "solicitud-link-expediente";
mkdirSync(dir, { recursive: true });
const raw = solicitudLinkHtml().replace("<!--tj-html-->\n", "");
const example = { ciudad: "Ibagué", fecha_solicitud: "27 de octubre de 2026", nombre_juez_o_doctora: "YOLANDA VARGAS RUGELES", cargo_despacho: "Juzgado Tercero Civil Municipal de Ibagué",
  correo_juzgado: "j03cmpaliba@cendoj.ramajudicial.gov.co", ciudad_juzgado: "Ibagué", tipo_actuacion: "Interrogatorio de parte", demandante: "BANCO EJEMPLO S.A.", demandado: "ALIRIO GUZMAN",
  numero_radicado: "73001400300320260031200", nombre_abogado: "JOHN FREDY QUIÑONES MONTAÑA", identificacion_abogado: "cédula de ciudadanía No. 00.000.000 y T.P. No. 000.000 del C. S. de la J.",
  nombre_cliente: "ALIRIO GUZMAN", correo_abogado: "gerencia@tecjuridicos.com", "documento.numero": "12.325", elaboro: "JFQM" };
writeFileSync(path.join(dir, "solicitud-link-expediente (plantilla con variables).html"), raw);
writeFileSync(path.join(dir, "solicitud-link-expediente (ejemplo llenado).html"), raw.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, k) => example[k] ?? k));
