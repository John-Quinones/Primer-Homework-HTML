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

  /** {{variables}} used in a .docx (text of every part, tags removed). */
  function docxVariables(bytes) {
    const zip = new window.PizZip(bytes);
    const text = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n))
      .map((n) => zip.file(n).asText().replace(/<[^>]+>/g, "")).join("\n");
    return [...new Set([...text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((m) => m[1].trim()))];
  }

  /** Fill a .docx template; missing values become [FILL: variable]. */
  function fillDocx(bytes, data) {
    const zip = new window.PizZip(bytes);
    const doc = new window.docxtemplater(zip, {
      delimiters: { start: "{{", end: "}}" },
      paragraphLoop: true,
      linebreaks: true,
      parser: (tag) => ({ get: (scope) => scope[tag.trim()] }),
      nullGetter: (part) => `[FILL: ${part.value.trim()}]`,
    });
    doc.render(data);
    return doc.getZip().generate({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
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
    const zip = new window.PizZip();
    zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
    zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
    zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title><dc:creator>JuanMaApp</dc:creator></cp:coreProperties>`);
    zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    const heading = (n, size) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/>${n === 1 ? '<w:jc w:val="center"/>' : ""}<w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:color w:val="002B6A"/><w:sz w:val="${size}"/></w:rPr></w:style>`;
    zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="24"/><w:lang w:val="es-CO"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${heading(1, 30)}${heading(2, 26)}${heading(3, 24)}</w:styles>`);
    zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`);
    return zip.generate({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  /** Replace {{variables}} in text; missing ones become [FILL: label] (highlighted on screen and in Word). */
  function fillText(text, data, labels = {}) {
    return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key) => {
      const v = data[key];
      return v !== undefined && v !== null && String(v).trim() !== "" ? String(v) : `[FILL: ${labels[key] || key}]`;
    });
  }
  const textVariables = (text) => [...new Set([...text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((m) => m[1].trim()))];

  window.JuanmaDocx = { b64ToBytes, docxVariables, fillDocx, markdownToDocx, fillText, textVariables };
})();
