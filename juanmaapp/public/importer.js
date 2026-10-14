// Excel / CSV import. Reads the file in the browser, lets the user map each
// column to a JuanMaApp field, then creates or completes clients and cases
// through the regular API (so it works the same against the server and the
// preview backend). Exposes window.JuanmaImport for app.js.
(function () {
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  // Target fields. "join" says how several columns mapped to one field combine.
  const TARGETS = [
    { key: "client.full_name", label: "Cliente · Nombre (o parte del nombre)", join: " ",
      match: ["nombre", "nombres", "apellido", "apellidos", "nombre completo", "cliente", "razon social", "nombre cliente", "primer nombre", "segundo nombre", "primer apellido", "segundo apellido"] },
    { key: "client.id_type", label: "Cliente · Tipo de documento", match: ["tipo documento", "tipo de documento", "tipo id", "tipo identificacion"] },
    { key: "client.id_number", label: "Cliente · Número de documento",
      match: ["cedula", "documento", "nit", "identificacion", "numero documento", "no documento", "cc", "numero de documento", "num documento", "doc"] },
    { key: "client.email", label: "Cliente · Correo", match: ["correo", "email", "e mail", "mail", "correo electronico"] },
    { key: "client.phone", label: "Cliente · Teléfono", join: " / ", match: ["telefono", "celular", "movil", "tel", "telefonos", "whatsapp"] },
    { key: "client.address", label: "Cliente · Dirección", match: ["direccion", "domicilio", "direccion residencia"] },
    { key: "client.city", label: "Cliente · Ciudad", match: ["ciudad", "municipio"] },
    { key: "client.notes", label: "Cliente · Notas", join: "\n", match: ["notas", "observaciones", "comentarios"] },
    { key: "case.category", label: "Expediente · Tipo de proceso", match: ["tipo proceso", "tipo de proceso", "area", "especialidad", "categoria", "materia"] },
    { key: "case.type", label: "Expediente · Subproceso", match: ["subproceso", "clase proceso", "clase de proceso", "accion", "tipo accion", "medio de control", "proceso"] },
    { key: "case.title", label: "Expediente · Asunto", match: ["asunto", "referencia", "descripcion", "objeto"] },
    { key: "case.status", label: "Expediente · Estado", match: ["estado", "estado proceso"] },
    { key: "case.counterparty", label: "Expediente · Contraparte / entidad",
      match: ["contraparte", "demandado", "demandada", "accionado", "entidad", "empleador", "convocado"] },
    { key: "case.facts", label: "Expediente · Hechos", join: "\n", match: ["hechos", "resumen", "detalle"] },
    { key: "case.custom", label: "Expediente · Campo propio (usa el nombre de la columna)",
      match: ["radicado", "numero radicado", "juzgado", "despacho", "fecha", "fecha radicacion", "etapa", "cuantia", "abogado", "responsable"] },
    { key: "", label: "— No importar —", match: [] },
  ];

  // Exact header match first; otherwise the longest known name whose words all
  // appear in the header ("Nombre del cliente" → nombre cliente, "Nombre
  // Abogado" → abogado). Internal keys such as IdCliente or Código stay unmapped.
  function guessTarget(header) {
    const h = norm(header);
    if (!h) return "";
    for (const t of TARGETS) if (t.match.includes(h)) return t.key;
    if (/^(id|cod|codigo|consecutivo|item)\b/.test(h) || /^id[a-z]/.test(h)) return "";
    const words = new Set(h.split(" "));
    let best = "", bestLen = 0;
    for (const t of TARGETS) {
      for (const m of t.match) {
        if (m.length > 3 && m.length > bestLen && m.split(" ").every((w) => words.has(w))) {
          best = t.key;
          bestLen = m.length;
        }
      }
    }
    return best;
  }

  function cellText(v) {
    if (v == null) return "";
    if (v instanceof Date) {
      // Excel dates arrive as UTC midnight; print as dd/mm/aaaa.
      const d = String(v.getUTCDate()).padStart(2, "0");
      const m = String(v.getUTCMonth() + 1).padStart(2, "0");
      return `${d}/${m}/${v.getUTCFullYear()}`;
    }
    if (typeof v === "boolean") return v ? "Sí" : "No";
    return String(v).trim();
  }

  // Minimal CSV/TSV parser with quoted fields; detects ; , or tab.
  function parseCsv(text) {
    text = text.replace(/^﻿/, "");
    const first = text.split(/\r?\n/, 1)[0];
    const delim = [";", "\t", ","].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === delim) { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // Returns [{ name, rows: [[...]] }] for every sheet in the file.
  async function readFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".csv") || name.endsWith(".txt") || name.endsWith(".tsv")) {
      let text = await file.text();
      // Access often exports CSV as Windows-1252; re-read if UTF-8 decoding failed.
      if (text.includes("\uFFFD")) text = new TextDecoder("windows-1252").decode(await file.arrayBuffer());
      return [{ name: file.name, rows: parseCsv(text) }];
    }
    if (name.endsWith(".xls") || name.endsWith(".mdb") || name.endsWith(".accdb")) {
      throw new Error("Ese formato no se puede leer. Desde Access exporte a Excel (.xlsx) o a texto (.csv).");
    }
    if (!name.endsWith(".xlsx")) throw new Error("Use un archivo .xlsx o .csv.");
    const result = await window.readXlsxFile(file);
    // read-excel-file 9 returns every sheet; older versions return rows of the first sheet.
    if (Array.isArray(result) && result[0] && "data" in result[0]) {
      return result.map((s) => ({ name: s.sheet, rows: s.data }));
    }
    return [{ name: "Hoja 1", rows: result }];
  }

  // Header row = first row with at least two non-empty cells.
  function splitHeader(rows) {
    const idx = rows.findIndex((r) => r.filter((c) => cellText(c)).length >= 2);
    if (idx < 0) return { headers: [], body: [] };
    const headers = rows[idx].map((h, i) => cellText(h) || `Columna ${i + 1}`);
    const body = rows.slice(idx + 1)
      .map((r) => headers.map((_, i) => cellText(r[i])))
      .filter((r) => r.some(Boolean));
    return { headers, body };
  }

  // Turn one spreadsheet row into { client, case, custom } using the mapping.
  function buildRecord(row, headers, mapping) {
    const parts = {};
    const custom = {};
    headers.forEach((h, i) => {
      const key = mapping[i];
      const v = row[i];
      if (!key || !v) return;
      if (key === "case.custom") { custom[h] = v; return; }
      (parts[key] ||= []).push(v);
    });
    const out = { client: {}, case: {}, custom };
    for (const t of TARGETS) {
      if (!t.key || t.key === "case.custom" || !parts[t.key]) continue;
      const [obj, field] = t.key.split(".");
      out[obj][field] = parts[t.key].join(t.join || " ");
    }
    return out;
  }

  const ID_TYPES = { "cedula de ciudadania": "CC", cedula: "CC", cc: "CC", nit: "NIT", "cedula de extranjeria": "CE", ce: "CE", pasaporte: "PA", pa: "PA", "tarjeta de identidad": "TI", ti: "TI" };
  const docKey = (s) => String(s || "").replace(/[^0-9a-zA-Z]/g, "").toUpperCase();

  /**
   * Import mapped rows. api(method, url, body) is the app's API helper.
   * opts: { withCases, createCatalog, defaultCategory, defaultType, onProgress }
   */
  async function run(records, api, opts) {
    const summary = { clientsCreated: 0, clientsCompleted: 0, casesCreated: 0, casesSkipped: 0, catalogCreated: [], errors: [] };
    const clients = await api("GET", "/clients");
    const byDoc = new Map(clients.filter((c) => docKey(c.id_number)).map((c) => [docKey(c.id_number), c]));
    const byName = new Map(clients.map((c) => [norm(c.full_name), c]));
    let catalog = await api("GET", "/catalog");
    const cases = opts.withCases ? await api("GET", "/cases") : [];
    const caseKeys = new Set(cases.map((k) => `${k.client_id}|${k.process_type_id}|${norm(k.title)}`));

    async function ensureCategory(name) {
      let cat = catalog.find((c) => norm(c.name) === norm(name));
      if (!cat) {
        if (!opts.createCatalog) throw new Error(`El tipo de proceso "${name}" no existe en Configuración.`);
        await api("POST", "/categories", { name });
        summary.catalogCreated.push(name);
        catalog = await api("GET", "/catalog");
        cat = catalog.find((c) => norm(c.name) === norm(name));
      }
      return cat;
    }
    async function ensureType(cat, name) {
      let t = cat.types.find((t) => norm(t.name) === norm(name));
      if (!t) {
        if (!opts.createCatalog) throw new Error(`El subproceso "${name}" no existe en ${cat.name}.`);
        t = await api("POST", `/categories/${cat.id}/types`, { name });
        summary.catalogCreated.push(`${cat.name} › ${name}`);
        catalog = await api("GET", "/catalog");
      }
      return t;
    }
    async function ensureField(cat, label) {
      const fresh = catalog.find((c) => c.id === cat.id);
      let f = fresh.fields.find((f) => norm(f.label) === norm(label));
      if (!f) {
        f = await api("POST", `/categories/${cat.id}/fields`, { label, field_type: "text" });
        summary.catalogCreated.push(`${cat.name} · campo ${label}`);
        catalog = await api("GET", "/catalog");
      }
      return f;
    }

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      const rowNo = rec.rowNumber;
      try {
        // ----- client: match by document number, else by exact name -----
        const c = { ...rec.client };
        if (c.id_type) c.id_type = ID_TYPES[norm(c.id_type)] || c.id_type.toUpperCase().slice(0, 4);
        let client = (docKey(c.id_number) && byDoc.get(docKey(c.id_number))) || (c.full_name && byName.get(norm(c.full_name)));
        if (!client) {
          if (!c.full_name) throw new Error("Sin nombre de cliente.");
          client = await api("POST", "/clients", c);
          summary.clientsCreated++;
        } else {
          // Only fill blanks; never overwrite data already in JuanMaApp.
          const fill = Object.fromEntries(Object.entries(c).filter(([k, v]) => v && !client[k]));
          if (Object.keys(fill).length) {
            client = await api("PUT", `/clients/${client.id}`, fill);
            summary.clientsCompleted++;
          }
        }
        if (docKey(client.id_number)) byDoc.set(docKey(client.id_number), client);
        byName.set(norm(client.full_name), client);

        // ----- case -----
        if (opts.withCases) {
          const catName = rec.case.category || opts.defaultCategory;
          const typeName = rec.case.type || opts.defaultType;
          if (!catName || !typeName) throw new Error("Falta el tipo de proceso o el subproceso.");
          const cat = await ensureCategory(catName);
          const type = await ensureType(cat, typeName);
          const key = `${client.id}|${type.id}|${norm(rec.case.title)}`;
          if (caseKeys.has(key)) {
            summary.casesSkipped++;
          } else {
            const field_values = {};
            for (const [label, value] of Object.entries(rec.custom)) {
              field_values[(await ensureField(cat, label)).id] = value;
            }
            await api("POST", "/cases", {
              client_id: client.id, process_type_id: type.id, title: rec.case.title || "",
              status: rec.case.status || "Abierto", counterparty: rec.case.counterparty || "",
              facts: rec.case.facts || "", field_values,
            });
            caseKeys.add(key);
            summary.casesCreated++;
          }
        }
      } catch (err) {
        summary.errors.push({ row: rowNo, message: err.message });
      }
      opts.onProgress?.(i + 1, records.length);
    }
    return summary;
  }

  window.JuanmaImport = { TARGETS, guessTarget, readFile, splitHeader, buildRecord, run, norm };
})();
