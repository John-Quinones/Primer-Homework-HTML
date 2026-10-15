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
    name: "Rama Judicial · Consulta de procesos (Justicia Siglo XXI)",
    url: "https://consultaprocesos.ramajudicial.gov.co/Procesos/NumeroRadicacion",
    how: "Pegue el radicado de 23 dígitos en «Número de radicación» y pulse Consultar.",
    auto: true,
  },
  {
    id: "publicaciones",
    name: "Publicaciones Procesales",
    url: "https://publicacionesprocesales.ramajudicial.gov.co/",
    how: "Los estados, edictos y traslados se publican por despacho y fecha: busque el despacho del expediente y revise las publicaciones recientes.",
    auto: false,
  },
  {
    id: "tyba",
    name: "TYBA · Justicia Siglo XXI Web",
    url: "https://procesojudicial.ramajudicial.gov.co/Justicia21/Administracion/Ciudadanos/frmConsulta.aspx",
    how: "Busque por número de proceso (radicado de 23 dígitos); el portal pide una verificación de seguridad antes de mostrar el resultado.",
    auto: false,
  },
  {
    id: "samai",
    name: "SAMAI · Consejo de Estado",
    url: "https://samai.consejodeestado.gov.co/Vistas/Casos/procesos.aspx",
    how: "Para la jurisdicción contencioso administrativa: pegue el radicado en la búsqueda por número de proceso.",
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

/** Portal ids in the order to try them for this radicado. */
export function portalOrder(r) {
  const d = radicadoDigits(r);
  if (d && ADMINISTRATIVE.has(d.slice(5, 7))) return ["samai", "cpnu", "publicaciones", "tyba"];
  return ["cpnu", "tyba", "publicaciones", "samai"];
}
