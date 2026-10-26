// Word documents in the browser: fill an uploaded .docx template's
// {{variables}} (docxtemplater) and build a .docx from Markdown text
// (headings, bold/italic, lists, rules; one paragraph per line).
(function () {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Version 2.44: a marker may end in a format, {{cliente.nombre|mayúsculas}} or {{cliente.documento|puntos}},
  // so a minuta written in capitals or with 65.760.174 keeps its look. The datum asked for is the key before "|".
  const FORMATS = {
    "mayúsculas": (v) => String(v).toLocaleUpperCase("es-CO"),
    "mayusculas": (v) => String(v).toLocaleUpperCase("es-CO"),
    // «Fiscalía 60 Local Espinal; Fiscalía 11 Seccional» → one per line (version 2.46).
    inicial: (v) => String(v).charAt(0).toLocaleUpperCase("es-CO") + String(v).slice(1), // «el suscrito» → «El suscrito»
    "líneas": (v) => String(v).split(/\s*;\s*/).filter(Boolean).join("\n"),
    lineas: (v) => String(v).split(/\s*;\s*/).filter(Boolean).join("\n"),
    puntos: (v) => (/^\d[\d.\s]*$/.test(String(v).trim()) ? String(v).replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".") : String(v)),
  };
  // {{#key}}…{{/key}} (version 2.46) is an optional passage: printed only when key has a value.
  const markerKey = (tag) => String(tag).split("|")[0].trim().replace(/^[#^/]\s*/, "");
  function markerValue(data, tag) {
    const [key, ...fmts] = String(tag).split("|").map((x) => x.trim());
    let v = data[key];
    if (v === undefined || v === null || String(v).trim() === "") return undefined;
    for (const f of fmts) if (FORMATS[f.toLowerCase()]) v = FORMATS[f.toLowerCase()](v);
    return v;
  }

  /** {{variables}} used in a .docx (text of every part, tags removed). */
  function docxPlain(bytes) {
    const zip = new window.PizZip(bytes);
    return Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n))
      .map((n) => zip.file(n).asText().replace(/<[^>]+>/g, "")).join("\n");
  }
  function docxVariables(bytes) {
    return [...new Set([...docxPlain(bytes).matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((m) => markerKey(m[1])).filter(Boolean))];
  }
  /** Variables written one per line ({{key|líneas}}): several values separated by «;». */
  const docxLineVars = (bytes) => [...new Set([...docxPlain(bytes).matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)]
    .filter((m) => /\|\s*l[ií]neas\b/i.test(m[1])).map((m) => markerKey(m[1])))];
  /** Variables that open an optional passage {{#key}}: left empty, the passage is left out. */
  const docxOptional = (bytes) => [...new Set([...docxPlain(bytes).matchAll(/\{\{\s*#\s*([^{}]+?)\s*\}\}/g)].map((m) => markerKey(m[1])))];

  // Version 2.47: a missing datum comes out as [FILL: label] highlighted in yellow, in the run's own font.
  const MISS = "\u2063";
  // Where <w:highlight> goes among a run's properties (Word wants them in schema order).
  const AFTER_HIGHLIGHT = /<w:(u|effect|bdr|shd|fitText|vertAlign|rtl|cs|em|lang|eastAsianLayout|specVanish|oMath|rPrChange)\b/;
  function highlighted(rPr) {
    const body = rPr.replace(/^<w:rPr>|<\/w:rPr>$/g, "").replace(/<w:highlight\b[^>]*\/>/g, "");
    const at = body.search(AFTER_HIGHLIGHT);
    const hl = '<w:highlight w:val="yellow"/>';
    return `<w:rPr>${at < 0 ? body + hl : body.slice(0, at) + hl + body.slice(at)}</w:rPr>`;
  }
  function markMissing(xmlText) {
    if (!xmlText.includes(MISS)) return xmlText;
    return xmlText.replace(/<w:r\b([^>]*)>([\s\S]*?)<\/w:r>/g, (run, attrs, inner) => {
      if (!inner.includes(MISS)) return run;
      const rPr = (inner.match(/^\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/) || ["", ""])[1];
      const hl = highlighted(rPr || "<w:rPr></w:rPr>");
      const body = inner.replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, (t, text) => {
        if (!text.includes(MISS)) return t;
        return text.split(MISS).map((piece, i) => (i % 2
          ? `</w:r><w:r>${hl}<w:t xml:space="preserve">${piece}</w:t></w:r><w:r${attrs}>${rPr}`
          : `<w:t xml:space="preserve">${piece}</w:t>`)).join("");
      });
      return `<w:r${attrs}>${body}</w:r>`.replace(/<w:r(?:\s[^>]*)?>(<w:rPr>(?:(?!<\/w:rPr>)[\s\S])*<\/w:rPr>)?(<w:t xml:space="preserve"><\/w:t>)?<\/w:r>/g, "");
    });
  }
  /** Fill a .docx template; missing values become [FILL: label] highlighted (`labels`: key → readable name). */
  // Version 2.48: Word turns a typed e-mail into a link. A {{marker}} inside a link, or an optional
  // passage that starts outside it and ends inside, would break the file (Word «detectó un error»):
  // such links become plain text before filling.
  function unwrapMarkerLinks(zip) {
    for (const name of Object.keys(zip.files).filter((n) => PARTS.test(n))) {
      const x = zip.file(name).asText();
      const y = x.replace(/<w:hyperlink\b[^>]*>([\s\S]*?)<\/w:hyperlink>/g, (all, inner) => (/\{\{|\}\}/.test(inner.replace(/<[^>]+>/g, "")) ? inner : all));
      if (y !== x) zip.file(name, y);
    }
  }
  // Version 2.2.58 (John): every document the App generates ends its footer with the name of the user who generated it.
  // The page tells who that is with window.JuanmaGeneratedBy(); without it (tests, public pages) nothing is added.
  const FOOT_MARK = "Documento generado por:";
  function stampFooter(zip) {
    const who = String(window.JuanmaGeneratedBy?.() || "").trim();
    if (!who || !zip.file("word/document.xml")) return;
    const line = `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="40" w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:color w:val="989795"/><w:sz w:val="14"/><w:szCs w:val="14"/></w:rPr><w:t xml:space="preserve">${FOOT_MARK} ${xml(who)}</w:t></w:r></w:p>`;
    let feet = Object.keys(zip.files).filter((n) => /^word\/footer\d*\.xml$/.test(n));
    if (!feet.length) {
      // A Word without footer gets one (part, relationship, content type and a reference in every section).
      const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
      zip.file("word/footer1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}></w:ftr>`);
      const rels = zip.file("word/_rels/document.xml.rels");
      const relXml = rels ? rels.asText() : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
      zip.file("word/_rels/document.xml.rels", relXml.replace("</Relationships>", '<Relationship Id="rIdUserFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>'));
      const ct = zip.file("[Content_Types].xml").asText();
      zip.file("[Content_Types].xml", ct.replace("</Types>", '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'));
      let doc = zip.file("word/document.xml").asText();
      const ref = '<w:footerReference w:type="default" r:id="rIdUserFooter"/>';
      if (!/<w:sectPr[\s>]/.test(doc)) doc = doc.replace("</w:body>", `<w:sectPr>${ref}</w:sectPr></w:body>`);
      else doc = doc.replace(/<w:sectPr([^>]*)\/>/g, `<w:sectPr$1>${ref}</w:sectPr>`).replace(/<w:sectPr(?![^>]*\/>)([^>]*)>/g, (m, a) => `<w:sectPr${a}>${ref}`);
      if (!/xmlns:r=/.test(doc.slice(0, 600))) doc = doc.replace(/<w:document\b/, '<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
      zip.file("word/document.xml", doc);
      feet = ["word/footer1.xml"];
    }
    for (const name of feet) {
      const x = zip.file(name).asText();
      if (x.includes(FOOT_MARK)) continue;
      zip.file(name, /<\/w:ftr>\s*$/.test(x) ? x.replace(/<\/w:ftr>\s*$/, `${line}</w:ftr>`) : x.replace(/<w:ftr\b([^>]*)\/>\s*$/, `<w:ftr$1>${line}</w:ftr>`));
    }
  }
  function fillDocx(bytes, data, labels = {}) {
    const zip = new window.PizZip(bytes);
    unwrapMarkerLinks(zip);
    const doc = new window.docxtemplater(zip, {
      delimiters: { start: "{{", end: "}}" },
      paragraphLoop: true,
      linebreaks: true,
      parser: (tag) => ({ get: (scope) => markerValue(scope, tag) }),
      // An optional passage without its value is dropped; a plain marker shows [FILL: …].
      nullGetter: (part) => (part.module ? "" : `${MISS}[FILL: ${labels[markerKey(part.value)] || markerKey(part.value)}]${MISS}`),
    });
    doc.render(data);
    const out = doc.getZip();
    for (const name of Object.keys(out.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n))) {
      const x = out.file(name).asText();
      if (x.includes(MISS)) out.file(name, markMissing(x));
    }
    stampFooter(out);
    return out.generate({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  // **bold**, *italic*, [FILL: …] highlighted.
  function runs(text) {
    const out = [];
    const re = /(\*\*[^*]+\*\*|\*[^*]+\*|\[FILL:[^\]]*\])/g;
    let last = 0, m;
    const push = (t, { b, i, fill } = {}) => {
      if (!t) return;
      const pr = [b && "<w:b/>", i && "<w:i/>", fill && '<w:highlight w:val="yellow"/>'].filter(Boolean).join("");
      out.push(`<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ""}<w:t xml:space="preserve">${xml(t)}</w:t></w:r>`);
    };
    while ((m = re.exec(text))) {
      push(text.slice(last, m.index));
      const tok = m[0];
      if (tok.startsWith("**")) {
        const inner = tok.slice(2, -2);
        if (inner.startsWith("[FILL:")) push(inner, { b: true, fill: true }); else push(inner, { b: true });
      } else if (tok.startsWith("[FILL:")) push(tok, { b: true, fill: true });
      else push(tok.slice(1, -1), { i: true });
      last = m.index + tok.length;
    }
    push(text.slice(last));
    return out.join("");
  }

  function paragraph(line) {
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) return `<w:p><w:pPr><w:pStyle w:val="Heading${m[1].length}"/></w:pPr>${runs(m[2])}</w:p>`;
    if ((m = line.match(/^\s*[-*]\s+(.*)/))) return `<w:p><w:pPr><w:ind w:left="567" w:hanging="283"/></w:pPr>${runs("• " + m[1])}</w:p>`;
    if ((m = line.match(/^\s*(\d+)\.\s+(.*)/))) return `<w:p><w:pPr><w:ind w:left="567" w:hanging="340"/></w:pPr>${runs(m[1] + ". " + m[2])}</w:p>`;
    if (/^-{3,}$/.test(line.trim())) return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="989795"/></w:pBdr></w:pPr></w:p>`;
    if (/^>\s?/.test(line)) return `<w:p><w:pPr><w:ind w:left="567"/></w:pPr>${runs(line.replace(/^>\s?/, ""))}</w:p>`;
    if (/^\|/.test(line)) {
      if (/^\|\s*-/.test(line)) return "";
      return `<w:p>${runs(line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).join("    "))}</w:p>`;
    }
    return `<w:p><w:pPr><w:jc w:val="both"/></w:pPr>${runs(line)}</w:p>`;
  }

  /** Build a .docx Blob from Markdown text (letter size, 2.5 cm margins, Times New Roman 12). */
  function markdownToDocx(md, title = "Documento") {
    const body = md.replace(/\r\n/g, "\n").split("\n").map((l) => (l.trim() ? paragraph(l.trimEnd()) : '<w:p/>')).join("");
    // Version 2.2.4: every Word the App writes comes out of John's letterhead template (logo, QR, footer, border, watermark, page
    // number; public/membrete-base.docx). The plain package below is only the fallback when the letterhead images are not loaded.
    const letterhead = window.JuanmaMembreteAssets?.docx;
    if (letterhead) {
      const lz = new window.PizZip(b64ToBytes(letterhead));
      lz.file("word/document.xml", lz.file("word/document.xml").asText().replace("<!--BODY-->", () => body.replace(/w:val="Heading(\d)"/g, 'w:val="Ttulo$1"')));
      if (lz.file("docProps/core.xml")) lz.file("docProps/core.xml", lz.file("docProps/core.xml").asText().replace(/<dc:title>[\s\S]*?<\/dc:title>|<dc:title\/>/, () => `<dc:title>${xml(title)}</dc:title>`));
      stampFooter(lz);
      return lz.generate({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    }
    const zip = new window.PizZip();
    zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
    zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
    zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title><dc:creator>TecjuridicosApp</dc:creator></cp:coreProperties>`);
    zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    const heading = (n, size) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/>${n === 1 ? '<w:jc w:val="center"/>' : ""}<w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:color w:val="002B6A"/><w:sz w:val="${size}"/></w:rPr></w:style>`;
    zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="24"/><w:lang w:val="es-CO"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${heading(1, 30)}${heading(2, 26)}${heading(3, 24)}</w:styles>`);
    zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`);
    stampFooter(zip);
    return zip.generate({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  /** Replace {{variables}} in text; missing ones become [FILL: label] (highlighted on screen and in Word). */
  function fillText(text, data, labels = {}) {
    // Optional passages {{#key}}…{{/key}} (as in Word): printed only when key has a value; a line left empty goes away.
    text = text.replace(/\{\{\s*#\s*([^{}]+?)\s*\}\}([\s\S]*?)\{\{\s*\/\s*\1\s*\}\}\n?/g, (_, k, inner) => {
      const v = markerValue(data, k);
      return v !== undefined && v !== null && String(v).trim() !== "" ? inner + (/\n$/.test(inner) ? "" : "\n") : "";
    });
    return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, tag) => {
      const key = markerKey(tag), v = markerValue(data, tag);
      // A multi-line value (the addressee block) keeps its lines: Markdown hard breaks.
      return v !== undefined && v !== null && String(v).trim() !== "" ? (String(v).includes("\n") ? String(v).replace(/\n/g, "  \n") + "  " : String(v)) : `[FILL: ${labels[key] || key}]`;
    });
  }
  const textOptional = (text) => [...new Set([...text.matchAll(/\{\{\s*#\s*([^{}]+?)\s*\}\}/g)].map((m) => markerKey(m[1])))];
  const textVariables = (text) => [...new Set([...text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((m) => markerKey(m[1])).filter(Boolean))];

  // ----- Firm's own Word forms (minutas): find the blanks and turn them into {{variables}} -----
  const dec = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  // ____ / ...... / XXXX / [NOMBRE] / «nombre» / <<nombre>>
  const BLANK = /_{4,}|\.{6,}|…{2,}|X{3,}|\[[^\[\]{}]{2,80}\]|«[^«»]{2,80}»|<<[^<>]{2,80}>>/g;
  const PARTS = /^word\/(document|header\d*|footer\d*)\.xml$/;
  const T_RE = /<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  const runText = (run) => [...run.matchAll(T_RE)].map((m) => dec(m[2])).join("");
  function setRun(run, text) {
    let first = true;
    return run.replace(/<w:highlight\s[^>]*\/>/g, "").replace(T_RE, () => {
      const out = `<w:t xml:space="preserve">${first ? xml(text) : ""}</w:t>`;
      first = false;
      return out;
    });
  }

  /**
   * Walk the blanks of a .docx in a fixed order. Without `assign` it returns
   * [{id, kind, text, before, after}]; with `assign` (Map id → variable key)
   * it returns the new file bytes with those blanks replaced by {{key}}.
   * Highlighted text and underlined empty space count as blanks too.
   */
  function walkBlanks(bytes, assign = null) {
    const zip = new window.PizZip(bytes);
    const found = [];
    const names = Object.keys(zip.files).filter((n) => PARTS.test(n))
      .sort((a, b) => (a === "word/document.xml" ? -1 : b === "word/document.xml" ? 1 : a.localeCompare(b)));
    for (const name of names) {
      const xmlIn = zip.file(name).asText();
      const xmlOut = xmlIn.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (para) => {
        const ptext = runText(para);
        const ctx = (a, z) => ({ before: ptext.slice(Math.max(0, a - 70), a), after: ptext.slice(z, z + 50) });
        let off = 0, prevHl = null;
        return para.replace(/<w:r[ >][\s\S]*?<\/w:r>/g, (run) => {
          const rPr = (run.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [""])[0];
          const text = runText(run);
          if (!text) return run;
          const start = off;
          off += text.length;
          if (/<w:highlight w:val="(?!none)/.test(rPr) && text.trim()) {
            if (prevHl) { // Word splits one highlighted phrase into several runs
              prevHl.text += text;
              prevHl.after = ptext.slice(off, off + 50);
              return assign?.get(prevHl.id) ? setRun(run, "") : run;
            }
            const c = { id: found.length, kind: "resaltado", text, ...ctx(start, off) };
            found.push(c);
            prevHl = c;
            const k = assign?.get(c.id);
            return k ? setRun(run, `{{${k}}}`) : run;
          }
          prevHl = null;
          if (/<w:u w:val="(?!none)/.test(rPr) && !text.trim() && text.length >= 3) {
            const c = { id: found.length, kind: "subrayado", text, ...ctx(start, off) };
            found.push(c);
            const k = assign?.get(c.id);
            return k ? setRun(run, `{{${k}}}`) : run;
          }
          let tOff = start;
          return run.replace(T_RE, (whole, attrs, raw) => {
            const t = dec(raw);
            const base = tOff;
            tOff += t.length;
            let changed = false;
            const nt = t.replace(BLANK, (m, i) => {
              const c = { id: found.length, kind: "espacio", text: m, ...ctx(base + i, base + i + m.length) };
              found.push(c);
              const k = assign?.get(c.id);
              if (!k) return m;
              changed = true;
              return `{{${k}}}`;
            });
            return changed ? `<w:t xml:space="preserve">${xml(nt)}</w:t>` : whole;
          });
        });
      });
      if (assign && xmlOut !== xmlIn) zip.file(name, xmlOut);
    }
    return assign ? zip.generate({ type: "uint8array" }) : found;
  }
  const docxBlanks = (bytes) => walkBlanks(bytes);
  const applyBlanks = (bytes, assign) => walkBlanks(bytes, assign);

  // Which client/case datum a blank most likely asks for, from the words around it.
  const plain = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const GUESS = [
    [/(c\.?\s?c\.?|cedula( de ciudadania)?|identificad[oa] con( la)?( cedula)?|documento( de identidad)?|nit)\s*(no\.?|n\.?o|numero|#)?\s*[:.]?\s*$/, "cliente.documento"],
    [/(tarjeta profesional|t\.\s?p\.)\s*(no\.?|numero)?\s*$/, "abogado.tarjeta_profesional"],
    [/(en letras|\(\s*)$/, "honorarios.valor_letras"],
    [/(honorarios|suma( fija)? de|valor de|por valor de|precio de|la suma de)\s*\$?\s*$/, "honorarios.valor"],
    [/(forma de pago|pagader[oa]s? asi|pagara asi|se pagara)\s*[:.]?\s*$/, "honorarios.forma_pago"],
    [/radicad[oa]\s*(no\.?|numero)?\s*[:.]?\s*$/, "expediente.radicado"],
    [/(contrato|carpeta)\s*(n\.?\s?o\.?|no\.?|numero|#)\s*[:.]?\s*$/, "expediente.carpeta"],
    [/(correo( electronico)?|e-?mail)\s*[:.]?\s*$/, "cliente.correo"],
    [/(telefono|celular|movil|whatsapp)\s*(no\.?)?\s*[:.]?\s*$/, "cliente.telefono"],
    [/(direccion|domicilio en la)\s*[:.]?\s*$/, "cliente.direccion"],
    [/(domiciliad[oa]|residente|vecin[oa]|con domicilio)\s+(en|de)\s+(la ciudad de\s+|el municipio de\s+)?$/, "cliente.ciudad"],
    [/(juez|juzgado|despacho|magistrad[oa])\s*[:.]?\s*$/, "expediente.despacho"],
    [/(contra|demandad[oa]|accionad[oa]|convocad[oa])\s*[:.]?\s*$/, "expediente.contraparte"],
    [/(ciudad y fecha|lugar y fecha)\s*[:.]?\s*$/, "fecha.ciudad_y_fecha"],
    [/(fecha|a los)\s*[:.]?\s*$/, "fecha.hoy"],
    [/(apoderad[oa]|abogad[oa])\s*(judicial)?\s*(al doctor|a la doctora|doctor|doctora|dr\.?|dra\.?)?\s*$/, "abogado.nombre"],
    [/(senor(a|es)?|sr\.?|sra\.?|yo,?|suscrito,?|nombre( completo)?|poderdante|otorgante|cliente|contratante|mandante|accionante|demandante|peticionari[oa])\s*[:.]?\s*$/, "cliente.nombre"],
  ];
  const BY_TEXT = [
    [/cedula|\bc\.?c\b|documento|identificacion|\bnit\b/, "cliente.documento"], [/radicado/, "expediente.radicado"],
    [/correo|e-?mail/, "cliente.correo"], [/telefono|celular/, "cliente.telefono"], [/direccion/, "cliente.direccion"],
    [/juzgado|despacho|juez/, "expediente.despacho"], [/demandad|contraparte|entidad/, "expediente.contraparte"],
    [/honorario|valor del contrato|valor total/, "honorarios.valor"], [/forma de pago|cuotas/, "honorarios.forma_pago"],
    [/apoderad|abogad/, "abogado.nombre"], [/tarjeta/, "abogado.tarjeta_profesional"], [/fecha/, "fecha.hoy"],
    [/ciudad|municipio/, "cliente.ciudad"], [/nombre|cliente|poderdante|demandante|otorgante/, "cliente.nombre"],
  ];
  function guessVariable({ text, before, after }) {
    const t = plain(text);
    if (/[a-z]{3}/.test(t)) for (const [re, key] of BY_TEXT) if (re.test(t)) return key;
    const b = plain(before);
    for (const [re, key] of GUESS) if (re.test(b)) return key;
    if (/^\s*,?\s*(mayor de edad|identificad[oa]|domiciliad[oa]|vecin[oa])/.test(plain(after))) return "cliente.nombre";
    return "";
  }

  // ----- Version 2.44: a minuta written with a real client's data: those words become {{markers}} -----
  // Matching ignores capitals, accents and non-breaking spaces, one character for one, so offsets stay put.
  const fold = (s) => [...String(s)].map((c) => (c === "\u00a0" ? " " : c.normalize("NFD")[0].toLowerCase())).join("");
  const WORD = /[\p{L}\p{N}]/u;
  /** Where `needle` sits in `hay` as a whole word or number: [start, end] pairs, left to right, no overlaps. */
  function spots(hay, needle) {
    const h = fold(hay), n = fold(needle).trim(), out = [];
    if (n.length < 3) return out;
    for (let i = h.indexOf(n); i >= 0; i = h.indexOf(n, i + 1)) {
      if (WORD.test(h[i - 1] || "") || WORD.test(h[i + n.length] || "")) continue;
      if (out.length && i < out[out.length - 1][1]) continue;
      out.push([i, i + n.length]);
    }
    return out;
  }
  const PART_ORDER = (a, b) => (a === "word/document.xml" ? -1 : b === "word/document.xml" ? 1 : a.localeCompare(b));
  const paragraphText = (para) => [...para.matchAll(T_RE)].map((m) => dec(m[2])).join("");

  /**
   * How often each text appears in the Word (document, headers and footers):
   * [{text, count, as: [exact spellings found], context}] for the texts that appear at least once.
   */
  function docxFind(bytes, texts) {
    const zip = new window.PizZip(bytes);
    const paras = Object.keys(zip.files).filter((n) => PARTS.test(n)).sort(PART_ORDER)
      .flatMap((n) => [...zip.file(n).asText().matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => paragraphText(m[0])));
    const out = [];
    for (const text of [...new Set(texts.map((t) => String(t || "").trim()).filter(Boolean))]) {
      let count = 0, context = "";
      const as = new Set();
      for (const p of paras) for (const [a, z] of spots(p, text)) {
        count++;
        as.add(p.slice(a, z));
        if (!context) context = `${a > 50 ? "…" : ""}${p.slice(Math.max(0, a - 50), a)}[[${p.slice(a, z)}]]${p.slice(z, z + 40)}${z + 40 < p.length ? "…" : ""}`;
      }
      if (count) out.push({ text, count, as: [...as], context });
    }
    return out;
  }

  /**
   * Replace every appearance of each `text` by its {{marker}}, keeping the formatting of the run
   * where the text starts (a name Word split into several runs comes out as one marker).
   * An e-mail link that held a replaced text loses the link, since its address changes per case.
   * `items`: [{text, marker}] with marker like "cliente.nombre|mayúsculas" (or `out`, the exact text to write). Longer texts go first.
   */
  function docxReplace(bytes, items) {
    const list = items.filter((x) => x.text && (x.marker || x.out)).sort((a, b) => b.text.length - a.text.length);
    const zip = new window.PizZip(bytes);
    let total = 0;
    for (const name of Object.keys(zip.files).filter((n) => PARTS.test(n))) {
      const xmlIn = zip.file(name).asText();
      const xmlOut = xmlIn.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (para) => {
        const nodes = [...para.matchAll(T_RE)].map((m) => dec(m[2]));
        const full = nodes.join("");
        // Each character keeps or drops; a marker is written where its text started.
        const drop = new Uint8Array(full.length), put = new Map();
        for (const { text, marker, out } of list) for (const [a, z] of spots(full, text)) {
          if (drop.subarray(a, z).some((d) => d)) continue;
          drop.fill(1, a, z);
          put.set(a, out ?? `{{${marker}}}`);
          total++;
        }
        if (!put.size) return para;
        let off = 0, i = 0;
        const fresh = nodes.map((t) => {
          let o = "";
          for (let k = 0; k < t.length; k++, off++) {
            if (put.has(off)) o += put.get(off);
            if (!drop[off]) o += t[k];
          }
          return o;
        });
        let res = para.replace(T_RE, () => `<w:t xml:space="preserve">${xml(fresh[i++])}</w:t>`);
        res = res.replace(/<w:hyperlink\b[^>]*>([\s\S]*?)<\/w:hyperlink>/g, (h, inner) => (/\{\{/.test(paragraphText(inner)) ? inner : h));
        return res;
      });
      if (xmlOut !== xmlIn) zip.file(name, xmlOut);
    }
    return { bytes: zip.generate({ type: "uint8array" }), count: total };
  }

  /**
   * Texts of the case that a filled minuta probably carries, each with the marker that writes it again:
   * the value as saved, in capitals, and a document number with dots (65.760.174).
   * `data` = the case's template values; `skip` = keys too general to look for (a city appears everywhere).
   */
  const FIND_SKIP = /^(cliente\.(ciudad|departamento|tipo_documento)|expediente\.(ciudad|departamento|tipo_proceso|subproceso|area|hechos)|oficina\.(ciudad|nombre)|destinatario\.(tratamiento|bloque)|honorarios\.cuotas|fecha\.|_partes)/;
  // ----- Gender words (version 2.50): «identificada», «la suscrita», «domiciliado» → {{cliente.…}} -----
  const GENDER_RE = /(?:\b(el|la)\s+)?\bsuscrit([oa])\b(?:\s*(?:\([ao]\)|\/[ao]))?|\b(identificad|domiciliad)([oa])\b(?:\s*(?:\([ao]\)|\/[ao]))?|(?:\b(de\s+)?(el|la)\s+)?\b(se[ñn]or)(a)?\b(?:\s*(?:\([ao]\)|\/[ao]))?/gi;
  // Version 2.2.53: the sides of the case written as «el demandante», «la demandada», «los ejecutados»… → {{parte.activa}} / {{parte.pasiva}}.
  const ACTIVE_WORD = /^(demandante|ejecutante|convocante|querellante|denunciante|reclamante|peticionari[oa]|v[ií]ctima)s?$/i;
  const PARTY_RE = /(?:\b(el|la|los|las)\s+)?\b(demandantes?|ejecutantes?|convocantes?|querellantes?|denunciantes?|reclamantes?|peticionari[oa]s?|v[ií]ctimas?|demandad[oa]s?|ejecutad[oa]s?|convocad[oa]s?|denunciad[oa]s?|indiciad[oa]s?|acusad[oa]s?|procesad[oa]s?|querellad[oa]s?)\b/gi;
  // Version 2.2.56: «el / al / del PODERDANTE» of the services contract follows the client's gender («la / a la / de la PODERDANTE»).
  const PODERDANTE_RE = /\b(el|al|del)(?=\s+poderdante\b)/gi;
  // A word that is already part of a {{marker}} (e.g. {{cliente.identificado}}) is not offered again.
  const inMarker = (text, at) => text.lastIndexOf("{{", at) > text.lastIndexOf("}}", at);
  const NOT_CLIENT = /\b(dr|dra|doctor|doctora|abogad[oa]|apoderad[oa]|funcionari[oa]|contratista|receptor)\b/i;
  /**
   * The gendered words of the Word, one entry per appearance, in reading order. «client» says whether the words look
   * like the client's (the lawyer's «identificado con la cédula…» does not); the person confirms each one.
   */
  function docxGenderWords(bytes, names = []) {
    const zip = new window.PizZip(bytes), out = [], who = names.map((n) => fold(n)).filter((n) => n.length > 3);
    for (const part of Object.keys(zip.files).filter((n) => PARTS.test(n)).sort(PART_ORDER)) {
      [...zip.file(part).asText().matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].forEach((pm, para) => {
        const text = paragraphText(pm[0]);
        for (const m of text.matchAll(GENDER_RE)) {
          const start = m.index, end = start + m[0].length, shown = m[0];
          if (inMarker(text, start)) continue;
          // «señor/señora» is the client's only right after «mi poderdante,» or right before the client's name
          if (m[7] && !(/poderdante,?\s+$/i.test(text.slice(0, start)) || /^\s*\{\{\s*cliente\.nombre/.test(text.slice(end)))) continue;
          const key = m[7] ? (m[5] ? "cliente.del_senor" : m[6] ? "cliente.el_senor" : "cliente.senor") : m[2] ? (m[1] ? "cliente.suscrito" : "cliente.suscrito_solo") : m[3].toLowerCase() === "identificad" ? "cliente.identificado" : "cliente.domiciliado";
          const letters = shown.replace(/[^\p{L}]/gu, "");
          const fmt = letters.length > 2 && letters === letters.toLocaleUpperCase("es-CO") ? "|mayúsculas" : /^\p{Lu}/u.test(shown) ? "|inicial" : "";
          const before = text.slice(Math.max(0, start - 45), start);
          out.push({ id: out.length, part, para, start, end, text: shown, marker: key + fmt,
            client: !NOT_CLIENT.test(before) && !who.some((n) => fold(before).includes(n)),
            context: `${start > 50 ? "…" : ""}${text.slice(Math.max(0, start - 50), start)}[[${shown}]]${text.slice(end, end + 40)}${end + 40 < text.length ? "…" : ""}` });
        }
        for (const m of text.matchAll(PODERDANTE_RE)) {
          const start = m.index, end = start + m[0].length, shown = m[0];
          if (inMarker(text, start)) continue;
          const letters = shown.replace(/[^\p{L}]/gu, "");
          const fmt = /^\p{Lu}{2}/u.test(shown) ? "|mayúsculas" : /^\p{Lu}/u.test(shown) ? "|inicial" : "";
          out.push({ id: out.length, part, para, start, end, text: shown, marker: `cliente.${shown.toLowerCase()}${fmt}`, client: true,
            context: `${start > 50 ? "…" : ""}${text.slice(Math.max(0, start - 50), start)}[[${shown}]]${text.slice(end, end + 40)}${end + 40 < text.length ? "…" : ""}` });
        }
        for (const m of text.matchAll(PARTY_RE)) {
          const start = m.index, end = start + m[0].length, shown = m[0];
          if (inMarker(text, start)) continue;
          const side = ACTIVE_WORD.test(m[2]) ? "parte.activa" : "parte.pasiva";
          const letters = shown.replace(/[^\p{L}]/gu, "");
          const fmt = letters.length > 2 && letters === letters.toLocaleUpperCase("es-CO") ? "|mayúsculas" : /^\p{Lu}/u.test(shown) ? "|inicial" : "";
          out.push({ id: out.length, part, para, start, end, text: shown, marker: side + (m[1] ? "" : "_sola") + fmt, client: true,
            context: `${start > 50 ? "…" : ""}${text.slice(Math.max(0, start - 50), start)}[[${shown}]]${text.slice(end, end + 40)}${end + 40 < text.length ? "…" : ""}` });
        }
      });
    }
    return out;
  }
  /** Writes {{markers}} over exact spots of the Word ({part, para, start, end, marker}), keeping the first run's format. */
  function docxReplaceAt(bytes, edits) {
    const zip = new window.PizZip(bytes);
    let total = 0;
    for (const part of [...new Set(edits.map((e) => e.part))]) {
      const mine = edits.filter((e) => e.part === part);
      let idx = -1;
      const xmlOut = zip.file(part).asText().replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (para) => {
        idx++;
        const here = mine.filter((e) => e.para === idx);
        if (!here.length) return para;
        const nodes = [...para.matchAll(T_RE)].map((m) => dec(m[2]));
        const full = nodes.join("");
        const drop = new Uint8Array(full.length), put = new Map();
        for (const e of here) { drop.fill(1, e.start, e.end); put.set(e.start, `{{${e.marker}}}`); total++; }
        let off = 0, i = 0;
        const fresh = nodes.map((t) => {
          let o = "";
          for (let k = 0; k < t.length; k++, off++) { if (put.has(off)) o += put.get(off); if (!drop[off]) o += t[k]; }
          return o;
        });
        return para.replace(T_RE, () => `<w:t xml:space="preserve">${xml(fresh[i++])}</w:t>`)
          .replace(/<w:hyperlink\b[^>]*>([\s\S]*?)<\/w:hyperlink>/g, (h, inner) => (/\{\{/.test(paragraphText(inner)) ? inner : h));
      });
      zip.file(part, xmlOut);
    }
    return { bytes: zip.generate({ type: "uint8array" }), count: total };
  }
  /** The paragraphs of the Word's body that have text: [{index, text}] (index counts every paragraph, as docxInsertParagraph expects). */
  function docxParagraphs(bytes) {
    const body = new window.PizZip(bytes).file("word/document.xml")?.asText() || "";
    return [...body.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m, index) => ({ index, text: paragraphText(m[0]).trim() })).filter((p) => p.text);
  }
  /**
   * Adds a paragraph holding `{{marker}}` right after paragraph `index` of the body, with that paragraph's own paragraph
   * and first-run format (so it looks like the text around it). Returns the new Word.
   */
  function docxInsertParagraph(bytes, index, marker) {
    const zip = new window.PizZip(bytes);
    let at = -1, done = false;
    const out = zip.file("word/document.xml").asText().replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (para) => {
      at++;
      if (at !== index) return para;
      done = true;
      const pPr = (para.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [""])[0];
      const rPr = (para.match(/<w:r[ >][\s\S]*?(<w:rPr>[\s\S]*?<\/w:rPr>)/) || [])[1] || "";
      return `${para}<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">{{${xml(marker)}}}</w:t></w:r></w:p>`;
    });
    if (!done) throw new Error("No se encontró ese párrafo en el Word.");
    zip.file("word/document.xml", out);
    return zip.generate({ type: "uint8array" });
  }
  function caseTexts(data) {
    const out = [];
    for (const [key, raw] of Object.entries(data || {})) {
      const v = String(raw ?? "").trim();
      if (FIND_SKIP.test(key) || v.length < 4 || v.includes("\n") || v.length > 120) continue;
      out.push({ text: v, key });
      if (/^\d{5,}$/.test(v.replace(/[.\s]/g, ""))) out.push({ text: FORMATS.puntos(v), key: `${key}|puntos` });
    }
    return out;
  }
  /** The marker for a text as the Word writes it: capitals when the Word has it in capitals. */
  function markerFor(key, found) {
    if (key.includes("|")) return key;
    const letters = found.replace(/[^\p{L}]/gu, "");
    return letters.length > 2 && letters === letters.toLocaleUpperCase("es-CO") ? `${key}|mayúsculas` : key;
  }
  // "Ibagué, 16 de octubre de 2026" and other written dates: the place-and-date line and loose dates.
  const DATE_RE = /\b\d{1,2} de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) de \d{4}\b/gi;
  function docxDates(bytes) {
    const text = docxText(bytes);
    const out = [];
    for (const m of text.matchAll(DATE_RE)) {
      const line = text.slice(text.lastIndexOf("\n", m.index) + 1, m.index);
      const place = line.match(/([\p{L} .]{3,40}),\s*$/u);
      const whole = place && line.trim() === place[0].trim() ? `${place[1].trim()}, ${m[0]}` : m[0];
      if (!out.includes(whole)) out.push(whole);
    }
    return out;
  }

  /** Plain text of a .docx (one paragraph per line, blank line between), to build a PDF from a Word form. */
  function docxText(bytes) {
    const zip = new window.PizZip(bytes);
    const body = zip.file("word/document.xml")?.asText() || "";
    return [...body.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => {
      const bold = /<w:b\/>|<w:b w:val="(1|true)"\/>/.test((p[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [""])[0]);
      const t = [...p[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)].map((m) => (m[0] === "<w:tab/>" ? "    " : m[0] === "<w:br/>" ? "\n" : dec(m[1]))).join("");
      return t.trim() && bold && t.length < 120 ? `**${t.trim()}**` : t;
    }).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  window.JuanmaDocx = { b64ToBytes, docxText, docxVariables, docxOptional, docxLineVars, docxGenderWords, docxReplaceAt, docxParagraphs, docxInsertParagraph, fillDocx, markdownToDocx, fillText, textVariables, textOptional, docxBlanks, applyBlanks, guessVariable,
    markerKey, docxFind, docxReplace, caseTexts, markerFor, docxDates };
})();
