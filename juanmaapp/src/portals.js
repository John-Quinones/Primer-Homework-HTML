// Official portals where a case can be looked up, and which one fits a
// radicado. Shared by the server and the published link (served in /shared.js).
//
// Only the Rama Judicial's Consulta Nacional Unificada (CPNU) has a public
// service the server can call (see ramajudicial.js). TYBA asks for a captcha,
// SAMAI has no public service, and Publicaciones Procesales lists notices by
// court and date (PDF files), not by radicado; for those the app copies the
// radicado and opens the portal.

export const PORTALS = [
  {
    id: "cpnu",
    name: "Justicia Siglo XXI · Consulta Nacional Unificada (Rama Judicial)",
    url: "https://consultaprocesos.ramajudicial.gov.co/Procesos/NumeroRadicacion",
    how: "Procesos de los despachos que usan Justicia Siglo XXI. Pegue el radicado de 23 dígitos en «Número de radicación» y pulse Consultar; también busca por nombre de las partes.",
    by: "radicado",
    auto: true,
  },
  {
    id: "tyba",
    name: "TYBA · Justicia XXI Web",
    url: "https://procesojudicial.ramajudicial.gov.co/Justicia21/Administracion/Ciudadanos/frmConsulta.aspx",
    how: "Despachos que trabajan en TYBA (Justicia XXI Web). Busque por número de proceso (radicado de 23 dígitos) o por documento de la parte; el portal pide una verificación de seguridad.",
    by: "radicado",
    auto: false,
  },
  {
    id: "siugj",
    name: "SIUGJ · Sistema Integrado de Gestión Judicial",
    url: "https://siugj.ramajudicial.gov.co/principalPortal/consultarProceso.php",
    how: "Sistema nuevo de la Rama Judicial (empezó con la especialidad laboral en 2025). Busque por CUP (el radicado), por número de documento o por el nombre completo exacto de la parte.",
    by: "radicado o documento",
    auto: false,
  },
  {
    id: "publicaciones",
    name: "Publicaciones Procesales",
    url: "https://publicacionesprocesales.ramajudicial.gov.co/",
    how: "Estados, edictos y traslados publicados por despacho y fecha: busque el despacho del expediente y revise las publicaciones recientes.",
    by: "despacho",
    auto: false,
  },
  {
    id: "samai",
    name: "SAMAI · Jurisdicción contencioso administrativa (Consejo de Estado)",
    url: "https://samai.consejodeestado.gov.co/Vistas/Casos/procesos.aspx",
    how: "Procesos administrativos: juzgados administrativos, tribunales administrativos y Consejo de Estado. Pegue el radicado en la búsqueda por número de proceso.",
    by: "radicado",
    auto: false,
  },
];

// Radicado (Acuerdo 201 de 1997): municipio (5) · corporación (2) · especialidad (2)
// · despacho (3) · año (4) · consecutivo (5) · recurso (2). Corporaciones 03
// (Consejo de Estado), 23 (tribunales administrativos) and 33 (juzgados
// administrativos) are in SAMAI; the rest are in the Rama Judicial's systems.
const ADMINISTRATIVE = new Set(["03", "23", "33"]);

/** Digits of a radicado, or "" when it is not 23 digits long. */
export function radicadoDigits(r) {
  const d = String(r ?? "").replace(/\D/g, "");
  return d.length === 23 ? d : "";
}

/**
 * Portal ids in the order to try them for this case: SAMAI first for administrative
 * processes (by radicado, or by the process type when there is no radicado), SIUGJ
 * first for labor processes filed from 2025, else the national query (Siglo XXI).
 */
export function portalOrder(r, category = "") {
  const d = radicadoDigits(r);
  const admin = d ? ADMINISTRATIVE.has(d.slice(5, 7)) : /administrativ|contencios/i.test(category);
  if (admin) return ["samai", "cpnu", "publicaciones", "tyba", "siugj"];
  // Especialidad 05 is labor; the year is digits 13–16.
  const labor = d ? d.slice(7, 9) === "05" : /laboral/i.test(category);
  if (labor && (!d || Number(d.slice(12, 16)) >= 2025)) return ["siugj", "cpnu", "tyba", "publicaciones", "samai"];
  return ["cpnu", "tyba", "siugj", "publicaciones", "samai"];
}
