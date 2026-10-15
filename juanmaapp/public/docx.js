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
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title><dc:creator>TecjuridicosApp</dc:creator></cp:coreProperties>`);
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
    [/radicad[oa]\s*(no\.?|numero)?\s*[:.]?\s*$/, "expediente.radicado"],
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

  window.JuanmaDocx = { b64ToBytes, docxVariables, fillDocx, markdownToDocx, fillText, textVariables, docxBlanks, applyBlanks, guessVariable };
})();
