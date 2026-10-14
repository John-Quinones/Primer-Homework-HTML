// Finds Colombian case-law citations in a draft (Corte Constitucional T/C/SU
// and autos, Corte Suprema SL/SC/SP/STC..., Consejo de Estado and tribunal
// radicados), each with the sentence that relies on it. Exposes
// window.JuanmaCitations; also loaded by the Node tests.
(function () {
  const CITATION_PATTERNS = [
    // Corte Constitucional: T-760 de 2008, C-355/06, SU-214 de 2016, Auto 092 de 2008
    /\b(?:sentencia\s+)?(?:T|C|SU)\s?[-–]\s?\d{1,4}[A-Z]?\s*(?:de|del|\/)\s*(?:19|20)?\d{2}\b/gi,
    /\bauto\s+(?:A\s?[-–]\s?)?\d{1,4}\s+de\s+(?:19|20)\d{2}\b/gi,
    // Corte Suprema: SL1234-2021, SC5678-2019, STC123-2022, SP456-2020, AL789-2023, ATP..., STL...
    /\b(?:SL|SC|SP|STC|STL|STP|AL|AC|AP|ATP|SU)\d{2,6}\s?[-–]\s?(?:19|20)\d{2}\b/g,
    // Radicados (Consejo de Estado / tribunales): 25000-23-26-000-2012-00123-01, radicado 11001-03-...
    /\b(?:rad(?:icado|\.)?\s*(?:n[oº°.]*\s*)?)?\d{5}[-–]\d{2}[-–]\d{2}[-–]\d{3}[-–]\d{4}[-–]\d{5}[-–]\d{2}(?:\s*\(\d+\))?/gi,
  ];

  // Same judgment, same key: "Sentencia T-760 de 2008" = "T-760/08"; "rad. 2500..." = "2500...".
  function citationKey(ref) {
    let k = ref.toLowerCase()
      .replace(/^(sentencia|radicado|rad\.?|auto)\s+(n[oº°.]*\s*)?/, "")
      .replace(/\s*(de|del|\/)\s*/g, "-");
    k = k.replace(/-(\d{2})$/, (_, yy) => "-" + (Number(yy) >= 90 ? "19" : "20") + yy);
    return (ref.toLowerCase().startsWith("auto") ? "auto" : "") + k.replace(/[^a-z0-9]/g, "");
  }

  /** Find case-law citations in a draft, each with the sentence that relies on it. */
  function extractCitations(text) {
    const found = new Map();
    for (const re of CITATION_PATTERNS) {
      for (const m of text.matchAll(re)) {
        const ref = m[0].replace(/\s+/g, " ").trim();
        const key = citationKey(ref);
        if (found.has(key)) continue;
        const start = Math.max(text.lastIndexOf(".", m.index) + 1, text.lastIndexOf("\n", m.index) + 1, m.index - 400);
        const endDot = text.indexOf(".", m.index + ref.length);
        const end = endDot < 0 ? Math.min(text.length, m.index + 300) : Math.min(endDot + 1, m.index + 400);
        found.set(key, { citation: ref, claim: text.slice(start, end).replace(/\s+/g, " ").trim() });
      }
    }
    return [...found.values()];
  }

  window.JuanmaCitations = { extractCitations };
})();
