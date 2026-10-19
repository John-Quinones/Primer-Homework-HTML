// Free ways to reach a judgment: the courts' own search pages and the
// Corte Constitucional page built from a reference. No AI and no credits.
// Shared by the server and the published link (served in /shared.js).

export const COURT_SEARCH = [
  { id: "CC", name: "Corte Constitucional", url: "https://www.corteconstitucional.gov.co/relatoria/" },
  { id: "CSJ", name: "Corte Suprema de Justicia", url: "https://consultajurisprudencial.ramajudicial.gov.co/WebRelatoria/csj/index.xhtml" },
  { id: "CE", name: "Consejo de Estado", url: "https://samai.consejodeestado.gov.co/TitulacionRelatoria/BuscadorProvidenciasTituladas.aspx" },
];

/**
 * Official Corte Constitucional page for a reference like "T-760 de 2008",
 * "C-355/06" or "SU-214 de 2016". Null for anything else.
 */
export function ccRelatoriaUrl(reference) {
  const m = String(reference || "").toUpperCase().match(/\b(SU|T|C)\s*-\s*(\d{1,4})\s*(?:\/|DE(?:L)?|-)\s*(\d{4}|\d{2})\b/);
  if (!m) return null;
  let year = Number(m[3]);
  if (m[3].length === 2) year += year > 91 ? 1900 : 2000; // the Court started in 1992
  if (year < 1992 || year > new Date().getFullYear()) return null;
  return `https://www.corteconstitucional.gov.co/relatoria/${year}/${m[1]}-${Number(m[2])}-${String(year).slice(2)}.htm`;
}

/** Does a page's text name this Corte Constitucional judgment ("T-760 de 2008", "T-760/08")? */
export function pageNamesJudgment(text, reference) {
  const m = String(reference || "").toUpperCase().match(/\b(SU|T|C)\s*-\s*(\d{1,4})\b/);
  if (!m) return false;
  const flat = String(text || "").toUpperCase().replace(/&NBSP;|\s+/g, " ");
  return new RegExp(`\\b${m[1]}\\s*-\\s*0*${Number(m[2])}\\b`).test(flat);
}
